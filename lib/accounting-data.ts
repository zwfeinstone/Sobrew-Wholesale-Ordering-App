import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/schema';
import type { AccountingCategoryRow } from '@/lib/accounting';
import type {
  AccountingPayrollAllocationRow,
  AccountingPayrollTimeEntryRow,
  AccountingPnlTransactionRow,
  AccountingSalaryPaymentRow,
  ProductionRunLaborRow,
} from '@/lib/accounting-pnl-statement';
import { fetchAllPages } from '@/lib/supabase/pagination';

type AccountingClient = Pick<SupabaseClient<Database>, 'from'>;

export type AccountingPnlInputs = {
  categories: AccountingCategoryRow[];
  payrollAllocations: AccountingPayrollAllocationRow[];
  payrollSalaryPayments: AccountingSalaryPaymentRow[];
  payrollTimeEntries: AccountingPayrollTimeEntryRow[];
  productionRuns: ProductionRunLaborRow[];
  transactions: AccountingPnlTransactionRow[];
};

export function loadAccountingCategories(supabase: AccountingClient) {
  return fetchAllPages<AccountingCategoryRow>(async (from, to) => {
    const result = await supabase
      .from('accounting_categories')
      .select('id,name,category_type,pnl_section,active')
      .eq('active', true)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    // PostgreSQL checks constrain pnl_section; generated text columns are typed as string.
    return { data: result.data as AccountingCategoryRow[] | null, error: result.error };
  });
}

/** All inputs must load successfully before a financial statement is built. */
export async function loadAccountingPnlInputs({
  supabase,
  payrollSupabase,
  start,
  end,
  endExclusive,
}: {
  supabase: AccountingClient;
  payrollSupabase?: AccountingClient;
  start: string;
  end: string;
  endExclusive: string;
}): Promise<{ data: AccountingPnlInputs; error: null } | { data: null; error: { message?: string } }> {
  const payrollStart = `${start}T00:00:00.000Z`;
  const payrollEnd = `${endExclusive}T00:00:00.000Z`;
  const empty = <T>() => ({ data: [] as T[], error: null });
  const [categories, transactions, productionRuns, payrollTimeEntries, payrollSalaryPayments, payrollAllocations] = await Promise.all([
    loadAccountingCategories(supabase),
    fetchAllPages<AccountingPnlTransactionRow>(async (from, to) => {
      const result = await supabase
        .from('accounting_transactions')
        .select('id,transaction_date,account_name,account_type,merchant_name,original_description,amount_cents,status,ai_review_flags,category_id,accounting_categories(id,name,category_type,pnl_section)')
        .gte('transaction_date', start)
        .lt('transaction_date', endExclusive)
        .order('transaction_date', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);
      return { data: result.data as AccountingPnlTransactionRow[] | null, error: result.error };
    }),
    payrollSupabase
      ? fetchAllPages<ProductionRunLaborRow>(async (from, to) => supabase
        .from('production_runs')
        .select('actual_labor_cost_cents,quantity_produced,quantity_voided,status')
        .gte('produced_at', start)
        .lt('produced_at', endExclusive)
        .order('id', { ascending: true })
        .range(from, to))
      : empty<ProductionRunLaborRow>(),
    payrollSupabase
      ? fetchAllPages<AccountingPayrollTimeEntryRow>(async (from, to) => payrollSupabase
        .from('admin_time_entries')
        .select('id,profile_id,clock_in_at,clock_out_at,hourly_rate_cents_snapshot,status,work_type,admin_time_breaks(break_start_at,break_end_at,status)')
        .gte('clock_in_at', payrollStart)
        .lt('clock_in_at', payrollEnd)
        .order('id', { ascending: true })
        .range(from, to))
      : empty<AccountingPayrollTimeEntryRow>(),
    payrollSupabase
      ? fetchAllPages<AccountingSalaryPaymentRow>(async (from, to) => payrollSupabase
        .from('admin_salary_payroll_payments')
        .select('id,paid_at,period_start_date,period_end_date,salary_labor_work_type,salary_pay_cents')
        .not('paid_at', 'is', null)
        .lte('period_start_date', end)
        .gte('period_end_date', start)
        .order('id', { ascending: true })
        .range(from, to))
      : empty<AccountingSalaryPaymentRow>(),
    payrollSupabase
      ? fetchAllPages<AccountingPayrollAllocationRow>(async (from, to) => payrollSupabase
        .from('admin_time_entry_allocations')
        .select('time_entry_id,work_type,minutes,wage_cents,admin_time_entries!inner(clock_in_at)')
        .gte('admin_time_entries.clock_in_at', payrollStart)
        .lt('admin_time_entries.clock_in_at', payrollEnd)
        .order('id', { ascending: true })
        .range(from, to))
      : empty<AccountingPayrollAllocationRow>(),
  ]);

  const error = [categories, transactions, productionRuns, payrollTimeEntries, payrollSalaryPayments, payrollAllocations]
    .find((result) => result.error)?.error;
  if (error) return { data: null, error };

  return {
    data: {
      categories: categories.data ?? [],
      payrollAllocations: payrollAllocations.data ?? [],
      payrollSalaryPayments: payrollSalaryPayments.data ?? [],
      payrollTimeEntries: payrollTimeEntries.data ?? [],
      productionRuns: productionRuns.data ?? [],
      transactions: transactions.data ?? [],
    },
    error: null,
  };
}
