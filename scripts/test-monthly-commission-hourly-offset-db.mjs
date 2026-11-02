// Isolated PostgreSQL-compatible migration verification; never connects to a live DB.
// COMMISSION_OFFSET_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-monthly-commission-hourly-offset-db.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.COMMISSION_OFFSET_PGLITE_MODULE;
if (!modulePath) throw new Error('Set COMMISSION_OFFSET_PGLITE_MODULE to an installed @electric-sql/pglite module.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const readMigration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');
const migration = await readMigration('20261027134602_monthly_commission_hourly_offset.sql');
const thomas = crypto.randomUUID();
const haskins = crypto.randomUUID();
const sqlTable = (source, name) => {
  const start = source.indexOf(`create table if not exists ${name} (`);
  assert.ok(start >= 0, `Missing ${name} baseline`);
  return source.slice(start, source.indexOf('\n);', start) + 3);
};
const selectPayouts = async () => (await db.query('select * from monthly_commission_payouts order by id')).rows;

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table profiles(id uuid primary key);
    create table admin_weekly_sales_spiffs(id uuid primary key default gen_random_uuid(),
      profile_id uuid references profiles(id), amount_cents numeric, paid_at timestamptz);
  `);
  const baseline = await readMigration('027_sales_admin_commissions.sql');
  await db.exec(sqlTable(baseline, 'admin_commission_settings'));
  await db.exec(sqlTable(baseline, 'monthly_commission_payouts'));
  await db.exec(await readMigration('20261001125344_repair_commission_paid_order_tracking.sql'));
  const months = (await db.query(`select
    (date_trunc('month', now() at time zone 'America/Chicago') - interval '2 months')::date::text as historical,
    (date_trunc('month', now() at time zone 'America/Chicago') - interval '1 month')::date::text as closed,
    date_trunc('month', now() at time zone 'America/Chicago')::date::text as current,
    (date_trunc('month', now() at time zone 'America/Chicago') + interval '1 month')::date::text as future
  `)).rows[0];
  await db.query('insert into profiles(id) values ($1), ($2)', [thomas, haskins]);
  await db.query('insert into admin_commission_settings(profile_id, commission_percent) values ($1, 10), ($2, 10)', [thomas, haskins]);
  await db.query(`insert into monthly_commission_payouts(sales_profile_id, commission_month, status, commission_cents, paid_at)
    values ($1, $3, 'paid', 12345, now()), ($2, $4, 'paid', 54321, now())`, [thomas, haskins, months.historical, months.current]);
  await db.query('insert into admin_weekly_sales_spiffs(profile_id, amount_cents) values ($1, 10000), ($2, 10000)', [thomas, haskins]);
  const previousSettings = (await db.query('select * from admin_commission_settings order by profile_id')).rows;
  const previousPayouts = await selectPayouts();
  const previousSpiffs = (await db.query('select * from admin_weekly_sales_spiffs order by id')).rows;

  await db.exec(migration);
  const migratedSettings = (await db.query('select * from admin_commission_settings order by profile_id')).rows;
  assert.deepEqual(migratedSettings.map(({ hourly_offset_enabled, hourly_offset_start_month, ...row }) => row), previousSettings);
  assert.ok(migratedSettings.every(row => row.hourly_offset_enabled === false && row.hourly_offset_start_month === null));
  const migratedPayouts = await selectPayouts();
  assert.deepEqual(migratedPayouts.map(({ gross_commission_cents, hourly_base_offset_cents, ...row }) => row), previousPayouts);
  assert.ok(migratedPayouts.every(row => row.gross_commission_cents === null && Number(row.hourly_base_offset_cents) === 0));
  assert.deepEqual((await db.query('select * from admin_weekly_sales_spiffs order by id')).rows, previousSpiffs);
  console.log('PASS migration preserves all settings, legacy paid commissions, and separate SPIFFs');

  await assert.rejects(db.query('update admin_commission_settings set hourly_offset_enabled = true where profile_id = $1', [thomas]), /hourly_offset_month_check/);
  await assert.rejects(db.query("update admin_commission_settings set hourly_offset_start_month = '2026-01-02' where profile_id = $1", [thomas]), /hourly_offset_month_check/);
  await assert.rejects(db.query("update admin_commission_settings set hourly_offset_start_month = 'infinity' where profile_id = $1", [thomas]), /hourly_offset_month_check/);
  await db.query('update admin_commission_settings set hourly_offset_enabled = true, hourly_offset_start_month = $2 where profile_id = $1', [thomas, months.closed]);
  console.log('PASS offset requires a finite first-of-month effective date');

  // Existing history and profiles without the offset retain the old contract.
  await db.query("update monthly_commission_payouts set notes = 'Historical record retained' where sales_profile_id = $1", [thomas]);
  await db.query(`insert into monthly_commission_payouts(sales_profile_id, commission_month, status, commission_cents, paid_at)
    values ($1, $2, 'paid', 25000, now())`, [haskins, months.closed]);
  await db.query('update monthly_commission_payouts set commission_cents = 55000 where sales_profile_id = $1 and commission_month = $2', [haskins, months.current]);
  console.log('PASS historical Thomas months and Haskins remain unaffected');

  const oldInsert = `insert into monthly_commission_payouts(sales_profile_id, commission_month, status, commission_cents)
    values ($1, $2, 'paid', 200000)`;
  await assert.rejects(db.query(oldInsert, [thomas, months.closed]), /hourly_offset_metadata_required/);
  const insert = `insert into monthly_commission_payouts(sales_profile_id, commission_month, status,
    gross_commission_cents, hourly_base_offset_cents, commission_cents)
    values ($1, $2, $3, $4, $5, $6) returning *`;
  await assert.rejects(db.query(insert, [thomas, months.closed, 'paid', 200000, 150000, 200000]), /hourly_offset_amount_mismatch/);
  await assert.rejects(db.query(insert, [thomas, months.closed, 'paid', -1, 150000, 0]), /hourly_offset_amounts_check/);
  await assert.rejects(db.query(insert, [thomas, months.closed, 'paid', 200000, -1, 200001]), /hourly_offset_amounts_check/);
  await assert.rejects(db.query(insert, [thomas, months.closed, 'paid', 'NaN', 0, 'NaN']), /hourly_offset_amounts_check/);
  await assert.rejects(db.query(insert, [haskins, months.future, 'locked', null, 'NaN', 0]), /hourly_offset_amounts_check/);
  console.log('PASS legacy payloads, gross payouts, negative amounts, and NaN metadata rejected');

  const payout = (await db.query(insert, [thomas, months.closed, 'locked', 100000, 150000, 0])).rows[0];
  await db.query('update monthly_commission_payouts set gross_commission_cents = 150000 where id = $1', [payout.id]);
  await db.query('update monthly_commission_payouts set gross_commission_cents = 200000.49, hourly_base_offset_cents = 150000.49, commission_cents = 50000, status = $2 where id = $1', [payout.id, 'paid']);
  await assert.rejects(db.query('update monthly_commission_payouts set commission_cents = 200000 where id = $1', [payout.id]), /hourly_offset_amount_mismatch/);
  await assert.rejects(db.query('update monthly_commission_payouts set gross_commission_cents = null where id = $1', [payout.id]), /hourly_offset_metadata_required/);
  console.log('PASS below/equal wage thresholds pay zero, rounded positive excess pays correctly, and old updates cannot overpay');

  // A later paid invoice increases cumulative commission; the same monthly wages
  // are subtracted once. The next payment is 80000 - the earlier 50000 = 30000.
  const earlierPayment = Number((await db.query('select commission_cents from monthly_commission_payouts where id = $1', [payout.id])).rows[0].commission_cents);
  await db.query('update monthly_commission_payouts set gross_commission_cents = 230000, hourly_base_offset_cents = 150000, commission_cents = 80000 where id = $1', [payout.id]);
  const cumulative = (await db.query('select * from monthly_commission_payouts where id = $1', [payout.id])).rows[0];
  assert.equal(Number(cumulative.commission_cents) - earlierPayment, 30000);
  assert.equal(Number(cumulative.hourly_base_offset_cents), 150000);
  console.log('PASS late invoice top-ups preserve one full monthly wage offset');

  for (const month of [months.current, months.future]) {
    await assert.rejects(db.query(insert, [thomas, month, 'paid', 200000, 150000, 50000]), /hourly_offset_month_open/);
  }
  const preview = (await db.query(insert, [thomas, months.current, 'locked', 200000, 150000, 50000])).rows[0];
  await assert.rejects(db.query("update monthly_commission_payouts set status = 'paid' where id = $1", [preview.id]), /hourly_offset_month_open/);
  await assert.rejects(db.query('update monthly_commission_payouts set paid_at = now() where id = $1', [preview.id]), /hourly_offset_month_open/);
  console.log('PASS current-month previews are visible but current/future-month payouts are blocked');

  const security = (await db.query(`select p.prosecdef, p.proconfig,
    has_function_privilege('anon', p.oid, 'execute') as anon_execute,
    has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
    has_function_privilege('service_role', p.oid, 'execute') as service_execute
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'enforce_monthly_commission_hourly_offset'`)).rows[0];
  assert.equal(security.prosecdef, false);
  assert.deepEqual(security.proconfig, ['search_path=""']);
  assert.equal(security.anon_execute, false);
  assert.equal(security.authenticated_execute, false);
  assert.equal(security.service_execute, true);
  await db.exec('grant usage on schema public, private to service_role; grant select on admin_commission_settings to service_role; grant select, insert, update on monthly_commission_payouts to service_role; set role service_role;');
  await assert.rejects(db.query('update monthly_commission_payouts set commission_cents = 230000 where id = $1', [payout.id]), /hourly_offset_amount_mismatch/);
  await db.query("update monthly_commission_payouts set notes = 'Verified service role' where id = $1", [payout.id]);
  await db.exec('reset role');
  console.log('PASS private invoker trigger restricts function access and enforces service-role writes');

  const replayPayouts = await selectPayouts();
  const replaySettings = (await db.query('select * from admin_commission_settings order by profile_id')).rows;
  await db.exec(migration);
  assert.deepEqual(await selectPayouts(), replayPayouts);
  assert.deepEqual((await db.query('select * from admin_commission_settings order by profile_id')).rows, replaySettings);
  assert.deepEqual((await db.query('select * from admin_weekly_sales_spiffs order by id')).rows, previousSpiffs);
  console.log('PASS migration replay preserves configured staff, cumulative payouts, and SPIFFs');
} finally {
  await db.close();
}
