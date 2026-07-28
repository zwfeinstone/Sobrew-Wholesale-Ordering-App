alter table prospecting_leads
  add column if not exists hubspot_company_id text,
  add column if not exists hubspot_contact_id text,
  add column if not exists hubspot_last_push_attempt_at timestamptz,
  add column if not exists hubspot_last_push_error text;

create index if not exists prospecting_leads_hubspot_company_id_idx
  on prospecting_leads(hubspot_company_id)
  where hubspot_company_id is not null;

create index if not exists prospecting_leads_hubspot_contact_id_idx
  on prospecting_leads(hubspot_contact_id)
  where hubspot_contact_id is not null;
