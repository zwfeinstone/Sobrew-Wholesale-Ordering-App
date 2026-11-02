import type { SupabaseClient } from '@supabase/supabase-js';

/** Quantity-only data that is safe to display in the customer's order guide. */
export type CustomerStockBalance = {
  allocation_id: string;
  product_id: string;
  initial_quantity: number;
  available_quantity: number;
  reserved_quantity: number;
  on_hand_quantity: number;
  shared_product_count?: number;
};

export async function loadCustomerStockBalances(
  supabase: SupabaseClient,
  centerId: string
): Promise<CustomerStockBalance[]> {
  const { data, error } = await supabase.rpc('get_customer_stock_balances', { p_center_id: centerId });
  if (error) {
    console.error('[customer-stock] balance lookup failed', { code: error.code, message: error.message });
    throw new Error('Unable to confirm your stored bag inventory. Please refresh before ordering.');
  }
  // Select fields explicitly so internal costs or other RPC additions never reach portal props.
  return (data ?? []).map((row: CustomerStockBalance) => ({
    allocation_id: row.allocation_id,
    product_id: row.product_id,
    initial_quantity: Number(row.initial_quantity),
    available_quantity: Math.max(0, Number(row.available_quantity)),
    reserved_quantity: Math.max(0, Number(row.reserved_quantity)),
    on_hand_quantity: Math.max(0, Number(row.on_hand_quantity)),
    shared_product_count: Math.max(1, Math.trunc(Number(row.shared_product_count) || 1)),
  }));
}
