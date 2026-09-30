import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import ProspectingSampleQuoteForm, { type SampleQuoteFormState } from '@/components/prospecting-sample-quote-form';
import { adminCanEdit, requireAdminSectionEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { isProspectingWorkspaceEnabled } from '@/lib/prospecting-rollout';
import { loadSampleQuoteContext, sendSampleQuote } from '@/lib/prospecting-sample-quote-delivery';
import { validateSampleQuoteInput } from '@/lib/prospecting-sample-quote';
import { safeProspectingReturnPath } from '@/lib/prospecting';

async function submitQuote(orderId: string, expectedRecipientEmail: string, expectedSenderEmail: string, _previous: SampleQuoteFormState, data: FormData): Promise<SampleQuoteFormState> {
  'use server';
  const current = await requireAdminSectionEdit('prospecting');
  if (data.get('order_id') !== orderId) return { error: 'The sample order changed. Reload before sending.' };
  let lines: unknown;
  try { lines = JSON.parse(String(data.get('lines') ?? '')); }
  catch { return { error: 'The selected quote items could not be read. Please review the quote and try again.' }; }
  const result = await sendSampleQuote({ orderId, expectedRecipientEmail, expectedSenderEmail,
    trackingNumber: String(data.get('tracking_number') ?? ''), lines,
    actorId: current.profile.id, isOwner: current.isOwner, workspaceEnabled: isProspectingWorkspaceEnabled(),
  });
  if (result.sentAt) {
    revalidatePath(`/admin/sales/prospecting/sample-order/${orderId}/quote`);
    revalidatePath('/admin/sales/prospecting/admin');
  }
  return result;
}

export default async function SampleQuotePage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams?: Promise<{ back?: string | string[] }> }) {
  const [{ orderId }, search, current] = await Promise.all([params, searchParams, requireAdminSectionView('prospecting')]);
  const loaded = await loadSampleQuoteContext({ orderId, actorId: current.profile.id, isOwner: current.isOwner, workspaceEnabled: isProspectingWorkspaceEnabled() });
  if (!loaded.ok) return <div className="mx-auto max-w-4xl space-y-5">
    <h1 className="page-title">Samples tracking &amp; pricing</h1>
    <section className="card space-y-4" role="alert"><p>{loaded.error}</p><Link className="btn-secondary" href="/admin/sales/prospecting">Back to prospecting</Link></section>
  </div>;
  const context = loaded.context;
  const backHref = safeProspectingReturnPath(typeof search?.back === 'string' ? search.back : '') || '/admin/sales/prospecting';
  const initial = context.quote ? validateSampleQuoteInput(context.quote.tracking_number, context.quote.lines) : null;
  if (initial && !initial.ok) return <section className="card" role="alert">The saved quote needs administrator review before it can be displayed or retried.</section>;
  return <div className="mx-auto max-w-4xl space-y-6">
    <section className="panel space-y-3">
      <Link className="text-sm font-semibold text-teal-800 underline" href={`/admin/sales/prospecting/${context.leadId}`}>Back to {context.companyName}</Link>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sample order · Next step</p>
      <h1 className="page-title">Samples tracking &amp; pricing</h1>
      <p className="page-subtitle">The sample order for {context.companyName} is saved. Add tracking, choose the pricing to include, and send the email from the lead owner.</p>
      <Link className="text-sm font-semibold text-teal-800 underline" href={`/admin/orders/${orderId}`}>View sample order</Link>
    </section>
    {context.sendBlockedReason ? <p className="rounded-lg bg-amber-50 p-4 text-amber-900" role="alert">{context.sendBlockedReason}</p> : null}
    <ProspectingSampleQuoteForm orderId={orderId} action={submitQuote.bind(null, orderId, context.contactEmail, context.senderEmail)}
      contactName={context.contactName} contactEmail={context.contactEmail} senderName={context.senderName} senderEmail={context.senderEmail}
      initialTrackingNumber={initial?.ok ? initial.trackingNumber : undefined} initialLines={initial?.ok ? initial.lines : undefined}
      savedEmail={context.quote ? { subject: context.quote.subject, html: context.quote.body_html } : undefined}
      canEdit={(current.isOwner || adminCanEdit(current.access, 'prospecting')) && !context.sendBlockedReason}
      sentAt={context.quote?.sent_at} locked={Boolean(context.quote)} backHref={backHref} />
  </div>;
}
