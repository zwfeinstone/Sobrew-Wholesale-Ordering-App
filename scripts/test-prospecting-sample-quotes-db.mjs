// Runs only in an isolated in-memory PostgreSQL instance; never connects to a live DB.
// SAMPLE_QUOTES_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-prospecting-sample-quotes-db.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.SAMPLE_QUOTES_PGLITE_MODULE;
if (!modulePath) throw new Error('Set SAMPLE_QUOTES_PGLITE_MODULE to an installed @electric-sql/pglite module.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const migration = await readFile(new URL('../db/migrations/20260930192343_prospecting_sample_quote_emails.sql', import.meta.url), 'utf8');
const greetingMigration = await readFile(new URL('../db/migrations/20260930210128_prospecting_sample_quote_greeting.sql', import.meta.url), 'utf8');
const firstOrder = '10000000-0000-0000-0000-000000000001';
const secondOrder = '10000000-0000-0000-0000-000000000002';
const lead = '20000000-0000-0000-0000-000000000001';
const contact = '30000000-0000-0000-0000-000000000001';
const sender = '40000000-0000-0000-0000-000000000001';
const creator = '40000000-0000-0000-0000-000000000002';
const missing = '90000000-0000-0000-0000-000000000001';
const base = {
  order_id: firstOrder,
  lead_id: lead,
  contact_id: contact,
  sender_profile_id: sender,
  created_by: creator,
  sender_name: 'Sample owner',
  sender_email: 'sender@example.com',
  recipient_name: 'Sample customer',
  recipient_email: 'customer@example.com',
  tracking_number: '1Z0751H30305695303',
  lines: [{ id: 'bulk-ground', priceCents: 4000 }],
  subject: 'Sobrew Coffee Samples, Pricing, and Ordering Process',
  body_text: 'A saved quote with the agreed pricing.',
  body_html: '<p>A saved quote with the agreed pricing.</p>',
};

async function insertQuote(overrides = {}) {
  const quote = { ...base, ...overrides };
  const columns = Object.keys(quote);
  return db.query(`insert into public.prospecting_sample_quotes (${columns.join(', ')})
    values (${columns.map((_, index) => `$${index + 1}`).join(', ')}) returning *`,
  columns.map(column => column === 'lines' ? JSON.stringify(quote[column]) : quote[column]));
}

async function rejectSql(operation, code, constraint) {
  await assert.rejects(operation, error => error.code === code && (!constraint || error.constraint === constraint));
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create role outsider;
    create table public.orders (id uuid primary key);
    create table public.prospecting_leads (id uuid primary key);
    create table public.prospecting_contacts (id uuid primary key);
    create table public.profiles (id uuid primary key);
    insert into public.orders values ('${firstOrder}'), ('${secondOrder}');
    insert into public.prospecting_leads values ('${lead}');
    insert into public.prospecting_contacts values ('${contact}');
    insert into public.profiles values ('${sender}'), ('${creator}');
    -- Exercise revocations even if Supabase's schema default privileges grant all.
    alter default privileges in schema public grant all on tables to public, anon, authenticated, service_role;
  `);
  await db.exec(migration);
  assert.equal((await db.query("select relrowsecurity from pg_class where oid = 'public.prospecting_sample_quotes'::regclass")).rows[0].relrowsecurity, true);

  await db.exec('set role service_role');
  let saved = (await insertQuote()).rows[0];
  assert.match(saved.id, /^[0-9a-f-]{36}$/);
  assert.ok(saved.created_at instanceof Date);
  assert.equal(saved.sent_at, null);
  assert.equal(saved.resend_email_id, null);
  assert.deepEqual(saved.lines, base.lines);
  assert.equal((await db.query('select count(*)::int as count from public.prospecting_sample_quotes')).rows[0].count, 1);
  await rejectSql(insertQuote(), '23505', 'prospecting_sample_quotes_order_id_key');
  console.log('PASS one pending email snapshot per order, generated ID/time, exact JSON snapshot, and service-role read/insert');

  await db.exec('reset role');
  await db.exec(greetingMigration);
  await db.exec('set role service_role');
  const legacy = (await db.query('select * from public.prospecting_sample_quotes where id = $1', [saved.id])).rows[0];
  assert.deepEqual(legacy, { ...saved, greeting_name: null });
  saved = legacy;
  for (const greeting_name of ['', '   ', ' Ron ', 'Ron\nTeam', 'Ron\tTeam', 'A'.repeat(121)]) {
    await rejectSql(insertQuote({ order_id: secondOrder, greeting_name }), '23514', 'prospecting_sample_quotes_greeting_name_check');
  }
  const custom = (await insertQuote({ order_id: missing, greeting_name: 'Ron and team' })).rows[0];
  assert.equal(custom.greeting_name, 'Ron and team');
  assert.equal(custom.recipient_name, base.recipient_name);
  await rejectSql(db.query("update public.prospecting_sample_quotes set greeting_name = 'Someone else' where id = $1", [custom.id]), '42501');
  console.log('PASS greeting migration preserves old snapshots, stores custom names separately, rejects invalid names, and prevents greeting edits');

  for (const tracking_number of ['', ' ', '\t\n', 'A'.repeat(121)]) {
    await rejectSql(insertQuote({ order_id: secondOrder, tracking_number }), '23514', 'prospecting_sample_quotes_tracking_check');
  }
  for (const lines of [[], {}, 'invalid', null]) {
    await rejectSql(insertQuote({ order_id: secondOrder, lines }), '23514', 'prospecting_sample_quotes_lines_check');
  }
  await rejectSql(insertQuote({ order_id: secondOrder, sent_at: '2026-09-30T12:00:00Z' }), '23514', 'prospecting_sample_quotes_sent_check');
  await rejectSql(insertQuote({ order_id: secondOrder, resend_email_id: 'test-message' }), '23514', 'prospecting_sample_quotes_sent_check');
  for (const column of ['lead_id', 'contact_id', 'sender_profile_id', 'created_by']) {
    await rejectSql(insertQuote({ order_id: secondOrder, [column]: missing }), '23503', `prospecting_sample_quotes_${column}_fkey`);
  }
  console.log('PASS invalid tracking, empty/non-array lines, incomplete delivery receipts, and missing references are rejected');

  await rejectSql(db.query('update public.prospecting_sample_quotes set sent_at = now() where id = $1', [saved.id]), '23514', 'prospecting_sample_quotes_sent_check');
  await db.query('update public.prospecting_sample_quotes set sent_at = now(), resend_email_id = $2 where id = $1', [saved.id, 'test-provider-id']);
  const sent = (await db.query('select * from public.prospecting_sample_quotes where id = $1', [saved.id])).rows[0];
  assert.ok(sent.sent_at instanceof Date);
  assert.equal(sent.resend_email_id, 'test-provider-id');
  assert.deepEqual({ ...sent, sent_at: null, resend_email_id: null }, saved);
  await rejectSql(db.query("update public.prospecting_sample_quotes set body_text = 'changed' where id = $1", [saved.id]), '42501');
  await rejectSql(db.query('delete from public.prospecting_sample_quotes where id = $1', [saved.id]), '42501');
  console.log('PASS service role can record acceptance but cannot replace quote content or delete the snapshot');

  await db.exec('reset role');
  for (const role of ['anon', 'authenticated', 'outsider']) {
    await db.exec(`set role ${role}`);
    await rejectSql(db.query('select * from public.prospecting_sample_quotes'), '42501');
    await rejectSql(insertQuote({ order_id: secondOrder }), '42501');
    await rejectSql(db.query('update public.prospecting_sample_quotes set sent_at = now(), resend_email_id = $1', ['forged']), '42501');
    await db.exec('reset role');
  }
  console.log('PASS PUBLIC, anonymous, and authenticated roles cannot read, create, or mark quote emails as sent');

  // The CRM can remove a contact while the copied quote and provider receipt remain.
  await db.exec('grant select, delete on public.prospecting_contacts to service_role; set role service_role');
  await rejectSql(db.query('update public.prospecting_sample_quotes set contact_id = null where id = $1', [saved.id]), '42501');
  await db.query('delete from public.prospecting_contacts where id = $1', [contact]);
  const retained = (await db.query('select * from public.prospecting_sample_quotes where id = $1', [saved.id])).rows[0];
  assert.deepEqual(retained, { ...sent, contact_id: null });
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as count from public.prospecting_contacts where id = $1', [contact])).rows[0].count, 0);
  console.log('PASS contact deletion clears only its link while preserving the recipient, agreed quote, and sent receipt');

  await db.query('delete from public.orders where id = $1', [firstOrder]);
  assert.deepEqual((await db.query('select * from public.prospecting_sample_quotes where order_id = $1', [firstOrder])).rows[0], retained);
  await db.query('insert into public.orders (id) values ($1)', [firstOrder]);
  await db.exec('set role service_role');
  await rejectSql(insertQuote({ contact_id: null }), '23505', 'prospecting_sample_quotes_order_id_key');
  assert.deepEqual((await db.query('select * from public.prospecting_sample_quotes where order_id = $1', [firstOrder])).rows[0], retained);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as count from public.profiles')).rows[0].count, 2);
  console.log('PASS order deletion and restoration preserve the sent receipt and reject a second quote for the recovered order');
} finally {
  await db.close();
}
