import { startTransition, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Link from 'next/link';
import ProspectingLeadWorkspace, { useProspectingPaneRefresh } from '@/components/prospecting-lead-workspace';
import ProspectingRecordEditor from '@/components/prospecting-record-editor';
import type { RecordActionResult, RecordContact, RecordLead, RecordSaveInput } from '@/lib/prospecting-record';
import '@/app/globals.css';

type FixtureMode = 'success' | 'validation' | 'connection' | 'stale' | 'sample_validation_once';
declare global {
  interface Window {
    prospectingFixture: {
      mode: FixtureMode;
      calls: RecordSaveInput[];
      navigation: string;
      navigationCalls: string[];
      renderedHref?: string;
      refreshCount: number;
      refreshRecord: () => void;
      navigate?: (href: string, replace?: boolean) => void;
      navigationDelay?: number;
      refreshDelay?: number;
      stalledLeadIds: string[];
      stallRefresh?: boolean;
      completeLoads: () => void;
    };
  }
}

const query = new URLSearchParams(location.search);
window.prospectingFixture = { mode: (query.get('mode') || 'success') as FixtureMode, calls: [], navigation: '', navigationCalls: [], refreshCount: 0, refreshRecord: () => undefined, stalledLeadIds: [], completeLoads: () => undefined };
let lead: RecordLead = {
  id: '00000000-0000-4000-8000-000000000001', company_name: 'Lakeview Recovery', phone: '3125550101', company_email: 'hello@example.test', company_website: 'https://example.test',
  address_line_1: '10 Lake Street', address_line_2: '', city: 'Chicago', state: 'IL', postal_code: '60601', country: 'US', notes: '', updated_at: '2026-09-24T12:00:00Z',
  stage: query.get('stage') === 'sample_requested' ? 'sample_requested' : 'working', priority: 'normal', assigned_profile_id: 'rep-1', do_not_contact: false, next_follow_up_at: '2026-09-24', last_result: 'Left voicemail', hubspot_status: 'not_queued',
};
let contacts: RecordContact[] = [{ id: 'contact-1', full_name: 'Taylor Buyer', email: 'taylor@example.test', phone: '3125550102', title: 'Purchasing', notes: '', is_primary: true }];
const manager = query.get('origin') === 'leads';
const queueParams = manager ? 'origin=leads&return_to=%2Fadmin%2Fsales%2Fprospecting%2Fadmin%3Ftab%3Dpipeline' : 'view=today&origin=rep';
const workspace = query.get('workspace') === '1';
const workspaceLeads = [lead, { ...lead, id: '00000000-0000-4000-8000-000000000002', company_name: 'Riverside Recovery' }, { ...lead, id: '00000000-0000-4000-8000-000000000003', company_name: 'Oakwood Recovery' }];
const workspaceContacts = new Map(workspaceLeads.map((record) => [record.id, structuredClone(contacts)]));
const workspaceHref = (id: string) => `/admin/sales/prospecting?workspace=1&${queueParams}&lead=${id}`;
async function action(input: RecordSaveInput): Promise<RecordActionResult> {
  window.prospectingFixture.calls.push(structuredClone(input));
  await new Promise((resolve) => setTimeout(resolve, 25));
  const mode = window.prospectingFixture.mode;
  if (mode === 'connection') throw new Error('Isolated fixture response interrupted');
  if (mode === 'stale') return { ok: false, error: { code: 'record_stale', message: 'The saved record changed. Review your draft.', fieldErrors: {} } };
  if (mode === 'validation') return { ok: false, error: { code: 'validation', message: 'Check the follow-up before saving.', fieldErrors: { follow_up: 'Choose a different follow-up date.' } } };
  if (mode === 'sample_validation_once' && window.prospectingFixture.calls.length === 1) return { ok: false, error: { code: 'sample_invalid', message: 'Review the shipment notes and try again.', fieldErrors: {} } };
  if (workspace) {
    lead = workspaceLeads.find((record) => record.id === input.leadId)!;
    contacts = workspaceContacts.get(lead.id)!;
  }
  const updatedAt = new Date(Date.parse('2026-09-24T12:00:00Z') + window.prospectingFixture.calls.length * 1000).toISOString();
  const parked = ['lost', 'not_a_fit', 'recycle_try_later'].includes(input.draft.lead.stage);
  lead = { ...lead, ...input.draft.lead, assigned_profile_id: parked ? null : input.draft.lead.assigned_profile_id || null, next_follow_up_at: parked || input.draft.followUp.mode === 'clear' ? null : input.draft.followUp.mode === 'keep' ? lead.next_follow_up_at : input.draft.followUp.date, updated_at: updatedAt };
  contacts = input.draft.contacts.filter((contact) => !input.draft.deletedContactIds.includes(contact.id));
  if ([input.draft.newContact.full_name, input.draft.newContact.email, input.draft.newContact.phone].some(Boolean)) contacts.push({ ...input.draft.newContact, id: `new-contact-${window.prospectingFixture.calls.length}` });
  if (workspace) {
    workspaceLeads[workspaceLeads.findIndex((record) => record.id === lead.id)] = lead;
    workspaceContacts.set(lead.id, contacts);
  }
  const nextRecord = workspaceLeads[workspaceLeads.findIndex((record) => record.id === lead.id) + 1];
  return { ok: true, receipt: { leadId: lead.id, updatedAt, stage: input.draft.lead.stage, requestId: input.sample ? 'request-1' : null, orderId: input.sample?.mode === 'order' ? 'sample-order-1' : null }, nextHref: workspace && nextRecord ? workspaceHref(nextRecord.id) : '/admin/sales/prospecting/next-lead?view=today' };
}

const root = createRoot(document.getElementById('fixture-root')!);
function editor(record = lead, recordContacts = contacts, previousHref = '/admin/sales/prospecting/previous-lead?view=today', nextHref = '/admin/sales/prospecting/next-lead?view=today') {
  return <ProspectingRecordEditor key={`${record.id}:${record.updated_at}`} lead={record} contacts={recordContacts} actorId="fixture-actor" canEdit={query.get('readonly') !== '1'} isOwner={manager} salesReps={[{ id: 'rep-1', full_name: 'Morgan Rep', email: 'morgan@example.test' }]} products={[{ id: 'product-1', name: 'Coffee sample box', sku: 'SAMPLE-1' }]} productsError={false} contactsError={false} today="2026-09-24" queueParams={queueParams} backHref={manager ? '/admin/sales/prospecting/admin?tab=pipeline' : '/admin/sales/prospecting?view=today'} previousHref={previousHref} nextHref={nextHref} action={action} history={<section id="activity-history" className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Activity history</h2>{workspace ? <Link href={`${workspaceHref(record.id)}#activity-history`}>Jump to activity history</Link> : null}<p className="mt-2 text-sm">Yesterday · Left voicemail</p></section>} source={<p>Fixture lead list</p>} />;
}

// Suspending a route render inside the shell's transition models an uncached RSC
// response without running Next or touching a real prospecting record. History
// changes only when the route commits, so a second click still sees the old URL.
type FixtureRoute = { href: string; kind: 'push' | 'replace' | 'restore' | 'refresh'; revision: number };
const readyLoads = new Set([`lead:${query.get('lead') || workspaceLeads[0].id}`]);
const pendingLoads = new Map<string, { promise: Promise<void>; complete: () => void }>();
window.prospectingFixture.completeLoads = () => { for (const load of pendingLoads.values()) load.complete(); };
function readWorkspaceRecord(route: FixtureRoute) {
  const id = new URL(route.href, location.href).searchParams.get('lead') || workspaceLeads[0].id;
  const key = route.kind === 'refresh' ? `refresh:${route.revision}:${id}` : `lead:${id}`;
  if (!readyLoads.has(key)) {
    if (!pendingLoads.has(key)) {
      let complete = () => {};
      const promise = new Promise<void>((resolve) => { complete = () => { readyLoads.add(key); resolve(); }; });
      pendingLoads.set(key, { promise, complete });
      const stalled = route.kind === 'refresh' ? window.prospectingFixture.stallRefresh : window.prospectingFixture.stalledLeadIds.includes(id);
      if (!stalled) setTimeout(complete, route.kind === 'refresh' ? window.prospectingFixture.refreshDelay ?? 25 : window.prospectingFixture.navigationDelay ?? 500);
    }
    throw pendingLoads.get(key)!.promise;
  }
  return workspaceLeads.find((record) => record.id === id)!;
}
function FixturePaneControls() {
  const refresh = useProspectingPaneRefresh();
  return <button type="button" onClick={() => refresh?.()}>Refresh fixture record</button>;
}
function WorkspaceFixture() {
  const [route, setRoute] = useState<FixtureRoute>({ href: location.href, kind: 'restore', revision: 0 });
  useEffect(() => {
    window.prospectingFixture.navigate = (nextHref, replace = false) => {
      setRoute((current) => ({ href: nextHref, kind: replace ? 'replace' : 'push', revision: current.revision + 1 }));
    };
    window.prospectingFixture.refreshRecord = () => setRoute((current) => ({ ...current, kind: 'refresh', revision: current.revision + 1 }));
    const onPopState = () => startTransition(() => setRoute((current) => ({ href: location.href, kind: 'restore', revision: current.revision + 1 })));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useLayoutEffect(() => {
    const nextUrl = new URL(route.href, location.href);
    if ((route.kind === 'push' || route.kind === 'replace') && nextUrl.href !== location.href) {
      history[route.kind === 'replace' ? 'replaceState' : 'pushState']({}, '', nextUrl.href);
    }
  }, [route]);
  const record = readWorkspaceRecord(route);
  window.prospectingFixture.renderedHref = route.href;
  const index = workspaceLeads.findIndex((item) => item.id === record.id);
  const queue = <div className="space-y-3">
    <label className="block">Search leads<input aria-label="Search leads" className="input mt-1" placeholder="Search company, phone, city..." /></label>
    <details data-testid="queue-filters" className="rounded-lg border p-3"><summary>Filters</summary><label>Priority<select aria-label="Queue priority" defaultValue="all"><option value="all">All priorities</option><option value="high">High</option></select></label></details>
    {workspaceLeads.map((item) => <Link key={item.id} href={workspaceHref(item.id)} aria-current={record.id === item.id ? 'page' : undefined} className="block rounded-xl border border-slate-200 p-4">{item.company_name}</Link>)}
    <FixturePaneControls />
    <div aria-hidden="true" style={{ height: 1200 }} />
  </div>;
  return <main className="p-6"><ProspectingLeadWorkspace leadId={record.id} queue={queue}>{editor(record, workspaceContacts.get(record.id)!, index ? workspaceHref(workspaceLeads[index - 1].id) : '', workspaceLeads[index + 1] ? workspaceHref(workspaceLeads[index + 1].id) : '')}</ProspectingLeadWorkspace></main>;
}
function renderRecord() {
  root.render(workspace ? <Suspense fallback={<p>Loading workspace…</p>}><WorkspaceFixture /></Suspense> : <main className="mx-auto w-full max-w-5xl p-3 sm:p-6">{editor()}</main>);
}
window.prospectingFixture.refreshRecord = renderRecord;
renderRecord();
