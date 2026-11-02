// Isolated PostgreSQL regression tests; never connects to a live database.
// CUSTOMER_LOCATIONS_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-customer-locations-db.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.CUSTOMER_LOCATIONS_PGLITE_MODULE;
if (!modulePath) throw new Error('Set CUSTOMER_LOCATIONS_PGLITE_MODULE to an installed PGlite module.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const migration = await readFile(new URL('../db/migrations/20261012151002_customer_location_self_service.sql', import.meta.url), 'utf8');
const baseLocations = await readFile(new URL('../db/migrations/022_center_locations.sql', import.meta.url), 'utf8');
const restock = await readFile(new URL('../db/migrations/048_quick_restock_performance.sql', import.meta.url), 'utf8');
const sharedCenters = await readFile(new URL('../db/migrations/011_centers_shared_access.sql', import.meta.url), 'utf8');
const recurringNotes = await readFile(new URL('../db/migrations/20260908192308_preserve_recurring_delivery_notes.sql', import.meta.url), 'utf8');
const deliveryUpdates = await readFile(new URL('../db/migrations/20261009125507_center_order_delivery_updates.sql', import.meta.url), 'utf8');
const id = (number) => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const centerA = id(1), centerB = id(2), inactiveCenter = id(3);
const customerA = id(11), customerA2 = id(12), customerB = id(13), inactiveCustomer = id(14);
const inactiveCenterCustomer = id(15), admin = id(16), inactiveAdmin = id(17), noCenterCustomer = id(18);
const locationA = id(101), locationB = id(102), inactiveLocation = id(103), inactiveCenterLocation = id(104);
let passed = 0;

async function actor(user, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  await db.exec(`set role ${role}`);
}
async function reject(operation, code = '42501') {
  await assert.rejects(operation, error => error.code === code);
  passed++;
}
async function insert(overrides = {}) {
  const values = { center_id: centerA, name: 'Main location', address1: '100 Main St', address2: null,
    city: 'Chicago', state: 'IL', zip: '60601', ...overrides };
  const fields = Object.keys(values);
  return db.query(`insert into public.center_locations (${fields.join(',')}) values (${fields.map((_, index) => `$${index + 1}`).join(',')}) returning *`, Object.values(values));
}
async function update(location, overrides) {
  const fields = Object.keys(overrides);
  return db.query(`update public.center_locations set ${fields.map((field, index) => `${field}=$${index + 1}`).join(',')} where id=$${fields.length + 1} returning *`, [...Object.values(overrides), location]);
}
function migrationFunction(name) {
  const match = restock.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\(\\)[\\s\\S]*?\\$function\\$;`));
  assert.ok(match, `Missing existing authorization function ${name}`);
  return match[0];
}
function migrationPolicy(sql, name) {
  const match = sql.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
  assert.ok(match, `Missing existing authorization policy ${name}`);
  return match[0];
}
async function order(overrides = {}) {
  const values = { id: id(1000 + passed), center_id: centerA, center_location_id: locationA,
    order_kind: 'standard', recurring_order_id: id(800), shipping_name: 'Source recipient',
    shipping_address1: 'Source address', shipping_address2: 'Source suite', shipping_city: 'Source city',
    shipping_state: 'OH', shipping_zip: '43001', notes: 'Auto-generated recurring order (monthly)', ...overrides };
  const fields = Object.keys(values);
  return (await db.query(`insert into public.orders (${fields.join(',')}) values (${fields.map((_, index) => `$${index + 1}`).join(',')}) returning *`, Object.values(values))).rows[0];
}

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    grant usage on schema auth, private to authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table public.centers(id uuid primary key, name text, is_active boolean not null default true);
    create table public.profiles(id uuid primary key, center_id uuid references public.centers,
      is_admin boolean not null default false, is_active boolean not null default true);
    create table public.orders(id uuid primary key, center_id uuid references public.centers,
      shipping_name text, shipping_address1 text, shipping_address2 text, shipping_city text,
      shipping_state text, shipping_zip text, order_kind text not null default 'standard',
      recurring_order_id uuid, notes text, created_at timestamptz not null default now());
    create table public.recurring_orders(id uuid primary key, source_order_id uuid references public.orders);
    create table public.order_items(id uuid primary key default gen_random_uuid(), order_id uuid references public.orders);
  `);
  for (const name of ['private.is_admin', 'private.current_center_id', 'public.is_admin', 'public.current_center_id']) {
    await db.exec(migrationFunction(name));
  }
  await db.exec(`
    alter table public.profiles enable row level security;
    alter table public.centers enable row level security;
    grant select on public.profiles, public.centers to authenticated;
    grant select on public.centers to service_role;
    insert into public.centers values ('${centerA}','A',true),('${centerB}','B',true),('${inactiveCenter}','Inactive',false);
    insert into public.profiles values
      ('${customerA}','${centerA}',false,true),('${customerA2}','${centerA}',false,true),
      ('${customerB}','${centerB}',false,true),('${inactiveCustomer}','${centerA}',false,false),
      ('${inactiveCenterCustomer}','${inactiveCenter}',false,true),('${admin}',null,true,true),
      ('${inactiveAdmin}','${centerA}',true,false),('${noCenterCustomer}',null,false,true);
  `);
  // Load the real read policies and their SECURITY DEFINER authorization
  // helpers, rather than disabling RLS for the new invoker helper's lookups.
  await db.exec(migrationPolicy(restock, 'authenticated read profiles'));
  await db.exec(migrationPolicy(sharedCenters, 'admin all centers'));
  await db.exec(migrationPolicy(sharedCenters, 'self read center'));
  await db.exec(baseLocations);
  await db.exec(`
    grant all on public.center_locations to public, anon, authenticated, service_role;
    insert into public.center_locations (id,center_id,name,address1,city,state,zip,notes,is_active) values
      ('${locationA}','${centerA}','A location','Old address','Chicago','IL','60601','Internal admin instructions',true),
      ('${locationB}','${centerB}','B location','B address','Chicago','IL','60602',null,true),
      ('${inactiveLocation}','${centerA}','Inactive location','Closed address','Chicago','IL','60601',null,false),
      ('${inactiveCenterLocation}','${inactiveCenter}','Inactive center location','Closed address','Chicago','IL','60601',null,true);
    insert into public.orders (id,center_id,shipping_name,shipping_address1,shipping_city,shipping_state,shipping_zip,center_location_id,notes)
      values ('${id(900)}','${centerA}','A location','Old address','Chicago','IL','60601','${locationA}','Keep this delivery instruction');
    insert into public.recurring_orders values ('${id(800)}','${id(900)}');
  `);
  const beforeOrder = (await db.query('select * from public.orders')).rows;
  await db.exec(recurringNotes);
  await db.exec(deliveryUpdates);
  await db.exec(migration);

  await actor(customerA);
  assert.deepEqual((await db.query('select id from public.center_locations')).rows.map(row => row.id), [locationA]); passed++;
  const created = (await insert({ name: '  Branch  ', address1: '  200 Main St  ', address2: ' Suite 2 ', city: ' Chicago ', state: ' il ', zip: ' 60601-1234 ' })).rows[0];
  assert.equal(created.center_id, centerA); assert.equal(created.is_active, true); assert.equal(created.notes, null);
  assert.equal(created.name, 'Branch'); assert.equal(created.address1, '200 Main St'); assert.equal(created.address2, 'Suite 2');
  assert.equal(created.city, 'Chicago'); assert.equal(created.state, 'IL'); assert.equal(created.zip, '60601-1234'); passed++;
  const changed = (await update(locationA, { name: 'Updated', address1: '500 New St', address2: ' ', state: 'il', updated_at: '1999-01-01' })).rows[0];
  assert.equal(changed.address1, '500 New St'); assert.equal(changed.address2, null);
  assert.equal(changed.notes, 'Internal admin instructions'); assert.ok(new Date(changed.updated_at) > new Date(changed.created_at)); passed++;
  const forged = (await insert({ id: id(999), created_at: '1999-01-01', updated_at: '1999-01-01' })).rows[0];
  assert.notEqual(forged.id, id(999)); assert.ok(new Date(forged.created_at) > new Date('2026-01-01'));
  assert.ok(new Date(forged.updated_at) > new Date('2026-01-01')); passed++;

  await reject(insert({ center_id: centerB }));
  assert.equal((await update(locationB, { address1: 'Cross-center edit' })).rows.length, 0); passed++;
  assert.equal((await update(inactiveLocation, { address1: 'Inactive edit', is_active: true })).rows.length, 0); passed++;
  for (const change of [
    { id: id(999) }, { center_id: centerB }, { is_active: false },
    { created_at: '1999-01-01' }, { notes: 'Customer override' },
  ]) await reject(update(locationA, change));
  await reject(insert({ is_active: false }));
  await reject(insert({ notes: 'Customer internal note' }));
  assert.equal((await db.query('delete from public.center_locations where id=$1 returning id', [locationA])).rows.length, 0); passed++;
  await reject(db.query('truncate public.center_locations cascade'));

  for (const change of [
    { name: '' }, { name: ' ' }, { name: 'x'.repeat(101) }, { address1: '' }, { address1: 'x'.repeat(201) },
    { address2: 'x'.repeat(201) }, { city: '' }, { city: 'x'.repeat(101) }, { state: 'ZZ' },
    { state: 'Illinois' }, { zip: '6060' }, { zip: '606011' }, { zip: '60601-123' }, { zip: '60601-12345' },
  ]) {
    await reject(insert(change), '22023');
    await reject(update(locationA, change), '22023');
  }
  // Every editable field rejects controls before normalization, including
  // leading/trailing whitespace that JavaScript trim would otherwise remove.
  for (const [field, value] of Object.entries({ name: 'Main', address1: '100 Main', address2: 'Suite 2', city: 'Chicago', state: 'IL', zip: '60601' })) {
    for (const control of ['\t', '\n', '\r', '\u0001', '\u001f', '\u007f']) {
      await reject(insert({ [field]: `${control}${value}` }), '22023');
      await reject(update(locationA, { [field]: `${value}${control}` }), '22023');
    }
  }
  for (const state of ['DC', 'PR', 'AS', 'GU', 'MP', 'VI', 'AA', 'AE', 'AP']) {
    assert.equal((await update(created.id, { state })).rows[0].state, state); passed++;
  }
  await actor(customerA2);
  assert.equal((await update(locationA, { city: 'Shared center' })).rows.length, 1); passed++;

  for (const [user, center, location] of [
    [inactiveCustomer, centerA, locationA], [inactiveCenterCustomer, inactiveCenter, inactiveCenterLocation],
    [inactiveAdmin, centerA, locationA], [noCenterCustomer, centerA, locationA], [null, centerA, locationA],
  ]) {
    await actor(user);
    assert.equal((await db.query('select * from public.center_locations')).rows.length, 0); passed++;
    await reject(insert({ center_id: center }));
    assert.equal((await update(location, { city: 'Denied' })).rows.length, 0); passed++;
  }
  await actor(null, 'anon');
  await reject(db.query('select * from public.center_locations'));
  await reject(insert());
  await reject(update(locationA, { city: 'Denied' }));
  await reject(db.query('delete from public.center_locations'));
  await reject(db.query('select private.customer_location_center_id()'));

  await actor(admin);
  assert.ok((await db.query('select * from public.center_locations')).rows.some(row => row.id === inactiveLocation)); passed++;
  assert.equal((await update(locationB, { city: 'Admin edit', notes: 'Admin instructions', is_active: false })).rows[0].is_active, false); passed++;
  const adminLocation = (await insert({ id: id(888), center_id: inactiveCenter, name: 'Admin partial address', address1: '', city: '', state: '', zip: '', notes: 'Admin notes', is_active: false })).rows[0];
  assert.equal(adminLocation.id, id(888)); assert.equal(adminLocation.notes, 'Admin notes'); passed++;
  assert.equal((await db.query('delete from public.center_locations where id=$1 returning id', [adminLocation.id])).rows.length, 1); passed++;

  await actor(null, 'service_role');
  const serviceLocation = (await insert({ id: id(889), center_id: centerB, name: 'Service partial', address1: '', state: '', zip: '', notes: 'Service notes' })).rows[0];
  assert.equal(serviceLocation.id, id(889)); passed++;
  await db.exec('reset role');
  assert.deepEqual((await db.query('select * from public.orders')).rows, beforeOrder); passed++;

  const currentLocation = (await db.query('select * from public.center_locations where id=$1', [locationA])).rows[0];
  const generated = await order();
  for (const [orderField, locationField] of Object.entries({ shipping_name: 'name', shipping_address1: 'address1', shipping_address2: 'address2', shipping_city: 'city', shipping_state: 'state', shipping_zip: 'zip' })) {
    assert.equal(generated[orderField], currentLocation[locationField]);
  }
  assert.equal(generated.notes, 'Keep this delivery instruction\n\nAuto-generated recurring order (monthly)'); passed++;
  assert.deepEqual((await db.query('select * from public.orders where id=$1', [id(900)])).rows, beforeOrder); passed++;

  await db.query('update public.center_locations set is_active=true where id=$1', [locationB]);
  for (const overrides of [
    { center_location_id: locationB }, { center_location_id: inactiveLocation },
    { center_id: inactiveCenter, center_location_id: inactiveCenterLocation },
    { center_location_id: null }, { order_kind: 'sample' }, { recurring_order_id: null },
  ]) {
    const untouched = await order(overrides);
    assert.equal(untouched.shipping_name, 'Source recipient'); assert.equal(untouched.shipping_address1, 'Source address'); passed++;
  }
  // Restore bypasses both recurring note copying and address refresh.
  await db.query("select set_config('app.restoring_order', $1, false)", [id(1999)]);
  const restored = await order({ id: id(1999) });
  assert.equal(restored.shipping_name, 'Source recipient'); assert.equal(restored.shipping_address1, 'Source address');
  assert.equal(restored.notes, 'Auto-generated recurring order (monthly)'); passed++;
  await db.query("select set_config('app.restoring_order', '', false)");

  // Exercise actual existing delivery triggers: the operator default precedes
  // the new snapshot trigger, explicit locations win, and notices remain once.
  await db.query('insert into private.center_order_delivery_updates(center_id,location_id,next_order_note) values ($1,$2,$3)', [centerA, locationA, 'One-time delivery notice']);
  await db.query('update public.orders set notes=$1 where id=$2', ['Keep this delivery instruction\n\nOne-time delivery notice', id(900)]);
  const explicit = await order({ center_location_id: created.id });
  assert.equal(explicit.center_location_id, created.id); assert.equal(explicit.shipping_name, created.name);
  assert.equal(explicit.shipping_address1, created.address1); assert.ok(!explicit.notes.includes('One-time delivery notice')); passed++;
  const operatorDefault = await order({ center_location_id: null });
  assert.equal(operatorDefault.center_location_id, locationA); assert.equal(operatorDefault.shipping_name, currentLocation.name);
  assert.equal(operatorDefault.shipping_address1, currentLocation.address1); passed++;
  await db.query('insert into public.order_items(order_id) values ($1)', [operatorDefault.id]);
  const notified = (await db.query('select notes from public.orders where id=$1', [operatorDefault.id])).rows[0].notes;
  assert.equal(notified, 'Keep this delivery instruction\n\nAuto-generated recurring order (monthly)\n\nOne-time delivery notice'); passed++;
  const nextRecurring = await order();
  await db.query('insert into public.order_items(order_id) values ($1)', [nextRecurring.id]);
  assert.equal((await db.query('select notes from public.orders where id=$1', [nextRecurring.id])).rows[0].notes,
    'Keep this delivery instruction\n\nAuto-generated recurring order (monthly)'); passed++;
  await db.query("select set_config('app.restoring_order', $1, false)", [id(2000)]);
  const restoredAfterNotice = await order({ id: id(2000), center_location_id: null, notes: 'Original delivery note' });
  assert.equal(restoredAfterNotice.center_location_id, null); assert.equal(restoredAfterNotice.shipping_address1, 'Source address');
  assert.equal(restoredAfterNotice.notes, 'Original delivery note'); passed++;
  await db.query("select set_config('app.restoring_order', '', false)");

  const functions = (await db.query("select p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('customer_location_center_id','guard_customer_location_write','apply_recurring_saved_location')")).rows;
  assert.equal(functions.length, 3); assert.ok(functions.every(row => row.prosecdef === false && row.proconfig.includes('search_path=""'))); passed++;
  console.log(`PASS ${passed} customer-location assertions: real profile/center RLS, own-center edits, controls/validation, protected fields, no customer deletes, admin/service compatibility, recurring snapshots, restores, and one-time delivery notes.`);
} finally {
  await db.close();
}
