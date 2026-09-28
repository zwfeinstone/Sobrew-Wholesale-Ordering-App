import { createRoot } from 'react-dom/client';
import ProspectingSingleLeadForm from '@/components/prospecting-single-lead-form';
import type { SingleLeadResult } from '@/lib/prospecting-single-lead-result';
import '@/app/globals.css';

type FixtureMode = 'success' | 'validation' | 'connection' | 'partial' | 'deferred';
declare global {
  interface Window {
    singleLeadFixture: {
      mode: FixtureMode;
      calls: Record<string, string>[];
      complete: (() => void) | null;
    };
  }
}

const query = new URLSearchParams(location.search);
window.singleLeadFixture = { mode: (query.get('mode') || 'success') as FixtureMode, calls: [], complete: null };
const leadId = '00000000-0000-4000-8000-000000000001';

async function action(data: FormData): Promise<SingleLeadResult> {
  window.singleLeadFixture.calls.push(Object.fromEntries(Array.from(data.entries(), ([name, value]) => [name, String(value)])));
  const mode = window.singleLeadFixture.mode;
  if (mode === 'deferred') await new Promise<void>((resolve) => { window.singleLeadFixture.complete = resolve; });
  if (mode === 'connection') throw new Error('Isolated fixture response interrupted');
  if (mode === 'validation') return { ok: false, message: 'Select an eligible assigned rep before saving.' };
  if (mode === 'partial') return { ok: false, leadId, message: 'The lead was saved, but the contact could not be saved. Review the lead before trying again.' };
  return {
    ok: true, leadId, message: 'Prospect saved.', href: `/admin/sales/prospecting/${leadId}`,
    ...(data.get('stage') === 'sample_requested' ? { sampleOrderHref: `/admin/sales/prospecting/sample-order?lead=${leadId}` } : {}),
  };
}

const textFields = [
  ['Company name', 'company_name'], ['Phone', 'phone'], ['Company email', 'company_email'],
  ['Website', 'company_website'], ['Address 1', 'address_line_1'], ['Address 2', 'address_line_2'],
  ['City', 'city'], ['State', 'state'], ['Postal code', 'postal_code'], ['Country', 'country'],
  ['Contact name', 'contact_full_name'], ['Contact title', 'contact_title'],
  ['Contact email', 'contact_email'], ['Contact phone', 'contact_phone'],
  ['New list name', 'list_name'], ['Last result', 'last_result'],
] as const;

createRoot(document.getElementById('fixture-root')!).render(
  <main className="mx-auto max-w-5xl p-3 sm:p-6">
    <ProspectingSingleLeadForm action={action} canEdit={query.get('readonly') !== '1'}>
      <div className="grid gap-3 md:grid-cols-2">
        {textFields.map(([label, name]) => (
          <label key={name} className="text-sm font-semibold text-slate-700">
            {label}
            <input className="input mt-2" name={name} required={name === 'company_name'} defaultValue={name === 'country' ? 'US' : ''} type={name.endsWith('email') ? 'email' : 'text'} />
          </label>
        ))}
        <label>Assigned rep<select className="input mt-2" name="assigned_profile_id" defaultValue=""><option value="">Unassigned</option><option value="rep-1">Morgan Rep</option></select></label>
        <label>Next follow-up<input className="input mt-2" type="date" name="next_follow_up_at" /></label>
        <label>Stage<select className="input mt-2" name="stage" defaultValue="new"><option value="new">New</option><option value="sample_requested">Sample Requested</option></select></label>
        <label>Priority<select className="input mt-2" name="priority" defaultValue="normal"><option value="normal">Normal</option><option value="high">High</option></select></label>
        <label>Or add to existing list<select className="input mt-2" name="existing_list_id" defaultValue=""><option value="">No existing list</option><option value="list-1">Recovery centers</option></select></label>
        <label>Notes<textarea className="input mt-2" name="notes" /></label>
      </div>
    </ProspectingSingleLeadForm>
  </main>,
);
