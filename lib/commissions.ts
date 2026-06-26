import { supabaseAdmin } from '@/lib/supabase/admin';

export type CommissionSnapshotRow = {
  center_id: string | null;
  commission_cents: number | string | null;
  commission_month: string;
  commission_percent: number | string | null;
  cogs_estimated?: boolean | null;
  donation_cogs_cents?: number | string | null;
  gross_profit_cents: number | string | null;
  id: string;
  order_id: string;
  processing_fee_cogs_cents?: number | string | null;
  product_cogs_cents: number | string | null;
  revenue_cents: number | string | null;
  sales_profile_id: string | null;
  shipped_at: string | null;
  shipping_cogs_cents: number | string | null;
  total_cogs_cents: number | string | null;
};

export type CommissionSummary = {
  commissionCents: number;
  donationCogsCents: number;
  grossProfitCents: number;
  orderCount: number;
  processingFeeCogsCents: number;
  productCogsCents: number;
  revenueCents: number;
  shippingCogsCents: number;
  totalCogsCents: number;
};

type SupabaseLike = {
  from: (table: string) => any;
};

const CENTRAL_TIME_ZONE = 'America/Chicago';

export function numericCents(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function numericPercent(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function commissionMonthForDate(value: string | Date = new Date()) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    timeZone: CENTRAL_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(safeDate);
  const year = parts.find((part) => part.type === 'year')?.value ?? String(safeDate.getUTCFullYear());
  const month = parts.find((part) => part.type === 'month')?.value ?? String(safeDate.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

export function normalizeCommissionMonth(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && /^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (raw && /^\d{4}-\d{2}-01$/.test(raw)) return raw;
  return commissionMonthForDate();
}

export function monthInputValue(commissionMonth: string) {
  return commissionMonth.slice(0, 7);
}

export function addCommissionMonths(commissionMonth: string, delta: number) {
  const [yearPart, monthPart] = commissionMonth.split('-');
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  const date = new Date(Date.UTC(year, monthIndex + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function commissionMonthLabel(commissionMonth: string) {
  const [yearPart, monthPart] = commissionMonth.split('-');
  const date = new Date(Date.UTC(Number(yearPart), Number(monthPart) - 1, 1));
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function summarizeCommissionRows(rows: CommissionSnapshotRow[]): CommissionSummary {
  return rows.reduce<CommissionSummary>(
    (summary, row) => {
      summary.orderCount += 1;
      summary.revenueCents += numericCents(row.revenue_cents);
      summary.productCogsCents += numericCents(row.product_cogs_cents);
      summary.shippingCogsCents += numericCents(row.shipping_cogs_cents);
      summary.processingFeeCogsCents += numericCents(row.processing_fee_cogs_cents);
      summary.donationCogsCents += numericCents(row.donation_cogs_cents);
      summary.totalCogsCents += numericCents(row.total_cogs_cents);
      summary.grossProfitCents += numericCents(row.gross_profit_cents);
      summary.commissionCents += numericCents(row.commission_cents);
      return summary;
    },
    {
      commissionCents: 0,
      donationCogsCents: 0,
      grossProfitCents: 0,
      orderCount: 0,
      processingFeeCogsCents: 0,
      productCogsCents: 0,
      revenueCents: 0,
      shippingCogsCents: 0,
      totalCogsCents: 0,
    }
  );
}

export function emptyCommissionSummary(): CommissionSummary {
  return {
    commissionCents: 0,
    donationCogsCents: 0,
    grossProfitCents: 0,
    orderCount: 0,
    processingFeeCogsCents: 0,
    productCogsCents: 0,
    revenueCents: 0,
    shippingCogsCents: 0,
    totalCogsCents: 0,
  };
}

export async function snapshotOrderCommissionForShipment({
  orderId,
  refreshExisting = false,
  shippedAt,
  shippingCostCents,
  supabase = supabaseAdmin,
}: {
  orderId: string;
  refreshExisting?: boolean;
  shippedAt: string;
  shippingCostCents?: number;
  supabase?: SupabaseLike;
}) {
  const existing = await supabase
    .from('order_commission_snapshots')
    .select('id,sales_profile_id')
    .eq('order_id', orderId)
    .maybeSingle();

  if (existing.error) return { error: existing.error };
  if (existing.data?.id && !refreshExisting) return { skipped: true };

  const orderResult = await supabase
    .from('orders')
    .select('id,center_id,subtotal_cents,shipping_cost_cents,processing_fee_cents,donation_cogs_cents')
    .eq('id', orderId)
    .maybeSingle();

  if (orderResult.error) return { error: orderResult.error };
  const order = orderResult.data;
  if (!order?.center_id) return { skipped: true };

  const assignmentResult = await supabase
    .from('center_sales_assignments')
    .select('sales_profile_id')
    .eq('center_id', order.center_id)
    .maybeSingle();

  if (assignmentResult.error) return { error: assignmentResult.error };
  const salesProfileId = assignmentResult.data?.sales_profile_id;
  if (!salesProfileId) return { skipped: true };
  if (existing.data?.sales_profile_id && existing.data.sales_profile_id !== salesProfileId) {
    return { skipped: true };
  }

  const [{ data: settings, error: settingsError }, { data: items, error: itemsError }] = await Promise.all([
    supabase
      .from('admin_commission_settings')
      .select('commission_percent')
      .eq('profile_id', salesProfileId)
      .maybeSingle(),
    supabase
      .from('order_items')
      .select('line_total_cents,qty,cogs_snapshot_at,cogs_product_cents,cogs_shipping_cents,cogs_processing_fee_cents,cogs_donation_cents,cogs_total_cents,cogs_source,cogs_estimated')
      .eq('order_id', orderId),
  ]);

  if (settingsError) return { error: settingsError };
  if (itemsError) return { error: itemsError };

  const itemRevenueCents = (items ?? []).reduce((sum: number, item: any) => sum + numericCents(item.line_total_cents), 0);
  const revenueCents = numericCents(order.subtotal_cents) || itemRevenueCents;
  const productCogsCents = (items ?? []).reduce((sum: number, item: any) => {
    const productCogs = numericCents(item.cogs_product_cents);
    if (productCogs > 0) return sum + productCogs;
    return sum + Math.max(
      0,
      numericCents(item.cogs_total_cents)
        - numericCents(item.cogs_shipping_cents)
        - numericCents(item.cogs_processing_fee_cents)
        - numericCents(item.cogs_donation_cents)
    );
  }, 0);
  const shippingCogsFromItems = (items ?? []).reduce((sum: number, item: any) => sum + numericCents(item.cogs_shipping_cents), 0);
  const shippingCogsCents = shippingCogsFromItems || numericCents(shippingCostCents ?? order.shipping_cost_cents);
  const processingFeeCogsFromItems = (items ?? []).reduce((sum: number, item: any) => sum + numericCents(item.cogs_processing_fee_cents), 0);
  const processingFeeCogsCents = processingFeeCogsFromItems || numericCents((order as any).processing_fee_cents);
  const donationCogsFromItems = (items ?? []).reduce((sum: number, item: any) => sum + numericCents(item.cogs_donation_cents), 0);
  const donationCogsCents = donationCogsFromItems || numericCents((order as any).donation_cogs_cents);
  const totalCogsCents = productCogsCents + shippingCogsCents + processingFeeCogsCents + donationCogsCents;
  const productCogsMissing = (items ?? []).some((item: any) => {
    const hasLineRevenue = numericCents(item.line_total_cents) > 0 || numericCents(item.qty) > 0;
    if (!hasLineRevenue) return false;
    const missingSnapshot = !item.cogs_snapshot_at && numericCents(item.cogs_product_cents) <= 0 && numericCents(item.cogs_total_cents) <= 0;
    const missingProductCost = item.cogs_source === 'missing_cost' && numericCents(item.cogs_product_cents) <= 0;
    return missingSnapshot || missingProductCost;
  });
  const grossProfitCents = productCogsMissing ? 0 : revenueCents - totalCogsCents;
  const commissionPercent = numericPercent(settings?.commission_percent);
  const commissionCents = productCogsMissing ? 0 : Math.max(0, grossProfitCents) * (commissionPercent / 100);
  const cogsEstimated = productCogsMissing || (items ?? []).some((item: any) => Boolean(item.cogs_estimated));

  const payload = {
    center_id: order.center_id,
    cogs_estimated: cogsEstimated,
    commission_cents: commissionCents,
    commission_month: commissionMonthForDate(shippedAt),
    commission_percent: commissionPercent,
    gross_profit_cents: grossProfitCents,
    order_id: orderId,
    processing_fee_cogs_cents: processingFeeCogsCents,
    product_cogs_cents: productCogsCents,
    revenue_cents: revenueCents,
    sales_profile_id: salesProfileId,
    shipped_at: shippedAt,
    shipping_cogs_cents: shippingCogsCents,
    donation_cogs_cents: donationCogsCents,
    total_cogs_cents: totalCogsCents,
  };

  const writeResult = existing.data?.id
    ? await supabase.from('order_commission_snapshots').update(payload).eq('id', existing.data.id).select('id').single()
    : await supabase.from('order_commission_snapshots').insert(payload).select('id').single();

  return { data: writeResult.data, error: writeResult.error, updated: Boolean(existing.data?.id) };
}

export async function snapshotMissingCommissionOrdersForSalesProfileMonth({
  centerIds,
  commissionMonth,
  salesProfileId,
  supabase = supabaseAdmin,
}: {
  centerIds?: string[];
  commissionMonth: string;
  salesProfileId: string;
  supabase?: SupabaseLike;
}) {
  const payoutResult = await supabase
    .from('monthly_commission_payouts')
    .select('id,status')
    .eq('sales_profile_id', salesProfileId)
    .eq('commission_month', commissionMonth)
    .maybeSingle();

  if (payoutResult.error) return { created: 0, error: payoutResult.error, skipped: 0 };
  if (payoutResult.data?.id) return { created: 0, locked: true, skipped: 0 };

  let scopedCenterIds = [...new Set((centerIds ?? []).filter(Boolean))];
  if (!scopedCenterIds.length) {
    const assignmentsResult = await supabase
      .from('center_sales_assignments')
      .select('center_id')
      .eq('sales_profile_id', salesProfileId);

    if (assignmentsResult.error) return { created: 0, error: assignmentsResult.error, skipped: 0 };
    scopedCenterIds = [...new Set((assignmentsResult.data ?? []).map((row: { center_id: string | null }) => row.center_id).filter(Boolean))] as string[];
  } else {
    const assignmentsResult = await supabase
      .from('center_sales_assignments')
      .select('center_id')
      .eq('sales_profile_id', salesProfileId)
      .in('center_id', scopedCenterIds);

    if (assignmentsResult.error) return { created: 0, error: assignmentsResult.error, skipped: 0 };
    scopedCenterIds = [...new Set((assignmentsResult.data ?? []).map((row: { center_id: string | null }) => row.center_id).filter(Boolean))] as string[];
  }

  if (!scopedCenterIds.length) return { created: 0, skipped: 0 };

  const ordersResult = await supabase
    .from('orders')
    .select('id,center_id,created_at,shipped_at,shipping_cost_cents')
    .eq('status', 'Shipped')
    .in('center_id', scopedCenterIds)
    .limit(50000);

  if (ordersResult.error) return { created: 0, error: ordersResult.error, skipped: 0 };

  const orders = ((ordersResult.data ?? []) as Array<{
    created_at: string | null;
    id: string;
    shipped_at: string | null;
    shipping_cost_cents: number | string | null;
  }>).filter((order) => {
    const creditedAt = order.shipped_at ?? order.created_at;
    return Boolean(creditedAt) && commissionMonthForDate(creditedAt as string) === commissionMonth;
  });

  if (!orders.length) return { created: 0, skipped: 0 };

  const orderIds = orders.map((order) => order.id);
  const existingResult = await supabase
    .from('order_commission_snapshots')
    .select('order_id')
    .in('order_id', orderIds);

  if (existingResult.error) return { created: 0, error: existingResult.error, skipped: 0 };

  const existingOrderIds = new Set((existingResult.data ?? []).map((row: { order_id: string | null }) => row.order_id).filter(Boolean));
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const order of orders) {
    const creditedAt = order.shipped_at ?? order.created_at;
    if (!creditedAt) continue;
    const result = await snapshotOrderCommissionForShipment({
      orderId: order.id,
      refreshExisting: existingOrderIds.has(order.id),
      shippedAt: creditedAt,
      shippingCostCents: numericCents(order.shipping_cost_cents),
      supabase,
    });

    if (result.error) return { created, error: result.error, skipped };
    if (result.updated) {
      updated += 1;
    } else if (result.data) {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  return { created, skipped, updated };
}
