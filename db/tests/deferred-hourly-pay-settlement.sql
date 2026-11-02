-- Run after deferred_hourly_pay_settlement as a database administrator.
-- Real RPC authorization, interval math, settlement, and bank linking; all fixtures roll back.
begin;

create temporary table deferred_settlement_test_people (person text primary key, id uuid default gen_random_uuid());
insert into deferred_settlement_test_people(person)
values ('payroll_only'), ('accounting_only'), ('both'), ('inactive'), ('staff1'), ('staff2'), ('staff3'), ('overnight'), ('empty'), ('future');
grant select on deferred_settlement_test_people to anon, authenticated, service_role;
insert into auth.users(id,email)
select id, 'deferred-settlement-test-' || id || '@example.invalid' from deferred_settlement_test_people;
update public.profiles p set is_admin = true, is_active = t.person <> 'inactive'
from deferred_settlement_test_people t where t.id = p.id;
insert into public.admin_permissions(profile_id,section_key,can_view,can_edit)
select id, section, true, true from deferred_settlement_test_people
cross join (values ('payroll'), ('accounting')) s(section)
where person in ('both','inactive') or (person = 'payroll_only' and section = 'payroll')
  or (person = 'accounting_only' and section = 'accounting');

create temporary table deferred_settlement_test_plans (purpose text primary key, id uuid default gen_random_uuid());
insert into deferred_settlement_test_plans(purpose) values ('staff1'), ('staff2'), ('staff3'), ('overnight'), ('empty'), ('future');
grant select on deferred_settlement_test_plans to anon, authenticated, service_role;
insert into public.admin_deferred_pay_plans(id,profile_id,label,start_date,end_date,payout_date,accrual_rate_cents,weekly_rate_cents)
select plan.id, person.id, 'Settlement regression ' || plan.purpose,
  (now() at time zone 'America/Chicago')::date + case when plan.purpose = 'future' then 1 else -3 end,
  (now() at time zone 'America/Chicago')::date + case when plan.purpose = 'future' then 2 else -2 end,
  (now() at time zone 'America/Chicago')::date + case when plan.purpose = 'future' then 3 else -1 end,
  500, 1500
from deferred_settlement_test_plans plan join deferred_settlement_test_people person on person.person = plan.purpose;

insert into public.admin_time_entries(profile_id,clock_in_at,clock_out_at,status)
select id, (((now() at time zone 'America/Chicago')::date - 3) + time '08:00') at time zone 'America/Chicago',
  (((now() at time zone 'America/Chicago')::date - 3) + time '16:00') at time zone 'America/Chicago', 'approved'
from deferred_settlement_test_people where person in ('staff1','staff2','staff3');
-- Overlapping breaks must subtract 45 minutes once, leaving 7.25h = $36.25.
insert into public.admin_time_breaks(time_entry_id,break_start_at,break_end_at,status)
select e.id, e.clock_in_at + offsets.start_offset, e.clock_in_at + offsets.end_offset, 'completed'
from public.admin_time_entries e join deferred_settlement_test_people p on p.id = e.profile_id
cross join (values (interval '4 hours', interval '4 hours 30 minutes'),
  (interval '4 hours 15 minutes', interval '4 hours 45 minutes')) offsets(start_offset,end_offset)
where p.person in ('staff1','staff2','staff3');

-- The final evening crosses the payout boundary; only 22:00–midnight counts,
-- and the break crossing midnight removes only its 23:30–midnight portion.
insert into public.admin_time_entries(profile_id,clock_in_at,clock_out_at,status)
select profile_id, (end_date + time '22:00') at time zone 'America/Chicago',
  ((end_date + 1) + time '02:00') at time zone 'America/Chicago', 'approved'
from public.admin_deferred_pay_plans where id = (select id from deferred_settlement_test_plans where purpose = 'overnight');
insert into public.admin_time_breaks(time_entry_id,break_start_at,break_end_at,status)
select e.id, e.clock_in_at + interval '90 minutes', e.clock_in_at + interval '150 minutes', 'completed'
from public.admin_time_entries e join deferred_settlement_test_people p on p.id = e.profile_id where p.person = 'overnight';

create temporary table deferred_settlement_test_bank (purpose text primary key, id uuid default gen_random_uuid());
insert into deferred_settlement_test_bank(purpose)
values ('good'),('good2'),('rollback'),('wrong_amount'),('wrong_date'),('credit_card'),('excluded'),('matched'),('split');
grant select on deferred_settlement_test_bank to service_role;
insert into public.accounting_transactions(id,transaction_date,amount_cents,account_type,status,category_id,original_description,transaction_fingerprint)
select t.id,
  (now() at time zone 'America/Chicago')::date + case when t.purpose = 'wrong_date' then -2 else -1 end,
  case when t.purpose = 'wrong_amount' then 3600 else 3625 end,
  case when t.purpose = 'credit_card' then 'credit_card' else 'bank' end,
  case when t.purpose = 'excluded' then 'excluded' else 'categorized' end,
  (select id from public.accounting_categories where name = 'Payroll Wages & Taxes'),
  'Deferred settlement regression ' || t.purpose, 'deferred-test-' || t.id
from deferred_settlement_test_bank t;
insert into public.accounting_transaction_matches(transaction_id,target_type,match_status)
select id,'payroll','suggested' from deferred_settlement_test_bank where purpose = 'matched';
insert into public.accounting_transaction_splits(transaction_id,amount_cents)
select id,3625 from deferred_settlement_test_bank where purpose = 'split';

create function pg_temp.expect_deferred_settlement_error(
  actor_id uuid, plan_id uuid, amount_cents integer, paid_date date, bank_id uuid, link_only boolean, expected_error text
) returns void language plpgsql as $$
begin
  begin
    perform public.settle_deferred_hourly_pay(actor_id,plan_id,amount_cents,paid_date,null,bank_id,link_only);
  exception when others then
    if position(expected_error in sqlerrm) > 0 then return; end if;
    raise exception 'Expected %, received %', expected_error, sqlerrm;
  end;
  raise exception 'Expected rejection % but settlement succeeded', expected_error;
end $$;

do $$
begin
  if has_function_privilege('anon','public.settle_deferred_hourly_pay(uuid,uuid,integer,date,text,uuid,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.settle_deferred_hourly_pay(uuid,uuid,integer,date,text,uuid,boolean)','EXECUTE')
    or not has_function_privilege('service_role','public.settle_deferred_hourly_pay(uuid,uuid,integer,date,text,uuid,boolean)','EXECUTE')
  then raise exception 'Settlement RPC must be service-role-only'; end if;
end $$;

set local role authenticated;
select pg_temp.expect_deferred_settlement_error(null,null,1,null,null,false,'permission denied for function settle_deferred_hourly_pay');
reset role;
set local role anon;
select pg_temp.expect_deferred_settlement_error(null,null,1,null,null,false,'permission denied for function settle_deferred_hourly_pay');
reset role;

-- Failure after both updates must roll back the plan and bank change together.
create function pg_temp.reject_deferred_audit_for_test() returns trigger language plpgsql as $$
begin
  if current_setting('test.deferred_audit_failure',true) = 'yes' and new.action = 'deferred_pay_marked_paid' then
    raise exception 'test_deferred_audit_failure';
  end if;
  return new;
end $$;
create trigger reject_deferred_audit_for_test before insert on public.admin_audit_log
for each row execute function pg_temp.reject_deferred_audit_for_test();

set local role service_role;
do $$
declare
  actor uuid := (select id from deferred_settlement_test_people where person = 'both');
  payroll_actor uuid := (select id from deferred_settlement_test_people where person = 'payroll_only');
  plan1 uuid := (select id from deferred_settlement_test_plans where purpose = 'staff1');
  plan2 uuid := (select id from deferred_settlement_test_plans where purpose = 'staff2');
  plan3 uuid := (select id from deferred_settlement_test_plans where purpose = 'staff3');
  overnight_plan uuid := (select id from deferred_settlement_test_plans where purpose = 'overnight');
  bank1 uuid := (select id from deferred_settlement_test_bank where purpose = 'good');
  bank2 uuid := (select id from deferred_settlement_test_bank where purpose = 'good2');
  rollback_bank uuid := (select id from deferred_settlement_test_bank where purpose = 'rollback');
  pay_date date := (now() at time zone 'America/Chicago')::date - 1;
  trial record;
  result jsonb;
  temporary_entry uuid;
  temporary_break uuid;
  before_bank jsonb;
  before_plan jsonb;
begin
  for trial in select id from deferred_settlement_test_people where person in ('accounting_only','inactive','staff1') loop
    perform pg_temp.expect_deferred_settlement_error(trial.id,plan1,3625,pay_date,null,false,'deferred_pay_permission');
  end loop;
  perform pg_temp.expect_deferred_settlement_error(payroll_actor,plan1,3625,pay_date,bank1,false,'deferred_pay_accounting_permission');
  perform pg_temp.expect_deferred_settlement_error(actor,plan1,0,pay_date,null,false,'deferred_pay_invalid');
  perform pg_temp.expect_deferred_settlement_error(actor,(select id from deferred_settlement_test_plans where purpose = 'future'),3625,pay_date,null,false,'deferred_pay_not_due');
  perform pg_temp.expect_deferred_settlement_error(actor,plan1,3625,pay_date-1,null,false,'deferred_pay_invalid_date');
  perform pg_temp.expect_deferred_settlement_error(actor,plan1,3625,pay_date+2,null,false,'deferred_pay_invalid_date');
  perform pg_temp.expect_deferred_settlement_error(actor,plan1,3600,pay_date,null,false,'deferred_pay_amount_changed');
  perform pg_temp.expect_deferred_settlement_error(actor,(select id from deferred_settlement_test_plans where purpose = 'empty'),3625,pay_date,null,false,'deferred_pay_no_balance');
  perform pg_temp.expect_deferred_settlement_error(actor,plan1,3625,null,bank1,true,'deferred_pay_not_paid');

  insert into public.admin_time_entries(profile_id,clock_in_at,status)
  select profile_id, (start_date::timestamp + time '10:00') at time zone 'America/Chicago', 'open'
  from public.admin_deferred_pay_plans where id = plan1 returning id into temporary_entry;
  perform pg_temp.expect_deferred_settlement_error(actor,plan1,3625,pay_date,null,false,'deferred_pay_open_shifts');
  delete from public.admin_time_entries where id = temporary_entry;
  insert into public.admin_time_breaks(time_entry_id,break_start_at,status)
  select e.id, e.clock_in_at + interval '1 hour', 'open' from public.admin_time_entries e
  join public.admin_deferred_pay_plans p on p.profile_id = e.profile_id where p.id = plan1 returning id into temporary_break;
  perform pg_temp.expect_deferred_settlement_error(actor,plan1,3625,pay_date,null,false,'deferred_pay_open_shifts');
  delete from public.admin_time_breaks where id = temporary_break;

  for trial in select id from deferred_settlement_test_bank where purpose in ('wrong_amount','wrong_date','credit_card','excluded') loop
    perform pg_temp.expect_deferred_settlement_error(actor,plan1,3625,pay_date,trial.id,false,'deferred_pay_bank_mismatch');
  end loop;
  for trial in select id from deferred_settlement_test_bank where purpose in ('matched','split') loop
    perform pg_temp.expect_deferred_settlement_error(actor,plan1,3625,pay_date,trial.id,false,'deferred_pay_bank_in_use');
  end loop;

  result := public.settle_deferred_hourly_pay(payroll_actor,plan1,3625,pay_date,'Paid by transfer',null,false);
  if (result->>'paid_amount_cents')::integer <> 3625 or not exists (
    select 1 from public.admin_deferred_pay_plans where id = plan1 and paid_amount_cents = 3625
      and paid_eligible_milliseconds = 26100000 and paid_by = payroll_actor
      and payment_notes = 'Paid by transfer' and accounting_transaction_id is null
      and (paid_at at time zone 'America/Chicago')::date = pay_date
  ) then raise exception 'Manual full payment did not preserve amount, actual date, hours, actor, or note'; end if;
  perform pg_temp.expect_deferred_settlement_error(actor,plan1,3625,pay_date,null,false,'deferred_pay_already_paid');

  select to_jsonb(p) into before_plan from public.admin_deferred_pay_plans p where id = plan1;
  result := public.settle_deferred_hourly_pay(actor,plan1,3625,null,null,bank1,true);
  if (result->>'accounting_transaction_id')::uuid <> bank1 or not exists (
    select 1 from public.accounting_transactions t join public.accounting_categories c on c.id = t.category_id
    where t.id = bank1 and t.amount_cents = 3625 and t.transaction_date = pay_date
      and c.name = 'Deferred Payroll / Compensation Payable' and c.pnl_section = 'none'
  ) then raise exception 'Later bank import was not linked and reclassified as liability'; end if;
  if (select to_jsonb(p) - 'accounting_transaction_id' - 'updated_at' from public.admin_deferred_pay_plans p where id = plan1)
    <> before_plan - 'accounting_transaction_id' - 'updated_at'
  then raise exception 'Bank linking changed recorded payment history'; end if;
  perform public.settle_deferred_hourly_pay(actor,plan1,3625,null,null,bank1,true);
  if (select count(*) from public.admin_audit_log where target_profile_id = (select profile_id from public.admin_deferred_pay_plans where id = plan1)
    and action in ('deferred_pay_marked_paid','deferred_pay_bank_linked')) <> 2
  then raise exception 'Payment or link retry created duplicate audit effects'; end if;
  perform pg_temp.expect_deferred_settlement_error(actor,plan1,3625,null,bank2,true,'deferred_pay_already_linked');
  perform pg_temp.expect_deferred_settlement_error(actor,plan2,3625,pay_date,bank1,false,'deferred_pay_bank_in_use');

  result := public.settle_deferred_hourly_pay(actor,plan2,3625,pay_date,null,bank2,false);
  if (result->>'accounting_transaction_id')::uuid <> bank2 then raise exception 'Payment and bank link were not committed together'; end if;

  perform public.settle_deferred_hourly_pay(actor,overnight_plan,750,pay_date,null,null,false);
  if not exists (select 1 from public.admin_deferred_pay_plans where id = overnight_plan
    and paid_amount_cents = 750 and paid_eligible_milliseconds = 5400000)
  then raise exception 'Final-day overnight shift or break was not clipped at the accrual boundary'; end if;

  select to_jsonb(t) into before_bank from public.accounting_transactions t where id = rollback_bank;
  select to_jsonb(p) into before_plan from public.admin_deferred_pay_plans p where id = plan3;
  perform set_config('test.deferred_audit_failure','yes',true);
  perform pg_temp.expect_deferred_settlement_error(actor,plan3,3625,pay_date,rollback_bank,false,'test_deferred_audit_failure');
  perform set_config('test.deferred_audit_failure','no',true);
  if (select to_jsonb(t) from public.accounting_transactions t where id = rollback_bank) <> before_bank
    or (select to_jsonb(p) from public.admin_deferred_pay_plans p where id = plan3) <> before_plan
  then raise exception 'Failed payment left a partial plan or bank update'; end if;
end $$;
reset role;

rollback;
select 'PASS: service-only atomic settlement, live actor permissions, full accrual and break union, dates, open shifts, stale totals, single payment, bank compatibility, later linking, liability reclassification, idempotent linking, audit and rollback' as result;
