import Link from 'next/link';
import { ArrowUpRight, Mail } from 'lucide-react';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { CENTER_PRICING_PAGE_SIZE, centerPricingFilters, centerPricingHref, loadCenterPricingList } from '@/lib/center-pricing';
import { stageLabel } from '@/lib/prospecting';
import { formatAppDateTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function CenterPricingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [current, params] = await Promise.all([requireAdminSectionView('prospecting'), searchParams]);
  const filters = centerPricingFilters(params);
  const result = await loadCenterPricingList({ actorId: current.profile.id, isOwner: current.isOwner }, filters);
  const pages = result.ok ? Math.max(1, Math.ceil(result.total / CENTER_PRICING_PAGE_SIZE)) : 1;

  return <div className="space-y-6">
    <header className="workspace-page-heading">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Growth</p>
        <h1 className="page-title mt-2">Center Pricing</h1>
        <p className="page-subtitle">Find the pricing emails sent with each center’s samples.</p>
      </div>
      <Link href="/admin/sales/prospecting" prefetch={false} className="btn-secondary">Prospecting <ArrowUpRight aria-hidden="true" className="h-4 w-4" /></Link>
    </header>
    <p className="text-sm text-slate-600">{current.isOwner ? 'Centers with sent pricing emails, across every rep.' : 'Centers with sent pricing emails currently assigned to you in prospecting.'} Sent emails stay in the history as centers move through the pipeline.</p>
    <form action="/admin/center-pricing" method="get" className="card flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 basis-64 space-y-1"><span className="text-sm font-medium">Search centers</span><input className="input w-full" type="search" name="q" maxLength={100} defaultValue={filters.search} placeholder="Center name" /></label>
      <button type="submit" className="btn-primary">Search</button>
      {filters.search ? <Link href="/admin/center-pricing" prefetch={false} className="btn-secondary">Clear</Link> : null}
    </form>
    {!result.ok ? <p className="workspace-notice warning" role="alert">{result.error}</p> : <>
      <p className="text-sm text-slate-500" role="status">{result.total.toLocaleString()} {result.total === 1 ? 'center' : 'centers'}{pages > 1 ? ` · Page ${filters.page} of ${pages}` : ''}</p>
      {!result.centers.length ? <section className="card space-y-2"><h2 className="text-lg font-semibold">No centers found</h2><p className="text-sm text-slate-600">{filters.search ? 'Try another center name.' : 'Centers will appear after a pricing email is sent.'}</p></section> : <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="Center pricing history">
        {result.centers.map(center => {
          const sentAt = center.quotes[0]?.sent_at;
          return <li key={center.id}><Link href={`/admin/center-pricing/${center.id}`} prefetch={false} className="flex min-w-0 flex-wrap items-center justify-between gap-4 p-5 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700">
            <div className="min-w-0 flex-1 basis-64">
              <h2 className="break-words font-semibold text-slate-950">{center.company_name}</h2>
              <p className="mt-1 text-sm text-slate-500">{[center.city, center.state].filter(Boolean).join(', ') || 'Location not recorded'} · {center.archived_at ? 'Archived' : stageLabel(center.stage)}</p>
              {current.isOwner ? <p className="mt-1 text-sm text-slate-600">Assigned to {center.owner?.full_name || center.owner?.email || 'Unassigned'}</p> : null}
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm"><p className="font-medium text-teal-800">Pricing sent</p>{sentAt ? <p className="mt-1 text-xs text-slate-500">{formatAppDateTime(sentAt)}</p> : null}</div>
              <Mail aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-400" />
            </div>
          </Link></li>;
        })}
      </ul>}
      {pages > 1 || filters.page > 1 ? <nav aria-label="Center pricing pages" className="flex flex-wrap items-center gap-3">
        {filters.page > 1 ? <Link className="btn-secondary" prefetch={false} href={centerPricingHref(filters, filters.page - 1)}>Previous</Link> : null}
        {filters.page < pages ? <Link className="btn-secondary" prefetch={false} href={centerPricingHref(filters, filters.page + 1)}>Next</Link> : null}
      </nav> : null}
    </>}
  </div>;
}
