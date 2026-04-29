const ORDER_STATUS_STEPS = ['New', 'Processing', 'Shipped'] as const;

type OrderStatus = (typeof ORDER_STATUS_STEPS)[number];

function normalizeOrderStatus(status: string | null | undefined): OrderStatus | null {
  return ORDER_STATUS_STEPS.find((step) => step === status) ?? null;
}

export function orderStatusBadgeClasses(status: string | null | undefined) {
  if (status === 'New') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (status === 'Processing') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (status === 'Shipped') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

export function OrderStatusBadge({ status }: { status: string | null | undefined }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${orderStatusBadgeClasses(status)}`}>
      {status || 'Unknown'}
    </span>
  );
}

export function OrderStatusTimeline({ status }: { status: string | null | undefined }) {
  const normalizedStatus = normalizeOrderStatus(status);
  const activeIndex = normalizedStatus ? ORDER_STATUS_STEPS.indexOf(normalizedStatus) : -1;

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {ORDER_STATUS_STEPS.map((step, index) => {
        const complete = index <= activeIndex;
        return (
          <div
            key={step}
            className={`rounded-2xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] ${
              complete ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white/65 text-slate-500'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${complete ? 'bg-teal-600' : 'bg-slate-300'}`} />
              {step}
            </div>
          </div>
        );
      })}
    </div>
  );
}
