'use client';

import { AdminNavigationRetry } from '@/components/admin-navigation';

export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Reports</span>
        <h1 className="page-title mt-4">Reporting dashboard</h1>
        <p className="page-subtitle mt-3">Something went wrong while loading the report data.</p>
      </section>
      <section role="alert" className="card border-rose-200 bg-rose-50/70 text-sm leading-6 text-rose-800">
        <p className="font-semibold">Unable to render reports.</p>
        <p className="mt-1">{error.message || 'Please try again.'}</p>
        <AdminNavigationRetry reset={reset} />
      </section>
    </div>
  );
}
