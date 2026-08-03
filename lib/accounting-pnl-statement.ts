import {
  buildAccountingPnlTotals,
  categoryForTransaction,
  normalizeAccountingNumber,
  type AccountingCategoryRow,
  type AccountingPnlSection,
  type AccountingPnlTotals,
  type AccountingTransactionRow,
} from '@/lib/accounting';
import {
  normalizeMoneyCents,
  normalizeSalaryLaborWorkType,
  normalizeWorkType,
  paidMinutes,
  salaryLaborWorkTypeLabel,
  wageCentsForMinutes,
  workTypeLabel,
  type SalaryLaborWorkType,
  type TimeClockBreakRow,
  type TimeClockEntryRow,
  type TimeEntryWorkType,
} from '@/lib/time-clock';

export const ACCOUNTING_PNL_TRANSACTION_LIMIT = 5000;

export const ACCOUNTING_PNL_DETAIL_SECTIONS = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'cogs', label: 'COGS' },
  { id: 'operating_expenses', label: 'Operating Expenses' },
  { id: 'other_income', label: 'Other Income' },
  { id: 'other_expenses', label: 'Other Expenses' },
] as const;

const PAYROLL_CATEGORY_PATTERN = /\b(payroll|owner pay)\b/i;

export type AccountingPnlTransactionRow = AccountingTransactionRow & {
  account_name?: string | null;
  account_type?: string | null;
  ai_review_flags?: unknown;
  id?: string | null;
  merchant_name?: string | null;
  original_description?: string | null;
};

export type ProductionRunLaborRow = {
  actual_labor_cost_cents: number | string | null;
  quantity_produced: number | string | null;
  quantity_voided: number | string | null;
  status: string | null;
};

export type AccountingPayrollTimeEntryRow = TimeClockEntryRow & {
  admin_time_breaks?: TimeClockBreakRow[] | null;
  id: string;
  profile_id: string;
};

export type AccountingPayrollAllocationRow = {
  minutes: number | string | null;
  time_entry_id: string;
  wage_cents: number | string | null;
  work_type: string | null;
};

export type AccountingSalaryPaymentRow = {
  id: string;
  paid_at: string | null;
  period_end_date: string | null;
  period_start_date: string | null;
  salary_labor_work_type: string | null;
  salary_pay_cents: number | string | null;
};

export type AccountingLaborSummary = {
  adminSalariesCents: number;
  byWorkType: Array<{ amountCents: number; label: string; workType: AccountingLaborWorkType }>;
  otherSalariesCents: number;
  ownerSalariesCents: number;
  productionLaborCogsCents: number;
  salesSalariesCents: number;
  totalLaborCents: number;
};

type AccountingLaborWorkType = TimeEntryWorkType | SalaryLaborWorkType;

export type AccountingPnlAdjustedTotals = {
  cogsCents: number;
  grossProfitCents: number;
  netIncomeCents: number;
  operatingExpenseCents: number;
  operatingIncomeCents: number;
};

export type AccountingPnlStatementTransaction = {
  accountName: string;
  amountCents: number;
  date: string;
  description: string;
  id: string;
};

export type AccountingPnlStatementDetailRow = {
  id: string;
  label: string;
  totalCents: number;
  transactions: AccountingPnlStatementTransaction[];
};

export type AccountingPnlStatementDetailSection = {
  id: Exclude<AccountingPnlSection, 'none'>;
  label: string;
  rows: AccountingPnlStatementDetailRow[];
};

export type AccountingPnlStatement = {
  adjustedPnl: AccountingPnlAdjustedTotals;
  aiFlaggedCount: number;
  basePnl: AccountingPnlTotals;
  categoryBreakdown: AccountingPnlStatementDetailSection[];
  detailSections: AccountingPnlStatementDetailSection[];
  laborCogsCents: number;
  laborCogsSourceLabel: string;
  laborReclassCents: number;
  needsReviewCount: number;
  payrollLaborSummary: AccountingLaborSummary;
  payrollOperatingExpenseCents: number;
  productionRunLaborCogsCents: number;
  retailSalesCents: number;
  salesAdminOtherLaborCents: number;
  wholesaleSalesCents: number;
};

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function relatedAccountingCategory(transaction: AccountingTransactionRow) {
  return categoryForTransaction(transaction);
}

export function accountingCategoryAmountForPnlSection(
  transaction: AccountingTransactionRow,
  category: AccountingCategoryRow,
) {
  const amountCents = normalizeAccountingNumber(transaction.amount_cents);
  if (category.pnl_section === 'revenue' || category.pnl_section === 'other_income') {
    return -amountCents;
  }
  if (category.pnl_section === 'cogs' || category.pnl_section === 'operating_expenses' || category.pnl_section === 'other_expenses') {
    return amountCents;
  }
  return 0;
}

export function isStandaloneAccountingFlag(flag: any) {
  return flag?.flagType !== 'inventory_overlap' && flag?.recommendedAction !== 'approve_inventory_match';
}

export function isShopifyDepositTransaction(transaction: AccountingPnlTransactionRow) {
  const category = relatedAccountingCategory(transaction);
  if (!category || category.pnl_section !== 'revenue' || transaction.status === 'excluded') return false;
  const amountCents = normalizeAccountingNumber(transaction.amount_cents);
  if (amountCents >= 0) return false;
  const text = [
    transaction.account_name,
    transaction.merchant_name,
    transaction.original_description,
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes('shopify') || text.includes('shop pay');
}

function activeProductionRunRatio(run: ProductionRunLaborRow) {
  if (run.status === 'void') return 0;
  const quantityProduced = normalizeAccountingNumber(run.quantity_produced);
  if (quantityProduced <= 0) return run.status === 'partially_voided' ? 0 : 1;
  const quantityVoided = normalizeAccountingNumber(run.quantity_voided);
  return Math.max(0, Math.min(1, (quantityProduced - quantityVoided) / quantityProduced));
}

export function productionLaborCogsForRuns(runs: ProductionRunLaborRow[]) {
  return Math.round(runs.reduce((sum, run) => (
    sum + normalizeAccountingNumber(run.actual_labor_cost_cents) * activeProductionRunRatio(run)
  ), 0));
}

function accountingLaborBucket(workType: AccountingLaborWorkType): 'admin' | 'other' | 'owner' | 'production' | 'sales' {
  if (workType === 'production') return 'production';
  if (workType === 'sales') return 'sales';
  if (workType === 'owner') return 'owner';
  if (workType === 'admin') return 'admin';
  return 'other';
}

function addLaborAmount(
  totalsByWorkType: Map<AccountingLaborWorkType, number>,
  workType: AccountingLaborWorkType,
  amountCents: number,
) {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return;
  totalsByWorkType.set(workType, (totalsByWorkType.get(workType) ?? 0) + Math.round(amountCents));
}

export function buildAccountingLaborSummary({
  allocations,
  salaryPayments,
  timeEntries,
}: {
  allocations: AccountingPayrollAllocationRow[];
  salaryPayments: AccountingSalaryPaymentRow[];
  timeEntries: AccountingPayrollTimeEntryRow[];
}): AccountingLaborSummary {
  const totalsByWorkType = new Map<AccountingLaborWorkType, number>();
  const allocationsByEntry = new Map<string, AccountingPayrollAllocationRow[]>();

  for (const allocation of allocations) {
    const rows = allocationsByEntry.get(allocation.time_entry_id) ?? [];
    rows.push(allocation);
    allocationsByEntry.set(allocation.time_entry_id, rows);
  }

  for (const entry of timeEntries) {
    if (entry.status === 'void' || !entry.clock_out_at) continue;
    const entryAllocations = allocationsByEntry.get(entry.id) ?? [];
    if (entryAllocations.length) {
      for (const allocation of entryAllocations) {
        addLaborAmount(
          totalsByWorkType,
          normalizeWorkType(allocation.work_type),
          normalizeMoneyCents(allocation.wage_cents),
        );
      }
      continue;
    }

    const minutes = paidMinutes(entry, entry.admin_time_breaks ?? []);
    addLaborAmount(
      totalsByWorkType,
      normalizeWorkType(entry.work_type),
      wageCentsForMinutes(minutes, entry.hourly_rate_cents_snapshot),
    );
  }

  for (const payment of salaryPayments) {
    if (!payment.paid_at) continue;
    addLaborAmount(
      totalsByWorkType,
      normalizeSalaryLaborWorkType(payment.salary_labor_work_type),
      normalizeMoneyCents(payment.salary_pay_cents),
    );
  }

  let adminSalariesCents = 0;
  let otherSalariesCents = 0;
  let ownerSalariesCents = 0;
  let productionLaborCogsCents = 0;
  let salesSalariesCents = 0;
  let totalLaborCents = 0;

  for (const [workType, amountCents] of totalsByWorkType.entries()) {
    totalLaborCents += amountCents;
    const bucket = accountingLaborBucket(workType);
    if (bucket === 'production') productionLaborCogsCents += amountCents;
    if (bucket === 'sales') salesSalariesCents += amountCents;
    if (bucket === 'admin') adminSalariesCents += amountCents;
    if (bucket === 'owner') ownerSalariesCents += amountCents;
    if (bucket === 'other') otherSalariesCents += amountCents;
  }

  const workTypeOrder: AccountingLaborWorkType[] = [
    'production',
    'sales',
    'admin',
    'owner',
    'packing',
    'receiving',
    'shipping',
    'cleaning',
    'other',
    'unassigned',
  ];
  const byWorkType = Array.from(totalsByWorkType.entries())
    .map(([workType, amountCents]) => ({
      amountCents,
      label: workType === 'owner' ? salaryLaborWorkTypeLabel(workType) : workTypeLabel(workType),
      workType,
    }))
    .sort((left, right) => workTypeOrder.indexOf(left.workType) - workTypeOrder.indexOf(right.workType));

  return {
    adminSalariesCents,
    byWorkType,
    otherSalariesCents,
    ownerSalariesCents,
    productionLaborCogsCents,
    salesSalariesCents,
    totalLaborCents,
  };
}

function isPayrollOperatingExpenseCategory(category: AccountingCategoryRow) {
  return category.pnl_section === 'operating_expenses' && PAYROLL_CATEGORY_PATTERN.test(category.name);
}

function transactionLabel(transaction: AccountingPnlTransactionRow) {
  return String(transaction.merchant_name || transaction.original_description || 'Accounting transaction').trim();
}

function transactionAccountLabel(transaction: AccountingPnlTransactionRow) {
  return String(transaction.account_name || transaction.account_type || '').trim();
}

function statementTransaction(
  transaction: AccountingPnlTransactionRow,
  amountCents: number,
): AccountingPnlStatementTransaction {
  return {
    accountName: transactionAccountLabel(transaction),
    amountCents: Math.round(amountCents),
    date: transaction.transaction_date,
    description: transactionLabel(transaction),
    id: String(transaction.id || `${transaction.transaction_date}-${transactionLabel(transaction)}-${amountCents}`),
  };
}

function sortStatementTransactions(rows: AccountingPnlStatementTransaction[]) {
  return rows.sort((left, right) => (
    right.date.localeCompare(left.date)
    || Math.abs(right.amountCents) - Math.abs(left.amountCents)
    || left.description.localeCompare(right.description)
  ));
}

function revenueDetailRows(transactions: AccountingPnlTransactionRow[]) {
  const retailTransactions: AccountingPnlStatementTransaction[] = [];
  const wholesaleTransactions: AccountingPnlStatementTransaction[] = [];

  for (const transaction of transactions) {
    const category = relatedAccountingCategory(transaction);
    if (!category || category.pnl_section !== 'revenue' || transaction.status === 'excluded') continue;
    const amountCents = -normalizeAccountingNumber(transaction.amount_cents);
    if (!amountCents) continue;
    if (isShopifyDepositTransaction(transaction)) {
      retailTransactions.push(statementTransaction(transaction, amountCents));
    } else {
      wholesaleTransactions.push(statementTransaction(transaction, amountCents));
    }
  }

  const wholesaleTotal = wholesaleTransactions.reduce((sum, row) => sum + row.amountCents, 0);
  const retailTotal = retailTransactions.reduce((sum, row) => sum + row.amountCents, 0);

  return [
    {
      id: 'wholesale_sales',
      label: 'Wholesale Sales',
      totalCents: wholesaleTotal,
      transactions: sortStatementTransactions(wholesaleTransactions),
    },
    {
      id: 'retail_sales',
      label: 'Retail Sales',
      totalCents: retailTotal,
      transactions: sortStatementTransactions(retailTransactions),
    },
  ].filter((row) => row.totalCents !== 0 || row.transactions.length > 0);
}

function categoryDetailRows({
  categories,
  section,
  transactions,
}: {
  categories: AccountingCategoryRow[];
  section: AccountingPnlSection;
  transactions: AccountingPnlTransactionRow[];
}) {
  return categories
    .filter((category) => category.pnl_section === section)
    .map((category) => {
      const detailTransactions = transactions
        .filter((transaction) => transaction.category_id === category.id && transaction.status !== 'excluded')
        .map((transaction) => statementTransaction(
          transaction,
          accountingCategoryAmountForPnlSection(transaction, category),
        ))
        .filter((transaction) => transaction.amountCents !== 0);

      return {
        id: category.id,
        label: category.name,
        totalCents: detailTransactions.reduce((sum, transaction) => sum + transaction.amountCents, 0),
        transactions: sortStatementTransactions(detailTransactions),
      };
    })
    .filter((row) => row.totalCents !== 0 || row.transactions.length > 0)
    .sort((left, right) => Math.abs(right.totalCents) - Math.abs(left.totalCents) || left.label.localeCompare(right.label));
}

export function buildAccountingPnlStatement({
  categories,
  payrollAllocations = [],
  payrollSalaryPayments = [],
  payrollTimeEntries = [],
  productionRuns = [],
  transactions,
}: {
  categories: AccountingCategoryRow[];
  payrollAllocations?: AccountingPayrollAllocationRow[];
  payrollSalaryPayments?: AccountingSalaryPaymentRow[];
  payrollTimeEntries?: AccountingPayrollTimeEntryRow[];
  productionRuns?: ProductionRunLaborRow[];
  transactions: AccountingPnlTransactionRow[];
}): AccountingPnlStatement {
  const basePnl = buildAccountingPnlTotals({ transactions });
  const payrollLaborSummary = buildAccountingLaborSummary({
    allocations: payrollAllocations,
    salaryPayments: payrollSalaryPayments,
    timeEntries: payrollTimeEntries,
  });
  const productionRunLaborCogsCents = productionLaborCogsForRuns(productionRuns);
  const laborCogsCents = payrollLaborSummary.productionLaborCogsCents || productionRunLaborCogsCents;
  const laborCogsSourceLabel = payrollLaborSummary.productionLaborCogsCents > 0
    ? 'Payroll production-tagged labor'
    : 'Production run labor estimate';
  const salesAdminOtherLaborCents = payrollLaborSummary.salesSalariesCents
    + payrollLaborSummary.adminSalariesCents
    + payrollLaborSummary.ownerSalariesCents
    + payrollLaborSummary.otherSalariesCents;
  const payrollOperatingExpenseCents = transactions
    .filter((transaction) => {
      const category = relatedAccountingCategory(transaction);
      return category ? isPayrollOperatingExpenseCategory(category) : false;
    })
    .reduce((sum, transaction) => sum + Math.max(0, normalizeAccountingNumber(transaction.amount_cents)), 0);
  const laborReclassCents = Math.min(laborCogsCents, payrollOperatingExpenseCents);
  const adjustedPnl: AccountingPnlAdjustedTotals = {
    cogsCents: basePnl.cardCogsCents + laborCogsCents,
    grossProfitCents: basePnl.revenueCents - basePnl.cardCogsCents - laborCogsCents,
    netIncomeCents: 0,
    operatingExpenseCents: Math.max(0, basePnl.cardOperatingExpenseCents - laborReclassCents),
    operatingIncomeCents: 0,
  };
  adjustedPnl.operatingIncomeCents = adjustedPnl.grossProfitCents - adjustedPnl.operatingExpenseCents;
  adjustedPnl.netIncomeCents = adjustedPnl.operatingIncomeCents + basePnl.otherIncomeCents - basePnl.otherExpenseCents;

  const retailSalesCents = transactions
    .filter(isShopifyDepositTransaction)
    .reduce((sum, transaction) => sum + -normalizeAccountingNumber(transaction.amount_cents), 0);
  const wholesaleSalesCents = basePnl.revenueCents - retailSalesCents;

  const detailSections = ACCOUNTING_PNL_DETAIL_SECTIONS.map((section) => ({
    ...section,
    rows: section.id === 'revenue'
      ? revenueDetailRows(transactions)
      : categoryDetailRows({ categories, section: section.id, transactions }),
  })).filter((section) => section.rows.length > 0);

  const categoryBreakdown = ACCOUNTING_PNL_DETAIL_SECTIONS.map((section) => ({
    ...section,
    rows: section.id === 'revenue'
      ? [
        { id: 'wholesale_sales', label: 'Wholesale Sales', totalCents: wholesaleSalesCents, transactions: [] },
        { id: 'retail_sales', label: 'Retail Sales', totalCents: retailSalesCents, transactions: [] },
      ].filter((row) => row.totalCents !== 0)
      : categoryDetailRows({ categories, section: section.id, transactions }).map((row) => ({
        ...row,
        transactions: [],
      })),
  })).filter((section) => section.rows.length > 0);

  const needsReviewCount = transactions.filter((transaction) => transaction.status === 'needs_review').length;
  const aiFlaggedCount = transactions.filter((transaction) => (
    Array.isArray(transaction.ai_review_flags) && transaction.ai_review_flags.some(isStandaloneAccountingFlag)
  )).length;

  return {
    adjustedPnl,
    aiFlaggedCount,
    basePnl,
    categoryBreakdown,
    detailSections,
    laborCogsCents,
    laborCogsSourceLabel,
    laborReclassCents,
    needsReviewCount,
    payrollLaborSummary,
    payrollOperatingExpenseCents,
    productionRunLaborCogsCents,
    retailSalesCents,
    salesAdminOtherLaborCents,
    wholesaleSalesCents,
  };
}
