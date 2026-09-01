function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-white/60 ${className}`} />;
}

export default function InvoicingLoading() {
  return (
    <section aria-live="polite" className="space-y-6" role="status">
      <div className="space-y-3">
        <SkeletonBlock className="h-5 w-24" />
        <SkeletonBlock className="h-10 w-48" />
        <p className="text-sm font-medium text-slate-600">Loading invoicing...</p>
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <SkeletonBlock className="h-28" key={index} />
        ))}
      </div>
      <SkeletonBlock className="h-12 w-full" />
      <SkeletonBlock className="h-72 w-full" />
    </section>
  );
}
