import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadCustomerStockBalances } from '@/lib/customer-stock';

describe('customer stock portal data', () => {
  it('loads the requested center and exposes only quantity information', async () => {
    const balance = {
      allocation_id: 'allocation-1', product_id: 'custom-bags', initial_quantity: 1000,
      available_quantity: 900, reserved_quantity: 100, on_hand_quantity: 1000, shared_product_count: 2,
    };
    const rpc = vi.fn().mockResolvedValue({ data: [{ ...balance, internal_cost_cents: 350000 }], error: null });
    const result = await loadCustomerStockBalances({ rpc } as unknown as SupabaseClient, 'momentum');
    expect(rpc).toHaveBeenCalledWith('get_customer_stock_balances', { p_center_id: 'momentum' });
    expect(result).toEqual([balance]);
  });

  it('defaults older single-product balances to one product', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ allocation_id: 'batch', product_id: 'bags', initial_quantity: 1000, available_quantity: 1000, reserved_quantity: 0, on_hand_quantity: 1000 }], error: null });
    const result = await loadCustomerStockBalances({ rpc } as unknown as SupabaseClient, 'momentum');
    expect(result[0].shared_product_count).toBe(1);
  });

  it('fails closed when current quantities cannot be verified', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'database unavailable', code: '08006' } });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(loadCustomerStockBalances({ rpc } as unknown as SupabaseClient, 'momentum')).rejects.toThrow('Unable to confirm your stored bag inventory');
    } finally {
      errorLog.mockRestore();
    }
  });
});
