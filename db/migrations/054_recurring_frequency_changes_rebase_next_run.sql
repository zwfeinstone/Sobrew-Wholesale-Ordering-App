create or replace function private.set_recurring_next_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  schedule_days integer := private.recurring_days(new.frequency);
  anchor_at timestamptz;
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
    -- Generation advances the schedule from the occurrence that was just
    -- created, preserving the established recurring cadence.
    anchor_at := coalesce(new.last_generated_at, new.created_at, now());
  else
    -- Manual schedule saves, including frequency changes, start a fresh full
    -- interval from today instead of creating an immediate catch-up order.
    anchor_at := now();
  end if;

  -- Never trust a caller-supplied schedule timestamp. Every active schedule is
  -- derived from its canonical frequency and generation anchor on every write.
  new.next_run_at := private.next_recurring_run(anchor_at, new.frequency);

  return new;
end;
$function$;

notify pgrst, 'reload schema';
