alter table prospecting_leads
  add column if not exists hubspot_note_id text;

create index if not exists prospecting_leads_hubspot_note_id_idx
  on prospecting_leads(hubspot_note_id)
  where hubspot_note_id is not null;
