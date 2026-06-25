function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-white/60 ${className}`} />;
}

export default function ReportsLoading() {
  return (
    <div className="space-y-6">
      <section className="panel space-y-4">
        <SkeletonBlock className="h-6 w-32" />
        <SkeletonBlock className="h-10 w-full max-w-2xl" />
        <SkeletonBlock className="h-5 w-full max-w-xl" />
      </section>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-32" />
        ))}
      </section>
      <section className="card space-y-4">
        <SkeletonBlock className="h-7 w-56" />
        <SkeletonBlock className="h-64 w-full" />
      </section>
    </div>
  );
}
