begin;

create schema if not exists private;

-- A receipt belongs to one authenticated actor and one immutable submission.
-- Retrying an interrupted response returns the original result, including after
-- a successful sample handoff has removed the lead from the rep's work queue.
create table public.prospecting_submission_receipts (
  submission_id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  submission_signature text check (submission_signature is null or submission_signature ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  receipt jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.prospecting_submission_receipts enable row level security;
revoke all on public.prospecting_submission_receipts from public, anon, authenticated;
grant all on public.prospecting_submission_receipts to service_role;

create table public.prospecting_sample_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.prospecting_leads(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  contact_id uuid references public.prospecting_contacts(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'order_created', 'legacy_review')),
  order_id uuid references public.orders(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index prospecting_sample_requests_lead_idx on public.prospecting_sample_requests(lead_id, created_at desc);
create unique index prospecting_sample_requests_open_idx on public.prospecting_sample_requests(lead_id)
  where status in ('pending', 'legacy_review') and closed_at is null;
alter table public.prospecting_sample_requests enable row level security;
revoke all on public.prospecting_sample_requests from public, anon, authenticated;
grant all on public.prospecting_sample_requests to service_role;

-- Historical requests are deliberately review items: a past sample order does
-- not prove that the current request has been fulfilled. Retain its order link.
insert into public.prospecting_sample_requests(lead_id, requested_by, status, order_id, created_at)
select lead.id, coalesce(lead.updated_by, lead.created_by), 'legacy_review',
  (select o.id from public.orders o where o.prospecting_lead_id = lead.id and o.order_kind = 'prospecting_sample'
   and o.archived_at is null order by o.created_at desc, o.id desc limit 1),
  coalesce(lead.sample_requested_at, lead.updated_at, now())
from public.prospecting_leads lead where lead.stage = 'sample_requested' and lead.archived_at is null;

-- Trigger-only access: normal RLS-authorized imports/bulk transitions also
-- create a request. Contact selection happens after all transaction edits.
create function private.track_prospecting_sample_request_v2()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stage = 'sample_requested' and new.archived_at is null then
    if tg_op = 'INSERT' or old.stage is distinct from 'sample_requested' or old.archived_at is not null then
      insert into public.prospecting_sample_requests(lead_id, requested_by)
      values(new.id, coalesce(new.updated_by, new.created_by));
    end if;
  else
    update public.prospecting_sample_requests set closed_at = now(), updated_at = now()
    where lead_id = new.id and status in ('pending', 'legacy_review') and closed_at is null;
  end if;
  return new;
end;
$$;
revoke all on function private.track_prospecting_sample_request_v2() from public, anon, authenticated;
create trigger prospecting_leads_track_request_v2 after insert or update of stage, archived_at
on public.prospecting_leads for each row execute function private.track_prospecting_sample_request_v2();

create function private.finalize_prospecting_request_contact_v2()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.prospecting_sample_requests request set contact_id = (
    select c.id from public.prospecting_contacts c where c.lead_id = new.id
      and nullif(btrim(c.full_name), '') is not null
      and btrim(c.email) ~ '^[^[:space:]@,;]+@[^[:space:]@,;]+[.][^[:space:]@,;]+$'
    order by c.is_primary desc, c.created_at, c.id limit 1
  ) where request.lead_id = new.id and request.contact_id is null and request.closed_at is null;
  return null;
end;
$$;
revoke all on function private.finalize_prospecting_request_contact_v2() from public, anon, authenticated;
create constraint trigger prospecting_leads_finalize_request_contact_v2 after insert or update of stage
on public.prospecting_leads deferrable initially deferred for each row
execute function private.finalize_prospecting_request_contact_v2();

-- Every contact edit participates in the record version, including older
-- server actions, imports, and contact deletions outside the new workspace.
create function private.bump_prospecting_contact_version_v2()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.prospecting_leads set updated_at = clock_timestamp()
  where id in (case when tg_op <> 'INSERT' then old.lead_id end,
               case when tg_op <> 'DELETE' then new.lead_id end);
  return null;
end;
$$;
revoke all on function private.bump_prospecting_contact_version_v2() from public, anon, authenticated;
create trigger prospecting_contacts_bump_version_v2 after insert or update or delete
on public.prospecting_contacts for each row execute function private.bump_prospecting_contact_version_v2();

create function public.commit_prospecting_record_v2(
  p_actor_id uuid,
  p_submission_id uuid,
  p_lead_id uuid,
  p_expected_updated_at timestamptz,
  p_lead jsonb default null,
  p_contact_updates jsonb default '[]'::jsonb,
  p_new_contact jsonb default null,
  p_activity jsonb default null,
  p_audit_activities jsonb default '[]'::jsonb,
  p_contact_delete_ids uuid[] default '{}'::uuid[],
  p_sample jsonb default null,
  p_submission_signature text default null,
  p_next_href text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_actor public.profiles%rowtype;
  v_owner boolean;
  v_can_edit boolean := false;
  v_before public.prospecting_leads%rowtype;
  v_after public.prospecting_leads%rowtype;
  v_existing public.prospecting_submission_receipts%rowtype;
  v_request public.prospecting_sample_requests%rowtype;
  v_payload jsonb;
  v_receipt jsonb;
  v_lead jsonb;
  v_contact_id uuid;
  v_new_contact_ids uuid[];
  v_delete_id uuid;
  v_assignee uuid;
  v_order_id uuid;
  v_item jsonb;
  v_qty integer;
  v_product public.products%rowtype;
  v_mode text;
  v_request_id uuid;
  v_had_pending boolean;
begin
  if p_actor_id is null or p_submission_id is null or (p_submission_signature is not null and p_submission_signature !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'Invalid submission identity.';
  end if;
  if p_next_href is not null and (p_next_href !~ '^/admin/(sales/prospecting|reports)([/?]|$)' or length(p_next_href) > 10000) then
    raise exception using errcode = '22023', message = 'Invalid prospecting continuation.';
  end if;
  -- Lock authorization rows before performing any writes.
  select * into v_actor from public.profiles where id = p_actor_id for share;
  if not found or not coalesce(v_actor.is_admin, false) or not coalesce(v_actor.is_active, true) then
    raise exception using errcode = '42501', message = 'Prospecting edit permission required.';
  end if;
  v_owner := coalesce(v_actor.is_superadmin, false) or lower(coalesce(v_actor.email, '')) = 'zach@sobrew.com';
  if not v_owner then
    select can_edit into v_can_edit from public.admin_permissions
    where profile_id = p_actor_id and section_key = 'prospecting' for share;
    if not coalesce(v_can_edit, false) then
      raise exception using errcode = '42501', message = 'Prospecting edit permission required.';
    end if;
  end if;

  v_payload := jsonb_build_object('leadId', p_lead_id, 'version', p_expected_updated_at,
    'lead', p_lead, 'contacts', p_contact_updates, 'newContact', p_new_contact,
    'activity', p_activity, 'audit', p_audit_activities, 'deleteContacts', p_contact_delete_ids, 'sample', p_sample);
  perform pg_advisory_xact_lock(hashtextextended(p_submission_id::text, 0));
  select * into v_existing from public.prospecting_submission_receipts where submission_id = p_submission_id;
  if found then
    if v_existing.actor_id <> p_actor_id then raise exception using errcode = '42501', message = 'Submission belongs to another actor.'; end if;
    if v_existing.submission_signature is distinct from p_submission_signature
      or (p_submission_signature is null and v_existing.payload <> v_payload) then
      raise exception using errcode = '22023', message = 'submission_reused';
    end if;
    return v_existing.receipt || jsonb_build_object('replayed', true);
  end if;

  if p_sample is not null and (jsonb_typeof(p_sample) <> 'object' or coalesce(p_sample->>'mode', '') not in ('request_only', 'order')) then
    raise exception using errcode = '22023', message = 'Invalid sample mode.';
  end if;
  v_mode := p_sample->>'mode';
  if p_lead_id is null and (v_mode is distinct from 'order' or p_lead is not null or p_activity is not null
    or p_new_contact is not null or jsonb_array_length(p_contact_updates) > 0 or cardinality(p_contact_delete_ids) > 0) then
    raise exception using errcode = '22023', message = 'Standalone samples require an order.';
  end if;

  if p_lead_id is not null then
    select * into v_before from public.prospecting_leads where id = p_lead_id for update;
    if not found or v_before.archived_at is not null then raise exception using errcode = 'P0002', message = 'Prospecting lead not found.'; end if;
    if not v_owner and (v_before.assigned_profile_id is distinct from p_actor_id or v_before.stage = 'sample_requested') then
      raise exception using errcode = '42501', message = 'Lead is no longer in your queue.';
    end if;
    if p_expected_updated_at is null or v_before.updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = '40001', message = 'Prospecting lead was updated by another request.';
    end if;
    v_lead := coalesce(p_lead, to_jsonb(v_before));
    if p_sample is not null then v_lead := v_lead || jsonb_build_object('stage', 'sample_requested'); end if;
    if nullif(btrim(v_lead->>'company_name'), '') is null then raise exception using errcode = '22023', message = 'Company name required.'; end if;
    if not v_owner and nullif(v_lead->>'assigned_profile_id', '')::uuid is distinct from v_before.assigned_profile_id
      and v_lead->>'stage' not in ('recycle_try_later', 'not_a_fit', 'lost') then
      raise exception using errcode = '42501', message = 'Only an owner may change assignments.';
    end if;
    v_assignee := nullif(v_lead->>'assigned_profile_id', '')::uuid;
    if v_assignee is not null and v_assignee is distinct from v_before.assigned_profile_id then
      perform p.id from public.profiles p join public.admin_commission_settings s on s.profile_id = p.id
      where p.id = v_assignee and p.is_admin and coalesce(p.is_active, true) and s.is_sales_rep for share of p, s;
      if not found then raise exception using errcode = '42501', message = 'Assigned rep is not eligible.'; end if;
    end if;
    if (v_mode is not null and coalesce((v_lead->>'do_not_contact')::boolean, false)) or
       (v_before.do_not_contact and coalesce((v_lead->>'do_not_contact')::boolean, false) and p_activity->>'activity_type' in ('call','email')) then
      raise exception using errcode = '42501', message = 'Do not contact lead.';
    end if;
    select array_agg(id) into v_new_contact_ids from public.prospecting_contacts where lead_id = p_lead_id;
    perform public.save_prospecting_record_v1(p_lead_id, p_actor_id, p_expected_updated_at,
      v_lead, p_contact_updates, p_new_contact, p_activity, p_audit_activities);
    foreach v_delete_id in array coalesce(p_contact_delete_ids, '{}'::uuid[]) loop
      delete from public.prospecting_contacts where id = v_delete_id and lead_id = p_lead_id;
      if not found then raise exception using errcode = 'P0002', message = 'Prospecting contact not found.'; end if;
      insert into public.prospecting_activities(lead_id, activity_type, result, body, created_by)
      values(p_lead_id, 'enrichment', 'Contact removed', 'Key contact removed.', p_actor_id);
    end loop;
    -- The old RPC queues every edit to an interested/sample lead. Preserve an
    -- existing export when its stage has not changed (manager fulfillment).
    if v_before.stage = v_lead->>'stage' and v_before.hubspot_status = 'exported' then
      update public.prospecting_leads set hubspot_status = 'exported' where id = p_lead_id;
      update public.prospecting_hubspot_queue set status = 'exported' where lead_id = p_lead_id;
    end if;
  end if;

  if p_lead_id is not null and (p_sample is not null or
    (v_before.stage <> 'sample_requested' and v_lead->>'stage' = 'sample_requested')) then
    if p_sample->>'contactId' = 'new' then
      select c.id into v_contact_id from public.prospecting_contacts c where c.lead_id = p_lead_id
      and not (c.id = any(coalesce(v_new_contact_ids, '{}'::uuid[]))) order by c.created_at desc, c.id limit 1;
    elsif nullif(p_sample->>'contactId', '') is not null then
      v_contact_id := (p_sample->>'contactId')::uuid;
    else
      select c.id into v_contact_id from public.prospecting_contacts c where c.lead_id = p_lead_id
      and nullif(btrim(c.full_name), '') is not null and btrim(c.email) ~ '^[^[:space:]@,;]+@[^[:space:]@,;]+[.][^[:space:]@,;]+$'
      order by c.is_primary desc, c.created_at, c.id limit 1;
    end if;
    if not exists(select 1 from public.prospecting_contacts c where c.id = v_contact_id and c.lead_id = p_lead_id
      and nullif(btrim(c.full_name), '') is not null and btrim(c.email) ~ '^[^[:space:]@,;]+@[^[:space:]@,;]+[.][^[:space:]@,;]+$') then
      raise exception using errcode = '23514', message = 'sample_requested_contact_required';
    end if;
    v_request_id := nullif(p_sample->>'requestId', '')::uuid;
    if v_request_id is not null then
      select * into v_request from public.prospecting_sample_requests where id = v_request_id and lead_id = p_lead_id for update;
      if not found then raise exception using errcode = 'P0002', message = 'Sample request not found.'; end if;
      if v_request.status = 'order_created' or v_request.closed_at is not null then
        raise exception using errcode = '22023', message = 'sample_request_closed';
      end if;
    else
      select * into v_request from public.prospecting_sample_requests
      where lead_id = p_lead_id and status in ('pending', 'legacy_review') and closed_at is null for update;
      v_had_pending := found;
      if not v_had_pending then
        insert into public.prospecting_sample_requests(lead_id, requested_by, contact_id)
        values(p_lead_id, p_actor_id, v_contact_id) returning * into v_request;
        if v_before.stage = 'sample_requested' and v_mode = 'request_only'
          and coalesce(lower(p_activity->>'result'), '') not in ('sample requested', 'requested sample')
          and not exists(select 1 from jsonb_array_elements(p_audit_activities) item
            where lower(item->>'result') in ('sample requested', 'requested sample')) then
          insert into public.prospecting_activities(lead_id, activity_type, result, body, previous_stage, next_stage, created_by)
          values(p_lead_id, 'enrichment', 'Sample requested', 'Another sample request was sent for fulfillment.',
            'sample_requested', 'sample_requested', p_actor_id);
        end if;
      end if;
    end if;
    v_request_id := v_request.id;
    if p_sample is not null then
      update public.prospecting_sample_requests set contact_id = v_contact_id,
        details = details || (p_sample - 'mode' - 'requestId' - 'contactId'), updated_at = clock_timestamp()
      where id = v_request_id;
    end if;
  end if;

  if v_mode = 'order' then
    if exists(select 1 from unnest(array['centerName','attentionName','address1','city','state','zip']) as field
      where nullif(btrim(p_sample->>field), '') is null) then
      raise exception using errcode = '22023', message = 'sample_missing_fields';
    end if;
    if jsonb_typeof(p_sample->'items') is distinct from 'array' or jsonb_array_length(p_sample->'items') = 0 then
      raise exception using errcode = '22023', message = 'sample_invalid_items';
    end if;
    for v_item in select value from jsonb_array_elements(p_sample->'items') loop
      if coalesce(v_item->>'quantity','') !~ '^[0-9]+$' or (v_item->>'quantity')::numeric > 9999
        or (v_item->>'quantity')::numeric < 1 then raise exception using errcode = '22023', message = 'sample_invalid_items'; end if;
      select * into v_product from public.products where id = (v_item->>'productId')::uuid for share;
      if not found or not coalesce(v_product.active, false) or v_product.category <> 'sample_boxes' then
        raise exception using errcode = '22023', message = 'sample_invalid_product';
      end if;
      perform id from public.product_recipes where product_id = v_product.id for share;
      if not found then raise exception using errcode = '22023', message = 'sample_invalid_product'; end if;
    end loop;
    insert into public.orders(center_id, center_location_id, fulfillment_method, notes, order_kind,
      prospecting_lead_id, shipping_address1, shipping_address2, shipping_city, shipping_company,
      shipping_name, shipping_state, shipping_zip, status, submission_id, subtotal_cents, user_id)
    values(null, null, 'carrier', nullif(left(btrim(p_sample->>'notes'), 5000), ''), 'prospecting_sample',
      p_lead_id, btrim(p_sample->>'address1'), nullif(btrim(p_sample->>'address2'), ''), btrim(p_sample->>'city'),
      btrim(p_sample->>'centerName'), btrim(p_sample->>'attentionName'), upper(btrim(p_sample->>'state')),
      btrim(p_sample->>'zip'), 'New', p_submission_id, 0, p_actor_id) returning id into v_order_id;
    for v_item in select value from jsonb_array_elements(p_sample->'items') loop
      v_qty := (v_item->>'quantity')::integer;
      select * into v_product from public.products where id = (v_item->>'productId')::uuid;
      insert into public.order_items(order_id, product_id, product_name_snapshot, qty, unit_price_cents, line_total_cents)
      values(v_order_id, v_product.id, coalesce(v_product.name, v_product.sku, 'Sample box'), v_qty, 0, 0);
    end loop;
    if v_request_id is not null then
      update public.prospecting_sample_requests set status = 'order_created', order_id = v_order_id, updated_at = clock_timestamp()
      where id = v_request_id;
      insert into public.prospecting_activities(lead_id, activity_type, result, body, previous_stage, next_stage, created_by)
      values(p_lead_id, 'enrichment', 'Sample order submitted', 'Sample order ' || v_order_id::text || ' created.',
        'sample_requested', 'sample_requested', p_actor_id);
    end if;
  end if;
  if p_lead_id is not null then select * into v_after from public.prospecting_leads where id = p_lead_id; end if;
  v_receipt := jsonb_build_object('leadId', p_lead_id, 'updatedAt', v_after.updated_at, 'stage', v_after.stage,
    'requestId', v_request_id, 'orderId', v_order_id, 'replayed', false, 'nextHref', p_next_href);
  insert into public.prospecting_submission_receipts(submission_id, actor_id, submission_signature, payload, receipt)
  values(p_submission_id, p_actor_id, p_submission_signature, v_payload, v_receipt);
  return v_receipt;
end;
$$;
revoke all on function public.commit_prospecting_record_v2(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[],jsonb,text,text)
from public, anon, authenticated;
grant execute on function public.commit_prospecting_record_v2(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[],jsonb,text,text) to service_role;

create function public.read_prospecting_receipt_v2(p_actor_id uuid, p_submission_id uuid, p_submission_signature text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_receipt public.prospecting_submission_receipts%rowtype;
begin
  select r.* into v_receipt
  from public.prospecting_submission_receipts r join public.profiles p on p.id = r.actor_id
  where r.actor_id = p_actor_id and r.submission_id = p_submission_id
    and p.is_admin and coalesce(p.is_active, true)
    and (p.is_superadmin or lower(coalesce(p.email, '')) = 'zach@sobrew.com'
      or exists(select 1 from public.admin_permissions permission
        where permission.profile_id = p.id and permission.section_key = 'prospecting' and permission.can_edit));
  if not found then return null; end if;
  if v_receipt.submission_signature is distinct from p_submission_signature then
    raise exception using errcode = '22023', message = 'submission_reused';
  end if;
  return v_receipt.receipt || jsonb_build_object('replayed', true);
end;
$$;
revoke all on function public.read_prospecting_receipt_v2(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.read_prospecting_receipt_v2(uuid,uuid,text) to service_role;

notify pgrst, 'reload schema';
commit;
