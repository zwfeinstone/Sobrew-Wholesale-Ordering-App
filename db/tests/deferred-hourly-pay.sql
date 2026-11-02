-- Run after deferred_hourly_pay as a database administrator. All fixtures roll back.
begin;

create temporary table deferred_pay_test_people (
  person text primary key,
  id uuid not null default gen_random_uuid()
);
insert into deferred_pay_test_people (person)
values ('employee'), ('other'), ('payroll_manager'), ('superadmin'),
  ('inactive_employee'), ('inactive_manager'), ('nonadmin_manager');
grant select on deferred_pay_test_people to authenticated, service_role;

insert into auth.users (id, email)
select id, 'deferred-pay-test-' || id || '@example.invalid'
from deferred_pay_test_people;

update public.profiles p
set is_admin = t.person <> 'nonadmin_manager',
    is_active = t.person not in ('inactive_employee', 'inactive_manager'),
    is_superadmin = t.person = 'superadmin'
from deferred_pay_test_people t
where p.id = t.id;

insert into public.admin_permissions (profile_id, section_key, can_view, can_edit)
select id, 'payroll', true, false
from deferred_pay_test_people
where person in ('payroll_manager', 'inactive_manager', 'nonadmin_manager');

insert into public.admin_deferred_pay_plans
  (profile_id, label, start_date, end_date, payout_date, accrual_rate_cents, weekly_rate_cents)
select id, 'Deferred-pay regression', '2026-10-07', '2027-01-03', '2027-01-04', 500, 1500
from deferred_pay_test_people
where person in ('employee', 'other', 'inactive_employee');

do $$
declare
  employee_id uuid := (select id from deferred_pay_test_people where person = 'employee');
  invalid record;
begin
  if has_table_privilege('anon', 'public.admin_deferred_pay_plans', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_table_privilege('authenticated', 'public.admin_deferred_pay_plans', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or not has_table_privilege('authenticated', 'public.admin_deferred_pay_plans', 'SELECT')
    or not has_table_privilege('service_role', 'public.admin_deferred_pay_plans', 'INSERT')
    or not has_table_privilege('service_role', 'public.admin_deferred_pay_plans', 'UPDATE')
    or not has_table_privilege('service_role', 'public.admin_deferred_pay_plans', 'DELETE')
    or not exists (
      select 1 from pg_class
      where oid = 'public.admin_deferred_pay_plans'::regclass and relrowsecurity
    )
  then
    raise exception 'Deferred pay grants or RLS are incorrect';
  end if;

  for invalid in
    select * from (values
      ('reversed dates', date '2027-02-03', date '2027-02-02', date '2027-02-04', 500, 1500, null::timestamptz, null::integer),
      ('same-day payout', date '2027-02-01', date '2027-02-02', date '2027-02-02', 500, 1500, null::timestamptz, null::integer),
      ('early payout date', date '2027-02-01', date '2027-02-02', date '2027-02-01', 500, 1500, null::timestamptz, null::integer),
      ('zero accrual rate', date '2027-02-01', date '2027-02-02', date '2027-02-03', 0, 1500, null::timestamptz, null::integer),
      ('negative accrual rate', date '2027-02-01', date '2027-02-02', date '2027-02-03', -500, 1500, null::timestamptz, null::integer),
      ('zero weekly rate', date '2027-02-01', date '2027-02-02', date '2027-02-03', 500, 0, null::timestamptz, null::integer),
      ('negative weekly rate', date '2027-02-01', date '2027-02-02', date '2027-02-03', 500, -1500, null::timestamptz, null::integer),
      ('payment date only', date '2027-02-01', date '2027-02-02', date '2027-02-03', 500, 1500, timestamptz '2027-02-03 12:00Z', null::integer),
      ('payment amount only', date '2027-02-01', date '2027-02-02', date '2027-02-03', 500, 1500, null::timestamptz, 500),
      ('negative payment', date '2027-02-01', date '2027-02-02', date '2027-02-03', 500, 1500, timestamptz '2027-02-03 12:00Z', -1)
    ) as cases(label, start_date, end_date, payout_date, accrual_rate, weekly_rate, paid_at, paid_amount)
  loop
    begin
      insert into public.admin_deferred_pay_plans
        (profile_id, label, start_date, end_date, payout_date, accrual_rate_cents, weekly_rate_cents, paid_at, paid_amount_cents)
      values (employee_id, invalid.label, invalid.start_date, invalid.end_date, invalid.payout_date,
        invalid.accrual_rate, invalid.weekly_rate, invalid.paid_at, invalid.paid_amount);
      raise exception 'Invalid deferred-pay plan accepted: %', invalid.label;
    exception when check_violation then
      null;
    end;
  end loop;

  begin
    insert into public.admin_deferred_pay_plans
      (profile_id, label, start_date, end_date, payout_date, accrual_rate_cents, weekly_rate_cents)
    values (employee_id, 'Duplicate', '2026-10-07', '2027-01-03', '2027-01-04', 500, 1500);
    raise exception 'Duplicate deferred-pay period accepted';
  exception when unique_violation then
    null;
  end;

  begin
    delete from public.profiles where id = employee_id;
    raise exception 'Staff deletion must preserve the deferred-pay obligation';
  exception when foreign_key_violation then
    null;
  end;

  -- A recorded zero-dollar settlement is valid, but an unpaid plan has neither field.
  update public.admin_deferred_pay_plans
  set paid_at = '2027-01-04 12:00Z', paid_amount_cents = 0
  where profile_id = employee_id;
  update public.admin_deferred_pay_plans
  set paid_at = null, paid_amount_cents = null
  where profile_id = employee_id;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from deferred_pay_test_people where person = 'employee'), true);
do $$
begin
  if (select count(*) from public.admin_deferred_pay_plans) <> 1
    or not exists (select 1 from public.admin_deferred_pay_plans where profile_id = auth.uid())
  then
    raise exception 'Active staff must see only their own deferred-pay plans';
  end if;

  begin
    insert into public.admin_deferred_pay_plans
      (profile_id, label, start_date, end_date, payout_date, accrual_rate_cents, weekly_rate_cents)
    values (auth.uid(), 'Unauthorized', '2027-02-01', '2027-02-02', '2027-02-03', 500, 1500);
    raise exception 'Authenticated staff inserted a deferred-pay plan';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.admin_deferred_pay_plans set paid_at = now(), paid_amount_cents = 999;
    raise exception 'Authenticated staff changed a deferred-pay plan';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.admin_deferred_pay_plans;
    raise exception 'Authenticated staff deleted a deferred-pay plan';
  exception when insufficient_privilege then
    null;
  end;
end $$;

select set_config('request.jwt.claim.sub', (select id::text from deferred_pay_test_people where person = 'other'), true);
do $$
begin
  if (select count(*) from public.admin_deferred_pay_plans) <> 1
    or exists (select 1 from public.admin_deferred_pay_plans where profile_id <> auth.uid())
  then raise exception 'Another staff member can read someone else''s deferred-pay plans'; end if;
end $$;

select set_config('request.jwt.claim.sub', (select id::text from deferred_pay_test_people where person = 'payroll_manager'), true);
do $$
begin
  if (select count(*) from public.admin_deferred_pay_plans where label = 'Deferred-pay regression') <> 3
  then raise exception 'Payroll viewers must be able to read deferred-pay plans'; end if;
end $$;

select set_config('request.jwt.claim.sub', (select id::text from deferred_pay_test_people where person = 'superadmin'), true);
do $$
begin
  if (select count(*) from public.admin_deferred_pay_plans where label = 'Deferred-pay regression') <> 3
  then raise exception 'Superadmins must be able to read deferred-pay plans'; end if;
  begin
    update public.admin_deferred_pay_plans set weekly_rate_cents = 2000;
    raise exception 'Authenticated superadmin bypassed read-only plan grants';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', (select id::text from deferred_pay_test_people where person = 'inactive_employee'), true);
do $$
begin
  if exists (select 1 from public.admin_deferred_pay_plans)
  then raise exception 'Inactive employee can read deferred-pay plans'; end if;
end $$;

select set_config('request.jwt.claim.sub', (select id::text from deferred_pay_test_people where person = 'inactive_manager'), true);
do $$
begin
  if exists (select 1 from public.admin_deferred_pay_plans)
  then raise exception 'Inactive payroll manager can read deferred-pay plans'; end if;
end $$;

select set_config('request.jwt.claim.sub', (select id::text from deferred_pay_test_people where person = 'nonadmin_manager'), true);
do $$
begin
  if exists (select 1 from public.admin_deferred_pay_plans)
  then raise exception 'Non-admin payroll permission can read other staff plans'; end if;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform 1 from public.admin_deferred_pay_plans;
    raise exception 'Anonymous access exposed deferred-pay plans';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role service_role;
do $$
declare
  new_plan_id uuid;
begin
  insert into public.admin_deferred_pay_plans
    (profile_id, label, start_date, end_date, payout_date, accrual_rate_cents, weekly_rate_cents)
  select id, 'Service-role write test', '2027-02-01', '2027-02-01', '2027-02-02', 500, 1500
  from deferred_pay_test_people where person = 'employee'
  returning id into new_plan_id;

  update public.admin_deferred_pay_plans set paid_at = '2027-02-02 12:00Z', paid_amount_cents = 500
  where id = new_plan_id;
  if not exists (select 1 from public.admin_deferred_pay_plans where id = new_plan_id and paid_amount_cents = 500)
  then raise exception 'Service role cannot manage deferred-pay settlement'; end if;
  delete from public.admin_deferred_pay_plans where id = new_plan_id;
end $$;
reset role;

rollback;
select 'PASS: deferred hourly pay constraints, preservation, employee isolation, active staff, payroll managers, superadmins, read-only API access, anonymous denial, and service-role management' as result;
