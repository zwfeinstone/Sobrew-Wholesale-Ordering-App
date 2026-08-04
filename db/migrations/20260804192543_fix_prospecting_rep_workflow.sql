begin;

create or replace function public.enforce_prospecting_parked_lead_state_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.stage in ('recycle_try_later', 'not_a_fit', 'lost') then
    new.assigned_profile_id := null;
    new.next_follow_up_at := null;
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_prospecting_parked_lead_state_v1()
  from public, anon, authenticated;

grant execute on function public.enforce_prospecting_parked_lead_state_v1()
  to service_role;

drop trigger if exists prospecting_leads_enforce_parked_state
  on public.prospecting_leads;

create trigger prospecting_leads_enforce_parked_state
before insert or update of stage, assigned_profile_id, next_follow_up_at
on public.prospecting_leads
for each row
execute function public.enforce_prospecting_parked_lead_state_v1();

insert into public.prospecting_activities (
  lead_id,
  activity_type,
  body,
  previous_stage,
  next_stage,
  previous_assigned_profile_id,
  created_by,
  result
)
select
  lead.id,
  'assignment',
  'Recycle / Try Later lead returned to the unassigned pool.',
  lead.stage,
  lead.stage,
  lead.assigned_profile_id,
  coalesce(lead.updated_by, lead.created_by, lead.assigned_profile_id),
  'Unassigned'
from public.prospecting_leads lead
where lead.archived_at is null
  and lead.stage = 'recycle_try_later'
  and lead.assigned_profile_id is not null;

update public.prospecting_leads
set
  assigned_profile_id = null,
  next_follow_up_at = null,
  updated_at = now()
where archived_at is null
  and stage = 'recycle_try_later'
  and assigned_profile_id is not null;

create or replace function public.save_prospecting_record_v1(
  p_lead_id uuid,
  p_actor_id uuid,
  p_expected_updated_at timestamptz,
  p_lead jsonb,
  p_contact_updates jsonb default '[]'::jsonb,
  p_new_contact jsonb default null,
  p_activity jsonb default null,
  p_audit_activities jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_activity jsonb;
  v_before public.prospecting_leads%rowtype;
  v_contact jsonb;
  v_final public.prospecting_leads%rowtype;
  v_now timestamptz := now();
begin
  if p_lead is null or jsonb_typeof(p_lead) <> 'object' then
    raise exception using errcode = '22023', message = 'Lead payload must be a JSON object.';
  end if;
  if jsonb_typeof(coalesce(p_contact_updates, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Contact updates must be a JSON array.';
  end if;
  if p_new_contact is not null and jsonb_typeof(p_new_contact) <> 'object' then
    raise exception using errcode = '22023', message = 'New contact payload must be a JSON object.';
  end if;
  if p_activity is not null and jsonb_typeof(p_activity) <> 'object' then
    raise exception using errcode = '22023', message = 'Activity payload must be a JSON object.';
  end if;
  if jsonb_typeof(coalesce(p_audit_activities, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Audit activities must be a JSON array.';
  end if;

  select lead.*
  into v_before
  from public.prospecting_leads lead
  where lead.id = p_lead_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Prospecting lead not found.';
  end if;

  if p_expected_updated_at is null or v_before.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'Prospecting lead was updated by another request.';
  end if;

  update public.prospecting_leads
  set
    address_line_1 = p_lead ->> 'address_line_1',
    address_line_2 = p_lead ->> 'address_line_2',
    assigned_profile_id = nullif(p_lead ->> 'assigned_profile_id', '')::uuid,
    city = p_lead ->> 'city',
    company_email = p_lead ->> 'company_email',
    company_name = p_lead ->> 'company_name',
    company_name_key = p_lead ->> 'company_name_key',
    company_website = p_lead ->> 'company_website',
    country = p_lead ->> 'country',
    do_not_contact = coalesce((p_lead ->> 'do_not_contact')::boolean, false),
    hubspot_status = case
      when p_lead ->> 'stage' in ('interested', 'sample_requested') then 'queued'
      when v_before.hubspot_status = 'queued' then 'not_queued'
      else v_before.hubspot_status
    end,
    last_activity_at = case when p_activity is null then v_before.last_activity_at else v_now end,
    last_result = case when p_activity is null then v_before.last_result else p_activity ->> 'result' end,
    next_follow_up_at = nullif(p_lead ->> 'next_follow_up_at', '')::date,
    notes = p_lead ->> 'notes',
    phone = p_lead ->> 'phone',
    phone_key = coalesce(p_lead ->> 'phone_key', ''),
    postal_code = p_lead ->> 'postal_code',
    priority = p_lead ->> 'priority',
    stage = p_lead ->> 'stage',
    state = p_lead ->> 'state',
    state_key = p_lead ->> 'state_key',
    updated_at = v_now,
    updated_by = p_actor_id
  where id = p_lead_id
  returning * into v_final;

  for v_contact in
    select value
    from jsonb_array_elements(coalesce(p_contact_updates, '[]'::jsonb))
  loop
    update public.prospecting_contacts
    set
      email = v_contact ->> 'email',
      full_name = v_contact ->> 'full_name',
      is_primary = coalesce((v_contact ->> 'is_primary')::boolean, false),
      notes = v_contact ->> 'notes',
      phone = v_contact ->> 'phone',
      title = v_contact ->> 'title',
      updated_at = v_now,
      updated_by = p_actor_id
    where id = nullif(v_contact ->> 'id', '')::uuid
      and lead_id = p_lead_id;

    if not found then
      raise exception using errcode = 'P0002', message = 'Prospecting contact not found.';
    end if;
  end loop;

  if p_new_contact is not null then
    insert into public.prospecting_contacts (
      lead_id,
      full_name,
      title,
      email,
      phone,
      is_primary,
      notes,
      created_by,
      updated_by
    )
    values (
      p_lead_id,
      p_new_contact ->> 'full_name',
      p_new_contact ->> 'title',
      p_new_contact ->> 'email',
      p_new_contact ->> 'phone',
      coalesce((p_new_contact ->> 'is_primary')::boolean, false),
      p_new_contact ->> 'notes',
      p_actor_id,
      p_actor_id
    );
  end if;

  if p_activity is not null then
    if nullif(p_activity ->> 'contact_id', '') is not null
      and not exists (
        select 1
        from public.prospecting_contacts contact
        where contact.id = (p_activity ->> 'contact_id')::uuid
          and contact.lead_id = p_lead_id
      ) then
      raise exception using errcode = 'P0002', message = 'Prospecting activity contact not found.';
    end if;

    insert into public.prospecting_activities (
      lead_id,
      contact_id,
      activity_type,
      result,
      body,
      previous_stage,
      next_stage,
      next_follow_up_at,
      previous_assigned_profile_id,
      created_by
    )
    values (
      p_lead_id,
      nullif(p_activity ->> 'contact_id', '')::uuid,
      p_activity ->> 'activity_type',
      p_activity ->> 'result',
      p_activity ->> 'body',
      p_activity ->> 'previous_stage',
      p_activity ->> 'next_stage',
      nullif(p_activity ->> 'next_follow_up_at', '')::date,
      nullif(p_activity ->> 'previous_assigned_profile_id', '')::uuid,
      p_actor_id
    );
  end if;

  for v_activity in
    select value
    from jsonb_array_elements(coalesce(p_audit_activities, '[]'::jsonb))
  loop
    insert into public.prospecting_activities (
      lead_id,
      activity_type,
      result,
      body,
      previous_stage,
      next_stage,
      next_follow_up_at,
      previous_assigned_profile_id,
      created_by
    )
    values (
      p_lead_id,
      v_activity ->> 'activity_type',
      v_activity ->> 'result',
      v_activity ->> 'body',
      v_activity ->> 'previous_stage',
      v_activity ->> 'next_stage',
      nullif(v_activity ->> 'next_follow_up_at', '')::date,
      nullif(v_activity ->> 'previous_assigned_profile_id', '')::uuid,
      p_actor_id
    );
  end loop;

  if v_final.stage in ('interested', 'sample_requested') then
    insert into public.prospecting_hubspot_queue (
      lead_id,
      queued_by,
      queued_stage,
      status
    )
    values (
      p_lead_id,
      p_actor_id,
      v_final.stage,
      'queued'
    )
    on conflict (lead_id) do update
    set
      queued_by = excluded.queued_by,
      queued_stage = excluded.queued_stage,
      status = excluded.status;
  else
    delete from public.prospecting_hubspot_queue
    where lead_id = p_lead_id
      and status = 'queued';
  end if;

  return jsonb_build_object(
    'id', v_final.id,
    'assigned_profile_id', v_final.assigned_profile_id,
    'next_follow_up_at', v_final.next_follow_up_at,
    'stage', v_final.stage,
    'updated_at', v_final.updated_at
  );
end;
$function$;

revoke all on function public.save_prospecting_record_v1(
  uuid,
  uuid,
  timestamptz,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function public.save_prospecting_record_v1(
  uuid,
  uuid,
  timestamptz,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) to service_role;

notify pgrst, 'reload schema';

commit;
