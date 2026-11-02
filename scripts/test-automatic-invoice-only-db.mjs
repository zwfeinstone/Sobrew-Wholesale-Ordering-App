// Isolated PostgreSQL-compatible migration verification; never connects to a live DB.
// AUTOMATIC_INVOICE_ONLY_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-automatic-invoice-only-db.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.AUTOMATIC_INVOICE_ONLY_PGLITE_MODULE;
if (!modulePath) throw new Error('Set AUTOMATIC_INVOICE_ONLY_PGLITE_MODULE to an installed @electric-sql/pglite module.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const migration = await readFile(new URL('../db/migrations/20261001142524_center_automatic_invoice_only.sql', import.meta.url), 'utf8');

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
      quickbooks_display_name text,
      quickbooks_company_name text,
      billing_email text,
      billing_email_cc text[] not null default '{}'::text[],
      invoice_recipients_configured_at timestamptz,
      billing_email_cc_reviewed_at timestamptz,
      quickbooks_customer_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table public.centers enable row level security;
    grant select on public.centers to authenticated;
    grant all on public.centers to service_role;
    create policy existing_center_read on public.centers for select to authenticated using (id = 'unrelated');
  `);

  // Each identity field recognizes only a complete designated name, including
  // formatting/accent variants, rather than enabling broader partial matches.
  const designated = [
    ['arise', 'Arise Cafe', null, null],
    ['cooper', 'CooperRiis', null, null],
    ['cooper-full-name', 'CooperRiis Healing Community', null, null],
    ['arise-accent', 'ARISE CAFÉ', null, null],
    ['arise-combining-accent', 'Arise Cafe\u0301', null, null],
    ['arise-display', 'Customer A', ' Arise-Cafe. ', null],
    ['arise-company', 'Customer B', null, 'Arise Café'],
    ['cooper-display', 'Customer C', ' COOPER RIIS ', null],
    ['cooper-company', 'Customer D', null, 'Cooper-Riis'],
    ['cooper-full-display', 'Customer F', ' CooperRiis Healing Community ', null],
    ['cooper-full-company', 'Customer G', null, 'COOPER-RIIS HEALING COMMUNITY'],
  ];
  const regular = [
    ['unrelated', 'Regular customer', null, null],
    ['arise-annex', 'Arise Cafe Annex', null, null],
    ['arise-prefix', 'The Arise Cafe', null, null],
    ['cooper-foundation', 'CooperRiis Foundation', null, null],
    ['cooper-full-annex', 'CooperRiis Healing Community Annex', null, null],
    ['cooper-other', 'Other CooperRiis', null, null],
    ['display-partial', 'Customer E', 'Arise Cafe Wholesale', 'CooperRiis Foundation'],
    ['empty', '', '', ''],
  ];
  for (const [id, name, display, company] of [...designated, ...regular]) {
    await db.query(`insert into public.centers
      (id, name, quickbooks_display_name, quickbooks_company_name, billing_email, billing_email_cc,
       invoice_recipients_configured_at, billing_email_cc_reviewed_at, quickbooks_customer_id, created_at, updated_at)
      values ($1, $2, $3, $4, 'billing@example.com', array['cc@example.com'],
        '2026-09-30 13:00:00+00', '2026-09-29 12:00:00+00', 'qb-' || $1,
        '2026-09-20 12:00:00+00', '2026-09-29 12:00:00+00')`, [id, name, display, company]);
  }
  const beforeRows = (await db.query('select * from public.centers order by id')).rows;
  const beforeAccess = await accessConfiguration();

  await db.exec(migration);

  const afterRows = (await db.query('select * from public.centers order by id')).rows;
  assert.deepEqual(afterRows.map(({ automatic_invoice_only, ...row }) => row), beforeRows);
  const designatedIds = designated.map(([id]) => id).sort();
  assert.deepEqual(afterRows.filter(row => row.automatic_invoice_only).map(row => row.id), designatedIds);
  assert.deepEqual(await accessConfiguration(), beforeAccess);
  console.log('PASS only designated customer identities are enabled; billing contacts, recipient markers, timestamps, QuickBooks links, grants, RLS, and triggers remain unchanged');

  const column = (await db.query(`select column_default, is_nullable, data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'centers' and column_name = 'automatic_invoice_only'`)).rows[0];
  assert.deepEqual(column, { column_default: 'false', is_nullable: 'NO', data_type: 'boolean' });
  await assert.rejects(db.query("update public.centers set automatic_invoice_only = null where id = 'unrelated'"), error => error.code === '23502');
  console.log('PASS checkbox is a nonnullable boolean with a false default');

  await db.exec(`insert into public.centers (id, name) values
    ('new-arise', 'Arise Cafe'), ('new-cooper', 'CooperRiis'),
    ('new-cooper-full', 'CooperRiis Healing Community'), ('new-regular', 'New customer');
    update public.centers set automatic_invoice_only = false where id in ('arise', 'cooper');
    update public.centers set automatic_invoice_only = true where id = 'unrelated';
    update public.centers set quickbooks_company_name = 'CooperRiis' where id = 'new-regular';`);
  for (const id of ['new-arise', 'new-cooper', 'new-cooper-full', 'new-regular', 'arise', 'cooper']) {
    assert.equal((await db.query('select automatic_invoice_only from public.centers where id = $1', [id])).rows[0].automatic_invoice_only, false);
  }
  assert.equal((await db.query("select automatic_invoice_only from public.centers where id = 'unrelated'")).rows[0].automatic_invoice_only, true);
  console.log('PASS new customers start unchecked, name changes do not opt in, and admins can freely enable or disable any customer');
} finally {
  await db.close();
}
