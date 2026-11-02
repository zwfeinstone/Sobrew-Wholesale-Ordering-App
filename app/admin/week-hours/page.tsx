import Link from 'next/link';
import DeferredPaySummaryCard from '@/components/deferred-pay-summary';
import WeekHoursMileage from '@/components/week-hours-mileage';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { getCommissionInvoiceEligibility, type CommissionInvoiceEligibility } from '@/lib/commission-invoice-eligibility';
import { loadDeferredPayForProfile } from '@/lib/deferred-pay-data';
import { isMileageReimbursement } from '@/lib/payroll-mileage';
import { getCurrentPayrollWeekWindow } from '@/lib/payroll-status';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllByIds, fetchAllPages } from '@/lib/supabase/pagination';
import {
  completedBreakMinutes,
  formatCentralDateInput,
  formatCentralDateTime,
  hoursLabel,
  normalizeMoneyCents,
  paidMinutes,
  parseCentralDateInput,
  workTypeLabel,
} from '@/lib/time-clock';
import { usd } from '@/lib/utils';

type SearchParams = Record<string, string | string[] | undefined>;

type TimeBreak = {
  break_end_at: string | null;
  break_start_at: string;
  status: string | null;
};

type TimeEntry = {
  admin_time_breaks?: TimeBreak[];
  clock_in_at: string;
  clock_out_at: string | null;
  hourly_rate_cents_snapshot: number | string | null;
  id: string;
  status: string | null;
  work_type: string | null;
};

type WeeklySalesSpiff = {
  amount_cents: number | string | null;
  first_order_id: string | null;
  id: string;
  notes: string | null;
  paid_at: string | null;
  profile_id: string | null;
  week_end_date: string;
  week_start_date: string;
};

type SpiffOrder = {
  centers: { name: string } | { name: string }[] | null;
  id: string;
  quickbooks_invoice_doc_number: string | null;
  shipping_company: string | null;
  shipping_name: string | null;
};

type SpiffStatus = 'payable' | 'awaiting_payment' | 'unverified' | 'paid';
type SpiffView = WeeklySalesSpiff & { paymentStatus: SpiffStatus; paymentDetail: string };

function spiffPaymentStatus(spiff: WeeklySalesSpiff, eligibility: CommissionInvoiceEligibility): Pick<SpiffView, 'paymentStatus' | 'paymentDetail'> {
  if (spiff.paid_at) return { paymentStatus: 'paid', paymentDetail: formatCentralDateTime(spiff.paid_at) };
  if (!spiff.first_order_id) return { paymentStatus: 'payable', paymentDetail: 'Invoice payment is not required for this SPIFF.' };
  if (eligibility.error) return { paymentStatus: 'unverified', paymentDetail: 'Customer invoice payment could not be verified.' };
  if (eligibility.paidOrderIds.has(spiff.first_order_id)) return { paymentStatus: 'payable', paymentDetail: 'Customer invoice paid in full.' };
  if (eligibility.unpaidOrderIds.has(spiff.first_order_id)) return { paymentStatus: 'awaiting_payment', paymentDetail: 'Awaiting full customer invoice payment.' };
  if (eligibility.missingInvoiceOrderIds.has(spiff.first_order_id)) return { paymentStatus: 'unverified', paymentDetail: 'Customer invoice is not linked or is unavailable.' };
  return { paymentStatus: 'unverified', paymentDetail: 'Customer invoice payment could not be verified.' };
}

const SPIFF_STATUS_LABELS: Record<SpiffStatus, string> = {
  payable: 'Payable now',
  awaiting_payment: 'Not payable yet',
  unverified: 'Verification unavailable',
  paid: 'Paid to you',
};

const SPIFF_STATUS_STYLES: Record<SpiffStatus, string> = {
  payable: 'bg-emerald-100 text-emerald-800',
  awaiting_payment: 'bg-amber-100 text-amber-900',
  unverified: 'bg-amber-100 text-amber-900',
  paid: 'bg-slate-100 text-slate-700',
};

function entryBreaks(entry: TimeEntry) {
  return (entry.admin_time_breaks ?? []) as TimeBreak[];
}

function stringParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

function dateInputParam(value: string | string[] | undefined, fallback: string) {
  const raw = stringParam(value);
  return parseCentralDateInput(raw) ? raw : fallback;
}

function normalizeDateRange(fromInput: string, toInput: string) {
  return fromInput <= toInput
    ? { fromInput, toInput }
    : { fromInput: toInput, toInput: fromInput };
}

function dateRangesOverlap(startInput: string, endInput: string, rangeStartInput: string, rangeEndInput: string) {
  return startInput <= rangeEndInput && endInput >= rangeStartInput;
}

function formatDateInputLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function isWithin(entry: TimeEntry, start: Date, end: Date) {
  const clockIn = new Date(entry.clock_in_at);
  return clockIn >= start && clockIn <= end;
}

function completedPaidMinutes(entries: TimeEntry[], start: Date, end: Date) {
  return entries
    .filter((entry) => entry.status !== 'void' && entry.clock_out_at && isWithin(entry, start, end))
    .reduce((sum, entry) => sum + paidMinutes(entry, entryBreaks(entry)), 0);
}

function spiffTotalCents(spiffs: WeeklySalesSpiff[]) {
  return spiffs.reduce((sum, spiff) => sum + normalizeMoneyCents(spiff.amount_cents), 0);
}

function StatCard({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="stat-card">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

function EmptyState({
  detail = 'Completed shifts will show here after you clock out.',
  title = 'No completed hours this week.',
}: {
  detail?: string;
  title?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white/50 px-4 py-8 text-center">
      <p className="font-semibold text-slate-950">{title}</p>
      <p className="mt-2 text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function SpiffGroup({ id, title, detail, empty, spiffs, ordersById }: {
  id: string;
  title: string;
  detail: string;
  empty: string;
  spiffs: SpiffView[];
  ordersById: Map<string, SpiffOrder>;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4" role="region" aria-labelledby={id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={id} className="text-lg font-semibold text-slate-950">{title}</h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{detail}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-slate-950">{usd(spiffTotalCents(spiffs))}</p>
          <p className="mt-1 text-sm text-slate-500">{spiffs.length} SPIFF{spiffs.length === 1 ? '' : 's'}</p>
        </div>
      </div>
      {spiffs.length ? <SpiffTable spiffs={spiffs} ordersById={ordersById} /> : <p className="text-sm text-slate-500">{empty}</p>}
    </div>
  );
}

function SpiffTable({ spiffs, ordersById }: { spiffs: SpiffView[]; ordersById: Map<string, SpiffOrder> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[58rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Earned week</th>
            <th className="px-4 py-2">Customer / order</th>
            <th className="px-4 py-2 text-right">Amount</th>
            <th className="px-4 py-2">SPIFF status</th>
            <th className="px-4 py-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {spiffs.map((spiff) => {
            const order = spiff.first_order_id ? ordersById.get(spiff.first_order_id) : undefined;
            const center = Array.isArray(order?.centers) ? order.centers[0] : order?.centers;
            const invoiceNumber = order?.quickbooks_invoice_doc_number?.trim();
            return (
              <tr key={spiff.id} className="bg-white/70">
                <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">
                  {formatDateInputLabel(spiff.week_start_date)} to {formatDateInputLabel(spiff.week_end_date)}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {spiff.first_order_id ? (
                    <>
                      <p className="font-semibold text-slate-950">{center?.name || order?.shipping_company || order?.shipping_name || 'Customer details unavailable'}</p>
                      <p className="mt-1 text-xs text-slate-500">{invoiceNumber ? `Invoice ${invoiceNumber}` : `Order ${spiff.first_order_id.slice(0, 8)}`}</p>
                    </>
                  ) : 'See SPIFF notes'}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-slate-950">{usd(normalizeMoneyCents(spiff.amount_cents))}</td>
                <td className="px-4 py-3 text-slate-700">
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${SPIFF_STATUS_STYLES[spiff.paymentStatus]}`}>{SPIFF_STATUS_LABELS[spiff.paymentStatus]}</span>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{spiff.paymentDetail}</p>
                </td>
                <td className="rounded-r-xl px-4 py-3 text-slate-600">{spiff.notes || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function WeekHoursPage(props: { searchParams?: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const current = await requireAdminSectionView('week_hours');
  const now = new Date();
  const todayInput = formatCentralDateInput(now);
  const week = getCurrentPayrollWeekWindow(now);
  const monthStartInput = `${todayInput.slice(0, 8)}01`;
  const yearStartInput = `${todayInput.slice(0, 4)}-01-01`;
  const monthStart = parseCentralDateInput(monthStartInput)!;
  const yearStart = parseCentralDateInput(yearStartInput)!;
  const todayEnd = parseCentralDateInput(todayInput, true)!;
  const queryStart = new Date(Math.min(yearStart.getTime(), week.weekStart.getTime()));
  const queryEnd = new Date(Math.max(todayEnd.getTime(), week.weekEnd.getTime()));
  const defaultSpiffFromInput = monthStartInput;
  const defaultSpiffToInput = todayInput;
  const { fromInput: spiffFromInput, toInput: spiffToInput } = normalizeDateRange(
    dateInputParam(searchParams?.spiff_from, defaultSpiffFromInput),
    dateInputParam(searchParams?.spiff_to, defaultSpiffToInput)
  );
  const { fromInput: mileageFromInput, toInput: mileageToInput } = normalizeDateRange(
    dateInputParam(searchParams?.mileage_from, monthStartInput),
    dateInputParam(searchParams?.mileage_to, todayInput)
  );
  const spiffQueryStartInput = [week.weekStartInput, spiffFromInput, mileageFromInput].sort()[0];
  const spiffQueryEndInput = [week.weekEndInput, spiffToInput, mileageToInput].sort()[2];

  const [timeEntriesResult, weeklySalesSpiffsResult, deferredPayResult] = await Promise.all([
    supabaseAdmin
      .from('admin_time_entries')
      .select('id,clock_in_at,clock_out_at,hourly_rate_cents_snapshot,status,work_type,admin_time_breaks(break_start_at,break_end_at,status)')
      .eq('profile_id', current.profile.id)
      .gte('clock_in_at', queryStart.toISOString())
      .lte('clock_in_at', queryEnd.toISOString())
      .order('clock_in_at', { ascending: false })
      .limit(50000),
    fetchAllPages<WeeklySalesSpiff>((from, to) => supabaseAdmin
      .from('admin_weekly_sales_spiffs')
      .select('id,profile_id,week_start_date,week_end_date,amount_cents,paid_at,notes,first_order_id')
      .eq('profile_id', current.profile.id)
      .or(`and(week_start_date.lte.${spiffQueryEndInput},week_end_date.gte.${spiffQueryStartInput}),and(first_order_id.not.is.null,paid_at.is.null,week_start_date.lte.${week.weekEndInput}),and(first_order_id.is.null,notes.ilike.*mileage*,paid_at.is.null,week_start_date.lte.${week.weekEndInput}),and(first_order_id.not.is.null,paid_at.gte.${week.weekStart.toISOString()},paid_at.lte.${queryEnd.toISOString()},week_start_date.lte.${week.weekEndInput})`)
      .order('week_start_date', { ascending: false })
      .order('paid_at', { ascending: false })
      .order('id')
      .range(from, to)),
    loadDeferredPayForProfile(supabaseAdmin, current.profile.id, now),
  ]);

  if (timeEntriesResult.error) {
    console.error('[admin-week-hours] page load failed', { error: timeEntriesResult.error, profileId: current.profile.id });
    return (
      <div className="space-y-6">
        <section className="panel">
          <span className="eyebrow">Week Hours</span>
          <h1 className="page-title mt-4">Week Hours</h1>
          <p className="page-subtitle mt-3">Your hours could not be loaded.</p>
        </section>
        <section className="card text-sm text-red-700">Refresh the page after confirming the latest time clock data is available.</section>
      </div>
    );
  }
  if (weeklySalesSpiffsResult.error) {
    console.error('[admin-week-hours] weekly sales SPIFF records failed', { error: weeklySalesSpiffsResult.error, profileId: current.profile.id });
  }
  if (deferredPayResult.error) {
    console.error('[admin-week-hours] deferred pay failed', { error: deferredPayResult.error, profileId: current.profile.id });
  }

  const entries = ((timeEntriesResult.data ?? []) as TimeEntry[]).filter((entry) => entry.status !== 'void');
  const ownPayments = weeklySalesSpiffsResult.data.filter((spiff) => spiff.profile_id === current.profile.id);
  const ownMileage = ownPayments.filter(isMileageReimbursement);
  const ownSpiffs = ownPayments.filter((payment) => !isMileageReimbursement(payment));
  const [invoiceEligibility, spiffOrdersResult] = await Promise.all([
    getCommissionInvoiceEligibility(ownSpiffs.filter((spiff) => !spiff.paid_at && spiff.first_order_id).map((spiff) => spiff.first_order_id!)),
    fetchAllByIds<SpiffOrder>(ownSpiffs.flatMap((spiff) => spiff.first_order_id ? [spiff.first_order_id] : []), (ids, from, to) => supabaseAdmin
      .from('orders')
      .select('id,quickbooks_invoice_doc_number,shipping_company,shipping_name,centers(name)')
      .in('id', ids)
      .order('id')
      .range(from, to)),
  ]);
  if (invoiceEligibility.error || spiffOrdersResult.error) {
    console.error('[admin-week-hours] SPIFF invoice details failed', { invoiceError: invoiceEligibility.error, orderError: spiffOrdersResult.error, profileId: current.profile.id });
  }
  const ordersById = new Map(spiffOrdersResult.data.map((order) => [order.id, order]));
  const weeklySalesSpiffs: SpiffView[] = ownSpiffs.map((spiff) => ({ ...spiff, ...spiffPaymentStatus(spiff, invoiceEligibility) }));
  const currentWeekSpiffs = weeklySalesSpiffs.filter((spiff) => dateRangesOverlap(spiff.week_start_date, spiff.week_end_date, week.weekStartInput, week.weekEndInput));
  const outstandingEarlierSpiffs = weeklySalesSpiffs.filter((spiff) => spiff.week_end_date < week.weekStartInput && spiff.first_order_id && !spiff.paid_at);
  const currentSpiffs = [...currentWeekSpiffs, ...outstandingEarlierSpiffs];
  const payableSpiffs = currentSpiffs.filter((spiff) => spiff.paymentStatus === 'payable');
  const pendingSpiffs = currentSpiffs.filter((spiff) => spiff.paymentStatus === 'awaiting_payment' || spiff.paymentStatus === 'unverified');
  // Keep a carryover visible after payroll records its payment, including on weekends.
  const paidEarlierSpiffs = weeklySalesSpiffs.filter((spiff) => {
    const paidAt = spiff.paid_at ? new Date(spiff.paid_at).getTime() : NaN;
    return spiff.week_end_date < week.weekStartInput && spiff.first_order_id
      && paidAt >= week.weekStart.getTime() && paidAt <= queryEnd.getTime();
  });
  const paidSpiffs = [...currentWeekSpiffs.filter((spiff) => spiff.paymentStatus === 'paid'), ...paidEarlierSpiffs];
  const historicalSpiffs = weeklySalesSpiffs.filter((spiff) => dateRangesOverlap(spiff.week_start_date, spiff.week_end_date, spiffFromInput, spiffToInput));
  const weekEntries = entries.filter((entry) => isWithin(entry, week.weekStart, week.weekEnd));
  const completedWeekEntries = weekEntries.filter((entry) => entry.clock_out_at);
  const openWeekEntries = weekEntries.filter((entry) => !entry.clock_out_at);
  const weekMinutes = completedPaidMinutes(entries, week.weekStart, week.weekEnd);
  const monthMinutes = completedPaidMinutes(entries, monthStart, todayEnd);
  const yearMinutes = completedPaidMinutes(entries, yearStart, todayEnd);
  const payableSpiffCents = spiffTotalCents(payableSpiffs);
  const historicalSpiffCents = spiffTotalCents(historicalSpiffs);

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Week Hours</span>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="page-title">Your hours</h1>
            <p className="page-subtitle mt-3">
              {formatDateInputLabel(week.weekStartInput)} to {formatDateInputLabel(week.weekEndInput)}. Completed shifts count toward totals after you clock out.
            </p>
          </div>
          <Link className="btn-secondary w-full sm:w-auto" href="/admin/time-clock">Time Clock</Link>
        </div>
      </section>

      {deferredPayResult.error ? (
        <section className="card text-sm text-red-700" role="alert">
          Deferred pay could not be loaded. Refresh the page or contact payroll; the balance is unavailable.
        </section>
      ) : deferredPayResult.data.map(({ plan, summary }) => (
        <DeferredPaySummaryCard key={plan.id} plan={plan} summary={summary} />
      ))}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="This Week" value={`${hoursLabel(weekMinutes)} hrs`} detail="Current Monday-Friday payroll week." />
        <StatCard label="This Month" value={`${hoursLabel(monthMinutes)} hrs`} detail={`Since ${formatDateInputLabel(monthStartInput)}.`} />
        <StatCard label="YTD" value={`${hoursLabel(yearMinutes)} hrs`} detail={`Since ${formatDateInputLabel(yearStartInput)}.`} />
        <StatCard
          label="SPIFFs Payable Now"
          value={weeklySalesSpiffsResult.error ? 'Unavailable' : usd(payableSpiffCents)}
          detail={weeklySalesSpiffsResult.error ? 'SPIFF records could not be loaded.' : `${payableSpiffs.length} SPIFF${payableSpiffs.length === 1 ? '' : 's'} ready for payroll, including eligible carryovers.`}
        />
      </section>

      {weeklySalesSpiffsResult.error ? (
        <section className="card text-sm text-red-700">SPIFF and mileage payment records could not be loaded. Refresh the page or contact payroll.</section>
      ) : null}
      {invoiceEligibility.error ? (
        <section className="card text-sm text-amber-900" role="alert">Customer invoice payments could not be verified. Linked SPIFFs awaiting verification are excluded from payable totals; refresh to check again.</section>
      ) : null}

      {openWeekEntries.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
          {openWeekEntries.length} open shift{openWeekEntries.length === 1 ? '' : 's'} will count after clock out.
        </section>
      ) : null}

      <WeekHoursMileage
        payments={ownMileage}
        error={Boolean(weeklySalesSpiffsResult.error)}
        weekStart={week.weekStartInput}
        weekEnd={week.weekEndInput}
        from={mileageFromInput}
        to={mileageToInput}
        spiffFrom={spiffFromInput}
        spiffTo={spiffToInput}
      />

      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">SPIFF payment status</h2>
          <p className="mt-1 text-sm text-slate-500">First-order SPIFFs become payable when the customer invoice is paid in full. Paid to you means payroll has already paid the SPIFF.</p>
          {outstandingEarlierSpiffs.length ? <p className="mt-1 text-sm text-slate-500">Includes {outstandingEarlierSpiffs.length} unpaid first-order SPIFF{outstandingEarlierSpiffs.length === 1 ? '' : 's'} from earlier weeks.</p> : null}
        </div>
        {weeklySalesSpiffsResult.error ? <p className="text-sm text-slate-500">SPIFF totals are unavailable.</p> : (
          <>
            <SpiffGroup
              id="spiffs-payable" title="Payable now"
              detail="Ready for payroll and not yet paid to you. Includes eligible first-order SPIFFs carried over from earlier weeks."
              empty="No SPIFFs are ready for payroll right now."
              spiffs={payableSpiffs} ordersById={ordersById}
            />
            <SpiffGroup
              id="spiffs-pending" title="Pending"
              detail="Waiting for full customer invoice payment or payment verification. These amounts are excluded from payable now."
              empty="No SPIFFs are pending."
              spiffs={pendingSpiffs} ordersById={ordersById}
            />
            <SpiffGroup
              id="spiffs-paid" title="Already paid"
              detail="SPIFFs recorded for this week that payroll has marked paid, plus earlier first-order SPIFFs paid to you this week. Older records are in SPIFF history."
              empty="No SPIFFs have been marked paid for this week."
              spiffs={paidSpiffs} ordersById={ordersById}
            />
          </>
        )}
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">This week shifts</h2>
          <p className="mt-1 text-sm text-slate-500">Read-only shift detail for the current payroll week.</p>
        </div>
        {!completedWeekEntries.length ? <EmptyState /> : null}
        {weekEntries.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] border-separate border-spacing-y-2 text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Labor tag</th>
                  <th className="px-4 py-2">Clock in</th>
                  <th className="px-4 py-2">Clock out</th>
                  <th className="px-4 py-2 text-right">Lunch / break</th>
                  <th className="px-4 py-2 text-right">Paid hours</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {weekEntries.map((entry) => {
                  const breaks = entryBreaks(entry);
                  const breakMinutes = completedBreakMinutes(breaks);
                  const entryPaidMinutes = paidMinutes(entry, breaks);
                  return (
                    <tr key={entry.id} className="bg-white/70">
                      <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{formatDateInputLabel(formatCentralDateInput(entry.clock_in_at))}</td>
                      <td className="px-4 py-3 text-slate-700">{workTypeLabel(entry.work_type)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatCentralDateTime(entry.clock_in_at)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatCentralDateTime(entry.clock_out_at)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{hoursLabel(breakMinutes)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-950">{hoursLabel(entryPaidMinutes)}</td>
                      <td className="rounded-r-xl px-4 py-3">
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700">{entry.status ?? 'submitted'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card space-y-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">SPIFF history</h2>
            <p className="mt-1 text-sm text-slate-500">{weeklySalesSpiffsResult.error ? 'SPIFF totals are unavailable.' : `${usd(historicalSpiffCents)} recorded from ${formatDateInputLabel(spiffFromInput)} to ${formatDateInputLabel(spiffToInput)}. Payment statuses are current.`}</p>
          </div>
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input type="hidden" name="mileage_from" value={mileageFromInput} />
            <input type="hidden" name="mileage_to" value={mileageToInput} />
            <label className="space-y-2 text-sm font-medium text-slate-700">
              From
              <input className="input" name="spiff_from" type="date" defaultValue={spiffFromInput} />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              To
              <input className="input" name="spiff_to" type="date" defaultValue={spiffToInput} />
            </label>
            <div className="flex items-end">
              <button className="btn-primary w-full" type="submit">Update</button>
            </div>
          </form>
        </div>
        {weeklySalesSpiffsResult.error ? null : !historicalSpiffs.length ? (
          <EmptyState title="No SPIFFs in this range." detail="Try a different date range." />
        ) : (
          <SpiffTable spiffs={historicalSpiffs} ordersById={ordersById} />
        )}
      </section>
    </div>
  );
}
