// Isolated PostgreSQL regression tests; never connects to a live database.
// CUSTOMER_STOCK_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-customer-held-stock-db.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.CUSTOMER_STOCK_PGLITE_MODULE;
if (!modulePath) throw new Error('Set CUSTOMER_STOCK_PGLITE_MODULE to an installed PGlite module.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const recovery = await readFile(new URL('../db/migrations/20260908184205_recoverable_orders_and_catalog_pricing.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../db/migrations/20261020231420_customer_held_stock.sql', import.meta.url), 'utf8');
const archiveMigration = await readFile(new URL('../db/migrations/20261020232822_allow_held_stock_order_archiving.sql', import.meta.url), 'utf8');
const sharedMigration = await readFile(new URL('../db/migrations/20261021124829_shared_customer_stock_variants.sql', import.meta.url), 'utf8');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const center = id(1), otherCenter = id(2), admin = id(3), customer = id(4), otherCustomer = id(5), secondLogin = id(6);
const product = id(10), initialOrder = id(11), initialItem = id(12), inventory = id(13), lotA = id(14), lotB = id(15);
const boxInventory = id(20), boxLot = id(21), boxUsage = id(22), productionRun = id(23), ordinaryProduct = id(24);
let assertions = 0, nextId = 100;
async function actor(user, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  await db.exec(`set role ${role}`);
}
async function reject(operation, code, message) {
  await assert.rejects(operation, error => error.code === code && (!message || error.message.includes(message)));
  assertions++;
}
async function balance(expected) {
  const row = (await db.query('select * from public.get_customer_stock_balances($1)', [center])).rows[0];
  assert.deepEqual([row.available_quantity, row.reserved_quantity, row.on_hand_quantity], expected); assertions++;
}
async function order(customerId = center, overrides = {}) {
  const values = { id: id(nextId++), center_id: customerId, user_id: customerId === center ? customer : otherCustomer, ...overrides };
  const fields = Object.keys(values);
  await db.query(`insert into public.orders (${fields.join(',')}) values (${fields.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
  return values.id;
}
async function item(orderId, qty, overrides = {}) {
  const values = { id: id(nextId++), order_id: orderId, product_id: product, qty, unit_price_cents: 0, line_total_cents: 0, ...overrides };
  const fields = Object.keys(values);
  await db.query(`insert into public.order_items (${fields.join(',')}) values (${fields.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
  return values.id;
}
async function consume(itemId, shippingCost = 2000) {
  return db.query('select public.consume_customer_stock_for_order_item($1,$2) as quantity', [itemId, shippingCost]);
}
async function stock() {
  return Number((await db.query('select sum(quantity_remaining) as quantity from public.inventory_lots where inventory_item_id=$1', [inventory])).rows[0].quantity);
}
async function heldStockState() {
  return (await db.query(`select jsonb_build_object(
    'order', (select to_jsonb(o) - 'archived_at' from public.orders o where o.id=$1),
    'items', (select jsonb_agg(i order by i.id) from public.order_items i where i.order_id=$1),
    'billing', (select jsonb_agg(s order by s.order_id) from public.held_stock_sales s),
    'allocations', (select jsonb_agg(a order by a.id) from public.customer_stock_allocations a),
    'reservations', (select jsonb_agg(r order by r.order_item_id) from public.customer_stock_reservations r),
    'lots', (select jsonb_agg(l order by l.id) from public.inventory_lots l),
    'movements', (select jsonb_agg(m order by m.id) from public.inventory_movements m)
  ) as state`, [initialOrder])).rows[0].state;
}

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    grant usage on schema auth, private to authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    create table public.centers(id uuid primary key, name text, is_active boolean default true);
    create table public.profiles(id uuid primary key, center_id uuid references public.centers, full_name text,
      email text, is_admin boolean default false, is_active boolean default true, is_superadmin boolean default false);
    create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.profiles where id=auth.uid() and is_admin and is_active);
    $$;
    create function public.is_owner_admin() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.profiles where id=auth.uid() and is_admin and is_active and is_superadmin);
    $$;
    create function public.current_center_id() returns uuid language sql stable security definer set search_path='' as $$
      select center_id from public.profiles where id=auth.uid() and is_active;
    $$;
    create table public.admin_permissions(profile_id uuid,section_key text,can_edit boolean,can_view boolean);
    create table public.admin_center_assignments(profile_id uuid,center_id uuid);
    create table public.products(id uuid primary key,name text,sku text,description text,image_url text,category text,active boolean default true);
    create table public.user_products(center_id uuid,product_id uuid);
    create table public.user_product_prices(center_id uuid,product_id uuid,price_cents integer);
    create table public.center_locations(id uuid primary key);
    create table public.recurring_orders(id uuid primary key,source_order_id uuid,center_id uuid,active boolean default true,status text default 'active');
    create table public.recurring_order_items(id uuid primary key default gen_random_uuid(),recurring_order_id uuid references public.recurring_orders,
      product_id uuid references public.products,qty integer,unit_price_cents integer,line_total_cents integer);
    create table public.orders(id uuid primary key default gen_random_uuid(),center_id uuid references public.centers,user_id uuid references public.profiles,
      center_location_id uuid,recurring_order_id uuid,shipping_company text,shipping_name text,shipping_address1 text,shipping_address2 text,
      shipping_city text,shipping_state text,shipping_zip text,notes text,status text default 'New',archived_at timestamptz,
      subtotal_cents integer not null default 0,shipping_cost_cents numeric,order_source text not null default 'portal',
      order_kind text not null default 'standard',invoice_status text not null default 'not_invoiced',created_at timestamptz default now(),
      constraint orders_invoice_not_required_source_check check(invoice_status<>'not_required' or order_source='shopify'));
    create table public.order_items(id uuid primary key default gen_random_uuid(),order_id uuid references public.orders on delete cascade,
      product_id uuid references public.products,product_name_snapshot text,qty integer not null,unit_price_cents integer not null,
      line_total_cents integer not null,shipping_boxes_used numeric,cogs_snapshot_at timestamptz,cogs_product_cents numeric);
    create table public.inventory_items(id uuid primary key,name text,product_id uuid unique references public.products,item_type text,base_unit text,active boolean default true);
    create table public.inventory_lots(id uuid primary key,inventory_item_id uuid references public.inventory_items,lot_code text,
      quantity_received numeric,quantity_remaining numeric check(quantity_remaining>=0),unit_cost_cents numeric default 0,
      received_at timestamptz default now(),created_at timestamptz default now());
    create table public.production_runs(id uuid primary key,product_id uuid references public.products,finished_lot_id uuid,
      quantity_produced numeric,quantity_voided numeric default 0,status text default 'active');
    create table public.inventory_movements(id uuid primary key default gen_random_uuid(),inventory_item_id uuid references public.inventory_items,
      lot_id uuid references public.inventory_lots,movement_type text,quantity_change numeric,unit text,unit_cost_cents numeric default 0,
      order_id uuid references public.orders on delete set null,order_item_id uuid references public.order_items on delete set null,notes text,created_at timestamptz default now());
    create table public.order_item_shipping_boxes(id uuid primary key default gen_random_uuid(),order_id uuid references public.orders on delete cascade,
      order_item_id uuid references public.order_items on delete cascade,inventory_item_id uuid references public.inventory_items,quantity numeric,
      unit_cost_cents numeric default 0,total_cost_cents numeric default 0,cogs_estimated boolean default false,consumed_at timestamptz,
      created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.order_commission_snapshots(id uuid primary key,order_id uuid references public.orders on delete cascade);
    grant all on all tables in schema public to authenticated, service_role;
    alter table public.products enable row level security;
    create policy product_admin on public.products for all to authenticated using(public.is_admin()) with check(public.is_admin());
    create policy product_customer on public.products for select to authenticated using(exists(
      select 1 from public.user_products p where p.product_id=products.id and p.center_id=public.current_center_id()));
    alter table public.orders enable row level security;
    create policy orders_admin on public.orders for all to authenticated using(public.is_admin()) with check(public.is_admin());
    create policy orders_customer_select on public.orders for select to authenticated using(center_id=public.current_center_id());
    create policy orders_customer_insert on public.orders for insert to authenticated with check(center_id=public.current_center_id());
    alter table public.order_items enable row level security;
    create policy items_admin on public.order_items for all to authenticated using(public.is_admin()) with check(public.is_admin());
    create policy items_customer_select on public.order_items for select to authenticated using(exists(
      select 1 from public.orders o where o.id=order_items.order_id and o.center_id=public.current_center_id()));
    create policy items_customer_insert on public.order_items for insert to authenticated with check(exists(
      select 1 from public.orders o where o.id=order_items.order_id and o.center_id=public.current_center_id()));
    alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;
  `);
  // Use the application's actual deletion/restore functions and pricing trigger.
  await db.exec(recovery);
  await db.exec(migration);
  await db.exec(archiveMigration);
  await db.exec(`
    insert into public.centers values('${center}','Customer A',true),('${otherCenter}','Customer B',true);
    insert into public.profiles(id,center_id,is_admin,is_active,is_superadmin) values
      ('${admin}',null,true,true,true),('${customer}','${center}',false,true,false),
      ('${secondLogin}','${center}',false,true,false),('${otherCustomer}','${otherCenter}',false,true,false);
    insert into public.products(id,name,sku) values('${product}','Custom 8-ounce bags','CUSTOM-TEST'),('${ordinaryProduct}','Ordinary product','ORDINARY-TEST');
    insert into public.user_products values('${center}','${product}'),('${otherCenter}','${product}');
    insert into public.user_product_prices values('${center}','${product}',0,true),('${otherCenter}','${product}',0,true);
    insert into public.inventory_items values('${inventory}','Custom inventory','${product}','finished_good','each',true);
    insert into public.inventory_items values('${boxInventory}','Shipping box',null,'material_supply','each',true);
    insert into public.inventory_lots(id,inventory_item_id,lot_code,quantity_received,quantity_remaining,unit_cost_cents,received_at)
      values('${lotA}','${inventory}','first',60,60,100,'2026-10-01'),('${lotB}','${inventory}','second',940,940,100,'2026-10-02');
    insert into public.inventory_lots(id,inventory_item_id,lot_code,quantity_received,quantity_remaining,unit_cost_cents)
      values('${boxLot}','${boxInventory}','boxes',10,10,125);
    insert into public.production_runs(id,product_id,finished_lot_id,quantity_produced) values('${productionRun}','${product}','${lotA}',1000);
  `);
  await actor(admin);
  await db.query("insert into public.orders(id,center_id,user_id,status,subtotal_cents) values($1,$2,$3,'Shipped',690000)", [initialOrder,center,admin]);
  await item(initialOrder,1000,{id:initialItem,unit_price_cents:690,line_total_cents:690000});
  await db.query('insert into public.held_stock_sales(order_id,processing_fee_cents) values($1,20631)', [initialOrder]);
  await db.query('insert into public.customer_stock_allocations(center_id,product_id,initial_order_id,initial_quantity) values($1,$2,$3,1000)', [center,product,initialOrder]);
  const upgradeOrder = await order();
  const upgradeItem = await item(upgradeOrder,25,{shipping_boxes_used:1});
  await consume(upgradeItem,0);
  await db.query("update public.orders set status='Shipped',invoice_status='not_required' where id=$1",[upgradeOrder]);
  const beforeUpgrade = await heldStockState();
  // Upgrade an existing allocation with a shipped release: backfill must retain
  // ownership and movement history rather than resetting it to the initial 1,000.
  await db.exec('reset role');
  await db.exec(sharedMigration);
  await actor(admin);
  assert.equal((await db.query('select product_id from public.customer_stock_products')).rows[0].product_id,product); assertions++;
  assert.deepEqual(await heldStockState(),beforeUpgrade); assertions++;
  await balance([975,0,975]);
  await db.query('delete from public.orders where id=$1',[upgradeOrder]);
  await balance([1000,0,1000]);
  assert.equal(await stock(),1000); assertions++;
  const ordinaryShippedOrder = await order(center,{status:'Shipped',subtotal_cents:100});
  await item(ordinaryShippedOrder,1,{product_id:ordinaryProduct,unit_price_cents:100,line_total_cents:100});
  const beforeArchive = await heldStockState();
  const bulkArchived = (await db.query("update public.orders set archived_at=now() where archived_at is null and status='Shipped' returning id,archived_at")).rows;
  assert.deepEqual(bulkArchived.map(row=>row.id).sort(),[initialOrder,ordinaryShippedOrder].sort());
  assert.ok(bulkArchived.every(row=>row.archived_at)); assertions++;
  assert.deepEqual(await heldStockState(),beforeArchive); assertions++;
  await balance([1000,0,1000]);
  // Archiving must not weaken the original sale's financial or ownership guards.
  for (const [statement,parameters = [initialOrder]] of [
    ['delete from public.orders where id=$1'],
    ["update public.orders set status='New' where id=$1"],
    ["update public.orders set archived_at=null,status='New' where id=$1"],
    ['update public.orders set center_id=$2 where id=$1',[initialOrder,otherCenter]],
    ['update public.orders set subtotal_cents=0 where id=$1'],
  ]) await reject(db.query(statement,parameters),'22023');
  await reject(db.query('select public.move_order_to_trash($1,$2)',[initialOrder,'Archived original sale']),'22023');
  assert.deepEqual(await heldStockState(),beforeArchive); assertions++;
  const bulkUnarchived = (await db.query('update public.orders set archived_at=null where id=any($1::uuid[]) returning id,archived_at',[[initialOrder,ordinaryShippedOrder]])).rows;
  assert.deepEqual(bulkUnarchived.map(row=>row.id).sort(),[initialOrder,ordinaryShippedOrder].sort());
  assert.ok(bulkUnarchived.every(row=>row.archived_at===null)); assertions++;
  assert.deepEqual(await heldStockState(),beforeArchive); assertions++;
  await balance([1000,0,1000]);
  // Keep the original bill archived through reservation, shipment and recovery.
  await db.query('update public.orders set archived_at=now() where id=$1',[initialOrder]);
  await reject(db.query('delete from public.order_items where id=$1',[initialItem]),'22023');
  await reject(db.query('update public.order_items set qty=900 where id=$1',[initialItem]),'22023');
  await reject(item(initialOrder,1),'22023');
  await reject(item(initialOrder,1,{product_id:ordinaryProduct,unit_price_cents:100,line_total_cents:100}),'22023');
  await reject(db.query('update public.customer_stock_allocations set initial_quantity=2000'),'22023');
  await reject(db.query('delete from public.customer_stock_allocations'),'22023');
  await reject(db.query("update public.production_runs set status='void',quantity_voided=1000 where id=$1",[productionRun]),'22023');
  await reject(db.query('delete from public.production_runs where id=$1',[productionRun]),'22023');
  await reject(db.query('insert into public.production_runs(id,product_id,quantity_produced) values($1,$2,100)',[id(nextId++),product]),'22023');
  console.log('PASS mixed shipped-order bulk archive/unarchive preserves billing, allocations and inventory; archived original sale protects quantity, status, customer, price and deletion');

  await actor(customer);
  await balance([1000,0,1000]);
  assert.equal((await db.query('select * from public.held_stock_sales')).rows.length,0); assertions++;
  await reject(db.query('select public.get_customer_stock_balances($1)',[otherCenter]),'42501');
  await reject(db.query('update public.customer_stock_reservations set quantity=0'),'42501');
  await reject(db.query('truncate public.customer_stock_allocations cascade'),'42501');
  const release = await order();
  const releaseItem = await item(release,100);
  await balance([900,100,1000]);
  await reject(consume(releaseItem),'42501');
  await reject(db.query('select private.sync_customer_stock_order_item($1)',[releaseItem]),'42501');
  await actor(secondLogin);
  await balance([900,100,1000]);
  const secondOrder = await order();
  await reject(item(secondOrder,901),'23514','Customer stock unavailable');
  const secondItem = await item(secondOrder,900);
  await balance([0,1000,1000]);
  await reject(item(secondOrder,1),'23514');
  await actor(otherCustomer);
  assert.equal((await db.query('select * from public.products where id=$1',[product])).rows.length,0); assertions++;
  assert.equal((await db.query('select * from public.customer_stock_allocations')).rows.length,0); assertions++;
  await reject(item(await order(otherCenter),1),'42501','different customer');
  await actor(null,'anon');
  await reject(db.query('select * from public.customer_stock_allocations'),'42501');
  await reject(db.query('select * from public.customer_stock_reservations'),'42501');
  await reject(db.query('select * from public.get_customer_stock_balances($1)',[center]),'42501');
  await actor(admin);
  await db.query('delete from public.order_items where id=$1',[secondItem]);
  await balance([900,100,1000]);
  await reject(db.query('update public.order_items set qty=1001 where id=$1',[releaseItem]),'23514');
  await reject(db.query('update public.order_items set unit_price_cents=1,line_total_cents=100 where id=$1',[releaseItem]),'22023');
  await reject(db.query('update public.orders set center_id=$2 where id=$1',[release,otherCenter]),'42501');
  await reject(db.query("update public.orders set status='Shipped' where id=$1",[release]),'22023');
  await db.query('update public.orders set archived_at=now() where id=$1',[release]);
  await balance([1000,0,1000]);
  const fullOrder = await order();
  const fullItem = await item(fullOrder,1000);
  await reject(db.query('update public.orders set archived_at=null where id=$1',[release]),'23514');
  await db.query('delete from public.order_items where id=$1',[fullItem]);
  await db.query('update public.orders set archived_at=null where id=$1',[release]);
  await balance([900,100,1000]);
  console.log('PASS customer ownership, no cost exposure, shared-login balances, oversell rejection, edits and archive/reactivation capacity checks');

  await reject(consume(releaseItem),'22023','box count');
  await db.query('update public.order_items set shipping_boxes_used=1.5 where id=$1',[releaseItem]);
  await reject(consume(releaseItem),'22023','box count');
  await db.query('update public.order_items set shipping_boxes_used=2 where id=$1',[releaseItem]);
  await db.query('insert into public.order_item_shipping_boxes(id,order_id,order_item_id,inventory_item_id,quantity) values($1,$2,$3,$4,2)',[boxUsage,release,releaseItem,boxInventory]);
  await reject(consume(releaseItem,null),'22023');
  await reject(consume(releaseItem,-1),'22023');
  await db.query('update public.inventory_lots set quantity_remaining=0 where id=$1',[lotB]);
  await reject(consume(releaseItem),'23514');
  assert.equal(await stock(),60); assertions++;
  assert.equal(Number((await db.query('select quantity_remaining from public.inventory_lots where id=$1',[boxLot])).rows[0].quantity_remaining),10); assertions++;
  assert.equal((await db.query('select consumed_at from public.order_item_shipping_boxes where id=$1',[boxUsage])).rows[0].consumed_at,null); assertions++;
  assert.equal((await db.query("select count(*)::int as count from public.inventory_movements where order_item_id=$1",[releaseItem])).rows[0].count,0); assertions++;
  await balance([900,100,1000]);
  await db.query('update public.inventory_lots set quantity_remaining=940 where id=$1',[lotB]);
  assert.equal((await consume(releaseItem)).rows[0].quantity,100); assertions++;
  assert.equal((await consume(releaseItem)).rows[0].quantity,100); assertions++;
  await reject(consume(releaseItem,3000),'22023','different shipping cost');
  assert.equal(await stock(),900); assertions++;
  const lots = (await db.query('select quantity_remaining from public.inventory_lots where inventory_item_id=$1 order by received_at',[inventory])).rows;
  assert.deepEqual(lots.map(row=>Number(row.quantity_remaining)),[0,900]); assertions++;
  const movements = (await db.query('select quantity_change,unit_cost_cents from public.inventory_movements where order_item_id=$1 and inventory_item_id=$2 order by created_at,id',[releaseItem,inventory])).rows;
  assert.equal(movements.reduce((sum,row)=>sum+Number(row.quantity_change),0),-100);
  assert.ok(movements.every(row=>Number(row.unit_cost_cents)===0)); assertions++;
  const consumedBox = (await db.query('select * from public.order_item_shipping_boxes where id=$1',[boxUsage])).rows[0];
  assert.equal(Number(consumedBox.total_cost_cents),250); assert.equal(consumedBox.cogs_estimated,false); assert.ok(consumedBox.consumed_at); assertions++;
  assert.equal(Number((await db.query('select quantity_remaining from public.inventory_lots where id=$1',[boxLot])).rows[0].quantity_remaining),8); assertions++;
  await reject(db.query('insert into public.order_item_shipping_boxes(order_id,order_item_id,inventory_item_id,quantity) values($1,$2,$3,2)',[release,releaseItem,boxInventory]),'22023','already consumed');
  await reject(db.query('delete from public.order_item_shipping_boxes where id=$1',[boxUsage]),'22023');
  await reject(db.query('update public.order_item_shipping_boxes set quantity=3 where id=$1',[boxUsage]),'22023');
  await balance([900,0,900]);
  await db.query('update public.orders set archived_at=now() where id=$1',[release]);
  await balance([900,0,900]);
  await db.query('update public.orders set archived_at=null where id=$1',[release]);
  await reject(db.query('delete from public.order_items where id=$1',[releaseItem]),'22023');
  await reject(db.query('update public.order_items set qty=50 where id=$1',[releaseItem]),'22023');
  await reject(db.query('update public.order_items set shipping_boxes_used=3 where id=$1',[releaseItem]),'22023');
  await db.query("update public.orders set status='Shipped',invoice_status='not_required' where id=$1",[release]);
  await reject(item(release,1,{product_id:ordinaryProduct,unit_price_cents:100,line_total_cents:100}),'22023','skip invoicing');
  await reject(db.query("update public.orders set status='New' where id=$1",[release]),'22023');
  console.log('PASS atomic FIFO consumption, rollback on shortage, zero repeat production cost, idempotent retry and protected consumed stock during partial workflow failure');

  await db.query('select public.move_order_to_trash($1,$2)',[release,'Regression test']);
  assert.equal(await stock(),1000); assertions++;
  assert.equal(Number((await db.query('select quantity_remaining from public.inventory_lots where id=$1',[boxLot])).rows[0].quantity_remaining),10); assertions++;
  await balance([1000,0,1000]);
  const trashId = (await db.query('select id from public.order_trash where order_id=$1 and restored_at is null',[release])).rows[0].id;
  const competingOrder = await order();
  const competingItem = await item(competingOrder,1000);
  await reject(db.query('select public.restore_order_from_trash($1)',[trashId]),'23514','Customer stock unavailable');
  assert.equal(await stock(),1000); assertions++;
  assert.equal((await db.query('select id from public.orders where id=$1',[release])).rows.length,0); assertions++;
  await db.query('delete from public.order_items where id=$1',[competingItem]);
  await db.query('select public.restore_order_from_trash($1)',[trashId]);
  await db.query('select public.restore_order_from_trash($1)',[trashId]);
  assert.equal(await stock(),900); assertions++;
  assert.equal(Number((await db.query('select quantity_remaining from public.inventory_lots where id=$1',[boxLot])).rows[0].quantity_remaining),8); assertions++;
  await balance([900,0,900]);
  assert.equal((await consume(releaseItem)).rows[0].quantity,100); assertions++;
  assert.equal(await stock(),900); assertions++;
  await db.query('delete from public.orders where id=$1',[release]);
  assert.equal(await stock(),1000); assertions++;
  await balance([1000,0,1000]);
  const pendingOrder = await order();
  await item(pendingOrder,50);
  await db.query('select public.move_order_to_trash($1,$2)',[pendingOrder,'Cancel before shipment']);
  await balance([1000,0,1000]);
  const pendingTrash = (await db.query('select id from public.order_trash where order_id=$1 and restored_at is null',[pendingOrder])).rows[0].id;
  await db.query('select public.restore_order_from_trash($1)',[pendingTrash]);
  await balance([950,50,1000]);
  console.log('PASS real trash/recovery RPCs restore physical and owned stock once, failed recovery rolls back stock, and pending cancellation/restoration reserves correctly');

  const recurringId = id(nextId++);
  await db.query('insert into public.recurring_orders(id,center_id) values($1,$2)',[recurringId,center]);
  await reject(db.query('insert into public.recurring_order_items(recurring_order_id,product_id,qty,unit_price_cents,line_total_cents) values($1,$2,1,0,0)',[recurringId,product]),'22023','recurring order');
  await reject(item(await order(center,{recurring_order_id:recurringId}),1),'22023','recurring order');
  const ordinaryOrder = await order();
  await reject(db.query("update public.orders set invoice_status='not_required' where id=$1",[ordinaryOrder]),'22023');
  await reject(order(center,{invoice_status:'not_required'}),'22023','skip invoicing');
  const mixedOrder = await order(center,{subtotal_cents:100});
  const mixedOrdinaryItem = await item(mixedOrder,1,{product_id:ordinaryProduct,unit_price_cents:100,line_total_cents:100,shipping_boxes_used:12});
  const mixedStockItem = await item(mixedOrder,10,{shipping_boxes_used:0});
  await db.query('insert into public.order_item_shipping_boxes(order_id,order_item_id,inventory_item_id,quantity) values($1,$2,$3,12)',[mixedOrder,mixedStockItem,boxInventory]);
  const calls = await Promise.all([consume(mixedStockItem),consume(mixedStockItem)]);
  assert.ok(calls.every(result=>result.rows[0].quantity===10)); assertions++;
  const estimatedBox = (await db.query('select * from public.order_item_shipping_boxes where order_id=$1',[mixedOrder])).rows[0];
  assert.equal(Number(estimatedBox.total_cost_cents),1500); assert.equal(estimatedBox.cogs_estimated,true); assertions++;
  await reject(db.query('update public.order_items set shipping_boxes_used=99 where id=$1',[mixedOrdinaryItem]),'22023');
  await db.query("update public.orders set status='Shipped' where id=$1",[mixedOrder]);
  await balance([940,50,990]);
  const beforeFinalUnarchive = await heldStockState();
  const originalArchived = (await db.query('select archived_at from public.orders where id=$1',[initialOrder])).rows[0].archived_at;
  assert.ok(originalArchived); assertions++;
  await db.query('update public.orders set archived_at=null where id=$1',[initialOrder]);
  assert.deepEqual(await heldStockState(),beforeFinalUnarchive); assertions++;
  await balance([940,50,990]);
  console.log('PASS archived original sale supports reservations, consumption and recovery; unarchive preserves reserved and consumed balances');

  // Return the fixtures' original pool to 1,000 before exercising shared choices.
  await db.query('select public.move_order_to_trash($1,$2)',[mixedOrder,'Shared variant fixture reset']);
  await db.query('select public.move_order_to_trash($1,$2)',[pendingOrder,'Shared variant fixture reset']);
  await balance([1000,0,1000]);
  const allocationId = (await db.query('select id from public.customer_stock_allocations where product_id=$1',[product])).rows[0].id;
  const wholeBean = id(30), stockProduct = id(31), assignedProduct = id(32), recurringProduct = id(33);
  await db.query("insert into public.products(id,name,sku) values($1,'Custom 8-ounce bags - Whole Bean','WHOLE-BEAN'),($2,'Other stock','STOCK'),($3,'Other catalog','ASSIGNED'),($4,'Scheduled product','RECURRING')",[wholeBean,stockProduct,assignedProduct,recurringProduct]);
  await db.query('insert into public.inventory_items(id,name,product_id,item_type,base_unit) values($1,$2,$3,$4,$5)',[id(34),'Other stock',stockProduct,'finished_good','each']);
  await db.query('insert into public.user_products(center_id,product_id) values($1,$2)',[otherCenter,assignedProduct]);
  await db.query('insert into public.recurring_order_items(recurring_order_id,product_id,qty,unit_price_cents,line_total_cents) values($1,$2,1,100,100)',[recurringId,recurringProduct]);
  for (const blockedProduct of [ordinaryProduct,stockProduct,recurringProduct]) {
    await reject(db.query('insert into public.customer_stock_products(product_id,allocation_id) values($1,$2)',[blockedProduct,allocationId]),'22023','new ordering choice');
  }
  await reject(db.query('insert into public.customer_stock_products(product_id,allocation_id) values($1,$2)',[assignedProduct,allocationId]),'42501','another customer catalog');
  await db.query('update public.orders set archived_at=now() where id=$1',[initialOrder]);
  const beforeVariant = await heldStockState();
  await db.query('insert into public.customer_stock_products(product_id,allocation_id) values($1,$2)',[wholeBean,allocationId]);
  assert.deepEqual(await heldStockState(),beforeVariant); assertions++;
  assert.equal(await stock(),1000); assertions++;
  await db.query('insert into public.user_products(center_id,product_id) values($1,$2)',[center,wholeBean]);
  await db.query('insert into public.user_product_prices(center_id,product_id,price_cents,allow_zero_price) values($1,$2,0,true)',[center,wholeBean]);
  const sharedBalance = async expected => {
    const rows = (await db.query('select * from public.get_customer_stock_balances($1) where allocation_id=$2 order by product_id',[center,allocationId])).rows;
    assert.equal(rows.length,2);
    assert.deepEqual(rows.map(row=>row.product_id).sort(),[product,wholeBean].sort());
    for (const row of rows) {
      assert.deepEqual([row.available_quantity,row.reserved_quantity,row.on_hand_quantity],expected);
      assert.equal(row.shared_product_count,2);
    }
    assertions++;
  };
  await sharedBalance([1000,0,1000]);
  const flat = (await db.query('select * from public.customer_stock_product_allocations where allocation_id=$1',[allocationId])).rows;
  assert.equal(flat.length,2); assert.ok(flat.every(row=>row.inventory_product_id===product && row.initial_order_id===initialOrder)); assertions++;
  await reject(db.query('insert into public.inventory_items(id,name,product_id,item_type,base_unit) values($1,$2,$3,$4,$5)',[id(35),'Whole bean duplicate',wholeBean,'finished_good','each']),'22023','canonical');
  await reject(db.query('update public.inventory_items set product_id=$2 where id=$1',[inventory,wholeBean]),'22023');
  await reject(db.query('delete from public.inventory_items where id=$1',[inventory]),'22023');
  await reject(db.query('insert into public.production_runs(id,product_id,quantity_produced) values($1,$2,100)',[id(36),wholeBean]),'22023');
  await reject(db.query('insert into public.customer_stock_allocations(center_id,product_id,initial_order_id,initial_quantity) values($1,$2,$3,1000)',[center,wholeBean,initialOrder]),'22023','already draws');
  await reject(db.query('insert into public.recurring_order_items(recurring_order_id,product_id,qty,unit_price_cents,line_total_cents) values($1,$2,1,0,0)',[recurringId,wholeBean]),'22023');
  await reject(item(await order(center,{recurring_order_id:recurringId}),1,{product_id:wholeBean}),'22023');
  await actor(customer);
  await sharedBalance([1000,0,1000]);
  assert.equal((await db.query('select * from public.customer_stock_product_allocations where allocation_id=$1',[allocationId])).rows.length,2); assertions++;
  await reject(db.query('insert into public.customer_stock_products(product_id,allocation_id) values($1,$2)',[assignedProduct,allocationId]),'42501');
  await reject(db.query('update public.customer_stock_products set allocation_id=$1 where product_id=$2',[allocationId,wholeBean]),'42501');
  await reject(db.query('delete from public.customer_stock_products where product_id=$1',[wholeBean]),'42501');
  const overOrder = await order();
  const groundSixHundred = await item(overOrder,600);
  await actor(secondLogin);
  await reject(item(overOrder,500,{product_id:wholeBean}),'23514','only 400');
  await sharedBalance([400,600,1000]);
  const beanFourHundred = await item(overOrder,400,{product_id:wholeBean});
  await sharedBalance([0,1000,1000]);
  await reject(item(await order(),1,{product_id:wholeBean}),'23514');
  await actor(admin);
  await reject(db.query('update public.order_items set qty=401 where id=$1',[beanFourHundred]),'23514');
  // Changing an unshipped choice keeps its one existing shared reservation.
  await db.query('update public.order_items set product_id=$2 where id=$1',[groundSixHundred,wholeBean]);
  await sharedBalance([0,1000,1000]);
  await db.query('delete from public.orders where id=$1',[overOrder]);
  await sharedBalance([1000,0,1000]);
  console.log('PASS shared mapping preserves archived original stock/costs, forbids independent inventory/traded products, and combines variants across logins for oversell protection');

  const sharedOrder = await order();
  const groundLine = await item(sharedOrder,100,{shipping_boxes_used:2});
  const beanLine = await item(sharedOrder,50,{product_id:wholeBean,shipping_boxes_used:0});
  await sharedBalance([850,150,1000]);
  await db.query('update public.orders set archived_at=now() where id=$1',[sharedOrder]);
  await sharedBalance([1000,0,1000]);
  await db.query('update public.orders set archived_at=null where id=$1',[sharedOrder]);
  await sharedBalance([850,150,1000]);
  await db.query("update public.orders set invoice_status='not_required' where id=$1",[sharedOrder]);
  await consume(groundLine,0);
  await sharedBalance([850,50,900]);
  await consume(beanLine,0);
  await consume(beanLine,0);
  await sharedBalance([850,0,850]);
  assert.equal(await stock(),850); assertions++;
  const beanMovements = (await db.query("select inventory_item_id,quantity_change,unit_cost_cents from public.inventory_movements where order_item_id=$1 and movement_type='shipment_consume'",[beanLine])).rows;
  assert.ok(beanMovements.length>0 && beanMovements.every(row=>row.inventory_item_id===inventory && Number(row.unit_cost_cents)===0));
  assert.equal(beanMovements.reduce((sum,row)=>sum-Number(row.quantity_change),0),50); assertions++;
  await db.query("update public.orders set status='Shipped' where id=$1",[sharedOrder]);
  await reject(db.query('update public.order_items set product_id=$2 where id=$1',[beanLine,product]),'22023');
  await db.query('select public.move_order_to_trash($1,$2)',[sharedOrder,'Shared stock recovery test']);
  await sharedBalance([1000,0,1000]);
  assert.equal(await stock(),1000); assertions++;
  const sharedTrash = (await db.query('select id from public.order_trash where order_id=$1 and restored_at is null',[sharedOrder])).rows[0].id;
  const conflicting = await order();
  await item(conflicting,900,{product_id:wholeBean});
  await reject(db.query('select public.restore_order_from_trash($1)',[sharedTrash]),'23514');
  assert.equal(await stock(),1000); assertions++;
  await db.query('delete from public.orders where id=$1',[conflicting]);
  await db.query('select public.restore_order_from_trash($1)',[sharedTrash]);
  await db.query('select public.restore_order_from_trash($1)',[sharedTrash]);
  await sharedBalance([850,0,850]);
  assert.equal(await stock(),850); assertions++;
  const afterRestored = await heldStockState();
  await db.query('update public.orders set archived_at=null where id=$1',[initialOrder]);
  assert.deepEqual(await heldStockState(),afterRestored); assertions++;
  await sharedBalance([850,0,850]);
  // An accidental cross-customer catalog assignment never grants stock access.
  await db.query('insert into public.user_products(center_id,product_id) values($1,$2)',[otherCenter,wholeBean]);
  await db.query('insert into public.user_product_prices(center_id,product_id,price_cents,allow_zero_price) values($1,$2,0,true)',[otherCenter,wholeBean]);
  await actor(otherCustomer);
  assert.equal((await db.query('select * from public.products where id=$1',[wholeBean])).rows.length,0); assertions++;
  assert.equal((await db.query('select * from public.customer_stock_products')).rows.length,0); assertions++;
  assert.equal((await db.query('select * from public.customer_stock_product_allocations')).rows.length,0); assertions++;
  await reject(item(await order(otherCenter),1,{product_id:wholeBean}),'42501');
  await actor(null,'anon');
  await reject(db.query('select * from public.customer_stock_products'),'42501');
  await reject(db.query('select * from public.customer_stock_product_allocations'),'42501');
  await actor(admin);
  const futureProduct = id(40), futureInventory = id(41);
  await db.query("insert into public.products(id,name,sku) values($1,'Future canonical batch','FUTURE')",[futureProduct]);
  await db.query('insert into public.inventory_items(id,name,product_id,item_type,base_unit) values($1,$2,$3,$4,$5)',[futureInventory,'Future canonical batch',futureProduct,'finished_good','each']);
  const futureOriginal = await order(otherCenter,{status:'Shipped',subtotal_cents:100});
  await item(futureOriginal,1,{product_id:futureProduct,unit_price_cents:100,line_total_cents:100});
  await db.query('insert into public.held_stock_sales(order_id,processing_fee_cents) values($1,0)',[futureOriginal]);
  const futureAllocation = (await db.query('insert into public.customer_stock_allocations(center_id,product_id,initial_order_id,initial_quantity) values($1,$2,$3,1) returning id',[otherCenter,futureProduct,futureOriginal])).rows[0].id;
  assert.deepEqual((await db.query('select * from public.customer_stock_products where product_id=$1',[futureProduct])).rows,[{product_id:futureProduct,allocation_id:futureAllocation}]); assertions++;
  const viewOptions = (await db.query("select reloptions from pg_class where oid='public.customer_stock_product_allocations'::regclass")).rows[0].reloptions;
  assert.ok(viewOptions.includes('security_invoker=true')); assertions++;
  await actor(null,'service_role');
  await reject(db.query('update public.customer_stock_products set allocation_id=$1 where product_id=$2',[allocationId,wholeBean]),'22023');
  await reject(db.query('delete from public.customer_stock_products where product_id=$1',[wholeBean]),'22023');
  await sharedBalance([850,0,850]);
  console.log('PASS 100 ground + 50 whole bean reserve/ship/recover exactly 150 canonical bags, shared free billing, ownership/RLS, archived original behavior and immutable mappings');
  await actor(null,'service_role');
  await balance([850,0,850]);
  const rpcDefinitions = (await db.query(`select p.proname,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('get_customer_stock_balances','consume_customer_stock_for_order_item')`)).rows;
  assert.equal(rpcDefinitions.length,2); assert.ok(rpcDefinitions.every(row=>!row.prosecdef)); assertions++;
  // Both BEFORE trigger paths serialize on the same allocation rows. PGlite is
  // single-session, so a multi-connection race requires a real PostgreSQL test.
  assert.match(migration,/where a\.product_id in \(v_old_product, v_new_product\)[\s\S]*?order by a\.id for update/); assertions++;
  assert.match(migration,/select \* into v_allocation[\s\S]*?for update/); assertions++;
  assert.match(sharedMigration,/sp\.product_id = v_item\.product_id for update of a/); assertions++;
  assert.match(sharedMigration,/inventory_items where product_id = v_allocation\.product_id for update/); assertions++;
  console.log(`PASS recurring guard, invoice exemption scope, service access and invoker-only public RPCs; ${assertions} assertions total`);
} finally {
  await db.close();
}
