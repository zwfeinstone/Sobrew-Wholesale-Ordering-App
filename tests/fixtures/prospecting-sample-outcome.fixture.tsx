import { createRoot } from 'react-dom/client';
import ProspectingSampleOutcomeCard from '@/components/prospecting-sample-outcome-card';
import '@/app/globals.css';

type FixtureMode = 'success' | 'validation' | 'connection' | 'deferred';
type SubmittedOutcome = {
  lead_id: string;
  outcome: string;
  outcome_note: string;
  expected_updated_at: string;
  submission_id: string;
};
declare global {
  interface Window {
    sampleOutcomeFixture: {
      mode: FixtureMode;
      calls: SubmittedOutcome[];
      complete: Record<string, () => void>;
      rerender: () => void;
    };
  }
}

const query = new URLSearchParams(location.search);
window.sampleOutcomeFixture = {
  mode: (query.get('mode') || 'success') as FixtureMode,
  calls: [],
  complete: {},
  rerender: () => undefined,
};
// Refresh deliberately returns the same open leads: local removal must survive stale data.
Object.assign(window, { prospectingFixture: { navigation: '', navigationCalls: [], refreshCount: 0, refreshRecord: () => window.sampleOutcomeFixture.rerender() } });

async function action(formData: FormData): Promise<{ ok: true } | { ok: false; message: string }> {
  const submitted: SubmittedOutcome = {
    lead_id: String(formData.get('lead_id') ?? ''),
    outcome: String(formData.get('outcome') ?? ''),
    outcome_note: String(formData.get('outcome_note') ?? ''),
    expected_updated_at: String(formData.get('expected_updated_at') ?? ''),
    submission_id: String(formData.get('submission_id') ?? ''),
  };
  window.sampleOutcomeFixture.calls.push(submitted);
  const mode = window.sampleOutcomeFixture.mode;
  if (mode === 'deferred') {
    await new Promise<void>(resolve => { window.sampleOutcomeFixture.complete[submitted.lead_id] = resolve; });
  }
  if (mode === 'connection') throw new Error('Isolated outcome response interrupted');
  if (mode === 'validation') return { ok: false, message: 'The lead changed. Refresh the record and try again.' };
  return { ok: true };
}

const leads = [
  { id: '00000000-0000-4000-8000-000000000001', companyName: 'Better Choice Treatment Center - Las Vegas, NV', updatedAt: '2026-09-30T12:00:00Z' },
  { id: '00000000-0000-4000-8000-000000000002', companyName: 'Lakeview Recovery', updatedAt: '2026-09-30T13:00:00Z' },
];
const root = createRoot(document.getElementById('fixture-root')!);
function renderFixture() {
  root.render(
    <main className="mx-auto w-full max-w-7xl space-y-4 p-3 sm:p-6">
      <h1 className="text-2xl font-semibold">Sample follow-up</h1>
      {leads.map(lead => (
        <ProspectingSampleOutcomeCard key={lead.id} action={action} canEdit={query.get('readonly') !== '1'} leadId={lead.id} companyName={lead.companyName} expectedUpdatedAt={lead.updatedAt}>
          <div className="space-y-3">
            <span className="badge">Sample Requested</span>
            <h2 className="text-xl font-semibold">{lead.companyName}</h2>
            <p>Last result: Sample order submitted</p>
          </div>
        </ProspectingSampleOutcomeCard>
      ))}
    </main>,
  );
}
window.sampleOutcomeFixture.rerender = renderFixture;
renderFixture();
