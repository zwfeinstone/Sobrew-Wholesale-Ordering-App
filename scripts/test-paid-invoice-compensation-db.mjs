// Isolated PostgreSQL-compatible migration verification; never connects to a live DB.
// COMPENSATION_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-paid-invoice-compensation-db.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.COMPENSATION_PGLITE_MODULE;
if (!modulePath) throw new Error('Set COMPENSATION_PGLITE_MODULE to an installed @electric-sql/pglite module.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const migration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');
const actor = crypto.randomUUID();
const historicalCenter = crypto.randomUUID();
const unpaidCenter = crypto.randomUUID();
const manualSpiff = crypto.randomUUID();
const paidOrder = crypto.randomUUID();
const unpaidOrder = crypto.randomUUID();
const historicalDelayedCenter = crypto.randomUUID();
const historicalDelayedOrder = crypto.randomUUID();

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema private;
    create table profiles(id uuid primary key);
    create table centers(id uuid primary key, name text);
    create table orders(id uuid primary key default gen_random_uuid(), center_id uuid references centers(id),
      created_at timestamptz default now(), order_kind text default 'standard');
    create table order_trash(center_id uuid, order_id uuid, order_snapshot jsonb, deleted_at timestamptz);
    create table admin_audit_log(id uuid primary key default gen_random_uuid(), action text, section_key text,
      actor_profile_id uuid references profiles(id), target_profile_id uuid references profiles(id),
      after_value jsonb, created_at timestamptz default now());
    create table admin_weekly_sales_spiffs(id uuid primary key default gen_random_uuid(),
      profile_id uuid references profiles(id) on delete set null, week_start_date date, week_end_date date,
      amount_cents numeric, paid_at timestamptz, paid_by uuid references profiles(id), notes text,
      created_by uuid references profiles(id), updated_by uuid references profiles(id));
    create table monthly_commission_payouts(id uuid primary key default gen_random_uuid(),
      sales_profile_id uuid references profiles(id), commission_month date,
      status text, commission_cents numeric, paid_at timestamptz);
  `);
  await db.exec(`begin; ${await migration('20260924210943_first_order_sales_spiff.sql')} commit;`);
  await db.query('insert into profiles values ($1)', [actor]);
  await db.query('insert into centers values ($1, $2), ($3, $4)', [historicalCenter, 'Paid history', unpaidCenter, 'Unpaid history']);
  await db.query(`insert into admin_audit_log(action, actor_profile_id, after_value)
    select 'center_created', $1, jsonb_build_object('center_id', id, 'sales_assigned_to_creator', true)
    from centers`, [actor]);
  await db.query(`insert into orders(id, center_id, created_at)
    values ($1, $2, '2026-09-29 12:00:00+00'), ($3, $4, '2026-09-30 10:00:00+00')`, [paidOrder, historicalCenter, unpaidOrder, unpaidCenter]);
  await db.query('insert into centers values ($1, $2)', [historicalDelayedCenter, 'Historical delayed attribution']);
  await db.query("insert into orders(id, center_id, created_at) values ($1, $2, '2026-09-29 12:00:00+00')", [historicalDelayedOrder, historicalDelayedCenter]);
  const legacySpiffs = (await db.query('select * from admin_weekly_sales_spiffs order by id')).rows;
  const paidSpiff = legacySpiffs.find(row => row.notes.includes(paidOrder));
  await db.query("update admin_weekly_sales_spiffs set paid_at = '2026-09-25 12:00:00+00', paid_by = $1 where id = $2", [actor, paidSpiff.id]);
  await db.query('delete from orders where id = $1', [paidOrder]);
  await db.query(`insert into admin_weekly_sales_spiffs(id, profile_id, amount_cents, notes)
    values ($1, $2, 5500, $3)`, [manualSpiff, actor, `Manual note mentioning ${unpaidOrder}`]);
  await db.query(`insert into monthly_commission_payouts(sales_profile_id, commission_month, status, commission_cents, paid_at)
    values ($1, '2026-09-01', 'paid', 31415, '2026-09-25 12:00:00+00')`, [actor]);
  const beforeSpiffs = (await db.query('select * from admin_weekly_sales_spiffs order by id')).rows;
  const beforePayouts = (await db.query('select * from monthly_commission_payouts order by id')).rows;
  const beforeReceipts = (await db.query('select * from private.customer_first_order_spiffs order by center_id')).rows;

  await db.exec(await migration('20260930170646_paid_invoice_sales_compensation.sql'));
  const afterSpiffs = (await db.query('select * from admin_weekly_sales_spiffs order by id')).rows;
  assert.deepEqual(afterSpiffs.map(({ first_order_id, ...row }) => row), beforeSpiffs);
  assert.ok(afterSpiffs.every(row => row.first_order_id === null), 'Existing paid, unpaid, and manual SPIFFs must not be backfilled');
  assert.deepEqual((await db.query('select * from private.customer_first_order_spiffs order by center_id')).rows, beforeReceipts);
  const afterPayouts = (await db.query('select * from monthly_commission_payouts order by id')).rows;
  assert.deepEqual(afterPayouts.map(({ paid_order_ids, ...row }) => row), beforePayouts);
  assert.equal(afterPayouts[0].paid_order_ids, null);
  console.log('PASS no backfill: existing paid/unpaid/manual SPIFFs, receipts, and legacy payout history remain unchanged');

  await db.query(`insert into admin_audit_log(action, actor_profile_id, after_value)
    values ('center_created', $1, jsonb_build_object('center_id', $2::text, 'sales_assigned_to_creator', true))`, [actor, historicalDelayedCenter]);
  const historicalAward = (await db.query(`select s.* from admin_weekly_sales_spiffs s
    join private.customer_first_order_spiffs r on r.spiff_id = s.id where r.center_id = $1`, [historicalDelayedCenter])).rows[0];
  assert.equal(historicalAward.first_order_id, null);
  assert.equal(historicalAward.paid_at, null);
  assert.equal(Number(historicalAward.amount_cents), 10000);
  console.log('PASS delayed attribution of an existing older order retains its original payment eligibility');

  const center = crypto.randomUUID();
  const order = crypto.randomUUID();
  await db.query('insert into centers values ($1, $2)', [center, 'New customer']);
  await db.query('insert into orders(center_id, order_kind) values ($1, $2)', [center, 'prospecting_sample']);
  assert.equal((await db.query('select count(*)::int n from private.customer_first_order_spiffs where center_id = $1', [center])).rows[0].n, 0);
  await db.query("insert into orders(id, center_id, created_at) values ($1, $2, '2026-10-05 00:30:00+00')", [order, center]);
  await db.query(`insert into admin_audit_log(action, actor_profile_id, after_value)
    values ('center_created', $1, jsonb_build_object('center_id', $2::text, 'sales_assigned_to_creator', true))`, [actor, center]);
  const award = (await db.query('select * from admin_weekly_sales_spiffs where first_order_id = $1', [order])).rows[0];
  assert.equal(award.profile_id, actor);
  assert.equal(Number(award.amount_cents), 10000);
  assert.equal(award.paid_at, null);
  assert.equal(award.week_start_date.toISOString().slice(0, 10), '2026-09-28');
  assert.equal(award.week_end_date.toISOString().slice(0, 10), '2026-10-04');
  await db.query('delete from orders where id = $1', [order]);
  assert.equal((await db.query('select first_order_id from admin_weekly_sales_spiffs where id = $1', [award.id])).rows[0].first_order_id, order);
  await db.query('insert into orders(id, center_id) values ($1, $2)', [order, center]);
  await db.query('insert into orders(center_id) values ($1)', [center]);
  assert.equal((await db.query('select count(*)::int n from admin_weekly_sales_spiffs where first_order_id = $1', [order])).rows[0].n, 1);
  await db.query('delete from admin_weekly_sales_spiffs where id = $1', [award.id]);
  await db.query('insert into orders(center_id) values ($1)', [center]);
  assert.equal((await db.query('select count(*)::int n from admin_weekly_sales_spiffs where first_order_id = $1', [order])).rows[0].n, 0);
  console.log('PASS new awards retain provenance, Chicago week, samples, delayed attribution, deletion/restoration, and one-award receipts');

  for (const [at, requiresPaidInvoice] of [
    ['2026-09-30 04:59:59.999999+00', false],
    ['2026-09-30 05:00:00+00', true],
    ['2026-09-30 05:00:00.000001+00', true],
  ]) {
    const boundaryCenter = crypto.randomUUID();
    const boundaryOrder = crypto.randomUUID();
    await db.query('insert into centers values ($1, $2)', [boundaryCenter, `Cutoff boundary ${at}`]);
    await db.query('insert into orders(id, center_id, created_at) values ($1, $2, $3)', [boundaryOrder, boundaryCenter, at]);
    await db.query(`insert into admin_audit_log(action, actor_profile_id, after_value)
      values ('center_created', $1, jsonb_build_object('center_id', $2::text, 'sales_assigned_to_creator', true))`, [actor, boundaryCenter]);
    const boundaryAward = (await db.query(`select s.* from admin_weekly_sales_spiffs s
      join private.customer_first_order_spiffs r on r.spiff_id = s.id where r.center_id = $1`, [boundaryCenter])).rows[0];
    assert.equal(boundaryAward.first_order_id, requiresPaidInvoice ? boundaryOrder : null, at);
  }
  console.log('PASS payment rule starts inclusively at September 30 midnight America/Chicago using original order time');

  await db.query('update monthly_commission_payouts set paid_order_ids = $1', [[paidOrder, unpaidOrder]]);
  assert.deepEqual((await db.query('select paid_order_ids from monthly_commission_payouts')).rows[0].paid_order_ids, [paidOrder, unpaidOrder]);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const result = await db.query(`select has_function_privilege($1,
      'private.award_first_order_sales_spiff(uuid,uuid,timestamptz)', 'EXECUTE') allowed`, [role]);
    assert.equal(result.rows[0].allowed, false);
  }
  console.log('PASS cumulative paid order IDs persist and API roles cannot invoke the private award function');
} finally {
  await db.close();
}
