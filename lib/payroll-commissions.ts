import {
  commissionMonthForDate,
  numericCents,
  summarizeCommissionRows,
  type CommissionSnapshotRow,
  type CommissionSummary,
} from '@/lib/commissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllPages, type QueryError } from '@/lib/supabase/pagination';
import { getCommissionInvoiceEligibility } from '@/lib/commission-invoice-eligibility';
import { commissionRequiresPaidInvoice, PAID_INVOICE_COMMISSION_START } from '@/lib/commission-payment-policy';

type SupabaseLike = { from: (table: string) => any };
type StoredCents = number | string | null;

export type PayrollCommissionPayout = {
  id: string;
  sales_profile_id: string | null;
  commission_month: string;
  commission_cents: StoredCents;
  donation_cogs_cents: StoredCents;
  gross_profit_cents: StoredCents;
  order_count: number | null;
  processing_fee_cogs_cents: StoredCents;
  product_cogs_cents: StoredCents;
  revenue_cents: StoredCents;
  shipping_cogs_cents: StoredCents;
  total_cogs_cents: StoredCents;
  status: string;
  locked_at: string | null;
  locked_by: string | null;
  paid_at: string | null;
  paid_by: string | null;
  /** Null on historical payments recorded before individual paid orders were tracked. */
  paid_order_ids: string[] | null;
  notes: string | null;
  created_at?: string;
  updated_at: string;
};

export type PayrollCommissionRow = {
  salesProfileId: string | null;
  summary: CommissionSummary;
  payout: PayrollCommissionPayout | null;
  amountOwedCents: number;
  cogsEstimated: boolean;
  eligibleOrderIds: string[];
  paidOrderIds: string[] | null;
  pendingInvoiceOrderIds: string[];
  pendingInvoiceCount: number;
  pendingInvoiceCents: number;
};

export type PayrollCommissionPaymentResult = {
  error?: QueryError;
  alreadyPaid?: boolean;
  payout?: PayrollCommissionPayout;
  before?: PayrollCommissionPayout | null;
  paymentAmountCents?: number;
};

const SNAPSHOT_COLUMNS = 'id,order_id,center_id,sales_profile_id,shipped_at,commission_month,revenue_cents,product_cogs_cents,shipping_cogs_cents,processing_fee_cogs_cents,donation_cogs_cents,total_cogs_cents,gross_profit_cents,commission_percent,commission_cents,cogs_estimated';

export function validCommissionMonth(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(value) && Number(value.slice(0, 4)) > 0;
}

export const isPayrollCommissionMonth = validCommissionMonth;

function isPaid(payout: PayrollCommissionPayout) {
  // Older Sales Admin actions could leave a paid timestamp on a locked row.
  return payout.status === 'paid' || Boolean(payout.paid_at);
}

export function isLegacyPaidCommissionPayout(payout: PayrollCommissionPayout | null) {
  return Boolean(payout && isPaid(payout) && payout.paid_order_ids == null);
}

/** Historical orders and previously settled commissions never need an invoice lookup. */
export function requiresInvoiceEligibility(
  snapshot: Pick<CommissionSnapshotRow, 'order_id' | 'shipped_at'>,
  payout: PayrollCommissionPayout | null,
) {
  return commissionRequiresPaidInvoice(snapshot)
    && !isLegacyPaidCommissionPayout(payout)
    && !(payout && isPaid(payout) && payout.paid_order_ids?.includes(snapshot.order_id));
}

function isHistoricalLockedPayout(payout: PayrollCommissionPayout | null) {
  if (!payout || isPaid(payout) || payout.status !== 'locked') return false;
  const lockedAt = Date.parse(payout.locked_at ?? payout.created_at ?? payout.updated_at);
  return payout.commission_month < commissionMonthForDate(PAID_INVOICE_COMMISSION_START)
    || (Number.isFinite(lockedAt) && lockedAt < Date.parse(PAID_INVOICE_COMMISSION_START));
}

function summaryFromPayout(payout: PayrollCommissionPayout): CommissionSummary {
  return {
    commissionCents: numericCents(payout.commission_cents),
    donationCogsCents: numericCents(payout.donation_cogs_cents),
    grossProfitCents: numericCents(payout.gross_profit_cents),
    orderCount: numericCents(payout.order_count),
    processingFeeCogsCents: numericCents(payout.processing_fee_cogs_cents),
    productCogsCents: numericCents(payout.product_cogs_cents),
    revenueCents: numericCents(payout.revenue_cents),
    shippingCogsCents: numericCents(payout.shipping_cogs_cents),
    totalCogsCents: numericCents(payout.total_cogs_cents),
  };
}

/** Preserve recorded payments while releasing only newly settled invoice commissions. */
export function buildPayrollCommissionRow({
  salesProfileId,
  snapshots,
  payout,
  paidInvoiceOrderIds,
}: {
  salesProfileId: string | null;
  snapshots: CommissionSnapshotRow[];
  payout: PayrollCommissionPayout | null;
  paidInvoiceOrderIds: ReadonlySet<string>;
}): PayrollCommissionRow {
  const legacyPaid = isLegacyPaidCommissionPayout(payout);
  const paidOrderIds = legacyPaid ? null : payout && isPaid(payout) ? payout.paid_order_ids ?? [] : [];
  const alreadyPaid = new Set(paidOrderIds ?? []);
  const remaining = legacyPaid ? [] : snapshots.filter((snapshot) => !alreadyPaid.has(snapshot.order_id));
  const eligible = remaining.filter((snapshot) => !commissionRequiresPaidInvoice(snapshot) || paidInvoiceOrderIds.has(snapshot.order_id));
  const pending = remaining.filter((snapshot) => commissionRequiresPaidInvoice(snapshot) && !paidInvoiceOrderIds.has(snapshot.order_id));
  // A historical lock already contains its pre-policy orders and adjustments.
  // Keep that exact base; only new-policy shipments can increase it.
  const lockedHistory = isHistoricalLockedPayout(payout) ? summaryFromPayout(payout!) : null;
  const summary = summarizeCommissionRows(lockedHistory ? eligible.filter(commissionRequiresPaidInvoice) : eligible);
  const historical = payout && isPaid(payout) ? summaryFromPayout(payout) : null;
  const priorSummary = historical ?? lockedHistory;
  if (priorSummary) {
    for (const key of Object.keys(summary) as (keyof CommissionSummary)[]) summary[key] += priorSummary[key];
  }
  return {
    salesProfileId,
    summary,
    payout,
    amountOwedCents: Math.max(0, Math.round(summary.commissionCents) - Math.round(historical?.commissionCents ?? 0)),
    cogsEstimated: snapshots.some((snapshot) => Boolean(snapshot.cogs_estimated)),
    eligibleOrderIds: eligible.map((snapshot) => snapshot.order_id),
    paidOrderIds,
    pendingInvoiceOrderIds: pending.map((snapshot) => snapshot.order_id),
    pendingInvoiceCount: pending.length,
    pendingInvoiceCents: Math.max(0, Math.round(summarizeCommissionRows(pending).commissionCents)),
  };
}

function loadSnapshots(supabase: SupabaseLike, commissionMonth: string, salesProfileId?: string) {
  return fetchAllPages<CommissionSnapshotRow>((from, to) => {
    let query = supabase.from('order_commission_snapshots').select(SNAPSHOT_COLUMNS).eq('commission_month', commissionMonth);
    if (salesProfileId) query = query.eq('sales_profile_id', salesProfileId);
    return query.order('id', { ascending: true }).range(from, to);
  });
}

/** Read existing earned commission snapshots without refreshing historical rates. */
export async function loadPayrollCommissions({
  commissionMonth,
  supabase = supabaseAdmin,
}: {
  commissionMonth: string;
  supabase?: SupabaseLike;
}): Promise<{ rows: PayrollCommissionRow[]; error: QueryError | null }> {
  if (!validCommissionMonth(commissionMonth)) return { rows: [], error: { message: 'Invalid commission month.' } };
  try {
    const [snapshots, payouts] = await Promise.all([
      loadSnapshots(supabase, commissionMonth),
      fetchAllPages<PayrollCommissionPayout>((from, to) => supabase.from('monthly_commission_payouts')
        .select('*').eq('commission_month', commissionMonth).order('id', { ascending: true }).range(from, to)),
    ]);
    const error = snapshots.error ?? payouts.error;
    if (error) return { rows: [], error };

    const snapshotsByProfile = new Map<string | null, CommissionSnapshotRow[]>();
    for (const snapshot of snapshots.data) {
      const profileRows = snapshotsByProfile.get(snapshot.sales_profile_id) ?? [];
      profileRows.push(snapshot);
      snapshotsByProfile.set(snapshot.sales_profile_id, profileRows);
    }
    const payoutsByProfile = new Map<string | null, PayrollCommissionPayout>();
    for (const payout of payouts.data) {
      if (payoutsByProfile.has(payout.sales_profile_id)) {
        return { rows: [], error: { message: 'Multiple commission payouts exist for the same employee and month.' } };
      }
      payoutsByProfile.set(payout.sales_profile_id, payout);
    }
    const profileIds = new Set([...snapshotsByProfile.keys(), ...payoutsByProfile.keys()]);
    const remainingOrderIds = snapshots.data.filter((snapshot) => {
      const payout = payoutsByProfile.get(snapshot.sales_profile_id) ?? null;
      return requiresInvoiceEligibility(snapshot, payout);
    }).map((snapshot) => snapshot.order_id);
    const eligibility = remainingOrderIds.length ? await getCommissionInvoiceEligibility(remainingOrderIds, supabase) : { paidOrderIds: new Set<string>(), error: null };
    if (eligibility.error) return { rows: [], error: { message: eligibility.error } };
    const rows = [...profileIds].map((salesProfileId): PayrollCommissionRow => {
      const profileSnapshots = snapshotsByProfile.get(salesProfileId) ?? [];
      const payout = payoutsByProfile.get(salesProfileId) ?? null;
      return buildPayrollCommissionRow({
        salesProfileId,
        snapshots: profileSnapshots,
        payout,
        paidInvoiceOrderIds: eligibility.paidOrderIds,
      });
    }).sort((left, right) => (left.salesProfileId ?? '').localeCompare(right.salesProfileId ?? ''));
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: { message: error instanceof Error ? error.message : 'Commission invoice payment status could not be verified.' } };
  }
}

function paymentError(message: string, code?: string): PayrollCommissionPaymentResult {
  return { error: { message, ...(code ? { code } : {}) } };
}

/**
 * Record payment of a completed earned month. The caller enforces payroll/sales
 * permissions and writes its audit record. This service never transfers funds.
 */
export async function recordPayrollCommissionPaid({
  commissionMonth,
  salesProfileId,
  actorProfileId,
  expectedPaymentCents,
  now = new Date(),
  supabase = supabaseAdmin,
}: {
  commissionMonth: string;
  salesProfileId: string | null;
  actorProfileId: string;
  expectedPaymentCents?: number;
  now?: Date;
  supabase?: SupabaseLike;
}): Promise<PayrollCommissionPaymentResult> {
  if (!validCommissionMonth(commissionMonth) || !Number.isFinite(now.getTime())) return paymentError('Invalid commission month.');
  if (!salesProfileId?.trim() || !actorProfileId.trim()) return paymentError('A known employee and payment actor are required.');
  if (expectedPaymentCents !== undefined && (!Number.isSafeInteger(expectedPaymentCents) || expectedPaymentCents < 0)) {
    return paymentError('The expected commission payment amount is invalid.');
  }
  if (commissionMonth >= commissionMonthForDate(now)) return paymentError('Commissions are payable on the first day of the following month.');

  const readPayout = () => supabase.from('monthly_commission_payouts').select('*')
    .eq('sales_profile_id', salesProfileId).eq('commission_month', commissionMonth).maybeSingle();
  const resolveConflict = async (orderIds: string[]): Promise<PayrollCommissionPaymentResult> => {
    const latest = await readPayout();
    if (latest.error) return { error: latest.error };
    const payout = latest.data as PayrollCommissionPayout | null;
    if (payout && isPaid(payout) && (isLegacyPaidCommissionPayout(payout) || orderIds.every((id) => payout.paid_order_ids?.includes(id)))) {
      return { alreadyPaid: true, payout, before: payout };
    }
    return paymentError('The commission payout changed. Refresh payroll before recording payment.', 'conflict');
  };

  try {
    const existing = await readPayout();
    if (existing.error) return { error: existing.error };
    const before = existing.data as PayrollCommissionPayout | null;
    if (before && isLegacyPaidCommissionPayout(before)) return { alreadyPaid: true, payout: before, before };
    if (before && !isPaid(before) && before.status !== 'locked') {
      return paymentError('The existing commission payout must be locked before recording payment.');
    }
    const paidAt = now.toISOString();
    const snapshots = await loadSnapshots(supabase, commissionMonth, salesProfileId);
    if (snapshots.error) return { error: snapshots.error };
    const alreadyPaidOrderIds = new Set(before && isPaid(before) ? before.paid_order_ids ?? [] : []);
    const remainingOrderIds = snapshots.data.filter((snapshot) => requiresInvoiceEligibility(snapshot, before)).map((snapshot) => snapshot.order_id);
    const eligibility = remainingOrderIds.length ? await getCommissionInvoiceEligibility(remainingOrderIds, supabase) : { paidOrderIds: new Set<string>(), error: null };
    if (eligibility.error) return paymentError(eligibility.error);
    const row = buildPayrollCommissionRow({ salesProfileId, snapshots: snapshots.data, payout: before, paidInvoiceOrderIds: eligibility.paidOrderIds });
    if (expectedPaymentCents !== undefined && expectedPaymentCents !== row.amountOwedCents) {
      return paymentError('The payable commission amount changed. Refresh payroll before recording payment.', 'conflict');
    }
    if (row.amountOwedCents <= 0) {
      if (before && isPaid(before)) return { alreadyPaid: true, payout: before, before };
      return paymentError('There is no positive commission amount on paid invoices to pay.');
    }
    const summary = row.summary;
    const paidOrderIds = [...new Set([...alreadyPaidOrderIds, ...row.eligibleOrderIds])];
    // A conditional update must always advance its optimistic concurrency token.
    const previousUpdatedAt = Date.parse(before?.updated_at ?? '');
    const updatedAt = new Date(Number.isFinite(previousUpdatedAt) ? Math.max(now.getTime(), previousUpdatedAt + 1) : now.getTime()).toISOString();
    const payload = {
      commission_month: commissionMonth,
      sales_profile_id: salesProfileId,
      commission_cents: summary.commissionCents,
      donation_cogs_cents: summary.donationCogsCents,
      gross_profit_cents: summary.grossProfitCents,
      order_count: summary.orderCount,
      processing_fee_cogs_cents: summary.processingFeeCogsCents,
      product_cogs_cents: summary.productCogsCents,
      revenue_cents: summary.revenueCents,
      shipping_cogs_cents: summary.shippingCogsCents,
      total_cogs_cents: summary.totalCogsCents,
      locked_at: before?.locked_at ?? paidAt,
      locked_by: before?.locked_by ?? actorProfileId,
      paid_at: paidAt,
      paid_by: actorProfileId,
      paid_order_ids: paidOrderIds,
      status: 'paid',
      updated_at: updatedAt,
    };
    if (before) {
      let query = supabase.from('monthly_commission_payouts')
        .update(payload)
        .eq('id', before.id).eq('sales_profile_id', salesProfileId).eq('commission_month', commissionMonth)
        .eq('status', before.status).eq('updated_at', before.updated_at);
      query = before.paid_at === null ? query.is('paid_at', null) : query.eq('paid_at', before.paid_at);
      const updated = await query.select('*').maybeSingle();
      if (updated.error) return { error: updated.error };
      if (!updated.data) return await resolveConflict(row.eligibleOrderIds);
      return { payout: updated.data as PayrollCommissionPayout, before, paymentAmountCents: row.amountOwedCents };
    }
    const inserted = await supabase.from('monthly_commission_payouts').insert(payload).select('*').single();
    if (inserted.error?.code === '23505') return await resolveConflict(row.eligibleOrderIds);
    if (inserted.error) return { error: inserted.error };
    if (!inserted.data) return paymentError('The commission payment could not be confirmed.');
    return { payout: inserted.data as PayrollCommissionPayout, before: null, paymentAmountCents: row.amountOwedCents };
  } catch (error) {
    return paymentError(error instanceof Error ? error.message : 'The commission payment could not be recorded.');
  }
}
