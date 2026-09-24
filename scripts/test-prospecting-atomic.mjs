// Isolated PostgreSQL-compatible verification. Never connects to a live DB.
// PROSPECTING_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-prospecting-atomic.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.PROSPECTING_PGLITE_MODULE;
if (!modulePath) throw new Error('Set PROSPECTING_PGLITE_MODULE to an installed @electric-sql/pglite module.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const migration = async name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema private;
create table profiles(id uuid primary key, email text, is_admin boolean, is_active boolean, is_superadmin boolean);
create table admin_permissions(profile_id uuid references profiles(id), section_key text, can_edit boolean, primary key(profile_id,section_key));
create table admin_commission_settings(profile_id uuid primary key references profiles(id), is_sales_rep boolean);
create table products(id uuid primary key default gen_random_uuid(), name text, sku text, active boolean, category text);
create table product_recipes(id uuid primary key default gen_random_uuid(), product_id uuid references products(id));
create table orders(id uuid primary key default gen_random_uuid(), center_id uuid, center_location_id uuid,
 user_id uuid references profiles(id), created_at timestamptz default now(), archived_at timestamptz,
 fulfillment_method text, notes text, order_kind text, prospecting_lead_id uuid, shipping_address1 text,
 shipping_address2 text, shipping_city text, shipping_company text, shipping_name text, shipping_state text,
 shipping_zip text, status text, submission_id uuid unique, subtotal_cents integer);
create table order_items(id uuid primary key default gen_random_uuid(), order_id uuid references orders(id),
 product_id uuid references products(id), product_name_snapshot text, qty integer check(qty>0), unit_price_cents integer, line_total_cents integer);
`);
const workspace = await migration('043_prospecting_lead_workspace.sql');
await db.exec(workspace.slice(0, workspace.indexOf('create index')));
await db.exec(`alter table prospecting_leads drop constraint prospecting_leads_stage_check;
alter table prospecting_leads add column archived_at timestamptz, add column state_key text;
alter table prospecting_activities add column previous_assigned_profile_id uuid;`);
await db.exec(await migration('20260804192543_fix_prospecting_rep_workflow.sql'));
await db.exec(await migration('20260910124119_prospecting_sample_contact_and_hubspot_schedule.sql'));
await db.exec(await migration('20260924213453_prospecting_atomic_workspace.sql'));
const owner = '11111111-1111-4111-8111-111111111111';
const rep = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const leadId = '44444444-4444-4444-8444-444444444444';
const contactId = '55555555-5555-4555-8555-555555555555';
const productId = '66666666-6666-4666-8666-666666666666';
await db.query(`insert into profiles values($1,'owner@example.com',true,true,true),($2,'rep@example.com',true,true,false),($3,'other@example.com',true,true,false)`, [owner,rep,other]);
await db.query(`insert into admin_permissions values($1,'prospecting',true),($2,'prospecting',true)`,[rep,other]);
await db.query('insert into admin_commission_settings values($1,true)',[rep]);
await db.query(`insert into prospecting_leads(id,company_name,company_name_key,assigned_profile_id,next_follow_up_at,created_by,updated_by) values($1,'Sample center','sample center',$2,'2026-09-24',$2,$2)`,[leadId,rep]);
await db.query(`insert into prospecting_contacts(id,lead_id,full_name,email,is_primary) values($1,$2,'Jane Buyer','jane@example.com',true)`,[contactId,leadId]);
await db.query(`insert into products(id,name,active,category) values($1,'Sample box',true,'sample_boxes')`,[productId]);
await db.query(`insert into product_recipes(product_id) values($1)`,[productId]);
const loadLead = async () => (await db.query('select to_jsonb(lead) as value from prospecting_leads lead where id=$1',[leadId])).rows[0].value;
const count = async table => Number((await db.query(`select count(*) as n from ${table}`)).rows[0].n);
const commit = async ({actor=rep,submission=crypto.randomUUID(),lead=leadId,version,payload=null,contacts=[],newContact=null,activity=null,audit=[],deletes=[],sample=null,signature=null,nextHref=null}={}) => {
 const values=[actor,submission,lead,version??(lead? (await loadLead()).updated_at:null),payload,contacts,newContact,activity,audit,deletes,sample,signature,nextHref];
 const result=await db.query('select commit_prospecting_record_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as receipt',values);
 await db.exec('set constraints all immediate; set constraints all deferred');
 return result.rows[0].receipt;
};
let passed=0;
async function test(name,fn){await db.exec('begin');try{await fn();passed++;console.log(`PASS ${name}`);}finally{await db.exec('rollback');}}
async function rejects(fn,pattern){await db.exec('savepoint attempted_write');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint attempted_write');}}
const shipping={mode:'order',contactId,centerName:'Sample center',attentionName:'Jane Buyer',address1:'123 Main',city:'Chicago',state:'IL',zip:'60601',items:[{productId,quantity:1}]};
await test('ordinary activity retry has one receipt and one activity; date is retained',async()=>{
 const before=await loadLead();const submission=crypto.randomUUID();const args={submission,version:before.updated_at,payload:before,activity:{activity_type:'call',result:'No answer'}};
 const first=await commit(args);const replay=await commit(args);
 assert.equal(replay.replayed,true);assert.equal(first.updatedAt,replay.updatedAt);assert.equal(await count('prospecting_activities'),1);assert.equal(await count('prospecting_submission_receipts'),1);assert.equal((await loadLead()).next_follow_up_at,'2026-09-24');
 await rejects(()=>commit({...args,activity:{activity_type:'call',result:'Interested'}}),/submission_reused/);
});
await test('stale loaded version rejects without changing lead',async()=>{
 const before=await loadLead();await db.query("update prospecting_leads set notes='someone else',updated_at=clock_timestamp() where id=$1",[leadId]);
 await rejects(()=>commit({version:before.updated_at,payload:{...before,notes:'overwrite'}}),/updated by another/);assert.equal((await loadLead()).notes,'someone else');
});
await test('actor ownership, edit revocation, inactive status are checked',async()=>{
 await rejects(()=>commit({actor:other}),/no longer in your queue/);
 await db.query("update admin_permissions set can_edit=false where profile_id=$1",[rep]);await rejects(()=>commit(),/permission required/);
 await db.query("update profiles set is_active=false where id=$1",[owner]);await rejects(()=>commit({actor:owner}),/permission required/);
});
await test('linked order, contact, stage, request, activity, and receipt commit together',async()=>{
 const before=await loadLead();const receipt=await commit({payload:before,activity:{activity_type:'call',result:'Sample requested'},sample:shipping});
 assert.ok(receipt.orderId);assert.ok(receipt.requestId);assert.equal(receipt.stage,'sample_requested');assert.equal(await count('orders'),1);assert.equal(await count('order_items'),1);
 const request=(await db.query('select * from prospecting_sample_requests')).rows[0];assert.equal(request.status,'order_created');assert.equal(request.contact_id,contactId);
 assert.equal((await db.query("select count(*) n from prospecting_activities where activity_type='call'")).rows[0].n,1);
});
await test('failed product validation rolls back every preceding record/contact write',async()=>{
 const before=await loadLead();await rejects(()=>commit({payload:{...before,company_name:'changed'},newContact:{full_name:'new',email:'new@example.com'},activity:{activity_type:'call',result:'Sample requested'},sample:{...shipping,items:[{productId:other,quantity:1}]}}),/sample_invalid_product/);
 assert.equal((await loadLead()).company_name,'Sample center');assert.equal(await count('prospecting_contacts'),1);assert.equal(await count('orders'),0);assert.equal(await count('prospecting_sample_requests'),0);assert.equal(await count('prospecting_activities'),0);assert.equal(await count('prospecting_submission_receipts'),0);
});
await test('request-only can be completed by manager once without a second stage transition',async()=>{
 const handoff=await commit({sample:{mode:'request_only',contactId,notes:'Manager will confirm address'}});assert.equal(handoff.orderId,null);
 await rejects(()=>commit({sample:shipping}),/no longer in your queue/);
 const fulfilled=await commit({actor:owner,sample:{...shipping,requestId:handoff.requestId}});assert.ok(fulfilled.orderId);
 await rejects(()=>commit({actor:owner,sample:{...shipping,requestId:handoff.requestId}}),/sample_request_closed/);assert.equal(await count('orders'),1);
 const receipt=(await db.query('select read_prospecting_receipt_v2($1,$2) as result',[other,crypto.randomUUID()])).rows[0].result;assert.equal(receipt,null);
});
await test('selected new contact resolves after atomic contact insert',async()=>{
 const receipt=await commit({newContact:{full_name:'New Buyer',email:'new@example.com'},sample:{mode:'request_only',contactId:'new'}});const request=(await db.query('select * from prospecting_sample_requests where id=$1',[receipt.requestId])).rows[0];assert.notEqual(request.contact_id,contactId);
});
await test('invalid sample contact and contact deletion roll back',async()=>{
 await rejects(()=>commit({contacts:[{id:contactId,full_name:'Jane',email:''}],sample:{mode:'request_only',contactId}}),/sample_requested_contact_required/);assert.equal((await db.query('select email from prospecting_contacts where id=$1',[contactId])).rows[0].email,'jane@example.com');
 await rejects(()=>commit({deletes:[contactId],sample:{mode:'request_only',contactId}}),/sample_requested_contact_required/);assert.equal(await count('prospecting_contacts'),1);
});
await test('standalone order needs no lead and retry cannot duplicate it',async()=>{
 const submission=crypto.randomUUID();const args={lead:null,submission,sample:shipping};const first=await commit(args);const replay=await commit(args);assert.equal(first.orderId,replay.orderId);assert.equal(first.leadId,null);assert.equal(await count('orders'),1);assert.equal(await count('prospecting_sample_requests'),0);
});
await test('stage exit closes request; later sample entry creates a fresh request',async()=>{
 const first=await commit({sample:{mode:'request_only',contactId}});await db.query("update prospecting_leads set stage='working' where id=$1",[leadId]);await db.query("update prospecting_leads set stage='sample_requested' where id=$1",[leadId]);assert.equal(await count('prospecting_sample_requests'),2);
 assert.ok((await db.query('select closed_at from prospecting_sample_requests where id=$1',[first.requestId])).rows[0].closed_at);
});
await test('new RPCs and tables are inaccessible to authenticated and anonymous clients',async()=>{
 const result=await db.query("select has_function_privilege('authenticated','public.commit_prospecting_record_v2(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[],jsonb,text,text)','EXECUTE') as execute,has_table_privilege('anon','public.prospecting_submission_receipts','SELECT') as readable");assert.equal(result.rows[0].execute,false);assert.equal(result.rows[0].readable,false);
});
await test('ordinary sample edits never create another request or requeue an exported lead',async()=>{
 const first=await commit({sample:shipping});
 await db.query("update prospecting_leads set hubspot_status='exported' where id=$1",[leadId]);
 const before=await loadLead();await commit({actor:owner,payload:{...before,notes:'Manager reviewed'}});
 assert.equal(await count('prospecting_sample_requests'),1);assert.equal(await count('orders'),1);
 assert.equal((await loadLead()).hubspot_status,'exported');
 const repeat=await commit({actor:owner,sample:{mode:'request_only',contactId}});assert.notEqual(repeat.requestId,first.requestId);
 assert.equal(await count('prospecting_sample_requests'),2);
 assert.equal(Number((await db.query("select count(*) n from prospecting_activities where result='Sample requested'")).rows[0].n),1);
});
await test('contact-only writes invalidate an already-open record version',async()=>{
 const before=await loadLead();await db.query("update prospecting_contacts set title='Purchasing' where id=$1",[contactId]);
 await rejects(()=>commit({version:before.updated_at,payload:before}),/updated by another/);
});
await test('late activity failure rolls back an order already inserted',async()=>{
 await db.exec(`create function private.reject_test_sample_activity() returns trigger language plpgsql as $$ begin if new.result='Sample order submitted' then raise exception 'injected activity failure'; end if; return new; end; $$;
 create trigger reject_test_sample_activity before insert on prospecting_activities for each row execute function private.reject_test_sample_activity();`);
 await rejects(()=>commit({sample:shipping}),/injected activity failure/);
 assert.equal(await count('orders'),0);assert.equal(await count('order_items'),0);assert.equal(await count('prospecting_sample_requests'),0);assert.equal(await count('prospecting_submission_receipts'),0);assert.equal((await loadLead()).stage,'new');
});
await test('deferred contact requirement rejects plain sample contact removal at commit',async()=>{
 await commit({sample:{mode:'request_only',contactId}});
 await rejects(()=>commit({actor:owner,deletes:[contactId]}),/sample_requested_contact_required/);
 assert.equal(await count('prospecting_contacts'),1);
});
await test('restricted service role executes transaction with normal data grants',async()=>{
 await db.exec('grant usage on schema public to service_role; grant all on all tables in schema public to service_role; set local role service_role');
 const receipt=await commit({sample:shipping});assert.ok(receipt.orderId);
});
await test('signed receipt recovery binds the same operation to raw input after handoff',async()=>{
 const submission=crypto.randomUUID();const signature='a'.repeat(64);const changed='b'.repeat(64);
 const receipt=await commit({submission,signature,sample:{mode:'request_only',contactId}});
 const read=async signatureValue=>(await db.query('select read_prospecting_receipt_v2($1,$2,$3) as receipt',[rep,submission,signatureValue])).rows[0].receipt;
 assert.equal((await read(signature)).requestId,receipt.requestId);
 await rejects(()=>read(changed),/submission_reused/);await rejects(()=>read(null),/submission_reused/);
 await rejects(()=>commit({submission,signature:changed,sample:{mode:'request_only',contactId}}),/submission_reused/);
 const replay=await commit({submission,signature,payload:{notes:'server-derived state changed'}});assert.equal(replay.requestId,receipt.requestId);assert.equal(replay.replayed,true);
 assert.equal(await count('prospecting_sample_requests'),1);assert.equal(await count('prospecting_submission_receipts'),1);
});
await test('recovery preserves the original next destination independently of retry navigation',async()=>{
 const submission=crypto.randomUUID();const before=await loadLead();const nextHref=`/admin/sales/prospecting/${other}?preset=today`;
 const args={submission,version:before.updated_at,payload:before,nextHref};
 assert.equal((await commit(args)).nextHref,nextHref);
 assert.equal((await commit({...args,nextHref:'/admin/sales/prospecting?tab=pipeline'})).nextHref,nextHref);
 const read=(await db.query('select read_prospecting_receipt_v2($1,$2) as receipt',[rep,submission])).rows[0].receipt;
 assert.equal(read.nextHref,nextHref);
 await rejects(()=>commit({nextHref:'https://example.com'}),/Invalid prospecting continuation/);
 assert.equal(await count('prospecting_submission_receipts'),1);
});
console.log(`${passed} isolated PostgreSQL transaction scenarios passed.`);
await db.close();
