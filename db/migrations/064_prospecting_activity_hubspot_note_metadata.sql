alter table prospecting_activities
  add column if not exists hubspot_note_id text;

create index if not exists prospecting_activities_hubspot_note_id_idx
  on prospecting_activities(hubspot_note_id)
  where hubspot_note_id is not null;
