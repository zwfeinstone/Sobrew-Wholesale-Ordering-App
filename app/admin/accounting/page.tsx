import Link from 'next/link';
import { redirect } from 'next/navigation';
import AccountingBulkSelectionControls from '@/components/accounting-bulk-selection-controls';
import AccountingBudgetSimulator from '@/components/accounting-budget-simulator';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import {
  ACCOUNTING_ACCOUNT_TYPES,
  AI_ACCOUNTING_REVIEW_PROMPT_VERSION,
  accountingAccountTypeLabel,
  accountingStatusLabel,
  accountingTransactionFingerprint,
  accountingTransactionFingerprintForOccurrence,
  buildAccountingPnlTotals,
  centsFromAccountingInput,
  generateAiAccountingReview,
  isAccountingAccountType,
  normalizeAccountingNumber,
  parseAccountingCsv,
  type AiAccountingReviewCandidate,
  type AccountingAccountType,
  type AccountingCategoryRow,
  type AccountingPnlSection,
  type AccountingTransactionRow,
  type ParsedAccountingTransaction,
} from '@/lib/accounting';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

const REVIEW_PAGE_SIZE = 12;
const PNL_TRANSACTION_LIMIT = 5000;
const BUDGET_TRANSACTION_PAGE_SIZE = 1000;
const BULK_ACCOUNTING_REVIEW_FORM_ID = 'bulk-accounting-review-form';
const ACCOUNTING_VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'upload', label: 'Upload' },
  { id: 'budgeting', label: 'Budgeting' },
  { id: 'simulator', label: 'Simulator' },
  { id: 'review', label: 'Review Transactions' },
  { id: 'pnl', label: 'P&L' },
  { id: 'categories', label: 'Categories' },
  { id: 'imports', label: 'Imports' },
] as const;

type AccountingView = (typeof ACCOUNTING_VIEWS)[number]['id'];

type SearchParams = Record<string, string | string[] | undefined>;

const PNL_DETAIL_SECTIONS = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'cogs', label: 'COGS' },
  { id: 'operating_expenses', label: 'Operating Expenses' },
  { id: 'other_income', label: 'Other Income' },
  { id: 'other_expenses', label: 'Other Expenses' },
] as const;

const BUDGET_PNL_SECTION_LABELS: Record<AccountingPnlSection, string> = {
  cogs: 'COGS',
  none: 'No P&L',
  operating_expenses: 'Operating Expenses',
  other_expenses: 'Other Expenses',
  other_income: 'Other Income',
  revenue: 'Revenue',
};

const BUDGET_PNL_SECTIONS: Array<Exclude<AccountingPnlSection, 'none'>> = [
  'revenue',
  'cogs',
  'operating_expenses',
  'other_income',
  'other_expenses',
];

type LastKnownAccountingTransaction = {
  account_name: string | null;
  account_type: AccountingAccountType | string;
  amount_cents: number | string;
  created_at: string | null;
  merchant_name: string | null;
  original_description: string;
  transaction_date: string;
};

type BudgetTransactionRow = AccountingTransactionRow & {
  account_name: string | null;
  account_type: AccountingAccountType | string;
  accounting_categories?: AccountingCategoryRow | AccountingCategoryRow[] | null;
  id: string;
  merchant_name: string | null;
  original_description: string;
};

type BudgetCategoryPlan = {
  allTimeAverageCents: number;
  currentActualCents: number;
  currentProjectedCents: number;
  id: string;
  name: string;
  remainingCents: number;
  section: AccountingPnlSection;
  sectionLabel: string;
  suggestedLimitCents: number;
  trailingAverageCents: number;
};

type BudgetSectionSummary = {
  cogsCents: number;
  operatingExpensesCents: number;
  otherExpensesCents: number;
  otherIncomeCents: number;
  revenueCents: number;
};

type BudgetMonthSummary = BudgetSectionSummary & {
  month: string;
};

type BudgetSimulatorLine = {
  amountCents: number;
  id: string;
  name: string;
  section: 'revenue' | 'cogs' | 'operating_expenses' | 'other_income' | 'other_expenses';
};

function accountingHref(
  toast: string,
  options: {
    count?: number;
    end?: string;
    start?: string;
    view?: AccountingView;
  } = {},
) {
  const params = new URLSearchParams();
  params.set('toast', toast);
  if (options.view) params.set('view', options.view);
  if (options.start) params.set('start', options.start);
  if (options.end) params.set('end', options.end);
  if (typeof options.count === 'number') params.set('count', String(options.count));
  return `/admin/accounting?${params.toString()}`;
}

function accountingViewParam(value: string | string[] | undefined): AccountingView {
  return ACCOUNTING_VIEWS.some((view) => view.id === value) ? value as AccountingView : 'overview';
}

function positivePageParam(value: string | string[] | undefined) {
  const parsed = Number.parseInt(typeof value === 'string' ? value : '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function accountingViewHref({
  category,
  end,
  page,
  search,
  start,
  view,
}: {
  category?: string;
  end: string;
  page?: number;
  search?: string;
  start: string;
  view: AccountingView;
}) {
  const params = new URLSearchParams();
  params.set('view', view);
  params.set('start', start);
  params.set('end', end);
  if (category) params.set('category', category);
  if (search) params.set('q', search);
  if (page && page > 1) params.set('page', String(page));
  return `/admin/accounting?${params.toString()}`;
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function utcDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function firstDayOfCurrentYear() {
  return `${todayInput().slice(0, 4)}-01-01`;
}

function addOneDay(dateInput: string) {
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function firstDayOfNextMonth() {
  const today = new Date(`${todayInput()}T00:00:00.000Z`);
  return utcDateInput(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)));
}

function lastDayOfPreviousMonth() {
  const today = new Date(`${todayInput()}T00:00:00.000Z`);
  return utcDateInput(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)));
}

function lastDayOfCurrentMonth() {
  const today = new Date(`${todayInput()}T00:00:00.000Z`);
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'No date';
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date);
}

function money(value: unknown) {
  return usd(Math.round(normalizeAccountingNumber(value)));
}

function normalizeDateRange(searchParams?: SearchParams) {
  const start = typeof searchParams?.start === 'string' ? searchParams.start : firstDayOfCurrentYear();
  const end = typeof searchParams?.end === 'string' ? searchParams.end : todayInput();
  return { end, endExclusive: addOneDay(end), start };
}

function searchParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function reviewCategoryParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function supabaseIlikeValue(value: string) {
  return value.replace(/[,%]/g, ' ').trim();
}

function categoryLabel(category: AccountingCategoryRow | AccountingCategoryRow[] | null | undefined) {
  const row = Array.isArray(category) ? category[0] : category;
  return row?.name ?? 'Uncategorized';
}

function categoryAmountForPnlSection(transaction: any, category: AccountingCategoryRow) {
  const amountCents = normalizeAccountingNumber(transaction.amount_cents);
  if (category.pnl_section === 'revenue' || category.pnl_section === 'other_income') {
    return -amountCents;
  }
  if (category.pnl_section === 'cogs' || category.pnl_section === 'operating_expenses' || category.pnl_section === 'other_expenses') {
    return amountCents;
  }
  return 0;
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function monthLabel(value: string) {
  const date = new Date(`${value}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date);
}

function daysInMonth(value: string) {
  const [year, month] = value.split('-').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return 30;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function currentMonthProgress() {
  const today = new Date(`${todayInput()}T00:00:00.000Z`);
  return today.getUTCDate() / daysInMonth(todayInput().slice(0, 7));
}

function emptyBudgetSectionSummary(): BudgetSectionSummary {
  return {
    cogsCents: 0,
    operatingExpensesCents: 0,
    otherExpensesCents: 0,
    otherIncomeCents: 0,
    revenueCents: 0,
  };
}

function addToBudgetSection(summary: BudgetSectionSummary, section: AccountingPnlSection, amountCents: number) {
  if (section === 'revenue') summary.revenueCents += amountCents;
  if (section === 'cogs') summary.cogsCents += amountCents;
  if (section === 'operating_expenses') summary.operatingExpensesCents += amountCents;
  if (section === 'other_income') summary.otherIncomeCents += amountCents;
  if (section === 'other_expenses') summary.otherExpensesCents += amountCents;
}

function budgetSummaryValue(summary: BudgetSectionSummary, section: AccountingPnlSection) {
  if (section === 'revenue') return summary.revenueCents;
  if (section === 'cogs') return summary.cogsCents;
  if (section === 'operating_expenses') return summary.operatingExpensesCents;
  if (section === 'other_income') return summary.otherIncomeCents;
  if (section === 'other_expenses') return summary.otherExpensesCents;
  return 0;
}

function averageBudgetSection(months: string[], summaries: Map<string, BudgetSectionSummary>, section: AccountingPnlSection) {
  if (!months.length) return 0;
  return Math.round(months.reduce((sum, month) => (
    sum + budgetSummaryValue(summaries.get(month) ?? emptyBudgetSectionSummary(), section)
  ), 0) / months.length);
}

function averageCategoryAmount(months: string[], categoryMonthlyTotals: Map<string, number>) {
  if (!months.length) return 0;
  return Math.round(months.reduce((sum, month) => sum + (categoryMonthlyTotals.get(month) ?? 0), 0) / months.length);
}

function budgetHealthTone(plan: BudgetCategoryPlan) {
  if (plan.suggestedLimitCents <= 0) return 'text-slate-500';
  if (plan.currentProjectedCents > plan.suggestedLimitCents) return 'text-rose-700';
  if (plan.currentProjectedCents > plan.suggestedLimitCents * 0.85) return 'text-amber-700';
  return 'text-emerald-700';
}

function buildBudgetWorkspace(transactions: BudgetTransactionRow[]) {
  const currentMonth = todayInput().slice(0, 7);
  const progress = Math.max(currentMonthProgress(), 1 / 31);
  const categoryStats = new Map<string, {
    category: AccountingCategoryRow;
    currentActualCents: number;
    monthlyTotals: Map<string, number>;
    totalCents: number;
  }>();
  const monthlySummaries = new Map<string, BudgetSectionSummary>();

  for (const transaction of transactions) {
    if (transaction.status === 'excluded') continue;
    const category = relatedOne(transaction.accounting_categories);
    if (!category || category.pnl_section === 'none') continue;
    const amountCents = categoryAmountForPnlSection(transaction, category);
    const rowMonth = monthKey(transaction.transaction_date);
    const summary = monthlySummaries.get(rowMonth) ?? emptyBudgetSectionSummary();
    addToBudgetSection(summary, category.pnl_section, amountCents);
    monthlySummaries.set(rowMonth, summary);

    const stats = categoryStats.get(category.id) ?? {
      category,
      currentActualCents: 0,
      monthlyTotals: new Map<string, number>(),
      totalCents: 0,
    };
    stats.totalCents += amountCents;
    stats.monthlyTotals.set(rowMonth, (stats.monthlyTotals.get(rowMonth) ?? 0) + amountCents);
    if (rowMonth === currentMonth) stats.currentActualCents += amountCents;
    categoryStats.set(category.id, stats);
  }

  const allMonths = Array.from(monthlySummaries.keys()).sort();
  const completedMonths = allMonths.filter((month) => month < currentMonth);
  const baselineMonths = completedMonths.length ? completedMonths : allMonths;
  const trailingMonths = baselineMonths.slice(-3);
  const baselineMonthCount = Math.max(baselineMonths.length, 1);
  const trailingRevenueCents = averageBudgetSection(trailingMonths, monthlySummaries, 'revenue');
  const allTimeRevenueCents = averageBudgetSection(baselineMonths, monthlySummaries, 'revenue');
  const projectedRevenueCents = Math.max(trailingRevenueCents, allTimeRevenueCents);
  const trailingCogsCents = averageBudgetSection(trailingMonths, monthlySummaries, 'cogs');
  const trailingOperatingExpensesCents = averageBudgetSection(trailingMonths, monthlySummaries, 'operating_expenses');
  const trailingOtherIncomeCents = averageBudgetSection(trailingMonths, monthlySummaries, 'other_income');
  const trailingOtherExpensesCents = averageBudgetSection(trailingMonths, monthlySummaries, 'other_expenses');
  const cogsRatio = projectedRevenueCents > 0 ? trailingCogsCents / projectedRevenueCents : 0;
  const plannedCogsCents = projectedRevenueCents > 0
    ? Math.round(projectedRevenueCents * Math.min(Math.max(cogsRatio, 0.25), 0.65))
    : trailingCogsCents;
  const targetProfitCents = Math.round(projectedRevenueCents * 0.12);
  const cashReserveCents = Math.round(projectedRevenueCents * 0.08);
  const availableOperatingSpendCents = Math.max(
    0,
    projectedRevenueCents + trailingOtherIncomeCents - plannedCogsCents - trailingOtherExpensesCents - targetProfitCents - cashReserveCents,
  );
  const plannedOperatingSpendCents = trailingOperatingExpensesCents > 0
    ? Math.min(trailingOperatingExpensesCents, availableOperatingSpendCents)
    : availableOperatingSpendCents;

  const categoryPlans: BudgetCategoryPlan[] = Array.from(categoryStats.values()).map((stats) => {
    const section = stats.category.pnl_section;
    const trailingAverageCents = averageCategoryAmount(trailingMonths, stats.monthlyTotals);
    const allTimeAverageCents = Math.round(stats.totalCents / baselineMonthCount);
    let suggestedLimitCents = Math.max(trailingAverageCents, allTimeAverageCents);

    if (section === 'cogs' && trailingCogsCents > 0) {
      suggestedLimitCents = Math.round((trailingAverageCents / trailingCogsCents) * plannedCogsCents);
    }
    if (section === 'operating_expenses' && trailingOperatingExpensesCents > 0) {
      suggestedLimitCents = Math.round((trailingAverageCents / trailingOperatingExpensesCents) * plannedOperatingSpendCents);
    }
    if (section === 'other_expenses' && allTimeAverageCents > 0) {
      suggestedLimitCents = Math.min(trailingAverageCents, allTimeAverageCents);
    }

    suggestedLimitCents = Math.max(0, suggestedLimitCents);
    const currentActualCents = Math.max(0, stats.currentActualCents);
    const currentProjectedCents = Math.round(currentActualCents / progress);

    return {
      allTimeAverageCents,
      currentActualCents,
      currentProjectedCents,
      id: stats.category.id,
      name: stats.category.name,
      remainingCents: suggestedLimitCents - currentActualCents,
      section,
      sectionLabel: BUDGET_PNL_SECTION_LABELS[section],
      suggestedLimitCents,
      trailingAverageCents,
    };
  }).filter((plan) => BUDGET_PNL_SECTIONS.includes(plan.section as Exclude<AccountingPnlSection, 'none'>));

  categoryPlans.sort((left, right) => (
    BUDGET_PNL_SECTIONS.indexOf(left.section as Exclude<AccountingPnlSection, 'none'>)
    - BUDGET_PNL_SECTIONS.indexOf(right.section as Exclude<AccountingPnlSection, 'none'>)
  ) || right.suggestedLimitCents - left.suggestedLimitCents);

  const monthlyHistory: BudgetMonthSummary[] = baselineMonths.slice(-6).reverse().map((month) => ({
    ...emptyBudgetSectionSummary(),
    ...(monthlySummaries.get(month) ?? {}),
    month,
  }));

  const simulatorLines: BudgetSimulatorLine[] = categoryPlans
    .filter((plan) => plan.suggestedLimitCents > 0)
    .map((plan) => ({
      amountCents: plan.suggestedLimitCents,
      id: plan.id,
      name: plan.name,
      section: plan.section as BudgetSimulatorLine['section'],
    }));

  const recommendedNetIncomeCents = projectedRevenueCents - plannedCogsCents - plannedOperatingSpendCents + trailingOtherIncomeCents - trailingOtherExpensesCents;
  const budgetRangeLabel = baselineMonths.length
    ? `${monthLabel(baselineMonths[0])} through ${monthLabel(baselineMonths[baselineMonths.length - 1])}`
    : 'No completed months yet';

  return {
    budgetRangeLabel,
    categoryPlans,
    monthlyHistory,
    simulatorLines,
    summary: {
      availableOperatingSpendCents,
      baselineMonthCount: baselineMonths.length,
      cashReserveCents,
      plannedCogsCents,
      plannedOperatingSpendCents,
      projectedRevenueCents,
      recommendedNetIncomeCents,
      targetProfitCents,
      trailingCogsCents,
      trailingOperatingExpensesCents,
      trailingOtherExpensesCents,
      trailingOtherIncomeCents,
    },
  };
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function accountingCategoryImportKey(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function transactionTone(status: string) {
  if (status === 'needs_review') return 'bg-amber-50 text-amber-800 ring-amber-100';
  if (status === 'excluded') return 'bg-slate-100 text-slate-700 ring-slate-200';
  return 'bg-teal-50 text-teal-700 ring-teal-100';
}

function aiReviewTone(status: string | null | undefined) {
  if (status === 'flagged') return 'bg-rose-50 text-rose-700 ring-rose-100';
  if (status === 'clean') return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  if (status === 'error') return 'bg-amber-50 text-amber-800 ring-amber-100';
  return 'bg-slate-100 text-slate-700 ring-slate-200';
}

function aiReviewLabel(status: string | null | undefined) {
  if (status === 'flagged') return 'AI Flagged';
  if (status === 'clean') return 'AI Clean';
  if (status === 'error') return 'AI Error';
  return 'Not AI Reviewed';
}

function aiFlagActionLabel(value: string | null | undefined) {
  if (value === 'categorize') return 'Categorize';
  if (value === 'exclude') return 'Exclude';
  if (value === 'split') return 'Split';
  if (value === 'verify_vendor') return 'Verify vendor';
  return 'Review';
}

function isStandaloneAccountingFlag(flag: any) {
  return flag?.flagType !== 'inventory_overlap' && flag?.recommendedAction !== 'approve_inventory_match';
}

function transactionSummary(transaction: LastKnownAccountingTransaction | null) {
  if (!transaction) return 'No transactions uploaded yet.';
  return transaction.merchant_name || transaction.original_description;
}

function uploadStartLabel(transaction: LastKnownAccountingTransaction | null) {
  if (!transaction) return 'Download full history for the first upload.';
  if (transaction.account_type === 'credit_card' && transaction.transaction_date.slice(0, 10) === lastDayOfPreviousMonth()) {
    return `Caught up through ${formatDate(transaction.transaction_date)}. Upload the next credit card file on ${formatDate(firstDayOfNextMonth())}.`;
  }
  return `Start the next download on ${formatDate(addOneDay(transaction.transaction_date))}.`;
}

function LastKnownTransactionCard({
  label,
  transaction,
}: {
  label: string;
  transaction: LastKnownAccountingTransaction | null;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-white/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-950">{transaction ? formatDate(transaction.transaction_date) : 'No date yet'}</p>
      <p className="mt-1 truncate text-sm font-medium text-slate-700">{transactionSummary(transaction)}</p>
      {transaction ? (
        <p className="mt-1 text-sm text-slate-500">
          {accountingAccountTypeLabel(transaction.account_type)}
          {transaction.account_name ? ` - ${transaction.account_name}` : ''}
          {' - '}
          {money(transaction.amount_cents)}
        </p>
      ) : null}
      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">{uploadStartLabel(transaction)}</p>
    </div>
  );
}

async function serverOpenAiApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;

  if (process.env.NODE_ENV !== 'production') {
    try {
      const { loadEnvConfig } = await import('@next/env');
      loadEnvConfig(process.cwd());
    } catch {
      // Keep the UI error friendly; do not expose local env loading details.
    }
  }

  return process.env.OPENAI_API_KEY;
}

function aiReviewErrorMessage(code: string | string[] | undefined) {
  if (code === 'missing_key') return 'AI review is not configured yet. Add the server-only OpenAI key and try again.';
  if (code === 'no_transactions') return 'No transactions in this range need AI review.';
  if (code === 'generation_failed') return 'AI review could not run right now. Please try again in a few minutes.';
  if (code === 'save_failed') return 'AI review ran, but the flags could not be saved.';
  return null;
}

async function fetchBudgetTransactions(supabase: Awaited<ReturnType<typeof createClient>>) {
  const rows: BudgetTransactionRow[] = [];

  for (let from = 0; ; from += BUDGET_TRANSACTION_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('accounting_transactions')
      .select('id,transaction_date,account_name,account_type,merchant_name,original_description,amount_cents,status,category_id,accounting_categories(id,name,category_type,pnl_section)')
      .in('status', ['needs_review', 'categorized'])
      .order('transaction_date', { ascending: true })
      .range(from, from + BUDGET_TRANSACTION_PAGE_SIZE - 1);

    if (error || !data?.length) break;
    rows.push(...((data ?? []) as BudgetTransactionRow[]));
    if (data.length < BUDGET_TRANSACTION_PAGE_SIZE) break;
  }

  return rows;
}

function AccountingNav({
  activeView,
  end,
  start,
}: {
  activeView: AccountingView;
  end: string;
  start: string;
}) {
  return (
    <section className="card">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-8">
        {ACCOUNTING_VIEWS.map((view) => (
          <Link
            key={view.id}
            href={accountingViewHref({ end, start, view: view.id })}
            className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-all duration-200 ${
              activeView === view.id
                ? 'border-teal-200 bg-teal-50 text-teal-900'
                : 'border-slate-200 bg-white/70 text-slate-700 hover:border-teal-200 hover:text-teal-800'
            }`}
          >
            {view.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

async function uploadAccountingCsv(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(accountingHref('admin_write_denied'), 'accounting');

  const supabase = await createClient();
  const file = formData.get('file');
  const rawAccountType = String(formData.get('account_type') ?? 'other');
  const accountType: AccountingAccountType = isAccountingAccountType(rawAccountType) ? rawAccountType : 'other';
  const rawAmountSign = String(formData.get('amount_sign') ?? 'auto');
  const amountSign = rawAmountSign === 'money_out_positive' || rawAmountSign === 'money_out_negative' ? rawAmountSign : 'auto';
  const accountName = String(formData.get('account_name') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  if (!file || typeof file === 'string' || typeof (file as File).text !== 'function') {
    redirect(accountingHref('upload_error'));
  }

  let parsed: ParsedAccountingTransaction[];
  try {
    parsed = parseAccountingCsv({
      accountName,
      accountType,
      amountSign,
      content: await (file as File).text(),
    });
  } catch {
    redirect(accountingHref('upload_error'));
  }

  if (!parsed.length) redirect(accountingHref('upload_empty'));

  const current = await requireAdminSectionView('accounting');
  const { data: categories } = await supabase
    .from('accounting_categories')
    .select('id,name,category_type,pnl_section')
    .eq('active', true);
  const categoryByName = new Map(
    ((categories ?? []) as AccountingCategoryRow[]).map((category) => [accountingCategoryImportKey(category.name), category]),
  );
  const outflowCents = parsed.reduce((sum, row) => sum + Math.max(0, row.amountCents), 0);
  const inflowCents = parsed.reduce((sum, row) => sum + Math.max(0, -row.amountCents), 0);
  const uploadStart = parsed.reduce((earliest, row) => row.transactionDate < earliest ? row.transactionDate : earliest, parsed[0]?.transactionDate ?? todayInput());
  const uploadEnd = parsed.reduce((latest, row) => row.transactionDate > latest ? row.transactionDate : latest, parsed[0]?.transactionDate ?? todayInput());

  const { data: batch, error: batchError } = await supabase
    .from('accounting_upload_batches')
    .insert({
      source_type: 'csv',
      account_name: accountName,
      account_type: accountType,
      file_name: (file as File).name || null,
      uploaded_by: current.profile.id,
      transaction_count: parsed.length,
      total_outflow_cents: outflowCents,
      total_inflow_cents: inflowCents,
      notes,
    })
    .select('id')
    .single();

  if (batchError || !batch) redirect(accountingHref('upload_error'));

  const fingerprintOccurrences = new Map<string, number>();
  const rows = parsed.map((transaction) => {
    const baseFingerprint = accountingTransactionFingerprint(transaction);
    const occurrence = (fingerprintOccurrences.get(baseFingerprint) ?? 0) + 1;
    fingerprintOccurrences.set(baseFingerprint, occurrence);
    const fingerprint = accountingTransactionFingerprintForOccurrence(baseFingerprint, occurrence);
    const category = categoryByName.get(accountingCategoryImportKey(transaction.categoryName)) ?? null;
    return {
      upload_batch_id: batch.id,
      source_type: 'csv',
      account_name: transaction.accountName,
      account_type: transaction.accountType,
      transaction_date: transaction.transactionDate,
      merchant_name: transaction.merchantName,
      original_description: transaction.originalDescription,
      amount_cents: transaction.amountCents,
      category_id: category?.id ?? null,
      status: category
        ? category.category_type === 'excluded' ? 'excluded' : 'categorized'
        : 'needs_review',
      transaction_fingerprint: fingerprint,
    };
  });

  const { data: inserted, error } = await supabase
    .from('accounting_transactions')
    .upsert(rows, { ignoreDuplicates: true, onConflict: 'transaction_fingerprint' })
    .select('id,transaction_fingerprint');

  if (error) redirect(accountingHref('upload_error'));

  redirect(accountingHref(inserted?.length ? 'upload_saved' : 'upload_duplicates', {
    count: inserted?.length ?? 0,
    end: uploadEnd,
    start: uploadStart,
    view: inserted?.length ? 'imports' : 'review',
  }));
}

async function addManualTransaction(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(accountingHref('admin_write_denied'), 'accounting');

  const supabase = await createClient();
  const rawAccountType = String(formData.get('account_type') ?? 'manual');
  const accountType: AccountingAccountType = isAccountingAccountType(rawAccountType) ? rawAccountType : 'manual';
  const transaction: ParsedAccountingTransaction = {
    accountName: String(formData.get('account_name') ?? '').trim() || null,
    accountType,
    amountCents: centsFromAccountingInput(String(formData.get('amount') ?? '0')),
    merchantName: String(formData.get('merchant_name') ?? '').trim() || null,
    originalDescription: String(formData.get('description') ?? '').trim(),
    transactionDate: String(formData.get('transaction_date') ?? '') || todayInput(),
  };

  if (!transaction.amountCents || !transaction.originalDescription || !transaction.transactionDate) {
    redirect(accountingHref('manual_error'));
  }

  const current = await requireAdminSectionView('accounting');
  const { data: batch } = await supabase
    .from('accounting_upload_batches')
    .insert({
      source_type: 'manual',
      account_name: transaction.accountName,
      account_type: accountType,
      uploaded_by: current.profile.id,
      transaction_count: 1,
      total_outflow_cents: Math.max(0, transaction.amountCents),
      total_inflow_cents: Math.max(0, -transaction.amountCents),
    })
    .select('id')
    .single();

  const fingerprint = accountingTransactionFingerprint(transaction);
  const { data: inserted, error } = await supabase
    .from('accounting_transactions')
    .upsert([{
      upload_batch_id: batch?.id ?? null,
      source_type: 'manual',
      account_name: transaction.accountName,
      account_type: accountType,
      transaction_date: transaction.transactionDate,
      merchant_name: transaction.merchantName,
      original_description: transaction.originalDescription,
      amount_cents: transaction.amountCents,
      transaction_fingerprint: fingerprint,
    }], { ignoreDuplicates: true, onConflict: 'transaction_fingerprint' })
    .select('id,transaction_fingerprint');

  if (error) redirect(accountingHref('manual_error'));

  redirect(accountingHref(inserted?.length ? 'manual_saved' : 'upload_duplicates'));
}

async function addAccountingCategory(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(accountingHref('admin_write_denied'), 'accounting');

  const supabase = await createClient();
  const name = String(formData.get('name') ?? '').trim();
  const categoryType = String(formData.get('category_type') ?? 'operating_expense');
  const pnlSection = String(formData.get('pnl_section') ?? 'operating_expenses');
  if (!name) redirect(accountingHref('category_error'));

  const { error } = await supabase.from('accounting_categories').insert({
    name,
    category_type: categoryType,
    pnl_section: pnlSection,
    is_system: false,
    display_order: 700,
  });

  redirect(accountingHref(error ? 'category_error' : 'category_saved'));
}

async function updateAccountingTransaction(formData: FormData) {
  'use server';
  const current = await requireAdminWriteAccess(accountingHref('admin_write_denied'), 'accounting');
  const supabase = await createClient();
  const transactionId = String(formData.get('transaction_id') ?? '').trim();
  const actionType = String(formData.get('action_type') ?? '');
  if (!transactionId) redirect(accountingHref('review_error'));

  if (actionType === 'categorize') {
    const categoryId = String(formData.get('category_id') ?? '').trim();
    if (!categoryId) redirect(accountingHref('review_error'));
    const { error } = await supabase
      .from('accounting_transactions')
      .update({
        category_id: categoryId,
        status: 'categorized',
        review_notes: String(formData.get('review_notes') ?? '').trim() || null,
        reviewed_by: current.profile.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transactionId);
    redirect(accountingHref(error ? 'review_error' : 'transaction_saved'));
  }

  if (actionType === 'exclude') {
    const { error } = await supabase
      .from('accounting_transactions')
      .update({
        status: 'excluded',
        review_notes: String(formData.get('review_notes') ?? '').trim() || 'Excluded from accounting reports',
        reviewed_by: current.profile.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transactionId);
    redirect(accountingHref(error ? 'review_error' : 'transaction_excluded'));
  }

  redirect(accountingHref('review_error'));
}

async function bulkUpdateAccountingTransactions(formData: FormData) {
  'use server';
  const current = await requireAdminWriteAccess(accountingHref('admin_write_denied'), 'accounting');
  const supabase = await createClient();
  const transactionIds = formData
    .getAll('transaction_id')
    .map((value) => String(value).trim())
    .filter(Boolean)
    .slice(0, REVIEW_PAGE_SIZE);
  const markAs = String(formData.get('mark_as') ?? '').trim();
  const note = String(formData.get('review_notes') ?? '').trim();

  if (!transactionIds.length || !markAs) redirect(accountingHref('review_error'));

  const reviewedAt = new Date().toISOString();
  const update: Record<string, unknown> = {
    reviewed_by: current.profile.id,
    reviewed_at: reviewedAt,
    updated_at: reviewedAt,
  };

  if (markAs === '__needs_review__') {
    update.category_id = null;
    update.status = 'needs_review';
    if (note) update.review_notes = note;
  } else if (markAs === '__exclude__') {
    update.category_id = null;
    update.status = 'excluded';
    update.review_notes = note || 'Bulk excluded from accounting reports';
  } else {
    const { data: category } = await supabase
      .from('accounting_categories')
      .select('id,category_type')
      .eq('id', markAs)
      .eq('active', true)
      .single();

    if (!category) redirect(accountingHref('review_error'));

    update.category_id = category.id;
    update.status = category.category_type === 'excluded' ? 'excluded' : 'categorized';
    if (note) update.review_notes = note;
  }

  const { error } = await supabase
    .from('accounting_transactions')
    .update(update)
    .in('id', transactionIds);

  redirect(accountingHref(error ? 'review_error' : 'transaction_saved'));
}

async function runAiAccountingReview(formData: FormData) {
  'use server';
  const current = await requireAdminWriteAccess(accountingHref('admin_write_denied'), 'accounting');
  const apiKey = await serverOpenAiApiKey();
  const start = String(formData.get('start') ?? '') || firstDayOfCurrentYear();
  const end = String(formData.get('end') ?? '') || todayInput();
  const endExclusive = addOneDay(end);

  if (!apiKey) redirect(`/admin/accounting?start=${start}&end=${end}&ai_error=missing_key`);

  const supabase = await createClient();
  const [{ data: transactions }, { data: categories }] = await Promise.all([
    supabase
      .from('accounting_transactions')
      .select('id,transaction_date,account_name,merchant_name,original_description,amount_cents,status,category_id,accounting_categories(name)')
      .gte('transaction_date', start)
      .lt('transaction_date', endExclusive)
      .in('status', ['needs_review', 'categorized'])
      .order('transaction_date', { ascending: false })
      .limit(50),
    supabase
      .from('accounting_categories')
      .select('name')
      .eq('active', true)
      .order('display_order', { ascending: true }),
  ]);

  const candidates = ((transactions ?? []) as any[]).map((transaction): AiAccountingReviewCandidate => ({
    accountName: transaction.account_name ?? null,
    amountCents: Math.round(normalizeAccountingNumber(transaction.amount_cents)),
    categoryName: categoryLabel(transaction.accounting_categories),
    description: transaction.original_description,
    existingStatus: transaction.status,
    id: transaction.id,
    merchantName: transaction.merchant_name ?? null,
    transactionDate: transaction.transaction_date,
  }));

  if (!candidates.length) redirect(`/admin/accounting?start=${start}&end=${end}&ai_error=no_transactions`);

  const categoryNames = ((categories ?? []) as Array<{ name: string | null }>).map((category) => category.name).filter((name): name is string => Boolean(name));
  let generated;
  const model = process.env.AI_ACCOUNTING_REVIEW_MODEL || process.env.AI_QA_MODEL || 'gpt-5.5';
  try {
    generated = await generateAiAccountingReview({
      apiKey,
      candidates,
      categoryNames,
      model,
    });
  } catch {
    redirect(`/admin/accounting?start=${start}&end=${end}&ai_error=generation_failed`);
  }

  const flagsByTransactionId = new Map<string, typeof generated.flags>();
  for (const flag of generated.flags) {
    flagsByTransactionId.set(flag.transactionId, [...(flagsByTransactionId.get(flag.transactionId) ?? []), flag]);
  }

  const reviewedAt = new Date().toISOString();
  const updates = await Promise.all(candidates.map((candidate) => {
    const flags = flagsByTransactionId.get(candidate.id) ?? [];
    return supabase
      .from('accounting_transactions')
      .update({
        ai_review_flags: flags,
        ai_review_model: generated.model,
        ai_review_prompt_version: AI_ACCOUNTING_REVIEW_PROMPT_VERSION,
        ai_review_status: flags.length ? 'flagged' : 'clean',
        ai_review_summary: flags.length
          ? flags.map((flag) => `${flag.flagType}: ${flag.reason}`).join('\n')
          : 'AI review found no exception flags.',
        ai_reviewed_at: reviewedAt,
        reviewed_by: current.profile.id,
        updated_at: reviewedAt,
      })
      .eq('id', candidate.id);
  }));

  if (updates.some((result) => result.error)) {
    redirect(`/admin/accounting?start=${start}&end=${end}&ai_error=save_failed`);
  }

  redirect(`/admin/accounting?start=${start}&end=${end}&toast=ai_review_saved`);
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  await requireAdminSectionView('accounting');
  const supabase = await createClient();
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const toastCount = Number.parseInt(typeof searchParams?.count === 'string' ? searchParams.count : '', 10);
  const uploadToastCount = Number.isFinite(toastCount) && toastCount > 0 ? toastCount : null;
  const activeView = accountingViewParam(searchParams?.view);
  const reviewPage = positivePageParam(searchParams?.page);
  const reviewFrom = (reviewPage - 1) * REVIEW_PAGE_SIZE;
  const reviewTo = reviewFrom + REVIEW_PAGE_SIZE - 1;
  const { end, endExclusive, start } = normalizeDateRange(searchParams);
  const reviewCategoryFilter = reviewCategoryParam(searchParams?.category);
  const reviewSearch = searchParam(searchParams?.q);
  const reviewSearchFilter = supabaseIlikeValue(reviewSearch);

  let transactionsQuery = supabase
    .from('accounting_transactions')
    .select('id,transaction_date,account_name,account_type,merchant_name,original_description,amount_cents,status,ai_review_status,ai_review_summary,ai_review_flags,ai_review_model,ai_reviewed_at,review_notes,category_id,accounting_categories(id,name,category_type,pnl_section)', { count: 'exact' })
    .gte('transaction_date', start)
    .lt('transaction_date', endExclusive);

  if (reviewCategoryFilter === '__uncategorized__') {
    transactionsQuery = transactionsQuery.is('category_id', null);
  } else if (reviewCategoryFilter) {
    transactionsQuery = transactionsQuery.eq('category_id', reviewCategoryFilter);
  }

  if (reviewSearchFilter) {
    transactionsQuery = transactionsQuery.or(`merchant_name.ilike.%${reviewSearchFilter}%,original_description.ilike.%${reviewSearchFilter}%,account_name.ilike.%${reviewSearchFilter}%`);
  }

  const [
    categoriesResult,
    transactionsResult,
    pnlTransactionsResult,
    batchesResult,
    latestBankTransactionResult,
    latestCreditCardTransactionResult,
    budgetTransactions,
  ] = await Promise.all([
    supabase.from('accounting_categories').select('id,name,category_type,pnl_section,active').eq('active', true).order('display_order', { ascending: true }).order('name', { ascending: true }),
    transactionsQuery
      .order('transaction_date', { ascending: false })
      .range(reviewFrom, reviewTo),
    supabase
      .from('accounting_transactions')
      .select('id,transaction_date,amount_cents,status,ai_review_status,category_id,accounting_categories(id,name,category_type,pnl_section)')
      .gte('transaction_date', start)
      .lt('transaction_date', endExclusive)
      .order('transaction_date', { ascending: false })
      .limit(PNL_TRANSACTION_LIMIT),
    supabase.from('accounting_upload_batches').select('id,source_type,account_name,account_type,file_name,transaction_count,total_outflow_cents,total_inflow_cents,created_at').order('created_at', { ascending: false }).limit(6),
    supabase
      .from('accounting_transactions')
      .select('account_name,account_type,transaction_date,merchant_name,original_description,amount_cents,created_at')
      .in('account_type', ['bank', 'debit_card'])
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('accounting_transactions')
      .select('account_name,account_type,transaction_date,merchant_name,original_description,amount_cents,created_at')
      .eq('account_type', 'credit_card')
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    fetchBudgetTransactions(supabase),
  ]);

  const categories = (categoriesResult.data ?? []) as AccountingCategoryRow[];
  const transactions = (transactionsResult.data ?? []) as any[];
  const latestBankTransaction = (latestBankTransactionResult.data ?? null) as LastKnownAccountingTransaction | null;
  const latestCreditCardTransaction = (latestCreditCardTransactionResult.data ?? null) as LastKnownAccountingTransaction | null;
  const budgetWorkspace = buildBudgetWorkspace(budgetTransactions);
  const monthEndDate = lastDayOfCurrentMonth();
  const transactionTotal = transactionsResult.count ?? transactions.length;
  const hasPreviousReviewPage = reviewPage > 1;
  const hasNextReviewPage = reviewFrom + transactions.length < transactionTotal;
  const pnlTransactions = (pnlTransactionsResult.data ?? []) as any[];
  const batches = batchesResult.data ?? [];
  const pnl = buildAccountingPnlTotals({
    transactions: pnlTransactions as any[],
  });

  const needsReviewCount = pnlTransactions.filter((transaction) => transaction.status === 'needs_review').length;
  const aiFlaggedCount = pnlTransactions.filter((transaction) => (
    Array.isArray(transaction.ai_review_flags) && transaction.ai_review_flags.some(isStandaloneAccountingFlag)
  )).length;
  const pnlCategoryBreakdown = PNL_DETAIL_SECTIONS.map((section) => ({
    ...section,
    rows: categories
      .filter((category) => category.pnl_section === section.id)
      .map((category) => ({
        category,
        totalCents: pnlTransactions
          .filter((transaction) => transaction.category_id === category.id && transaction.status === 'categorized')
          .reduce((sum, transaction) => sum + categoryAmountForPnlSection(transaction, category), 0),
      }))
      .filter((row) => row.totalCents > 0)
      .sort((left, right) => right.totalCents - left.totalCents),
  })).filter((section) => section.rows.length > 0);

  return (
    <div className="space-y-6">
      {toast === 'upload_saved' ? <StatusToast message={uploadToastCount ? `${uploadToastCount} new transactions uploaded.` : 'Transactions uploaded.'} tone="success" /> : null}
      {toast === 'upload_duplicates' ? <StatusToast message="Those transactions were already in accounting." tone="success" /> : null}
      {toast === 'upload_empty' ? <StatusToast message="No usable transactions found in that file." tone="error" /> : null}
      {toast === 'upload_error' ? <StatusToast message="Unable to upload that file." tone="error" /> : null}
      {toast === 'manual_saved' ? <StatusToast message="Manual transaction added." tone="success" /> : null}
      {toast === 'manual_error' ? <StatusToast message="Unable to add that transaction." tone="error" /> : null}
      {toast === 'category_saved' ? <StatusToast message="Accounting category added." tone="success" /> : null}
      {toast === 'category_error' ? <StatusToast message="Unable to add that category." tone="error" /> : null}
      {toast === 'transaction_saved' ? <StatusToast message="Transaction categorized." tone="success" /> : null}
      {toast === 'transaction_excluded' ? <StatusToast message="Transaction excluded from reports." tone="success" /> : null}
      {toast === 'ai_review_saved' ? <StatusToast message="AI review complete. Flagged transactions are marked in the review queue." tone="success" /> : null}
      {toast === 'review_error' ? <StatusToast message="Unable to update that transaction." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="Only admins with accounting access can make changes." tone="error" /> : null}
      {aiReviewErrorMessage(searchParams?.ai_error) ? <StatusToast message={aiReviewErrorMessage(searchParams?.ai_error) ?? ''} tone="error" /> : null}

      <section className="panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <span className="eyebrow">Accounting</span>
            <h1 className="page-title mt-4">Accounting workspace</h1>
            <p className="page-subtitle mt-3 max-w-3xl">Upload bank and card activity, review possible duplicates, and track the numbers that feed your P&amp;L.</p>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-end xl:w-auto">
            <form className="grid w-full min-w-0 gap-3 rounded-xl border border-slate-200 bg-white/60 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:w-auto" action="/admin/accounting">
              <input name="view" type="hidden" value={activeView} />
              {activeView === 'review' && reviewCategoryFilter ? <input name="category" type="hidden" value={reviewCategoryFilter} /> : null}
              {activeView === 'review' && reviewSearch ? <input name="q" type="hidden" value={reviewSearch} /> : null}
              <input className="input min-w-0" name="start" type="date" defaultValue={start} />
              <input className="input min-w-0" name="end" type="date" defaultValue={end} />
              <button className="btn-primary w-full sm:w-auto" type="submit">Update</button>
            </form>
            <form action={runAiAccountingReview} className="w-full rounded-xl border border-slate-200 bg-white/60 p-3 sm:w-auto">
              <input name="start" type="hidden" value={start} />
              <input name="end" type="hidden" value={end} />
              <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Run AI review" pendingLabel="Reviewing..." />
            </form>
          </div>
        </div>
      </section>

      <AccountingNav activeView={activeView} end={end} start={start} />

      <section className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 shadow-sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Month-end alert</span>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Reconcile accounting data by {formatDate(monthEndDate)}</h2>
          </div>
          <p className="max-w-2xl text-sm font-medium text-amber-900">
            Download each statement after the last uploaded transaction date below, then upload the new file so the accounting records do not overlap.
          </p>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <LastKnownTransactionCard label="Last known bank transaction recorded" transaction={latestBankTransaction} />
          <LastKnownTransactionCard label="Last known credit card transaction reported" transaction={latestCreditCardTransaction} />
        </div>
      </section>

      {activeView === 'overview' ? <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Revenue</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{money(pnl.revenueCents)}</p>
          <p className="mt-1 text-sm text-slate-500">Uploaded revenue</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Gross Profit</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{money(pnl.grossProfitCents)}</p>
          <p className="mt-1 text-sm text-slate-500">After uploaded COGS</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Net Income</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{money(pnl.netIncomeCents)}</p>
          <p className="mt-1 text-sm text-slate-500">Starter P&amp;L</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Review Queue</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{needsReviewCount}</p>
          <p className="mt-1 text-sm text-slate-500">Transactions in range</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">AI Flags</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{aiFlaggedCount}</p>
          <p className="mt-1 text-sm text-slate-500">Rows needing attention</p>
        </div>
      </section> : null}

      {activeView === 'upload' ? <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <form action={uploadAccountingCsv} className="card space-y-4">
          <div>
            <span className="eyebrow">Upload</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Import card or bank activity</h2>
            <p className="mt-2 text-sm text-slate-500">
              <a className="font-semibold text-teal-700 hover:text-teal-800" href="/accounting-transactions-template.csv" download>
                Download CSV template
              </a>
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <input className="input" name="account_name" placeholder="Sobrew debit, Amex, Chase Visa" />
            <select className="input" name="account_type" defaultValue="credit_card">
              {ACCOUNTING_ACCOUNT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </div>
          <input name="amount_sign" type="hidden" value="auto" />
          <p className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900">
            Purchase signs are detected automatically from the file.
          </p>
          <input className="input" name="file" type="file" accept=".csv,text/csv" required />
          <textarea className="input min-h-20" name="notes" placeholder="Batch notes" />
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Upload transactions" pendingLabel="Uploading..." />
        </form>

        <form action={addManualTransaction} className="card space-y-4">
          <div>
            <span className="eyebrow">Manual</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Add one transaction</h2>
          </div>
          <input className="input" name="transaction_date" type="date" defaultValue={todayInput()} />
          <input className="input" name="description" required placeholder="Description" />
          <input className="input" name="merchant_name" placeholder="Merchant" />
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" name="amount" required type="number" step="0.01" placeholder="Amount" />
            <select className="input" name="account_type" defaultValue="manual">
              {ACCOUNTING_ACCOUNT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </div>
          <input className="input" name="account_name" placeholder="Account name" />
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Add transaction" pendingLabel="Adding..." />
        </form>
      </section> : null}

      {activeView === 'budgeting' ? <section className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Projected Revenue</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{money(budgetWorkspace.summary.projectedRevenueCents)}</p>
            <p className="mt-1 text-sm text-slate-500">{budgetWorkspace.budgetRangeLabel}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">COGS Budget</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{money(budgetWorkspace.summary.plannedCogsCents)}</p>
            <p className="mt-1 text-sm text-slate-500">Run-rate {money(budgetWorkspace.summary.trailingCogsCents)}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Operating Spend</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{money(budgetWorkspace.summary.plannedOperatingSpendCents)}</p>
            <p className="mt-1 text-sm text-slate-500">Spendable pool</p>
          </div>
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Planned Net Income</p>
            <p className={`mt-2 text-2xl font-semibold ${budgetWorkspace.summary.recommendedNetIncomeCents >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{money(budgetWorkspace.summary.recommendedNetIncomeCents)}</p>
            <p className="mt-1 text-sm text-slate-500">{money(budgetWorkspace.summary.cashReserveCents)} reserve target</p>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="card space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <span className="eyebrow">Budgeting</span>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Category spend limits</h2>
              </div>
              <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">Target Profit</p>
                <p className="mt-1 text-xl font-semibold text-teal-950">{money(budgetWorkspace.summary.targetProfitCents)}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">Run-rate</th>
                    <th className="px-3 py-2 text-right">Limit</th>
                    <th className="px-3 py-2 text-right">This month</th>
                    <th className="px-3 py-2 text-right">Left</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {budgetWorkspace.categoryPlans.map((plan) => (
                    <tr key={plan.id} className="bg-white/60">
                      <td className="px-3 py-3 font-semibold text-slate-950">{plan.name}</td>
                      <td className="px-3 py-3 text-slate-600">{plan.sectionLabel}</td>
                      <td className="px-3 py-3 text-right text-slate-700">{money(plan.trailingAverageCents)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-950">{money(plan.suggestedLimitCents)}</td>
                      <td className={`px-3 py-3 text-right font-semibold ${budgetHealthTone(plan)}`}>{money(plan.currentProjectedCents)}</td>
                      <td className={`px-3 py-3 text-right font-semibold ${plan.remainingCents >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{money(plan.remainingCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!budgetWorkspace.categoryPlans.length ? <p className="text-sm text-slate-500">Categorized accounting activity will appear here after upload.</p> : null}
          </div>

          <div className="space-y-6">
            <div className="card space-y-4">
              <div>
                <span className="eyebrow">Consultant Cockpit</span>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">What belongs here</h2>
              </div>
              <div className="grid gap-3">
                <div className="rounded-xl border border-slate-200 bg-white/65 p-3">
                  <p className="font-semibold text-slate-950">Budget-vs-actual alerts</p>
                  <p className="mt-1 text-sm text-slate-500">Flag categories that are pacing above plan before month-end.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white/65 p-3">
                  <p className="font-semibold text-slate-950">Cash runway guardrail</p>
                  <p className="mt-1 text-sm text-slate-500">Keep reserve dollars separate from spendable operating cash.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white/65 p-3">
                  <p className="font-semibold text-slate-950">Approval thresholds</p>
                  <p className="mt-1 text-sm text-slate-500">Mark categories where a one-off purchase should require review.</p>
                </div>
              </div>
            </div>

            <div className="card space-y-4">
              <div>
                <span className="eyebrow">History</span>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Monthly foundation</h2>
              </div>
              <div className="space-y-2">
                {budgetWorkspace.monthlyHistory.map((month) => {
                  const netIncomeCents = month.revenueCents - month.cogsCents - month.operatingExpensesCents + month.otherIncomeCents - month.otherExpensesCents;
                  return (
                    <div key={month.month} className="rounded-xl border border-slate-200 bg-white/65 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-slate-950">{monthLabel(month.month)}</p>
                        <p className={`font-semibold ${netIncomeCents >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{money(netIncomeCents)}</p>
                      </div>
                      <p className="mt-1 text-xs font-medium text-slate-500">Revenue {money(month.revenueCents)} - COGS {money(month.cogsCents)} - OpEx {money(month.operatingExpensesCents)}</p>
                    </div>
                  );
                })}
                {!budgetWorkspace.monthlyHistory.length ? <p className="text-sm text-slate-500">Monthly budget history will appear after uploads.</p> : null}
              </div>
            </div>
          </div>
        </div>
      </section> : null}

      {activeView === 'simulator' ? (
        <AccountingBudgetSimulator lines={budgetWorkspace.simulatorLines} />
      ) : null}

      {activeView === 'pnl' ? <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="card space-y-4">
          <div>
            <span className="eyebrow">P&amp;L</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Profit and loss foundation</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                <tr><td className="py-2 font-medium text-slate-700">Uploaded revenue</td><td className="py-2 text-right font-semibold">{money(pnl.revenueCents)}</td></tr>
                <tr><td className="py-2 font-medium text-slate-700">Uploaded COGS</td><td className="py-2 text-right font-semibold">({money(pnl.cardCogsCents)})</td></tr>
                <tr><td className="py-2 font-semibold text-slate-950">Gross profit</td><td className="py-2 text-right font-semibold text-slate-950">{money(pnl.grossProfitCents)}</td></tr>
                <tr><td className="py-2 font-medium text-slate-700">Uploaded operating expenses</td><td className="py-2 text-right font-semibold">({money(pnl.cardOperatingExpenseCents)})</td></tr>
                <tr><td className="py-2 font-semibold text-slate-950">Operating income</td><td className="py-2 text-right font-semibold text-slate-950">{money(pnl.operatingIncomeCents)}</td></tr>
                <tr><td className="py-2 font-medium text-slate-700">Other income</td><td className="py-2 text-right font-semibold">{money(pnl.otherIncomeCents)}</td></tr>
                <tr><td className="py-2 font-medium text-slate-700">Other expense</td><td className="py-2 text-right font-semibold">({money(pnl.otherExpenseCents)})</td></tr>
                <tr><td className="py-2 text-base font-semibold text-slate-950">Net income</td><td className="py-2 text-right text-base font-semibold text-slate-950">{money(pnl.netIncomeCents)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card space-y-4">
          <div>
            <span className="eyebrow">Controls</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Uploaded activity</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Imported Rows</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{transactionTotal}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Needs Review</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{needsReviewCount}</p>
            </div>
          </div>
          <div className="space-y-4">
            {pnlCategoryBreakdown.map((section) => (
              <div key={section.id} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{section.label}</p>
                {section.rows.map((row) => (
                  <div key={row.category.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-sm">
                    <span className="font-medium text-slate-700">{row.category.name}</span>
                    <span className="font-semibold text-slate-950">{money(row.totalCents)}</span>
                  </div>
                ))}
              </div>
            ))}
            {!pnlCategoryBreakdown.length ? <p className="text-sm text-slate-500">No categorized accounting activity in this range yet.</p> : null}
          </div>
        </div>
      </section> : null}

      {activeView === 'categories' ? <section className="card space-y-4">
        <div>
          <span className="eyebrow">Categories</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Manage accounting categories</h2>
        </div>
          <form action={addAccountingCategory} className="grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-[1fr_1fr_1fr_auto]">
            <input className="input" name="name" required placeholder="New category" />
            <select className="input" name="category_type" defaultValue="operating_expense">
              <option value="operating_expense">Operating Expense</option>
              <option value="cogs">COGS</option>
              <option value="asset">Asset</option>
              <option value="other_income">Other Income</option>
              <option value="other_expense">Other Expense</option>
              <option value="excluded">Excluded</option>
            </select>
            <select className="input" name="pnl_section" defaultValue="operating_expenses">
              <option value="operating_expenses">Operating Expenses</option>
              <option value="cogs">COGS</option>
              <option value="other_income">Other Income</option>
              <option value="other_expenses">Other Expenses</option>
              <option value="none">No P&amp;L</option>
            </select>
            <PendingSubmitButton className="btn-secondary" label="Add" pendingLabel="Adding..." />
          </form>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {categories.map((category) => (
              <div key={category.id} className="rounded-xl border border-slate-200 bg-white/60 p-3">
                <p className="font-semibold text-slate-950">{category.name}</p>
                <p className="mt-1 text-sm text-slate-500">{category.category_type.replace(/_/g, ' ')} - {category.pnl_section.replace(/_/g, ' ')}</p>
              </div>
            ))}
            {!categories.length ? <p className="text-sm text-slate-500">No categories yet.</p> : null}
          </div>
      </section> : null}

      {activeView === 'review' ? <section className="card space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="eyebrow">Review</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Transactions</h2>
            <p className="mt-2 text-sm text-slate-500">
              Showing {transactionTotal ? reviewFrom + 1 : 0}-{reviewFrom + transactions.length} of {transactionTotal} transactions.
            </p>
          </div>
        </div>
        <form action="/admin/accounting" className="grid gap-3 rounded-xl border border-slate-200 bg-white/70 p-3 lg:grid-cols-[minmax(160px,0.8fr)_minmax(220px,1fr)_auto_auto] lg:items-end">
          <input name="view" type="hidden" value="review" />
          <input name="start" type="hidden" value={start} />
          <input name="end" type="hidden" value={end} />
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Category
            <select className="input" name="category" defaultValue={reviewCategoryFilter}>
              <option value="">All categories</option>
              <option value="__uncategorized__">Uncategorized</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Search
            <input className="input" name="q" defaultValue={reviewSearch} placeholder="Merchant, description, account" />
          </label>
          <button className="btn-primary" type="submit">Filter</button>
          <Link className="btn-secondary text-center" href={accountingViewHref({ end, start, view: 'review' })}>Clear</Link>
        </form>
        {transactions.length ? (
          <form id={BULK_ACCOUNTING_REVIEW_FORM_ID} action={bulkUpdateAccountingTransactions} className="grid gap-3 rounded-xl border border-slate-200 bg-white/70 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)_minmax(220px,0.8fr)_auto] lg:items-end">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-950">Bulk review</p>
              <AccountingBulkSelectionControls formId={BULK_ACCOUNTING_REVIEW_FORM_ID} pageCount={transactions.length} />
            </div>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Mark selected as
              <select className="input" name="mark_as" required defaultValue="">
                <option value="" disabled>Select category or status</option>
                <option value="__exclude__">Excluded from P&amp;L</option>
                <option value="__needs_review__">Needs Review</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Notes
              <input className="input" name="review_notes" placeholder="Optional bulk note" />
            </label>
            <PendingSubmitButton className="btn-primary" label="Apply" pendingLabel="Applying..." />
          </form>
        ) : null}
        <div className="space-y-3">
          {transactions.map((transaction) => {
            const aiFlags = Array.isArray(transaction.ai_review_flags)
              ? transaction.ai_review_flags.filter(isStandaloneAccountingFlag)
              : [];
            return (
              <div key={transaction.id} className="rounded-xl border border-slate-200 bg-white/65 p-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white/80">
                        <span className="sr-only">Select transaction</span>
                        <input
                          className="h-4 w-4 accent-teal-700"
                          data-accounting-transaction-select="true"
                          form={BULK_ACCOUNTING_REVIEW_FORM_ID}
                          name="transaction_id"
                          type="checkbox"
                          value={transaction.id}
                        />
                      </label>
                      <p className="font-semibold text-slate-950">{transaction.merchant_name || transaction.original_description}</p>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${transactionTone(transaction.status)}`}>{accountingStatusLabel(transaction.status)}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${aiReviewTone(transaction.ai_review_status)}`}>{aiReviewLabel(transaction.ai_review_status)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{formatDate(transaction.transaction_date)} - {accountingAccountTypeLabel(transaction.account_type)}{transaction.account_name ? ` - ${transaction.account_name}` : ''}</p>
                    {transaction.merchant_name ? <p className="mt-1 text-sm text-slate-500">{transaction.original_description}</p> : null}
                    <p className="mt-2 text-sm font-medium text-slate-700">Category: {categoryLabel(transaction.accounting_categories)}</p>
                    {transaction.ai_reviewed_at ? <p className="mt-1 text-xs text-slate-500">AI reviewed {formatDate(transaction.ai_reviewed_at)}{transaction.ai_review_model ? ` with ${transaction.ai_review_model}` : ''}</p> : null}
                  </div>
                  <p className={`text-2xl font-semibold ${normalizeAccountingNumber(transaction.amount_cents) < 0 ? 'text-emerald-700' : 'text-slate-950'}`}>
                    {money(transaction.amount_cents)}
                  </p>
                </div>

                {aiFlags.length ? (
                  <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                    {aiFlags.map((flag: any, index: number) => (
                      <div key={`${transaction.id}-ai-${index}`} className="rounded-xl border border-rose-100 bg-rose-50/70 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-rose-950">{aiFlagActionLabel(flag.recommendedAction)} - {Math.round(normalizeAccountingNumber(flag.confidence))}% confidence</p>
                            <p className="mt-1 text-sm text-rose-900">{flag.reason}</p>
                          </div>
                          <span className="w-fit rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-100">{String(flag.flagType ?? 'review').replace(/_/g, ' ')}</span>
                        </div>
                        {flag.categorySuggestion ? <p className="mt-2 text-xs font-medium text-rose-800">Suggested category: {flag.categorySuggestion}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : transaction.ai_review_status === 'clean' ? (
                  <p className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm font-medium text-emerald-800">AI review found no exception flags.</p>
                ) : null}

                <form action={updateAccountingTransaction} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-[1fr_minmax(220px,0.8fr)_auto_auto] lg:items-end">
                  <input name="transaction_id" type="hidden" value={transaction.id} />
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    Category
                    <select className="input" name="category_id" defaultValue={transaction.category_id ?? ''}>
                      <option value="" disabled>Select category</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    Notes
                    <input className="input" name="review_notes" defaultValue={transaction.review_notes ?? ''} placeholder="Review note" />
                  </label>
                  <button className="btn-primary" name="action_type" type="submit" value="categorize">Save</button>
                  <button className="btn-secondary" name="action_type" type="submit" value="exclude">Exclude</button>
                </form>
              </div>
            );
          })}
          {!transactions.length ? <p className="text-sm text-slate-500">No accounting transactions in this range yet.</p> : null}
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Link
            className={`btn-secondary ${hasPreviousReviewPage ? '' : 'pointer-events-none opacity-50'}`}
            href={accountingViewHref({ category: reviewCategoryFilter, end, page: reviewPage - 1, search: reviewSearch, start, view: 'review' })}
            aria-disabled={!hasPreviousReviewPage}
          >
            Previous
          </Link>
          <p className="text-sm font-medium text-slate-500">Page {reviewPage}</p>
          <Link
            className={`btn-secondary ${hasNextReviewPage ? '' : 'pointer-events-none opacity-50'}`}
            href={accountingViewHref({ category: reviewCategoryFilter, end, page: reviewPage + 1, search: reviewSearch, start, view: 'review' })}
            aria-disabled={!hasNextReviewPage}
          >
            Next
          </Link>
        </div>
      </section> : null}

      {activeView === 'imports' ? <section className="card space-y-4">
        <div>
          <span className="eyebrow">Imports</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Recent batches</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {batches.map((batch: any) => (
            <div key={batch.id} className="rounded-xl border border-slate-200 bg-white/60 p-3">
              <p className="font-semibold text-slate-950">{batch.file_name || batch.account_name || 'Manual batch'}</p>
              <p className="mt-1 text-sm text-slate-500">{formatDate(batch.created_at)} - {accountingAccountTypeLabel(batch.account_type)}</p>
              <p className="mt-2 text-sm text-slate-700">{batch.transaction_count} rows - {money(batch.total_outflow_cents)} out / {money(batch.total_inflow_cents)} in</p>
            </div>
          ))}
          {!batches.length ? <p className="text-sm text-slate-500">No uploads yet.</p> : null}
        </div>
      </section> : null}
    </div>
  );
}
