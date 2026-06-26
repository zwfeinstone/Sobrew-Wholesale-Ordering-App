create table if not exists cron_run_log (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  invoked_at timestamptz not null default now(),
  completed_at timestamptz,
  request_method text,
  user_agent text,
  cron_schedule text,
  force_run boolean not null default false,
  active_recurring_count integer not null default 0 check (active_recurring_count >= 0),
  due_recurring_count integer not null default 0 check (due_recurring_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  status text not null default 'success' check (status in ('success', 'error')),
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cron_run_log_job_invoked_idx
  on cron_run_log(job_name, invoked_at desc);

create index if not exists cron_run_log_status_idx
  on cron_run_log(status);

alter table cron_run_log enable row level security;

drop policy if exists "admin read cron_run_log" on cron_run_log;
create policy "admin read cron_run_log"
  on cron_run_log
  for select
  using (is_admin());

notify pgrst, 'reload schema';
