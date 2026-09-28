import {
  normalizeMoneyCents,
  normalizeSalaryLaborWorkType,
  normalizeWorkType,
  type TimeClockBreakRow,
  type TimeClockEntryRow,
  type TimeEntryWorkType,
} from './time-clock';
import type { ProfitabilityTotals } from './profitability-reporting';
import { calculatePayrollWages, distributePayrollWages } from './payroll-wages';

export type LaborPaidGpmTimeEntryRow = TimeClockEntryRow & {
  admin_time_breaks?: TimeClockBreakRow[] | null;
  id: string;
  locked_at?: string | null;
  profile_id: string | null;
};

export type LaborPaidGpmAllocationRow = {
  minutes: number | string | null;
  time_entry_id: string;
  wage_cents: number | string | null;
  work_type: string | null;
};

export type LaborPaidGpmSalaryPaymentRow = {
  id: string;
  paid_at: string | null;
  period_end_date?: string | null;
  period_start_date?: string | null;
  salary_labor_work_type: string | null;
  salary_pay_cents: number | string | null;
};

export type LaborPaidGpmProductionRunRow = {
  actual_labor_cost_cents?: number | string | null;
  quantity_produced?: number | string | null;
  quantity_voided?: number | string | null;
  status?: string | null;
};

export type LaborPaidGpmSummary = {
  actualGrossProfitCents: number;
  actualLaborGpmPercent: number;
  actualLaborPaidCents: number;
  actualTotalCogsCents: number;
  hourlyEntryCount: number;
  hourlyLaborPaidCents: number;
  laborDifferenceCents: number;
  productionHours: number;
  productionRunLaborCogsCents: number;
  revenueCents: number;
  salaryLaborPaidCents: number;
  salaryPaymentCount: number;
  shippedGpmPercent: number;
  shippedGrossProfitCents: number;
  shippedLaborCogsCents: number;
  shippedTotalCogsCents: number;
  totalCogsBeforeLaborCents: number;
  unlockedProductionEntryCount: number;
  unapprovedProductionEntryCount: number;
};

function numericValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function marginPercent(revenueCents: number, grossProfitCents: number) {
  return revenueCents > 0 ? (grossProfitCents / revenueCents) * 100 : 0;
}

function activeProductionQuantity(run: LaborPaidGpmProductionRunRow) {
  if (run.status === 'void') return 0;
  return Math.max(0, numericValue(run.quantity_produced) - numericValue(run.quantity_voided));
}

type LaborSegment = {
  entry: LaborPaidGpmTimeEntryRow;
  minutes: number;
  wageCents: number;
  workType: TimeEntryWorkType;
};

function buildHourlySegments(
  entries: LaborPaidGpmTimeEntryRow[],
  allocations: LaborPaidGpmAllocationRow[],
  overtimeContextEntries: LaborPaidGpmTimeEntryRow[],
) {
  const allocationsByEntry = new Map<string, LaborPaidGpmAllocationRow[]>();
  const wagesByEntry = calculatePayrollWages(overtimeContextEntries);
  for (const allocation of allocations) {
    const rows = allocationsByEntry.get(allocation.time_entry_id) ?? [];
    rows.push(allocation);
    allocationsByEntry.set(allocation.time_entry_id, rows);
  }

  const segments: LaborSegment[] = [];
  for (const entry of entries) {
    if (entry.status === 'void' || entry.status === 'open' || !entry.clock_out_at) continue;
    const pay = wagesByEntry.get(entry.id);
    if (!pay || pay.minutes <= 0) continue;
    const entryAllocations = allocationsByEntry.get(entry.id) ?? [];
    if (entryAllocations.length) {
      const allocatedMinutes = entryAllocations.map((allocation) => Math.max(0, numericValue(allocation.minutes)));
      const remainingMinutes = Math.max(0, pay.minutes - allocatedMinutes.reduce((sum, minutes) => sum + minutes, 0));
      const allocationPay = distributePayrollWages(pay, [...allocatedMinutes, remainingMinutes]);
      // Saved allocation wages remain the base; share only the new overtime premium.
      for (const [index, allocation] of entryAllocations.entries()) {
        segments.push({
          entry,
          minutes: allocationPay[index].minutes,
          wageCents: normalizeMoneyCents(allocation.wage_cents) + allocationPay[index].overtimePremiumCents,
          workType: normalizeWorkType(allocation.work_type),
        });
      }
      if (remainingMinutes > 0) {
        segments.push({
          entry,
          minutes: allocationPay[entryAllocations.length].minutes,
          wageCents: allocationPay[entryAllocations.length].wageCents,
          workType: normalizeWorkType(entry.work_type),
        });
      }
      continue;
    }

    segments.push({
      entry,
      minutes: pay.minutes,
      wageCents: pay.wageCents,
      workType: normalizeWorkType(entry.work_type),
    });
  }

  return segments;
}

export function buildLaborPaidGpmSummary({
  allocations,
  current,
  entries,
  overtimeContextEntries = entries,
  productionRunLaborCogsCents,
  productionRuns,
  salaryPayments,
}: {
  allocations: LaborPaidGpmAllocationRow[];
  current: ProfitabilityTotals;
  entries: LaborPaidGpmTimeEntryRow[];
  overtimeContextEntries?: LaborPaidGpmTimeEntryRow[];
  productionRunLaborCogsCents?: number;
  productionRuns: LaborPaidGpmProductionRunRow[];
  salaryPayments: LaborPaidGpmSalaryPaymentRow[];
}): LaborPaidGpmSummary {
  const productionSegments = buildHourlySegments(entries, allocations, overtimeContextEntries)
    .filter((segment) => segment.workType === 'production');
  const hourlyLaborPaidCents = productionSegments.reduce((sum, segment) => sum + segment.wageCents, 0);
  const productionMinutes = productionSegments.reduce((sum, segment) => sum + segment.minutes, 0);
  const productionEntryIds = new Set(productionSegments.map((segment) => segment.entry.id));
  const unlockedProductionEntryIds = new Set(
    productionSegments
      .filter((segment) => segment.entry.status !== 'locked' && !segment.entry.locked_at)
      .map((segment) => segment.entry.id)
  );
  const unapprovedProductionEntryIds = new Set(
    productionSegments
      .filter((segment) => !['approved', 'locked'].includes(String(segment.entry.status ?? '')))
      .map((segment) => segment.entry.id)
  );
  const productionSalaryPayments = salaryPayments
    .filter((payment) => payment.paid_at)
    .filter((payment) => normalizeSalaryLaborWorkType(payment.salary_labor_work_type) === 'production');
  const salaryLaborPaidCents = productionSalaryPayments.reduce((sum, payment) => sum + normalizeMoneyCents(payment.salary_pay_cents), 0);
  const actualLaborPaidCents = hourlyLaborPaidCents + salaryLaborPaidCents;
  const shippedTotalCogsCents = current.totalCogsCents;
  const shippedLaborCogsCents = current.laborCents;
  const totalCogsBeforeLaborCents = Math.max(0, shippedTotalCogsCents - shippedLaborCogsCents);
  const actualTotalCogsCents = totalCogsBeforeLaborCents + actualLaborPaidCents;
  const actualGrossProfitCents = current.revenueCents - actualTotalCogsCents;
  const safeProductionRunLaborCogsCents = typeof productionRunLaborCogsCents === 'number' && Number.isFinite(productionRunLaborCogsCents)
    ? productionRunLaborCogsCents
    : productionRuns.reduce((sum, run) => {
      const quantityProduced = numericValue(run.quantity_produced);
      const activeRatio = quantityProduced > 0 ? activeProductionQuantity(run) / quantityProduced : 0;
      return sum + normalizeMoneyCents(run.actual_labor_cost_cents) * activeRatio;
    }, 0);

  return {
    actualGrossProfitCents,
    actualLaborGpmPercent: marginPercent(current.revenueCents, actualGrossProfitCents),
    actualLaborPaidCents,
    actualTotalCogsCents,
    hourlyEntryCount: productionEntryIds.size,
    hourlyLaborPaidCents,
    laborDifferenceCents: actualLaborPaidCents - safeProductionRunLaborCogsCents,
    productionHours: Math.round((productionMinutes / 60) * 100) / 100,
    productionRunLaborCogsCents: safeProductionRunLaborCogsCents,
    revenueCents: current.revenueCents,
    salaryLaborPaidCents,
    salaryPaymentCount: productionSalaryPayments.length,
    shippedGpmPercent: current.marginPercent,
    shippedGrossProfitCents: current.grossProfitCents,
    shippedLaborCogsCents,
    shippedTotalCogsCents,
    totalCogsBeforeLaborCents,
    unlockedProductionEntryCount: unlockedProductionEntryIds.size,
    unapprovedProductionEntryCount: unapprovedProductionEntryIds.size,
  };
}
