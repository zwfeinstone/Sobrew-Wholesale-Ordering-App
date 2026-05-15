alter table if exists sales_prospecting_blocks
  add column if not exists calls_text integer not null default 0 check (calls_text >= 0);

alter table if exists sales_prospecting_blocks
  add column if not exists samples_from_text_reply integer not null default 0 check (samples_from_text_reply >= 0);

create table if not exists sales_prospecting_followup_blocks (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null,
  block_label text,
  followups_email integer not null default 0 check (followups_email >= 0),
  followups_phone integer not null default 0 check (followups_phone >= 0),
  followups_text integer not null default 0 check (followups_text >= 0),
  deals_closed_email integer not null default 0 check (deals_closed_email >= 0),
  deals_closed_phone integer not null default 0 check (deals_closed_phone >= 0),
  deals_closed_text integer not null default 0 check (deals_closed_text >= 0),
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists sales_prospecting_blocks enable row level security;
alter table sales_prospecting_followup_blocks enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sales_prospecting_blocks'
      and policyname = 'admin all sales_prospecting_blocks'
  ) then
    execute 'create policy "admin all sales_prospecting_blocks" on sales_prospecting_blocks for all using (is_admin()) with check (is_admin())';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sales_prospecting_followup_blocks'
      and policyname = 'admin all sales_prospecting_followup_blocks'
  ) then
    execute 'create policy "admin all sales_prospecting_followup_blocks" on sales_prospecting_followup_blocks for all using (is_admin()) with check (is_admin())';
  end if;
end;
$$;

create index if not exists sales_prospecting_blocks_activity_date_idx
  on sales_prospecting_blocks(activity_date desc);

create index if not exists sales_prospecting_blocks_created_by_idx
  on sales_prospecting_blocks(created_by);

create index if not exists sales_prospecting_followup_blocks_activity_date_idx
  on sales_prospecting_followup_blocks(activity_date desc);

create index if not exists sales_prospecting_followup_blocks_created_by_idx
  on sales_prospecting_followup_blocks(created_by);

notify pgrst, 'reload schema';
