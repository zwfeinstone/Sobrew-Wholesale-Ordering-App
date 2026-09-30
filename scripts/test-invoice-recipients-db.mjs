// Isolated PostgreSQL-compatible migration verification; never connects to a live DB.
// INVOICE_RECIPIENTS_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-invoice-recipients-db.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.INVOICE_RECIPIENTS_PGLITE_MODULE;
if (!modulePath) throw new Error('Set INVOICE_RECIPIENTS_PGLITE_MODULE to an installed @electric-sql/pglite module.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const migration = await readFile(new URL('../db/migrations/20260930175035_center_invoice_recipients_configured.sql', import.meta.url), 'utf8');

async function accessConfiguration() {
  return {
    table: (await db.query("select relrowsecurity, relforcerowsecurity, relacl::text from pg_class where oid = 'public.centers'::regclass")).rows,
    policies: (await db.query("select * from pg_policies where schemaname = 'public' and tablename = 'centers' order by policyname")).rows,
    triggers: (await db.query("select tgname, pg_get_triggerdef(oid) definition from pg_trigger where tgrelid = 'public.centers'::regclass order by tgname")).rows,
  };
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.centers (
      id text primary key,
      name text not null,
      billing_email text,
      billing_email_cc text[] not null default '{}'::text[],
      billing_email_cc_reviewed_at timestamptz,
      quickbooks_customer_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table public.centers enable row level security;
    grant select on public.centers to authenticated;
    grant all on public.centers to service_role;
    create policy existing_center_read on public.centers for select to authenticated using (id = 'legacy-configured');
    insert into public.centers (id, name, billing_email, billing_email_cc, billing_email_cc_reviewed_at, quickbooks_customer_id, created_at, updated_at)
    values
      ('legacy-configured', 'Existing recipients', 'billing@example.com', array['cc@example.com'], '2026-09-29 12:00:00+00', '123', '2026-09-20 12:00:00+00', '2026-09-29 12:00:00+00'),
      ('legacy-empty', 'Existing empty email', '', '{}', null, null, '2026-09-20 12:00:00+00', '2026-09-20 12:00:00+00'),
      ('legacy-null', 'Existing no email', null, '{}', null, '456', '2026-09-30 12:00:00+00', '2026-09-30 12:00:00+00');
  `);
  const beforeRows = (await db.query('select * from public.centers order by id')).rows;
  const beforeAccess = await accessConfiguration();

  await db.exec(migration);

  const afterRows = (await db.query('select * from public.centers order by id')).rows;
  assert.deepEqual(afterRows.map(({ invoice_recipients_configured_at, ...row }) => row), beforeRows);
  assert.ok(afterRows.every(row => row.invoice_recipients_configured_at === null));
  assert.deepEqual(await accessConfiguration(), beforeAccess);
  console.log('PASS existing customer fields, recipients, timestamps, QuickBooks links, grants, RLS, and triggers remain unchanged');

  const column = (await db.query(`select column_default, is_nullable, data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'centers' and column_name = 'invoice_recipients_configured_at'`)).rows[0];
  assert.deepEqual(column, { column_default: null, is_nullable: 'YES', data_type: 'timestamp with time zone' });
  await db.exec("insert into public.centers (id, name) values ('unmarked-new', 'Unmarked creation path')");
  assert.equal((await db.query("select invoice_recipients_configured_at from public.centers where id = 'unmarked-new'")).rows[0].invoice_recipients_configured_at, null);
  await db.exec("update public.centers set billing_email = 'changed@example.com' where id = 'legacy-null'");
  assert.equal((await db.query("select invoice_recipients_configured_at from public.centers where id = 'legacy-null'")).rows[0].invoice_recipients_configured_at, null);
  console.log('PASS omitted markers stay NULL on insertion and legacy edits; no automatic opt-in or date-based backfill');

  for (const email of [null, '', '   ', '\t\n']) {
    await assert.rejects(
      db.query(`insert into public.centers (id, name, billing_email, invoice_recipients_configured_at)
        values ('invalid-new', 'Invalid explicit recipients', $1, now())`, [email]),
      error => error.code === '23514' && error.constraint === 'centers_configured_invoice_recipients_email_check'
    );
  }
  await db.query(`insert into public.centers (id, name, billing_email, billing_email_cc, invoice_recipients_configured_at)
    values ('new-configured', 'New customer', $1, $2, '2026-09-30 13:00:00+00')`, ['accounts@example.com', ['owner@example.com']]);
  const configured = (await db.query("select * from public.centers where id = 'new-configured'")).rows[0];
  assert.equal(configured.billing_email, 'accounts@example.com');
  assert.deepEqual(configured.billing_email_cc, ['owner@example.com']);
  assert.equal(configured.invoice_recipients_configured_at.toISOString(), '2026-09-30T13:00:00.000Z');
  await assert.rejects(
    db.query("update public.centers set billing_email = null where id = 'new-configured'"),
    error => error.code === '23514'
  );
  await db.query("update public.centers set billing_email = null where id = 'legacy-configured'");
  console.log('PASS explicit recipients require a nonblank primary invoice email; legacy customers retain original nullable behavior');
} finally {
  await db.close();
}
