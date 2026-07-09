create table if not exists prospecting_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  source text,
  created_by uuid references profiles(id) on delete set null,
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists prospecting_imports (
  id uuid primary key default gen_random_uuid(),
  list_id uuid references prospecting_lists(id) on delete set null,
  file_name text,
  status text not null default 'completed' check (status in ('completed', 'completed_with_errors', 'failed')),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  error_summary text,
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists prospecting_leads (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  company_name_key text not null,
  phone text,
  phone_key text not null default '',
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  postal_code text,
  country text,
  company_website text,
  company_email text,
  assigned_profile_id uuid references profiles(id) on delete set null,
  stage text not null default 'new' check (stage in ('new', 'working', 'follow_up', 'interested', 'sample_requested', 'not_a_fit', 'lost', 'converted')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  source text,
  do_not_contact boolean not null default false,
  next_follow_up_at date,
  last_activity_at timestamptz,
  last_result text,
  hubspot_status text not null default 'not_queued' check (hubspot_status in ('not_queued', 'queued', 'exported', 'skipped')),
  hubspot_exported_at timestamptz,
  hubspot_exported_by uuid references profiles(id) on delete set null,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_name_key, phone_key)
);

create table if not exists prospecting_contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references prospecting_leads(id) on delete cascade,
  full_name text,
  title text,
  email text,
  phone text,
  is_primary boolean not null default false,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists prospecting_list_leads (
  list_id uuid not null references prospecting_lists(id) on delete cascade,
  lead_id uuid not null references prospecting_leads(id) on delete cascade,
  import_id uuid references prospecting_imports(id) on delete set null,
  added_by uuid references profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (list_id, lead_id)
);

create table if not exists prospecting_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references prospecting_leads(id) on delete cascade,
  contact_id uuid references prospecting_contacts(id) on delete set null,
  activity_type text not null check (activity_type in ('call', 'email', 'note', 'stage_change', 'assignment', 'enrichment', 'hubspot_export')),
  result text,
  body text,
  previous_stage text,
  next_stage text,
  next_follow_up_at date,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists prospecting_hubspot_queue (
  lead_id uuid primary key references prospecting_leads(id) on delete cascade,
  queued_stage text not null check (queued_stage in ('interested', 'sample_requested')),
  status text not null default 'queued' check (status in ('queued', 'exported', 'skipped')),
  queued_at timestamptz not null default now(),
  queued_by uuid references profiles(id) on delete set null,
  exported_at timestamptz,
  exported_by uuid references profiles(id) on delete set null,
  notes text
);

create table if not exists prospecting_duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references prospecting_imports(id) on delete cascade,
  existing_lead_id uuid references prospecting_leads(id) on delete set null,
  list_id uuid references prospecting_lists(id) on delete set null,
  row_number integer not null check (row_number > 0),
  company_name text,
  phone text,
  reason text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_by uuid references profiles(id) on delete set null,
  resolved_at timestamptz
);

create index if not exists prospecting_lists_created_at_idx on prospecting_lists(created_at desc);
create index if not exists prospecting_imports_created_at_idx on prospecting_imports(created_at desc);
create index if not exists prospecting_imports_list_idx on prospecting_imports(list_id);
create index if not exists prospecting_leads_assigned_stage_idx on prospecting_leads(assigned_profile_id, stage);
create index if not exists prospecting_leads_stage_idx on prospecting_leads(stage);
create index if not exists prospecting_leads_follow_up_idx on prospecting_leads(next_follow_up_at);
create index if not exists prospecting_leads_company_key_idx on prospecting_leads(company_name_key);
create index if not exists prospecting_leads_hubspot_status_idx on prospecting_leads(hubspot_status);
create index if not exists prospecting_contacts_lead_idx on prospecting_contacts(lead_id);
create index if not exists prospecting_list_leads_lead_idx on prospecting_list_leads(lead_id);
create index if not exists prospecting_activities_lead_created_idx on prospecting_activities(lead_id, created_at desc);
create index if not exists prospecting_duplicate_reviews_import_idx on prospecting_duplicate_reviews(import_id);
create index if not exists prospecting_duplicate_reviews_status_idx on prospecting_duplicate_reviews(status);

alter table prospecting_lists enable row level security;
alter table prospecting_imports enable row level security;
alter table prospecting_leads enable row level security;
alter table prospecting_contacts enable row level security;
alter table prospecting_list_leads enable row level security;
alter table prospecting_activities enable row level security;
alter table prospecting_hubspot_queue enable row level security;
alter table prospecting_duplicate_reviews enable row level security;

drop policy if exists "owner all prospecting_lists" on prospecting_lists;
create policy "owner all prospecting_lists"
  on prospecting_lists
  for all
  to authenticated
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "assigned read prospecting_lists" on prospecting_lists;
create policy "assigned read prospecting_lists"
  on prospecting_lists
  for select
  to authenticated
  using (
    exists (
      select 1
      from prospecting_list_leads pll
      join prospecting_leads pl on pl.id = pll.lead_id
      where pll.list_id = prospecting_lists.id
        and pl.assigned_profile_id = (select auth.uid())
    )
  );

drop policy if exists "owner all prospecting_imports" on prospecting_imports;
create policy "owner all prospecting_imports"
  on prospecting_imports
  for all
  to authenticated
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "owner all prospecting_leads" on prospecting_leads;
create policy "owner all prospecting_leads"
  on prospecting_leads
  for all
  to authenticated
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "assigned read prospecting_leads" on prospecting_leads;
create policy "assigned read prospecting_leads"
  on prospecting_leads
  for select
  to authenticated
  using (assigned_profile_id = (select auth.uid()));

drop policy if exists "assigned update prospecting_leads" on prospecting_leads;
create policy "assigned update prospecting_leads"
  on prospecting_leads
  for update
  to authenticated
  using (assigned_profile_id = (select auth.uid()))
  with check (assigned_profile_id = (select auth.uid()));

drop policy if exists "owner all prospecting_contacts" on prospecting_contacts;
create policy "owner all prospecting_contacts"
  on prospecting_contacts
  for all
  to authenticated
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "assigned read prospecting_contacts" on prospecting_contacts;
create policy "assigned read prospecting_contacts"
  on prospecting_contacts
  for select
  to authenticated
  using (
    exists (
      select 1 from prospecting_leads pl
      where pl.id = prospecting_contacts.lead_id
        and pl.assigned_profile_id = (select auth.uid())
    )
  );

drop policy if exists "assigned insert prospecting_contacts" on prospecting_contacts;
create policy "assigned insert prospecting_contacts"
  on prospecting_contacts
  for insert
  to authenticated
  with check (
    exists (
      select 1 from prospecting_leads pl
      where pl.id = prospecting_contacts.lead_id
        and pl.assigned_profile_id = (select auth.uid())
    )
  );

drop policy if exists "assigned update prospecting_contacts" on prospecting_contacts;
create policy "assigned update prospecting_contacts"
  on prospecting_contacts
  for update
  to authenticated
  using (
    exists (
      select 1 from prospecting_leads pl
      where pl.id = prospecting_contacts.lead_id
        and pl.assigned_profile_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from prospecting_leads pl
      where pl.id = prospecting_contacts.lead_id
        and pl.assigned_profile_id = (select auth.uid())
    )
  );

drop policy if exists "assigned delete prospecting_contacts" on prospecting_contacts;
create policy "assigned delete prospecting_contacts"
  on prospecting_contacts
  for delete
  to authenticated
  using (
    exists (
      select 1 from prospecting_leads pl
      where pl.id = prospecting_contacts.lead_id
        and pl.assigned_profile_id = (select auth.uid())
    )
  );

drop policy if exists "owner all prospecting_list_leads" on prospecting_list_leads;
create policy "owner all prospecting_list_leads"
  on prospecting_list_leads
  for all
  to authenticated
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "assigned read prospecting_list_leads" on prospecting_list_leads;
create policy "assigned read prospecting_list_leads"
  on prospecting_list_leads
  for select
  to authenticated
  using (
    exists (
      select 1 from prospecting_leads pl
      where pl.id = prospecting_list_leads.lead_id
        and pl.assigned_profile_id = (select auth.uid())
    )
  );

drop policy if exists "owner all prospecting_activities" on prospecting_activities;
create policy "owner all prospecting_activities"
  on prospecting_activities
  for all
  to authenticated
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "assigned read prospecting_activities" on prospecting_activities;
create policy "assigned read prospecting_activities"
  on prospecting_activities
  for select
  to authenticated
  using (
    exists (
      select 1 from prospecting_leads pl
      where pl.id = prospecting_activities.lead_id
        and pl.assigned_profile_id = (select auth.uid())
    )
  );

drop policy if exists "assigned insert prospecting_activities" on prospecting_activities;
create policy "assigned insert prospecting_activities"
  on prospecting_activities
  for insert
  to authenticated
  with check (
    exists (
      select 1 from prospecting_leads pl
      where pl.id = prospecting_activities.lead_id
        and pl.assigned_profile_id = (select auth.uid())
    )
  );

drop policy if exists "owner all prospecting_hubspot_queue" on prospecting_hubspot_queue;
create policy "owner all prospecting_hubspot_queue"
  on prospecting_hubspot_queue
  for all
  to authenticated
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "assigned read prospecting_hubspot_queue" on prospecting_hubspot_queue;
create policy "assigned read prospecting_hubspot_queue"
  on prospecting_hubspot_queue
  for select
  to authenticated
  using (
    exists (
      select 1 from prospecting_leads pl
      where pl.id = prospecting_hubspot_queue.lead_id
        and pl.assigned_profile_id = (select auth.uid())
    )
  );

drop policy if exists "assigned insert prospecting_hubspot_queue" on prospecting_hubspot_queue;
create policy "assigned insert prospecting_hubspot_queue"
  on prospecting_hubspot_queue
  for insert
  to authenticated
  with check (
    exists (
      select 1 from prospecting_leads pl
      where pl.id = prospecting_hubspot_queue.lead_id
        and pl.assigned_profile_id = (select auth.uid())
    )
  );

drop policy if exists "assigned update prospecting_hubspot_queue" on prospecting_hubspot_queue;
create policy "assigned update prospecting_hubspot_queue"
  on prospecting_hubspot_queue
  for update
  to authenticated
  using (
    exists (
      select 1 from prospecting_leads pl
      where pl.id = prospecting_hubspot_queue.lead_id
        and pl.assigned_profile_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from prospecting_leads pl
      where pl.id = prospecting_hubspot_queue.lead_id
        and pl.assigned_profile_id = (select auth.uid())
    )
  );

drop policy if exists "assigned delete prospecting_hubspot_queue" on prospecting_hubspot_queue;
create policy "assigned delete prospecting_hubspot_queue"
  on prospecting_hubspot_queue
  for delete
  to authenticated
  using (
    exists (
      select 1 from prospecting_leads pl
      where pl.id = prospecting_hubspot_queue.lead_id
        and pl.assigned_profile_id = (select auth.uid())
    )
  );

drop policy if exists "owner all prospecting_duplicate_reviews" on prospecting_duplicate_reviews;
create policy "owner all prospecting_duplicate_reviews"
  on prospecting_duplicate_reviews
  for all
  to authenticated
  using (is_owner_admin())
  with check (is_owner_admin());

notify pgrst, 'reload schema';
