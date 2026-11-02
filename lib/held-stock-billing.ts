export type HeldStockSaleBilling = {
  invoice_only: boolean;
  tax_exempt: boolean;
};

type ReleaseLine = {
  product_id?: string | null;
  qty: unknown;
  unit_price_cents: unknown;
  line_total_cents: unknown;
};

export type HeldStockReleaseOrder = {
  id: string;
  center_id?: string | null;
  subtotal_cents?: unknown;
  order_items?: ReleaseLine[] | null;
};

type StockAllocation = {
  center_id: string;
  product_id: string;
  initial_order_id: string;
};

function numericValue(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return Number.NaN;
  return Number(value);
}

export function isZeroPriceReleaseCandidate(order: HeldStockReleaseOrder): boolean {
  return Boolean(order.center_id)
    && numericValue(order.subtotal_cents) === 0
    && Boolean(order.order_items?.length)
    && order.order_items!.every((line) => Boolean(line.product_id)
      && Number.isFinite(numericValue(line.qty)) && numericValue(line.qty) > 0
      && numericValue(line.unit_price_cents) === 0
      && numericValue(line.line_total_cents) === 0);
}

/** Only an entirely free release of this customer's allocated stock avoids billing. */
export function isZeroPriceHeldStockRelease(order: HeldStockReleaseOrder, allocations: StockAllocation[]): boolean {
  if (!isZeroPriceReleaseCandidate(order)) return false;
  return order.order_items!.every((line) => allocations.some((allocation) =>
    allocation.center_id === order.center_id
    && allocation.product_id === line.product_id
    && allocation.initial_order_id !== order.id));
}

export async function isHeldStockReleaseForBilling(
  supabase: { from: (table: 'customer_stock_product_allocations') => any },
  order: HeldStockReleaseOrder,
): Promise<boolean> {
  if (!isZeroPriceReleaseCandidate(order)) return false;
  const productIds = [...new Set(order.order_items!.map((line) => line.product_id!))];
  const { data, error } = await supabase.from('customer_stock_product_allocations')
    .select('center_id,product_id,initial_order_id')
    .eq('center_id', order.center_id)
    .in('product_id', productIds);
  if (error) throw new Error(`Unable to verify customer stock release: ${error.message}`);
  return isZeroPriceHeldStockRelease(order, data ?? []);
}
