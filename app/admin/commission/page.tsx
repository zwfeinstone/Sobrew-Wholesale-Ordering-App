import Link from 'next/link';
import { redirect } from 'next/navigation';
import StatusToast from '@/components/status-toast';
import { recordAdminAuditLog } from '@/lib/admin-audit';
import {
  addCommissionMonths,
  commissionMonthLabel,
  monthInputValue,
  normalizeCommissionMonth,
  numericCents,
  snapshotMissingCommissionOrdersForSalesProfileMonth,
  summarizeCommissionRows,
  type CommissionSnapshotRow,
  type CommissionSummary,
} from '@/lib/commissions';
import { adminCanEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { usd } from '@/lib/utils';

type AdminRow = {
  email: string | null;
  full_name: string | null;
  id: string;
  is_active: boolean | null;
};

type CenterRow = {
  id: string;
  is_active: boolean | null;
  name: string | null;
};

type PayoutRow = {
  commission_cents: number | string | null;
  commission_month: string;
  gross_profit_cents: number | string | null;
  id: string;
  order_count: number | null;
  paid_at: string | null;
  product_cogs_cents: number | string | null;
  revenue_cents: number | string | null;
  sales_profile_id: string;
  shipping_cogs_cents: number | string | null;
  status: string;
};

function profileLabel(profile: AdminRow | undefined | null) {
  return profile?.full_name || profile?.email || 'Sales admin';
}

function money(value: number | string | null | undefined) {
  return usd(Math.round(numericCents(value)));
}

function percent(value: number) {
  if (!value) return '0%';
  return `${value >= 0 ? '+' : ''}${value.toFixed(0)}%`;
}

function percentChange(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function payoutSummary(payout: PayoutRow): CommissionSummary {
  return {
    commissionCents: numericCents(payout.commission_cents),
    grossProfitCents: numericCents(payout.gross_profit_cents),
    orderCount: payout.order_count ?? 0,
    productCogsCents: numericCents(payout.product_cogs_cents),
    revenueCents: numericCents(payout.revenue_cents),
    shippingCogsCents: numericCents(payout.shipping_cogs_cents),
    totalCogsCents: numericCents(payout.product_cogs_cents) + numericCents(payout.shipping_cogs_cents),
  };
}

function commissionHref(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  return `/admin/commission?${query.toString()}`;
}

async function syncMissingCommissionSnapshots(formData: FormData) {
  'use server';

  const current = await requireAdminSectionView('commission');
  const canViewAll = current.isOwner || adminCanEdit(current.access, 'commission');
  const commissionMonth = normalizeCommissionMonth(String(formData.get('month') ?? ''));
  const requestedProfileId = String(formData.get('sales_profile_id') ?? '');
  const salesProfileId = canViewAll && requestedProfileId ? requestedProfileId : current.profile.id;

  if (!canViewAll && salesProfileId !== current.profile.id) {
    redirect('/admin/access-denied?section=commission');
  }

  const result = await snapshotMissingCommissionOrdersForSalesProfileMonth({
    commissionMonth,
    salesProfileId,
    supabase: supabaseAdmin,
  });

  const baseParams = {
    month: monthInputValue(commissionMonth),
    sales_profile_id: canViewAll ? salesProfileId : undefined,
  };

  if (result.error) {
    console.error('[commission] missing snapshot sync failed', result.error);
    redirect(commissionHref({ ...baseParams, toast: 'sync_error' }));
  }

  if (result.locked) {
    redirect(commissionHref({ ...baseParams, toast: 'sync_locked' }));
  }

  const changedCount = result.created + (result.updated ?? 0);
  if (changedCount > 0) {
    await recordAdminAuditLog({
      action: 'commission_missing_snapshots_synced',
      actorProfileId: current.profile.id,
      after: {
        commission_month: commissionMonth,
        created: result.created,
        sales_profile_id: salesProfileId,
        skipped: result.skipped,
        updated: result.updated ?? 0,
      },
      sectionKey: 'commission',
      supabase: supabaseAdmin,
      targetProfileId: salesProfileId,
    });
  }

  redirect(commissionHref({ ...baseParams, toast: changedCount > 0 ? 'sync_saved' : 'sync_none' }));
}

function StatTile({ label, value, detail }: { detail: string; label: string; value: string }) {
  return (
    <div className="stat-card">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

export default async function CommissionPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const current = await requireAdminSectionView('commission');
  const canViewAll = current.isOwner || adminCanEdit(current.access, 'commission');
  const commissionMonth = normalizeCommissionMonth(searchParams?.month);
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const historyMonths = Array.from({ length: 13 }, (_, index) => addCommissionMonths(commissionMonth, -index));
  const previousMonth = addCommissionMonths(commissionMonth, -1);
  const priorYearMonth = addCommissionMonths(commissionMonth, -12);

  const [{ data: admins }, { data: assignmentRows }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id,email,full_name,is_active')
      .eq('is_admin', true)
      .order('full_name', { ascending: true }),
    supabaseAdmin
      .from('center_sales_assignments')
      .select('sales_profile_id'),
  ]);

  const adminRows = ((admins ?? []) as AdminRow[]).sort((a, b) => profileLabel(a).localeCompare(profileLabel(b)));
  const assignedSalesIds = new Set((assignmentRows ?? []).map((row: any) => row.sales_profile_id).filter(Boolean));
  const selectableAdmins = adminRows.filter((admin) => assignedSalesIds.has(admin.id) || admin.id === current.profile.id);
  const requestedProfileId = typeof searchParams?.sales_profile_id === 'string' ? searchParams.sales_profile_id : '';
  const selectedProfileId = canViewAll
    ? selectableAdmins.some((admin) => admin.id === requestedProfileId)
      ? requestedProfileId
      : selectableAdmins[0]?.id ?? current.profile.id
    : current.profile.id;
  const selectedAdmin = adminRows.find((admin) => admin.id === selectedProfileId);

  const [{ data: snapshots }, { data: payouts }, { data: assignments }, { data: centers }] = await Promise.all([
    supabaseAdmin
      .from('order_commission_snapshots')
      .select('id,order_id,center_id,sales_profile_id,shipped_at,commission_month,revenue_cents,product_cogs_cents,shipping_cogs_cents,total_cogs_cents,gross_profit_cents,commission_percent,commission_cents,cogs_estimated')
      .eq('sales_profile_id', selectedProfileId)
      .in('commission_month', historyMonths),
    supabaseAdmin
      .from('monthly_commission_payouts')
      .select('id,sales_profile_id,commission_month,status,order_count,revenue_cents,product_cogs_cents,shipping_cogs_cents,gross_profit_cents,commission_cents,paid_at')
      .eq('sales_profile_id', selectedProfileId)
      .in('commission_month', historyMonths),
    supabaseAdmin
      .from('center_sales_assignments')
      .select('center_id,sales_profile_id')
      .eq('sales_profile_id', selectedProfileId),
    supabaseAdmin
      .from('centers')
      .select('id,name,is_active'),
  ]);

  const centerById = new Map(((centers ?? []) as CenterRow[]).map((center) => [center.id, center]));
  const snapshotsByMonth = new Map<string, CommissionSnapshotRow[]>();
  for (const snapshot of (snapshots ?? []) as CommissionSnapshotRow[]) {
    const rows = snapshotsByMonth.get(snapshot.commission_month) ?? [];
    rows.push(snapshot);
    snapshotsByMonth.set(snapshot.commission_month, rows);
  }
  const payoutByMonth = new Map(((payouts ?? []) as PayoutRow[]).map((payout) => [payout.commission_month, payout]));

  function summaryForMonth(month: string) {
    const payout = payoutByMonth.get(month);
    return payout ? payoutSummary(payout) : summarizeCommissionRows(snapshotsByMonth.get(month) ?? []);
  }

  const currentSummary = summaryForMonth(commissionMonth);
  const previousSummary = summaryForMonth(previousMonth);
  const priorYearSummary = summaryForMonth(priorYearMonth);
  const currentSnapshots = snapshotsByMonth.get(commissionMonth) ?? [];
  const currentPayout = payoutByMonth.get(commissionMonth);

  const centerSummaries = Array.from(
    currentSnapshots.reduce<Map<string, CommissionSnapshotRow[]>>((map, snapshot) => {
      const centerId = snapshot.center_id ?? 'unknown';
      const rows = map.get(centerId) ?? [];
      rows.push(snapshot);
      map.set(centerId, rows);
      return map;
    }, new Map())
  ).map(([centerId, rows]) => ({ centerId, summary: summarizeCommissionRows(rows) }));

  const assignedCenters = ((assignments ?? []) as Array<{ center_id: string; sales_profile_id: string }>).map((assignment) => centerById.get(assignment.center_id)).filter(Boolean) as CenterRow[];
  const historyRows = historyMonths.map((month) => ({
    month,
    payout: payoutByMonth.get(month),
    summary: summaryForMonth(month),
  }));

  return (
    <div className="space-y-6">
      {toast === 'sync_saved' ? <StatusToast message="Commission snapshots synced." tone="success" /> : null}
      {toast === 'sync_none' ? <StatusToast message="No missing shipped orders found for this month." tone="success" /> : null}
      {toast === 'sync_locked' ? <StatusToast message="That commission month is locked or paid, so it was not changed." tone="error" /> : null}
      {toast === 'sync_error' ? <StatusToast message="Unable to sync missing commission snapshots." tone="error" /> : null}

      <section className="panel">
        <span className="eyebrow">Commission</span>
        <h1 className="page-title mt-4">Monthly commission</h1>
        <p className="page-subtitle mt-3">Review shipped-order gross profit, monthly commission, and month-over-month performance.</p>
      </section>

      <form className="card grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem_auto] md:items-end">
        {canViewAll ? (
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Sales admin
            <select className="input" name="sales_profile_id" defaultValue={selectedProfileId}>
              {selectableAdmins.map((admin) => (
                <option key={admin.id} value={admin.id}>{profileLabel(admin)}</option>
              ))}
            </select>
          </label>
        ) : (
          <div>
            <p className="text-sm font-semibold text-slate-950">{profileLabel(selectedAdmin)}</p>
            <p className="mt-1 text-sm text-slate-500">Your commission statement</p>
          </div>
        )}
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Month
          <input className="input" name="month" type="month" defaultValue={monthInputValue(commissionMonth)} />
        </label>
        <button className="btn-primary w-full md:w-auto" type="submit">Run report</button>
      </form>

      <section className="card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Statement</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{profileLabel(selectedAdmin)} - {commissionMonthLabel(commissionMonth)}</h2>
          </div>
          <span className="w-fit rounded-full border border-teal-100 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">
            {currentPayout?.status ?? 'Open'}
          </span>
        </div>
        {!currentPayout ? (
          <form action={syncMissingCommissionSnapshots} className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-slate-950">Missing revenue after assignment?</p>
              <p className="mt-1 text-sm text-slate-500">Sync or refresh shipped orders from currently assigned centers. Orders without product COGS stay at $0 commission.</p>
            </div>
            <input name="sales_profile_id" type="hidden" value={selectedProfileId} />
            <input name="month" type="hidden" value={monthInputValue(commissionMonth)} />
            <button className="btn-secondary w-full sm:w-auto" type="submit">Sync missing shipped orders</button>
          </form>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <StatTile label="Revenue" value={money(currentSummary.revenueCents)} detail={`${currentSummary.orderCount.toLocaleString()} shipped order(s).`} />
        <StatTile label="Gross profit" value={money(currentSummary.grossProfitCents)} detail="Revenue less product and shipping COGS." />
        <StatTile label="Commission" value={money(currentSummary.commissionCents)} detail={`MoM ${percent(percentChange(currentSummary.commissionCents, previousSummary.commissionCents))}.`} />
        <StatTile label="YoY commission" value={percent(percentChange(currentSummary.commissionCents, priorYearSummary.commissionCents))} detail={`Compared with ${commissionMonthLabel(priorYearMonth)}.`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Assigned centers</h2>
            <p className="mt-1 text-sm text-slate-500">Only orders from assigned centers are credited at shipment.</p>
          </div>
          {!assignedCenters.length ? <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">No centers are currently assigned.</div> : null}
          <div className="space-y-2">
            {assignedCenters.map((center) => (
              <div key={center.id} className="rounded-2xl border border-slate-200 bg-white/65 px-4 py-3">
                <p className="font-semibold text-slate-950">{center.name || 'Unnamed center'}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{center.is_active === false ? 'Inactive' : 'Active'}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Center totals</h2>
            <p className="mt-1 text-sm text-slate-500">Current month commission grouped by customer.</p>
          </div>
          {!centerSummaries.length ? <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">No commission snapshots for this month.</div> : null}
          <div className="space-y-2">
            {centerSummaries.map((row) => {
              const center = centerById.get(row.centerId);
              return (
                <div key={row.centerId} className="rounded-2xl border border-slate-200 bg-white/65 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-950">{center?.name || 'Unknown center'}</p>
                    <p className="font-semibold text-slate-950">{money(row.summary.commissionCents)}</p>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{row.summary.orderCount} order(s) - {money(row.summary.grossProfitCents)} gross profit</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Monthly history</h2>
          <p className="mt-1 text-sm text-slate-500">Month-over-month and year-over-year context for this salesperson.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-separate border-spacing-y-2 text-left text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-4 py-2">Month</th>
                <th className="px-4 py-2 text-right">Orders</th>
                <th className="px-4 py-2 text-right">Revenue</th>
                <th className="px-4 py-2 text-right">Gross profit</th>
                <th className="px-4 py-2 text-right">Commission</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row) => (
                <tr key={row.month} className="bg-white/65">
                  <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{commissionMonthLabel(row.month)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{row.summary.orderCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{money(row.summary.revenueCents)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{money(row.summary.grossProfitCents)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-950">{money(row.summary.commissionCents)}</td>
                  <td className="rounded-r-xl px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{row.payout?.status ?? 'Open'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Order detail</h2>
          <p className="mt-1 text-sm text-slate-500">Commission snapshots for {commissionMonthLabel(commissionMonth)}.</p>
        </div>
        {!currentSnapshots.length ? <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">No shipped orders credited this month. If centers were assigned after shipment, use the sync button above.</div> : null}
        <div className="space-y-2">
          {currentSnapshots.map((snapshot) => {
            const center = snapshot.center_id ? centerById.get(snapshot.center_id) : null;
            return (
              <Link key={snapshot.id} href={`/admin/orders/${snapshot.order_id}`} className="block rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 transition-all duration-200 hover:border-teal-200 hover:bg-teal-50/70">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-950">{center?.name || 'Unknown center'}</p>
                    <p className="mt-1 text-sm text-slate-500">{snapshot.shipped_at ? new Date(snapshot.shipped_at).toLocaleDateString('en-US') : 'Unknown ship date'}</p>
                  </div>
                  <div className="text-sm sm:text-right">
                    <p className="font-semibold text-slate-950">{money(snapshot.commission_cents)} commission</p>
                    <p className="mt-1 text-slate-500">{money(snapshot.gross_profit_cents)} gross profit at {Number(snapshot.commission_percent ?? 0).toFixed(2)}%</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
