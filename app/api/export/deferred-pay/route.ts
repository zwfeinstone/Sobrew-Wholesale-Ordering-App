import { NextRequest } from 'next/server';
import { requireAdminSectionEdit } from '@/lib/admin-permissions';
import { deferredPayPeriodBounds } from '@/lib/deferred-pay-accounting';
import { loadDeferredPayAccounting } from '@/lib/deferred-pay-accounting-data';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { formatCentralDateInput } from '@/lib/time-clock';

function csvCell(value: unknown) {
  const raw = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) && !/^[+-]?\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  await requireAdminSectionEdit('payroll', '/admin/payroll?error=write_denied');
  const start = request.nextUrl.searchParams.get('from') ?? '';
  const end = request.nextUrl.searchParams.get('to') ?? '';
  const profileId = request.nextUrl.searchParams.get('admin') || undefined;
  try {
    deferredPayPeriodBounds(start, end);
  } catch {
    return new Response('Invalid date range', { status: 400 });
  }
  const result = await loadDeferredPayAccounting({ supabase: supabaseAdmin, start, end, profileId });
  if (result.error) {
    console.error('[export-deferred-pay] unable to load complete deferred payroll', result.error);
    return new Response('Unable to load all deferred payroll records. Please try again.', { status: 500 });
  }
  const rows = [
    ['employee', 'plan', 'period_start', 'period_end', 'labor_tags', 'eligible_hours', 'opening_liability_usd', 'accrued_usd', 'paid_usd', 'closing_liability_usd', 'weekly_rate_usd', 'deferred_rate_usd', 'accrual_start', 'accrual_end', 'scheduled_payment_date', 'payment_date', 'bank_transaction_id', 'as_of'],
    ...result.data.plans.map((row) => [
      row.employeeName, row.plan.label, start, end, 'All labor tags', row.eligibleHours.toFixed(2),
      (row.openingLiabilityCents / 100).toFixed(2), (row.accruedCents / 100).toFixed(2),
      (row.paidCents / 100).toFixed(2), (row.closingLiabilityCents / 100).toFixed(2),
      (row.plan.weekly_rate_cents / 100).toFixed(2), (row.plan.accrual_rate_cents / 100).toFixed(2),
      row.plan.start_date, row.plan.end_date, row.plan.payout_date,
      row.plan.paid_at ? formatCentralDateInput(row.plan.paid_at) : '', row.plan.accounting_transaction_id ?? '', result.data.asOf,
    ]),
  ];
  return new Response(rows.map((row) => row.map(csvCell).join(',')).join('\n'), {
    headers: {
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="deferred-pay-${start}-to-${end}.csv"`,
      'content-type': 'text/csv; charset=utf-8',
    },
  });
}
