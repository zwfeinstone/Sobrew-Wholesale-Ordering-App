'use client';

export default function OrdersError({ reset }: { reset: () => void }) {
  return <div className="workspace-empty" role="alert"><h1 className="page-title">Orders could not be loaded</h1><p>Your orders have not changed.</p><button type="button" className="btn-primary" onClick={reset}>Try again</button></div>;
}
