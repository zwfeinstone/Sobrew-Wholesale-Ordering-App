begin;

create schema if not exists private;

-- Intentionally no backfill: existing Sample Requested leads remain NULL and
-- are excluded from the automatic export until they leave and re-enter it.
alter table public.prospecting_leads add column sample_requested_at timestamptz;

create or replace function private.track_sample_request_entry_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.stage = 'sample_requested' then
    if tg_op = 'INSERT' or old.stage is distinct from 'sample_requested' then
      new.sample_requested_at := now();
      new.hubspot_status := 'queued';
    else
      new.sample_requested_at := old.sample_requested_at;
    end if;
  else
    new.sample_requested_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.track_sample_request_entry_v1() from public, anon, authenticated;
create trigger prospecting_leads_track_sample_entry
before insert or update of stage, sample_requested_at on public.prospecting_leads
for each row execute function private.track_sample_request_entry_v1();

-- These trigger-only functions enforce integrity even if a stage change makes
-- the lead invisible to the sales rep under RLS. They expose no callable RPC.
create or replace function private.lock_sample_contact_leads_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform id from public.prospecting_leads
  where id in (
    case when tg_op <> 'INSERT' then old.lead_id end,
    case when tg_op <> 'DELETE' then new.lead_id end
  ) order by id for update;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.enforce_sample_request_contact_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  lead_ids uuid[];
begin
  if tg_table_name = 'prospecting_leads' then
    lead_ids := array[new.id];
  else
    lead_ids := array[
      case when tg_op <> 'INSERT' then old.lead_id end,
      case when tg_op <> 'DELETE' then new.lead_id end
    ];
  end if;
  if exists (
    select 1 from public.prospecting_leads lead
    where lead.id = any(lead_ids) and lead.archived_at is null and lead.stage = 'sample_requested'
      and not exists (
        select 1 from public.prospecting_contacts contact
        where contact.lead_id = lead.id
          and nullif(btrim(contact.full_name), '') is not null
          and btrim(contact.email) ~ '^[^[:space:]@,;]+@[^[:space:]@,;]+[.][^[:space:]@,;]+$'
      )
  ) then
    raise exception using errcode = '23514', message = 'sample_requested_contact_required: Add a contact name and valid email before moving to Sample Requested.';
  end if;
  return null;
end;
$$;

revoke all on function private.lock_sample_contact_leads_v1() from public, anon, authenticated;
revoke all on function private.enforce_sample_request_contact_v1() from public, anon, authenticated;

create trigger prospecting_contacts_lock_sample_lead
before insert or update or delete on public.prospecting_contacts
for each row execute function private.lock_sample_contact_leads_v1();

-- Defer validation so the record-save RPC can change the stage and add/edit its
-- qualifying contact in the same transaction. Invalid saves roll back entirely.
create constraint trigger prospecting_leads_require_sample_contact
after insert or update of stage, archived_at on public.prospecting_leads
deferrable initially deferred for each row
execute function private.enforce_sample_request_contact_v1();

create constraint trigger prospecting_contacts_require_sample_contact
after insert or update or delete on public.prospecting_contacts
deferrable initially deferred for each row
execute function private.enforce_sample_request_contact_v1();

create table public.prospecting_hubspot_push_locks (
  lead_id uuid primary key references public.prospecting_leads(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.prospecting_hubspot_push_locks enable row level security;
revoke all on public.prospecting_hubspot_push_locks from public, anon, authenticated;
grant all on public.prospecting_hubspot_push_locks to service_role;

create or replace function public.claim_prospecting_hubspot_push_v1(p_lead_id uuid, p_token uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform id from public.prospecting_leads
  where id = p_lead_id and archived_at is null and not do_not_contact
    and stage in ('interested', 'sample_requested') and hubspot_status <> 'exported'
  for update;
  if not found then return false; end if;
  insert into public.prospecting_hubspot_push_locks (lead_id, token, expires_at)
  values (p_lead_id, p_token, now() + interval '15 minutes')
  on conflict (lead_id) do update set token = excluded.token, expires_at = excluded.expires_at
  where public.prospecting_hubspot_push_locks.expires_at < now();
  return found;
end;
$$;
revoke all on function public.claim_prospecting_hubspot_push_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_prospecting_hubspot_push_v1(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
