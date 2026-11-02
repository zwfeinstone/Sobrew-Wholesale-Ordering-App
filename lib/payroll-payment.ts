import 'server-only';

import { recordAdminAuditLog } from '@/lib/admin-audit';
import { commissionMonthForDate } from '@/lib/commissions';
import { getCommissionInvoiceEligibility } from '@/lib/commission-invoice-eligibility';
import { isPayrollCommissionMonth, loadPayrollCommissions, recordPayrollCommissionPaid } from '@/lib/payroll-commissions';
import { getCurrentMonthlySalaryPayrollWindow } from '@/lib/payroll-status';
import { isMileageReimbursement } from '@/lib/payroll-mileage';
import { calculatePayrollWages, distributePayrollWages, payrollOvertimeContextRange, type PayrollWageEntry } from '@/lib/payroll-wages';
import { fetchAllByIds, fetchAllPages } from '@/lib/supabase/pagination';
import { formatCentralDateInput, normalizeMoneyCents, normalizeSalaryLaborWorkType, parseCentralDateInput } from '@/lib/time-clock';

type SupabaseLike = { from: (table: string) => any };

/** A review snapshot, never an authoritative instruction about what is owed. */
export type PayrollPaymentSnapshot = {
  profileId: string;
  entryIds: string[];
  spiffIds: string[];
  wagesCents: number;
  spiffCents: number;
  salaryCents: number;
  commissionCents: number;
  payrollMonth?: string;
  commissionMonth?: string;
};

type Entry = PayrollWageEntry & { updated_at: string };
type Allocation = { id: string; time_entry_id: string; minutes: number | string | null; wage_cents: number | string | null };
type Spiff = {
  id: string; profile_id: string | null; amount_cents: number | string | null; first_order_id: string | null;
  notes: string | null; paid_at: string | null; updated_at: string; week_start_date: string; week_end_date: string;
};
type SalaryPayment = { id: string; paid_at: string | null; updated_at: string };
type Prepared = { snapshot: PayrollPaymentSnapshot; entries: Entry[]; spiffs: Spiff[]; salaryWorkType: string; salaryPayment: SalaryPayment | null };
export type PayrollPaymentResult = { error?: string; recordedCount: number; completedEmployees: number };

class PaymentError extends Error {}
const fail = (code: string): never => { throw new PaymentError(code); };
const sameIds = (left: string[], right: string[]) => left.length === right.length && left.every((id) => right.includes(id));
const cents = (value: number | string | null) => Math.round(normalizeMoneyCents(value));
const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= 2000
  && ids.every((id) => typeof id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(id)) && new Set(ids).size === ids.length;

export function parsePayrollPaymentSnapshots(value: string): PayrollPaymentSnapshot[] | null {
  try {
    const rows: unknown = JSON.parse(value);
    if (!Array.isArray(rows) || !rows.length || rows.length > 200) return null;
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.profileId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(row.profileId)
        || !validIds(row.entryIds) || !validIds(row.spiffIds)
        || !['wagesCents', 'spiffCents', 'salaryCents', 'commissionCents'].every((key) => Number.isSafeInteger(row[key]) && row[key] >= 0)
        || (row.payrollMonth !== undefined && !isPayrollCommissionMonth(row.payrollMonth))
        || (row.commissionMonth !== undefined && !isPayrollCommissionMonth(row.commissionMonth))
        || (row.salaryCents > 0 && !row.payrollMonth) || (row.commissionCents > 0 && !row.commissionMonth)
        || (!row.entryIds.length && !row.spiffIds.length && !row.salaryCents && !row.commissionCents)) return null;
    }
    if (new Set(rows.map((row) => row.profileId)).size !== rows.length) return null;
    return rows as PayrollPaymentSnapshot[];
  } catch { return null; }
}

function strictDate(value: string, end = false) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseCentralDateInput(value, end) : null;
  return date && formatCentralDateInput(date) === value ? date : null;
}

async function preparePayment(snapshot: PayrollPaymentSnapshot, start: Date, end: Date, now: Date, supabase: SupabaseLike): Promise<Prepared> {
  const context = payrollOvertimeContextRange(start, end);
  const [entryResult, spiffResult] = await Promise.all([
    fetchAllPages<Entry>((from, to) => supabase.from('admin_time_entries')
      .select('id,profile_id,clock_in_at,clock_out_at,hourly_rate_cents_snapshot,status,updated_at,admin_time_breaks(break_start_at,break_end_at,status)')
      .eq('profile_id', snapshot.profileId)
      .or(`clock_in_at.gte.${context.start.toISOString()},clock_out_at.gt.${context.start.toISOString()}`)
      .lt('clock_in_at', context.endExclusive.toISOString()).order('id').range(from, to)),
    fetchAllPages<Spiff>((from, to) => supabase.from('admin_weekly_sales_spiffs')
      .select('id,profile_id,amount_cents,first_order_id,notes,paid_at,updated_at,week_start_date,week_end_date')
      .eq('profile_id', snapshot.profileId).is('paid_at', null).lte('week_start_date', formatCentralDateInput(end)).order('id').range(from, to)),
  ]);
  if (entryResult.error || spiffResult.error) fail('payroll_payment_load_error');
  const endExclusive = new Date(end.getTime() + 1000);
  const selected = entryResult.data.filter((entry) => entry.profile_id === snapshot.profileId && entry.status !== 'void'
    && new Date(entry.clock_in_at) >= start && new Date(entry.clock_in_at) < endExclusive);
  if (selected.some((entry) => !entry.clock_out_at || entry.status === 'open')) fail('open_entries');
  if (selected.some((entry) => !['approved', 'locked'].includes(entry.status ?? ''))) fail('unapproved_entries');
  const entries = selected.filter((entry) => entry.status !== 'locked');
  if (entries.some((entry) => (entry.admin_time_breaks ?? []).some((entryBreak) => entryBreak.status !== 'void' && !entryBreak.break_end_at))) fail('open_breaks');
  if (!sameIds(snapshot.entryIds, entries.map((entry) => entry.id))) fail('payroll_payment_changed');
  const allocationsResult = await fetchAllByIds<Allocation>(snapshot.entryIds, (ids, from, to) => supabase
    .from('admin_time_entry_allocations').select('id,time_entry_id,minutes,wage_cents').in('time_entry_id', ids).order('id').range(from, to));
  if (allocationsResult.error) fail('payroll_payment_load_error');
  const wages = calculatePayrollWages(entryResult.data);
  // Match the review page: preserve allocation base wages and distribute overtime.
  const wageTotal = entries.reduce((sum, entry) => {
    const pay = wages.get(entry.id);
    if (!pay || pay.minutes <= 0) return sum;
    const allocations = allocationsResult.data.filter((allocation) => allocation.time_entry_id === entry.id && Number(allocation.minutes) > 0);
    if (!allocations.length) return sum + pay.wageCents;
    const weights = allocations.map((allocation) => Number(allocation.minutes));
    const remaining = Math.max(0, pay.minutes - weights.reduce((total, minutes) => total + minutes, 0));
    const parts = distributePayrollWages(pay, [...weights, remaining]);
    return sum + allocations.reduce((total, allocation, index) => total + normalizeMoneyCents(allocation.wage_cents) + parts[index].overtimePremiumCents, 0)
      + (remaining > 0 ? parts[parts.length - 1].wageCents : 0);
  }, 0);
  if (Math.round(wageTotal) !== snapshot.wagesCents) fail('payroll_payment_changed');
  const outstandingSpiffs = spiffResult.data.filter((spiff) => spiff.profile_id === snapshot.profileId && !spiff.paid_at
    && spiff.week_start_date <= formatCentralDateInput(end)
    && (spiff.week_end_date >= formatCentralDateInput(start) || spiff.first_order_id || isMileageReimbursement(spiff)));
  const invoiceOrderIds = outstandingSpiffs.flatMap((spiff) => spiff.first_order_id ? [spiff.first_order_id] : []);
  let paidInvoiceIds = new Set<string>();
  if (invoiceOrderIds.length) {
    const eligibility = await getCommissionInvoiceEligibility(invoiceOrderIds, supabase);
    if (eligibility.error) fail('spiff_invoice_error');
    paidInvoiceIds = eligibility.paidOrderIds;
  }
  if (outstandingSpiffs.some((spiff) => snapshot.spiffIds.includes(spiff.id) && spiff.first_order_id && !paidInvoiceIds.has(spiff.first_order_id))) fail('spiff_invoice_unpaid');
  const spiffs = outstandingSpiffs.filter((spiff) => !spiff.first_order_id || paidInvoiceIds.has(spiff.first_order_id));
  if (!sameIds(snapshot.spiffIds, spiffs.map((spiff) => spiff.id))
    || Math.round(spiffs.reduce((sum, spiff) => sum + normalizeMoneyCents(spiff.amount_cents), 0)) !== snapshot.spiffCents) fail('payroll_payment_changed');
  let salaryWorkType = 'admin';
  let salaryPayment: SalaryPayment | null = null;
  if (snapshot.payrollMonth) {
    const window = getCurrentMonthlySalaryPayrollWindow(now);
    if (snapshot.payrollMonth !== window.payrollMonthInput) fail('payroll_payment_changed');
    const [profile, setting, payment] = await Promise.all([
      supabase.from('profiles').select('id,is_active').eq('id', snapshot.profileId).eq('is_admin', true).maybeSingle(),
      supabase.from('admin_time_settings').select('active,compensation_type,salary_frequency,salary_amount_cents,salary_labor_work_type').eq('profile_id', snapshot.profileId).maybeSingle(),
      supabase.from('admin_salary_payroll_payments').select('id,paid_at,updated_at').eq('profile_id', snapshot.profileId).eq('payroll_month', snapshot.payrollMonth).maybeSingle(),
    ]);
    if (profile.error || setting.error || payment.error) fail('payroll_payment_load_error');
    const salaryDue = profile.data && profile.data.is_active !== false && setting.data && setting.data.active !== false
      && setting.data.compensation_type === 'salary' && setting.data.salary_frequency === 'monthly' && !payment.data?.paid_at
      ? Math.max(0, cents(setting.data.salary_amount_cents)) : 0;
    if (salaryDue !== snapshot.salaryCents) fail('payroll_payment_changed');
    salaryWorkType = normalizeSalaryLaborWorkType(setting.data?.salary_labor_work_type);
    salaryPayment = payment.data as SalaryPayment | null;
  }
  if (snapshot.commissionMonth) {
    if (snapshot.commissionMonth >= commissionMonthForDate(now)) {
      if (snapshot.commissionCents !== 0) fail('payroll_payment_changed');
    } else {
      const commission = await loadPayrollCommissions({ commissionMonth: snapshot.commissionMonth, salesProfileId: snapshot.profileId, supabase, now });
      if (commission.error) fail('payroll_payment_load_error');
      const row = commission.rows.find((candidate) => candidate.salesProfileId === snapshot.profileId);
      if (snapshot.commissionCents > 0 && row?.settlementBlockedReason) fail('payroll_payment_changed');
      if ((row?.amountOwedCents ?? 0) !== snapshot.commissionCents) fail('payroll_payment_changed');
    }
  }
  return { snapshot, entries, spiffs, salaryWorkType, salaryPayment };
}

/**
 * Record the reviewed payment in every existing ledger; this never sends money.
 * The existing tables are independent, so failures explicitly return partial
 * completion. Successful components remain paid and disappear from the next
 * review; no compensating rollback can accidentally erase another admin's work.
 */
export async function recordReviewedPayrollPayments({ snapshots, startInput, endInput, actorProfileId, supabase, now = new Date() }: {
  snapshots: PayrollPaymentSnapshot[]; startInput: string; endInput: string; actorProfileId: string; supabase: SupabaseLike; now?: Date;
}): Promise<PayrollPaymentResult> {
  let recordedCount = 0;
  let completedEmployees = 0;
  let writeAttempted = false;
  try {
    const start = strictDate(startInput);
    const end = strictDate(endInput, true);
    if (!start || !end || end < start || !actorProfileId || !Number.isFinite(now.getTime())
      || !parsePayrollPaymentSnapshots(JSON.stringify(snapshots))) fail('payroll_payment_invalid');
    // Validate the whole batch before any mutation, including employees later in it.
    for (const snapshot of snapshots) await preparePayment(snapshot, start!, end!, now, supabase);
    const timestamp = now.toISOString();
    const audit = async (snapshot: PayrollPaymentSnapshot, action: string, after: unknown, before?: unknown) => {
      recordedCount += 1;
      await recordAdminAuditLog({ action, actorProfileId, after, before, sectionKey: 'payroll', targetProfileId: snapshot.profileId, supabase });
    };
    for (const snapshot of snapshots) {
      // Repeat reads immediately before this employee, since invoice checks and
      // a larger batch can take time. Never silently accept a changed total.
      const prepared = await preparePayment(snapshot, start!, end!, now, supabase);
      if (snapshot.commissionCents > 0) {
        writeAttempted = true;
        const result = await recordPayrollCommissionPaid({ commissionMonth: snapshot.commissionMonth!, salesProfileId: snapshot.profileId,
          actorProfileId, expectedPaymentCents: snapshot.commissionCents, now, supabase });
        if (result.error || result.alreadyPaid || !result.payout) fail('payroll_payment_changed');
        await audit(snapshot, 'monthly_commission_paid', result.payout, result.before ?? null);
      }
      if (snapshot.salaryCents > 0) {
        const window = getCurrentMonthlySalaryPayrollWindow(now);
        writeAttempted = true;
        const payload = {
          profile_id: snapshot.profileId, payroll_month: window.payrollMonthInput, period_start_date: window.periodStartInput,
          period_end_date: window.periodEndInput, salary_amount_cents: snapshot.salaryCents, salary_pay_cents: snapshot.salaryCents,
          salary_frequency: 'monthly', salary_labor_work_type: prepared.salaryWorkType,
          approved_at: timestamp, approved_by: actorProfileId, paid_at: timestamp, paid_by: actorProfileId,
          updated_at: timestamp, updated_by: actorProfileId,
        };
        const result = prepared.salaryPayment
          ? await supabase.from('admin_salary_payroll_payments').update(payload)
            .eq('id', prepared.salaryPayment.id).eq('profile_id', snapshot.profileId).is('paid_at', null)
            .eq('updated_at', prepared.salaryPayment.updated_at).select('id').maybeSingle()
          : await supabase.from('admin_salary_payroll_payments').insert({ ...payload, created_by: actorProfileId }).select('id').single();
        if (result.error || !result.data) fail('payroll_payment_error');
        await audit(snapshot, 'salary_payroll_marked_paid', { payment_id: result.data.id, payroll_month: window.payrollMonthInput, salary_pay_cents: snapshot.salaryCents }, prepared.salaryPayment);
      }
      for (const spiff of prepared.spiffs) {
        writeAttempted = true;
        const result = await supabase.from('admin_weekly_sales_spiffs')
          .update({ paid_at: timestamp, paid_by: actorProfileId, updated_at: timestamp, updated_by: actorProfileId })
          .eq('id', spiff.id).eq('profile_id', snapshot.profileId).is('paid_at', null).eq('updated_at', spiff.updated_at)
          .select('id').maybeSingle();
        if (result.error || !result.data) fail('payroll_payment_error');
        await audit(snapshot, 'weekly_sales_spiff_marked_paid', { payment_id: spiff.id, paid_at: timestamp }, spiff);
      }
      for (const entry of prepared.entries) {
        writeAttempted = true;
        const result = await supabase.from('admin_time_entries')
          .update({ locked_at: timestamp, locked_by: actorProfileId, status: 'locked', updated_at: timestamp, updated_by: actorProfileId })
          .eq('id', entry.id).eq('profile_id', snapshot.profileId).eq('status', 'approved').eq('updated_at', entry.updated_at)
          .select('id').maybeSingle();
        if (result.error || !result.data) fail('payroll_payment_error');
        await audit(snapshot, 'payroll_employee_week_marked_paid', { entry_id: entry.id, lock_start_at: start!.toISOString(), lock_end_at: end!.toISOString() });
      }
      completedEmployees += 1;
    }
    return { recordedCount, completedEmployees };
  } catch (error) {
    // A transport error after a write may have committed without a response.
    // Always refresh, and ask for review rather than claiming nothing changed.
    return { error: recordedCount || writeAttempted ? 'payroll_payment_partial' : error instanceof PaymentError ? error.message : 'payroll_payment_load_error', recordedCount, completedEmployees };
  }
}
