'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { REPORT_DETAIL_ROW_LIMIT, reportDetailPage } from '@/lib/admin-query-limits';

export default function ReportDetailPagination({ total }: { total: number }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = reportDetailPage(total, Number(searchParams.get('detail_page') || 1));
  if (total <= REPORT_DETAIL_ROW_LIMIT) return null;
  const pages = Math.ceil(total / REPORT_DETAIL_ROW_LIMIT);
  const href = (nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage === 1) params.delete('detail_page');
    else params.set('detail_page', String(nextPage));
    return `${pathname}?${params.toString()}`;
  };
  return (
    <nav aria-label="Report detail pages" className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
      <span>Rows {((page - 1) * REPORT_DETAIL_ROW_LIMIT + 1).toLocaleString()}–{Math.min(total, page * REPORT_DETAIL_ROW_LIMIT).toLocaleString()} of {total.toLocaleString()}</span>
      {page > 1 ? <Link prefetch={false} scroll={false} className="btn-secondary" href={href(page - 1)}>Previous</Link> : null}
      <span>Page {page} of {pages}</span>
      {page < pages ? <Link prefetch={false} scroll={false} className="btn-secondary" href={href(page + 1)}>Next</Link> : null}
    </nav>
  );
}
