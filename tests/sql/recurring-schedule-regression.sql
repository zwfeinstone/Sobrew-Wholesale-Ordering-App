-- Run after the recurring schedule migration. All fixtures roll back.
begin;

create temporary table schedule_regression (
 id integer, frequency text, status text, active boolean, created_at timestamptz,
 last_generated_at timestamptz, next_run_at timestamptz, amount_cents integer
);
create trigger schedule_regression_trigger before insert or update on schedule_regression
for each row execute function private.set_recurring_next_run();
do $test$
declare due timestamptz;
begin
 insert into schedule_regression values (1,'4_weeks','active',true,'2026-08-13 12:00:00+00',null,null,32000);
 select next_run_at into due from schedule_regression where id=1;
 if due <> '2026-09-10 12:00:00+00' then raise exception 'Initial date incorrect'; end if;
 update schedule_regression set frequency='4_weeks',amount_cents=36000 where id=1;
 if (select next_run_at from schedule_regression where id=1) <> due then raise exception 'Unchanged/quantity save moved overdue date'; end if;
 update schedule_regression set next_run_at='2026-09-21 12:00:00+00' where id=1;
 update schedule_regression set amount_cents=32000 where id=1;
 if (select next_run_at from schedule_regression where id=1) <> '2026-09-21 12:00:00+00' then raise exception 'Explicit reschedule not preserved'; end if;
 update schedule_regression set last_generated_at='2026-09-21 12:00:00+00' where id=1;
 if (select next_run_at from schedule_regression where id=1) <> '2026-10-19 12:00:00+00' then raise exception 'Generation cadence wrong'; end if;
 update schedule_regression set frequency='2_weeks' where id=1;
 if (select next_run_at from schedule_regression where id=1) <> private.next_recurring_run(now(),'2_weeks') then raise exception 'Frequency change not rebased'; end if;
 update schedule_regression set status='paused' where id=1;
 if (select next_run_at is not null or active from schedule_regression where id=1) then raise exception 'Pause failed'; end if;
 update schedule_regression set active=true where id=1;
 if (select next_run_at from schedule_regression where id=1) <> private.next_recurring_run(now(),'2_weeks') then raise exception 'Resume failed'; end if;
end;
$test$;

-- Customer writes cannot override the canonical timestamp directly.
grant select, update on schedule_regression to authenticated;
set local role authenticated;
update schedule_regression set next_run_at='2099-01-01 12:00:00+00' where id=1;
reset role;
do $test$
begin
 if (select next_run_at from schedule_regression where id=1) <> private.next_recurring_run(now(),'2_weeks')
 then raise exception 'Customer could override scheduler timestamp'; end if;
end;
$test$;
rollback;
