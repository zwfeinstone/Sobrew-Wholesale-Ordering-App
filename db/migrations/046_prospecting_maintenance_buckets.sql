alter table prospecting_leads
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references profiles(id) on delete set null,
  add column if not exists archive_reason text;

create index if not exists prospecting_leads_archived_at_idx
  on prospecting_leads(archived_at);

create index if not exists prospecting_leads_open_stage_idx
  on prospecting_leads(stage, updated_at desc)
  where archived_at is null;

insert into prospecting_activities (
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
  id,
  'assignment',
  'Lead moved to superadmin maintenance bucket.',
  stage,
  stage,
  assigned_profile_id,
  coalesce(updated_by, created_by, assigned_profile_id),
  'Unassigned'
from prospecting_leads
where archived_at is null
  and stage in ('not_a_fit', 'lost')
  and assigned_profile_id is not null;

update prospecting_leads
set
  assigned_profile_id = null,
  next_follow_up_at = null,
  updated_at = now()
where archived_at is null
  and stage in ('not_a_fit', 'lost')
  and assigned_profile_id is not null;
