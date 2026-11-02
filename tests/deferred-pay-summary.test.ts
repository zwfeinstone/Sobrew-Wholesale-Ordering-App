import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DeferredPaySummaryCard from '@/components/deferred-pay-summary';
import type { DeferredPayEntrySummary, DeferredPayPlan, DeferredPaySummary } from '@/lib/deferred-pay';

const plan: DeferredPayPlan = {
  id: 'deferred-haskins',
  profile_id: 'haskins',
  label: 'Deferred hourly compensation',
  start_date: '2026-10-07',
  end_date: '2027-01-03',
  payout_date: '2027-01-04',
  weekly_rate_cents: 1500,
  accrual_rate_cents: 500,
  paid_at: null,
  paid_amount_cents: null,
};

function entry(id: string, date: string, hours: number): DeferredPayEntrySummary {
  return {
    entryId: id,
    clockInAt: `${date}T13:00:00Z`,
    clockOutAt: `${date}T23:00:00Z`,
    workType: 'sales',
    eligibleMilliseconds: hours * 3_600_000,
    eligibleMinutes: hours * 60,
    eligibleHours: hours,
    accruedCents: hours * 500,
  };
}

const firstShift = entry('first', '2026-10-09', 7.5);
const weekendShift = entry('weekend', '2026-10-17', 10);
const summary: DeferredPaySummary = {
  planId: plan.id,
  asOf: '2026-10-18T19:00:00Z',
  status: 'accruing',
  eligibleMilliseconds: 17.5 * 3_600_000,
  eligibleMinutes: 1050,
  eligibleHours: 17.5,
  accruedCents: 8750,
  paidCents: 0,
  remainingCents: 8750,
  entryCount: 2,
  entries: [firstShift, weekendShift],
  weeks: [
    {
      weekStartDate: '2026-10-05', weekEndDate: '2026-10-11',
      eligibleMilliseconds: firstShift.eligibleMilliseconds, eligibleMinutes: 450, eligibleHours: 7.5,
      accruedCents: 3750, entryCount: 1, entries: [firstShift],
    },
    {
      weekStartDate: '2026-10-12', weekEndDate: '2026-10-18',
      eligibleMilliseconds: weekendShift.eligibleMilliseconds, eligibleMinutes: 600, eligibleHours: 10,
      accruedCents: 5000, entryCount: 1, entries: [weekendShift],
    },
  ],
};

function render(summaryOverride: Partial<DeferredPaySummary> = {}, planOverride: Partial<DeferredPayPlan> = {}) {
  return renderToStaticMarkup(createElement(DeferredPaySummaryCard, {
    plan: { ...plan, ...planOverride },
    summary: { ...summary, ...summaryOverride },
  }));
}

describe('employee deferred pay summary', () => {
  it('explains the weekly and deferred rates and shows actual accrued money and eligible hours', () => {
    const html = render();
    expect(html).toContain('$20.00/hr');
    expect(html).toContain('$15.00/hr');
    expect(html).toContain('$5.00/hr');
    expect(html).toContain('Accruing · Not paid');
    expect(html).toMatch(/Accrued balance<\/dt><dd[^>]*>\$87\.50<\/dd>/);
    expect(html).toContain('17.50');
    expect(html).toContain('Oct 7, 2026–Jan 3, 2027');
    expect(html).toContain('Planned lump-sum payment');
    expect(html).toContain('Jan 4, 2027');
    expect(html).toMatch(/Deferred this week<\/dt><dd[^>]*>\$50\.00<\/dd>/);
    expect(html).toContain('10.00 eligible hrs · Monday–Sunday');
    expect(html).toContain('Gross amounts before deductions');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
  });

  it('provides native accessible weekly disclosures, per-shift hours and cumulative totals including weekends', () => {
    const html = render();
    const weeks = html.match(/<details\b[\s\S]*?<\/details>/g);
    expect(weeks).toHaveLength(2);
    expect(weeks![0]).toContain('<summary');
    expect(weeks![0]).toContain('aria-label="Shifts for week of Oct 5, 2026"');
    expect(weeks![0]).toContain('7.50 hrs');
    expect(weeks![0]).toMatch(/Running total<\/span><span[^>]*>\$37\.50<\/span>/);
    expect(weeks![1]).toMatch(/Running total<\/span><span[^>]*>\$87\.50<\/span>/);
    expect(weeks![1]).toContain('Oct 17, 2026');
    expect(weeks![1]).toContain('Sales');
    expect(weeks![1]).toContain('10.00 hrs');
    expect(weeks![1]).toContain('$50.00');
    expect(html).toContain('including weekends');
    expect(html).toContain('Hours display to two decimals; accrual uses unrounded eligible time.');
  });

  it('shows the scheduled date and zero totals before any eligible shifts are completed', () => {
    const html = render({
      status: 'scheduled', asOf: '2026-10-06T12:00:00Z',
      eligibleMilliseconds: 0, eligibleMinutes: 0, eligibleHours: 0,
      accruedCents: 0, remainingCents: 0, entryCount: 0, entries: [], weeks: [],
    });
    expect(html).toContain('Scheduled · Not paid');
    expect(html).toContain('Accrual starts Oct 7, 2026.');
    expect(html).toContain('0 completed shifts · 0 weeks');
    expect(html).toContain('$0.00');
    expect(html).not.toContain('<details');
  });

  it('continues showing an unpaid balance after the payment date until payment is recorded', () => {
    const html = render({ status: 'awaiting_payment', asOf: '2027-01-05T18:00:00Z' });
    expect(html).toContain('Awaiting payment');
    expect(html).toMatch(/Accrued balance<\/dt><dd[^>]*>\$87\.50<\/dd>/);
    expect(html).toMatch(/Deferred this week<\/dt><dd[^>]*>\$0\.00<\/dd>/);
    expect(html).not.toContain('Payment recorded');
  });

  it('preserves earned hours and total after payment and shows the recorded payment date', () => {
    const html = render(
      { status: 'paid', asOf: '2027-01-05T18:00:00Z', paidCents: 8750, remainingCents: 0 },
      { paid_at: '2027-01-05T16:00:00Z', paid_amount_cents: 8750 },
    );
    expect(html).toContain('Payment recorded');
    expect(html).toMatch(/Remaining balance<\/dt><dd[^>]*>\$0\.00<\/dd>/);
    expect(html).toContain('$87.50 payment recorded on Jan 5, 2027. Total accrued: $87.50.');
    expect(html).toContain('17.50');
    expect(html).not.toContain('Not paid');
  });
});
