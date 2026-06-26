alter table admin_time_entries
  add column if not exists work_type text not null default 'unassigned';

alter table admin_time_entries
  drop constraint if exists admin_time_entries_work_type_check;

update admin_time_entries
set work_type = 'unassigned'
where work_type is null
   or work_type not in ('production', 'packing', 'receiving', 'shipping', 'sales', 'admin', 'cleaning', 'other', 'unassigned');

alter table admin_time_entries
  add constraint admin_time_entries_work_type_check
  check (work_type in ('production', 'packing', 'receiving', 'shipping', 'sales', 'admin', 'cleaning', 'other', 'unassigned'));

create table if not exists admin_labor_tag_assignments (
  profile_id uuid not null references profiles(id) on delete cascade,
  work_type text not null check (work_type in ('production', 'packing', 'receiving', 'shipping', 'sales', 'admin', 'cleaning', 'other')),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references profiles(id) on delete set null,
  primary key (profile_id, work_type)
);

create table if not exists admin_time_entry_allocations (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references admin_time_entries(id) on delete cascade,
  work_type text not null check (work_type in ('production', 'packing', 'receiving', 'shipping', 'sales', 'admin', 'cleaning', 'other', 'unassigned')),
  production_run_id uuid references production_runs(id) on delete set null,
  minutes numeric(14, 4) not null default 0 check (minutes >= 0),
  wage_cents numeric(14, 4) not null default 0 check (wage_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

create index if not exists admin_time_entries_work_type_idx on admin_time_entries(work_type);
create index if not exists admin_labor_tag_assignments_profile_idx on admin_labor_tag_assignments(profile_id);
create index if not exists admin_time_entry_allocations_entry_idx on admin_time_entry_allocations(time_entry_id);
create index if not exists admin_time_entry_allocations_work_type_idx on admin_time_entry_allocations(work_type);
create index if not exists admin_time_entry_allocations_production_run_idx on admin_time_entry_allocations(production_run_id);

alter table admin_labor_tag_assignments enable row level security;
alter table admin_time_entry_allocations enable row level security;

drop policy if exists "owner all admin_labor_tag_assignments" on admin_labor_tag_assignments;
create policy "owner all admin_labor_tag_assignments"
  on admin_labor_tag_assignments
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "self read admin_labor_tag_assignments" on admin_labor_tag_assignments;
create policy "self read admin_labor_tag_assignments"
  on admin_labor_tag_assignments
  for select
  using (profile_id = auth.uid());

drop policy if exists "owner all admin_time_entry_allocations" on admin_time_entry_allocations;
create policy "owner all admin_time_entry_allocations"
  on admin_time_entry_allocations
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "self read admin_time_entry_allocations" on admin_time_entry_allocations;
create policy "self read admin_time_entry_allocations"
  on admin_time_entry_allocations
  for select
  using (
    exists (
      select 1
      from admin_time_entries e
      where e.id = admin_time_entry_allocations.time_entry_id
        and e.profile_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
