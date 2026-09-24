import { createRoot } from 'react-dom/client';
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
      refreshCount: number;
      refreshRecord: () => void;
    };
  }
}

const query = new URLSearchParams(location.search);
window.prospectingFixture = { mode: (query.get('mode') || 'success') as FixtureMode, calls: [], navigation: '', refreshCount: 0, refreshRecord: () => undefined };
let lead: RecordLead = {
  id: '00000000-0000-4000-8000-000000000001', company_name: 'Lakeview Recovery', phone: '3125550101', company_email: 'hello@example.test', company_website: 'https://example.test',
  address_line_1: '10 Lake Street', address_line_2: '', city: 'Chicago', state: 'IL', postal_code: '60601', country: 'US', notes: '', updated_at: '2026-09-24T12:00:00Z',
  stage: query.get('stage') === 'sample_requested' ? 'sample_requested' : 'working', priority: 'normal', assigned_profile_id: 'rep-1', do_not_contact: false, next_follow_up_at: '2026-09-24', last_result: 'Left voicemail', hubspot_status: 'not_queued',
};
let contacts: RecordContact[] = [{ id: 'contact-1', full_name: 'Taylor Buyer', email: 'taylor@example.test', phone: '3125550102', title: 'Purchasing', notes: '', is_primary: true }];
const manager = query.get('origin') === 'leads';
const queueParams = manager ? 'origin=leads&return_to=%2Fadmin%2Fsales%2Fprospecting%2Fadmin%3Ftab%3Dpipeline' : 'view=today&origin=rep';
async function action(input: RecordSaveInput): Promise<RecordActionResult> {
  window.prospectingFixture.calls.push(structuredClone(input));
  await new Promise((resolve) => setTimeout(resolve, 25));
  const mode = window.prospectingFixture.mode;
  if (mode === 'connection') throw new Error('Isolated fixture response interrupted');
  if (mode === 'stale') return { ok: false, error: { code: 'record_stale', message: 'The saved record changed. Review your draft.', fieldErrors: {} } };
  if (mode === 'validation') return { ok: false, error: { code: 'validation', message: 'Check the follow-up before saving.', fieldErrors: { follow_up: 'Choose a different follow-up date.' } } };
  if (mode === 'sample_validation_once' && window.prospectingFixture.calls.length === 1) return { ok: false, error: { code: 'sample_invalid', message: 'Review the shipment notes and try again.', fieldErrors: {} } };
  const updatedAt = new Date(Date.parse('2026-09-24T12:00:00Z') + window.prospectingFixture.calls.length * 1000).toISOString();
  const parked = ['lost', 'not_a_fit', 'recycle_try_later'].includes(input.draft.lead.stage);
  lead = { ...lead, ...input.draft.lead, assigned_profile_id: parked ? null : input.draft.lead.assigned_profile_id || null, next_follow_up_at: parked || input.draft.followUp.mode === 'clear' ? null : input.draft.followUp.mode === 'keep' ? lead.next_follow_up_at : input.draft.followUp.date, updated_at: updatedAt };
  contacts = input.draft.contacts.filter((contact) => !input.draft.deletedContactIds.includes(contact.id));
  if ([input.draft.newContact.full_name, input.draft.newContact.email, input.draft.newContact.phone].some(Boolean)) contacts.push({ ...input.draft.newContact, id: `new-contact-${window.prospectingFixture.calls.length}` });
  return { ok: true, receipt: { leadId: lead.id, updatedAt, stage: input.draft.lead.stage, requestId: input.sample ? 'request-1' : null, orderId: input.sample?.mode === 'order' ? 'sample-order-1' : null }, nextHref: '/admin/sales/prospecting/next-lead?view=today' };
}

const root = createRoot(document.getElementById('fixture-root')!);
function renderRecord() { root.render(
  <main className="mx-auto w-full max-w-5xl p-3 sm:p-6">
    <ProspectingRecordEditor key={lead.updated_at} lead={lead} contacts={contacts} actorId="fixture-actor" canEdit={query.get('readonly') !== '1'} isOwner={manager} salesReps={[{ id: 'rep-1', full_name: 'Morgan Rep', email: 'morgan@example.test' }]} products={[{ id: 'product-1', name: 'Coffee sample box', sku: 'SAMPLE-1' }]} productsError={false} contactsError={false} today="2026-09-24" queueParams={queueParams} backHref={manager ? '/admin/sales/prospecting/admin?tab=pipeline' : '/admin/sales/prospecting?view=today'} previousHref="/admin/sales/prospecting/previous-lead?view=today" nextHref="/admin/sales/prospecting/next-lead?view=today" action={action} history={<section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Activity history</h2><p className="mt-2 text-sm">Yesterday · Left voicemail</p></section>} source={<p>Fixture lead list</p>} />
  </main>,
); }
window.prospectingFixture.refreshRecord = renderRecord;
renderRecord();
