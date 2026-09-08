export default function OrdersLoading() {
  return <div className="space-y-6" role="status" aria-live="polite"><h1 className="page-title">Orders</h1><p className="text-sm text-slate-500">Loading orders...</p><div className="animate-pulse space-y-4" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-16 border-b border-slate-200 bg-slate-50" />)}</div></div>;
}
