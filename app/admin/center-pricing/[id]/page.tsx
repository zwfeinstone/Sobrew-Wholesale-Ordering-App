import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { CENTER_PRICING_EMAIL_PAGE_SIZE, loadCenterPricingDetail, pricingPage } from '@/lib/center-pricing';
import { stageLabel } from '@/lib/prospecting';
import { formatAppDateTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function CenterPricingDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const [current, { id }, search] = await Promise.all([requireAdminSectionView('prospecting'), params, searchParams]);
  const page = pricingPage(search.page);
  const result = await loadCenterPricingDetail({ actorId: current.profile.id, isOwner: current.isOwner }, id, page);
  if (!result.ok && result.unavailable) notFound();
  if (!result.ok) return <section className="card space-y-4"><p role="alert">{result.error}</p><Link className="btn-secondary" href="/admin/center-pricing" prefetch={false}>Back to Center Pricing</Link></section>;
  const { center, emails, total } = result;
  const pages = Math.max(1, Math.ceil(total / CENTER_PRICING_EMAIL_PAGE_SIZE));

  return <div className="mx-auto max-w-5xl space-y-6">
    <Link href="/admin/center-pricing" prefetch={false} className="workspace-text-link">← Back to Center Pricing</Link>
    <header className="workspace-page-heading"><div className="min-w-0">
      <h1 className="page-title break-words">{center.company_name}</h1>
      <p className="page-subtitle">Pricing email history · {center.archived_at ? 'Archived' : stageLabel(center.stage)}</p>
      <p className="mt-2 text-sm text-slate-600">Current rep: {center.owner?.full_name || center.owner?.email || 'Unassigned'}</p>
    </div><Link href={`/admin/sales/prospecting/${center.id}`} prefetch={false} className="btn-secondary">View prospect</Link></header>
    {!total ? <section className="card space-y-2"><h2 className="text-lg font-semibold">No sent pricing email recorded</h2><p className="text-sm text-slate-600">Pricing emails sent through the sample order workflow will appear here automatically. Older emails sent outside the wholesale app are not included.</p></section> : <>
      <p className="text-sm text-slate-500">{total} sent {total === 1 ? 'email' : 'emails'} · Newest first. Each email preserves the pricing and message sent at that time.</p>
      {emails.map((email, index) => <details key={email.id} open={index === 0} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer break-words p-5 font-semibold text-slate-900">{formatAppDateTime(email.sent_at)} — {email.subject}</summary>
        <div className="space-y-4 border-t border-slate-200 p-3 sm:p-5">
          <dl className="grid gap-2 break-words text-sm text-slate-700">
            <div><dt className="inline font-semibold">From: </dt><dd className="inline">{email.sender_name} &lt;{email.sender_email}&gt;</dd></div>
            <div><dt className="inline font-semibold">To: </dt><dd className="inline">{email.recipient_name} &lt;{email.recipient_email}&gt;</dd></div>
            <div><dt className="inline font-semibold">Sent: </dt><dd className="inline">{formatAppDateTime(email.sent_at)}</dd></div>
            <div><dt className="inline font-semibold">Sample tracking: </dt><dd className="inline">{email.tracking_number}</dd></div>
          </dl>
          <iframe title={`Pricing email sent ${formatAppDateTime(email.sent_at)} to ${email.recipient_name}`} srcDoc={email.body_html} sandbox="" referrerPolicy="no-referrer" loading="lazy" className="h-[900px] w-full rounded-lg border border-slate-200 bg-white" />
          <details className="text-sm"><summary className="cursor-pointer font-medium text-slate-600">View plain text email</summary><pre className="mt-3 whitespace-pre-wrap break-words font-sans leading-6 text-slate-700">{email.body_text}</pre></details>
        </div>
      </details>)}
      {pages > 1 || page > 1 ? <nav aria-label="Pricing email pages" className="flex flex-wrap items-center gap-3">
        {page > 1 ? <Link className="btn-secondary" prefetch={false} href={`/admin/center-pricing/${id}?page=${page - 1}`}>Newer emails</Link> : null}
        <span className="text-sm text-slate-500">Page {page} of {pages}</span>
        {page < pages ? <Link className="btn-secondary" prefetch={false} href={`/admin/center-pricing/${id}?page=${page + 1}`}>Older emails</Link> : null}
      </nav> : null}
    </>}
  </div>;
}
