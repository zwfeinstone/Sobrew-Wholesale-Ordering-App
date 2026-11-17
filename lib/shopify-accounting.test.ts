import { describe, expect, it, vi } from 'vitest';
import { buildShopifyAccountingRows, loadShopifyAccountingRows, shopifyAccountingCsv, shopifyAccountingPeriod, type ShopifyAccountingOrder } from './shopify-accounting';

const order: ShopifyAccountingOrder = {
  id: 'order-1', shopify_order_name: '#1001', created_at: '2026-11-17T12:00:00Z', status: 'Shipped',
  subtotal_cents: 8000, shopify_shipping_collected_cents: 700, shopify_tax_collected_cents: 700, shopify_total_paid_cents: 9400,
  shipping_cost_cents: 500, processing_fee_cents: 311, donation_cogs_cents: 500,
};
const items = [{ order_id: 'order-1', cogs_product_cents: 2500, cogs_snapshot_at: '2026-11-17T14:00:00Z', cogs_source: 'actual_fifo', cogs_estimated: false }];

describe('Shopify accounting reconciliation', () => {
  it('separates paid shipping revenue and tax liability from actual fulfillment costs', () => {
    const [row] = buildShopifyAccountingRows([order], [...items, { order_id: null, cogs_product_cents: 9999, cogs_snapshot_at: '2026-11-17T14:00:00Z' }]);
    expect(row).toMatchObject({ merchandiseCents: 8000, shippingRevenueCents: 700, revenueCents: 8700, salesTaxCents: 700, totalPaidCents: 9400, checkoutReconciles: true, shippingCostCents: 500, totalCogsCents: 3811, grossProfitCents: 4889 });
  });

  it('keeps known free shipping and zero tax distinct from missing legacy fields', () => {
    const [free, legacy] = buildShopifyAccountingRows([
      { ...order, shopify_shipping_collected_cents: 0, shopify_tax_collected_cents: 0, shopify_total_paid_cents: 8000 },
      { ...order, shopify_shipping_collected_cents: null, shopify_tax_collected_cents: null, shopify_total_paid_cents: null },
    ], items);
    expect(free).toMatchObject({ revenueCents: 8000, salesTaxCents: 0, checkoutReconciles: true });
    expect(legacy).toMatchObject({ shippingRevenueCents: null, salesTaxCents: null, totalPaidCents: null, revenueCents: null, grossProfitCents: null, checkoutReconciles: false });
  });

  it('does not rewrite a historical fee snapshot when a full payment becomes known', () => {
    const [row] = buildShopifyAccountingRows([{ ...order, processing_fee_cents: 269 }], items);
    expect(row).toMatchObject({ processingCogsCents: 269, processingEstimateCents: 311, totalCogsCents: 3769 });
    expect(order.processing_fee_cents).toBe(311);
  });

  it('preserves fractional cost cents while summing and rounds only at export', () => {
    const [row] = buildShopifyAccountingRows([{ ...order, shipping_cost_cents: '500.1250', processing_fee_cents: '311.1250', donation_cogs_cents: '500.1250' }], [
      { ...items[0], cogs_product_cents: '1250.4000' },
      { ...items[0], cogs_product_cents: 1250.4 },
    ]);
    expect(row.productCogsCents).toBeCloseTo(2500.8, 4);
    expect(row.totalCogsCents).toBeCloseTo(3812.175, 4);
    expect(row.grossProfitCents).toBeCloseTo(4887.825, 4);
    expect(shopifyAccountingCsv([row])).toContain('25.01,5.00,3.11,3.11,5.00,38.12,48.88');
    expect(buildShopifyAccountingRows([{ ...order, shopify_shipping_collected_cents: 700.1 }], items)[0].shippingRevenueCents).toBeNull();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, ' '])('rejects invalid cost snapshots: %s', (value) => {
    const [row] = buildShopifyAccountingRows([{ ...order, shipping_cost_cents: value }], [{ ...items[0], cogs_product_cents: value }]);
    expect(row).toMatchObject({ productCogsCents: null, shippingCostCents: null, totalCogsCents: null, grossProfitCents: null });
  });

  it('leaves missing_cost snapshots unknown even when timestamped with zero cost', () => {
    const [row] = buildShopifyAccountingRows([order], [items[0], { ...items[0], cogs_product_cents: 0, cogs_source: 'missing_cost', cogs_estimated: true }]);
    expect(row).toMatchObject({ productCogsCents: null, productCogsBasis: 'Missing / pending', totalCogsCents: null, grossProfitCents: null });
    expect(shopifyAccountingCsv([row])).toContain(',,"Missing / pending"');
  });

  it.each(['estimated_recipe', 'latest_production', 'partial_estimate'])('labels %s product costs as estimates', (source) => {
    const [row] = buildShopifyAccountingRows([order], [{ ...items[0], cogs_source: source }]);
    expect(row).toMatchObject({ productCogsBasis: 'Estimated', productCogsCents: 2500 });
    expect(shopifyAccountingCsv([row])).toContain('"Estimated"');
  });

  it('distinguishes verified FIFO, flagged estimates and legacy unknown cost sources', () => {
    expect(buildShopifyAccountingRows([order], items)[0].productCogsBasis).toBe('Actual FIFO');
    expect(buildShopifyAccountingRows([order], [{ ...items[0], cogs_estimated: true }])[0].productCogsBasis).toBe('Estimated');
    expect(buildShopifyAccountingRows([order], [{ ...items[0], cogs_source: null }])[0].productCogsBasis).toBe('Unknown source');
  });

  it('does not fabricate profit for pending costs, incomplete snapshots, or unmatched payments', () => {
    expect(buildShopifyAccountingRows([{ ...order, status: 'New' }], items)[0]).toMatchObject({ shippingCostCents: null, productCogsCents: null, totalCogsCents: null, grossProfitCents: null });
    expect(buildShopifyAccountingRows([order], [...items, { order_id: 'order-1', cogs_product_cents: null, cogs_snapshot_at: null }])[0].grossProfitCents).toBeNull();
    expect(buildShopifyAccountingRows([{ ...order, shopify_total_paid_cents: 9401 }], items)[0]).toMatchObject({ checkoutReconciles: false, grossProfitCents: null });
  });

  it('exports each category separately, blanks unknowns, and neutralizes spreadsheet formulas', () => {
    const csv = shopifyAccountingCsv(buildShopifyAccountingRows([{ ...order, shopify_order_name: '=HYPERLINK("example")', shopify_tax_collected_cents: null }], items));
    expect(csv).toContain('Sales tax collected - liability');
    expect(csv).toContain('"\'=HYPERLINK(""example"")"');
    expect(csv).toContain('80.00,7.00,87.00,,94.00');
    expect(csv).toContain('25.00,5.00,3.11,3.11,5.00,38.11,');
    expect(csv).toContain('Original gross customer payment - before refunds');
    expect(csv).toContain('Gross profit including shipping revenue - before refunds');
    expect(csv).toContain('Refunds, returns, chargebacks and tax remittances excluded; reconcile separately');
  });
});

describe('Shopify reconciliation period and loading', () => {
  it('uses Central calendar boundaries across daylight saving time', () => {
    expect(shopifyAccountingPeriod('2026-11-01', '2026-11-01')).toMatchObject({ startAt: '2026-11-01T05:00:00.000Z', endExclusive: '2026-11-02T06:00:00.000Z' });
    expect(() => shopifyAccountingPeriod('2026-02-30', '2026-03-01')).toThrow('calendar');
    expect(() => shopifyAccountingPeriod('2026-11-02', '2026-11-01')).toThrow('End date');
  });

  it('fails closed instead of exporting a partial dataset', async () => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const name of ['select', 'eq', 'gte', 'lt', 'in', 'order']) query[name] = vi.fn(() => query);
    query.range = vi.fn().mockResolvedValueOnce({ data: [order], error: null }).mockResolvedValueOnce({ data: null, error: { message: 'page unavailable' } });
    const client = { from: vi.fn(() => query) };
    const result = await loadShopifyAccountingRows(client as never, shopifyAccountingPeriod('2026-11-01', '2026-11-30'), ['center-1']);
    expect(result).toEqual({ data: [], error: { message: 'page unavailable' } });
    expect(query.in).toHaveBeenCalledWith('center_id', ['center-1']);
    expect(query.eq).toHaveBeenCalledWith('order_source', 'shopify');
    expect(query.range).toHaveBeenLastCalledWith(1, 1000);
  });

  it('does not load orders outside an empty admin center scope', async () => {
    const client = { from: vi.fn() };
    expect(await loadShopifyAccountingRows(client as never, shopifyAccountingPeriod(), [])).toEqual({ data: [], error: null });
    expect(client.from).not.toHaveBeenCalled();
  });
});
