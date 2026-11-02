'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminSectionEdit } from '@/lib/admin-permissions';
import { loadDeferredPayForProfile } from '@/lib/deferred-pay-data';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { formatCentralDateInput, parseCentralDateInput } from '@/lib/time-clock';

type SettlementPlan = {
  id: string;
  profile_id: string;
  payout_date: string;
  end_date: string;
  paid_at: string | null;
  paid_amount_cents: number | null;
  accounting_transaction_id?: string | null;
};

const ERROR_CODES = new Set([
  'deferred_pay_invalid', 'deferred_pay_permission', 'deferred_pay_accounting_permission',
  'deferred_pay_not_found', 'deferred_pay_not_paid', 'deferred_pay_amount_changed',
  'deferred_pay_already_paid', 'deferred_pay_not_due', 'deferred_pay_invalid_date',
  'deferred_pay_open_shifts', 'deferred_pay_no_balance', 'deferred_pay_already_linked',
  'deferred_pay_bank_mismatch', 'deferred_pay_bank_in_use', 'deferred_pay_category_missing',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resultHref(formData: FormData, key: 'error' | 'success', value: string) {
  const origin = 'https://sobrew.invalid';
  let url = new URL('/admin/payroll?tab=payments', origin);
  try {
    const requested = new URL(String(formData.get('return_to') ?? ''), origin);
    if (requested.origin === origin && requested.pathname === '/admin/payroll') url = requested;
  } catch { /* Keep the payroll fallback. */ }
  url.searchParams.delete('error');
  url.searchParams.delete('success');
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseCentralDateInput(value);
  return Boolean(parsed && formatCentralDateInput(parsed) === value);
}

async function settle(formData: FormData, linkOnly: boolean): Promise<never> {
  const current = await requireAdminSectionEdit('payroll', resultHref(formData, 'error', 'deferred_pay_permission'));
  const fail = (code: string): never => redirect(resultHref(formData, 'error', code));
  const planId = String(formData.get('plan_id') ?? '').trim();
  const expectedAmount = Number(formData.get('expected_amount_cents'));
  const bankId = String(formData.get('accounting_transaction_id') ?? '').trim();
  const paidDate = String(formData.get('paid_date') ?? '').trim();
  const notes = String(formData.get('payment_notes') ?? '').trim();
  if (!UUID.test(planId) || !Number.isSafeInteger(expectedAmount) || expectedAmount <= 0
    || expectedAmount > 2_147_483_647 || (bankId && !UUID.test(bankId)) || notes.length > 2000) {
    fail('deferred_pay_invalid');
  }
  if (linkOnly && !bankId) fail('deferred_pay_invalid');
  if (bankId) {
    await requireAdminSectionEdit('accounting', resultHref(formData, 'error', 'deferred_pay_accounting_permission'));
  }

  const supabase = getSupabaseAdmin();
  const planResult = await supabase.from('admin_deferred_pay_plans').select('*').eq('id', planId).maybeSingle();
  if (planResult.error) fail('deferred_pay_save_error');
  const plan = planResult.data as SettlementPlan | null;
  if (!plan) return fail('deferred_pay_not_found');
  if (linkOnly) {
    if (!plan.paid_at) fail('deferred_pay_not_paid');
    if (plan.paid_amount_cents !== expectedAmount) fail('deferred_pay_amount_changed');
    if (plan.accounting_transaction_id && plan.accounting_transaction_id !== bankId) fail('deferred_pay_already_linked');
  } else {
    if (plan.paid_at) fail('deferred_pay_already_paid');
    const now = new Date();
    const today = formatCentralDateInput(now);
    if (today < plan.payout_date || today <= plan.end_date) fail('deferred_pay_not_due');
    if (!validDate(paidDate) || paidDate < plan.payout_date || paidDate > today) fail('deferred_pay_invalid_date');
    const loaded = await loadDeferredPayForProfile(supabase, plan.profile_id, now);
    if (loaded.error) fail('deferred_pay_load_error');
    const view = loaded.data?.find((row) => row.plan.id === planId);
    if (!view || view.plan.paid_at) return fail(view ? 'deferred_pay_already_paid' : 'deferred_pay_not_found');
    if (view.summary.accruedCents <= 0 || view.summary.remainingCents <= 0) fail('deferred_pay_no_balance');
    if (view.summary.accruedCents !== expectedAmount || view.summary.remainingCents !== expectedAmount) {
      fail('deferred_pay_amount_changed');
    }
  }

  // The service-only RPC rechecks live actor permissions, bank compatibility,
  // and the complete hours total atomically. It records a payment already made.
  const { error } = await supabase.rpc('settle_deferred_hourly_pay', {
    p_actor_id: current.profile.id,
    p_plan_id: planId,
    p_expected_amount_cents: expectedAmount,
    p_link_only: linkOnly,
    ...(!linkOnly ? { p_paid_date: paidDate, p_payment_notes: notes } : {}),
    ...(bankId ? { p_accounting_transaction_id: bankId } : {}),
  });
  if (error) fail(error.message && ERROR_CODES.has(error.message) ? error.message : 'deferred_pay_save_error');
  for (const path of ['/admin/payroll', '/admin/week-hours', '/admin/accounting', '/admin/reports']) revalidatePath(path);
  redirect(resultHref(formData, 'success', linkOnly ? 'deferred_pay_linked' : 'deferred_pay_paid'));
}

/** Records the full actual lump sum after payment; never initiates a transfer. */
export async function recordDeferredPayPayment(formData: FormData): Promise<never> {
  return settle(formData, false);
}

/** Connects a later bank import to an already recorded lump sum. */
export async function linkDeferredPayPayment(formData: FormData): Promise<never> {
  return settle(formData, true);
}
