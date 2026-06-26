do $$
declare
  v_constraint_name text;
begin
  select conname
    into v_constraint_name
  from pg_constraint
  where conrelid = 'admin_permissions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%section_key%'
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table admin_permissions drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table admin_permissions
  add constraint admin_permissions_section_key_check
  check (section_key in (
    'dashboard',
    'sales',
    'reports',
    'reports_sales',
    'reports_profitability',
    'prospecting',
    'orders',
    'archived_orders',
    'recurring_orders',
    'canceled_recurring_orders',
    'order_form',
    'centers',
    'products',
    'inventory',
    'receiving',
    'planning',
    'production',
    'time_clock',
    'settings',
    'manage_admins'
  ));

create table if not exists admin_time_settings (
  profile_id uuid primary key references profiles(id) on delete cascade,
  hourly_rate_cents numeric(14, 4) not null default 0 check (hourly_rate_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

create table if not exists admin_time_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  hourly_rate_cents_snapshot numeric(14, 4) not null default 0 check (hourly_rate_cents_snapshot >= 0),
  status text not null default 'open' check (status in ('open', 'submitted', 'approved', 'locked', 'void')),
  notes text,
  correction_request_note text,
  manual_reason text,
  correction_reason text,
  corrected_at timestamptz,
  corrected_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references profiles(id) on delete set null,
  locked_at timestamptz,
  locked_by uuid references profiles(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references profiles(id) on delete set null,
  void_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);

create table if not exists admin_time_breaks (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references admin_time_entries(id) on delete cascade,
  break_start_at timestamptz not null,
  break_end_at timestamptz,
  status text not null default 'open' check (status in ('open', 'completed', 'void')),
  notes text,
  manual_reason text,
  correction_reason text,
  corrected_at timestamptz,
  corrected_by uuid references profiles(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references profiles(id) on delete set null,
  void_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  check (break_end_at is null or break_end_at >= break_start_at)
);

create index if not exists admin_time_entries_profile_idx on admin_time_entries(profile_id);
create index if not exists admin_time_entries_clock_in_idx on admin_time_entries(clock_in_at desc);
create index if not exists admin_time_entries_status_idx on admin_time_entries(status);
create index if not exists admin_time_breaks_entry_idx on admin_time_breaks(time_entry_id);
create index if not exists admin_time_breaks_status_idx on admin_time_breaks(status);

alter table admin_time_settings enable row level security;
alter table admin_time_entries enable row level security;
alter table admin_time_breaks enable row level security;

drop policy if exists "owner all admin_time_settings" on admin_time_settings;
create policy "owner all admin_time_settings"
  on admin_time_settings
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "owner all admin_time_entries" on admin_time_entries;
create policy "owner all admin_time_entries"
  on admin_time_entries
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "self read admin_time_entries" on admin_time_entries;
create policy "self read admin_time_entries"
  on admin_time_entries
  for select
  using (profile_id = auth.uid());

drop policy if exists "self insert admin_time_entries" on admin_time_entries;
create policy "self insert admin_time_entries"
  on admin_time_entries
  for insert
  with check (profile_id = auth.uid());

drop policy if exists "self update admin_time_entries" on admin_time_entries;
create policy "self update admin_time_entries"
  on admin_time_entries
  for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists "owner all admin_time_breaks" on admin_time_breaks;
create policy "owner all admin_time_breaks"
  on admin_time_breaks
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "self read admin_time_breaks" on admin_time_breaks;
create policy "self read admin_time_breaks"
  on admin_time_breaks
  for select
  using (
    exists (
      select 1
      from admin_time_entries e
      where e.id = admin_time_breaks.time_entry_id
        and e.profile_id = auth.uid()
    )
  );

drop policy if exists "self insert admin_time_breaks" on admin_time_breaks;
create policy "self insert admin_time_breaks"
  on admin_time_breaks
  for insert
  with check (
    exists (
      select 1
      from admin_time_entries e
      where e.id = admin_time_breaks.time_entry_id
        and e.profile_id = auth.uid()
    )
  );

drop policy if exists "self update admin_time_breaks" on admin_time_breaks;
create policy "self update admin_time_breaks"
  on admin_time_breaks
  for update
  using (
    exists (
      select 1
      from admin_time_entries e
      where e.id = admin_time_breaks.time_entry_id
        and e.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from admin_time_entries e
      where e.id = admin_time_breaks.time_entry_id
        and e.profile_id = auth.uid()
    )
  );

insert into admin_time_settings (profile_id, hourly_rate_cents, active)
select id, 0, true
from profiles
where is_admin = true
on conflict (profile_id) do nothing;

insert into admin_permissions (profile_id, section_key, can_view, can_edit)
select id, 'time_clock', true, lower(coalesce(email, '')) = 'zach@sobrew.com'
from profiles
where is_admin = true
on conflict (profile_id, section_key) do update
set can_view = true,
    can_edit = excluded.can_edit,
    updated_at = now();

notify pgrst, 'reload schema';
