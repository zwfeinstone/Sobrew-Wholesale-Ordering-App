-- Run after preserve_anonymous_payroll_history. All fixtures roll back.
begin;

do $$
declare
  staff_id uuid := gen_random_uuid();
  entry_id uuid := gen_random_uuid();
  break_id uuid := gen_random_uuid();
  bonus_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email)
  values (staff_id, 'account-removal-test-' || staff_id || '@example.invalid');

  insert into public.admin_time_entries
    (id, profile_id, clock_in_at, clock_out_at, hourly_rate_cents_snapshot, status, work_type)
  values (entry_id, staff_id, '2026-01-05 14:00Z', '2026-01-05 16:00Z', 2000, 'locked', 'production');

  insert into public.admin_time_breaks
    (id, time_entry_id, break_start_at, break_end_at, status, created_by)
  values (break_id, entry_id, '2026-01-05 15:00Z', '2026-01-05 15:15Z', 'completed', staff_id);

  insert into public.admin_weekly_sales_spiffs
    (id, profile_id, week_start_date, week_end_date, amount_cents)
  values (bonus_id, staff_id, '2026-01-05', '2026-01-11', 3300);

  delete from auth.users where id = staff_id;

  if exists (select 1 from public.profiles where id = staff_id)
    or not exists (
      select 1 from public.admin_time_entries
      where id = entry_id and profile_id is null and hourly_rate_cents_snapshot = 2000
        and clock_out_at - clock_in_at = interval '2 hours' and status = 'locked'
    )
    or not exists (
      select 1 from public.admin_time_breaks
      where id = break_id and time_entry_id = entry_id and created_by is null
        and break_end_at - break_start_at = interval '15 minutes'
    )
    or not exists (
      select 1 from public.admin_weekly_sales_spiffs
      where id = bonus_id and profile_id is null and amount_cents = 3300
    )
  then
    raise exception 'Deleting a staff account must preserve anonymous payroll history';
  end if;
end $$;

rollback;
