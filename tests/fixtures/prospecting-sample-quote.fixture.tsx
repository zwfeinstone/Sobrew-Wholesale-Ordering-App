import { createRoot } from 'react-dom/client';
import ProspectingSampleQuoteForm, { type SampleQuoteFormState } from '@/components/prospecting-sample-quote-form';
import type { SampleQuoteLine } from '@/lib/prospecting-sample-quote';
import '@/app/globals.css';

type FixtureMode = 'success' | 'connection' | 'validation' | 'deferred';
type SubmittedQuote = { orderId: string; trackingNumber: string; lines: SampleQuoteLine[] };
declare global {
  interface Window {
    sampleQuoteFixture: { mode: FixtureMode; calls: SubmittedQuote[]; complete?: () => void };
  }
}
const query = new URLSearchParams(location.search);
window.sampleQuoteFixture = { mode: (query.get('mode') || 'success') as FixtureMode, calls: [] };
// Shared routing stub contract; quote fixture never loads the record-editor fixture.
Object.assign(window, { prospectingFixture: { navigation: '', navigationCalls: [], refreshCount: 0, refreshRecord: () => undefined } });

async function action(_previous: SampleQuoteFormState, formData: FormData): Promise<SampleQuoteFormState> {
  window.sampleQuoteFixture.calls.push({ orderId: String(formData.get('order_id')), trackingNumber: String(formData.get('tracking_number')), lines: JSON.parse(String(formData.get('lines'))) });
  if (window.sampleQuoteFixture.mode === 'deferred') await new Promise<void>(resolve => { window.sampleQuoteFixture.complete = resolve; });
  if (window.sampleQuoteFixture.mode === 'connection') throw new Error('Isolated email response interrupted');
  if (window.sampleQuoteFixture.mode === 'validation') return { error: 'Review the tracking number before sending.', locked: false };
  return { sentAt: '2026-09-30T12:00:00Z', locked: true };
}

createRoot(document.getElementById('fixture-root')!).render(<main className="mx-auto w-full max-w-5xl p-3 sm:p-6"><h1 className="mb-6 text-2xl font-semibold">Sample tracking &amp; pricing</h1><ProspectingSampleQuoteForm action={action} orderId="sample-order-1" contactName="Ron Smith" contactEmail="ron@example.test" senderName="Haskins" senderEmail="haskins@sobrew.com" canEdit={query.get('readonly') !== '1'} backHref="/admin/sales/prospecting/admin?tab=requests&amp;request_view=orders" /></main>);
