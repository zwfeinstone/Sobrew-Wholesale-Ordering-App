'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminSectionEdit } from '@/lib/admin-permissions';
import { parsePayrollPaymentSnapshots, recordReviewedPayrollPayments } from '@/lib/payroll-payment';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function recordPayrollPayments(formData: FormData) {
  const current = await requireAdminSectionEdit('payroll', '/admin/payroll?error=write_denied');
  const rawReturn = String(formData.get('return_to') ?? '');
  const returnUrl = new URL(/^\/admin\/payroll(?:[?#]|$)/.test(rawReturn) ? rawReturn : '/admin/payroll', 'http://localhost');
  returnUrl.searchParams.delete('success');
  returnUrl.searchParams.delete('error');
  const snapshots = parsePayrollPaymentSnapshots(String(formData.get('payment_rows') ?? ''));
  if (!snapshots) {
    returnUrl.searchParams.set('error', 'payroll_payment_invalid');
    redirect(`${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
  }
  const result = await recordReviewedPayrollPayments({ snapshots,
    startInput: String(formData.get('lock_start') ?? ''), endInput: String(formData.get('lock_end') ?? ''),
    actorProfileId: current.profile.id, supabase: getSupabaseAdmin(),
  });
  for (const path of ['/admin/payroll', '/admin/week-hours', '/admin/sales-admin', '/admin/commission', '/admin/reports', '/admin/accounting']) revalidatePath(path);
  revalidatePath('/admin', 'layout');
  returnUrl.searchParams.set(result.error ? 'error' : 'success', result.error ?? 'payroll_payment_recorded');
  redirect(`${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
}
