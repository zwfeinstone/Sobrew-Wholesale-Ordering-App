'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type MouseEvent, useState, useTransition } from 'react';

export type InvoicingViewTab = {
  href: string;
  id: string;
  label: string;
};

export default function InvoicingViewTabs({
  activeView,
  views,
}: {
  activeView: string;
  views: InvoicingViewTab[];
}) {
  const router = useRouter();
  const [pendingView, setPendingView] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleViewClick(event: MouseEvent<HTMLAnchorElement>, view: InvoicingViewTab) {
    const modifiedClick = event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (modifiedClick || view.id === activeView) return;

    event.preventDefault();
    setPendingView(view.id);
    startTransition(() => router.push(view.href));
  }

  const effectivePendingView = isPending && pendingView !== activeView ? pendingView : null;
  const pendingLabel = views.find((view) => view.id === effectivePendingView)?.label ?? null;

  return (
    <div className="space-y-2">
      <nav
        aria-busy={effectivePendingView ? true : undefined}
        aria-label="Invoicing views"
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6"
      >
        {views.map((view) => (
          <Link
            aria-current={activeView === view.id ? 'page' : undefined}
            key={view.id}
            className={`rounded-lg border px-3 py-2 text-center text-sm font-semibold ${activeView === view.id ? 'border-teal-200 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white/70 text-slate-700'}`}
            href={view.href}
            onClick={(event) => handleViewClick(event, view)}
            prefetch={false}
          >
            {effectivePendingView === view.id ? `Loading ${view.label}...` : view.label}
          </Link>
        ))}
      </nav>
      {pendingLabel ? (
        <p aria-live="polite" className="text-center text-xs font-medium text-slate-500" role="status">
          Loading {pendingLabel}...
        </p>
      ) : null}
    </div>
  );
}
