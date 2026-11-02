// Isolated PostgreSQL regression checks. This script never connects to a live database.
// MATERIAL_FALLBACKS_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-product-material-fallbacks-db.mjs
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MATERIAL_FALLBACKS_PGLITE_MODULE;
if (!modulePath) throw new Error('Set MATERIAL_FALLBACKS_PGLITE_MODULE to an installed PGlite module.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const dir = new URL('../db/migrations/', import.meta.url);
const files = (await readdir(dir)).filter(name => /(?:^|_)product_material_fallbacks(?:\.draft)?\.sql$/.test(name));
assert.equal(files.length, 1, 'Expected one product material fallbacks migration');
const migration = await readFile(new URL(files[0], dir), 'utf8');
const load = name => readFile(new URL(name, dir), 'utf8');
const id = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const product = id(1), otherProduct = id(2), primary = id(10), fallback = id(11), other = id(12);
const recipe = id(20), admin = id(30), customer = id(31), inactiveAdmin = id(32);
const primaryLot = id(100), laterPrimaryLot = id(101), fallbackLot = id(102), otherLot = id(103);
let passed = 0;

async function actor(user = admin, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  await db.exec(`set role ${role}`);
}
async function reject(operation, match) {
  await db.exec('savepoint expected_failure');
  await assert.rejects(operation, match);
  await db.exec('rollback to savepoint expected_failure');
}
async function test(name, operation) {
  await actor();
  await db.exec('begin');
  try {
    await operation();
    passed++;
    console.log(`PASS ${name}`);
  } finally {
    await db.exec('rollback');
  }
}
const component = (item, used, expected = used, unit = 'each') => ({
  inventory_item_id: item, quantity_expected: expected, quantity_used: used, unit,
});
async function produce(components, target = product) {
  return (await db.query(`select public.record_inventory_production_run(
    $1, 10, 1, 'Regression run', 999, $2::jsonb, 20, 30, 40, 5, 480, 2, 3, 4, 11
  ) id`, [target, JSON.stringify(components)])).rows[0].id;
}
async function rows(sql, params = []) { return (await db.query(sql, params)).rows; }
async function stock(lot, quantity) {
  await db.query('update public.inventory_lots set quantity_remaining=$2 where id=$1', [lot, quantity]);
}
async function inputs(run) {
  return rows(`select inventory_item_id,quantity_expected::float8 expected,quantity_used::float8 used,cost_cents::float8 cost
    from public.production_run_inputs where production_run_id=$1 order by inventory_item_id`, [run]);
}
async function assertRun(run, materialCost) {
  const [row] = await rows(`select actual_unit_cost_cents::float8 cost,estimated_unit_cost_cents::float8 estimate,
    fixed_cost_cents::float8 fixed,actual_labor_cost_cents::float8 labor,expected_labor_cost_cents::float8 expected_labor,
    fixed_tape_cost_cents::float8 tape,fixed_shipping_label_cost_cents::float8 shipping,
    fixed_branding_label_cost_cents::float8 branding,fixed_other_cost_cents::float8 other,
    labor_minutes::float8 minutes,labor_rate_cents::float8 rate,waste_quantity::float8 waste,notes
    from public.production_runs where id=$1`, [run]);
  assert.deepEqual(row, { cost: (materialCost + 60) / 10, estimate: 999, fixed: 20, labor: 40,
    expected_labor: 30, tape: 2, shipping: 3, branding: 4, other: 11, minutes: 5, rate: 480, waste: 1, notes: 'Regression run' });
}

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    grant usage on schema auth, private to authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table public.profiles(id uuid primary key, is_admin boolean, is_active boolean,
      is_superadmin boolean, email text);
    create table public.products(id uuid primary key, name text, sku text);
    create table public.orders(id uuid primary key);
    create table public.order_items(id uuid primary key);
    insert into public.profiles values
      ('${admin}',true,true,true,'owner@example.test'),
      ('${customer}',false,true,false,'customer@example.test'),
      ('${inactiveAdmin}',true,false,false,'inactive@example.test');
    insert into public.products values ('${product}','Mapped product','MAPPED'),('${otherProduct}','Ordinary product','ORDINARY');
  `);
  const restock = await load('048_quick_restock_performance.sql');
  for (const name of ['private.is_admin', 'private.is_owner_admin', 'public.is_admin', 'public.is_owner_admin']) {
    const definition = restock.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\(\\)[\\s\\S]*?\\$function\\$;`));
    assert.ok(definition, `Missing existing authorization helper ${name}`);
    await db.exec(definition[0]);
  }
  // Real inventory schemas and real void procedure; avoid unrelated seed data.
  await db.exec((await load('016_inventory_phase1.sql')).split('insert into inventory_items (name, sku, item_type, base_unit, active)')[0]);
  await db.exec((await load('023_inventory_cogs_shipping_labor.sql')).split('drop function if exists public.record_inventory_production_run')[0]);
  await db.exec((await load('024_profitability_reporting.sql')).split('drop function if exists public.record_inventory_production_run')[0]);
  await db.exec(await load('043_production_run_voids.sql'));
  await db.exec(`grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
    insert into public.inventory_items(id,name,sku,item_type,base_unit,active) values
      ('${primary}','Roll stock','ROLL','material_supply','each',true),
      ('${fallback}','Old fraction bags','OLD','material_supply','each',true),
      ('${other}','Unmapped material','OTHER','material_supply','each',true);
    insert into public.product_recipes(id,product_id) values ('${recipe}','${product}');
    insert into public.product_recipe_components(recipe_id,inventory_item_id,quantity,unit,component_role)
      values ('${recipe}','${primary}',1,'each','fraction_bag');
    insert into public.inventory_lots(id,inventory_item_id,lot_code,quantity_received,quantity_remaining,unit_cost_cents,received_at) values
      ('${primaryLot}','${primary}','ROLL-OLD',100,100,6,'2026-01-01'),
      ('${laterPrimaryLot}','${primary}','ROLL-NEW',100,100,7,'2026-02-01'),
      ('${fallbackLot}','${fallback}','OLD',100,100,4,'2025-01-01'),
      ('${otherLot}','${other}','OTHER',100,100,9,'2026-01-01');
  `);
  await db.exec(migration);
  await actor();
  await db.query('insert into public.product_material_fallbacks values ($1,$2,$3)', [product, primary, fallback]);

  await test('full primary inventory uses only primary despite older fallback lot', async () => {
    const run = await produce([component(primary, 10)]);
    assert.deepEqual(await inputs(run), [{ inventory_item_id: primary, expected: 10, used: 10, cost: 60 }]);
    assert.deepEqual(await rows(`select lot_id,quantity_change::float8 quantity from public.inventory_movements
      where production_run_id=$1 and movement_type='production_consume'`, [run]), [{ lot_id: primaryLot, quantity: -10 }]);
    await assertRun(run, 60);
  });
  await test('mixed stock drains primary FIFO and preserves expected/used totals', async () => {
    await stock(primaryLot, 2); await stock(laterPrimaryLot, 3);
    const run = await produce([component(primary, 8, 10)]);
    assert.deepEqual(await inputs(run), [
      { inventory_item_id: primary, expected: 6.25, used: 5, cost: 33 },
      { inventory_item_id: fallback, expected: 3.75, used: 3, cost: 12 },
    ]);
    assert.equal((await rows('select count(*)::int count from public.inventory_movements where production_run_id=$1 and movement_type=\'production_consume\'', [run]))[0].count, 3);
    await assertRun(run, 45);
  });
  await test('depleted primary accepts old unsplit request and uses fallback', async () => {
    await stock(primaryLot, 0); await stock(laterPrimaryLot, 0);
    const run = await produce([component(primary, 10)]);
    assert.deepEqual(await inputs(run), [{ inventory_item_id: fallback, expected: 10, used: 10, cost: 40 }]);
  });
  await test('new split request is normalized again when preview stock changed', async () => {
    await stock(primaryLot, 2); await stock(laterPrimaryLot, 0);
    const run = await produce([component(primary, 7, 14), component(fallback, 3, 6)]);
    assert.deepEqual(await inputs(run), [
      { inventory_item_id: primary, expected: 4, used: 2, cost: 12 },
      { inventory_item_id: fallback, expected: 16, used: 8, cost: 32 },
    ]);
  });
  await test('fallback-only client request still uses available primary first', async () => {
    const run = await produce([component(fallback, 10)]);
    assert.deepEqual(await inputs(run), [{ inventory_item_id: primary, expected: 10, used: 10, cost: 60 }]);
  });
  await test('fractional legacy lot balances allocate only whole bags to each material', async () => {
    await stock(primaryLot, 2.5); await stock(laterPrimaryLot, 0); await stock(fallbackLot, 8.5);
    const run = await produce([component(primary, 10)]);
    assert.deepEqual(await inputs(run), [
      { inventory_item_id: primary, expected: 2, used: 2, cost: 12 },
      { inventory_item_id: fallback, expected: 8, used: 8, cost: 32 },
    ]);
    assert.equal((await rows('select quantity_remaining::float8 quantity from public.inventory_lots where id=$1', [primaryLot]))[0].quantity, 0.5);
  });
  await test('partial bag balances cannot combine into a usable bag across materials', async () => {
    await stock(primaryLot, 0.5); await stock(laterPrimaryLot, 0); await stock(fallbackLot, 0.5);
    await reject(() => produce([component(primary, 1)]), /Insufficient inventory/);
    await reject(() => produce([component(primary, 0.5)]), /Packaging usage must be a whole number in each units/);
  });
  for (const role of ['bag', 'box', 'filter_pack']) {
    await test(`${role} substitutions also require whole packages`, async () => {
      await db.query('update public.product_recipe_components set component_role=$2 where recipe_id=$1', [recipe, role]);
      await stock(primaryLot, 2.5); await stock(laterPrimaryLot, 0);
      const run = await produce([component(primary, 3)]);
      assert.deepEqual(await inputs(run), [
        { inventory_item_id: primary, expected: 2, used: 2, cost: 12 },
        { inventory_item_id: fallback, expected: 1, used: 1, cost: 4 },
      ]);
      await reject(() => produce([component(primary, 0.5)]), /Packaging usage must be a whole number in each units/);
    });
  }
  await test('non-packaging material substitutions preserve fractional usage', async () => {
    await db.query('update public.product_recipe_components set component_role=null where recipe_id=$1', [recipe]);
    await stock(primaryLot, 0.5); await stock(laterPrimaryLot, 0);
    const run = await produce([component(primary, 1.25)]);
    assert.deepEqual(await inputs(run), [
      { inventory_item_id: primary, expected: 0.5, used: 0.5, cost: 3 },
      { inventory_item_id: fallback, expected: 0.75, used: 0.75, cost: 3 },
    ]);
  });
  await test('overlapping fallback pairs fail without consuming shared inventory', async () => {
    await db.query(`insert into public.product_recipe_components(recipe_id,inventory_item_id,quantity,unit)
      values ($1,$2,1,'each')`, [recipe, other]);
    await db.query('insert into public.product_material_fallbacks values ($1,$2,$3)', [product, other, fallback]);
    const before = await rows('select id,quantity_remaining from public.inventory_lots order by id');
    await reject(() => produce([component(primary, 1), component(other, 1)]), /pairs must not overlap/);
    assert.deepEqual(await rows('select id,quantity_remaining from public.inventory_lots order by id'), before);
  });
  await test('combined shortage rolls back all inventory and output changes', async () => {
    await stock(primaryLot, 1); await stock(laterPrimaryLot, 0); await stock(fallbackLot, 2);
    const before = await rows('select id,quantity_remaining from public.inventory_lots order by id');
    await reject(() => produce([component(primary, 4), component(other, 5)]), /Insufficient inventory/);
    assert.deepEqual(await rows('select id,quantity_remaining from public.inventory_lots order by id'), before);
    assert.equal((await rows('select count(*)::int count from public.production_runs'))[0].count, 0);
    assert.equal((await rows('select count(*)::int count from public.inventory_movements'))[0].count, 0);
    assert.equal((await rows('select count(*)::int count from public.inventory_items where product_id is not null'))[0].count, 0);
  });
  await test('void restores actual primary/fallback lots after recipe mapping changed', async () => {
    await stock(primaryLot, 2); await stock(laterPrimaryLot, 3);
    const before = await rows('select id,quantity_remaining from public.inventory_lots order by id');
    const run = await produce([component(primary, 8)]);
    await db.query('delete from public.product_material_fallbacks where product_id=$1', [product]);
    await db.query('select public.void_inventory_production_run($1, 4, $2)', [run, 'Partial correction']);
    assert.equal((await rows('select quantity_remaining::float8 quantity from public.inventory_lots where id=$1', [fallbackLot]))[0].quantity, 98.2);
    await db.query('select public.void_inventory_production_run($1, 6, $2)', [run, 'Remaining correction']);
    assert.deepEqual(await rows('select id,quantity_remaining from public.inventory_lots where production_run_id is null order by id'), before);
    assert.deepEqual(await rows(`select inventory_item_id,lot_id,sum(quantity_change)::float8 quantity
      from public.inventory_movements where production_run_id=$1 and quantity_change>0 and movement_type='adjustment'
      group by inventory_item_id,lot_id order by lot_id`, [run]), [
      { inventory_item_id: primary, lot_id: primaryLot, quantity: 2 },
      { inventory_item_id: primary, lot_id: laterPrimaryLot, quantity: 3 },
      { inventory_item_id: fallback, lot_id: fallbackLot, quantity: 3 },
    ]);
    assert.equal((await rows('select status from public.production_runs where id=$1', [run]))[0].status, 'void');
  });
  await test('ordinary product keeps existing FIFO costs and input quantities', async () => {
    const run = await produce([component(other, 8, 10)], otherProduct);
    assert.deepEqual(await inputs(run), [{ inventory_item_id: other, expected: 10, used: 8, cost: 72 }]);
    await assertRun(run, 72);
  });
  await test('duplicate ordinary requests cannot overdraw stock', async () => {
    await reject(() => produce([component(other, 60), component(other, 60)], otherProduct), /Insufficient inventory/);
  });
  await test('zero actual usage preserves expected total without movements', async () => {
    const run = await produce([component(primary, 0, 10)]);
    assert.deepEqual(await inputs(run), [{ inventory_item_id: primary, expected: 10, used: 0, cost: 0 }]);
  });
  await test('primary outside current recipe never authorizes a stale fallback', async () => {
    await db.query('delete from public.product_recipe_components where recipe_id=$1', [recipe]);
    await stock(primaryLot, 0); await stock(laterPrimaryLot, 0);
    await reject(() => produce([component(primary, 1)]), /Insufficient inventory/);
  });
  for (const [field, value] of [['active', false], ['item_type', 'raw_coffee'], ['base_unit', 'lb']]) {
    await test(`fallback ${field} is validated at consumption`, async () => {
      await db.query(`update public.inventory_items set ${field}=$2 where id=$1`, [fallback, value]);
      await reject(() => produce([component(primary, 1)]), /active materials with the same base unit/);
    });
  }
  await test('mismatched requested units fail instead of guessing conversion', async () => {
    await reject(() => produce([component(primary, 1, 1, 'lb')]), /unit must match/);
  });
  await test('invalid, negative and nonfinite request quantities fail', async () => {
    await reject(() => produce([component(primary, -1), component(primary, 2)]), /finite and nonnegative/);
    await reject(() => produce([component(primary, 'NaN')]), /finite and nonnegative/);
    await reject(() => produce([component(primary, 1, 'Infinity')]), /finite and nonnegative/);
  });
  await test('fallback table rejects identical IDs, duplicate pairs and invalid references', async () => {
    await reject(() => db.query('insert into public.product_material_fallbacks values ($1,$2,$2)', [otherProduct, primary]), error => error.code === '23514');
    await reject(() => db.query('insert into public.product_material_fallbacks values ($1,$2,$3)', [product, primary, other]), error => error.code === '23505');
    await reject(() => db.query('insert into public.product_material_fallbacks values ($1,$2,$3)', [otherProduct, primary, id(999)]), error => error.code === '23503');
  });
  await test('customer and inactive admin cannot read/write fallbacks or record production', async () => {
    for (const user of [customer, inactiveAdmin, null]) {
      await actor(user);
      assert.equal((await rows('select * from public.product_material_fallbacks')).length, 0);
      await reject(() => db.query('insert into public.product_material_fallbacks values ($1,$2,$3)', [otherProduct, primary, fallback]), error => error.code === '42501');
      assert.equal((await rows('delete from public.product_material_fallbacks returning *')).length, 0);
      await reject(() => produce([component(primary, 1)]), /Only admins/);
    }
    await actor(null, 'anon');
    await reject(() => db.query('select * from public.product_material_fallbacks'), error => error.code === '42501');
    await reject(() => produce([component(primary, 1)]), error => error.code === '42501');
  });

  console.log(`Passed ${passed} isolated material fallback database scenarios. PGlite serializes queries; real concurrent sessions require PostgreSQL integration verification.`);
} finally {
  await db.close();
}
