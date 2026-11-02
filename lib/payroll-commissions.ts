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
import {
  calculateMonthlyHourlyBaseWages,
  commissionHourlyOffsetApplies,
  loadCommissionHourlyEntries,
  type HourlyOffsetCommissionSettings,
} from '@/lib/commission-hourly-offset';

type SupabaseLike = { from: (table: string) => any };
type StoredCents = number | string | null;

export type PayrollCommissionPayout = {
  id: string;
  sales_profile_id: string | null;
  commission_month: string;
  commission_cents: StoredCents;
  /** The gross commission basis retained when commission_cents is net of wages. */
  gross_commission_cents?: StoredCents;
  hourly_base_offset_cents?: StoredCents;
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
  hourlyOffsetEnabled?: boolean;
  hourlyBaseWagesCents?: number;
  netCommissionCents?: number;
  commissionPercent?: number;
  settlementBlockedReason?: string | null;
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

/** Previously recorded payments never need another invoice lookup. */
export function requiresInvoiceEligibility(
  snapshot: Pick<CommissionSnapshotRow, 'order_id' | 'shipped_at'>,
  payout: PayrollCommissionPayout | null,
) {
  return !isLegacyPaidCommissionPayout(payout)
    && !(payout && isPaid(payout) && payout.paid_order_ids?.includes(snapshot.order_id));
}

function summaryFromPayout(payout: PayrollCommissionPayout): CommissionSummary {
  return {
    commissionCents: numericCents(payout.gross_commission_cents ?? payout.commission_cents),
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

/** Combine this month's confirmed earnings with its immutable payment history. */
export function buildPayrollCommissionRow({
  salesProfileId, snapshots, payout, paidInvoiceOrderIds,
}: {
  salesProfileId: string | null;
  snapshots: CommissionSnapshotRow[];
  payout: PayrollCommissionPayout | null;
  paidInvoiceOrderIds: ReadonlySet<string>;
}): PayrollCommissionRow {
  const paidOrderIds = isLegacyPaidCommissionPayout(payout) ? null : payout && isPaid(payout) ? payout.paid_order_ids ?? [] : [];
  const alreadyPaid = new Set(paidOrderIds ?? []);
  const eligible = snapshots.filter((snapshot) => !alreadyPaid.has(snapshot.order_id) && paidInvoiceOrderIds.has(snapshot.order_id));
  const summary = summarizeCommissionRows(eligible);
  const historical = payout && isPaid(payout) ? summaryFromPayout(payout) : null;
  if (historical) {
    for (const key of Object.keys(summary) as (keyof CommissionSummary)[]) summary[key] += historical[key];
  }
  return {
    salesProfileId, summary, payout,
    amountOwedCents: Math.max(0, Math.round(summary.commissionCents) - Math.round(historical ? numericCents(payout?.commission_cents) : 0)),
    cogsEstimated: snapshots.some((snapshot) => Boolean(snapshot.cogs_estimated)),
    eligibleOrderIds: eligible.map((snapshot) => snapshot.order_id),
    paidOrderIds,
    pendingInvoiceOrderIds: [], pendingInvoiceCount: 0, pendingInvoiceCents: 0,
  };
}

function loadSnapshots(supabase: SupabaseLike, salesProfileId?: string) {
  return fetchAllPages<CommissionSnapshotRow>((from, to) => {
    let query = supabase.from('order_commission_snapshots').select(SNAPSHOT_COLUMNS);
    if (salesProfileId) query = query.eq('sales_profile_id', salesProfileId);
    return query.order('id', { ascending: true }).range(from, to);
  });
}

export type PayrollCommissionMonths = {
  rowsByMonth: Map<string, PayrollCommissionRow[]>;
  snapshotsByMonth: Map<string, CommissionSnapshotRow[]>;
  error: QueryError | null;
};

const payoutKey = (profileId: string | null, month: string) => `${profileId ?? ''}:${month}`;

/**
 * Every unsettled commission belongs to the month its invoice was fully paid.
 * Shipment snapshots retain the original rate/cost basis. Payments already
 * recorded stay in their recorded month and are excluded across ALL months.
 */
export async function loadPayrollCommissionMonths({
  commissionMonths, salesProfileId, supabase = supabaseAdmin, now = new Date(),
}: {
  commissionMonths: string[];
  salesProfileId?: string;
  supabase?: SupabaseLike;
  now?: Date;
}): Promise<PayrollCommissionMonths> {
  const failure = (error: QueryError): PayrollCommissionMonths => ({ rowsByMonth: new Map(), snapshotsByMonth: new Map(), error });
  if (commissionMonths.some((month) => !validCommissionMonth(month))) return failure({ message: 'Invalid commission month.' });
  const months = [...new Set(commissionMonths)];
  if (!months.length) return { rowsByMonth: new Map(), snapshotsByMonth: new Map(), error: null };
  try {
    const [snapshotsResult, payoutsResult, settingsResult] = await Promise.all([
      loadSnapshots(supabase, salesProfileId),
      fetchAllPages<PayrollCommissionPayout>((from, to) => supabase.from('monthly_commission_payouts')
        .select('*').order('id', { ascending: true }).range(from, to)),
      fetchAllPages<HourlyOffsetCommissionSettings>((from, to) => {
        let query = supabase.from('admin_commission_settings')
          .select('profile_id,commission_percent,hourly_offset_enabled,hourly_offset_start_month');
        if (salesProfileId) query = query.eq('profile_id', salesProfileId);
        return query.order('profile_id', { ascending: true }).range(from, to);
      }),
    ]);
    if (snapshotsResult.error || payoutsResult.error || settingsResult.error) return failure((snapshotsResult.error ?? payoutsResult.error ?? settingsResult.error)!);
    const settingsByProfile = new Map(settingsResult.data.filter((setting) => !salesProfileId || setting.profile_id === salesProfileId)
      .map((setting) => [setting.profile_id, setting]));
    const offsetProfiles = [...settingsByProfile.values()].filter((setting) => months.some((month) => commissionHourlyOffsetApplies(setting, month))).map((setting) => setting.profile_id);
    const hourlyEntries = await loadCommissionHourlyEntries(supabase, offsetProfiles, months);
    if (hourlyEntries.error) return failure(hourlyEntries.error);
    const snapshots = snapshotsResult.data.filter((snapshot) => !salesProfileId || snapshot.sales_profile_id === salesProfileId);
    const payouts = payoutsResult.data;
    const payoutByKey = new Map<string, PayrollCommissionPayout>();
    const recordedByOrder = new Map<string, PayrollCommissionPayout>();
    for (const payout of payouts) {
      const key = payoutKey(payout.sales_profile_id, payout.commission_month);
      if (payoutByKey.has(key)) return failure({ message: 'Multiple commission payouts exist for the same employee and month.' });
      payoutByKey.set(key, payout);
      if (isPaid(payout)) {
        for (const orderId of payout.paid_order_ids ?? []) recordedByOrder.set(orderId, payout);
      }
    }
    for (const snapshot of snapshots) {
      const legacy = payoutByKey.get(payoutKey(snapshot.sales_profile_id, snapshot.commission_month));
      if (!recordedByOrder.has(snapshot.order_id) && legacy && isLegacyPaidCommissionPayout(legacy)) {
        recordedByOrder.set(snapshot.order_id, legacy);
      }
    }
    const outstanding = snapshots.filter((snapshot) => !recordedByOrder.has(snapshot.order_id));
    const eligibility = outstanding.length
      ? await getCommissionInvoiceEligibility(outstanding.map((snapshot) => snapshot.order_id), supabase, { includePaymentDates: true })
      : { paidOrderIds: new Set<string>(), paidOrderMonths: new Map<string, string>(), error: null };
    if (eligibility.error) return failure({ message: eligibility.error });
    if ([...eligibility.paidOrderIds].some((id) => !validCommissionMonth(eligibility.paidOrderMonths?.get(id)))) {
      return failure({ message: 'Unable to verify an invoice payment month in QuickBooks.' });
    }
    const snapshotsByMonth = new Map(months.map((month) => [month, [] as CommissionSnapshotRow[]]));
    for (const snapshot of snapshots) {
      const recorded = recordedByOrder.get(snapshot.order_id);
      const earnedMonth = recorded?.commission_month ?? eligibility.paidOrderMonths?.get(snapshot.order_id);
      if (!earnedMonth || (!recorded && !eligibility.paidOrderIds.has(snapshot.order_id))) continue;
      snapshotsByMonth.get(earnedMonth)?.push(snapshot);
    }
    const rowsByMonth = new Map<string, PayrollCommissionRow[]>();
    for (const month of months) {
      const monthSnapshots = snapshotsByMonth.get(month)!;
      const monthPayouts = payouts.filter((payout) => payout.commission_month === month && (!salesProfileId || payout.sales_profile_id === salesProfileId));
      const byProfile = new Map<string | null, CommissionSnapshotRow[]>();
      // Include a zero row for a salesperson whose invoices are not paid yet,
      // without adding unpaid invoice amounts or statuses to payroll.
      const profileIds = new Set([...snapshots.filter((snapshot) => snapshot.commission_month === month).map((snapshot) => snapshot.sales_profile_id),
        ...monthPayouts.map((payout) => payout.sales_profile_id),
        ...offsetProfiles.filter((profileId) => commissionHourlyOffsetApplies(settingsByProfile.get(profileId), month))]);
      for (const snapshot of monthSnapshots) {
        const profileId = recordedByOrder.get(snapshot.order_id)?.sales_profile_id ?? snapshot.sales_profile_id;
        const rows = byProfile.get(profileId) ?? [];
        rows.push(snapshot);
        byProfile.set(profileId, rows);
        profileIds.add(profileId);
      }
      rowsByMonth.set(month, [...profileIds].map((profileId) => {
        const payout = payoutByKey.get(payoutKey(profileId, month)) ?? null;
        const profileSnapshots = byProfile.get(profileId) ?? [];
        const row = buildPayrollCommissionRow({ salesProfileId: profileId, snapshots: profileSnapshots, payout,
          paidInvoiceOrderIds: eligibility.paidOrderIds });
        // Resolve legacy paid snapshots before the first additional payment so
        // changing a legacy NULL to tracked order IDs cannot release them twice.
        if (payout && isLegacyPaidCommissionPayout(payout)) {
          row.paidOrderIds = profileSnapshots.filter((snapshot) => recordedByOrder.get(snapshot.order_id)?.id === payout.id).map((snapshot) => snapshot.order_id);
        }
        const settings = profileId ? settingsByProfile.get(profileId) : undefined;
        row.commissionPercent = numericCents(settings?.commission_percent ?? profileSnapshots[0]?.commission_percent);
        const offsetApplies = commissionHourlyOffsetApplies(settings, month);
        // Previously paid offset months retain their deduction even if the
        // employee's plan is later disabled. New unpaid months use live wages.
        const recordedOffset = payout && isPaid(payout) ? numericCents(payout.hourly_base_offset_cents) : 0;
        row.hourlyOffsetEnabled = offsetApplies || recordedOffset > 0;
        const wages = offsetApplies
          ? calculateMonthlyHourlyBaseWages(hourlyEntries.entries.filter((entry) => entry.profile_id === profileId), month, now)
          : { hourlyBaseWagesCents: recordedOffset, settlementBlockedReason: null };
        row.hourlyBaseWagesCents = Math.max(recordedOffset, wages.hourlyBaseWagesCents);
        row.settlementBlockedReason = wages.settlementBlockedReason ?? (offsetApplies && wages.hourlyBaseWagesCents < recordedOffset
          ? 'Monthly hourly wages are lower than the wages used for an earlier commission payment. Review and adjust this month before paying more commission.'
          : null);
        row.netCommissionCents = Math.max(0, Math.round(row.summary.commissionCents) - row.hourlyBaseWagesCents);
        const paidCents = payout && isPaid(payout) ? Math.round(numericCents(payout.commission_cents)) : 0;
        row.amountOwedCents = Math.max(0, row.netCommissionCents - paidCents);
        return row;
      }).sort((left, right) => (left.salesProfileId ?? '').localeCompare(right.salesProfileId ?? '')));
    }
    return { rowsByMonth, snapshotsByMonth, error: null };
  } catch (error) {
    return failure({ message: error instanceof Error ? error.message : 'Commission invoice payment status could not be verified.' });
  }
}

export async function loadPayrollCommissions({
  commissionMonth, salesProfileId, supabase = supabaseAdmin, now = new Date(),
}: {
  commissionMonth: string;
  salesProfileId?: string;
  supabase?: SupabaseLike;
  now?: Date;
}): Promise<{ rows: PayrollCommissionRow[]; error: QueryError | null }> {
  const result = await loadPayrollCommissionMonths({ commissionMonths: [commissionMonth], salesProfileId, supabase, now });
  return { rows: result.rowsByMonth.get(commissionMonth) ?? [], error: result.error };
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
    if (payout && isPaid(payout) && orderIds.every((id) => payout.paid_order_ids?.includes(id))) {
      return { alreadyPaid: true, payout, before: payout };
    }
    return paymentError('The commission payout changed. Refresh payroll before recording payment.', 'conflict');
  };

  try {
    const existing = await readPayout();
    if (existing.error) return { error: existing.error };
    const before = existing.data as PayrollCommissionPayout | null;
    if (before && !isPaid(before) && before.status !== 'locked') {
      return paymentError('The existing commission payout must be locked before recording payment.');
    }
    const paidAt = now.toISOString();
    const loaded = await loadPayrollCommissions({ commissionMonth, salesProfileId, supabase, now });
    if (loaded.error) return { error: loaded.error };
    const row = loaded.rows.find((candidate) => candidate.salesProfileId === salesProfileId);
    if (!row) return paymentError('There is no positive commission amount on paid invoices to pay.');
    if (row.settlementBlockedReason) return paymentError(row.settlementBlockedReason);
    if ((row.payout?.id ?? null) !== (before?.id ?? null) || row.payout?.updated_at !== before?.updated_at) {
      return paymentError('The commission payout changed. Refresh payroll before recording payment.', 'conflict');
    }
    if (expectedPaymentCents !== undefined && expectedPaymentCents !== row.amountOwedCents) {
      return paymentError('The payable commission amount changed. Refresh payroll before recording payment.', 'conflict');
    }
    if (row.amountOwedCents <= 0) {
      if (before && isPaid(before)) return { alreadyPaid: true, payout: before, before };
      return paymentError('There is no positive commission amount on paid invoices to pay.');
    }
    const summary = row.summary;
    const paidOrderIds = [...new Set([...(row.paidOrderIds ?? []), ...row.eligibleOrderIds])];
    // A conditional update must always advance its optimistic concurrency token.
    const previousUpdatedAt = Date.parse(before?.updated_at ?? '');
    const updatedAt = new Date(Number.isFinite(previousUpdatedAt) ? Math.max(now.getTime(), previousUpdatedAt + 1) : now.getTime()).toISOString();
    const payload = {
      commission_month: commissionMonth,
      sales_profile_id: salesProfileId,
      commission_cents: row.hourlyOffsetEnabled || row.hourlyBaseWagesCents ? row.netCommissionCents! : summary.commissionCents,
      gross_commission_cents: summary.commissionCents,
      hourly_base_offset_cents: row.hourlyBaseWagesCents ?? 0,
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
