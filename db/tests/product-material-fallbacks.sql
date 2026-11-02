-- Run as a database administrator after installing product_material_fallbacks.
-- Every product, material, lot, and user below has a new random ID. No existing
-- business records are changed, and the entire fixture transaction rolls back.
begin;

create temporary table material_fallback_test_people (
  person text primary key,
  id uuid not null default gen_random_uuid()
);
insert into material_fallback_test_people (person)
values ('admin'), ('nonadmin'), ('inactive_admin');
grant select on material_fallback_test_people to authenticated, anon;

insert into auth.users (id, email)
select id, 'material-fallback-test-' || id || '@example.invalid'
from material_fallback_test_people;
update public.profiles p
set is_admin = t.person <> 'nonadmin',
    is_active = t.person <> 'inactive_admin',
    is_superadmin = t.person = 'admin'
from material_fallback_test_people t
where p.id = t.id;

create temporary table material_fallback_test_cases (
  label text primary key,
  primary_stock numeric not null,
  fallback_stock numeric not null,
  quantity_used numeric not null,
  quantity_expected numeric not null,
  expected_primary_used numeric,
  expected_fallback_used numeric,
  expected_cost_cents numeric,
  expected_error text,
  product_id uuid not null default gen_random_uuid(),
  recipe_id uuid not null default gen_random_uuid(),
  primary_id uuid not null default gen_random_uuid(),
  fallback_id uuid not null default gen_random_uuid(),
  primary_lot_id uuid not null default gen_random_uuid(),
  newer_primary_lot_id uuid not null default gen_random_uuid(),
  fallback_lot_id uuid not null default gen_random_uuid(),
  run_id uuid
);
insert into material_fallback_test_cases
  (label, primary_stock, fallback_stock, quantity_used, quantity_expected,
   expected_primary_used, expected_fallback_used, expected_cost_cents, expected_error)
values
  ('primary only', 5, 10, 3, 3, 3, 0, 10.47, null),
  ('split', 2, 10, 5, 5, 2, 3, 33.98, null),
  ('fallback only', 0, 10, 3, 3, 0, 3, 27, null),
  ('fractional primary leftovers', 1.5, 10, 3, 2, 1, 2, 21.49, null),
  ('fractional fallback leftovers', 5, 1.5, 6, 6, 5, 1, 26.45, null),
  ('insufficient combined stock', 1, 1, 3, 3, null, null, null, 'Insufficient inventory%'),
  ('unusable partial bags', 1.5, 1.5, 3, 3, null, null, null, 'Insufficient inventory%'),
  ('FIFO actual cost', 5, 10, 3, 3, 3, 0, 11.48, null),
  ('stale secondary payload', 5, 10, 3, 3, 3, 0, 10.47, null),
  ('reallocate client split', 2, 10, 5, 5, 2, 3, 33.98, null),
  ('fractional bag request', 5, 10, 2.5, 2.5, null, null, null, 'Packaging usage must be a whole number%');
grant select, update on material_fallback_test_cases to authenticated;
grant select on material_fallback_test_cases to anon;

insert into public.products (id, name, sku, category, active)
select product_id, 'Material fallback test: ' || label,
  'TEST-FALLBACK-' || product_id, 'filter_packs', true
from material_fallback_test_cases;
insert into public.inventory_items (id, name, sku, item_type, base_unit, active)
select primary_id, 'Test filter pack roll stock', 'TEST-PRIMARY-' || primary_id,
  'material_supply', 'each', true from material_fallback_test_cases
union all
select fallback_id, 'Test filter pack bags', 'TEST-FALLBACK-' || fallback_id,
  'material_supply', 'each', true from material_fallback_test_cases;
insert into public.product_recipes (id, product_id, output_qty, waste_percent)
select recipe_id, product_id, 1, 0 from material_fallback_test_cases;
insert into public.product_recipe_components
  (recipe_id, inventory_item_id, quantity, unit, component_role)
select recipe_id, primary_id, quantity_expected, 'each', 'filter_pack'
from material_fallback_test_cases;
insert into public.product_material_fallbacks
  (product_id, primary_inventory_item_id, fallback_inventory_item_id)
select product_id, primary_id, fallback_id from material_fallback_test_cases;

insert into public.inventory_lots
  (id, inventory_item_id, lot_code, source_type, quantity_received,
   quantity_remaining, unit_cost_cents, received_at)
select primary_lot_id, primary_id, 'TEST-PRIMARY-' || primary_lot_id, 'adjustment',
  case when label = 'FIFO actual cost' then 2 else primary_stock end,
  case when label = 'FIFO actual cost' then 2 else primary_stock end,
  3.49, now() - interval '2 days'
from material_fallback_test_cases where primary_stock > 0
union all
select newer_primary_lot_id, primary_id, 'TEST-NEWER-' || newer_primary_lot_id,
  'adjustment', primary_stock - 2, primary_stock - 2, 4.5, now() - interval '1 day'
from material_fallback_test_cases where label = 'FIFO actual cost'
union all
select fallback_lot_id, fallback_id, 'TEST-FALLBACK-' || fallback_lot_id,
  'adjustment', fallback_stock, fallback_stock, 9, now() - interval '3 days'
from material_fallback_test_cases where fallback_stock > 0;

do $$
declare
  production_function regprocedure := 'public.record_inventory_production_run(uuid,numeric,numeric,text,numeric,jsonb,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric)'::regprocedure;
begin
  if has_function_privilege('anon', production_function, 'EXECUTE')
    or not has_function_privilege('authenticated', production_function, 'EXECUTE')
    or has_table_privilege('anon', 'public.product_material_fallbacks', 'SELECT,INSERT,UPDATE,DELETE')
    or not exists (
      select 1 from pg_class
      where oid = 'public.product_material_fallbacks'::regclass and relrowsecurity
    )
  then
    raise exception 'Material fallback grants or RLS are incorrect';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',
  (select id::text from material_fallback_test_people where person = 'admin'), true);
do $$
declare
  fixture record;
  requested jsonb;
  created_run uuid;
  finished_item uuid;
  primary_used numeric;
  fallback_used numeric;
  actual_cost numeric;
begin
  if not public.is_admin() then raise exception 'Admin fixture was not initialized'; end if;
  for fixture in select * from material_fallback_test_cases order by label
  loop
    -- Most callers submit only the recipe primary. Also verify that the
    -- database restores priority when a client submits stale or split inputs.
    requested := jsonb_build_array(jsonb_build_object(
      'inventory_item_id', case when fixture.label = 'stale secondary payload'
        then fixture.fallback_id else fixture.primary_id end,
      'quantity_expected', fixture.quantity_expected,
      'quantity_used', fixture.quantity_used, 'unit', 'each'));
    if fixture.label = 'reallocate client split' then
      requested := jsonb_build_array(
        jsonb_build_object('inventory_item_id', fixture.primary_id,
          'quantity_expected', 1, 'quantity_used', 1, 'unit', 'each'),
        jsonb_build_object('inventory_item_id', fixture.fallback_id,
          'quantity_expected', 4, 'quantity_used', 4, 'unit', 'each'));
    end if;

    if fixture.expected_error is not null then
      begin
        perform public.record_inventory_production_run(
          fixture.product_id, 1, 0, 'Isolated fallback regression', 0, requested);
        raise exception 'Invalid production run accepted: %', fixture.label;
      exception when others then
        if sqlerrm not like fixture.expected_error then raise; end if;
      end;
      if exists (select 1 from public.production_runs where product_id = fixture.product_id)
        or exists (select 1 from public.inventory_items where product_id = fixture.product_id)
        or exists (select 1 from public.inventory_movements
          where inventory_item_id in (fixture.primary_id, fixture.fallback_id))
        or (select coalesce(sum(quantity_remaining), 0) from public.inventory_lots
          where inventory_item_id = fixture.primary_id) <> fixture.primary_stock
        or (select coalesce(sum(quantity_remaining), 0) from public.inventory_lots
          where inventory_item_id = fixture.fallback_id) <> fixture.fallback_stock
      then raise exception 'Rejected run changed inventory: %', fixture.label; end if;
      continue;
    end if;

    created_run := public.record_inventory_production_run(
      fixture.product_id, 1, 0, 'Isolated fallback regression', 0, requested);
    update material_fallback_test_cases set run_id = created_run where label = fixture.label;
    select coalesce(sum(quantity_used) filter (where inventory_item_id = fixture.primary_id), 0),
           coalesce(sum(quantity_used) filter (where inventory_item_id = fixture.fallback_id), 0),
           coalesce(sum(cost_cents), 0)
      into primary_used, fallback_used, actual_cost
      from public.production_run_inputs where production_run_id = created_run;
    if primary_used <> fixture.expected_primary_used
      or fallback_used <> fixture.expected_fallback_used
      or actual_cost <> fixture.expected_cost_cents
      or (select sum(quantity_expected) from public.production_run_inputs
        where production_run_id = created_run) <> fixture.quantity_expected
      or exists (select 1 from public.production_run_inputs
        where production_run_id = created_run and (quantity_used <> trunc(quantity_used) or unit <> 'each'))
    then raise exception 'Wrong input allocation or cost for %: primary %, fallback %, cost %',
      fixture.label, primary_used, fallback_used, actual_cost;
    end if;

    if (select coalesce(sum(quantity_remaining), 0) from public.inventory_lots
        where inventory_item_id = fixture.primary_id) <> fixture.primary_stock - primary_used
      or (select coalesce(sum(quantity_remaining), 0) from public.inventory_lots
        where inventory_item_id = fixture.fallback_id) <> fixture.fallback_stock - fallback_used
    then raise exception 'Wrong remaining inventory for %', fixture.label; end if;

    if (select -coalesce(sum(quantity_change), 0) from public.inventory_movements
        where production_run_id = created_run and movement_type = 'production_consume') <> fixture.quantity_used
      or (select -coalesce(sum(quantity_change * unit_cost_cents), 0) from public.inventory_movements
        where production_run_id = created_run and movement_type = 'production_consume') <> fixture.expected_cost_cents
      or exists (
        select 1 from public.inventory_movements m
        left join public.inventory_lots l on l.id = m.lot_id
        where m.production_run_id = created_run and m.movement_type = 'production_consume'
          and (l.id is null or l.inventory_item_id <> m.inventory_item_id
            or m.unit_cost_cents <> l.unit_cost_cents or m.unit <> 'each'
            or m.inventory_item_id not in (fixture.primary_id, fixture.fallback_id))
      )
    then raise exception 'Consumption provenance or FIFO cost is incorrect for %', fixture.label; end if;

    select id into strict finished_item from public.inventory_items where product_id = fixture.product_id;
    if not exists (
      select 1 from public.production_runs r
      join public.inventory_lots l on l.id = r.finished_lot_id
      join public.inventory_movements m on m.lot_id = l.id
      where r.id = created_run and r.actual_unit_cost_cents = fixture.expected_cost_cents
        and l.inventory_item_id = finished_item and l.production_run_id = r.id
        and l.quantity_received = 1 and l.quantity_remaining = 1
        and l.unit_cost_cents = fixture.expected_cost_cents
        and m.production_run_id = r.id and m.movement_type = 'production_output'
        and m.quantity_change = 1 and m.unit_cost_cents = fixture.expected_cost_cents
    ) then raise exception 'Finished-good cost or output provenance is incorrect for %', fixture.label; end if;
  end loop;
end $$;

-- RLS and the SECURITY DEFINER entry point must both reject non-admins and
-- inactive admins even though authenticated users have function execution.
do $$
declare
  test_person record;
  fixture record;
  affected integer;
begin
  select * into strict fixture from material_fallback_test_cases where label = 'primary only';
  for test_person in select * from material_fallback_test_people t where t.person <> 'admin'
  loop
    perform set_config('request.jwt.claim.sub', test_person.id::text, true);
    if exists (select 1 from public.product_material_fallbacks
      where product_id = fixture.product_id)
    then raise exception 'Unauthorized fallback read: %', test_person.person; end if;
    begin
      insert into public.product_material_fallbacks
        (product_id, primary_inventory_item_id, fallback_inventory_item_id)
      values (fixture.product_id, fixture.fallback_id, fixture.primary_id);
      raise exception 'Unauthorized fallback insert: %', test_person.person;
    exception when insufficient_privilege then null;
    end;
    delete from public.product_material_fallbacks where product_id = fixture.product_id;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Unauthorized fallback delete: %', test_person.person; end if;
    begin
      perform public.record_inventory_production_run(fixture.product_id, 1, 0, '', 0,
        jsonb_build_array(jsonb_build_object('inventory_item_id', fixture.primary_id,
          'quantity_expected', 1, 'quantity_used', 1, 'unit', 'each')));
      raise exception 'Unauthorized production run: %', test_person.person;
    exception when raise_exception then
      if sqlerrm <> 'Only admins can record production runs.' then raise; end if;
    end;
  end loop;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
declare
  fixture record;
begin
  select * into strict fixture from material_fallback_test_cases where label = 'primary only';
  begin
    perform 1 from public.product_material_fallbacks where product_id = fixture.product_id;
    raise exception 'Anonymous fallback read was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_inventory_production_run(fixture.product_id, 1, 0, '', 0, '[]'::jsonb);
    raise exception 'Anonymous production run was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
begin
  if (select count(*) from public.production_runs r
      join material_fallback_test_cases t on t.product_id = r.product_id)
      <> (select count(*) from material_fallback_test_cases where expected_error is null)
    or (select count(*) from public.product_material_fallbacks f
      join material_fallback_test_cases t on t.product_id = f.product_id)
      <> (select count(*) from material_fallback_test_cases)
  then raise exception 'Failed or unauthorized requests left unexpected changes'; end if;
end $$;
select 'Product material fallback regression checks passed; all fixtures roll back.' as result;
rollback;
