import { createRoot } from 'react-dom/client';
import ProspectingSampleOrderForm, { type SampleOrderFormState } from '@/components/prospecting-sample-order-form';
import '@/app/globals.css';

declare global { interface Window { sampleOrderFixture: { calls: number } } }
window.sampleOrderFixture = { calls: 0 };
Object.assign(window, { prospectingFixture: { navigation: '', navigationCalls: [], refreshCount: 0, refreshRecord: () => undefined } });
const linked = new URLSearchParams(location.search).get('standalone') !== '1';
async function action(): Promise<SampleOrderFormState> {
  window.sampleOrderFixture.calls++;
  return { orderId: 'sample-order-1', successHref: '/admin/sales/prospecting/admin?tab=requests&sample_page=3' };
}
createRoot(document.getElementById('fixture-root')!).render(<main className="mx-auto w-full max-w-5xl p-3 sm:p-6"><h1 className="mb-6 text-2xl font-semibold">Fulfill sample request</h1><ProspectingSampleOrderForm action={action} initialValues={{ center_name: 'Lakeview Recovery', attention_name: 'Ron Smith', address1: '10 Lake Street', address2: '', city: 'Chicago', state: 'IL', zip: '60601', notes: '', contact_id: 'contact-1' }} submissionId="00000000-0000-4000-8000-000000000011" actorId="rep-1" hiddenFields={[{ name: 'lead_id', value: linked ? 'lead-1' : '' }, { name: 'request_id', value: linked ? 'request-1' : '' }, { name: 'expected_updated_at', value: '2026-09-30T12:00:00Z' }]} contacts={[{ id: 'contact-1', full_name: 'Ron Smith', email: 'ron@example.test', eligible: true }]} products={[{ id: '00000000-0000-4000-8000-000000000022', label: 'Coffee sample box' }]} initialQuantities={{ '00000000-0000-4000-8000-000000000022': 1 }} canEdit linked={linked} backHref="/admin/sales/prospecting/admin?tab=requests" /></main>);
