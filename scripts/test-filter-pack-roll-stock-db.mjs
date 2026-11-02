// Isolated PostgreSQL regression checks. This script never connects to a live database.
// MATERIAL_FALLBACKS_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-filter-pack-roll-stock-db.mjs
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MATERIAL_FALLBACKS_PGLITE_MODULE;
if (!modulePath) throw new Error('Set MATERIAL_FALLBACKS_PGLITE_MODULE to an installed PGlite module.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const directory = new URL('../db/migrations/', import.meta.url);
const files = await readdir(directory);
const load = name => readFile(new URL(name, directory), 'utf8');
async function migrationBySuffix(suffix) {
  const matches = files.filter(name => name.endsWith(suffix));
  assert.equal(matches.length, 1, `Expected one ${suffix} migration`);
  return load(matches[0]);
}
const migration = await migrationBySuffix('_filter_pack_roll_stock_inventory.sql');
const fallbackMigration = await migrationBySuffix('_product_material_fallbacks.sql');
const id = number => `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const products = [1, 2, 3, 4].map(id);
const recipes = [21, 22, 23, 24].map(id);
const ordinaryProduct = id(5), ordinaryRecipe = id(25), admin = id(90);
const oldBag = id(10), coffee = id(11), carton = id(12), alternateCarton = id(13);
const oldLot = id(30), primarySku = 'MAT-BAG-FILTER-PACK-ROLL-STOCK';
const expectedNotes = 'Starting inventory: 5,882 filter-pack roll-stock bag equivalents at 3.49 cents ($0.0349) each, requested 2026-10-12.';
let passed = 0;

async function rows(sql, params = []) { return (await db.query(sql, params)).rows; }
async function primaryItem() {
  return (await rows('select * from public.inventory_items where sku=$1', [primarySku]))[0];
}
async function snapshot() {
  const tables = ['products', 'inventory_items', 'inventory_lots', 'inventory_adjustments', 'inventory_movements',
    'product_recipes', 'product_recipe_components', 'product_material_fallbacks', 'production_runs', 'production_run_inputs'];
  return Object.fromEntries(await Promise.all(tables.map(async table => [table,
    await rows(`select * from public.${table} order by ${table === 'product_material_fallbacks' ? 'product_id, primary_inventory_item_id' : 'id'}`),
  ])));
}
async function seedPrimary() {
  return (await rows(`insert into public.inventory_items(name,sku,description,item_type,base_unit,active)
    values ('Filter Pack Bag - Roll Stock',$1,'Filter-pack roll stock tracked in individual bag equivalents.','material_supply','each',true)
    returning id`, [primarySku]))[0].id;
}
async function resetFixture() {
  await db.exec('truncate public.products, public.inventory_items cascade');
  await db.exec(`
    insert into public.inventory_items(id,name,sku,item_type,base_unit,active) values
      ('${oldBag}','Filter Pack Bag','MAT-BAG-FILTER-PACK','material_supply','each',true),
      ('${coffee}','Roasted coffee','RAW-COFFEE','raw_coffee','lb',true),
      ('${carton}','Case carton','MAT-BOX-CASE','material_supply','each',true),
      ('${alternateCarton}','Other carton','MAT-BOX-OTHER','material_supply','each',true);
    insert into public.inventory_lots(id,inventory_item_id,lot_code,quantity_received,quantity_remaining,unit_cost_cents,received_at) values
      ('${oldLot}','${oldBag}','OLD-BAGS',500,321,12,'2026-01-01'),
      ('${id(31)}','${coffee}','COFFEE',500,500,400,'2026-01-01'),
      ('${id(32)}','${carton}','CARTONS',500,500,50,'2026-01-01');
    insert into public.inventory_movements(inventory_item_id,lot_id,movement_type,quantity_change,unit,unit_cost_cents,notes)
      values ('${oldBag}','${oldLot}','receipt',500,'each',12,'Existing bag history');
    insert into public.products(id,name,sku,category,active) values
      ('${ordinaryProduct}','Other coffee','OTHER','whole_bean',true);
    insert into public.product_recipes(id,product_id,output_qty,notes) values
      ('${ordinaryRecipe}','${ordinaryProduct}',1,'Leave this recipe alone');
    insert into public.product_recipe_components(id,recipe_id,inventory_item_id,quantity,unit,component_role,sort_order,notes) values
      ('${id(150)}','${ordinaryRecipe}','${oldBag}',7,'each','filter_pack',30,'Unrelated bag component');
    insert into public.product_material_fallbacks(product_id,primary_inventory_item_id,fallback_inventory_item_id)
      values ('${ordinaryProduct}','${carton}','${alternateCarton}');
  `);
  for (let index = 0; index < products.length; index++) {
    await db.query(`insert into public.products(id,name,sku,category,active) values ($1,$2,$3,'filter_packs',$4)`,
      [products[index], `Filter pack ${index + 1}`, `FILTER-${index + 1}`, index !== 3]);
    await db.query(`insert into public.product_recipes(id,product_id,output_qty,waste_percent,labor_minutes,labor_rate_cents,notes)
      values ($1,$2,1,5,10,1500,$3)`, [recipes[index], products[index], `Preserve recipe ${index + 1}`]);
    for (const [offset, item, quantity, unit, role] of [[0, coffee, 5, 'lb', 'raw_coffee'], [1, oldBag, 40, 'each', 'filter_pack'], [2, carton, 1, 'each', 'box']]) {
      await db.query(`insert into public.product_recipe_components(id,recipe_id,inventory_item_id,quantity,unit,component_role,sort_order,notes)
        values ($1,$2,$3,$4,$5,$6,$7,$8)`, [id(100 + index * 10 + offset), recipes[index], item, quantity, unit, role, offset * 10, `Preserve ${role}`]);
    }
  }
}
async function test(name, operation) {
  await resetFixture();
  await operation();
  passed++;
  console.log(`PASS ${name}`);
}
async function rejectsAtomically(match) {
  const before = await snapshot();
  await assert.rejects(() => db.exec(migration), match);
  // The migration's BEGIN remains aborted after its DO block raises.
  await db.exec('rollback');
  assert.deepEqual(await snapshot(), before, 'Rejected migration must preserve all inventory, recipe, and production rows');
}

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    create table public.profiles(id uuid primary key,is_admin boolean,is_active boolean,is_superadmin boolean,email text);
    create table public.products(id uuid primary key,name text,sku text,category text,active boolean);
    create table public.orders(id uuid primary key);
    create table public.order_items(id uuid primary key);
    insert into public.profiles values ('${admin}',true,true,true,'owner@example.test');
  `);
  const restock = await load('048_quick_restock_performance.sql');
  for (const name of ['private.is_admin', 'private.is_owner_admin', 'public.is_admin', 'public.is_owner_admin']) {
    const definition = restock.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\(\\)[\\s\\S]*?\\$function\\$;`));
    assert.ok(definition, `Missing existing authorization helper ${name}`);
    await db.exec(definition[0]);
  }
  // Use the real inventory schemas, omitting only unrelated catalog seeds and old RPC versions.
  await db.exec((await load('016_inventory_phase1.sql')).split('insert into inventory_items (name, sku, item_type, base_unit, active)')[0]);
  await db.exec((await load('023_inventory_cogs_shipping_labor.sql')).split('drop function if exists public.record_inventory_production_run')[0]);
  await db.exec((await load('024_profitability_reporting.sql')).split('drop function if exists public.record_inventory_production_run')[0]);
  await db.exec(fallbackMigration);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);

  await test('first application creates the exact starting inventory and all four primary/fallback recipes', async () => {
    const before = await snapshot();
    await db.exec(migration);
    const primary = await primaryItem();
    assert.ok(primary);
    assert.deepEqual({ name: primary.name, description: primary.description, item_type: primary.item_type, base_unit: primary.base_unit, active: primary.active },
      { name: 'Filter Pack Bag - Roll Stock', description: 'Filter-pack roll stock tracked in individual bag equivalents.', item_type: 'material_supply', base_unit: 'each', active: true });
    const lots = await rows(`select id,lot_code,source_type,quantity_received::float8 received,quantity_remaining::float8 remaining,
      unit_cost_cents::float8 cost,notes from public.inventory_lots where inventory_item_id=$1`, [primary.id]);
    assert.equal(lots.length, 1);
    assert.match(lots[0].lot_code, /^ADJ-20261012-BAG-FILTER-PAC-[0-9A-F]{6}$/);
    assert.deepEqual({ ...lots[0], id: undefined, lot_code: undefined },
      { id: undefined, lot_code: undefined, source_type: 'adjustment', received: 5882, remaining: 5882, cost: 3.49, notes: expectedNotes });
    assert.deepEqual(await rows(`select lot_id,adjustment_type,quantity_change::float8 quantity,unit,unit_cost_cents::float8 cost,notes
      from public.inventory_adjustments where inventory_item_id=$1`, [primary.id]),
    [{ lot_id: lots[0].id, adjustment_type: 'starting_count', quantity: 5882, unit: 'each', cost: 3.49, notes: expectedNotes }]);
    assert.deepEqual(await rows(`select lot_id,movement_type,quantity_change::float8 quantity,unit,unit_cost_cents::float8 cost,notes
      from public.inventory_movements where inventory_item_id=$1`, [primary.id]),
    [{ lot_id: lots[0].id, movement_type: 'adjustment', quantity: 5882, unit: 'each', cost: 3.49, notes: expectedNotes }]);
    const after = await snapshot();
    assert.deepEqual(after.product_recipe_components, before.product_recipe_components.map(component =>
      recipes.includes(component.recipe_id) && component.component_role === 'filter_pack'
        ? { ...component, inventory_item_id: primary.id } : component));
    assert.deepEqual(after.product_material_fallbacks, [
      ...products.map(product_id => ({ product_id, primary_inventory_item_id: primary.id, fallback_inventory_item_id: oldBag })),
      ...before.product_material_fallbacks,
    ]);
    for (const table of ['products', 'product_recipes', 'production_runs', 'production_run_inputs']) assert.deepEqual(after[table], before[table]);
    for (const table of ['inventory_items', 'inventory_lots', 'inventory_adjustments', 'inventory_movements']) {
      assert.deepEqual(after[table].filter(row => (table === 'inventory_items' ? row.id : row.inventory_item_id) !== primary.id), before[table]);
    }
  });
  await test('reapplying does not duplicate or reset starting inventory and mappings', async () => {
    await db.exec(migration);
    const before = await snapshot();
    await db.exec(migration);
    assert.deepEqual(await snapshot(), before);
  });
  await test('reapplying after real production preserves consumed stock and its provenance', async () => {
    await db.exec(migration);
    const primary = await primaryItem();
    const components = [[primary.id, 40, 'each'], [coffee, 5, 'lb'], [carton, 1, 'each']].map(([inventory_item_id, quantity, unit]) =>
      ({ inventory_item_id, quantity_expected: quantity, quantity_used: quantity, unit }));
    await db.query(`select public.record_inventory_production_run($1,1,0,'Isolated regression',0,$2::jsonb)`, [products[0], JSON.stringify(components)]);
    assert.deepEqual(await rows('select quantity_remaining::float8 remaining from public.inventory_lots where inventory_item_id=$1', [primary.id]), [{ remaining: 5842 }]);
    assert.deepEqual(await rows(`select quantity_used::float8 used,cost_cents::float8 cost from public.production_run_inputs where inventory_item_id=$1`, [primary.id]), [{ used: 40, cost: 139.6 }]);
    const before = await snapshot();
    await db.exec(migration);
    assert.deepEqual(await snapshot(), before);
  });
  for (const [name, sql] of [
    ['changed bag quantity', `update public.product_recipe_components set quantity=39 where id='${id(101)}'`],
    ['changed bag unit', `update public.product_recipe_components set unit='case' where id='${id(101)}'`],
    ['different bag material', `update public.product_recipe_components set inventory_item_id='${alternateCarton}' where id='${id(101)}'`],
    ['missing recipe', `delete from public.product_recipes where id='${recipes[0]}'`],
    ['duplicate matching bag component', `insert into public.product_recipe_components(recipe_id,inventory_item_id,quantity,unit,component_role) values ('${recipes[0]}','${oldBag}',40,'each','filter_pack')`],
  ]) {
    await test(`${name} rejects and rolls back newly inserted stock`, async () => {
      await db.exec(sql);
      await rejectsAtomically(/filter-pack recipe changed/i);
      assert.equal(await primaryItem(), undefined);
    });
  }
  await test('an empty catalog creates starting stock without needing the legacy bag or mappings', async () => {
    await db.exec('truncate public.products, public.inventory_items cascade');
    await db.exec(migration);
    const primary = await primaryItem();
    assert.ok(primary);
    assert.equal((await rows('select count(*)::int count from public.inventory_items'))[0].count, 1);
    assert.deepEqual(await rows('select quantity_received::float8 received,quantity_remaining::float8 remaining,unit_cost_cents::float8 cost from public.inventory_lots'),
      [{ received: 5882, remaining: 5882, cost: 3.49 }]);
    assert.equal((await rows('select count(*)::int count from public.inventory_adjustments'))[0].count, 1);
    assert.equal((await rows('select count(*)::int count from public.inventory_movements'))[0].count, 1);
    assert.deepEqual(await rows('select * from public.product_material_fallbacks'), []);
    const before = await snapshot();
    await db.exec(migration);
    assert.deepEqual(await snapshot(), before);
  });
  await test('additional compatible filter-pack products also receive the primary and fallback mapping', async () => {
    const extraProduct = id(6), extraRecipe = id(26);
    await db.query(`insert into public.products(id,name,sku,category,active) values ($1,'New filter product','FILTER-5','filter_packs',true)`, [extraProduct]);
    await db.query('insert into public.product_recipes(id,product_id) values ($1,$2)', [extraRecipe, extraProduct]);
    await db.query(`insert into public.product_recipe_components(recipe_id,inventory_item_id,quantity,unit,component_role)
      values ($1,$2,40,'each','filter_pack')`, [extraRecipe, oldBag]);
    await db.exec(migration);
    const primary = await primaryItem();
    assert.equal((await rows('select count(*)::int count from public.product_material_fallbacks where primary_inventory_item_id=$1', [primary.id]))[0].count, 5);
    assert.deepEqual(await rows('select inventory_item_id,quantity::float8 quantity,unit from public.product_recipe_components where recipe_id=$1', [extraRecipe]),
      [{ inventory_item_id: primary.id, quantity: 40, unit: 'each' }]);
  });
  for (const history of ['lot', 'movement', 'adjustment']) {
    await test(`unexpected prior ${history} history rejects without duplicating starting inventory`, async () => {
      const primary = await seedPrimary();
      if (history === 'lot') {
        await db.query(`insert into public.inventory_lots(inventory_item_id,lot_code,quantity_received,quantity_remaining,unit_cost_cents)
          values ($1,'UNEXPECTED',10,7,5)`, [primary]);
      } else if (history === 'movement') {
        await db.query(`insert into public.inventory_movements(inventory_item_id,movement_type,quantity_change,unit,unit_cost_cents)
          values ($1,'adjustment',10,'each',5)`, [primary]);
      } else {
        await db.query(`insert into public.inventory_adjustments(inventory_item_id,adjustment_type,quantity_change,unit,unit_cost_cents,notes)
          values ($1,'starting_count',10,'each',5,'Unexpected prior count')`, [primary]);
      }
      await rejectsAtomically(/already has inventory history/);
    });
  }
  console.log(`Passed ${passed} isolated filter-pack roll-stock migration scenarios.`);
} finally {
  await db.close();
}
