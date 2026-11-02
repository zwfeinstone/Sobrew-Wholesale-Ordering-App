import { describe, expect, it, vi } from 'vitest';
import { isHeldStockReleaseForBilling, isZeroPriceHeldStockRelease, type HeldStockReleaseOrder } from './held-stock-billing';

const allocation = { center_id: 'momentum', product_id: 'custom-bags', initial_order_id: 'sale' };
const release: HeldStockReleaseOrder = {
  id: 'release', center_id: 'momentum', subtotal_cents: 0,
  order_items: [{ product_id: 'custom-bags', qty: 100, unit_price_cents: 0, line_total_cents: 0 }],
};

describe('held stock release billing eligibility', () => {
  it('qualifies only free releases of the customer’s allocated products', () => {
    expect(isZeroPriceHeldStockRelease(release, [allocation])).toBe(true);
    expect(isZeroPriceHeldStockRelease({ ...release, id: 'sale' }, [allocation])).toBe(false);
    expect(isZeroPriceHeldStockRelease(release, [{ ...allocation, center_id: 'other-center' }])).toBe(false);
    expect(isZeroPriceHeldStockRelease(release, [])).toBe(false);
  });

  it('recognizes ground and whole-bean variants mapped to the same customer allocation', async () => {
    const variants = [allocation, { ...allocation, product_id: 'custom-bags-whole-bean' }]
      .map(row => ({ ...row, allocation_id: 'shared-batch', inventory_product_id: 'custom-bags' }));
    const mixedRelease = { ...release, order_items: variants.map(row => ({
      ...release.order_items![0], product_id: row.product_id, qty: 50,
    })) };
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: variants, error: null }),
    };
    const from = vi.fn(() => query);
    expect(await isHeldStockReleaseForBilling({ from }, mixedRelease)).toBe(true);
    expect(from).toHaveBeenCalledWith('customer_stock_product_allocations');
    expect(query.eq).toHaveBeenCalledWith('center_id', 'momentum');
    expect(query.in).toHaveBeenCalledWith('product_id', ['custom-bags', 'custom-bags-whole-bean']);
    expect(isZeroPriceHeldStockRelease({ ...mixedRelease, id: 'sale' }, variants)).toBe(false);
    expect(isZeroPriceHeldStockRelease(mixedRelease, [variants[0]])).toBe(false);
  });

  it.each([
    { subtotal_cents: 1 },
    { subtotal_cents: null },
    { center_id: null },
    { order_items: [] },
    { order_items: [{ ...release.order_items![0], qty: 0 }] },
    { order_items: [{ ...release.order_items![0], qty: 'Infinity' }] },
    { order_items: [{ ...release.order_items![0], unit_price_cents: null }] },
    { order_items: [{ ...release.order_items![0], unit_price_cents: 1 }] },
    { order_items: [{ ...release.order_items![0], line_total_cents: 1 }] },
    { order_items: [{ ...release.order_items![0], product_id: null }] },
    { order_items: [...release.order_items!, { ...release.order_items![0], product_id: 'other-product' }] },
  ])('rejects a zero/mixed order that is not a complete customer stock release: %j', (changes) => {
    expect(isZeroPriceHeldStockRelease({ ...release, ...changes }, [allocation])).toBe(false);
  });

  it('fails closed if allocation verification is unavailable', async () => {
    const query = {
      select() { return this; }, eq() { return this; },
      in: async () => ({ data: null, error: { message: 'unavailable' } }),
    };
    await expect(isHeldStockReleaseForBilling({ from: () => query }, release)).rejects.toThrow('Unable to verify customer stock release');
  });
});
