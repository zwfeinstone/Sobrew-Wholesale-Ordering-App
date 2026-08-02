import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { createAccountingPnlPdf } from '@/lib/accounting-pnl-pdf';
import {
  ACCOUNTING_PNL_TRANSACTION_LIMIT,
  buildAccountingPnlStatement,
  type AccountingPayrollAllocationRow,
  type AccountingPayrollTimeEntryRow,
  type AccountingPnlTransactionRow,
  type AccountingSalaryPaymentRow,
  type ProductionRunLaborRow,
} from '@/lib/accounting-pnl-statement';
import type { AccountingCategoryRow } from '@/lib/accounting';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfCurrentYear() {
  return `${todayInput().slice(0, 4)}-01-01`;
}

function addOneDay(dateInput: string) {
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function dateInputParam(value: string | null, fallback: string) {
  const trimmed = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return fallback;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : trimmed;
}

function pdfFilename(start: string, end: string) {
  return `sobrew-detailed-profit-and-loss-${start}-to-${end}.pdf`;
}

export async function GET(request: NextRequest) {
  await requireAdminSectionView('accounting');

  const start = dateInputParam(request.nextUrl.searchParams.get('start'), firstDayOfCurrentYear());
  const end = dateInputParam(request.nextUrl.searchParams.get('end'), todayInput());
  if (end < start) {
    return new NextResponse('End date must be on or after start date.', { status: 400 });
  }

  const endExclusive = addOneDay(end);
  const payrollRangeStart = `${start}T00:00:00.000Z`;
  const payrollRangeEndExclusive = `${endExclusive}T00:00:00.000Z`;
  const supabase = await createClient();
  const payrollSupabase = getSupabaseAdmin();

  const [
    categoriesResult,
    pnlTransactionsResult,
    productionRunLaborResult,
    payrollTimeEntriesResult,
    payrollSalaryPaymentsResult,
  ] = await Promise.all([
    supabase
      .from('accounting_categories')
      .select('id,name,category_type,pnl_section,active')
      .eq('active', true)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('accounting_transactions')
      .select('id,transaction_date,account_name,account_type,merchant_name,original_description,amount_cents,status,ai_review_flags,category_id,accounting_categories(id,name,category_type,pnl_section)')
      .gte('transaction_date', start)
      .lt('transaction_date', endExclusive)
      .order('transaction_date', { ascending: false })
      .limit(ACCOUNTING_PNL_TRANSACTION_LIMIT),
    supabase
      .from('production_runs')
      .select('actual_labor_cost_cents,quantity_produced,quantity_voided,status')
      .gte('produced_at', start)
      .lt('produced_at', endExclusive),
    payrollSupabase
      .from('admin_time_entries')
      .select('id,profile_id,clock_in_at,clock_out_at,hourly_rate_cents_snapshot,status,work_type,admin_time_breaks(break_start_at,break_end_at,status)')
      .gte('clock_in_at', payrollRangeStart)
      .lt('clock_in_at', payrollRangeEndExclusive)
      .limit(ACCOUNTING_PNL_TRANSACTION_LIMIT),
    payrollSupabase
      .from('admin_salary_payroll_payments')
      .select('id,paid_at,period_start_date,period_end_date,salary_labor_work_type,salary_pay_cents')
      .not('paid_at', 'is', null)
      .lte('period_start_date', end)
      .gte('period_end_date', start)
      .limit(ACCOUNTING_PNL_TRANSACTION_LIMIT),
  ]);

  if (categoriesResult.error) {
    return new NextResponse(categoriesResult.error.message, { status: 500 });
  }
  if (pnlTransactionsResult.error) {
    return new NextResponse(pnlTransactionsResult.error.message, { status: 500 });
  }
  if (productionRunLaborResult.error) {
    return new NextResponse(productionRunLaborResult.error.message, { status: 500 });
  }

  const payrollTimeEntries = payrollTimeEntriesResult.error
    ? []
    : (payrollTimeEntriesResult.data ?? []) as AccountingPayrollTimeEntryRow[];
  const payrollSalaryPayments = payrollSalaryPaymentsResult.error
    ? []
    : (payrollSalaryPaymentsResult.data ?? []) as AccountingSalaryPaymentRow[];
  let payrollAllocations: AccountingPayrollAllocationRow[] = [];

  if (payrollTimeEntries.length) {
    const payrollAllocationResult = await payrollSupabase
      .from('admin_time_entry_allocations')
      .select('time_entry_id,work_type,minutes,wage_cents')
      .in('time_entry_id', payrollTimeEntries.map((entry) => entry.id))
      .limit(ACCOUNTING_PNL_TRANSACTION_LIMIT);
    payrollAllocations = payrollAllocationResult.error
      ? []
      : (payrollAllocationResult.data ?? []) as AccountingPayrollAllocationRow[];
  }

  const statement = buildAccountingPnlStatement({
    categories: (categoriesResult.data ?? []) as AccountingCategoryRow[],
    payrollAllocations,
    payrollSalaryPayments,
    payrollTimeEntries,
    productionRuns: (productionRunLaborResult.data ?? []) as ProductionRunLaborRow[],
    transactions: (pnlTransactionsResult.data ?? []) as AccountingPnlTransactionRow[],
  });
  const pdf = createAccountingPnlPdf({
    period: { end, start },
    statement,
  });

  return new NextResponse(pdf, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${pdfFilename(start, end)}"`,
      'Content-Type': 'application/pdf',
    },
  });
}
