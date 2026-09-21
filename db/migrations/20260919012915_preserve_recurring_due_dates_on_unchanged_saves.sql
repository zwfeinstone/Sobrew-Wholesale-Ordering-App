-- Keep the canonical due date stable for quantity edits and unchanged saves.
create or replace function private.set_recurring_next_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  schedule_days integer := private.recurring_days(new.frequency);
  anchor_at timestamptz;
  can_reschedule boolean := coalesce(auth.role() = 'service_role', false)
    or (session_user = 'postgres' and current_setting('role', true) in ('none', 'postgres'));
begin
  if schedule_days is null then
    raise exception 'Unsupported recurring frequency: %', new.frequency;
  end if;

  if tg_op = 'UPDATE'
    and new.status is not distinct from old.status
    and new.active is distinct from old.active then
    new.status := case when new.active then 'active' else 'paused' end;
  else
    new.active := new.status = 'active';
  end if;

  if new.status <> 'active' then
    new.next_run_at := null;
    return new;
  end if;

  if tg_op = 'INSERT' then
    anchor_at := coalesce(new.last_generated_at, new.created_at, now());
  elsif new.last_generated_at is distinct from old.last_generated_at then
    -- Generated orders advance from their scheduled occurrence, not run time.
    anchor_at := coalesce(new.last_generated_at, new.created_at, now());
  elsif can_reschedule and new.next_run_at is distinct from old.next_run_at
    and new.next_run_at is not null then
    -- Only trusted server/database operations can explicitly reschedule.
    return new;
  elsif new.frequency is distinct from old.frequency
    or new.status is distinct from old.status then
    anchor_at := now();
  elsif old.next_run_at is not null then
    -- Includes overdue dates: saving must not silently skip an occurrence.
    new.next_run_at := old.next_run_at;
    return new;
  else
    anchor_at := coalesce(new.last_generated_at, new.created_at, now());
  end if;

  new.next_run_at := private.next_recurring_run(anchor_at, new.frequency);
  return new;
end;
$function$;

notify pgrst, 'reload schema';
