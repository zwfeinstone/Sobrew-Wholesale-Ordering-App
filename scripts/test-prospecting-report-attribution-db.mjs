// Isolated PostgreSQL verification. This script never connects to a live DB.
// PROSPECTING_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-prospecting-report-attribution-db.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PROSPECTING_PGLITE_MODULE;
if (!modulePath) throw new Error('Set PROSPECTING_PGLITE_MODULE to an installed @electric-sql/pglite module.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const migration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');
const manager = '11111111-1111-4111-8111-111111111111';
const rep = '22222222-2222-4222-8222-222222222222';
const otherRep = '33333333-3333-4333-8333-333333333333';
const defaultTime = '2026-09-15T15:00:00Z';
const signature = 'public.admin_prospecting_report_v1(date,date,date,uuid,uuid[])';
let passed = 0;

// Model only the relations and columns read by the report. The legacy block
// definitions come from the original migration so their defaults stay intact.
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create table profiles(id uuid primary key);
  create table prospecting_leads(
    id uuid primary key default gen_random_uuid(),
    company_name text not null,
    assigned_profile_id uuid references profiles(id),
    stage text not null,
    next_follow_up_at date,
    hubspot_status text default 'not_queued',
    hubspot_deal_id text,
    created_at timestamptz not null,
    archived_at timestamptz
  );
  create table prospecting_activities(
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references prospecting_leads(id) on delete cascade,
    activity_type text not null,
    result text,
    previous_stage text,
    next_stage text,
    previous_assigned_profile_id uuid references profiles(id),
    created_by uuid references profiles(id),
    created_at timestamptz not null
  );
  create table sample_box_runs(
    id uuid primary key default gen_random_uuid(),
    sent_at timestamptz not null,
    sales_profile_id uuid references profiles(id),
    center_id uuid,
    quantity_boxes numeric not null,
    total_cogs_cents numeric not null
  );
`);
const legacyTables = await migration('019_sales_prospecting.sql');
await db.exec(legacyTables.slice(0, legacyTables.indexOf('alter table sales_prospecting_blocks')));
await db.query('insert into profiles(id) values($1),($2),($3)', [manager, rep, otherRep]);

async function lead({ owner = rep, stage = 'converted', name = 'Sample center', hubspot = null, createdAt = defaultTime, archivedAt = null } = {}) {
  return (await db.query(`
    insert into prospecting_leads(company_name,assigned_profile_id,stage,hubspot_deal_id,created_at,archived_at)
    values($1,$2,$3,$4,$5,$6) returning id
  `, [name, owner, stage, hubspot, createdAt, archivedAt])).rows[0].id;
}

async function event(leadId, { actor = manager, previousOwner = null, type = 'stage_change', from = 'sample_requested', to = 'converted', result = 'Won', at = defaultTime, id = crypto.randomUUID() } = {}) {
  await db.query(`
    insert into prospecting_activities(id,lead_id,activity_type,result,previous_stage,next_stage,previous_assigned_profile_id,created_by,created_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [id, leadId, type, result, from, to, previousOwner, actor, at]);
  return id;
}

async function report(owner = null) {
  return (await db.query(`
    select public.admin_prospecting_report_v1('2026-07-01','2026-10-02','2026-10-01',$1,null) as report
  `, [owner])).rows[0].report;
}

const repRow = (value, owner) => value.reps.find(row => row.rep_key === owner);
const wins = (value, owner) => repRow(value, owner)?.deals_won ?? 0;
const losses = (value, owner) => repRow(value, owner)?.deals_lost ?? 0;
const channel = (value, name) => value.channels.find(row => row.channel === name);
const source = (value, name) => value.sources.find(row => row.source === name);
async function snapshot() {
  return (await db.query(`
    select 'lead' as kind, id, to_jsonb(lead) as record from prospecting_leads lead
    union all
    select 'activity', id, to_jsonb(activity) from prospecting_activities activity
    order by kind, id
  `)).rows;
}
async function test(name, run, transaction = true) {
  if (transaction) await db.exec('begin');
  try {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  } finally {
    if (transaction) await db.exec('rollback');
  }
}

try {
  await db.exec(await migration('049_prospecting_report_aggregates.sql'));
  await test('existing manager-attributed win moves to assigned rep without changing records or totals', async () => {
    const leadId = await lead();
    await event(leadId);
    await event(leadId, { actor: rep, type: 'call', from: 'working', to: 'sample_requested', result: 'Sample requested', at: '2026-08-01T15:00:00Z' });
    const before = await report();
    const records = await snapshot();
    assert.equal(wins(before, manager), 1);
    assert.equal(wins(before, rep), 0);
    assert.equal((await report(rep)).period.deals_won, 0);

    await db.exec(await migration('20261001225053_prospecting_outcome_assigned_rep.sql'));
    const after = await report();
    assert.equal(wins(after, manager), 0);
    assert.equal(wins(after, rep), 1);
    assert.equal((await report(rep)).period.deals_won, 1);
    assert.equal((await report(manager)).period.deals_won, 0);
    assert.deepEqual(after.period, before.period);
    assert.deepEqual(after.pipeline_snapshot, before.pipeline_snapshot);
    assert.deepEqual(after.stages, before.stages);
    assert.deepEqual(after.channels, before.channels);
    assert.deepEqual(after.sources, before.sources);
    assert.deepEqual(await snapshot(), records);
  }, false);
  await db.exec('truncate prospecting_leads cascade');

  await test('both Shoulder lead IDs count even with the same HubSpot deal and decision maker', async () => {
    const shoulderOne = await lead({ name: 'The Shoulder, first location', hubspot: 'shared-shoulder-deal' });
    const shoulderTwo = await lead({ name: 'The Shoulder, second location', hubspot: 'shared-shoulder-deal' });
    for (const leadId of [shoulderOne, shoulderTwo]) {
      await event(leadId, { actor: rep, type: 'call', from: 'working', to: 'sample_requested', result: 'Sample requested', at: '2026-08-01T15:00:00Z' });
      await event(leadId);
    }
    const all = await report();
    const scoped = await report(rep);
    assert.equal(all.period.deals_won, 2);
    assert.equal(wins(all, rep), 2);
    assert.equal(scoped.period.deals_won, 2);
    assert.equal(scoped.period.sample_requests, 2);
    assert.equal(wins(all, manager), 0);
  });

  await test('lost lead keeps former owner after its assignment is cleared', async () => {
    const leadId = await lead({ owner: null, stage: 'lost' });
    await event(leadId, { to: 'lost', result: 'Lost', previousOwner: rep });
    const all = await report();
    assert.equal(losses(all, rep), 1);
    assert.equal(losses(all, manager), 0);
    assert.equal((await report(rep)).period.deals_lost, 1);
    assert.equal((await report(manager)).period.deals_lost, 0);
  });

  await test('reassignment after a loss does not move the loss to the new rep', async () => {
    const leadId = await lead({ owner: otherRep, stage: 'working' });
    await event(leadId, { to: 'lost', result: 'Lost', previousOwner: rep });
    const all = await report();
    assert.equal(losses(all, rep), 1);
    assert.equal(losses(all, otherRep), 0);
    assert.equal((await report(rep)).period.deals_lost, 1);
    assert.equal((await report(otherRep)).period.deals_lost, 0);
  });

  await test('win follows current assignment when audit contains a different previous owner', async () => {
    const leadId = await lead({ owner: otherRep });
    await event(leadId, { previousOwner: rep });
    const all = await report();
    assert.equal(wins(all, otherRep), 1);
    assert.equal(wins(all, rep), 0);
    assert.equal((await report(otherRep)).period.deals_won, 1);
    assert.equal((await report(rep)).period.deals_won, 0);
  });

  await test('known previous owner rescues an unassigned win and current owner rescues an older loss', async () => {
    const wonLead = await lead({ owner: null });
    const lostLead = await lead({ stage: 'lost' });
    await event(wonLead, { previousOwner: rep });
    await event(lostLead, { to: 'lost', result: 'Lost' });
    const all = await report();
    assert.equal(wins(all, rep), 1);
    assert.equal(losses(all, rep), 1);
    assert.equal((await report(rep)).period.deals_won, 1);
    assert.equal((await report(rep)).period.deals_lost, 1);
  });

  await test('outcomes without any known owner remain Unassigned instead of crediting recorder', async () => {
    const wonLead = await lead({ owner: null });
    const lostLead = await lead({ owner: null, stage: 'lost' });
    await event(wonLead);
    await event(lostLead, { to: 'lost', result: 'Lost' });
    const all = await report();
    assert.equal(wins(all, '__unassigned_rep__'), 1);
    assert.equal(losses(all, '__unassigned_rep__'), 1);
    assert.equal(wins(all, manager), 0);
    assert.equal(losses(all, manager), 0);
    assert.equal((await report(manager)).period.deals_won, 0);
    assert.equal((await report(manager)).period.deals_lost, 0);
  });

  await test('latest terminal event is chosen before rep filtering and duplicate audits count once', async () => {
    const leadId = await lead({ owner: otherRep, stage: 'working' });
    await event(leadId, { actor: rep, previousOwner: rep, at: '2026-08-01T15:00:00Z' });
    await event(leadId, { to: 'lost', result: 'Lost', previousOwner: rep, at: '2026-09-15T15:00:00Z', id: '44444444-4444-4444-8444-444444444441' });
    await event(leadId, { type: 'assignment', to: 'lost', result: 'Unassigned', previousOwner: rep, at: '2026-09-15T15:00:00Z', id: '44444444-4444-4444-8444-444444444442' });
    const all = await report();
    assert.equal(all.period.deals_won, 0);
    assert.equal(all.period.deals_lost, 1);
    assert.equal(losses(all, rep), 1);
    assert.equal((await report(rep)).period.deals_lost, 1);
    assert.equal((await report(otherRep)).period.deals_won, 0);
    assert.equal((await report(otherRep)).period.deals_lost, 0);
  });

  await test('calls and sample requests stay credited to actor while outcomes follow assigned rep', async () => {
    const leadId = await lead();
    await event(leadId, { type: 'call', from: 'working', to: 'sample_requested', result: 'Sample requested', at: '2026-08-01T15:00:00Z' });
    await event(leadId, { type: 'email' });
    const all = await report();
    const managerReport = await report(manager);
    const repReport = await report(rep);
    assert.equal(repRow(all, manager).calls, 1);
    assert.equal(repRow(all, manager).sample_requests, 1);
    assert.equal(wins(all, manager), 0);
    assert.equal(wins(all, rep), 1);
    assert.equal(managerReport.period.call_attempts, 1);
    assert.equal(managerReport.period.sample_requests, 1);
    assert.equal(managerReport.period.emails, 1);
    assert.equal(repReport.period.call_attempts, 0);
    assert.equal(repReport.period.sample_requests, 0);
    assert.equal(channel(repReport, 'email').deals_won, 1);
    assert.equal(channel(managerReport, 'email').deals_won, 0);
    assert.equal(source(repReport, 'lead_activity').deals_won, 1);
  });

  await test('legacy block outcomes and sample box credit retain their original attribution', async () => {
    await db.query(`insert into sales_prospecting_blocks(activity_date,created_by,calls_contact,samples_from_contact) values('2026-09-01',$1,5,2)`, [manager]);
    await db.query(`insert into sales_prospecting_followup_blocks(activity_date,created_by,followups_phone,deals_closed_phone,deals_lost_email) values('2026-09-01',$1,4,2,1)`, [manager]);
    await db.query(`insert into sample_box_runs(sent_at,sales_profile_id,quantity_boxes,total_cogs_cents) values($1,$2,3,750)`, [defaultTime, rep]);
    const leadId = await lead();
    await event(leadId);
    const all = await report();
    const managerReport = await report(manager);
    const repReport = await report(rep);
    assert.equal(all.period.deals_won, 3);
    assert.equal(all.period.deals_lost, 1);
    assert.equal(wins(all, manager), 2);
    assert.equal(losses(all, manager), 1);
    assert.equal(wins(all, rep), 1);
    assert.equal(managerReport.period.call_attempts, 5);
    assert.equal(managerReport.period.sample_requests, 2);
    assert.equal(managerReport.period.deals_won, 2);
    assert.equal(managerReport.period.deals_lost, 1);
    assert.equal(repReport.period.sample_boxes, 3);
    assert.equal(repReport.period.sample_cogs_cents, 750);
    assert.equal(source(repReport, 'followup_blocks').deals_won, 0);
  });

  await test('Central Time window boundaries and real stage transitions retain their meaning', async () => {
    const beforeWindow = await lead();
    const startWindow = await lead({ archivedAt: '2026-09-20T15:00:00Z' });
    const endWindow = await lead();
    const repeatedStage = await lead();
    await event(beforeWindow, { at: '2026-07-01T04:59:59Z' });
    await event(startWindow, { at: '2026-07-01T05:00:00Z' });
    await event(endWindow, { at: '2026-10-02T05:00:00Z' });
    await event(repeatedStage, { from: 'converted' });
    const all = await report();
    assert.equal(all.period.deals_won, 1);
    assert.equal(wins(all, rep), 1);
    assert.equal((await report(rep)).period.deals_won, 1);
  });

  await test('service-only execute permissions and invoker security survive the replacement', async () => {
    for (const role of ['anon', 'authenticated']) {
      const permissions = await db.query(`select has_function_privilege($1,$2,'EXECUTE') as allowed`, [role, signature]);
      assert.equal(permissions.rows[0].allowed, false);
    }
    const service = await db.query(`select has_function_privilege('service_role',$1,'EXECUTE') as allowed`, [signature]);
    assert.equal(service.rows[0].allowed, true);
    const configuration = await db.query(`select prosecdef,proconfig from pg_proc where oid=$1::regprocedure`, [signature]);
    assert.equal(configuration.rows[0].prosecdef, false);
    assert.ok(configuration.rows[0].proconfig.some(setting => /^search_path=(?:""|)$/.test(setting)));
    const leadId = await lead();
    await event(leadId);
    await db.exec('grant usage on schema public to service_role; grant select on all tables in schema public to service_role; set local role service_role');
    assert.equal((await report(rep)).period.deals_won, 1);
  });

  console.log(`${passed} isolated PostgreSQL report-attribution scenarios passed.`);
} finally {
  await db.close();
}
