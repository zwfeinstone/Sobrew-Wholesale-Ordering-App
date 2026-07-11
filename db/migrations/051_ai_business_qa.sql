begin;

create table if not exists public.admin_ai_business_qa (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null,
  question text not null check (char_length(btrim(question)) > 0),
  answer_markdown text not null check (char_length(btrim(answer_markdown)) > 0),
  input_summary_json jsonb not null default '{}'::jsonb,
  model text not null,
  prompt_version text not null,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists admin_ai_business_qa_active_generated_idx
  on public.admin_ai_business_qa(generated_at desc)
  where archived_at is null;

create index if not exists admin_ai_business_qa_archived_generated_idx
  on public.admin_ai_business_qa(archived_at desc, generated_at desc)
  where archived_at is not null;

create index if not exists admin_ai_business_qa_generated_by_idx
  on public.admin_ai_business_qa(generated_by);

alter table public.admin_ai_business_qa enable row level security;

drop policy if exists "profitability admins read ai business qa" on public.admin_ai_business_qa;
create policy "profitability admins read ai business qa"
  on public.admin_ai_business_qa
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles profile
      left join public.admin_permissions permission
        on permission.profile_id = profile.id
        and permission.section_key = 'reports_profitability'
      where profile.id = (select auth.uid())
        and profile.is_admin = true
        and coalesce(profile.is_active, true) = true
        and (
          public.is_owner_admin()
          or coalesce(permission.can_view, false)
          or coalesce(permission.can_edit, false)
        )
    )
  );

drop policy if exists "profitability admins insert ai business qa" on public.admin_ai_business_qa;
create policy "profitability admins insert ai business qa"
  on public.admin_ai_business_qa
  for insert
  to authenticated
  with check (
    generated_by = (select auth.uid())
    and exists (
      select 1
      from public.profiles profile
      left join public.admin_permissions permission
        on permission.profile_id = profile.id
        and permission.section_key = 'reports_profitability'
      where profile.id = (select auth.uid())
        and profile.is_admin = true
        and coalesce(profile.is_active, true) = true
        and (
          public.is_owner_admin()
          or coalesce(permission.can_view, false)
          or coalesce(permission.can_edit, false)
        )
    )
  );

drop policy if exists "profitability admins archive ai business qa" on public.admin_ai_business_qa;
create policy "profitability admins archive ai business qa"
  on public.admin_ai_business_qa
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles profile
      left join public.admin_permissions permission
        on permission.profile_id = profile.id
        and permission.section_key = 'reports_profitability'
      where profile.id = (select auth.uid())
        and profile.is_admin = true
        and coalesce(profile.is_active, true) = true
        and (
          public.is_owner_admin()
          or coalesce(permission.can_view, false)
          or coalesce(permission.can_edit, false)
        )
    )
  )
  with check (
    exists (
      select 1
      from public.profiles profile
      left join public.admin_permissions permission
        on permission.profile_id = profile.id
        and permission.section_key = 'reports_profitability'
      where profile.id = (select auth.uid())
        and profile.is_admin = true
        and coalesce(profile.is_active, true) = true
        and (
          public.is_owner_admin()
          or coalesce(permission.can_view, false)
          or coalesce(permission.can_edit, false)
        )
    )
  );

notify pgrst, 'reload schema';

commit;
