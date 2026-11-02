// Isolated PostgreSQL verification; never connects to a live database.
// SHOPIFY_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-shopify-orders-db.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

if (!process.env.SHOPIFY_PGLITE_MODULE) throw new Error('Set SHOPIFY_PGLITE_MODULE to an installed PGlite module.');
const { PGlite } = await import(pathToFileURL(process.env.SHOPIFY_PGLITE_MODULE).href);
const db = new PGlite();
const migration = await readFile(new URL('../db/migrations/20261009132818_shopify_paid_orders.sql', import.meta.url), 'utf8');
const localDeliveryMigration = await readFile(new URL('../db/migrations/20261009214649_shopify_local_delivery.sql', import.meta.url), 'utf8');
const productId = '10000000-0000-4000-8000-000000000001';
const source = { financial_status: 'paid', currency: 'USD', test: false, fulfillment_status: null, cancelled_at: null };
const item = { product_id: productId, shopify_variant_id: 'gid://shopify/ProductVariant/1', qty: 2, unit_price_cents: 1200, line_total_cents: 2400, product_name_snapshot: 'Coffee', shopify_line_item_id: 'gid://shopify/LineItem/1' };
const order = { shopify_shop_domain: 'sobrew.myshopify.com', shopify_order_id: 'gid://shopify/Order/1', shipping_name: 'Buyer',
  shipping_address1: '1 Main', shipping_city: 'Chicago', shipping_state: 'IL', shipping_zip: '60601', shipping_country: 'US',
  shopify_email: 'buyer@example.com', subtotal_cents: 2400, created_at: '2026-10-09T12:00:00Z' };
async function receipt(id = 1, payload = source) {
  return (await db.query('select public.save_shopify_order_import($1,$2,$3,$4,$5) as id',
    ['sobrew.myshopify.com', `gid://shopify/Order/${id}`, `#${id}`, 'orders/paid', JSON.stringify(payload)])).rows[0].id;
}
async function importOrder(receiptId, overrides = {}, items = [item]) {
  return (await db.query('select public.import_shopify_order($1,$2) as id', [JSON.stringify({ ...order, ...overrides, import_id: receiptId }), JSON.stringify(items)])).rows[0].id;
}
async function count(table) { return (await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n; }
async function reject(operation, code) { await assert.rejects(operation, error => !code || error.code === code); }
const catalogVariant = { shop_domain: 'sobrew.myshopify.com', product_id: 'gid://shopify/Product/2',
  variant_id: 'gid://shopify/ProductVariant/2', sku: 'COFFEE', name: 'Store variant', description: 'Description',
  active: true, updated_at: '2026-10-09T10:00:00Z' };
async function syncVariant(overrides = {}) {
  return (await db.query('select public.sync_shopify_product_variant($1) as result', [JSON.stringify({ ...catalogVariant, ...overrides })])).rows[0].result;
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role outsider;
    create schema private;
    create table public.products(id uuid primary key default gen_random_uuid(), name text, description text, sku text unique,
      active boolean, category text, image_url text, shipping_box_count_required boolean default false);
    create table public.orders(
      id uuid primary key default gen_random_uuid(), user_id uuid, center_id uuid, center_location_id uuid,
      recurring_order_id uuid, recurring_scheduled_for timestamptz, prospecting_lead_id uuid,
      status text default 'New', order_kind text default 'standard', fulfillment_method text not null default 'carrier'
        check(fulfillment_method in ('carrier', 'local_delivery')),
      shipping_name text, shipping_company text, shipping_address1 text, shipping_address2 text, shipping_city text,
      shipping_state text, shipping_zip text, notes text, subtotal_cents int not null default 0,
      created_at timestamptz default now(), invoice_status text not null default 'not_invoiced',
      quickbooks_invoice_id text, quickbooks_payment_id text, quickbooks_payment_charge_id text,
      constraint orders_invoice_status_check check(invoice_status in ('not_invoiced','invoicing','invoiced','invoice_error'))
    );
    create table public.order_items(id uuid primary key default gen_random_uuid(), order_id uuid references orders on delete cascade,
      product_id uuid references products, product_name_snapshot text, qty int not null check(qty > 0),
      unit_price_cents int not null, line_total_cents int not null);
    create table public.user_product_prices(center_id uuid, product_id uuid, price_cents int, allow_zero_price boolean);
    insert into public.products(id,name,sku,active) values ('${productId}', 'Coffee', 'COFFEE', true);
    alter table public.orders enable row level security;
    create policy fixture_admin_all on public.orders for all to authenticated using(true) with check(true);
    grant select, insert, update, delete on public.orders, public.order_items, public.products to service_role, authenticated;
    -- Prove the migration revokes inherited broad defaults on its sensitive inbox.
    alter default privileges in schema public grant all on tables to public, anon, authenticated, service_role;
  `);
  await db.exec(migration);
  await db.exec(localDeliveryMigration);
  await db.query("update products set shopify_shop_domain='sobrew.myshopify.com', shopify_product_id='gid://shopify/Product/1',shopify_variant_id='gid://shopify/ProductVariant/1' where id=$1", [productId]);
  await db.exec(`create trigger validate_order_item_price before insert or update of unit_price_cents,product_id,order_id
    on public.order_items for each row execute function private.validate_order_item_price();`);
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.shopify_order_imports'::regclass")).rows[0].relrowsecurity, true);
  await db.exec('set role service_role');
  const catalogFirst = await syncVariant();
  assert.equal(catalogFirst.created, true); assert.notEqual(catalogFirst.id, productId);
  const importedProduct = (await db.query('select * from products where id=$1', [catalogFirst.id])).rows[0];
  assert.equal(importedProduct.sku, 'SHOPIFY-2'); assert.equal(importedProduct.shopify_sku, 'COFFEE'); assert.equal(importedProduct.category, null);
  assert.deepEqual(await syncVariant(), { id: catalogFirst.id, created: false });
  await db.query("update products set sku='LOCAL-RECIPE-SKU',category='retail',image_url='custom.png',shipping_box_count_required=true where id=$1", [catalogFirst.id]);
  await syncVariant({ sku: 'NEW-STORE-SKU', name: 'New Shopify name', updated_at: '2026-10-09T11:00:00Z' });
  await syncVariant({ name: 'Stale name', updated_at: '2026-10-09T09:00:00Z' });
  const resyncedProduct = (await db.query('select * from products where id=$1', [catalogFirst.id])).rows[0];
  assert.equal(resyncedProduct.name, 'New Shopify name'); assert.equal(resyncedProduct.shopify_sku, 'NEW-STORE-SKU');
  assert.equal(resyncedProduct.sku, 'LOCAL-RECIPE-SKU'); assert.equal(resyncedProduct.category, 'retail');
  assert.equal(resyncedProduct.image_url, 'custom.png'); assert.equal(resyncedProduct.shipping_box_count_required, true);
  const noSku = await syncVariant({ variant_id: 'gid://shopify/ProductVariant/3', sku: null });
  assert.equal((await db.query('select sku from products where id=$1', [noSku.id])).rows[0].sku, 'SHOPIFY-3');
  await db.query("insert into shopify_product_imports(shop_domain,shopify_product_id,webhook_id,topic,payload) values('sobrew.myshopify.com','gid://shopify/Product/2','event','products/create','{}')");
  await db.query("update shopify_product_imports set status='error',error='Retry' where webhook_id='event'");
  await reject(db.query("update shopify_product_imports set payload='{}' where webhook_id='event'"), '42501');
  console.log('PASS variant-based catalog creates without matching SKUs, SKU collision/blank fallback, stable IDs, stale-update protection, preserved portal SKU/category/image/COGS settings, durable product event errors');
  const firstReceipt = await receipt();
  const duplicateReceipt = await receipt(1, { ...source, financial_status: 'refunded' });
  assert.equal(duplicateReceipt, firstReceipt);
  assert.deepEqual((await db.query('select payload from shopify_order_imports where id=$1', [firstReceipt])).rows[0].payload, source);
  const first = await importOrder(firstReceipt);
  assert.equal(await importOrder(firstReceipt), first);
  assert.equal(await count('orders'), 1); assert.equal(await count('order_items'), 1);
  const saved = (await db.query('select * from orders where id=$1', [first])).rows[0];
  assert.equal(saved.order_source, 'shopify'); assert.equal(saved.invoice_status, 'not_required');
  assert.equal(saved.status, 'New'); assert.equal(saved.fulfillment_method, 'carrier'); assert.equal(saved.center_id, null); assert.equal(saved.user_id, null);
  assert.deepEqual(saved.shopify_line_items, [{ line_item_id: item.shopify_line_item_id, quantity: 2, product_id: productId }]);
  assert.equal(saved.shipping_country, 'US');
  console.log('PASS atomic mapped import, immutable webhook snapshot, normal New/carrier workflow, no billing/customer attribution, duplicate receipt and replay dedupe');

  await reject(db.query("update orders set invoice_status='invoicing' where id=$1", [first]), '23514');
  await reject(db.query("update orders set quickbooks_payment_id='payment' where id=$1", [first]), '23514');
  await reject(db.query("update orders set center_id='20000000-0000-4000-8000-000000000001' where id=$1", [first]), '23514');
  await reject(db.query("update shopify_order_imports set status='error',order_id=null where id=$1", [firstReceipt]), '42501');
  await reject(db.query('delete from shopify_order_imports where id=$1', [firstReceipt]), '42501');
  await db.query('delete from orders where id=$1', [first]);
  assert.equal(await importOrder(firstReceipt), first); assert.equal(await count('orders'), 0);
  console.log('PASS no Shopify invoice/payment/center assignment, immutable successful receipts and no resurrection after order deletion');

  const secondReceipt = await receipt(2);
  await reject(importOrder(secondReceipt, { shopify_order_id: 'gid://shopify/Order/2' }, [{ ...item, shopify_variant_id: 'gid://shopify/ProductVariant/999' }]), '22023');
  await reject(importOrder(secondReceipt, { shopify_order_id: 'gid://shopify/Order/2', subtotal_cents: 2000 }), '22023');
  assert.equal(await count('orders'), 0);
  await db.exec('reset role');
  await db.exec(`create function public.fixture_reject_item() returns trigger language plpgsql as $$begin
    if new.product_name_snapshot = 'Reject' then raise exception 'simulated item failure'; end if; return new; end;$$;
    create trigger fixture_reject_item before insert on order_items for each row execute function fixture_reject_item();
    set role service_role;`);
  await reject(importOrder(secondReceipt, { shopify_order_id: 'gid://shopify/Order/2', subtotal_cents: 4800 }, [item, { ...item, product_name_snapshot: 'Reject', shopify_line_item_id: 'gid://shopify/LineItem/2' }]));
  assert.equal(await count('orders'), 0); assert.equal(await count('order_items'), 0);
  assert.equal((await db.query('select status from shopify_order_imports where id=$1', [secondReceipt])).rows[0].status, 'pending');
  const second = await importOrder(secondReceipt, { shopify_order_id: 'gid://shopify/Order/2', subtotal_cents: 0 }, [{ ...item, unit_price_cents: 0, line_total_cents: 0 }]);
  assert.equal((await db.query('select subtotal_cents from orders where id=$1', [second])).rows[0].subtotal_cents, 0);
  console.log('PASS variant identity/total validation, failed second item rolls back header and first item, retry succeeds, fully discounted Shopify lines accepted');

  await db.exec('reset role');
  for (const role of ['anon', 'authenticated', 'outsider']) {
    await db.exec(`set role ${role}`);
    await reject(db.query('select * from shopify_order_imports'), '42501');
    await reject(db.query('select * from shopify_product_imports'), '42501');
    await reject(syncVariant(), '42501');
    await reject(receipt(9), '42501'); await reject(importOrder(secondReceipt), '42501');
    await db.exec('reset role');
  }
  await db.exec('set role authenticated');
  await reject(db.query("insert into orders(order_source,shopify_shop_domain,shopify_order_id) values('shopify','sobrew.myshopify.com','gid://shopify/Order/99')"), '42501');
  await reject(db.query("update orders set order_source='portal' where id=$1", [second]), '42501');
  await reject(db.query("update orders set shopify_sync_status='synced' where id=$1", [second]), '42501');
  await reject(db.query("update products set shopify_variant_id='gid://shopify/ProductVariant/999' where id=$1", [catalogFirst.id]), '42501');
  await db.query("update products set category='ground' where id=$1", [catalogFirst.id]);
  await db.query("update orders set notes='Normal admin edit',status='Processing' where id=$1", [second]);
  await db.query("update orders set fulfillment_method='local_delivery',status='Shipped' where id=$1", [second]);
  assert.deepEqual((await db.query('select fulfillment_method,status,invoice_status from orders where id=$1', [second])).rows[0], {
    fulfillment_method: 'local_delivery', status: 'Shipped', invoice_status: 'not_required',
  });
  for (const field of ['quickbooks_invoice_id', 'quickbooks_payment_id', 'quickbooks_payment_charge_id']) {
    await reject(db.query(`update orders set ${field}='forbidden-billing' where id=$1`, [second]), '23514');
  }
  await reject(db.query("update orders set invoice_status='invoiced' where id=$1", [second]), '23514');
  await reject(db.query("update orders set fulfillment_method='unsupported' where id=$1", [second]), '23514');
  console.log('PASS authorized Shopify local delivery preserves prepaid invoice/payment guards and valid fulfillment methods');
  await db.query('insert into orders(order_source,shopify_line_items,shopify_sync_status,shipping_tracking_numbers) values(null,null,null,null)');
  const oldSnapshot = (await db.query("select * from orders where order_source='portal'")).rows[0];
  assert.equal(oldSnapshot.shopify_sync_status, 'pending'); assert.deepEqual(oldSnapshot.shopify_line_items, []); assert.deepEqual(oldSnapshot.shipping_tracking_numbers, []);
  await reject(db.query("update orders set invoice_status='not_required' where id=$1", [oldSnapshot.id]), '23514');
  await reject(db.query('insert into order_items(order_id,product_id,qty,unit_price_cents,line_total_cents) values($1,$2,1,0,0)', [oldSnapshot.id, productId]), '22023');
  await db.exec('reset role');
  console.log('PASS API roles cannot read inbox/call import/forge identity or sync, normal admin workflow remains allowed, historical snapshots restore new defaults, portal zero-price guard retained');
} finally { await db.close(); }
