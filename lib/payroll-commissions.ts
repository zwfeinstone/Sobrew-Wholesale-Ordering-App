import {
  commissionMonthForDate,
  numericCents,
  summarizeCommissionRows,
  type CommissionSnapshotRow,
  type CommissionSummary,
} from '@/lib/commissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllPages, type QueryError } from '@/lib/supabase/pagination';

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
};

export type PayrollCommissionPaymentResult = {
  error?: QueryError;
  alreadyPaid?: boolean;
  payout?: PayrollCommissionPayout;
  before?: PayrollCommissionPayout | null;
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
  const rows = [...profileIds].map((salesProfileId): PayrollCommissionRow => {
    const profileSnapshots = snapshotsByProfile.get(salesProfileId) ?? [];
    const payout = payoutsByProfile.get(salesProfileId) ?? null;
    const summary = payout ? summaryFromPayout(payout) : summarizeCommissionRows(profileSnapshots);
    return {
      salesProfileId,
      summary,
      payout,
      amountOwedCents: payout && isPaid(payout) ? 0 : Math.max(0, Math.round(summary.commissionCents)),
      cogsEstimated: profileSnapshots.some((snapshot) => Boolean(snapshot.cogs_estimated)),
    };
  }).sort((left, right) => (left.salesProfileId ?? '').localeCompare(right.salesProfileId ?? ''));
  return { rows, error: null };
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
  now = new Date(),
  supabase = supabaseAdmin,
}: {
  commissionMonth: string;
  salesProfileId: string | null;
  actorProfileId: string;
  now?: Date;
  supabase?: SupabaseLike;
}): Promise<PayrollCommissionPaymentResult> {
  if (!validCommissionMonth(commissionMonth) || !Number.isFinite(now.getTime())) return paymentError('Invalid commission month.');
  if (!salesProfileId?.trim() || !actorProfileId.trim()) return paymentError('A known employee and payment actor are required.');
  if (commissionMonth >= commissionMonthForDate(now)) return paymentError('Commissions are payable on the first day of the following month.');

  const readPayout = () => supabase.from('monthly_commission_payouts').select('*')
    .eq('sales_profile_id', salesProfileId).eq('commission_month', commissionMonth).maybeSingle();
  const resolveConflict = async (): Promise<PayrollCommissionPaymentResult> => {
    const latest = await readPayout();
    if (latest.error) return { error: latest.error };
    const payout = latest.data as PayrollCommissionPayout | null;
    if (payout && isPaid(payout)) return { alreadyPaid: true, payout, before: payout };
    return paymentError('The commission payout changed. Refresh payroll before recording payment.', 'conflict');
  };

  try {
    const existing = await readPayout();
    if (existing.error) return { error: existing.error };
    const before = existing.data as PayrollCommissionPayout | null;
    if (before && isPaid(before)) return { alreadyPaid: true, payout: before, before };
    const paidAt = now.toISOString();

    if (before) {
      if (before.status !== 'locked') return paymentError('The existing commission payout must be locked before recording payment.');
      if (Math.round(numericCents(before.commission_cents)) <= 0) return paymentError('There is no positive commission amount to pay.');
      let query = supabase.from('monthly_commission_payouts')
        .update({ status: 'paid', paid_at: paidAt, paid_by: actorProfileId, updated_at: paidAt })
        .eq('id', before.id).eq('sales_profile_id', salesProfileId).eq('commission_month', commissionMonth)
        .eq('status', 'locked').is('paid_at', null);
      if (before.updated_at) query = query.eq('updated_at', before.updated_at);
      const updated = await query.select('*').maybeSingle();
      if (updated.error) return { error: updated.error };
      if (!updated.data) return await resolveConflict();
      return { payout: updated.data as PayrollCommissionPayout, before };
    }

    const snapshots = await loadSnapshots(supabase, commissionMonth, salesProfileId);
    if (snapshots.error) return { error: snapshots.error };
    const summary = summarizeCommissionRows(snapshots.data);
    if (Math.round(summary.commissionCents) <= 0) return paymentError('There is no positive commission amount to pay.');
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
      locked_at: paidAt,
      locked_by: actorProfileId,
      paid_at: paidAt,
      paid_by: actorProfileId,
      status: 'paid',
      updated_at: paidAt,
    };
    const inserted = await supabase.from('monthly_commission_payouts').insert(payload).select('*').single();
    if (inserted.error?.code === '23505') return await resolveConflict();
    if (inserted.error) return { error: inserted.error };
    if (!inserted.data) return paymentError('The commission payment could not be confirmed.');
    return { payout: inserted.data as PayrollCommissionPayout, before: null };
  } catch (error) {
    return paymentError(error instanceof Error ? error.message : 'The commission payment could not be recorded.');
  }
}
