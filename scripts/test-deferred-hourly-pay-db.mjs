// Isolated PostgreSQL-compatible verification; never connects to a live DB.
// DEFERRED_PAY_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-deferred-hourly-pay-db.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.DEFERRED_PAY_PGLITE_MODULE;
if (!modulePath) throw new Error('Set DEFERRED_PAY_PGLITE_MODULE to an installed @electric-sql/pglite module.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const readMigration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');
const migration = await readMigration('20261007140423_deferred_hourly_pay.sql');

function sqlBlock(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt);
  assert.ok(startAt >= 0 && endAt >= startAt, `Missing prerequisite SQL block: ${start}`);
  return source.slice(startAt, endAt + end.length);
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      email text,
      is_admin boolean default false,
      is_superadmin boolean not null default false,
      is_active boolean default true
    );
    create table public.admin_permissions (
      profile_id uuid references public.profiles(id) on delete cascade,
      section_key text not null,
      can_view boolean not null default false,
      can_edit boolean not null default false,
      primary key (profile_id, section_key)
    );
    alter table public.profiles enable row level security;
    alter table public.admin_permissions enable row level security;
    grant all on public.profiles, public.admin_permissions to authenticated, service_role;
    -- Model older projects where default grants expose new tables; the migration
    -- must revoke these grants rather than relying only on the absence of policies.
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);

  // Reuse the repository's actual prerequisite functions and policies so the
  // regression does not accidentally bypass profile/permission RLS behavior.
  const initial = await readMigration('001_init.sql');
  const permissions = await readMigration('025_admin_permissions.sql');
  const access = await readMigration('048_quick_restock_performance.sql');
  await db.exec(`create schema private; revoke all on schema private from public; grant usage on schema private to authenticated, service_role;`);
  for (const name of ['is_admin', 'is_owner_admin']) {
    await db.exec(sqlBlock(access, `create or replace function private.${name}()`, '$function$;'));
    await db.exec(sqlBlock(access, `create or replace function public.${name}()`, '$function$;'));
    await db.exec(`revoke all on function private.${name}() from public, anon;
      revoke all on function public.${name}() from public, anon;
      grant execute on function private.${name}() to authenticated, service_role;
      grant execute on function public.${name}() to authenticated, service_role;`);
  }
  await db.exec(sqlBlock(initial, 'create policy "admin all profiles"', 'create policy "self read profile" on profiles for select using (id = auth.uid());'));
  await db.exec(sqlBlock(access, 'create or replace function private.handle_new_user_profile()', '$function$;'));
  await db.exec(`create trigger on_auth_user_created after insert on auth.users
    for each row execute function private.handle_new_user_profile();`);
  await db.exec(sqlBlock(permissions, 'drop policy if exists "owner all admin_permissions"', 'using (profile_id = auth.uid());'));

  // No profile means no seed; another similarly named employee must not match.
  const unrelatedId = crypto.randomUUID();
  await db.query('insert into auth.users(id, email) values ($1, $2)', [unrelatedId, 'other-haskins@sobrew.com']);
  await db.exec(migration);
  assert.equal((await db.query('select count(*)::int n from public.admin_deferred_pay_plans')).rows[0].n, 0);

  const haskinsId = crypto.randomUUID();
  await db.query('insert into auth.users(id, email) values ($1, $2)', [haskinsId, 'haskins@sobrew.com']);
  await db.query('update public.profiles set is_admin = true where id = $1', [haskinsId]);
  await db.exec(migration);
  const plans = (await db.query('select * from public.admin_deferred_pay_plans')).rows;
  assert.equal(plans.length, 1);
  assert.equal(plans[0].profile_id, haskinsId);
  assert.equal(plans[0].label, 'January 4 deferred pay');
  assert.equal(plans[0].start_date.toISOString().slice(0, 10), '2026-10-07');
  assert.equal(plans[0].end_date.toISOString().slice(0, 10), '2027-01-03');
  assert.equal(plans[0].payout_date.toISOString().slice(0, 10), '2027-01-04');
  assert.equal(plans[0].accrual_rate_cents, 500);
  assert.equal(plans[0].weekly_rate_cents, 1500);
  assert.equal(plans[0].paid_at, null);
  assert.equal(plans[0].paid_amount_cents, null);
  console.log('PASS exact staff identity, inclusive accrual dates, payout date, separate rates, unpaid seed');

  // Replaying the migration must preserve an already recorded settlement.
  await db.query("update public.admin_deferred_pay_plans set paid_at = '2027-01-04 12:00Z', paid_amount_cents = 43210 where profile_id = $1", [haskinsId]);
  const settled = (await db.query('select * from public.admin_deferred_pay_plans')).rows;
  await db.exec(migration);
  assert.deepEqual((await db.query('select * from public.admin_deferred_pay_plans')).rows, settled);
  console.log('PASS repeated migration creates no duplicate and preserves settlement');

  // An ambiguous identity must abort, and inactive accounts are never seeded.
  await db.exec('begin');
  const duplicateId = crypto.randomUUID();
  await db.query('insert into auth.users(id, email) values ($1, $2)', [duplicateId, ' HASKINS@SOBREW.COM ']);
  await assert.rejects(db.exec(migration), /Multiple active Haskins profiles/);
  await db.exec('rollback');
  await db.exec('begin');
  await db.query('delete from public.admin_deferred_pay_plans where profile_id = $1', [haskinsId]);
  await db.query('update public.profiles set is_active = false where id = $1', [haskinsId]);
  await db.exec(migration);
  assert.equal((await db.query('select count(*)::int n from public.admin_deferred_pay_plans')).rows[0].n, 0);
  await db.exec('rollback');
  console.log('PASS ambiguous staff rejected and inactive staff excluded');

  const profilesBefore = (await db.query('select * from public.profiles order by id')).rows;
  const result = await db.exec(await readFile(new URL('../db/tests/deferred-hourly-pay.sql', import.meta.url), 'utf8'));
  assert.deepEqual((await db.query('select * from public.profiles order by id')).rows, profilesBefore);
  assert.deepEqual((await db.query('select * from public.admin_deferred_pay_plans')).rows, settled);
  console.log(result.at(-1).rows[0].result);
  console.log('PASS regression fixtures and role changes roll back');

  await db.exec(`
    create table public.admin_time_entries (
      id uuid primary key default gen_random_uuid(), profile_id uuid references profiles(id),
      clock_in_at timestamptz not null, clock_out_at timestamptz, status text not null default 'submitted'
    );
    create table public.admin_time_breaks (
      id uuid primary key default gen_random_uuid(), time_entry_id uuid references admin_time_entries(id),
      break_start_at timestamptz not null, break_end_at timestamptz, status text not null default 'completed'
    );
    create table public.accounting_categories (
      id uuid primary key default gen_random_uuid(), name text unique not null,
      category_type text not null, pnl_section text not null, active boolean not null default true
    );
    create table public.accounting_transactions (
      id uuid primary key default gen_random_uuid(), transaction_date date not null,
      amount_cents numeric not null, account_type text not null, status text not null,
      category_id uuid references accounting_categories(id), original_description text, transaction_fingerprint text unique,
      reviewed_by uuid references profiles(id), reviewed_at timestamptz, updated_at timestamptz default now()
    );
    create table public.accounting_transaction_matches (
      id uuid primary key default gen_random_uuid(), transaction_id uuid references accounting_transactions(id), match_status text,
      target_type text, target_id uuid
    );
    create table public.accounting_transaction_splits (
      id uuid primary key default gen_random_uuid(), transaction_id uuid references accounting_transactions(id), amount_cents numeric
    );
    create table public.admin_audit_log (
      id uuid primary key default gen_random_uuid(), action text, actor_profile_id uuid references profiles(id),
      target_profile_id uuid references profiles(id), section_key text, before_value jsonb, after_value jsonb
    );
    grant all on public.admin_time_entries, public.admin_time_breaks, public.accounting_categories,
      public.accounting_transactions, public.accounting_transaction_matches, public.accounting_transaction_splits,
      public.admin_audit_log to service_role;
    insert into public.accounting_categories(name, category_type, pnl_section)
      values ('Deferred Payroll / Compensation Payable', 'liability', 'none'), ('Payroll Wages & Taxes', 'operating_expense', 'operating_expenses');
  `);
  const settlementMigration = await readMigration('20261007145120_deferred_hourly_pay_settlement.sql');
  await db.exec(settlementMigration);
  await db.exec(settlementMigration);
  const settledWithNewColumns = (await db.query('select * from public.admin_deferred_pay_plans')).rows;
  const settlementResult = await db.exec(await readFile(new URL('../db/tests/deferred-hourly-pay-settlement.sql', import.meta.url), 'utf8'));
  assert.deepEqual((await db.query('select * from public.admin_deferred_pay_plans')).rows, settledWithNewColumns);
  assert.equal((await db.query('select count(*)::int n from public.admin_audit_log')).rows[0].n, 0);
  console.log(settlementResult.at(-1).rows[0].result);
} finally {
  await db.close();
}
