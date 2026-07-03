alter table production_runs
  add column if not exists status text not null default 'active',
  add column if not exists quantity_voided numeric(14, 4) not null default 0,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references profiles(id) on delete set null,
  add column if not exists void_reason text;

alter table production_runs
  drop constraint if exists production_runs_status_check,
  add constraint production_runs_status_check
    check (status in ('active', 'partially_voided', 'void'));

alter table production_runs
  drop constraint if exists production_runs_quantity_voided_check,
  add constraint production_runs_quantity_voided_check
    check (quantity_voided >= 0 and quantity_voided <= quantity_produced);

create index if not exists production_runs_status_idx on production_runs(status);

create table if not exists production_run_voids (
  id uuid primary key default gen_random_uuid(),
  production_run_id uuid not null references production_runs(id) on delete cascade,
  quantity_voided numeric(14, 4) not null check (quantity_voided > 0),
  reason text not null,
  voided_by uuid references profiles(id) on delete set null,
  voided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists production_run_voids_run_idx on production_run_voids(production_run_id);
create index if not exists production_run_voids_voided_at_idx on production_run_voids(voided_at desc);

alter table production_run_voids enable row level security;

drop policy if exists "admin read production_run_voids" on production_run_voids;
create policy "admin read production_run_voids"
  on production_run_voids
  for select
  using (is_admin());

drop policy if exists "owner all production_run_voids" on production_run_voids;
create policy "owner all production_run_voids"
  on production_run_voids
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

create or replace function public.void_inventory_production_run(
  p_production_run_id uuid,
  p_quantity_to_void numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run record;
  v_finished_lot record;
  v_movement record;
  v_void_id uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_quantity numeric := coalesce(p_quantity_to_void, 0);
  v_original_quantity numeric;
  v_already_voided numeric;
  v_remaining_unvoided numeric;
  v_ratio numeric;
  v_restore_quantity numeric;
  v_new_voided numeric;
  v_new_status text;
begin
  if not is_owner_admin() then
    raise exception 'Only superadmins can void production runs.';
  end if;

  if p_production_run_id is null then
    raise exception 'Production run is required.';
  end if;

  if v_quantity <= 0 then
    raise exception 'Void quantity must be greater than zero.';
  end if;

  if v_reason is null then
    raise exception 'Void reason is required.';
  end if;

  select *
    into v_run
    from production_runs
    where id = p_production_run_id
    for update;

  if not found then
    raise exception 'Production run not found.';
  end if;

  if coalesce(v_run.status, 'active') = 'void' then
    raise exception 'Production run is already voided.';
  end if;

  if v_run.finished_lot_id is null then
    raise exception 'Production run has no finished lot to void.';
  end if;

  v_original_quantity := coalesce(v_run.quantity_produced, 0);
  v_already_voided := coalesce(v_run.quantity_voided, 0);
  v_remaining_unvoided := greatest(v_original_quantity - v_already_voided, 0);

  if v_original_quantity <= 0 then
    raise exception 'Production run quantity is invalid.';
  end if;

  if v_quantity > v_remaining_unvoided then
    raise exception 'Void quantity exceeds unvoided production quantity.';
  end if;

  select *
    into v_finished_lot
    from inventory_lots
    where id = v_run.finished_lot_id
    for update;

  if not found then
    raise exception 'Finished lot was not found.';
  end if;

  if coalesce(v_finished_lot.quantity_remaining, 0) < v_quantity then
    raise exception 'Void quantity exceeds unused finished goods for this run.';
  end if;

  v_ratio := v_quantity / v_original_quantity;

  update inventory_lots
  set quantity_remaining = quantity_remaining - v_quantity
  where id = v_run.finished_lot_id;

  insert into inventory_movements (
    inventory_item_id,
    lot_id,
    movement_type,
    quantity_change,
    unit,
    unit_cost_cents,
    production_run_id,
    notes
  )
  values (
    v_finished_lot.inventory_item_id,
    v_finished_lot.id,
    'adjustment',
    -v_quantity,
    'each',
    coalesce(v_finished_lot.unit_cost_cents, 0),
    v_run.id,
    'Voided production run: ' || v_reason
  );

  for v_movement in
    select *
    from inventory_movements
    where production_run_id = v_run.id
      and movement_type = 'production_consume'
      and quantity_change < 0
      and lot_id is not null
    order by created_at asc, id asc
  loop
    v_restore_quantity := abs(v_movement.quantity_change) * v_ratio;
    if v_restore_quantity <= 0 then
      continue;
    end if;

    update inventory_lots
    set quantity_remaining = quantity_remaining + v_restore_quantity
    where id = v_movement.lot_id;

    insert into inventory_movements (
      inventory_item_id,
      lot_id,
      movement_type,
      quantity_change,
      unit,
      unit_cost_cents,
      production_run_id,
      notes
    )
    values (
      v_movement.inventory_item_id,
      v_movement.lot_id,
      'adjustment',
      v_restore_quantity,
      v_movement.unit,
      coalesce(v_movement.unit_cost_cents, 0),
      v_run.id,
      'Restored by production run void: ' || v_reason
    );
  end loop;

  v_new_voided := least(v_original_quantity, v_already_voided + v_quantity);
  v_new_status := case
    when v_original_quantity - v_new_voided <= 0.0001 then 'void'
    else 'partially_voided'
  end;

  insert into production_run_voids (
    production_run_id,
    quantity_voided,
    reason,
    voided_by
  )
  values (
    v_run.id,
    v_quantity,
    v_reason,
    auth.uid()
  )
  returning id into v_void_id;

  update production_runs
  set status = v_new_status,
      quantity_voided = v_new_voided,
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = v_reason
  where id = v_run.id;

  return v_void_id;
end;
$$;

notify pgrst, 'reload schema';
