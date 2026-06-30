import Link from 'next/link';
import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { recordAdminAuditLog } from '@/lib/admin-audit';
import { adminCanEdit, requireAdminSectionEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { numericPercent } from '@/lib/commissions';
import { getCurrentMonthlySalaryPayrollWindow, getCurrentPayrollWeekWindow } from '@/lib/payroll-status';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  COMPENSATION_TYPES,
  LABOR_WORK_TYPES,
  SALARY_PAY_FREQUENCIES,
  UNASSIGNED_WORK_TYPE,
  completedBreakMinutes,
  compensationTypeLabel,
  dollarsInputFromCents,
  dollarsToCents,
  formatCentralDateInput,
  formatCentralDateTime,
  formatCentralDateTimeInput,
  hoursLabel,
  isLaborWorkType,
  minutesBetween,
  normalizeCompensationType,
  normalizeMoneyCents,
  normalizeSalaryPayFrequency,
  normalizeWorkType,
  paidMinutes,
  parseCentralDateInput,
  parseCentralDateTimeInput,
  salaryCentsForDateRange,
  salaryPayFrequencyLabel,
  wageCentsForMinutes,
  workTypeLabel,
  type CompensationType,
  type LaborWorkType,
  type SalaryPayFrequency,
  type TimeEntryWorkType,
} from '@/lib/time-clock';
import { usd } from '@/lib/utils';

type PayrollTab = 'review' | 'time' | 'reports' | 'settings' | 'export';

type AdminProfileRow = {
  email: string | null;
  full_name: string | null;
  id: string;
  is_active: boolean | null;
};

type TimeBreak = {
  break_end_at: string | null;
  break_start_at: string;
  correction_reason?: string | null;
  id: string;
  manual_reason?: string | null;
  notes?: string | null;
  status: string | null;
  void_reason?: string | null;
  voided_at?: string | null;
};

type TimeEntry = {
  admin_profile?: AdminProfileRow | AdminProfileRow[] | null;
  admin_time_breaks?: TimeBreak[];
  clock_in_at: string;
  clock_out_at: string | null;
  correction_request_note: string | null;
  correction_reason: string | null;
  hourly_rate_cents_snapshot: number | string | null;
  id: string;
  locked_at: string | null;
  manual_reason: string | null;
  notes: string | null;
  profile_id: string;
  status: string | null;
  void_reason: string | null;
  voided_at: string | null;
  work_type: string | null;
};

type AllocationRow = {
  id: string;
  minutes: number | string | null;
  notes: string | null;
  production_run_id: string | null;
  time_entry_id: string;
  wage_cents: number | string | null;
  work_type: string | null;
};

type TimeSettingRow = {
  active: boolean | null;
  compensation_type: string | null;
  hourly_rate_cents: number | string | null;
  profile_id: string;
  salary_amount_cents: number | string | null;
  salary_frequency: string | null;
  salary_labor_work_type: string | null;
};

type CommissionSettingRow = {
  commission_percent: number | string | null;
  is_sales_rep: boolean | null;
  profile_id: string;
};

type LaborTagAssignmentRow = {
  profile_id: string;
  work_type: string;
};

type PayrollSegment = {
  allocated: boolean;
  entry: TimeEntry;
  minutes: number;
  productionRunId: string | null;
  wageCents: number;
  workType: TimeEntryWorkType;
};

type SalaryPayrollRow = {
  frequency: SalaryPayFrequency;
  profileId: string;
  salaryAmountCents: number;
  salaryCents: number;
  workType: LaborWorkType;
};

type SalaryPaymentRow = {
  approved_at: string | null;
  id: string;
  notes: string | null;
  paid_at: string | null;
  payroll_month: string;
  period_end_date: string;
  period_start_date: string;
  profile_id: string;
  salary_amount_cents: number | string | null;
  salary_frequency: string | null;
  salary_labor_work_type: string | null;
  salary_pay_cents: number | string | null;
};

type EmployeePayrollGroup = {
  entryCount: Set<string>;
  hourlyWageCents: number;
  minutes: number;
  salaryCents: number;
  workTypes: Map<TimeEntryWorkType, number>;
};

type WorkTypePayrollGroup = {
  entryCount: Set<string>;
  hourlyWageCents: number;
  minutes: number;
  salaryCents: number;
};

type PayrollLockRow = {
  id: string;
  lock_end_at: string;
  lock_start_at: string;
  locked_at: string | null;
  notes: string | null;
};

const PAYROLL_TABS: Array<{ id: PayrollTab; label: string }> = [
  { id: 'review', label: 'Review' },
  { id: 'time', label: 'Time' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
  { id: 'export', label: 'Export' },
];

const OPEN_SHIFT_ALERT_MINUTES = 12 * 60;
const OPEN_LUNCH_ALERT_MINUTES = 2 * 60;

function payrollHref(params: Record<string, string | null | undefined> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return `/admin/payroll${query ? `?${query}` : ''}`;
}

function formatDateInputLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
  });
}

function safeReturnHref(formData: FormData, fallback = '/admin/payroll') {
  const value = String(formData.get('return_to') ?? '');
  return value.startsWith('/admin/payroll') ? value : fallback;
}

function stringParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

function activeTabParam(value: string | string[] | undefined): PayrollTab {
  if (value === 'approvals') return 'review';
  if (value === 'entries' || value === 'breaks' || value === 'manual') return 'time';
  if (value === 'overview' || value === 'labor' || value === 'production' || value === 'employee' || value === 'work-type' || value === 'exceptions') return 'reports';
  return PAYROLL_TABS.some((tab) => tab.id === value) ? value as PayrollTab : 'review';
}

function profileForEntry(entry: TimeEntry) {
  return Array.isArray(entry.admin_profile) ? entry.admin_profile[0] : entry.admin_profile;
}

function profileLabel(profile: AdminProfileRow | null | undefined) {
  return profile?.full_name || profile?.email || 'Unknown admin';
}

function entryBreaks(entry: TimeEntry) {
  return (entry.admin_time_breaks ?? []) as TimeBreak[];
}

function numericValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentInputValue(value: number | string | null | undefined) {
  const percent = numericPercent(value);
  return percent.toFixed(percent % 1 === 0 ? 0 : 2);
}

function percent(value: number) {
  if (!Number.isFinite(value)) return '0%';
  return `${value >= 0 ? '+' : ''}${value.toFixed(0)}%`;
}

function isDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeSalaryLaborWorkType(value: string | null | undefined): LaborWorkType {
  return isLaborWorkType(String(value ?? '')) ? String(value) as LaborWorkType : 'admin';
}

function statusTone(status: string | null | undefined) {
  if (status === 'void') return 'bg-rose-50 text-rose-700 ring-rose-100';
  if (status === 'locked') return 'bg-slate-100 text-slate-700 ring-slate-200';
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  if (status === 'open') return 'bg-amber-50 text-amber-700 ring-amber-100';
  return 'bg-teal-50 text-teal-700 ring-teal-100';
}

function tabHref(tab: PayrollTab, params: Record<string, string>) {
  return payrollHref({ ...params, tab });
}

function returnToInput(value: string) {
  return <input name="return_to" type="hidden" value={value} />;
}

function errorMessage(error: string) {
  if (error === 'write_denied') return 'You do not have edit access to Payroll.';
  if (error === 'save_error') return 'Unable to save payroll settings.';
  if (error === 'salary_invalid') return 'Choose a valid monthly salary payment.';
  if (error === 'salary_not_ready') return 'That employee is not an active monthly salaried employee.';
  if (error === 'invalid_time') return 'Check the time values and available unallocated minutes.';
  if (error === 'missing_reason') return 'A reason is required for that change.';
  if (error === 'invalid_work_type') return 'Choose a valid labor tag.';
  if (error === 'open_entries') return 'Close all open shifts before completing payroll.';
  if (error === 'unapproved_entries') return 'Approve completed shifts before completing payroll.';
  return `Could not complete that payroll action (${error}).`;
}

function successMessage(success: string) {
  if (success === 'saved') return 'Payroll settings saved.';
  if (success === 'work_type_updated') return 'Labor tag updated.';
  if (success === 'entry_corrected') return 'Time entry corrected.';
  if (success === 'manual_entry_added') return 'Manual shift added.';
  if (success === 'manual_break_added') return 'Manual lunch/break added.';
  if (success === 'break_corrected') return 'Lunch/break corrected.';
  if (success === 'break_voided') return 'Lunch/break voided.';
  if (success === 'range_locked') return 'Payroll week completed.';
  if (success === 'entries_approved') return 'Completed shifts approved.';
  if (success === 'salary_paid') return 'Monthly salary approved and marked paid.';
  if (success === 'salary_already_paid') return 'Monthly salary was already marked paid.';
  if (success === 'allocation_added') return 'Labor allocation added.';
  if (success === 'allocation_removed') return 'Labor allocation removed.';
  if (success === 'entry_approved') return 'Shift approved.';
  if (success === 'entry_voided') return 'Shift voided.';
  return '';
}

async function updatePayrollSettings(formData: FormData) {
  'use server';

  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'settings' }));
  const profileId = String(formData.get('profile_id') ?? '');
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'settings' }));
  if (!profileId) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=save_error`);

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id,email,is_admin')
    .eq('id', profileId)
    .eq('is_admin', true)
    .maybeSingle();

  if (!profile) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=save_error`);

  const selectedTags = formData
    .getAll('labor_tag')
    .map(String)
    .filter(isLaborWorkType);

  const [{ data: beforeTime }, { data: beforeCommission }, { data: beforeTags }] = await Promise.all([
    supabaseAdmin
      .from('admin_time_settings')
      .select('hourly_rate_cents,compensation_type,salary_amount_cents,salary_frequency,salary_labor_work_type')
      .eq('profile_id', profileId)
      .maybeSingle(),
    supabaseAdmin
      .from('admin_commission_settings')
      .select('commission_percent,is_sales_rep')
      .eq('profile_id', profileId)
      .maybeSingle(),
    supabaseAdmin
      .from('admin_labor_tag_assignments')
      .select('work_type')
      .eq('profile_id', profileId),
  ]);

  const hourlyRateCents = dollarsToCents(String(formData.get('hourly_rate') ?? '0'));
  const compensationType = normalizeCompensationType(String(formData.get('compensation_type') ?? 'hourly'));
  const salaryAmountCents = compensationType === 'salary' ? dollarsToCents(String(formData.get('salary_amount') ?? '0')) : 0;
  const salaryFrequency = normalizeSalaryPayFrequency(String(formData.get('salary_frequency') ?? 'annual'));
  const salaryLaborWorkType = normalizeSalaryLaborWorkType(String(formData.get('salary_labor_work_type') ?? 'admin'));
  const commissionPercent = Math.min(100, numericPercent(String(formData.get('commission_percent') ?? '0')));
  const isSalesRep = formData.get('is_sales_rep') === 'on';

  const [timeResult, commissionResult, deleteTagsResult] = await Promise.all([
    supabaseAdmin.from('admin_time_settings').upsert(
      {
        active: true,
        compensation_type: compensationType,
        hourly_rate_cents: hourlyRateCents,
        profile_id: profileId,
        salary_amount_cents: salaryAmountCents,
        salary_frequency: salaryFrequency,
        salary_labor_work_type: salaryLaborWorkType,
        updated_at: new Date().toISOString(),
        updated_by: current.profile.id,
      },
      { onConflict: 'profile_id' }
    ),
    supabaseAdmin.from('admin_commission_settings').upsert(
      {
        active: true,
        commission_percent: commissionPercent,
        is_sales_rep: isSalesRep,
        profile_id: profileId,
        updated_at: new Date().toISOString(),
        updated_by: current.profile.id,
      },
      { onConflict: 'profile_id' }
    ),
    supabaseAdmin.from('admin_labor_tag_assignments').delete().eq('profile_id', profileId),
  ]);

  if (timeResult.error || commissionResult.error || deleteTagsResult.error) {
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=save_error`);
  }

  if (selectedTags.length) {
    const insertTagsResult = await supabaseAdmin.from('admin_labor_tag_assignments').insert(
      selectedTags.map((workType) => ({
        assigned_by: current.profile.id,
        profile_id: profileId,
        work_type: workType,
      }))
    );
    if (insertTagsResult.error) {
      redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=save_error`);
    }
  }

  if (normalizeMoneyCents(beforeTime?.hourly_rate_cents) !== hourlyRateCents) {
    await recordAdminAuditLog({
      action: 'payroll_hourly_rate_updated',
      actorProfileId: current.profile.id,
      after: { hourly_rate_cents: hourlyRateCents },
      before: { hourly_rate_cents: beforeTime?.hourly_rate_cents ?? 0 },
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: profileId,
    });
  }

  const beforeCompensationType = normalizeCompensationType((beforeTime as TimeSettingRow | null | undefined)?.compensation_type);
  const beforeSalaryAmountCents = normalizeMoneyCents((beforeTime as TimeSettingRow | null | undefined)?.salary_amount_cents);
  const beforeSalaryFrequency = normalizeSalaryPayFrequency((beforeTime as TimeSettingRow | null | undefined)?.salary_frequency);
  const beforeSalaryLaborWorkType = normalizeSalaryLaborWorkType((beforeTime as TimeSettingRow | null | undefined)?.salary_labor_work_type);
  if (
    beforeCompensationType !== compensationType ||
    beforeSalaryAmountCents !== salaryAmountCents ||
    beforeSalaryFrequency !== salaryFrequency ||
    beforeSalaryLaborWorkType !== salaryLaborWorkType
  ) {
    await recordAdminAuditLog({
      action: 'payroll_compensation_updated',
      actorProfileId: current.profile.id,
      after: {
        compensation_type: compensationType,
        salary_amount_cents: salaryAmountCents,
        salary_frequency: salaryFrequency,
        salary_labor_work_type: salaryLaborWorkType,
      },
      before: {
        compensation_type: beforeCompensationType,
        salary_amount_cents: beforeSalaryAmountCents,
        salary_frequency: beforeSalaryFrequency,
        salary_labor_work_type: beforeSalaryLaborWorkType,
      },
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: profileId,
    });
  }

  if (numericPercent(beforeCommission?.commission_percent) !== commissionPercent) {
    await recordAdminAuditLog({
      action: 'commission_percent_updated',
      actorProfileId: current.profile.id,
      after: { commission_percent: commissionPercent },
      before: { commission_percent: beforeCommission?.commission_percent ?? 0 },
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: profileId,
    });
  }

  if (Boolean(beforeCommission?.is_sales_rep) !== isSalesRep) {
    await recordAdminAuditLog({
      action: 'sales_rep_status_updated',
      actorProfileId: current.profile.id,
      after: { is_sales_rep: isSalesRep },
      before: { is_sales_rep: Boolean(beforeCommission?.is_sales_rep) },
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: profileId,
    });
  }

  const beforeTagValues = ((beforeTags ?? []) as Array<{ work_type: string }>).map((row) => row.work_type).sort();
  const afterTagValues = [...selectedTags].sort();
  if (beforeTagValues.join('|') !== afterTagValues.join('|')) {
    await recordAdminAuditLog({
      action: 'labor_tags_updated',
      actorProfileId: current.profile.id,
      after: { labor_tags: afterTagValues },
      before: { labor_tags: beforeTagValues },
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: profileId,
    });
  }

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}success=saved`);
}

async function updateEntryWorkType(formData: FormData) {
  'use server';
  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'time' }));
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'time' }));
  const entryId = String(formData.get('entry_id') ?? '');
  const workType = normalizeWorkType(String(formData.get('work_type') ?? ''));
  const reason = String(formData.get('reason') ?? '').trim();
  if (!entryId) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=save_error`);
  if (!reason) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=missing_reason`);

  const before = await supabaseAdmin.from('admin_time_entries').select('id,profile_id,work_type,status').eq('id', entryId).maybeSingle();
  const result = await supabaseAdmin
    .from('admin_time_entries')
    .update({
      correction_reason: reason,
      corrected_at: new Date().toISOString(),
      corrected_by: current.profile.id,
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
      work_type: workType,
    })
    .eq('id', entryId);

  if (!result.error) {
    await recordAdminAuditLog({
      action: 'time_entry_work_type_updated',
      actorProfileId: current.profile.id,
      after: { work_type: workType, reason },
      before: before.data,
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: before.data?.profile_id ?? null,
    });
  }

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${result.error ? 'error=save_error' : 'success=work_type_updated'}`);
}

async function updateEntryTimes(formData: FormData) {
  'use server';
  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'time' }));
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'time' }));
  const entryId = String(formData.get('entry_id') ?? '');
  const clockIn = parseCentralDateTimeInput(String(formData.get('clock_in_at') ?? ''));
  const clockOutRaw = String(formData.get('clock_out_at') ?? '').trim();
  const clockOut = clockOutRaw ? parseCentralDateTimeInput(clockOutRaw) : null;
  const reason = String(formData.get('reason') ?? '').trim();
  const workType = normalizeWorkType(String(formData.get('work_type') ?? ''));
  const hourlyRateCents = dollarsToCents(String(formData.get('hourly_rate') ?? '0'));
  if (!entryId || !clockIn || !reason || (clockOutRaw && !clockOut) || (clockOut && clockOut < clockIn)) {
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=invalid_time`);
  }

  const before = await supabaseAdmin.from('admin_time_entries').select('*').eq('id', entryId).maybeSingle();
  if (!before.data || before.data.status === 'void') redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=invalid_time`);

  const status = before.data.status === 'locked' ? 'locked' : clockOut ? before.data.status === 'approved' ? 'approved' : 'submitted' : 'open';
  const result = await supabaseAdmin
    .from('admin_time_entries')
    .update({
      clock_in_at: clockIn.toISOString(),
      clock_out_at: clockOut ? clockOut.toISOString() : null,
      corrected_at: new Date().toISOString(),
      corrected_by: current.profile.id,
      correction_reason: reason,
      hourly_rate_cents_snapshot: hourlyRateCents,
      status,
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
      work_type: workType,
    })
    .eq('id', entryId);

  if (!result.error) {
    await recordAdminAuditLog({
      action: before.data.status === 'locked' ? 'payroll_locked_entry_corrected' : 'payroll_entry_corrected',
      actorProfileId: current.profile.id,
      after: {
        clock_in_at: clockIn.toISOString(),
        clock_out_at: clockOut ? clockOut.toISOString() : null,
        hourly_rate_cents_snapshot: hourlyRateCents,
        reason,
        status,
        work_type: workType,
      },
      before: before.data,
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: before.data.profile_id,
    });
  }

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${result.error ? 'error=save_error' : 'success=entry_corrected'}`);
}

async function addManualEntry(formData: FormData) {
  'use server';
  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'time' }));
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'time' }));
  const profileId = String(formData.get('profile_id') ?? '');
  const clockIn = parseCentralDateTimeInput(String(formData.get('clock_in_at') ?? ''));
  const clockOut = parseCentralDateTimeInput(String(formData.get('clock_out_at') ?? ''));
  const reason = String(formData.get('reason') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim() || null;
  const workType = normalizeWorkType(String(formData.get('work_type') ?? ''));
  let hourlyRateCents = dollarsToCents(String(formData.get('hourly_rate') ?? '0'));
  if (!profileId || !clockIn || !clockOut || clockOut < clockIn || !reason) {
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=invalid_time`);
  }

  if (!hourlyRateCents) {
    const { data: setting } = await supabaseAdmin
      .from('admin_time_settings')
      .select('hourly_rate_cents')
      .eq('profile_id', profileId)
      .maybeSingle();
    hourlyRateCents = normalizeMoneyCents(setting?.hourly_rate_cents);
  }

  const result = await supabaseAdmin.from('admin_time_entries').insert({
    clock_in_at: clockIn.toISOString(),
    clock_out_at: clockOut.toISOString(),
    created_by: current.profile.id,
    hourly_rate_cents_snapshot: hourlyRateCents,
    manual_reason: reason,
    notes,
    profile_id: profileId,
    status: 'submitted',
    updated_by: current.profile.id,
    work_type: workType,
  }).select('id').single();

  if (!result.error) {
    await recordAdminAuditLog({
      action: 'payroll_manual_entry_added',
      actorProfileId: current.profile.id,
      after: { ...result.data, clock_in_at: clockIn.toISOString(), clock_out_at: clockOut.toISOString(), reason, work_type: workType },
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: profileId,
    });
  }

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${result.error ? 'error=save_error' : 'success=manual_entry_added'}`);
}

async function addManualBreak(formData: FormData) {
  'use server';
  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'time' }));
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'time' }));
  const entryId = String(formData.get('entry_id') ?? '');
  const breakStart = parseCentralDateTimeInput(String(formData.get('break_start_at') ?? ''));
  const breakEnd = parseCentralDateTimeInput(String(formData.get('break_end_at') ?? ''));
  const reason = String(formData.get('reason') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim() || null;
  if (!entryId || !breakStart || !breakEnd || breakEnd < breakStart || !reason) {
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=invalid_time`);
  }

  const { data: entry } = await supabaseAdmin
    .from('admin_time_entries')
    .select('id,profile_id,status')
    .eq('id', entryId)
    .maybeSingle();
  if (!entry || entry.status === 'void') redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=invalid_time`);

  const result = await supabaseAdmin.from('admin_time_breaks').insert({
    break_end_at: breakEnd.toISOString(),
    break_start_at: breakStart.toISOString(),
    created_by: current.profile.id,
    manual_reason: reason,
    notes,
    status: 'completed',
    time_entry_id: entryId,
    updated_by: current.profile.id,
  }).select('id').single();

  if (!result.error) {
    await recordAdminAuditLog({
      action: 'payroll_manual_break_added',
      actorProfileId: current.profile.id,
      after: { ...result.data, break_end_at: breakEnd.toISOString(), break_start_at: breakStart.toISOString(), entry_id: entryId, reason },
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: entry.profile_id,
    });
  }

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${result.error ? 'error=save_error' : 'success=manual_break_added'}`);
}

async function updateBreakTimes(formData: FormData) {
  'use server';
  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'time' }));
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'time' }));
  const breakId = String(formData.get('break_id') ?? '');
  const breakStart = parseCentralDateTimeInput(String(formData.get('break_start_at') ?? ''));
  const breakEndRaw = String(formData.get('break_end_at') ?? '').trim();
  const breakEnd = breakEndRaw ? parseCentralDateTimeInput(breakEndRaw) : null;
  const reason = String(formData.get('reason') ?? '').trim();
  if (!breakId || !breakStart || !reason || (breakEndRaw && !breakEnd) || (breakEnd && breakEnd < breakStart)) {
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=invalid_time`);
  }

  const before = await supabaseAdmin.from('admin_time_breaks').select('*').eq('id', breakId).maybeSingle();
  if (!before.data || before.data.status === 'void') redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=invalid_time`);
  const { data: entry } = await supabaseAdmin
    .from('admin_time_entries')
    .select('profile_id,status')
    .eq('id', before.data.time_entry_id)
    .maybeSingle();

  const result = await supabaseAdmin
    .from('admin_time_breaks')
    .update({
      break_end_at: breakEnd ? breakEnd.toISOString() : null,
      break_start_at: breakStart.toISOString(),
      corrected_at: new Date().toISOString(),
      corrected_by: current.profile.id,
      correction_reason: reason,
      status: breakEnd ? 'completed' : 'open',
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
    })
    .eq('id', breakId);

  if (!result.error) {
    await recordAdminAuditLog({
      action: entry?.status === 'locked' ? 'payroll_locked_break_corrected' : 'payroll_break_corrected',
      actorProfileId: current.profile.id,
      after: { break_end_at: breakEnd ? breakEnd.toISOString() : null, break_start_at: breakStart.toISOString(), reason },
      before: before.data,
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: entry?.profile_id ?? null,
    });
  }

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${result.error ? 'error=save_error' : 'success=break_corrected'}`);
}

async function voidBreak(formData: FormData) {
  'use server';
  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'time' }));
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'time' }));
  const breakId = String(formData.get('break_id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!breakId || !reason) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=missing_reason`);

  const before = await supabaseAdmin.from('admin_time_breaks').select('*').eq('id', breakId).maybeSingle();
  if (!before.data) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=save_error`);
  const { data: entry } = await supabaseAdmin
    .from('admin_time_entries')
    .select('profile_id,status')
    .eq('id', before.data.time_entry_id)
    .maybeSingle();

  const result = await supabaseAdmin
    .from('admin_time_breaks')
    .update({
      status: 'void',
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
      void_reason: reason,
      voided_at: new Date().toISOString(),
      voided_by: current.profile.id,
    })
    .eq('id', breakId);

  if (!result.error) {
    await recordAdminAuditLog({
      action: entry?.status === 'locked' ? 'payroll_locked_break_voided' : 'payroll_break_voided',
      actorProfileId: current.profile.id,
      after: { reason, status: 'void' },
      before: before.data,
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: entry?.profile_id ?? null,
    });
  }

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${result.error ? 'error=save_error' : 'success=break_voided'}`);
}

async function lockPayrollRange(formData: FormData) {
  'use server';
  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'review' }));
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'review' }));
  const lockStart = parseCentralDateInput(String(formData.get('lock_start') ?? ''));
  const lockEnd = parseCentralDateInput(String(formData.get('lock_end') ?? ''), true);
  const profileId = String(formData.get('profile_id') ?? '');
  const notes = String(formData.get('notes') ?? '').trim() || null;
  if (!lockStart || !lockEnd || lockEnd < lockStart) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=invalid_time`);

  let reviewQuery = supabaseAdmin
    .from('admin_time_entries')
    .select('id,status,clock_out_at')
    .gte('clock_in_at', lockStart.toISOString())
    .lte('clock_in_at', lockEnd.toISOString())
    .limit(50000);
  if (profileId) reviewQuery = reviewQuery.eq('profile_id', profileId);
  const { data: reviewRows, error: reviewError } = await reviewQuery;
  if (reviewError) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=save_error`);
  const reviewableRows = ((reviewRows ?? []) as Array<{ clock_out_at: string | null; id: string; status: string | null }>).filter((entry) => entry.status !== 'void');
  if (reviewableRows.some((entry) => !entry.clock_out_at)) {
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=open_entries`);
  }
  if (reviewableRows.some((entry) => entry.clock_out_at && !['approved', 'locked'].includes(entry.status ?? ''))) {
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=unapproved_entries`);
  }

  const lockResult = await supabaseAdmin.from('admin_payroll_locks').insert({
    lock_end_at: lockEnd.toISOString(),
    lock_start_at: lockStart.toISOString(),
    locked_by: current.profile.id,
    notes,
  }).select('id').single();
  if (lockResult.error) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=save_error`);

  const lockableEntryIds = reviewableRows.filter((entry) => entry.clock_out_at).map((entry) => entry.id);
  const updateResult = lockableEntryIds.length
    ? await supabaseAdmin
        .from('admin_time_entries')
        .update({
          locked_at: new Date().toISOString(),
          locked_by: current.profile.id,
          status: 'locked',
          updated_at: new Date().toISOString(),
          updated_by: current.profile.id,
        })
        .in('id', lockableEntryIds)
    : { error: null };

  await recordAdminAuditLog({
    action: 'payroll_range_locked',
    actorProfileId: current.profile.id,
    after: { lock_id: lockResult.data?.id, lock_end_at: lockEnd.toISOString(), lock_start_at: lockStart.toISOString(), profile_id: profileId || null, update_error: updateResult.error?.message ?? null },
    sectionKey: 'payroll',
    supabase: supabaseAdmin,
    targetProfileId: profileId || null,
  });

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${updateResult.error ? 'error=save_error' : 'success=range_locked'}`);
}

async function approveMonthlySalaryPayment(formData: FormData) {
  'use server';
  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'review' }));
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'review' }));
  const profileId = String(formData.get('profile_id') ?? '');
  const payrollMonth = String(formData.get('payroll_month') ?? '');
  const periodStartDate = String(formData.get('period_start_date') ?? '');
  const periodEndDate = String(formData.get('period_end_date') ?? '');
  const notes = String(formData.get('notes') ?? '').trim() || null;

  if (!profileId || !isDateInput(payrollMonth) || !isDateInput(periodStartDate) || !isDateInput(periodEndDate)) {
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=salary_invalid`);
  }

  const [{ data: profile }, { data: setting }, { data: existing }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id,email,full_name,is_active')
      .eq('id', profileId)
      .eq('is_admin', true)
      .maybeSingle(),
    supabaseAdmin
      .from('admin_time_settings')
      .select('profile_id,active,compensation_type,salary_amount_cents,salary_frequency,salary_labor_work_type')
      .eq('profile_id', profileId)
      .maybeSingle(),
    supabaseAdmin
      .from('admin_salary_payroll_payments')
      .select('id')
      .eq('profile_id', profileId)
      .eq('payroll_month', payrollMonth)
      .maybeSingle(),
  ]);

  if (existing?.id) {
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}success=salary_already_paid`);
  }

  const salaryAmountCents = normalizeMoneyCents(setting?.salary_amount_cents);
  const salaryFrequency = normalizeSalaryPayFrequency(setting?.salary_frequency);
  const salaryLaborWorkType = normalizeSalaryLaborWorkType(setting?.salary_labor_work_type);
  const isActiveMonthlySalary =
    profile &&
    profile.is_active !== false &&
    setting?.active !== false &&
    normalizeCompensationType(setting?.compensation_type) === 'salary' &&
    salaryFrequency === 'monthly' &&
    salaryAmountCents > 0;

  if (!isActiveMonthlySalary) {
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=salary_not_ready`);
  }

  const now = new Date().toISOString();
  const result = await supabaseAdmin
    .from('admin_salary_payroll_payments')
    .insert({
      approved_at: now,
      approved_by: current.profile.id,
      created_by: current.profile.id,
      notes,
      paid_at: now,
      paid_by: current.profile.id,
      payroll_month: payrollMonth,
      period_end_date: periodEndDate,
      period_start_date: periodStartDate,
      profile_id: profileId,
      salary_amount_cents: salaryAmountCents,
      salary_frequency: salaryFrequency,
      salary_labor_work_type: salaryLaborWorkType,
      salary_pay_cents: salaryAmountCents,
      updated_at: now,
      updated_by: current.profile.id,
    })
    .select('id')
    .single();

  if (!result.error) {
    await recordAdminAuditLog({
      action: 'salary_payroll_marked_paid',
      actorProfileId: current.profile.id,
      after: {
        payment_id: result.data?.id,
        payroll_month: payrollMonth,
        period_end_date: periodEndDate,
        period_start_date: periodStartDate,
        salary_frequency: salaryFrequency,
        salary_labor_work_type: salaryLaborWorkType,
        salary_pay_cents: salaryAmountCents,
      },
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: profileId,
    });
  }

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${result.error ? 'error=save_error' : 'success=salary_paid'}`);
}

async function approveCompletedWeekEntries(formData: FormData) {
  'use server';
  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'review' }));
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'review' }));
  const lockStart = parseCentralDateInput(String(formData.get('lock_start') ?? ''));
  const lockEnd = parseCentralDateInput(String(formData.get('lock_end') ?? ''), true);
  const profileId = String(formData.get('profile_id') ?? '');
  if (!lockStart || !lockEnd || lockEnd < lockStart) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=invalid_time`);

  let entriesQuery = supabaseAdmin
    .from('admin_time_entries')
    .select('id,profile_id,status,clock_out_at')
    .gte('clock_in_at', lockStart.toISOString())
    .lte('clock_in_at', lockEnd.toISOString())
    .not('clock_out_at', 'is', null)
    .limit(50000);
  if (profileId) entriesQuery = entriesQuery.eq('profile_id', profileId);
  const { data: rows, error: rowsError } = await entriesQuery;
  if (rowsError) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=save_error`);

  const entriesToApprove = ((rows ?? []) as Array<{ id: string; profile_id: string; status: string | null }>).filter((entry) => entry.status !== 'void' && !['approved', 'locked'].includes(entry.status ?? ''));
  if (!entriesToApprove.length) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}success=entries_approved`);

  const result = await supabaseAdmin
    .from('admin_time_entries')
    .update({
      approved_at: new Date().toISOString(),
      approved_by: current.profile.id,
      status: 'approved',
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
    })
    .in('id', entriesToApprove.map((entry) => entry.id));

  if (!result.error) {
    await recordAdminAuditLog({
      action: 'time_clock_entries_bulk_approved',
      actorProfileId: current.profile.id,
      after: {
        count: entriesToApprove.length,
        lock_end_at: lockEnd.toISOString(),
        lock_start_at: lockStart.toISOString(),
        profile_id: profileId || null,
      },
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: profileId || null,
    });
  }

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${result.error ? 'error=save_error' : 'success=entries_approved'}`);
}

async function approveEntry(formData: FormData) {
  'use server';
  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'review' }));
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'review' }));
  const entryId = String(formData.get('entry_id') ?? '');
  if (!entryId) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=save_error`);

  const before = await supabaseAdmin.from('admin_time_entries').select('*').eq('id', entryId).maybeSingle();
  if (!before.data || before.data.status === 'void' || !before.data.clock_out_at) {
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=invalid_time`);
  }

  const result = await supabaseAdmin
    .from('admin_time_entries')
    .update({
      approved_at: new Date().toISOString(),
      approved_by: current.profile.id,
      status: 'approved',
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
    })
    .eq('id', entryId);

  if (!result.error) {
    await recordAdminAuditLog({
      action: 'time_clock_entry_approved',
      actorProfileId: current.profile.id,
      after: { status: 'approved' },
      before: before.data,
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: before.data.profile_id,
    });
  }

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${result.error ? 'error=save_error' : 'success=entry_approved'}`);
}

async function voidEntry(formData: FormData) {
  'use server';
  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'time' }));
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'time' }));
  const entryId = String(formData.get('entry_id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!entryId || !reason) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=missing_reason`);

  const before = await supabaseAdmin.from('admin_time_entries').select('*').eq('id', entryId).maybeSingle();
  const result = await supabaseAdmin
    .from('admin_time_entries')
    .update({
      status: 'void',
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
      void_reason: reason,
      voided_at: new Date().toISOString(),
      voided_by: current.profile.id,
    })
    .eq('id', entryId);

  if (!result.error) {
    await supabaseAdmin.from('admin_time_breaks').update({
      status: 'void',
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
      void_reason: `Parent shift voided: ${reason}`,
      voided_at: new Date().toISOString(),
      voided_by: current.profile.id,
    }).eq('time_entry_id', entryId).neq('status', 'void');

    await recordAdminAuditLog({
      action: before.data?.status === 'locked' ? 'time_clock_locked_entry_voided' : 'time_clock_entry_voided',
      actorProfileId: current.profile.id,
      after: { reason, status: 'void' },
      before: before.data,
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: before.data?.profile_id ?? null,
    });
  }

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${result.error ? 'error=save_error' : 'success=entry_voided'}`);
}

async function addAllocation(formData: FormData) {
  'use server';
  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'time' }));
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'time' }));
  const entryId = String(formData.get('entry_id') ?? '');
  const workType = normalizeWorkType(String(formData.get('work_type') ?? ''));
  const productionRunId = workType === 'production' ? String(formData.get('production_run_id') ?? '').trim() || null : null;
  const minutes = Math.max(0, Number.parseFloat(String(formData.get('minutes') ?? '0')) || 0);
  const notes = String(formData.get('notes') ?? '').trim() || null;
  if (!entryId || minutes <= 0) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=invalid_time`);

  const [{ data: entry }, { data: breaks }, { data: existingAllocations }] = await Promise.all([
    supabaseAdmin
      .from('admin_time_entries')
      .select('id,profile_id,clock_in_at,clock_out_at,hourly_rate_cents_snapshot,status')
      .eq('id', entryId)
      .maybeSingle(),
    supabaseAdmin
      .from('admin_time_breaks')
      .select('break_start_at,break_end_at,status')
      .eq('time_entry_id', entryId),
    supabaseAdmin
      .from('admin_time_entry_allocations')
      .select('minutes')
      .eq('time_entry_id', entryId),
  ]);

  if (!entry?.clock_out_at || entry.status === 'void') redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=invalid_time`);

  const entryPaidMinutes = paidMinutes(entry, (breaks ?? []) as TimeBreak[]);
  const alreadyAllocated = (existingAllocations ?? []).reduce((sum: number, allocation: any) => sum + numericValue(allocation.minutes), 0);
  if (minutes > Math.max(0, entryPaidMinutes - alreadyAllocated) + 0.0001) {
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=invalid_time`);
  }

  const wageCents = wageCentsForMinutes(minutes, entry.hourly_rate_cents_snapshot);
  const result = await supabaseAdmin.from('admin_time_entry_allocations').insert({
    created_by: current.profile.id,
    minutes,
    notes,
    production_run_id: productionRunId,
    time_entry_id: entryId,
    updated_by: current.profile.id,
    wage_cents: wageCents,
    work_type: workType,
  });

  if (!result.error) {
    await recordAdminAuditLog({
      action: 'time_entry_allocation_added',
      actorProfileId: current.profile.id,
      after: { entry_id: entryId, minutes, production_run_id: productionRunId, wage_cents: wageCents, work_type: workType },
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: entry.profile_id,
    });
  }

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${result.error ? 'error=save_error' : 'success=allocation_added'}`);
}

async function removeAllocation(formData: FormData) {
  'use server';
  const current = await requireAdminSectionEdit('payroll', payrollHref({ error: 'write_denied', tab: 'time' }));
  const returnTo = safeReturnHref(formData, payrollHref({ tab: 'time' }));
  const allocationId = String(formData.get('allocation_id') ?? '');
  if (!allocationId) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=save_error`);

  const before = await supabaseAdmin
    .from('admin_time_entry_allocations')
    .select('*,admin_time_entries(profile_id)')
    .eq('id', allocationId)
    .maybeSingle();
  const result = await supabaseAdmin.from('admin_time_entry_allocations').delete().eq('id', allocationId);
  if (!result.error) {
    const parent = Array.isArray((before.data as any)?.admin_time_entries) ? (before.data as any).admin_time_entries[0] : (before.data as any)?.admin_time_entries;
    await recordAdminAuditLog({
      action: 'time_entry_allocation_removed',
      actorProfileId: current.profile.id,
      before: before.data,
      sectionKey: 'payroll',
      supabase: supabaseAdmin,
      targetProfileId: parent?.profile_id ?? null,
    });
  }

  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${result.error ? 'error=save_error' : 'success=allocation_removed'}`);
}

function StatTile({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="stat-card">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">{message}</div>;
}

function buildSegments(entries: TimeEntry[], allocationsByEntry: Map<string, AllocationRow[]>) {
  const segments: PayrollSegment[] = [];
  for (const entry of entries) {
    if (entry.status === 'void' || !entry.clock_out_at) continue;
    const allocations = allocationsByEntry.get(entry.id) ?? [];
    if (allocations.length) {
      for (const allocation of allocations) {
        segments.push({
          allocated: true,
          entry,
          minutes: numericValue(allocation.minutes),
          productionRunId: allocation.production_run_id,
          wageCents: numericValue(allocation.wage_cents),
          workType: normalizeWorkType(allocation.work_type),
        });
      }
      continue;
    }
    const minutes = paidMinutes(entry, entryBreaks(entry));
    segments.push({
      allocated: false,
      entry,
      minutes,
      productionRunId: null,
      wageCents: wageCentsForMinutes(minutes, entry.hourly_rate_cents_snapshot),
      workType: normalizeWorkType(entry.work_type),
    });
  }
  return segments;
}

function groupSegmentsByEmployee(segments: PayrollSegment[]) {
  const grouped = new Map<string, EmployeePayrollGroup>();
  for (const segment of segments) {
    const row = grouped.get(segment.entry.profile_id) ?? { entryCount: new Set<string>(), hourlyWageCents: 0, minutes: 0, salaryCents: 0, workTypes: new Map<TimeEntryWorkType, number>() };
    row.entryCount.add(segment.entry.id);
    row.minutes += segment.minutes;
    row.hourlyWageCents += segment.wageCents;
    row.workTypes.set(segment.workType, (row.workTypes.get(segment.workType) ?? 0) + segment.minutes);
    grouped.set(segment.entry.profile_id, row);
  }
  return grouped;
}

function groupSegmentsByWorkType(segments: PayrollSegment[]) {
  const grouped = new Map<TimeEntryWorkType, WorkTypePayrollGroup>();
  for (const segment of segments) {
    const row = grouped.get(segment.workType) ?? { entryCount: new Set<string>(), hourlyWageCents: 0, minutes: 0, salaryCents: 0 };
    row.entryCount.add(segment.entry.id);
    row.minutes += segment.minutes;
    row.hourlyWageCents += segment.wageCents;
    grouped.set(segment.workType, row);
  }
  return grouped;
}

function buildSalaryRows({
  filterWorkType,
  fromDate,
  selectedAdmin,
  timeSettings,
  toDate,
}: {
  filterWorkType: TimeEntryWorkType | '';
  fromDate: Date;
  selectedAdmin: string;
  timeSettings: TimeSettingRow[];
  toDate: Date;
}) {
  const rows: SalaryPayrollRow[] = [];
  for (const setting of timeSettings) {
    if (setting.active === false) continue;
    if (selectedAdmin && setting.profile_id !== selectedAdmin) continue;
    if (normalizeCompensationType(setting.compensation_type) !== 'salary') continue;
    const workType = normalizeSalaryLaborWorkType(setting.salary_labor_work_type);
    if (filterWorkType && workType !== filterWorkType) continue;
    const salaryCents = salaryCentsForDateRange({
      end: toDate,
      salaryAmountCents: setting.salary_amount_cents,
      salaryFrequency: setting.salary_frequency,
      start: fromDate,
    });
    if (salaryCents <= 0) continue;
    rows.push({
      frequency: normalizeSalaryPayFrequency(setting.salary_frequency),
      profileId: setting.profile_id,
      salaryAmountCents: normalizeMoneyCents(setting.salary_amount_cents),
      salaryCents,
      workType,
    });
  }
  return rows;
}

function applySalaryRowsToEmployeeGroups(grouped: Map<string, EmployeePayrollGroup>, salaryRows: SalaryPayrollRow[]) {
  for (const salary of salaryRows) {
    const row = grouped.get(salary.profileId) ?? { entryCount: new Set<string>(), hourlyWageCents: 0, minutes: 0, salaryCents: 0, workTypes: new Map<TimeEntryWorkType, number>() };
    row.salaryCents += salary.salaryCents;
    if (!row.workTypes.has(salary.workType)) row.workTypes.set(salary.workType, 0);
    grouped.set(salary.profileId, row);
  }
}

function applySalaryRowsToWorkTypeGroups(grouped: Map<TimeEntryWorkType, WorkTypePayrollGroup>, salaryRows: SalaryPayrollRow[]) {
  for (const salary of salaryRows) {
    const row = grouped.get(salary.workType) ?? { entryCount: new Set<string>(), hourlyWageCents: 0, minutes: 0, salaryCents: 0 };
    row.salaryCents += salary.salaryCents;
    grouped.set(salary.workType, row);
  }
}

function WorkTypeSelect({ defaultValue, includeUnassigned = true, name = 'work_type' }: { defaultValue?: string | null; includeUnassigned?: boolean; name?: string }) {
  return (
    <select className="input" name={name} defaultValue={normalizeWorkType(defaultValue)}>
      {includeUnassigned ? <option value={UNASSIGNED_WORK_TYPE}>Unassigned</option> : null}
      {LABOR_WORK_TYPES.map((workType) => (
        <option key={workType.value} value={workType.value}>{workType.label}</option>
      ))}
    </select>
  );
}

function EntriesTable({
  allocationsByEntry,
  entries,
  returnTo,
}: {
  allocationsByEntry: Map<string, AllocationRow[]>;
  entries: TimeEntry[];
  returnTo: string;
}) {
  if (!entries.length) return <EmptyState message="No time entries found for the selected filters." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[86rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Admin</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Clock in</th>
            <th className="px-4 py-2">Clock out</th>
            <th className="px-4 py-2">Tag</th>
            <th className="px-4 py-2 text-right">Lunch</th>
            <th className="px-4 py-2 text-right">Paid</th>
            <th className="px-4 py-2 text-right">Wages</th>
            <th className="px-4 py-2">Notes</th>
            <th className="px-4 py-2">Review</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const breaks = entryBreaks(entry);
            const lunchMinutes = completedBreakMinutes(breaks);
            const entryPaidMinutes = paidMinutes(entry, breaks);
            const wageCents = wageCentsForMinutes(entryPaidMinutes, entry.hourly_rate_cents_snapshot);
            const profile = profileForEntry(entry);
            const allocations = allocationsByEntry.get(entry.id) ?? [];
            const allocatedMinutes = allocations.reduce((sum, allocation) => sum + numericValue(allocation.minutes), 0);
            const remainingMinutes = Math.max(0, entryPaidMinutes - allocatedMinutes);
            return (
              <tr key={entry.id} className="bg-white/70 align-top">
                <td className="rounded-l-xl px-4 py-3">
                  <p className="font-semibold text-slate-950">{profileLabel(profile)}</p>
                  <p className="mt-1 break-all text-xs text-slate-500">{profile?.email}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusTone(entry.status)}`}>{entry.status ?? 'submitted'}</span>
                </td>
                <td className="px-4 py-3 text-slate-700">{formatCentralDateTime(entry.clock_in_at)}</td>
                <td className="px-4 py-3 text-slate-700">{formatCentralDateTime(entry.clock_out_at)}</td>
                <td className="px-4 py-3 text-slate-700">{workTypeLabel(entry.work_type)}</td>
                <td className="px-4 py-3 text-right text-slate-700">{hoursLabel(lunchMinutes)}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-950">{hoursLabel(entryPaidMinutes)}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-950">{usd(wageCents)}</td>
                <td className="max-w-72 px-4 py-3 text-slate-600">
                  {entry.notes ? <p className="whitespace-pre-line">{entry.notes}</p> : null}
                  {entry.correction_request_note ? <p className="mt-2 rounded-xl bg-amber-50 p-2 text-amber-800">Correction request: {entry.correction_request_note}</p> : null}
                  {entry.manual_reason ? <p className="mt-2 text-xs text-slate-500">Manual: {entry.manual_reason}</p> : null}
                  {entry.void_reason ? <p className="mt-2 text-xs text-rose-700">Void: {entry.void_reason}</p> : null}
                </td>
                <td className="rounded-r-xl px-4 py-3">
                  <details className="space-y-3">
                    <summary className="cursor-pointer font-semibold text-teal-800">Manage</summary>
                    <div className="mt-3 w-80 space-y-4">
                      {entry.status !== 'void' && entry.status !== 'locked' && entry.clock_out_at ? (
                        <form action={approveEntry} className="space-y-2">
                          {returnToInput(returnTo)}
                          <input name="entry_id" type="hidden" value={entry.id} />
                          <PendingSubmitButton className="btn-secondary w-full" label="Approve" pendingLabel="Approving..." />
                        </form>
                      ) : null}
                      <form action={updateEntryWorkType} className="space-y-2">
                        {returnToInput(returnTo)}
                        <input name="entry_id" type="hidden" value={entry.id} />
                        <WorkTypeSelect defaultValue={entry.work_type} />
                        <textarea className="input min-h-20" name="reason" required placeholder="Correction reason" />
                        <PendingSubmitButton className="btn-primary w-full" label="Save Labor Tag" pendingLabel="Saving..." />
                      </form>
                      <form action={updateEntryTimes} className="space-y-2 rounded-2xl border border-slate-200 bg-white/70 p-3">
                        {returnToInput(returnTo)}
                        <input name="entry_id" type="hidden" value={entry.id} />
                        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Clock in
                          <input className="input mt-2" name="clock_in_at" type="datetime-local" defaultValue={formatCentralDateTimeInput(entry.clock_in_at)} required />
                        </label>
                        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Clock out
                          <input className="input mt-2" name="clock_out_at" type="datetime-local" defaultValue={formatCentralDateTimeInput(entry.clock_out_at)} />
                        </label>
                        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Rate snapshot
                          <input className="input mt-2" name="hourly_rate" type="number" min="0" step="0.01" defaultValue={dollarsInputFromCents(entry.hourly_rate_cents_snapshot)} />
                        </label>
                        <WorkTypeSelect defaultValue={entry.work_type} />
                        <textarea className="input min-h-20" name="reason" required placeholder={entry.status === 'locked' ? 'Post-lock correction reason' : 'Correction reason'} />
                        <PendingSubmitButton className="btn-primary w-full" label="Save Time Correction" pendingLabel="Saving..." />
                      </form>
                      {entry.clock_out_at && entry.status !== 'void' ? (
                        <form action={addAllocation} className="space-y-2">
                          {returnToInput(returnTo)}
                          <input name="entry_id" type="hidden" value={entry.id} />
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Remaining: {hoursLabel(remainingMinutes)} hours</p>
                          <WorkTypeSelect defaultValue={entry.work_type} />
                          <input className="input" name="minutes" type="number" min="0.01" step="0.01" placeholder="Minutes" />
                          <textarea className="input min-h-16" name="notes" placeholder="Allocation note" />
                          <PendingSubmitButton className="btn-secondary w-full" label="Add Allocation" pendingLabel="Adding..." />
                        </form>
                      ) : null}
                      {allocations.length ? (
                        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white/70 p-3">
                          <p className="font-semibold text-slate-950">Allocations</p>
                          {allocations.map((allocation) => (
                            <div key={allocation.id} className="rounded-xl bg-slate-50 p-2">
                              <p className="text-sm font-semibold text-slate-950">{workTypeLabel(allocation.work_type)} - {hoursLabel(numericValue(allocation.minutes))} hrs</p>
                              <form action={removeAllocation} className="mt-2">
                                {returnToInput(returnTo)}
                                <input name="allocation_id" type="hidden" value={allocation.id} />
                                <PendingSubmitButton className="btn-secondary w-full" label="Remove" pendingLabel="Removing..." />
                              </form>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {entry.status !== 'void' ? (
                        <form action={voidEntry} className="space-y-2">
                          {returnToInput(returnTo)}
                          <input name="entry_id" type="hidden" value={entry.id} />
                          <input className="input" name="reason" required placeholder="Void shift reason" />
                          <PendingSubmitButton className="btn-secondary w-full" label="Void Shift" pendingLabel="Voiding..." />
                        </form>
                      ) : null}
                    </div>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BreaksTable({ entries, returnTo }: { entries: TimeEntry[]; returnTo: string }) {
  const rows = entries.flatMap((entry) => entryBreaks(entry).map((entryBreak) => ({ entry, entryBreak })));
  if (!rows.length) return <EmptyState message="No lunch or break records found for the selected filters." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[78rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Admin</th>
            <th className="px-4 py-2">Shift</th>
            <th className="px-4 py-2">Break start</th>
            <th className="px-4 py-2">Break end</th>
            <th className="px-4 py-2 text-right">Duration</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Manage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ entry, entryBreak }) => (
            <tr key={entryBreak.id} className="bg-white/70 align-top">
              <td className="rounded-l-xl px-4 py-3">
                <p className="font-semibold text-slate-950">{profileLabel(profileForEntry(entry))}</p>
                <p className="mt-1 text-xs text-slate-500">{workTypeLabel(entry.work_type)}</p>
              </td>
              <td className="px-4 py-3 text-slate-700">
                {formatCentralDateTime(entry.clock_in_at)}<br />
                <span className="text-xs text-slate-500">to {formatCentralDateTime(entry.clock_out_at)}</span>
              </td>
              <td className="px-4 py-3 text-slate-700">{formatCentralDateTime(entryBreak.break_start_at)}</td>
              <td className="px-4 py-3 text-slate-700">{formatCentralDateTime(entryBreak.break_end_at)}</td>
              <td className="px-4 py-3 text-right font-semibold text-slate-950">{hoursLabel(minutesBetween(entryBreak.break_start_at, entryBreak.break_end_at))}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusTone(entryBreak.status)}`}>{entryBreak.status ?? 'open'}</span>
                {entryBreak.manual_reason ? <p className="mt-2 text-xs text-slate-500">Manual: {entryBreak.manual_reason}</p> : null}
                {entryBreak.void_reason ? <p className="mt-2 text-xs text-rose-700">Void: {entryBreak.void_reason}</p> : null}
              </td>
              <td className="rounded-r-xl px-4 py-3">
                <details>
                  <summary className="cursor-pointer font-semibold text-teal-800">Manage</summary>
                  <div className="mt-3 w-80 space-y-3">
                    <form action={updateBreakTimes} className="space-y-2">
                      {returnToInput(returnTo)}
                      <input name="break_id" type="hidden" value={entryBreak.id} />
                      <input className="input" name="break_start_at" type="datetime-local" defaultValue={formatCentralDateTimeInput(entryBreak.break_start_at)} required />
                      <input className="input" name="break_end_at" type="datetime-local" defaultValue={formatCentralDateTimeInput(entryBreak.break_end_at)} />
                      <textarea className="input min-h-20" name="reason" required placeholder={entry.status === 'locked' ? 'Post-lock correction reason' : 'Correction reason'} />
                      <PendingSubmitButton className="btn-primary w-full" label="Save Break" pendingLabel="Saving..." />
                    </form>
                    {entryBreak.status !== 'void' ? (
                      <form action={voidBreak} className="space-y-2">
                        {returnToInput(returnTo)}
                        <input name="break_id" type="hidden" value={entryBreak.id} />
                        <input className="input" name="reason" required placeholder="Void break reason" />
                        <PendingSubmitButton className="btn-secondary w-full" label="Void Break" pendingLabel="Voiding..." />
                      </form>
                    ) : null}
                  </div>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManualEntriesPanel({
  admins,
  entries,
  returnTo,
  selectedAdmin,
  timeByProfile,
}: {
  admins: AdminProfileRow[];
  entries: TimeEntry[];
  returnTo: string;
  selectedAdmin: string;
  timeByProfile: Map<string, TimeSettingRow>;
}) {
  const completedEntries = entries.filter((entry) => entry.clock_out_at && entry.status !== 'void');

  return (
    <section className="grid gap-5 xl:grid-cols-2">
      <form action={addManualEntry} className="card space-y-4">
        {returnToInput(returnTo)}
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Add manual shift</h2>
          <p className="mt-1 text-sm text-slate-500">Use this for missed punches or approved corrections.</p>
        </div>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Employee
          <select className="input" name="profile_id" defaultValue={selectedAdmin}>
            <option value="">Choose admin</option>
            {admins.map((admin) => (
              <option key={admin.id} value={admin.id}>{profileLabel(admin)}{admin.is_active === false ? ' (inactive)' : ''}</option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Clock in
            <input className="input" name="clock_in_at" required type="datetime-local" />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Clock out
            <input className="input" name="clock_out_at" required type="datetime-local" />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Hourly rate
            <input className="input" name="hourly_rate" type="number" min="0" step="0.01" placeholder="Uses employee rate if blank/0" />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Labor tag
            <WorkTypeSelect />
          </label>
        </div>
        <textarea className="input min-h-20" name="reason" required placeholder="Manual entry reason" />
        <textarea className="input min-h-20" name="notes" placeholder="Optional notes" />
        <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Add Manual Shift" pendingLabel="Adding..." />
      </form>

      <form action={addManualBreak} className="card space-y-4">
        {returnToInput(returnTo)}
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Add manual lunch / break</h2>
          <p className="mt-1 text-sm text-slate-500">Attach unpaid lunch or break time to a completed shift.</p>
        </div>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Shift
          <select className="input" name="entry_id" required>
            <option value="">Choose shift</option>
            {completedEntries.map((entry) => {
              const profile = profileForEntry(entry);
              const rate = timeByProfile.get(entry.profile_id);
              return (
                <option key={entry.id} value={entry.id}>
                  {profileLabel(profile)} - {formatCentralDateTime(entry.clock_in_at)} ({dollarsInputFromCents(rate?.hourly_rate_cents)}/hr current)
                </option>
              );
            })}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Break start
            <input className="input" name="break_start_at" required type="datetime-local" />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Break end
            <input className="input" name="break_end_at" required type="datetime-local" />
          </label>
        </div>
        <textarea className="input min-h-20" name="reason" required placeholder="Manual break reason" />
        <textarea className="input min-h-20" name="notes" placeholder="Optional notes" />
        <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Add Break" pendingLabel="Adding..." />
      </form>
    </section>
  );
}

export default async function PayrollPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const current = await requireAdminSectionView('payroll');
  const canEditPayroll = adminCanEdit(current.access, 'payroll');
  const activeTab = activeTabParam(searchParams?.tab);
  const success = stringParam(searchParams?.success);
  const error = stringParam(searchParams?.error);
  const todayInput = formatCentralDateInput();
  const currentPayrollWeek = getCurrentPayrollWeekWindow();
  const monthlySalaryWindow = getCurrentMonthlySalaryPayrollWindow();
  const defaultFrom = activeTab === 'reports' ? `${todayInput.slice(0, 8)}01` : currentPayrollWeek.weekStartInput;
  const defaultTo = activeTab === 'reports' ? todayInput : currentPayrollWeek.weekEndInput;
  const fromInput = stringParam(searchParams?.from) || defaultFrom;
  const toInput = stringParam(searchParams?.to) || defaultTo;
  const selectedAdmin = stringParam(searchParams?.admin);
  const selectedWorkType = normalizeWorkType(stringParam(searchParams?.work_type));
  const filterWorkType = stringParam(searchParams?.work_type) ? selectedWorkType : '';
  const fromDate = parseCentralDateInput(fromInput) ?? parseCentralDateInput(defaultFrom)!;
  const toDate = parseCentralDateInput(toInput, true) ?? parseCentralDateInput(defaultTo, true)!;
  const currentParams = {
    admin: selectedAdmin,
    from: fromInput,
    to: toInput,
    work_type: filterWorkType,
  };
  const currentUrl = payrollHref({ ...currentParams, tab: activeTab });

  const [
    adminsResult,
    timeSettingsResult,
    commissionSettingsResult,
    tagAssignmentsResult,
    productionRunLaborResult,
    shippedLaborResult,
    payrollLocksResult,
    salaryPaymentsResult,
  ] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id,email,full_name,is_active')
      .eq('is_admin', true)
      .order('full_name', { ascending: true }),
    supabaseAdmin
      .from('admin_time_settings')
      .select('profile_id,hourly_rate_cents,active,compensation_type,salary_amount_cents,salary_frequency,salary_labor_work_type'),
    supabaseAdmin
      .from('admin_commission_settings')
      .select('profile_id,commission_percent,is_sales_rep'),
    supabaseAdmin
      .from('admin_labor_tag_assignments')
      .select('profile_id,work_type'),
    supabaseAdmin
      .from('production_runs')
      .select('actual_labor_cost_cents')
      .gte('produced_at', fromDate.toISOString())
      .lte('produced_at', toDate.toISOString())
      .limit(50000),
    supabaseAdmin
      .from('order_items')
      .select('cogs_labor_cents,orders!inner(status,shipped_at)')
      .eq('orders.status', 'Shipped')
      .gte('orders.shipped_at', fromDate.toISOString())
      .lte('orders.shipped_at', toDate.toISOString())
      .limit(50000),
    supabaseAdmin
      .from('admin_payroll_locks')
      .select('id,lock_start_at,lock_end_at,locked_at,notes')
      .order('lock_start_at', { ascending: false })
      .limit(50),
    supabaseAdmin
      .from('admin_salary_payroll_payments')
      .select('id,profile_id,payroll_month,period_start_date,period_end_date,salary_amount_cents,salary_frequency,salary_labor_work_type,salary_pay_cents,approved_at,paid_at,notes')
      .order('payroll_month', { ascending: false })
      .order('paid_at', { ascending: false })
      .limit(500),
  ]);

  let entriesQuery = supabaseAdmin
    .from('admin_time_entries')
    .select('id,profile_id,clock_in_at,clock_out_at,hourly_rate_cents_snapshot,status,notes,correction_request_note,manual_reason,correction_reason,voided_at,void_reason,approved_at,locked_at,created_at,work_type,admin_profile:profiles!admin_time_entries_profile_id_fkey(id,email,full_name,is_active),admin_time_breaks(id,break_start_at,break_end_at,status,notes,manual_reason,correction_reason,voided_at,void_reason)')
    .gte('clock_in_at', fromDate.toISOString())
    .lte('clock_in_at', toDate.toISOString())
    .order('clock_in_at', { ascending: false })
    .limit(1000);
  if (selectedAdmin) entriesQuery = entriesQuery.eq('profile_id', selectedAdmin);
  if (filterWorkType) entriesQuery = entriesQuery.eq('work_type', filterWorkType);

  const entriesResult = await entriesQuery;
  const entryIds = ((entriesResult.data ?? []) as TimeEntry[]).map((entry) => entry.id);
  const allocationsResult = entryIds.length
    ? await supabaseAdmin
        .from('admin_time_entry_allocations')
        .select('id,time_entry_id,work_type,production_run_id,minutes,wage_cents,notes')
        .in('time_entry_id', entryIds)
    : { data: [] as AllocationRow[], error: null };

  if (entriesResult.error || allocationsResult.error) {
    console.error('[admin-payroll] page load failed', {
      allocationsError: allocationsResult.error,
      entriesError: entriesResult.error,
    });
    return (
      <div className="space-y-6">
        <section className="panel">
          <span className="eyebrow">Payroll</span>
          <h1 className="page-title mt-4">Payroll</h1>
          <p className="page-subtitle mt-3">The payroll data could not be loaded.</p>
        </section>
        <section className="card text-sm text-red-700">Refresh the page after confirming the latest migrations and Supabase schema cache are current.</section>
      </div>
    );
  }
  if (salaryPaymentsResult.error) {
    console.error('[admin-payroll] salary payment records failed', { error: salaryPaymentsResult.error });
  }
  if (productionRunLaborResult.error || shippedLaborResult.error) {
    console.error('[admin-payroll] cogs report cards failed', {
      productionRunLaborError: productionRunLaborResult.error,
      shippedLaborError: shippedLaborResult.error,
    });
  }

  const admins = ((adminsResult.data ?? []) as AdminProfileRow[]).sort((a, b) => profileLabel(a).localeCompare(profileLabel(b)));
  const adminById = new Map(admins.map((admin) => [admin.id, admin]));
  const timeSettings = (timeSettingsResult.data ?? []) as TimeSettingRow[];
  const timeByProfile = new Map(timeSettings.map((setting) => [setting.profile_id, setting]));
  const commissionByProfile = new Map(((commissionSettingsResult.data ?? []) as CommissionSettingRow[]).map((setting) => [setting.profile_id, setting]));
  const tagsByProfile = new Map<string, Set<LaborWorkType>>();
  for (const assignment of (tagAssignmentsResult.data ?? []) as LaborTagAssignmentRow[]) {
    if (!isLaborWorkType(assignment.work_type)) continue;
    const tags = tagsByProfile.get(assignment.profile_id) ?? new Set<LaborWorkType>();
    tags.add(assignment.work_type);
    tagsByProfile.set(assignment.profile_id, tags);
  }

  const entries = (entriesResult.data ?? []) as TimeEntry[];
  const allocations = (allocationsResult.data ?? []) as AllocationRow[];
  const allocationsByEntry = new Map<string, AllocationRow[]>();
  for (const allocation of allocations) {
    const rows = allocationsByEntry.get(allocation.time_entry_id) ?? [];
    rows.push(allocation);
    allocationsByEntry.set(allocation.time_entry_id, rows);
  }
  const payrollLocks = (payrollLocksResult.data ?? []) as PayrollLockRow[];
  const salaryPayments = salaryPaymentsResult.error ? [] : (salaryPaymentsResult.data ?? []) as SalaryPaymentRow[];
  const salaryPaymentsByProfileMonth = new Map(salaryPayments.map((payment) => [`${payment.profile_id}:${payment.payroll_month}`, payment]));
  const segments = buildSegments(entries, allocationsByEntry);
  const salaryRows = buildSalaryRows({ filterWorkType, fromDate, selectedAdmin, timeSettings, toDate });
  const monthlySalaryRows = timeSettings
    .filter((setting) => setting.active !== false)
    .filter((setting) => normalizeCompensationType(setting.compensation_type) === 'salary')
    .filter((setting) => normalizeSalaryPayFrequency(setting.salary_frequency) === 'monthly')
    .filter((setting) => normalizeMoneyCents(setting.salary_amount_cents) > 0)
    .filter((setting) => !selectedAdmin || setting.profile_id === selectedAdmin)
    .map((setting) => ({
      payment: salaryPaymentsByProfileMonth.get(`${setting.profile_id}:${monthlySalaryWindow.payrollMonthInput}`) ?? null,
      profile: adminById.get(setting.profile_id),
      profileId: setting.profile_id,
      salaryAmountCents: normalizeMoneyCents(setting.salary_amount_cents),
      salaryFrequency: normalizeSalaryPayFrequency(setting.salary_frequency),
      workType: normalizeSalaryLaborWorkType(setting.salary_labor_work_type),
    }))
    .filter((row) => row.profile?.is_active !== false)
    .filter((row) => !filterWorkType || row.workType === filterWorkType);
  const monthlySalaryDueRows = monthlySalaryRows.filter((row) => !row.payment?.paid_at);
  const monthlySalaryPaidRows = monthlySalaryRows.filter((row) => row.payment?.paid_at);
  const monthlySalaryDueCents = monthlySalaryDueRows.reduce((sum, row) => sum + row.salaryAmountCents, 0);
  const monthlySalaryTotalCents = monthlySalaryRows.reduce((sum, row) => sum + row.salaryAmountCents, 0);
  const selectedSalaryPaymentRows = salaryPayments
    .filter((payment) => payment.payroll_month >= fromInput && payment.payroll_month <= toInput)
    .filter((payment) => !selectedAdmin || payment.profile_id === selectedAdmin)
    .filter((payment) => !filterWorkType || normalizeSalaryLaborWorkType(payment.salary_labor_work_type) === filterWorkType);
  const selectedSalaryPaidCents = selectedSalaryPaymentRows.reduce((sum, payment) => sum + normalizeMoneyCents(payment.salary_pay_cents), 0);
  const byEmployee = groupSegmentsByEmployee(segments);
  const byWorkType = groupSegmentsByWorkType(segments);
  applySalaryRowsToEmployeeGroups(byEmployee, salaryRows);
  applySalaryRowsToWorkTypeGroups(byWorkType, salaryRows);

  const totalPaidMinutes = segments.reduce((sum, segment) => sum + segment.minutes, 0);
  const totalHourlyWages = segments.reduce((sum, segment) => sum + segment.wageCents, 0);
  const totalSalaryPay = salaryRows.reduce((sum, salary) => sum + salary.salaryCents, 0);
  const totalPay = totalHourlyWages + totalSalaryPay;
  const totalLunchMinutes = entries.reduce((sum, entry) => sum + completedBreakMinutes(entryBreaks(entry)), 0);
  const productionHourlyWages = segments.filter((segment) => segment.workType === 'production').reduce((sum, segment) => sum + segment.wageCents, 0);
  const productionSalaryPay = salaryRows.filter((salary) => salary.workType === 'production').reduce((sum, salary) => sum + salary.salaryCents, 0);
  const productionPayrollWages = productionHourlyWages + productionSalaryPay;
  const productionSegments = segments.filter((segment) => segment.workType === 'production');
  const productionPaidMinutes = productionSegments.reduce((sum, segment) => sum + segment.minutes, 0);
  const linkedProductionWages = productionSegments.filter((segment) => segment.productionRunId).reduce((sum, segment) => sum + segment.wageCents, 0);
  const productionRunLaborCogs = productionRunLaborResult.error ? 0 : ((productionRunLaborResult.data ?? []) as Array<{ actual_labor_cost_cents: number | string | null }>).reduce(
    (sum, run) => sum + numericValue(run.actual_labor_cost_cents),
    0
  );
  const shippedLaborCogs = shippedLaborResult.error ? 0 : ((shippedLaborResult.data ?? []) as Array<{ cogs_labor_cents: number | string | null }>).reduce((sum, item) => sum + numericValue(item.cogs_labor_cents), 0);
  const productionRunVariance = productionPayrollWages - productionRunLaborCogs;
  const shippedVariance = productionPayrollWages - shippedLaborCogs;
  const shippedVariancePercent = shippedLaborCogs ? (shippedVariance / shippedLaborCogs) * 100 : productionPayrollWages ? 100 : 0;
  const productionRunCogsDetail = selectedAdmin || filterWorkType
    ? 'Date range only; admin and tag filters do not apply to production runs.'
    : 'Actual labor COGS recorded into finished production.';
  const productionRunVarianceDetail = selectedAdmin || filterWorkType
    ? 'Filtered payroll labor minus date-only production run labor COGS.'
    : 'Payroll production labor minus production run labor COGS.';

  const now = new Date();
  const openEntries = entries.filter((entry) => !entry.clock_out_at && entry.status !== 'void');
  const longOpenEntries = openEntries.filter((entry) => ((now.getTime() - new Date(entry.clock_in_at).getTime()) / 60000) >= OPEN_SHIFT_ALERT_MINUTES);
  const longOpenBreaks = openEntries.flatMap((entry) =>
    entryBreaks(entry)
      .filter((entryBreak) => !entryBreak.break_end_at && entryBreak.status !== 'void')
      .filter((entryBreak) => ((now.getTime() - new Date(entryBreak.break_start_at).getTime()) / 60000) >= OPEN_LUNCH_ALERT_MINUTES)
      .map((entryBreak) => ({ entry, entryBreak }))
  );
  const unassignedEntries = entries.filter((entry) => normalizeWorkType(entry.work_type) === UNASSIGNED_WORK_TYPE && entry.status !== 'void');
  const employeesWithoutTags = admins.filter((admin) => !(tagsByProfile.get(admin.id)?.size));
  const unapprovedEntries = entries.filter((entry) => entry.clock_out_at && !['approved', 'locked', 'void'].includes(entry.status ?? ''));
  const manualEntries = entries.filter((entry) => Boolean(entry.manual_reason));
  const correctedEntries = entries.filter((entry) => Boolean(entry.correction_reason));
  const voidedEntries = entries.filter((entry) => entry.status === 'void');
  const productionByDayEmployee = new Map<string, { dateInput: string; entryCount: Set<string>; minutes: number; profileId: string; wageCents: number }>();
  for (const segment of productionSegments) {
    const dateInput = formatCentralDateInput(segment.entry.clock_in_at);
    const key = `${dateInput}:${segment.entry.profile_id}`;
    const row = productionByDayEmployee.get(key) ?? { dateInput, entryCount: new Set<string>(), minutes: 0, profileId: segment.entry.profile_id, wageCents: 0 };
    row.entryCount.add(segment.entry.id);
    row.minutes += segment.minutes;
    row.wageCents += segment.wageCents;
    productionByDayEmployee.set(key, row);
  }
  const productionDailyRows = [...productionByDayEmployee.values()].sort((a, b) => `${b.dateInput}:${profileLabel(adminById.get(b.profileId))}`.localeCompare(`${a.dateInput}:${profileLabel(adminById.get(a.profileId))}`));
  const rangeHasCoveringLock = payrollLocks.some((lock) => new Date(lock.lock_start_at) <= fromDate && new Date(lock.lock_end_at) >= toDate);
  const canCompletePayroll = !rangeHasCoveringLock && openEntries.length === 0 && unapprovedEntries.length === 0;

  return (
    <div className="space-y-6">
      {successMessage(success) ? <StatusToast message={successMessage(success)} tone="success" /> : null}
      {error ? <StatusToast message={errorMessage(error)} tone="error" /> : null}
      {salaryPaymentsResult.error ? <section className="card text-sm text-red-700">Salary payment records are not available yet. Run the monthly salary payroll migration to approve and mark salary paid.</section> : null}

      <section className="panel">
        <span className="eyebrow">Payroll</span>
        <h1 className="page-title mt-4">Payroll and labor reporting</h1>
        <p className="page-subtitle mt-3">Review weekly hours, manage time entries, and report labor by employee, tag, and production day.</p>
      </section>

      <nav aria-label="Payroll sections" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {PAYROLL_TABS.map((tab) => (
          <Link
            key={tab.id}
            className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition-all duration-200 ${activeTab === tab.id ? 'border-teal-200 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white/70 text-slate-700 hover:border-teal-100 hover:bg-white'}`}
            href={tabHref(tab.id, currentParams)}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <form className="card grid gap-3 md:grid-cols-5">
        <input name="tab" type="hidden" value={activeTab} />
        <label className="space-y-2 text-sm font-medium text-slate-700">
          From
          <input className="input" name="from" type="date" defaultValue={fromInput} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          To
          <input className="input" name="to" type="date" defaultValue={toInput} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Admin
          <select className="input" name="admin" defaultValue={selectedAdmin}>
            <option value="">All admins</option>
            {admins.map((admin) => (
              <option key={admin.id} value={admin.id}>{profileLabel(admin)}{admin.is_active === false ? ' (inactive)' : ''}</option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Labor tag
          <select className="input" name="work_type" defaultValue={filterWorkType}>
            <option value="">All tags</option>
            <option value={UNASSIGNED_WORK_TYPE}>Unassigned</option>
            {LABOR_WORK_TYPES.map((workType) => (
              <option key={workType.value} value={workType.value}>{workType.label}</option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button className="btn-primary w-full" type="submit">Update</button>
        </div>
      </form>

      {activeTab === 'reports' ? (
        <section className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Paid Hours" value={hoursLabel(totalPaidMinutes)} detail="Completed, non-void time in range." />
            <StatTile label="Unpaid Lunch" value={hoursLabel(totalLunchMinutes)} detail="Completed, non-void lunch time." />
            <StatTile label="Estimated Wages" value={usd(totalHourlyWages)} detail="Uses each shift's rate snapshot." />
            <StatTile label="Open Issues" value={String(longOpenEntries.length + longOpenBreaks.length + unapprovedEntries.length)} detail="Long open shifts/lunches and unapproved shifts." />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Payroll Production Labor" value={usd(productionPayrollWages)} detail="Production-tagged payroll wages." />
            <StatTile label="Linked to Production Runs" value={usd(linkedProductionWages)} detail="Production payroll assigned to runs." />
            <StatTile label="Production Run Labor COGS" value={usd(productionRunLaborCogs)} detail={productionRunCogsDetail} />
            <StatTile label="Payroll vs Run COGS" value={usd(productionRunVariance)} detail={productionRunVarianceDetail} />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Shipped Labor COGS" value={usd(shippedLaborCogs)} detail="Labor COGS in shipped order lines." />
            <StatTile label="Labor COGS Variance" value={usd(shippedVariance)} detail={`${percent(shippedVariancePercent)} versus shipped labor COGS.`} />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Estimated Salary" value={usd(totalSalaryPay)} detail="Prorated estimate for salaried employees in range." />
            <StatTile label="Paid Salary Records" value={usd(selectedSalaryPaidCents)} detail={`${selectedSalaryPaymentRows.length} salary payment record${selectedSalaryPaymentRows.length === 1 ? '' : 's'} in range.`} />
            <StatTile label="Estimated Pay" value={usd(totalPay)} detail="Hourly wages plus estimated salary." />
            <StatTile label="Production Hours" value={hoursLabel(productionPaidMinutes)} detail="Hours clocked or allocated to Production." />
          </div>
        </section>
      ) : null}

      {activeTab === 'reports' ? (
        <section className="space-y-5">
          <section className="card space-y-4">
            <h2 className="text-xl font-semibold text-slate-950">Labor by employee</h2>
            {!byEmployee.size ? <EmptyState message="No completed time entries found for the selected filters." /> : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[58rem] border-separate border-spacing-y-2 text-left text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    <th className="px-4 py-2">Employee</th>
                    <th className="px-4 py-2 text-right">Entries</th>
                    <th className="px-4 py-2 text-right">Paid hours</th>
                    <th className="px-4 py-2 text-right">Hourly</th>
                    <th className="px-4 py-2 text-right">Salary</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2">Top tags</th>
                  </tr>
                </thead>
                <tbody>
                  {[...byEmployee.entries()].map(([profileId, row]) => {
                    const topTags = [...row.workTypes.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(([workType, minutes]) => `${workTypeLabel(workType)} ${hoursLabel(minutes)}h`)
                      .join(', ');
                    return (
                      <tr key={profileId} className="bg-white/70">
                        <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{profileLabel(adminById.get(profileId))}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{row.entryCount.size}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{hoursLabel(row.minutes)}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{usd(row.hourlyWageCents)}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{usd(row.salaryCents)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-950">{usd(row.hourlyWageCents + row.salaryCents)}</td>
                        <td className="rounded-r-xl px-4 py-3 text-slate-600">{topTags || 'None'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card space-y-4">
            <h2 className="text-xl font-semibold text-slate-950">Paid salary records</h2>
            {!selectedSalaryPaymentRows.length ? <EmptyState message="No paid monthly salary records found for the selected filters." /> : null}
            {selectedSalaryPaymentRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] border-separate border-spacing-y-2 text-left text-sm">
                  <thead>
                    <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      <th className="px-4 py-2">Employee</th>
                      <th className="px-4 py-2">Paid month</th>
                      <th className="px-4 py-2">Labor tag</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSalaryPaymentRows.map((payment) => (
                      <tr key={payment.id} className="bg-white/70">
                        <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{profileLabel(adminById.get(payment.profile_id))}</td>
                        <td className="px-4 py-3 text-slate-700">{formatDateInputLabel(payment.period_start_date)} to {formatDateInputLabel(payment.period_end_date)}</td>
                        <td className="px-4 py-3 text-slate-700">{workTypeLabel(payment.salary_labor_work_type)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-950">{usd(normalizeMoneyCents(payment.salary_pay_cents))}</td>
                        <td className="rounded-r-xl px-4 py-3 text-slate-700">{formatCentralDateTime(payment.paid_at, 'Not paid')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="card space-y-4">
            <h2 className="text-xl font-semibold text-slate-950">Labor by tag</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[UNASSIGNED_WORK_TYPE, ...LABOR_WORK_TYPES.map((workType) => workType.value)].map((workType) => {
                const row = byWorkType.get(workType as TimeEntryWorkType) ?? { entryCount: new Set<string>(), hourlyWageCents: 0, minutes: 0, salaryCents: 0 };
                const totalCents = row.hourlyWageCents + row.salaryCents;
                return (
                  <StatTile
                    key={workType}
                    label={workTypeLabel(workType)}
                    value={usd(totalCents)}
                    detail={`${hoursLabel(row.minutes)} paid hours across ${row.entryCount.size} shift(s).${row.salaryCents ? ` Salary ${usd(row.salaryCents)}.` : ''}`}
                  />
                );
              })}
            </div>
          </section>

          <section className="card space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Production hours by day</h2>
              <p className="mt-1 text-sm text-slate-500">Production is counted from time entries or allocations tagged as Production.</p>
            </div>
            {!productionDailyRows.length ? <EmptyState message="No Production-tagged hours found for the selected filters." /> : null}
            {productionDailyRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] border-separate border-spacing-y-2 text-left text-sm">
                  <thead>
                    <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Employee</th>
                      <th className="px-4 py-2 text-right">Entries</th>
                      <th className="px-4 py-2 text-right">Hours</th>
                      <th className="px-4 py-2 text-right">Wages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionDailyRows.map((row) => (
                      <tr key={`${row.dateInput}-${row.profileId}`} className="bg-white/70">
                        <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{formatDateInputLabel(row.dateInput)}</td>
                        <td className="px-4 py-3 text-slate-700">{profileLabel(adminById.get(row.profileId))}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{row.entryCount.size}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-950">{hoursLabel(row.minutes)}</td>
                        <td className="rounded-r-xl px-4 py-3 text-right font-semibold text-slate-950">{usd(row.wageCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <div className="card space-y-3">
              <h2 className="text-xl font-semibold text-slate-950">Needs review</h2>
              {!longOpenEntries.length && !longOpenBreaks.length && !unassignedEntries.length && !unapprovedEntries.length ? <EmptyState message="No major exceptions found for this range." /> : null}
              {longOpenEntries.map((entry) => <p key={entry.id} className="text-sm text-amber-800">{profileLabel(profileForEntry(entry))} has an open shift from {formatCentralDateTime(entry.clock_in_at)}.</p>)}
              {longOpenBreaks.map(({ entry, entryBreak }) => <p key={entryBreak.id} className="text-sm text-amber-800">{profileLabel(profileForEntry(entry))} has an open lunch from {formatCentralDateTime(entryBreak.break_start_at)}.</p>)}
              {unassignedEntries.map((entry) => <p key={entry.id} className="text-sm text-slate-700">{profileLabel(profileForEntry(entry))} has unassigned labor from {formatCentralDateTime(entry.clock_in_at)}.</p>)}
              {unapprovedEntries.map((entry) => <p key={entry.id} className="text-sm text-slate-700">{profileLabel(profileForEntry(entry))} has an unapproved shift from {formatCentralDateTime(entry.clock_in_at)}.</p>)}
            </div>
            <div className="card space-y-3">
              <h2 className="text-xl font-semibold text-slate-950">Audit signals</h2>
              <p className="text-sm text-slate-600">Employees without tags: {employeesWithoutTags.length}</p>
              <p className="text-sm text-slate-600">Manual entries: {manualEntries.length}</p>
              <p className="text-sm text-slate-600">Corrected entries: {correctedEntries.length}</p>
              <p className="text-sm text-slate-600">Voided entries: {voidedEntries.length}</p>
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === 'time' ? (
        <section className="card space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Entries & corrections</h2>
            <p className="mt-1 text-sm text-slate-500">Correct times, tags, rate snapshots, approve entries, void bad punches, and split labor across work types.</p>
          </div>
          <EntriesTable allocationsByEntry={allocationsByEntry} entries={entries} returnTo={currentUrl} />
        </section>
      ) : null}

      {activeTab === 'time' ? (
        <section className="card space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Breaks / lunch</h2>
            <p className="mt-1 text-sm text-slate-500">Correct lunch and unpaid break records or void bad break punches.</p>
          </div>
          <BreaksTable entries={entries} returnTo={currentUrl} />
        </section>
      ) : null}

      {activeTab === 'time' ? (
        <ManualEntriesPanel admins={admins} entries={entries} returnTo={currentUrl} selectedAdmin={selectedAdmin} timeByProfile={timeByProfile} />
      ) : null}

      {activeTab === 'review' ? (
        <section className="space-y-5">
          <section className={`card space-y-4 ${monthlySalaryDueRows.length ? 'border-rose-200 bg-rose-50/50' : 'border-emerald-100 bg-emerald-50/40'}`}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Monthly salary payroll</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {formatDateInputLabel(monthlySalaryWindow.periodStartInput)} to {formatDateInputLabel(monthlySalaryWindow.periodEndInput)}.
                </p>
              </div>
              <span className={`w-fit rounded-full px-3 py-1 text-sm font-semibold ${monthlySalaryDueRows.length ? 'bg-white text-rose-800 ring-1 ring-rose-100' : 'bg-emerald-100 text-emerald-800'}`}>
                {monthlySalaryDueRows.length ? 'Needs paid' : 'Complete'}
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Monthly Employees" value={String(monthlySalaryRows.length)} detail="Active monthly salaried employees." />
              <StatTile label="Need Paid" value={String(monthlySalaryDueRows.length)} detail="Missing paid records for the month." />
              <StatTile label="Paid Records" value={String(monthlySalaryPaidRows.length)} detail="Approved and marked paid." />
              <StatTile label="Amount Due" value={usd(monthlySalaryDueCents)} detail={`${usd(monthlySalaryTotalCents)} total monthly salary.`} />
            </div>
            {!monthlySalaryRows.length ? <EmptyState message="No active monthly salaried employees found." /> : null}
            {monthlySalaryRows.length ? (
              <div className="space-y-2">
                {monthlySalaryRows.map((row) => (
                  <div key={row.profileId} className="grid gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4 lg:grid-cols-[minmax(0,1fr)_8rem_9rem_14rem] lg:items-center">
                    <div>
                      <p className="font-semibold text-slate-950">{profileLabel(row.profile)}</p>
                      <p className="mt-1 text-sm text-slate-500">{workTypeLabel(row.workType)} salary for {formatDateInputLabel(monthlySalaryWindow.periodStartInput)} to {formatDateInputLabel(monthlySalaryWindow.periodEndInput)}</p>
                    </div>
                    <p className="text-sm font-semibold text-slate-950 lg:text-right">{usd(row.salaryAmountCents)}</p>
                    <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${row.payment?.paid_at ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'}`}>
                      {row.payment?.paid_at ? 'Paid' : 'Due'}
                    </span>
                    {row.payment?.paid_at ? (
                      <p className="text-sm text-slate-500">Paid {formatCentralDateTime(row.payment.paid_at)}</p>
                    ) : canEditPayroll ? (
                      <form action={approveMonthlySalaryPayment} className="space-y-2">
                        {returnToInput(currentUrl)}
                        <input name="profile_id" type="hidden" value={row.profileId} />
                        <input name="payroll_month" type="hidden" value={monthlySalaryWindow.payrollMonthInput} />
                        <input name="period_start_date" type="hidden" value={monthlySalaryWindow.periodStartInput} />
                        <input name="period_end_date" type="hidden" value={monthlySalaryWindow.periodEndInput} />
                        <input className="input" name="notes" placeholder="Optional note" />
                        <PendingSubmitButton className="btn-primary w-full" label="Approve & Mark Paid" pendingLabel="Saving..." />
                      </form>
                    ) : (
                      <p className="text-sm text-slate-500">View only</p>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
            {salaryPayments.length ? (
              <details className="rounded-2xl border border-slate-200 bg-white/60 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">Recent salary payment records</summary>
                <div className="mt-3 space-y-2">
                  {salaryPayments.slice(0, 10).map((payment) => (
                    <div key={payment.id} className="grid gap-2 rounded-xl border border-slate-200 bg-white/70 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_8rem_12rem] sm:items-center">
                      <div>
                        <p className="font-semibold text-slate-950">{profileLabel(adminById.get(payment.profile_id))}</p>
                        <p className="mt-1 text-slate-500">{formatDateInputLabel(payment.period_start_date)} to {formatDateInputLabel(payment.period_end_date)}</p>
                      </div>
                      <p className="font-semibold text-slate-950 sm:text-right">{usd(normalizeMoneyCents(payment.salary_pay_cents))}</p>
                      <p className="text-slate-500">Paid {formatCentralDateTime(payment.paid_at, 'Not paid')}</p>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </section>

          <section className={`card space-y-4 ${rangeHasCoveringLock ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-100 bg-amber-50/40'}`}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Weekly payroll review</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {formatDateInputLabel(fromInput)} to {formatDateInputLabel(toInput)}{selectedAdmin ? ` for ${profileLabel(adminById.get(selectedAdmin))}` : ''}.
                </p>
              </div>
              <span className={`w-fit rounded-full px-3 py-1 text-sm font-semibold ${rangeHasCoveringLock ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-amber-800 ring-1 ring-amber-100'}`}>
                {rangeHasCoveringLock ? 'Completed' : 'Needs approval'}
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Open Shifts" value={String(openEntries.length)} detail="Must be clocked out before completion." />
              <StatTile label="Need Approval" value={String(unapprovedEntries.length)} detail="Completed shifts not approved or locked." />
              <StatTile label="Paid Hours" value={hoursLabel(totalPaidMinutes)} detail="Completed, non-void time in this range." />
              <StatTile label="Estimated Pay" value={usd(totalPay)} detail="Hourly wages plus prorated salary." />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <form action={approveCompletedWeekEntries}>
                {returnToInput(currentUrl)}
                <input name="lock_start" type="hidden" value={fromInput} />
                <input name="lock_end" type="hidden" value={toInput} />
                <input name="profile_id" type="hidden" value={selectedAdmin} />
                <PendingSubmitButton
                  className="btn-primary w-full sm:w-auto"
                  disabled={!unapprovedEntries.length || rangeHasCoveringLock}
                  disabledLabel={rangeHasCoveringLock ? 'Week Completed' : 'No Shifts to Approve'}
                  label="Approve Completed Shifts"
                  pendingLabel="Approving..."
                />
              </form>
              <Link className="btn-secondary w-full sm:w-auto" href={payrollHref({ ...currentParams, tab: 'time' })}>Review Time Entries</Link>
            </div>
          </section>

          <section className="card space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Approvals needed</h2>
              <p className="mt-1 text-sm text-slate-500">Approve completed submitted shifts before completing the week.</p>
            </div>
            {!unapprovedEntries.length ? <EmptyState message="No unapproved completed shifts found for this range." /> : null}
            <div className="space-y-2">
              {unapprovedEntries.map((entry) => (
                <div key={entry.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white/65 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div>
                    <p className="font-semibold text-slate-950">{profileLabel(profileForEntry(entry))}</p>
                    <p className="mt-1 text-sm text-slate-500">{formatCentralDateTime(entry.clock_in_at)} to {formatCentralDateTime(entry.clock_out_at)} - {hoursLabel(paidMinutes(entry, entryBreaks(entry)))} paid hours</p>
                  </div>
                  <form action={approveEntry}>
                    {returnToInput(currentUrl)}
                    <input name="entry_id" type="hidden" value={entry.id} />
                    <PendingSubmitButton className="btn-primary w-full md:w-auto" label="Approve" pendingLabel="Approving..." />
                  </form>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <form action={lockPayrollRange} className="card space-y-4">
              {returnToInput(currentUrl)}
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Complete payroll week</h2>
                <p className="mt-1 text-sm text-slate-500">Locks the selected week after all shifts are closed and approved.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  Week start
                  <input className="input" name="lock_start" type="date" defaultValue={fromInput} required />
                </label>
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  Week end
                  <input className="input" name="lock_end" type="date" defaultValue={toInput} required />
                </label>
              </div>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Admin
                <select className="input" name="profile_id" defaultValue={selectedAdmin}>
                  <option value="">All admins</option>
                  {admins.map((admin) => (
                    <option key={admin.id} value={admin.id}>{profileLabel(admin)}{admin.is_active === false ? ' (inactive)' : ''}</option>
                  ))}
                </select>
              </label>
              <textarea className="input min-h-20" name="notes" placeholder="Optional lock note" />
              <PendingSubmitButton
                className="btn-primary w-full sm:w-auto"
                disabled={!canCompletePayroll}
                disabledLabel={rangeHasCoveringLock ? 'Week Completed' : openEntries.length ? 'Close Open Shifts First' : 'Approve Shifts First'}
                label="Complete Payroll Week"
                pendingLabel="Completing..."
              />
            </form>

            <section className="card space-y-4">
              <h2 className="text-xl font-semibold text-slate-950">Recent locks</h2>
              {!payrollLocks.length ? <EmptyState message="No payroll ranges have been locked yet." /> : null}
              <div className="space-y-2">
                {payrollLocks.map((lock) => (
                  <div key={lock.id} className="rounded-2xl border border-slate-200 bg-white/65 p-4">
                    <p className="font-semibold text-slate-950">{formatCentralDateTime(lock.lock_start_at)} to {formatCentralDateTime(lock.lock_end_at)}</p>
                    <p className="mt-1 text-sm text-slate-500">Locked {formatCentralDateTime(lock.locked_at)}{lock.notes ? ` - ${lock.notes}` : ''}</p>
                  </div>
                ))}
              </div>
            </section>
          </section>
        </section>
      ) : null}

      {activeTab === 'settings' ? (
        <section className="space-y-4">
          <section className="card space-y-2">
            <h2 className="text-xl font-semibold text-slate-950">Rates, commissions, and labor tags</h2>
            <p className="text-sm text-slate-500">Hourly rates snapshot when employees clock in. Salary pay is prorated into the selected payroll date range. Commission percentages apply to shipped-order gross profit and snapshot when orders ship.</p>
          </section>
          {!admins.length ? <EmptyState message="No admin employees found." /> : null}
          {admins.map((admin) => {
            const timeSetting = timeByProfile.get(admin.id);
            const commissionSetting = commissionByProfile.get(admin.id);
            const employeeTags = tagsByProfile.get(admin.id) ?? new Set<LaborWorkType>();
            return (
              <form key={admin.id} action={updatePayrollSettings} className="card space-y-4">
                {returnToInput(currentUrl)}
                <input type="hidden" name="profile_id" value={admin.id} />
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_10rem_auto] lg:items-end">
                  <div>
                    <p className="text-lg font-semibold text-slate-950">{profileLabel(admin)}</p>
                    <p className="mt-1 break-all text-sm text-slate-500">{admin.email}</p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{admin.is_active === false ? 'Inactive' : 'Active'}</p>
                  </div>
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    Pay type
                    <select className="input" name="compensation_type" defaultValue={normalizeCompensationType(timeSetting?.compensation_type)}>
                      {COMPENSATION_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    Hourly rate
                    <input className="input" name="hourly_rate" type="number" min="0" step="0.01" defaultValue={dollarsInputFromCents(timeSetting?.hourly_rate_cents)} />
                  </label>
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    Commission %
                    <input className="input" name="commission_percent" type="number" min="0" max="100" step="0.01" defaultValue={percentInputValue(commissionSetting?.commission_percent)} />
                  </label>
                  <PendingSubmitButton className="btn-primary w-full lg:w-auto" label="Save" pendingLabel="Saving..." />
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    Salary amount
                    <input className="input" name="salary_amount" type="number" min="0" step="0.01" defaultValue={dollarsInputFromCents(timeSetting?.salary_amount_cents)} />
                  </label>
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    Salary frequency
                    <select className="input" name="salary_frequency" defaultValue={normalizeSalaryPayFrequency(timeSetting?.salary_frequency)}>
                      {SALARY_PAY_FREQUENCIES.map((frequency) => (
                        <option key={frequency.value} value={frequency.value}>{frequency.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    Salary labor tag
                    <select className="input" name="salary_labor_work_type" defaultValue={normalizeSalaryLaborWorkType(timeSetting?.salary_labor_work_type)}>
                      {LABOR_WORK_TYPES.map((workType) => (
                        <option key={workType.value} value={workType.value}>{workType.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <p className="text-sm text-slate-500">
                    Current setup: {compensationTypeLabel(timeSetting?.compensation_type)}{normalizeCompensationType(timeSetting?.compensation_type) === 'salary' ? ` - ${usd(normalizeMoneyCents(timeSetting?.salary_amount_cents))} ${salaryPayFrequencyLabel(timeSetting?.salary_frequency).toLowerCase()}` : ''}.
                  </p>
                  <label className="flex min-h-[3.25rem] items-center gap-3 rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm font-semibold text-slate-700">
                    <input type="checkbox" name="is_sales_rep" defaultChecked={Boolean(commissionSetting?.is_sales_rep)} />
                    Sales Rep
                  </label>
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-950">Labor tags</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {LABOR_WORK_TYPES.map((workType) => (
                      <label key={workType.value} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm font-medium text-slate-700">
                        <input type="checkbox" name="labor_tag" value={workType.value} defaultChecked={employeeTags.has(workType.value)} />
                        {workType.label}
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">If more than one tag is checked, this employee chooses what they are doing when they clock in.</p>
                </div>
              </form>
            );
          })}
        </section>
      ) : null}

      {activeTab === 'export' ? (
        <section className="card space-y-4">
          <h2 className="text-xl font-semibold text-slate-950">Export payroll</h2>
          <p className="text-sm text-slate-500">Exports include time entries, salary rows, labor tag, lunch time, paid hours, pay amount, and review metadata.</p>
          <Link
            className="btn-primary w-full sm:w-fit"
            href={`/api/export/time-entries?from=${encodeURIComponent(fromInput)}&to=${encodeURIComponent(toInput)}${selectedAdmin ? `&admin=${encodeURIComponent(selectedAdmin)}` : ''}${filterWorkType ? `&work_type=${encodeURIComponent(filterWorkType)}` : ''}`}
          >
            Export CSV
          </Link>
        </section>
      ) : null}
    </div>
  );
}
