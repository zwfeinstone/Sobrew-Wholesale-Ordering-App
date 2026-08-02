import Link from 'next/link';
import AccountingBudgetSimulator from '@/components/accounting-budget-simulator';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import {
  normalizeAccountingNumber,
  type AccountingCategoryRow,
  type AccountingPnlSection,
  type AccountingTransactionRow,
} from '@/lib/accounting';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

const BUDGET_TRANSACTION_PAGE_SIZE = 1000;
const BUDGET_TABS = [
  { id: 'plan', label: 'Spend Plan' },
  { id: 'categories', label: 'Category Limits' },
  { id: 'simulator', label: 'Simulator' },
  { id: 'history', label: '30-Day Compare' },
] as const;

type BudgetTab = (typeof BUDGET_TABS)[number]['id'];
type SearchParams = Record<string, string | string[] | undefined>;
type SupabaseAccountingClient = Awaited<ReturnType<typeof createClient>>;

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
const FIXED_COST_CATEGORY_PATTERN = /\b(rent|utilities|software|subscription|subscriptions|payroll|owner pay|professional fees|bank|processing fees|taxes|licenses|permits|insurance|lease|loan|debt)\b/i;

type BudgetTransactionRow = AccountingTransactionRow & {
  account_name: string | null;
  account_type: string;
  accounting_categories?: AccountingCategoryRow | AccountingCategoryRow[] | null;
  id: string;
  merchant_name: string | null;
  original_description: string;
};

type BudgetCategoryPlan = {
  actualCents: number;
  dailyAverageCents: number;
  id: string;
  isFixedCost: boolean;
  isFlexibleSpend: boolean;
  name: string;
  previousCents: number;
  remainingCents: number;
  section: AccountingPnlSection;
  sectionLabel: string;
  suggestedLimitCents: number;
  varianceCents: number;
  variancePercent: number;
};

type BudgetSectionSummary = {
  cogsCents: number;
  operatingExpensesCents: number;
  otherExpensesCents: number;
  otherIncomeCents: number;
  revenueCents: number;
};

type BudgetMonthSummary = BudgetSectionSummary & {
  label: string;
};

type BudgetLeak = {
  amountCents: number;
  dailyAverageCents: number;
  id: string;
  name: string;
  shareOfFlexibleSpend: number;
  varianceCents: number;
};

type BudgetSimulatorLine = {
  amountCents: number;
  id: string;
  name: string;
  section: 'revenue' | 'cogs' | 'operating_expenses' | 'other_income' | 'other_expenses';
};

function budgetTabParam(value: string | string[] | undefined): BudgetTab {
  return BUDGET_TABS.some((tab) => tab.id === value) ? value as BudgetTab : 'plan';
}

function budgetingHref(budgetTab: BudgetTab) {
  const params = new URLSearchParams();
  if (budgetTab !== 'plan') params.set('budget_tab', budgetTab);
  const query = params.toString();
  return query ? `/admin/budgeting?${query}` : '/admin/budgeting';
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function utcDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateInput: string, days: number) {
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateInput(date);
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

function formatPercent(value: number) {
  return `${Math.round(value * 10) / 10}%`;
}

function categoryAmountForPnlSection(transaction: AccountingTransactionRow, category: AccountingCategoryRow) {
  const amountCents = normalizeAccountingNumber(transaction.amount_cents);
  if (category.pnl_section === 'revenue' || category.pnl_section === 'other_income') {
    return -amountCents;
  }
  if (category.pnl_section === 'cogs' || category.pnl_section === 'operating_expenses' || category.pnl_section === 'other_expenses') {
    return amountCents;
  }
  return 0;
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
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

function budgetHealthTone(plan: BudgetCategoryPlan) {
  if (plan.suggestedLimitCents <= 0) return 'text-slate-500';
  if (plan.actualCents > plan.suggestedLimitCents) return 'text-rose-700';
  if (plan.actualCents > plan.suggestedLimitCents * 0.85) return 'text-amber-700';
  return 'text-emerald-700';
}

function isFixedBudgetCategory(category: AccountingCategoryRow) {
  if (category.pnl_section !== 'operating_expenses' && category.pnl_section !== 'other_expenses') return false;
  return FIXED_COST_CATEGORY_PATTERN.test(category.name);
}

function budgetDateRangeLabel(start: string, end: string) {
  return `${formatDate(start)} through ${formatDate(end)}`;
}

function buildBudgetWorkspace(transactions: BudgetTransactionRow[]) {
  const categoryStats = new Map<string, {
    actualCents: number;
    category: AccountingCategoryRow;
    previousCents: number;
  }>();
  const merchantLeaks = new Map<string, BudgetLeak>();
  const latestTransactionDate = transactions.reduce((latest, transaction) => (
    transaction.transaction_date > latest ? transaction.transaction_date : latest
  ), todayInput());
  const trailingEnd = latestTransactionDate;
  const trailingStart = addDays(trailingEnd, -29);
  const previousEnd = addDays(trailingStart, -1);
  const previousStart = addDays(previousEnd, -29);
  const trailingSummary = emptyBudgetSectionSummary();
  const previousSummary = emptyBudgetSectionSummary();
  let fixedCostCents = 0;
  let previousFixedCostCents = 0;
  let flexibleSpendCents = 0;
  let previousFlexibleSpendCents = 0;

  for (const transaction of transactions) {
    if (transaction.status === 'excluded') continue;
    const category = relatedOne(transaction.accounting_categories);
    if (!category || category.pnl_section === 'none') continue;
    const amountCents = categoryAmountForPnlSection(transaction, category);
    const isTrailing = transaction.transaction_date >= trailingStart && transaction.transaction_date <= trailingEnd;
    const isPrevious = transaction.transaction_date >= previousStart && transaction.transaction_date <= previousEnd;
    if (!isTrailing && !isPrevious) continue;

    const stats = categoryStats.get(category.id) ?? {
      actualCents: 0,
      category,
      previousCents: 0,
    };
    const fixedCost = isFixedBudgetCategory(category);
    const flexibleSpend = (category.pnl_section === 'operating_expenses' || category.pnl_section === 'other_expenses') && !fixedCost;

    if (isTrailing) {
      addToBudgetSection(trailingSummary, category.pnl_section, amountCents);
      stats.actualCents += amountCents;
      if (fixedCost) fixedCostCents += amountCents;
      if (flexibleSpend) {
        flexibleSpendCents += amountCents;
        const merchantName = transaction.merchant_name || transaction.original_description;
        const merchantKey = merchantName.trim().toLowerCase();
        const leak = merchantLeaks.get(merchantKey) ?? {
          amountCents: 0,
          dailyAverageCents: 0,
          id: merchantKey,
          name: merchantName,
          shareOfFlexibleSpend: 0,
          varianceCents: 0,
        };
        leak.amountCents += amountCents;
        merchantLeaks.set(merchantKey, leak);
      }
    }

    if (isPrevious) {
      addToBudgetSection(previousSummary, category.pnl_section, amountCents);
      stats.previousCents += amountCents;
      if (fixedCost) previousFixedCostCents += amountCents;
      if (flexibleSpend) previousFlexibleSpendCents += amountCents;
    }

    categoryStats.set(category.id, stats);
  }

  const projectedRevenueCents = trailingSummary.revenueCents;
  const trailingCogsCents = trailingSummary.cogsCents;
  const trailingOtherIncomeCents = trailingSummary.otherIncomeCents;
  const cogsRatio = projectedRevenueCents > 0 ? trailingCogsCents / projectedRevenueCents : 0;
  const plannedCogsCents = trailingCogsCents;
  const targetProfitCents = Math.round(projectedRevenueCents * 0.12);
  const cashReserveCents = Math.round(projectedRevenueCents * 0.08);
  const flexibleSpendCapacityCents = Math.max(
    0,
    projectedRevenueCents + trailingOtherIncomeCents - plannedCogsCents - fixedCostCents - targetProfitCents - cashReserveCents,
  );
  const flexibleSpendRemainingCents = flexibleSpendCapacityCents - flexibleSpendCents;
  const flexibleSpendBurnRate = flexibleSpendCapacityCents > 0 ? flexibleSpendCents / flexibleSpendCapacityCents : 0;
  const flexibleDailyCapacityCents = Math.round(flexibleSpendCapacityCents / 30);
  const flexibleDailySpendCents = Math.round(flexibleSpendCents / 30);
  const flexibleDailyRemainingCents = flexibleDailyCapacityCents - flexibleDailySpendCents;

  const categoryPlans: BudgetCategoryPlan[] = Array.from(categoryStats.values()).map((stats) => {
    const section = stats.category.pnl_section;
    const fixedCost = isFixedBudgetCategory(stats.category);
    const flexibleSpend = (section === 'operating_expenses' || section === 'other_expenses') && !fixedCost;
    let suggestedLimitCents = stats.actualCents;

    if (flexibleSpend && flexibleSpendCents > 0) {
      suggestedLimitCents = Math.round((stats.actualCents / flexibleSpendCents) * flexibleSpendCapacityCents);
    }
    suggestedLimitCents = Math.max(0, suggestedLimitCents);
    const varianceCents = stats.actualCents - stats.previousCents;
    const variancePercent = stats.previousCents > 0 ? (varianceCents / stats.previousCents) * 100 : stats.actualCents > 0 ? 100 : 0;

    return {
      actualCents: stats.actualCents,
      dailyAverageCents: Math.round(stats.actualCents / 30),
      id: stats.category.id,
      isFixedCost: fixedCost,
      isFlexibleSpend: flexibleSpend,
      name: stats.category.name,
      previousCents: stats.previousCents,
      remainingCents: suggestedLimitCents - stats.actualCents,
      section,
      sectionLabel: BUDGET_PNL_SECTION_LABELS[section],
      suggestedLimitCents,
      varianceCents,
      variancePercent,
    };
  }).filter((plan) => BUDGET_PNL_SECTIONS.includes(plan.section as Exclude<AccountingPnlSection, 'none'>));

  categoryPlans.sort((left, right) => (
    BUDGET_PNL_SECTIONS.indexOf(left.section as Exclude<AccountingPnlSection, 'none'>)
    - BUDGET_PNL_SECTIONS.indexOf(right.section as Exclude<AccountingPnlSection, 'none'>)
  ) || right.suggestedLimitCents - left.suggestedLimitCents);

  const monthlyHistory: BudgetMonthSummary[] = [
    {
      ...trailingSummary,
      label: 'Last 30 days',
    },
    {
      ...previousSummary,
      label: 'Previous 30 days',
    },
  ];
  const flexibleCategoryLeaks: BudgetLeak[] = categoryPlans
    .filter((plan) => plan.isFlexibleSpend && plan.actualCents > 0)
    .map((plan) => ({
      amountCents: plan.actualCents,
      dailyAverageCents: plan.dailyAverageCents,
      id: plan.id,
      name: plan.name,
      shareOfFlexibleSpend: flexibleSpendCents > 0 ? (plan.actualCents / flexibleSpendCents) * 100 : 0,
      varianceCents: plan.varianceCents,
    }))
    .sort((left, right) => (
      Math.max(0, right.varianceCents) - Math.max(0, left.varianceCents)
    ) || right.amountCents - left.amountCents)
    .slice(0, 6);
  const flexibleMerchantLeaks: BudgetLeak[] = Array.from(merchantLeaks.values())
    .map((leak) => ({
      ...leak,
      dailyAverageCents: Math.round(leak.amountCents / 30),
      shareOfFlexibleSpend: flexibleSpendCents > 0 ? (leak.amountCents / flexibleSpendCents) * 100 : 0,
    }))
    .sort((left, right) => right.amountCents - left.amountCents)
    .slice(0, 6);

  const simulatorLines: BudgetSimulatorLine[] = categoryPlans
    .filter((plan) => plan.suggestedLimitCents > 0)
    .map((plan) => ({
      amountCents: plan.suggestedLimitCents,
      id: plan.id,
      name: plan.name,
      section: plan.section as BudgetSimulatorLine['section'],
    }));

  const plannedOperatingSpendCents = fixedCostCents + Math.min(flexibleSpendCents, flexibleSpendCapacityCents);
  const recommendedNetIncomeCents = projectedRevenueCents + trailingOtherIncomeCents - plannedCogsCents - plannedOperatingSpendCents;
  const budgetRangeLabel = budgetDateRangeLabel(trailingStart, trailingEnd);

  return {
    budgetRangeLabel,
    categoryPlans,
    flexibleCategoryLeaks,
    flexibleMerchantLeaks,
    monthlyHistory,
    simulatorLines,
    summary: {
      availableOperatingSpendCents: flexibleSpendCapacityCents,
      baselineMonthCount: 1,
      cashReserveCents,
      cogsRatio,
      fixedCostCents,
      flexibleDailyCapacityCents,
      flexibleDailyRemainingCents,
      flexibleDailySpendCents,
      flexibleSpendBurnRate,
      flexibleSpendCapacityCents,
      flexibleSpendCents,
      flexibleSpendRemainingCents,
      plannedCogsCents,
      plannedOperatingSpendCents,
      previousFixedCostCents,
      previousFlexibleSpendCents,
      previousRevenueCents: previousSummary.revenueCents,
      projectedRevenueCents,
      recommendedNetIncomeCents,
      targetProfitCents,
      trailingCogsCents,
      trailingOperatingExpensesCents: trailingSummary.operatingExpensesCents,
      trailingOtherExpensesCents: trailingSummary.otherExpensesCents,
      trailingOtherIncomeCents,
      trailingStart,
      trailingEnd,
    },
  };
}

async function fetchBudgetTransactions(supabase: SupabaseAccountingClient) {
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

function BudgetingNav({
  activeBudgetTab,
}: {
  activeBudgetTab: BudgetTab;
}) {
  return (
    <section className="card">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {BUDGET_TABS.map((tab) => (
          <Link
            key={tab.id}
            href={budgetingHref(tab.id)}
            className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-all duration-200 ${
              activeBudgetTab === tab.id
                ? 'border-teal-200 bg-teal-50 text-teal-900'
                : 'border-slate-200 bg-white/70 text-slate-700 hover:border-teal-200 hover:text-teal-800'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

export default async function BudgetingPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  await requireAdminSectionView('accounting');
  const supabase = await createClient();
  const activeBudgetTab = budgetTabParam(searchParams?.budget_tab);
  const budgetWorkspace = buildBudgetWorkspace(await fetchBudgetTransactions(supabase));

  return (
    <div className="space-y-6">
      <section className="panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <span className="eyebrow">Budgeting</span>
            <h1 className="page-title mt-4">Budgeting workspace</h1>
            <p className="page-subtitle mt-3 max-w-3xl">Track flexible spend capacity, category limits, and 30-day budget trends from categorized accounting activity.</p>
          </div>
          <Link className="btn-secondary w-full text-center sm:w-auto" href="/admin/accounting?view=upload">Upload accounting</Link>
        </div>
      </section>

      <BudgetingNav activeBudgetTab={activeBudgetTab} />

      {activeBudgetTab === 'plan' ? <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Last 30-Day Revenue</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{money(budgetWorkspace.summary.projectedRevenueCents)}</p>
            <p className="mt-1 text-sm text-slate-500">{budgetWorkspace.budgetRangeLabel}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">COGS + Fixed</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{money(budgetWorkspace.summary.plannedCogsCents + budgetWorkspace.summary.fixedCostCents)}</p>
            <p className="mt-1 text-sm text-slate-500">{money(budgetWorkspace.summary.fixedCostCents)} fixed costs</p>
          </div>
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Flexible Spend Capacity</p>
            <p className={`mt-2 text-2xl font-semibold ${budgetWorkspace.summary.flexibleSpendRemainingCents >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{money(budgetWorkspace.summary.flexibleSpendCapacityCents)}</p>
            <p className="mt-1 text-sm text-slate-500">{money(budgetWorkspace.summary.flexibleSpendRemainingCents)} left vs last 30 days</p>
          </div>
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Flexible Burn Pace</p>
            <p className={`mt-2 text-2xl font-semibold ${budgetWorkspace.summary.flexibleSpendBurnRate <= 1 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatPercent(budgetWorkspace.summary.flexibleSpendBurnRate * 100)}</p>
            <p className="mt-1 text-sm text-slate-500">{money(budgetWorkspace.summary.recommendedNetIncomeCents)} profit after budget</p>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="card space-y-4">
            <div>
              <span className="eyebrow">Decision</span>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">How much can I spend?</h2>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">Outside COGS and fixed costs</p>
              <p className="mt-2 text-4xl font-semibold tracking-tight text-emerald-950">{money(budgetWorkspace.summary.flexibleSpendCapacityCents)}</p>
              <p className="mt-2 text-sm text-emerald-900">That is {money(budgetWorkspace.summary.flexibleDailyCapacityCents)} per day for flexible growth and operating decisions.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white/65 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Actual Flexible Spend</p>
                <p className="mt-2 text-xl font-semibold text-slate-950">{money(budgetWorkspace.summary.flexibleSpendCents)}</p>
                <p className="mt-1 text-sm text-slate-500">{money(budgetWorkspace.summary.flexibleDailySpendCents)} per day</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white/65 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Daily Cushion</p>
                <p className={`mt-2 text-xl font-semibold ${budgetWorkspace.summary.flexibleDailyRemainingCents >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{money(budgetWorkspace.summary.flexibleDailyRemainingCents)}</p>
                <p className="mt-1 text-sm text-slate-500">capacity less recent pace</p>
              </div>
            </div>
          </div>

          <div className="card space-y-4">
            <div>
              <span className="eyebrow">Bleed Check</span>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Where money is leaking</h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Categories</p>
                {budgetWorkspace.flexibleCategoryLeaks.map((leak) => (
                  <div key={leak.id} className="rounded-xl border border-slate-200 bg-white/65 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-slate-950">{leak.name}</p>
                      <p className="font-semibold text-slate-950">{money(leak.amountCents)}</p>
                    </div>
                    <p className="mt-1 text-xs font-medium text-slate-500">{formatPercent(leak.shareOfFlexibleSpend)} of flexible spend - {money(leak.dailyAverageCents)} per day</p>
                  </div>
                ))}
                {!budgetWorkspace.flexibleCategoryLeaks.length ? <p className="text-sm text-slate-500">No flexible spend found in the last 30 days.</p> : null}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Vendors</p>
                {budgetWorkspace.flexibleMerchantLeaks.map((leak) => (
                  <div key={leak.id} className="rounded-xl border border-slate-200 bg-white/65 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-semibold text-slate-950">{leak.name}</p>
                      <p className="font-semibold text-slate-950">{money(leak.amountCents)}</p>
                    </div>
                    <p className="mt-1 text-xs font-medium text-slate-500">{formatPercent(leak.shareOfFlexibleSpend)} of flexible spend - {money(leak.dailyAverageCents)} per day</p>
                  </div>
                ))}
                {!budgetWorkspace.flexibleMerchantLeaks.length ? <p className="text-sm text-slate-500">No flexible vendor spend found in the last 30 days.</p> : null}
              </div>
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <div>
            <span className="eyebrow">Controls</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Budget guardrails</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white/65 p-3">
              <p className="font-semibold text-slate-950">Live budget-vs-actual</p>
              <p className="mt-1 text-sm text-slate-500">Track flexible spend against the safe next-30-day capacity.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white/65 p-3">
              <p className="font-semibold text-slate-950">Fixed-cost clarity</p>
              <p className="mt-1 text-sm text-slate-500">Separate obligations from discretionary decisions before spending.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white/65 p-3">
              <p className="font-semibold text-slate-950">Pre-spend rule</p>
              <p className="mt-1 text-sm text-slate-500">If a flexible purchase would push the cushion below zero, pause it.</p>
            </div>
          </div>
        </div>
      </div> : null}

      {activeBudgetTab === 'categories' ? <div className="card space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="eyebrow">Budgeting</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Next 30-day category limits</h2>
          </div>
          <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">Flexible Capacity</p>
            <p className="mt-1 text-xl font-semibold text-teal-950">{money(budgetWorkspace.summary.flexibleSpendCapacityCents)}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Last 30</th>
                <th className="px-3 py-2 text-right">Prior 30</th>
                <th className="px-3 py-2 text-right">Next Limit</th>
                <th className="px-3 py-2 text-right">Left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {budgetWorkspace.categoryPlans.map((plan) => (
                <tr key={plan.id} className="bg-white/60">
                  <td className="px-3 py-3 font-semibold text-slate-950">{plan.name}</td>
                  <td className="px-3 py-3 text-slate-600">
                    {plan.section === 'cogs' ? 'COGS' : plan.isFixedCost ? 'Fixed' : plan.isFlexibleSpend ? 'Flexible' : plan.sectionLabel}
                  </td>
                  <td className={`px-3 py-3 text-right font-semibold ${budgetHealthTone(plan)}`}>{money(plan.actualCents)}</td>
                  <td className="px-3 py-3 text-right text-slate-700">{money(plan.previousCents)}</td>
                  <td className="px-3 py-3 text-right font-semibold text-slate-950">{money(plan.suggestedLimitCents)}</td>
                  <td className={`px-3 py-3 text-right font-semibold ${plan.remainingCents >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{money(plan.remainingCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!budgetWorkspace.categoryPlans.length ? <p className="text-sm text-slate-500">Categorized accounting activity will appear here after upload.</p> : null}
      </div> : null}

      {activeBudgetTab === 'simulator' ? (
        <AccountingBudgetSimulator lines={budgetWorkspace.simulatorLines} />
      ) : null}

      {activeBudgetTab === 'history' ? <div className="card space-y-4">
        <div>
          <span className="eyebrow">History</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">30-day comparison</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {budgetWorkspace.monthlyHistory.map((period) => {
            const netIncomeCents = period.revenueCents - period.cogsCents - period.operatingExpensesCents + period.otherIncomeCents - period.otherExpensesCents;
            return (
              <div key={period.label} className="rounded-xl border border-slate-200 bg-white/65 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-slate-950">{period.label}</p>
                  <p className={`font-semibold ${netIncomeCents >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{money(netIncomeCents)}</p>
                </div>
                <p className="mt-1 text-xs font-medium text-slate-500">Revenue {money(period.revenueCents)} - COGS {money(period.cogsCents)} - OpEx {money(period.operatingExpensesCents)}</p>
              </div>
            );
          })}
          {!budgetWorkspace.monthlyHistory.length ? <p className="text-sm text-slate-500">30-day budget history will appear after uploads.</p> : null}
        </div>
      </div> : null}
    </div>
  );
}
