alter table prospecting_activities
  add column if not exists previous_assigned_profile_id uuid references profiles(id) on delete set null;

create index if not exists prospecting_activities_previous_owner_idx
  on prospecting_activities(previous_assigned_profile_id);

update prospecting_activities
set previous_assigned_profile_id = created_by
where next_stage = 'recycle_try_later'
  and previous_assigned_profile_id is null
  and created_by is not null;
