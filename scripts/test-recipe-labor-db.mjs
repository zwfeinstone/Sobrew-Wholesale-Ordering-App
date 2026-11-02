// Isolated PostgreSQL regression checks. This script never connects to a live database.
// MATERIAL_FALLBACKS_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-recipe-labor-db.mjs
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
const migration = await migrationBySuffix('_recipe_labor_22_and_twenty_seconds_per_pack.sql');
const fallbackMigration = await migrationBySuffix('_product_material_fallbacks.sql');
const id = number => `30000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const primary = id(1), fallback = id(2), coffee = id(3), carton = id(4), admin = id(90);
const productId = index => id(1000 + index), recipeId = index => id(2000 + index);
const bagComponentId = index => id(3000 + index * 10);
const packSizes = [20, 40, 42, 50, 72, 96, 100, 200];
const expectedMinutes = new Map([[20, 6.67], [40, 13.33], [42, 14], [50, 16.67], [72, 24], [96, 32], [100, 33.33], [200, 66.67], [80, 26.67]]);
const catalog = Array.from({ length: 67 }, (_, index) => {
  const category = index < 21 ? 'fraction_packs' : index < 42 ? 'filter_packs' : index === 42 ? 'sample_boxes' : 'whole_bean';
  const pack = index < 42;
  const count = index === 41 ? 80 : packSizes[(index < 21 ? index : index - 21) % packSizes.length];
  return { index, category, pack, count, output: 1,
    minutes: index === 42 ? 15.37 : index % 4 === 0 ? 0 : 12.25,
    rate: index === 66 ? 2200 : index % 2 === 0 ? 1500 : 2000 };
});
let passed = 0;

async function rows(sql, params = []) { return (await db.query(sql, params)).rows; }
async function snapshot() {
  const tables = ['products', 'inventory_items', 'inventory_lots', 'inventory_adjustments', 'inventory_movements',
    'product_recipes', 'product_recipe_components', 'product_material_fallbacks', 'production_runs', 'production_run_inputs'];
  return Object.fromEntries(await Promise.all(tables.map(async table => [table,
    await rows(`select * from public.${table} order by ${table === 'product_material_fallbacks' ? 'product_id,primary_inventory_item_id' : 'id'}`),
  ])));
}
async function seed() {
  await db.exec('truncate public.products,public.inventory_items cascade');
  await db.exec(`
    insert into public.inventory_items(id,name,sku,item_type,base_unit,active) values
      ('${primary}','Roll stock bags','ROLL','material_supply','each',true),
      ('${fallback}','Older bags','OLD','material_supply','each',true),
      ('${coffee}','Roasted coffee','COFFEE','raw_coffee','lb',true),
      ('${carton}','Case carton','BOX','material_supply','each',true);
    insert into public.inventory_lots(id,inventory_item_id,lot_code,quantity_received,quantity_remaining,unit_cost_cents)
      values ('${id(20)}','${primary}','ROLL',5882,5802,3.49),('${id(21)}','${fallback}','OLD',1000,750,12);
    insert into public.inventory_adjustments(inventory_item_id,lot_id,adjustment_type,quantity_change,unit,unit_cost_cents,notes)
      values ('${primary}','${id(20)}','starting_count',5882,'each',3.49,'Preserve existing count');
  `);
  for (const item of catalog) {
    await db.query(`insert into public.products(id,name,sku,category,active) values ($1,$2,$3,$4,$5)`,
      [productId(item.index), `Recipe product ${item.index}`, `PRODUCT-${item.index}`, item.category, item.index % 3 !== 0]);
    await db.query(`insert into public.product_recipes(id,product_id,output_qty,waste_percent,labor_minutes,labor_rate_cents,
      shipping_label_qty,branding_label_qty,notes,created_at,updated_at)
      values ($1,$2,$3,5,$4,$5,1,2,'Preserve recipe metadata','2026-01-01','2026-01-01')`,
    [recipeId(item.index), productId(item.index), item.output, item.minutes, item.rate]);
    await db.query(`insert into public.product_recipe_components(id,recipe_id,inventory_item_id,quantity,unit,component_role,sort_order,notes)
      values ($1,$2,$3,$4,'each',$5,10,'Preserve bag component')`,
    [bagComponentId(item.index), recipeId(item.index), primary, item.pack ? item.count : item.index === 42 ? 2.5 : 1,
      item.category === 'filter_packs' ? 'filter_pack' : item.category === 'whole_bean' ? 'bag' : 'fraction_bag']);
    await db.query(`insert into public.product_recipe_components(id,recipe_id,inventory_item_id,quantity,unit,component_role,sort_order,notes)
      values ($1,$2,$3,5.25,'lb','raw_coffee',0,'Preserve coffee quantity'),($4,$2,$5,1,'each','box',20,'Preserve box quantity')`,
    [id(3001 + item.index * 10), recipeId(item.index), coffee, id(3002 + item.index * 10), carton]);
    if (item.pack) await db.query('insert into public.product_material_fallbacks values ($1,$2,$3)', [productId(item.index), primary, fallback]);
  }
  await db.exec(`
    insert into public.production_runs(id,product_id,quantity_produced,waste_quantity,estimated_unit_cost_cents,actual_unit_cost_cents,
      fixed_cost_cents,expected_labor_cost_cents,actual_labor_cost_cents,labor_minutes,labor_rate_cents,notes,produced_at)
      values ('${id(500)}','${productId(0)}',2,1,1500,1600,20,400,500,15,2000,'Historical run must not change','2026-01-15');
    insert into public.production_run_inputs(production_run_id,inventory_item_id,quantity_expected,quantity_used,unit,cost_cents)
      values ('${id(500)}','${primary}',80,80,'each',279.2);
    insert into public.inventory_movements(inventory_item_id,lot_id,movement_type,quantity_change,unit,unit_cost_cents,production_run_id,notes)
      values ('${primary}','${id(20)}','production_consume',-80,'each',3.49,'${id(500)}','Historical consumption');
  `);
}
async function test(name, operation) {
  await seed();
  await operation();
  passed++;
  console.log(`PASS ${name}`);
}
async function rejectsAtomically() {
  const before = await snapshot();
  await assert.rejects(() => db.exec(migration), /Cannot calculate pack labor/);
  await db.exec('rollback');
  assert.deepEqual(await snapshot(), before, 'Invalid recipes must prevent every rate/minute change and preserve other data');
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
  await db.exec((await load('016_inventory_phase1.sql')).split('insert into inventory_items (name, sku, item_type, base_unit, active)')[0]);
  await db.exec((await load('023_inventory_cogs_shipping_labor.sql')).split('drop function if exists public.record_inventory_production_run')[0]);
  await db.exec((await load('024_profitability_reporting.sql')).split('drop function if exists public.record_inventory_production_run')[0]);
  await db.exec(fallbackMigration);

  await test('all 67 rates become $22/hour and 42 pack recipes use 20 seconds per pack at two-decimal precision', async () => {
    const before = await snapshot();
    await db.exec(migration);
    const after = await snapshot();
    const labor = await rows(`select id,output_qty::float8 output,labor_minutes::float8 minutes,labor_rate_cents::float8 rate
      from public.product_recipes order by id`);
    assert.equal(labor.length, 67);
    assert.equal(catalog.filter(item => item.pack).length, 42);
    for (const item of catalog) {
      assert.deepEqual(labor[item.index], { id: recipeId(item.index), output: item.output, rate: 2200,
        minutes: item.pack ? expectedMinutes.get(item.count) : item.minutes });
      const oldRecipe = before.product_recipes[item.index];
      const newRecipe = after.product_recipes[item.index];
      const omitLabor = ({ labor_minutes, labor_rate_cents, updated_at, ...rest }) => rest;
      assert.deepEqual(omitLabor(newRecipe), omitLabor(oldRecipe));
      if (item.rate === 2200 && !item.pack) assert.deepEqual(newRecipe, oldRecipe, 'Already-correct nonpack recipe must be untouched');
      else assert.notEqual(newRecipe.updated_at, oldRecipe.updated_at, 'Changed recipe must receive an update timestamp');
    }
    for (const [table, values] of Object.entries(before)) {
      if (table !== 'product_recipes') assert.deepEqual(after[table], values, `${table} must remain unchanged`);
    }
    assert.equal(labor[41].minutes, 26.67, '80 packs for one case retains the editor-compatible two-decimal minutes');
    assert.equal(labor[42].minutes, 15.37, 'Sample box labor stays fixed even with fractional bag materials');
  });
  await test('reapplying is an exact no-op including update timestamps', async () => {
    await db.exec(migration);
    const before = await snapshot();
    await db.exec(migration);
    assert.deepEqual(await snapshot(), before);
  });
  for (const [category, index, role] of [['fraction_packs', 0, 'fraction_bag'], ['filter_packs', 21, 'filter_pack']]) {
    for (const [name, sql] of [
      ['missing packaging component', `delete from public.product_recipe_components where id='${bagComponentId(index)}'`],
      ['wrong packaging role', `update public.product_recipe_components set component_role='material_supply' where id='${bagComponentId(index)}'`],
      ['duplicate packaging components', `insert into public.product_recipe_components(recipe_id,inventory_item_id,quantity,unit,component_role) values ('${recipeId(index)}','${fallback}',40,'each','${role}')`],
      ['non-each component unit', `update public.product_recipe_components set unit='case' where id='${bagComponentId(index)}'`],
      ['fractional pack count', `update public.product_recipe_components set quantity=40.5 where id='${bagComponentId(index)}'`],
      ['two-case recipe output despite 80 whole packs', `update public.product_recipes set output_qty=2 where id='${recipeId(index)}'; update public.product_recipe_components set quantity=80 where id='${bagComponentId(index)}'`],
      ['missing recipe', `delete from public.product_recipes where id='${recipeId(index)}'`],
      ['NaN pack count', `update public.product_recipe_components set quantity='NaN' where id='${bagComponentId(index)}'`],
      ['NaN recipe output', `update public.product_recipes set output_qty='NaN' where id='${recipeId(index)}'`],
    ]) {
      await test(`${category}: ${name} rejects every update atomically`, async () => {
        await db.exec(sql);
        await rejectsAtomically();
      });
    }
  }
  await test('pack inventory base units must also be each', async () => {
    await db.query("update public.inventory_items set base_unit='lb' where id=$1", [primary]);
    await rejectsAtomically();
  });
  await test('empty catalog remains a safe no-op', async () => {
    await db.exec('truncate public.products,public.inventory_items cascade');
    const before = await snapshot();
    await db.exec(migration);
    assert.deepEqual(await snapshot(), before);
  });
  console.log(`Passed ${passed} isolated recipe labor migration scenarios.`);
} finally {
  await db.close();
}
