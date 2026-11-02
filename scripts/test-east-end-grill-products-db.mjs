// Isolated PostgreSQL regression checks. This script never connects to a live database.
// EAST_END_GRILL_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-east-end-grill-products-db.mjs
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.EAST_END_GRILL_PGLITE_MODULE;
if (!modulePath) throw new Error('Set EAST_END_GRILL_PGLITE_MODULE to an installed PGlite module.');
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
const migration = await migrationBySuffix('_east_end_grill_fraction_pack_variants.sql');
const id = number => `40000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const center = id(80), otherCenter = id(81);
const medium = id(1), dark = id(2), mediumCup = id(3), darkCup = id(4);
const bag = id(20), oldBag = id(21), mediumCoffee = id(22), darkCoffee = id(23), box = id(24), filters = id(25), oldBox = id(26);
const specifications = [
  { source: medium, recipe: id(40), coffee: mediumCoffee, sourceSku: '423423423', sku: 'MTC-FP-MED-100X1.5OZ-FILTERS', name: 'Meeting Coffee Medium Roast Fraction Pack 100x1.5oz with Filters' },
  { source: dark, recipe: id(41), coffee: darkCoffee, sourceSku: '2542523423', sku: 'MTC-FP-DRK-100X1.5OZ-FILTERS', name: 'Meeting Coffee Dark Roast Fraction Pack 100x1.5oz with Filters' },
];
const originalProducts = [1, 2, 3, 4, 5, 6, 7].map(id);
let passed = 0;
async function rows(sql, params = []) { return (await db.query(sql, params)).rows; }
async function snapshot() {
  const tables = ['centers', 'products', 'user_products', 'user_product_prices', 'product_recipes', 'product_recipe_components',
    'product_material_fallbacks', 'inventory_items', 'inventory_lots', 'inventory_adjustments', 'inventory_movements', 'production_runs', 'production_run_inputs'];
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, await rows(`select * from public.${table} order by ${
    table.startsWith('user_product') ? 'center_id,product_id' : table === 'product_material_fallbacks' ? 'product_id,primary_inventory_item_id' : 'id'}`)])));
}
async function seed() {
  await db.exec('truncate public.centers,public.products,public.inventory_items cascade');
  await db.query('insert into public.centers(id,name) values ($1,$2),($3,$4)', [center, 'East End Grill', otherCenter, 'Other Customer']);
  for (let index = 0; index < originalProducts.length; index++) {
    const spec = specifications[index];
    await db.query(`insert into public.products(id,name,sku,description,image_url,category,active,shipping_box_count_required,receivable_finished_good)
      values ($1,$2,$3,$4,$5,$6,true,$7,$8)`, [originalProducts[index], `Existing product ${index + 1}`,
      spec?.sourceSku ?? (index === 2 ? 'MTC-KCUP-MED-50CT' : index === 3 ? 'MTC-KCUP-DRK-50CT' : `OTHER-${index}`),
      `Original description ${index}`, `https://example.test/image-${index}.png`, index < 2 ? 'fraction_packs' : index < 4 ? 'k_cups' : 'whole_bean', index === 0, index === 1]);
    for (const customer of [center, otherCenter]) {
      await db.query('insert into public.user_products(center_id,product_id) values ($1,$2)', [customer, originalProducts[index]]);
      await db.query('insert into public.user_product_prices(center_id,product_id,price_cents,allow_zero_price) values ($1,$2,$3,false)',
        [customer, originalProducts[index], (customer === center ? 11000 : 12000) + index * 100]);
    }
  }
  for (const [item, name, type, unit] of [[bag, 'Roll bags', 'material_supply', 'each'], [oldBag, 'Old bags', 'material_supply', 'each'],
    [mediumCoffee, 'Medium coffee', 'raw_coffee', 'lb'], [darkCoffee, 'Dark coffee', 'raw_coffee', 'lb'],
    [box, 'Box', 'material_supply', 'each'], [filters, 'Filters', 'material_supply', 'each'], [oldBox, 'Old box', 'material_supply', 'each']]) {
    await db.query('insert into public.inventory_items(id,name,sku,item_type,base_unit) values ($1,$2,$3,$4,$5)', [item, name, `ITEM-${name}`, type, unit]);
  }
  for (let index = 0; index < specifications.length; index++) {
    const spec = specifications[index];
    await db.query(`update public.products set quickbooks_item_id=$2,quickbooks_item_name=$3,quickbooks_item_type='Inventory',
      quickbooks_sync_status='matched',quickbooks_synced_at='2026-01-01',quickbooks_sync_error='Preserve source field',
      shopify_shop_domain='sobrew.myshopify.com',shopify_product_id=$4,shopify_variant_id=$5,shopify_sku=$6,
      shopify_synced_at='2026-01-01',shopify_updated_at='2026-01-01' where id=$1`,
    [spec.source, `qb-${index}`, `QuickBooks source ${index}`, `gid://shopify/Product/${index + 1}`, `gid://shopify/ProductVariant/${index + 1}`, `SHOPIFY-${index}`]);
    await db.query(`insert into public.product_recipes(id,product_id,output_qty,waste_percent,labor_minutes,labor_rate_cents,
      shipping_label_qty,branding_label_qty,notes) values ($1,$2,1,$3,$4,2200,100,2,$5)`,
    [spec.recipe, spec.source, index + 2, 15 + index * 5, `Preserve source recipe ${index}`]);
    for (const [item, quantity, unit, role, sort, notes] of [[spec.coffee, 200, 'oz', 'raw_coffee', 0, 'Roast-specific coffee'],
      [bag, 100, 'each', 'fraction_bag', 10, '100 packs'], [box, 1, 'each', 'box', 20, 'Case carton'],
      [filters, 100, 'each', 'material_supply', 30, 'Filters included']]) {
      await db.query(`insert into public.product_recipe_components(recipe_id,inventory_item_id,quantity,unit,component_role,sort_order,notes)
        values ($1,$2,$3,$4,$5,$6,$7)`, [spec.recipe, item, quantity, unit, role, sort, notes]);
    }
    await db.query('insert into public.product_material_fallbacks values ($1,$2,$3),($1,$4,$5)', [spec.source, bag, oldBag, box, oldBox]);
  }
  await db.exec(`
    insert into public.inventory_items(id,name,sku,item_type,base_unit,product_id) values ('${id(27)}','Existing finished cases','FIN-SOURCE','finished_good','each','${medium}');
    insert into public.inventory_lots(id,inventory_item_id,lot_code,quantity_received,quantity_remaining,unit_cost_cents)
      values ('${id(60)}','${bag}','Existing bags',1000,800,6),('${id(61)}','${id(27)}','Existing cases',10,7,9000);
    insert into public.inventory_adjustments(inventory_item_id,lot_id,adjustment_type,quantity_change,unit,unit_cost_cents,notes)
      values ('${bag}','${id(60)}','starting_count',1000,'each',6,'Preserve count');
    insert into public.production_runs(id,product_id,quantity_produced,waste_quantity,estimated_unit_cost_cents,actual_unit_cost_cents,labor_minutes,labor_rate_cents)
      values ('${id(70)}','${medium}',2,0,9000,9100,30,2200);
    insert into public.production_run_inputs(production_run_id,inventory_item_id,quantity_expected,quantity_used,unit,cost_cents)
      values ('${id(70)}','${bag}',200,200,'each',1200);
    insert into public.inventory_movements(inventory_item_id,lot_id,movement_type,quantity_change,unit,unit_cost_cents,production_run_id)
      values ('${bag}','${id(60)}','production_consume',-200,'each',6,'${id(70)}');
  `);
}
async function test(name, operation) { await seed(); await operation(); passed++; console.log(`PASS ${name}`); }
async function rejectsAtomically() {
  const before = await snapshot();
  await assert.rejects(() => db.exec(migration));
  await db.exec('rollback');
  assert.deepEqual(await snapshot(), before, 'Failure must roll back all product, recipe, assignment, price and history changes');
}

try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema private;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;`);
  const init = await load('001_init.sql');
  for (const table of ['profiles', 'products', 'user_products', 'user_product_prices', 'orders', 'order_items']) {
    const definition = init.match(new RegExp(`create table if not exists ${table} \\([\\s\\S]*?\\n\\);`));
    assert.ok(definition, `Missing actual ${table} schema`);
    await db.exec(definition[0]);
  }
  await db.exec(`alter table public.profiles add column is_superadmin boolean;
    create table public.recurring_orders(id uuid primary key,user_id uuid references public.profiles);`);
  await db.exec((await load('011_centers_shared_access.sql')).split('create or replace function current_center_id()')[0]);
  await db.exec(await load('012_center_catalog_user_id_cleanup.sql'));
  await db.exec(await load('015_product_categories.sql'));
  const pricing = await load('20260908184205_recoverable_orders_and_catalog_pricing.sql');
  const priceColumn = pricing.match(/alter table public\.user_product_prices add column allow_zero_price[^;]+;/);
  assert.ok(priceColumn); await db.exec(priceColumn[0]);
  const restock = await load('048_quick_restock_performance.sql');
  for (const name of ['private.is_admin', 'private.is_owner_admin', 'public.is_admin', 'public.is_owner_admin']) {
    const definition = restock.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\(\\)[\\s\\S]*?\\$function\\$;`));
    assert.ok(definition); await db.exec(definition[0]);
  }
  await db.exec((await load('016_inventory_phase1.sql')).split('insert into inventory_items (name, sku, item_type, base_unit, active)')[0]);
  await db.exec((await load('023_inventory_cogs_shipping_labor.sql')).split('drop function if exists public.record_inventory_production_run')[0]);
  await db.exec((await load('024_profitability_reporting.sql')).split('drop function if exists public.record_inventory_production_run')[0]);
  await db.exec(await load('061_add_receivable_finished_good_flag.sql'));
  await db.exec(await load('071_quickbooks_mapping_fields.sql'));
  await db.exec((await load('20261009132818_shopify_paid_orders.sql')).split('create or replace function public.protect_shopify_product_identity()')[0]);
  await db.exec(await migrationBySuffix('_product_material_fallbacks.sql'));

  await test('clones both recipes at 150 oz without external identities and updates only the requested customer prices', async () => {
    const before = await snapshot();
    await db.exec(migration);
    const after = await snapshot();
    const newProducts = after.products.filter(product => !originalProducts.includes(product.id));
    assert.equal(newProducts.length, 2);
    for (const spec of specifications) {
      const source = before.products.find(product => product.id === spec.source);
      const created = newProducts.find(product => product.sku === spec.sku);
      assert.ok(created);
      assert.equal(created.name, spec.name); assert.equal(created.description, spec.name);
      for (const field of ['image_url', 'category', 'active', 'shipping_box_count_required', 'receivable_finished_good']) assert.equal(created[field], source[field]);
      assert.equal(created.quickbooks_sync_status, 'unmapped');
      for (const field of Object.keys(created).filter(field => (field.startsWith('quickbooks_') && field !== 'quickbooks_sync_status') || field.startsWith('shopify_'))) assert.equal(created[field], null, `${field} must not be cloned`);
      const sourceRecipe = before.product_recipes.find(recipe => recipe.product_id === spec.source);
      const newRecipe = after.product_recipes.find(recipe => recipe.product_id === created.id);
      const recipeSettings = ({ id, product_id, created_at, updated_at, ...settings }) => settings;
      assert.deepEqual(recipeSettings(newRecipe), recipeSettings(sourceRecipe));
      const components = (data, recipe) => data.product_recipe_components.filter(component => component.recipe_id === recipe)
        .sort((left, right) => left.sort_order - right.sort_order).map(({ id, recipe_id, ...component }) => component);
      assert.deepEqual(components(after, newRecipe.id), components(before, sourceRecipe.id).map(component =>
        component.component_role === 'raw_coffee' ? { ...component, quantity: '150.0000' } : component));
      const fallbacks = (data, product) => data.product_material_fallbacks.filter(rule => rule.product_id === product).map(({ product_id, ...rule }) => rule);
      assert.deepEqual(fallbacks(after, created.id), fallbacks(before, spec.source));
      assert.deepEqual(after.user_product_prices.find(price => price.center_id === center && price.product_id === created.id),
        { user_id: null, product_id: created.id, price_cents: 10500, center_id: center, allow_zero_price: false });
    }
    assert.deepEqual(after.products.filter(product => originalProducts.includes(product.id)), before.products);
    assert.deepEqual(after.product_recipes.filter(recipe => specifications.some(spec => spec.recipe === recipe.id)), before.product_recipes);
    assert.deepEqual(after.product_recipe_components.filter(component => specifications.some(spec => spec.recipe === component.recipe_id)), before.product_recipe_components);
    assert.deepEqual(after.product_material_fallbacks.filter(rule => originalProducts.includes(rule.product_id)), before.product_material_fallbacks);
    assert.deepEqual(after.user_products.filter(row => originalProducts.includes(row.product_id)), before.user_products);
    assert.equal(after.user_products.filter(row => row.center_id === center).length, 9);
    assert.deepEqual(after.user_product_prices.filter(row => originalProducts.includes(row.product_id)), before.user_product_prices.map(row =>
      row.center_id === center && [mediumCup, darkCup].includes(row.product_id) ? { ...row, price_cents: 4200, allow_zero_price: false } : row));
    for (const table of ['user_products', 'user_product_prices']) assert.deepEqual(after[table].filter(row => row.center_id === otherCenter), before[table].filter(row => row.center_id === otherCenter));
    for (const table of ['centers', 'inventory_items', 'inventory_lots', 'inventory_adjustments', 'inventory_movements', 'production_runs', 'production_run_inputs']) assert.deepEqual(after[table], before[table]);
  });
  await test('replay is an exact no-op with no duplicate products, recipes, materials or guide assignments', async () => {
    await db.exec(migration); const before = await snapshot(); await db.exec(migration); assert.deepEqual(await snapshot(), before);
  });
  await test('replay preserves later edits to the cloned noncoffee recipe settings', async () => {
    await db.exec(migration);
    await db.query(`update public.product_recipes set labor_minutes=18.25,notes='Later saved recipe' where product_id=(select id from public.products where sku=$1)`, [specifications[0].sku]);
    const before = await snapshot(); await db.exec(migration); assert.deepEqual(await snapshot(), before);
  });
  await test('absent East End Grill is a no-op even when a source recipe is missing', async () => {
    await db.query("update public.centers set name='Unrelated center' where id=$1", [center]);
    await db.query('delete from public.product_recipes where id=$1', [specifications[1].recipe]);
    const before = await snapshot(); await db.exec(migration); assert.deepEqual(await snapshot(), before);
  });
  for (const [name, sql] of [
    ['missing dark source', `update public.products set sku='MISSING-DARK-SOURCE' where id='${dark}'`],
    ['inactive dark source', `update public.products set active=false where id='${dark}'`],
    ['missing dark recipe', `delete from public.product_recipes where id='${specifications[1].recipe}'`],
    ['changed dark coffee quantity', `update public.product_recipe_components set quantity=199 where recipe_id='${specifications[1].recipe}' and component_role='raw_coffee'`],
    ['changed dark bag count', `update public.product_recipe_components set quantity=99 where recipe_id='${specifications[1].recipe}' and component_role='fraction_bag'`],
    ['duplicate dark coffee components', `insert into public.product_recipe_components(recipe_id,inventory_item_id,quantity,unit,component_role) values ('${specifications[1].recipe}','${darkCoffee}',200,'oz','raw_coffee')`],
    ['missing medium K-cup', `update public.products set sku='MISSING-MEDIUM-KCUP' where id='${mediumCup}'`],
    ['missing dark K-cup after medium price update', `update public.products set sku='MISSING-DARK-KCUP' where id='${darkCup}'`],
  ]) await test(`${name} rolls back every earlier clone and price update`, async () => { await db.exec(sql); await rejectsAtomically(); });
  console.log(`Passed ${passed} isolated East End Grill product migration scenarios.`);
} finally { await db.close(); }
