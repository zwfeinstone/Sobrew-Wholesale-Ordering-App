import StatusToast from '@/components/status-toast';
import {
  SalesAdminBulkAssignment,
  type SalesAdminBulkCenter,
  type SalesAdminBulkRep,
} from '@/components/sales-admin-bulk-assignment';
import { recordAdminAuditLog } from '@/lib/admin-audit';
import { hasSuperadminAccess } from '@/lib/admin-permission-definitions';
import { requireAdminSectionEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import {
  addCommissionMonths,
  commissionMonthLabel,
  emptyCommissionSummary,
  monthInputValue,
  normalizeCommissionMonth,
  numericCents,
  snapshotMissingCommissionOrdersForSalesProfileMonth,
  summarizeCommissionRows,
  type CommissionSnapshotRow,
  type CommissionSummary,
} from '@/lib/commissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { usd } from '@/lib/utils';
import { redirect } from 'next/navigation';

type AdminRow = {
  email: string | null;
  full_name: string | null;
  id: string;
  is_active: boolean | null;
  is_superadmin?: boolean | null;
};

type CenterRow = {
  id: string;
  is_active: boolean | null;
  name: string | null;
};

type AssignmentRow = {
  center_id: string;
  sales_profile_id: string;
};

type CenterAccessAssignmentRow = {
  center_id: string;
  profile_id: string;
};

type CommissionSettingRow = {
  commission_percent: number | string | null;
  is_sales_rep: boolean | null;
  profile_id: string;
};

type PayoutRow = {
  commission_cents: number | string | null;
  commission_month: string;
  donation_cogs_cents?: number | string | null;
  gross_profit_cents: number | string | null;
  id: string;
  order_count: number | null;
  paid_at: string | null;
  processing_fee_cogs_cents?: number | string | null;
  product_cogs_cents: number | string | null;
  revenue_cents: number | string | null;
  sales_profile_id: string;
  shipping_cogs_cents: number | string | null;
  status: string;
  total_cogs_cents?: number | string | null;
};

function salesAdminHref(toast: string, month?: string, extras: Record<string, string | undefined> = {}) {
  const query = new URLSearchParams({ toast });
  if (month) query.set('month', monthInputValue(month));
  for (const [key, value] of Object.entries(extras)) {
    if (value) query.set(key, value);
  }
  return `/admin/sales-admin?${query.toString()}`;
}

function profileLabel(profile: AdminRow | undefined) {
  return profile?.full_name || profile?.email || 'Unknown admin';
}

function stringParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

function filterParamsFromForm(formData: FormData) {
  return {
    assigned_rep: String(formData.get('assigned_rep') ?? ''),
    center_status: String(formData.get('center_status') ?? ''),
    q: String(formData.get('q') ?? ''),
    sales_rep: String(formData.get('sales_rep') ?? ''),
  };
}

async function isAssignableSalesRep(profileId: string) {
  const { data, error } = await supabaseAdmin
    .from('admin_commission_settings')
    .select('profile_id,is_sales_rep')
    .eq('profile_id', profileId)
    .eq('is_sales_rep', true)
    .maybeSingle();

  if (error) return false;
  return Boolean(data?.is_sales_rep);
}

function money(value: number | string | null | undefined) {
  return usd(Math.round(numericCents(value)));
}

function percentChange(current: number, previous: number) {
  if (!previous) return current ? '+100%' : '0%';
  const change = ((current - previous) / Math.abs(previous)) * 100;
  return `${change >= 0 ? '+' : ''}${change.toFixed(0)}%`;
}

function payoutSummary(payout: PayoutRow): CommissionSummary {
  return {
    commissionCents: numericCents(payout.commission_cents),
    donationCogsCents: numericCents(payout.donation_cogs_cents),
    grossProfitCents: numericCents(payout.gross_profit_cents),
    orderCount: payout.order_count ?? 0,
    processingFeeCogsCents: numericCents(payout.processing_fee_cogs_cents),
    productCogsCents: numericCents(payout.product_cogs_cents),
    revenueCents: numericCents(payout.revenue_cents),
    shippingCogsCents: numericCents(payout.shipping_cogs_cents),
    totalCogsCents: numericCents(payout.total_cogs_cents)
      || numericCents(payout.product_cogs_cents)
        + numericCents(payout.shipping_cogs_cents)
        + numericCents(payout.processing_fee_cogs_cents)
        + numericCents(payout.donation_cogs_cents),
  };
}

async function assignCenterSalesAdmin(formData: FormData) {
  'use server';

  const current = await requireAdminSectionEdit('sales_admin', '/admin/sales-admin?toast=write_denied');
  const centerId = String(formData.get('center_id') ?? '');
  const salesProfileId = String(formData.get('sales_profile_id') ?? '');
  const month = String(formData.get('month') ?? '');
  if (!centerId) redirect(salesAdminHref('assignment_error', month ? `${month}-01` : undefined));
  if (salesProfileId && !(await isAssignableSalesRep(salesProfileId))) {
    redirect(salesAdminHref('assignment_error', month ? `${month}-01` : undefined));
  }

  const { data: before } = await supabaseAdmin
    .from('center_sales_assignments')
    .select('center_id,sales_profile_id')
    .eq('center_id', centerId)
    .maybeSingle();

  let result;
  if (salesProfileId && before) {
    result = await supabaseAdmin
      .from('center_sales_assignments')
      .update({
        sales_profile_id: salesProfileId,
        updated_at: new Date().toISOString(),
        updated_by: current.profile.id,
      })
      .eq('center_id', centerId);
  } else if (salesProfileId) {
    result = await supabaseAdmin.from('center_sales_assignments').insert(
        {
          assigned_at: new Date().toISOString(),
          assigned_by: current.profile.id,
          center_id: centerId,
          sales_profile_id: salesProfileId,
          updated_at: new Date().toISOString(),
          updated_by: current.profile.id,
        }
      );
  } else {
    result = await supabaseAdmin.from('center_sales_assignments').delete().eq('center_id', centerId);
  }

  if (result.error) redirect(salesAdminHref('assignment_error', month ? `${month}-01` : undefined));

  if (salesProfileId) {
    await snapshotMissingCommissionOrdersForSalesProfileMonth({
      centerIds: [centerId],
      commissionMonth: normalizeCommissionMonth(month),
      salesProfileId,
      supabase: supabaseAdmin,
    });
  }

  await recordAdminAuditLog({
    action: salesProfileId ? 'center_sales_admin_assigned' : 'center_sales_admin_unassigned',
    actorProfileId: current.profile.id,
    after: { center_id: centerId, sales_profile_id: salesProfileId || null },
    before,
    sectionKey: 'sales_admin',
    supabase: supabaseAdmin,
    targetProfileId: salesProfileId || before?.sales_profile_id || null,
  });

  redirect(salesAdminHref('assignment_saved', month ? `${month}-01` : undefined));
}

async function bulkAssignCenterSalesAdmins(formData: FormData) {
  'use server';

  const current = await requireAdminSectionEdit('sales_admin', '/admin/sales-admin?toast=write_denied');
  if (!current.isOwner) redirect('/admin/access-denied?section=sales_admin&mode=edit');

  const centerIds = [...new Set(formData.getAll('center_id').map(String).filter(Boolean))];
  const bulkAction = String(formData.get('bulk_action') ?? 'assign');
  const salesProfileId = String(formData.get('sales_profile_id') ?? '');
  const month = String(formData.get('month') ?? '');
  const filters = filterParamsFromForm(formData);
  const redirectMonth = month ? `${month}-01` : undefined;

  if (!centerIds.length) redirect(salesAdminHref('bulk_assignment_error', redirectMonth, filters));
  if (!['assign', 'unassign'].includes(bulkAction)) redirect(salesAdminHref('bulk_assignment_error', redirectMonth, filters));
  if (bulkAction === 'assign' && (!salesProfileId || !(await isAssignableSalesRep(salesProfileId)))) {
    redirect(salesAdminHref('bulk_assignment_error', redirectMonth, filters));
  }

  const { data: before } = await supabaseAdmin
    .from('center_sales_assignments')
    .select('center_id,sales_profile_id')
    .in('center_id', centerIds);

  const now = new Date().toISOString();
  const result = bulkAction === 'unassign'
    ? await supabaseAdmin.from('center_sales_assignments').delete().in('center_id', centerIds)
    : await supabaseAdmin.from('center_sales_assignments').upsert(
      centerIds.map((centerId) => ({
        assigned_at: now,
        assigned_by: current.profile.id,
        center_id: centerId,
        sales_profile_id: salesProfileId,
        updated_at: now,
        updated_by: current.profile.id,
      })),
      { onConflict: 'center_id' }
    );

  if (result.error) redirect(salesAdminHref('bulk_assignment_error', redirectMonth, filters));

  if (bulkAction === 'assign') {
    await snapshotMissingCommissionOrdersForSalesProfileMonth({
      centerIds,
      commissionMonth: normalizeCommissionMonth(month),
      salesProfileId,
      supabase: supabaseAdmin,
    });
  }

  await recordAdminAuditLog({
    action: bulkAction === 'unassign' ? 'bulk_center_sales_admin_unassigned' : 'bulk_center_sales_admin_assigned',
    actorProfileId: current.profile.id,
    after: {
      bulk_action: bulkAction,
      center_count: centerIds.length,
      center_ids: centerIds,
      sales_profile_id: bulkAction === 'assign' ? salesProfileId : null,
    },
    before,
    sectionKey: 'sales_admin',
    supabase: supabaseAdmin,
    targetProfileId: bulkAction === 'assign' ? salesProfileId : null,
  });

  redirect(salesAdminHref('bulk_assignment_saved', redirectMonth, filters));
}

async function updateCenterAccessAssignments(formData: FormData) {
  'use server';

  const current = await requireAdminSectionEdit('sales_admin', '/admin/sales-admin?toast=write_denied');
  const centerId = String(formData.get('center_id') ?? '');
  const selectedProfileIds = [...new Set(formData.getAll('profile_id').map(String).filter(Boolean))];
  const month = String(formData.get('month') ?? '');
  if (!centerId) redirect(salesAdminHref('access_assignment_error', month ? `${month}-01` : undefined));

  const { data: before } = await supabaseAdmin
    .from('admin_center_assignments')
    .select('center_id,profile_id')
    .eq('center_id', centerId);

  const deleteResult = await supabaseAdmin.from('admin_center_assignments').delete().eq('center_id', centerId);
  if (deleteResult.error) redirect(salesAdminHref('access_assignment_error', month ? `${month}-01` : undefined));

  if (selectedProfileIds.length) {
    const insertResult = await supabaseAdmin.from('admin_center_assignments').insert(
      selectedProfileIds.map((profileId) => ({
        assigned_by: current.profile.id,
        center_id: centerId,
        profile_id: profileId,
        updated_by: current.profile.id,
      }))
    );
    if (insertResult.error) redirect(salesAdminHref('access_assignment_error', month ? `${month}-01` : undefined));
  }

  await recordAdminAuditLog({
    action: 'center_access_assignments_updated',
    actorProfileId: current.profile.id,
    after: { center_id: centerId, profile_ids: selectedProfileIds },
    before,
    sectionKey: 'sales_admin',
    supabase: supabaseAdmin,
  });

  redirect(salesAdminHref('access_assignment_saved', month ? `${month}-01` : undefined));
}

async function updateMonthlyPayout(formData: FormData) {
  'use server';

  const current = await requireAdminSectionEdit('sales_admin', '/admin/sales-admin?toast=write_denied');
  const salesProfileId = String(formData.get('sales_profile_id') ?? '');
  const commissionMonth = normalizeCommissionMonth(String(formData.get('commission_month') ?? ''));
  const action = String(formData.get('payout_action') ?? '');
  if (!salesProfileId || !['locked', 'paid'].includes(action)) redirect(salesAdminHref('payout_error', commissionMonth));

  const { data: snapshots, error: snapshotsError } = await supabaseAdmin
    .from('order_commission_snapshots')
    .select('id,order_id,center_id,sales_profile_id,shipped_at,commission_month,revenue_cents,product_cogs_cents,shipping_cogs_cents,processing_fee_cogs_cents,donation_cogs_cents,total_cogs_cents,gross_profit_cents,commission_percent,commission_cents,cogs_estimated')
    .eq('sales_profile_id', salesProfileId)
    .eq('commission_month', commissionMonth);

  if (snapshotsError) redirect(salesAdminHref('payout_error', commissionMonth));

  const summary = summarizeCommissionRows((snapshots ?? []) as CommissionSnapshotRow[]);
  const { data: before } = await supabaseAdmin
    .from('monthly_commission_payouts')
    .select('*')
    .eq('sales_profile_id', salesProfileId)
    .eq('commission_month', commissionMonth)
    .maybeSingle();

  const now = new Date().toISOString();
  const payload = {
    commission_cents: summary.commissionCents,
    commission_month: commissionMonth,
    gross_profit_cents: summary.grossProfitCents,
    locked_at: before?.locked_at ?? now,
    locked_by: before?.locked_by ?? current.profile.id,
    order_count: summary.orderCount,
    paid_at: action === 'paid' ? now : before?.paid_at ?? null,
    paid_by: action === 'paid' ? current.profile.id : before?.paid_by ?? null,
    donation_cogs_cents: summary.donationCogsCents,
    processing_fee_cogs_cents: summary.processingFeeCogsCents,
    product_cogs_cents: summary.productCogsCents,
    revenue_cents: summary.revenueCents,
    sales_profile_id: salesProfileId,
    shipping_cogs_cents: summary.shippingCogsCents,
    status: action,
    total_cogs_cents: summary.totalCogsCents,
    updated_at: now,
  };

  const result = await supabaseAdmin
    .from('monthly_commission_payouts')
    .upsert(payload, { onConflict: 'sales_profile_id,commission_month' });

  if (result.error) redirect(salesAdminHref('payout_error', commissionMonth));

  await recordAdminAuditLog({
    action: action === 'paid' ? 'monthly_commission_paid' : 'monthly_commission_locked',
    actorProfileId: current.profile.id,
    after: payload,
    before,
    sectionKey: 'sales_admin',
    supabase: supabaseAdmin,
    targetProfileId: salesProfileId,
  });

  redirect(salesAdminHref(action === 'paid' ? 'payout_paid' : 'payout_locked', commissionMonth));
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

export default async function SalesAdminPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const current = await requireAdminSectionView('sales_admin');
  if (!current.isOwner) redirect('/admin/access-denied?section=sales_admin');
  const commissionMonth = normalizeCommissionMonth(searchParams?.month);
  const previousMonth = addCommissionMonths(commissionMonth, -1);
  const priorYearMonth = addCommissionMonths(commissionMonth, -12);
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const requestedSalesRepId = stringParam(searchParams?.sales_rep);
  const requestedAssignedRep = stringParam(searchParams?.assigned_rep);
  const requestedCenterStatus = stringParam(searchParams?.center_status);
  const centerSearch = stringParam(searchParams?.q).trim();

  const [{ data: admins }, { data: centers }, { data: assignments }, { data: accessAssignments }, { data: commissionSettings }, { data: snapshots }, { data: payouts }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id,email,full_name,is_active,is_superadmin')
      .eq('is_admin', true)
      .order('full_name', { ascending: true }),
    supabaseAdmin
      .from('centers')
      .select('id,name,is_active')
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('center_sales_assignments')
      .select('center_id,sales_profile_id'),
    supabaseAdmin
      .from('admin_center_assignments')
      .select('center_id,profile_id'),
    supabaseAdmin
      .from('admin_commission_settings')
      .select('profile_id,commission_percent,is_sales_rep'),
    supabaseAdmin
      .from('order_commission_snapshots')
      .select('id,order_id,center_id,sales_profile_id,shipped_at,commission_month,revenue_cents,product_cogs_cents,shipping_cogs_cents,processing_fee_cogs_cents,donation_cogs_cents,total_cogs_cents,gross_profit_cents,commission_percent,commission_cents,cogs_estimated')
      .in('commission_month', [commissionMonth, previousMonth, priorYearMonth]),
    supabaseAdmin
      .from('monthly_commission_payouts')
      .select('id,sales_profile_id,commission_month,status,order_count,revenue_cents,product_cogs_cents,shipping_cogs_cents,processing_fee_cogs_cents,donation_cogs_cents,total_cogs_cents,gross_profit_cents,commission_cents,paid_at')
      .eq('commission_month', commissionMonth),
  ]);

  const adminRows = ((admins ?? []) as AdminRow[]).sort((a, b) => profileLabel(a).localeCompare(profileLabel(b)));
  const commissionByProfile = new Map(((commissionSettings ?? []) as CommissionSettingRow[]).map((setting) => [setting.profile_id, setting]));
  const salesRepRows = adminRows.filter((admin) => Boolean(commissionByProfile.get(admin.id)?.is_sales_rep));
  const selectedSalesRepId = salesRepRows.some((admin) => admin.id === requestedSalesRepId) ? requestedSalesRepId : '';
  const reportAdminRows = selectedSalesRepId ? salesRepRows.filter((admin) => admin.id === selectedSalesRepId) : salesRepRows;
  const assignableAdminRows = adminRows.filter((admin) => !hasSuperadminAccess(admin.email, admin.is_superadmin));
  const adminById = new Map(adminRows.map((admin) => [admin.id, admin]));
  const assignmentRows = (assignments ?? []) as AssignmentRow[];
  const assignmentByCenter = new Map(assignmentRows.map((assignment) => [assignment.center_id, assignment.sales_profile_id]));
  const selectedAssignedRep = requestedAssignedRep === 'unassigned' || salesRepRows.some((admin) => admin.id === requestedAssignedRep) ? requestedAssignedRep : 'all';
  const selectedCenterStatus = ['active', 'inactive'].includes(requestedCenterStatus) ? requestedCenterStatus : 'all';
  const accessRows = (accessAssignments ?? []) as CenterAccessAssignmentRow[];
  const accessByCenter = new Map<string, Set<string>>();
  for (const assignment of accessRows) {
    const rows = accessByCenter.get(assignment.center_id) ?? new Set<string>();
    rows.add(assignment.profile_id);
    accessByCenter.set(assignment.center_id, rows);
  }
  const assignedCenterCountByAdmin = new Map<string, number>();
  for (const assignment of assignmentRows) {
    assignedCenterCountByAdmin.set(assignment.sales_profile_id, (assignedCenterCountByAdmin.get(assignment.sales_profile_id) ?? 0) + 1);
  }

  const snapshotsByAdminAndMonth = new Map<string, CommissionSnapshotRow[]>();
  for (const snapshot of (snapshots ?? []) as CommissionSnapshotRow[]) {
    if (!snapshot.sales_profile_id) continue;
    const key = `${snapshot.sales_profile_id}:${snapshot.commission_month}`;
    const rows = snapshotsByAdminAndMonth.get(key) ?? [];
    rows.push(snapshot);
    snapshotsByAdminAndMonth.set(key, rows);
  }

  const payoutByAdmin = new Map(((payouts ?? []) as PayoutRow[]).map((payout) => [payout.sales_profile_id, payout]));
  const reportRows = reportAdminRows
    .map((admin) => {
      const liveCurrent = summarizeCommissionRows(snapshotsByAdminAndMonth.get(`${admin.id}:${commissionMonth}`) ?? []);
      const payout = payoutByAdmin.get(admin.id);
      const current = payout ? payoutSummary(payout) : liveCurrent;
      return {
        admin,
        assignedCenters: assignedCenterCountByAdmin.get(admin.id) ?? 0,
        current,
        payout,
        previous: summarizeCommissionRows(snapshotsByAdminAndMonth.get(`${admin.id}:${previousMonth}`) ?? []),
        priorYear: summarizeCommissionRows(snapshotsByAdminAndMonth.get(`${admin.id}:${priorYearMonth}`) ?? []),
      };
    });

  const teamCurrent = reportRows.reduce<CommissionSummary>((summary, row) => {
    summary.orderCount += row.current.orderCount;
    summary.revenueCents += row.current.revenueCents;
    summary.productCogsCents += row.current.productCogsCents;
    summary.shippingCogsCents += row.current.shippingCogsCents;
    summary.processingFeeCogsCents += row.current.processingFeeCogsCents;
    summary.donationCogsCents += row.current.donationCogsCents;
    summary.totalCogsCents += row.current.totalCogsCents;
    summary.grossProfitCents += row.current.grossProfitCents;
    summary.commissionCents += row.current.commissionCents;
    return summary;
  }, emptyCommissionSummary());
  const centerRows = ((centers ?? []) as CenterRow[]).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const filteredAssignmentCenters = centerRows.filter((center) => {
    const assignedProfileId = assignmentByCenter.get(center.id) ?? '';
    if (selectedCenterStatus === 'active' && center.is_active === false) return false;
    if (selectedCenterStatus === 'inactive' && center.is_active !== false) return false;
    if (selectedAssignedRep === 'unassigned' && assignedProfileId) return false;
    if (selectedAssignedRep !== 'all' && selectedAssignedRep !== 'unassigned' && assignedProfileId !== selectedAssignedRep) return false;
    if (centerSearch && !(center.name || '').toLowerCase().includes(centerSearch.toLowerCase())) return false;
    return true;
  });
  const bulkCenters: SalesAdminBulkCenter[] = filteredAssignmentCenters.map((center) => {
    const assignedProfileId = assignmentByCenter.get(center.id) ?? '';
    return {
      assignedProfileId,
      assignedProfileLabel: assignedProfileId ? profileLabel(adminById.get(assignedProfileId)) : '',
      id: center.id,
      isActive: center.is_active !== false,
      name: center.name || 'Unnamed center',
    };
  });
  const salesRepOptions: SalesAdminBulkRep[] = salesRepRows.map((admin) => ({
    id: admin.id,
    label: profileLabel(admin),
  }));
  const assignedCentersInReport = reportRows.reduce((count, row) => count + row.assignedCenters, 0);

  return (
    <div className="space-y-6">
      {toast === 'assignment_saved' ? <StatusToast message="Center assignment saved." tone="success" /> : null}
      {toast === 'assignment_error' ? <StatusToast message="Unable to save that center assignment." tone="error" /> : null}
      {toast === 'access_assignment_saved' ? <StatusToast message="Center access assignment saved." tone="success" /> : null}
      {toast === 'access_assignment_error' ? <StatusToast message="Unable to save that center access assignment." tone="error" /> : null}
      {toast === 'bulk_assignment_saved' ? <StatusToast message="Bulk center assignment saved." tone="success" /> : null}
      {toast === 'bulk_assignment_error' ? <StatusToast message="Unable to save that bulk center assignment." tone="error" /> : null}
      {toast === 'payout_locked' ? <StatusToast message="Monthly commission locked." tone="success" /> : null}
      {toast === 'payout_paid' ? <StatusToast message="Monthly commission marked paid." tone="success" /> : null}
      {toast === 'payout_error' ? <StatusToast message="Unable to update that monthly commission payout." tone="error" /> : null}
      {toast === 'write_denied' ? <StatusToast message="You do not have edit access to Sales Admin." tone="error" /> : null}

      <section className="panel">
        <span className="eyebrow">Sales Admin</span>
        <h1 className="page-title mt-4">Sales assignments and commission totals</h1>
        <p className="page-subtitle mt-3">Assign each center to a sales admin and review monthly team commission before payout.</p>
      </section>

      <form className="card grid gap-3 md:grid-cols-[14rem_1fr_auto] md:items-end">
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Commission month
          <input className="input sm:w-56" name="month" type="month" defaultValue={monthInputValue(commissionMonth)} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Sales rep
          <select className="input" name="sales_rep" defaultValue={selectedSalesRepId}>
            <option value="">All sales reps</option>
            {salesRepRows.map((admin) => (
              <option key={admin.id} value={admin.id}>{profileLabel(admin)}</option>
            ))}
          </select>
        </label>
        <button className="btn-primary w-full sm:w-auto" type="submit">Run report</button>
      </form>

      <section className="grid gap-4 lg:grid-cols-4">
        <StatTile label="Team revenue" value={money(teamCurrent.revenueCents)} detail={commissionMonthLabel(commissionMonth)} />
        <StatTile label="Team gross profit" value={money(teamCurrent.grossProfitCents)} detail="After product, shipping, processing, and donation COGS." />
        <StatTile label="Team commission" value={money(teamCurrent.commissionCents)} detail={`${teamCurrent.orderCount.toLocaleString()} shipped order(s).`} />
        <StatTile label="Assigned centers" value={assignedCentersInReport.toLocaleString()} detail={selectedSalesRepId ? 'Assigned to the selected sales rep.' : 'Assigned to shown sales reps.'} />
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Sales admin monthly totals</h2>
          <p className="mt-1 text-sm text-slate-500">Totals use locked payout values when a month has been locked or paid; otherwise they use live shipment snapshots.</p>
        </div>
        {!salesRepRows.length ? <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-800">No admins are marked as Sales Rep yet. Set that in Payroll first.</div> : null}
        {!reportRows.length && salesRepRows.length ? <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">No sales reps match this filter.</div> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[72rem] border-separate border-spacing-y-2 text-left text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-4 py-2">Sales admin</th>
                <th className="px-4 py-2 text-right">Centers</th>
                <th className="px-4 py-2 text-right">Orders</th>
                <th className="px-4 py-2 text-right">Revenue</th>
                <th className="px-4 py-2 text-right">Gross profit</th>
                <th className="px-4 py-2 text-right">Commission</th>
                <th className="px-4 py-2 text-right">MoM</th>
                <th className="px-4 py-2 text-right">YoY</th>
                <th className="px-4 py-2">Payout</th>
              </tr>
            </thead>
            <tbody>
              {reportRows.map((row) => (
                <tr key={row.admin.id} className="bg-white/65">
                  <td className="rounded-l-xl px-4 py-3">
                    <p className="font-semibold text-slate-950">{profileLabel(row.admin)}</p>
                    <p className="mt-1 break-all text-xs text-slate-500">{row.admin.email}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">{row.assignedCenters.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{row.current.orderCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{money(row.current.revenueCents)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{money(row.current.grossProfitCents)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-950">{money(row.current.commissionCents)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{percentChange(row.current.commissionCents, row.previous.commissionCents)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{percentChange(row.current.commissionCents, row.priorYear.commissionCents)}</td>
                  <td className="rounded-r-xl px-4 py-3">
                    {row.payout ? (
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">{row.payout.status}</p>
                    ) : (
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Open</p>
                    )}
                    <div className="flex flex-col gap-2">
                      <form action={updateMonthlyPayout}>
                        <input type="hidden" name="sales_profile_id" value={row.admin.id} />
                        <input type="hidden" name="commission_month" value={commissionMonth} />
                        <input type="hidden" name="payout_action" value="locked" />
                        <button className="btn-secondary w-full" type="submit">Lock</button>
                      </form>
                      <form action={updateMonthlyPayout}>
                        <input type="hidden" name="sales_profile_id" value={row.admin.id} />
                        <input type="hidden" name="commission_month" value={commissionMonth} />
                        <input type="hidden" name="payout_action" value="paid" />
                        <button className="btn-primary w-full" type="submit">Mark paid</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SalesAdminBulkAssignment
        action={bulkAssignCenterSalesAdmins}
        assignedRepFilter={selectedAssignedRep}
        centers={bulkCenters}
        commissionMonth={monthInputValue(commissionMonth)}
        salesRepFilter={selectedSalesRepId}
        salesReps={salesRepOptions}
        search={centerSearch}
        statusFilter={selectedCenterStatus}
      />

      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Center visibility assignments</h2>
          <p className="mt-1 text-sm text-slate-500">These assignments control which centers non-superadmin admins can see and work with.</p>
        </div>
        {!centers?.length ? <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">No centers found.</div> : null}
        <div className="grid gap-3 xl:grid-cols-2">
          {centerRows.map((center) => {
            const selectedAdmins = accessByCenter.get(center.id) ?? new Set<string>();
            return (
              <form key={center.id} action={updateCenterAccessAssignments} className="space-y-3 rounded-2xl border border-slate-200 bg-white/65 p-4">
                <input type="hidden" name="center_id" value={center.id} />
                <input type="hidden" name="month" value={monthInputValue(commissionMonth)} />
                <div>
                  <p className="font-semibold text-slate-950">{center.name || 'Unnamed center'}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{center.is_active === false ? 'Inactive' : 'Active'}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {assignableAdminRows.map((admin) => (
                    <label key={admin.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm font-medium text-slate-700">
                      <input type="checkbox" name="profile_id" value={admin.id} defaultChecked={selectedAdmins.has(admin.id)} />
                      <span className="min-w-0 truncate">{profileLabel(admin)}</span>
                    </label>
                  ))}
                </div>
                {!assignableAdminRows.length ? <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No non-superadmin admins found.</div> : null}
                <button className="btn-primary w-full sm:w-auto" type="submit">Save Access</button>
              </form>
            );
          })}
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Commission center assignments</h2>
          <p className="mt-1 text-sm text-slate-500">Assignments are snapshotted when an order ships, so future reassignment will not change old commission history.</p>
        </div>
        {!centers?.length ? <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">No centers found.</div> : null}
        <div className="grid gap-3 xl:grid-cols-2">
          {filteredAssignmentCenters.map((center) => {
            const assignedProfileId = assignmentByCenter.get(center.id) ?? '';
            const assignedProfile = assignedProfileId ? adminById.get(assignedProfileId) : undefined;
            const assignedIsSalesRep = assignedProfileId ? salesRepRows.some((admin) => admin.id === assignedProfileId) : true;
            return (
            <form key={center.id} action={assignCenterSalesAdmin} className="grid gap-3 rounded-2xl border border-slate-200 bg-white/65 p-4 md:grid-cols-[minmax(0,1fr)_14rem_auto] md:items-end">
              <input type="hidden" name="center_id" value={center.id} />
              <input type="hidden" name="month" value={monthInputValue(commissionMonth)} />
              <div>
                <p className="font-semibold text-slate-950">{center.name || 'Unnamed center'}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{center.is_active === false ? 'Inactive' : 'Active'}</p>
              </div>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Sales admin
                <select className="input" name="sales_profile_id" defaultValue={assignmentByCenter.get(center.id) ?? ''}>
                  <option value="">Unassigned</option>
                  {assignedProfileId && !assignedIsSalesRep ? (
                    <option value={assignedProfileId} disabled>{profileLabel(assignedProfile)} (not marked Sales Rep)</option>
                  ) : null}
                  {salesRepRows.map((admin) => (
                    <option key={admin.id} value={admin.id}>{profileLabel(admin)}</option>
                  ))}
                </select>
              </label>
              <button className="btn-primary w-full md:w-auto" type="submit">Save</button>
            </form>
            );
          })}
        </div>
      </section>
    </div>
  );
}
