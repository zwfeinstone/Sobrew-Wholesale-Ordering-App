create table if not exists admin_center_assignments (
  center_id uuid not null references centers(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  primary key (center_id, profile_id)
);

create index if not exists admin_center_assignments_profile_idx on admin_center_assignments(profile_id);
create index if not exists admin_center_assignments_center_idx on admin_center_assignments(center_id);

create table if not exists admin_payroll_locks (
  id uuid primary key default gen_random_uuid(),
  lock_start_at timestamptz not null,
  lock_end_at timestamptz not null,
  notes text,
  locked_at timestamptz not null default now(),
  locked_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lock_end_at >= lock_start_at)
);

create index if not exists admin_payroll_locks_range_idx on admin_payroll_locks(lock_start_at, lock_end_at);

alter table admin_center_assignments enable row level security;
alter table admin_payroll_locks enable row level security;

drop policy if exists "owner all admin_center_assignments" on admin_center_assignments;
create policy "owner all admin_center_assignments"
  on admin_center_assignments
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "self read admin_center_assignments" on admin_center_assignments;
create policy "self read admin_center_assignments"
  on admin_center_assignments
  for select
  using (profile_id = auth.uid());

drop policy if exists "owner all admin_payroll_locks" on admin_payroll_locks;
create policy "owner all admin_payroll_locks"
  on admin_payroll_locks
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

insert into admin_center_assignments (center_id, profile_id, assigned_by, updated_by)
select center_id, sales_profile_id, assigned_by, updated_by
from center_sales_assignments
on conflict (center_id, profile_id) do nothing;

notify pgrst, 'reload schema';
