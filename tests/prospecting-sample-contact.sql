-- Run after the sample-contact migration. All test rows are rolled back.
begin;
do $test$
#variable_conflict use_variable
declare
  lead_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  lead_row public.prospecting_leads%rowtype;
  first_token uuid := gen_random_uuid();
begin
  insert into public.prospecting_leads(id,company_name,company_name_key,company_email)
  values(lead_id,'Sample contact verification','sample-contact-' || lead_id,'company@example.com');
  set constraints all immediate;
  begin
    update public.prospecting_leads set stage='sample_requested' where id=lead_id;
    raise exception 'FAIL: company email alone allowed a sample request';
  exception when check_violation then
    if sqlerrm not like 'sample_requested_contact_required:%' then raise; end if;
  end;
  insert into public.prospecting_contacts(lead_id,full_name,email) values(lead_id,'Jane Buyer','invalid');
  begin
    update public.prospecting_leads set stage='sample_requested' where id=lead_id;
    raise exception 'FAIL: invalid contact email allowed a sample request';
  exception when check_violation then
    if sqlerrm not like 'sample_requested_contact_required:%' then raise; end if;
  end;
  set constraints all deferred;
  select * into lead_row from public.prospecting_leads where id=lead_id;
  perform public.save_prospecting_record_v1(
    lead_id,null,lead_row.updated_at,to_jsonb(lead_row) || '{"stage":"sample_requested"}'::jsonb,
    '[]'::jsonb,'{"full_name":"Jane Buyer","email":"jane@example.com"}'::jsonb
  );
  set constraints all immediate;
  if not exists(select 1 from public.prospecting_leads where id=lead_id and sample_requested_at is not null and hubspot_status='queued') then
    raise exception 'FAIL: entry timestamp/queue not set';
  end if;
  begin
    delete from public.prospecting_contacts where prospecting_contacts.lead_id=lead_id;
    raise exception 'FAIL: final email contact was deleted';
  exception when check_violation then
    if sqlerrm not like 'sample_requested_contact_required:%' then raise; end if;
  end;
  if not public.claim_prospecting_hubspot_push_v1(lead_id,first_token) then raise exception 'FAIL: first lease rejected'; end if;
  if public.claim_prospecting_hubspot_push_v1(lead_id,gen_random_uuid()) then raise exception 'FAIL: simultaneous push allowed'; end if;
  delete from public.prospecting_hubspot_push_locks where prospecting_hubspot_push_locks.lead_id=lead_id;
  update public.prospecting_leads set hubspot_status='exported' where id=lead_id;
  if public.claim_prospecting_hubspot_push_v1(lead_id,gen_random_uuid()) then raise exception 'FAIL: exported lead claimed'; end if;
  insert into public.prospecting_leads(id,company_name,company_name_key) values(other_id,'Second validation','sample-contact-' || other_id);
  begin
    update public.prospecting_leads set stage='sample_requested' where id=other_id;
    raise exception 'FAIL: contact from another lead accepted';
  exception when check_violation then
    if sqlerrm not like 'sample_requested_contact_required:%' then raise; end if;
  end;
  if has_function_privilege('authenticated','public.claim_prospecting_hubspot_push_v1(uuid,uuid)','execute')
    or has_table_privilege('authenticated','public.prospecting_hubspot_push_locks','INSERT') then
    raise exception 'FAIL: user can acquire an export lease';
  end if;
end;
$test$;
rollback;
select count(*) filter(where sample_requested_at is null) as existing_excluded,
count(*) filter(where sample_requested_at is not null) as new_eligible
from public.prospecting_leads where stage='sample_requested' and archived_at is null;
