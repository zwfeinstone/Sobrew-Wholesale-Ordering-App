alter table prospecting_leads
  add column if not exists hubspot_deal_id text;

create index if not exists prospecting_leads_hubspot_deal_id_idx
  on prospecting_leads(hubspot_deal_id)
  where hubspot_deal_id is not null;
