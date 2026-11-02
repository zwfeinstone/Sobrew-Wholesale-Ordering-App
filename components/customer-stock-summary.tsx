import type { CustomerStockBalance } from '@/lib/customer-stock';

const quantityFormat = new Intl.NumberFormat('en-US');

export function CustomerStockSummary({ balance, productName, requestedQuantity }: {
  balance: CustomerStockBalance;
  productName?: string;
  requestedQuantity?: number;
}) {
  const shared = (balance.shared_product_count ?? 1) > 1;
  const title = shared ? 'Shared bag inventory (Ground + Whole Bean)' : `${productName ? `${productName} · ` : ''}Your purchased bags`;
  return (
    <div className="customer-stock-summary mt-3 rounded-xl border border-teal-100 bg-teal-50 p-3 text-sm" aria-label={shared ? 'Shared bag inventory' : `${productName || 'Your bags'} inventory`}>
      <p className="font-semibold text-teal-950">{title}</p>
      {shared ? <p className="mt-1 text-xs text-teal-800">Both options use this same bag balance.</p> : null}
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2" aria-live="polite">
        <div><dt className="text-teal-800">Available to order</dt><dd className="font-semibold tabular-nums text-teal-950">{quantityFormat.format(balance.available_quantity)}</dd></div>
        <div><dt className="text-teal-800">Awaiting shipment</dt><dd className="font-semibold tabular-nums text-teal-950">{quantityFormat.format(balance.reserved_quantity)}</dd></div>
        <div><dt className="text-teal-800">Held at Sobrew</dt><dd className="font-semibold tabular-nums text-teal-950">{quantityFormat.format(balance.on_hand_quantity)}</dd></div>
      </dl>
      {requestedQuantity !== undefined ? <p className="mt-2 font-medium text-teal-950">In this order: {quantityFormat.format(requestedQuantity)} bags{shared ? ' combined' : ''}</p> : null}
      <p className="mt-2 text-xs text-teal-800">Held at Sobrew includes bags awaiting shipment. Placing an order reserves bags; items in your cart are not reserved.</p>
    </div>
  );
}
