import { NextRequest } from 'next/server';
import { isOwnerEmail } from '@/lib/admin-permission-definitions';
import { adminCanEdit, getAdminAccessForProfile } from '@/lib/admin-permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  completedBreakMinutes,
  formatCentralDateTime,
  hoursFromMinutes,
  isLaborWorkType,
  normalizeWorkType,
  paidMinutes,
  parseCentralDateInput,
  salaryCentsForDateRange,
  salaryPayFrequencyLabel,
  wageCentsForMinutes,
  workTypeLabel,
  type TimeClockBreakRow,
  type TimeClockEntryRow,
} from '@/lib/time-clock';
import { usd } from '@/lib/utils';

type ExportEntry = TimeClockEntryRow & {
  admin_profile?: { email: string | null; full_name: string | null } | { email: string | null; full_name: string | null }[] | null;
  admin_time_breaks?: TimeClockBreakRow[];
  approved_at: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  correction_request_note: string | null;
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

type ExportAdminProfile = {
  email: string | null;
  full_name: string | null;
  id: string;
};

type ExportTimeSetting = {
  active: boolean | null;
  compensation_type: string | null;
  profile_id: string;
  salary_amount_cents: number | string | null;
  salary_frequency: string | null;
  salary_labor_work_type: string | null;
};

function csvCell(value: unknown) {
  const raw = String(value ?? '');
  return `"${raw.replaceAll('"', '""')}"`;
}

function profileLabel(entry: ExportEntry) {
  const profile = Array.isArray(entry.admin_profile) ? entry.admin_profile[0] : entry.admin_profile;
  return profile?.full_name || profile?.email || 'Unknown admin';
}

function adminProfileLabel(profile: ExportAdminProfile | null | undefined) {
  return profile?.full_name || profile?.email || 'Unknown admin';
}

function normalizeSalaryLaborWorkType(value: string | null | undefined) {
  return isLaborWorkType(String(value ?? '')) ? String(value) : 'admin';
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id,email,is_admin,is_active,is_superadmin')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.is_admin || (profile.is_active !== true && !isOwnerEmail(user.email || profile.email))) {
    return new Response('Forbidden', { status: 403 });
  }

  const access = await getAdminAccessForProfile({ email: user.email || profile.email, isSuperadmin: profile.is_superadmin, profileId: profile.id, supabase });
  if (!adminCanEdit(access, 'payroll')) {
    return new Response('Forbidden', { status: 403 });
  }

  const fromInput = request.nextUrl.searchParams.get('from');
  const toInput = request.nextUrl.searchParams.get('to');
  const adminId = request.nextUrl.searchParams.get('admin');
  const workType = normalizeWorkType(request.nextUrl.searchParams.get('work_type'));
  const hasWorkTypeFilter = Boolean(request.nextUrl.searchParams.get('work_type'));
  const from = parseCentralDateInput(fromInput);
  const to = parseCentralDateInput(toInput, true);
  if (!from || !to || to < from) {
    return new Response('Invalid date range', { status: 400 });
  }

  let query = supabaseAdmin
    .from('admin_time_entries')
    .select('id,profile_id,clock_in_at,clock_out_at,hourly_rate_cents_snapshot,status,notes,correction_request_note,manual_reason,approved_at,locked_at,voided_at,void_reason,work_type,admin_profile:profiles!admin_time_entries_profile_id_fkey(email,full_name),admin_time_breaks(break_start_at,break_end_at,status)')
    .gte('clock_in_at', from.toISOString())
    .lte('clock_in_at', to.toISOString())
    .order('clock_in_at', { ascending: true });

  if (adminId) query = query.eq('profile_id', adminId);
  if (hasWorkTypeFilter) query = query.eq('work_type', workType);
  const [{ data, error }, settingsResult, adminsResult] = await Promise.all([
    query,
    supabaseAdmin
      .from('admin_time_settings')
      .select('profile_id,active,compensation_type,salary_amount_cents,salary_frequency,salary_labor_work_type'),
    supabaseAdmin
      .from('profiles')
      .select('id,email,full_name')
      .eq('is_admin', true),
  ]);
  if (error) return new Response(error.message, { status: 500 });
  if (settingsResult.error) return new Response(settingsResult.error.message, { status: 500 });
  if (adminsResult.error) return new Response(adminsResult.error.message, { status: 500 });

  const adminById = new Map(((adminsResult.data ?? []) as ExportAdminProfile[]).map((admin) => [admin.id, admin]));
  const salaryRows = ((settingsResult.data ?? []) as ExportTimeSetting[])
    .filter((setting) => setting.active !== false)
    .filter((setting) => setting.compensation_type === 'salary')
    .filter((setting) => !adminId || setting.profile_id === adminId)
    .map((setting) => ({
      ...setting,
      salaryCents: salaryCentsForDateRange({
        end: to,
        salaryAmountCents: setting.salary_amount_cents,
        salaryFrequency: setting.salary_frequency,
        start: from,
      }),
      workType: normalizeSalaryLaborWorkType(setting.salary_labor_work_type),
    }))
    .filter((setting) => setting.salaryCents > 0)
    .filter((setting) => !hasWorkTypeFilter || setting.workType === workType);

  const rows = [
    [
      'row_type',
      'admin',
      'status',
      'work_type',
      'clock_in',
      'clock_out',
      'lunch_hours',
      'paid_hours',
      'rate_snapshot',
      'estimated_wages',
      'notes',
      'correction_request',
      'manual_reason',
      'approved_at',
      'locked_at',
      'voided_at',
      'void_reason',
      'compensation_type',
      'salary_frequency',
    ],
    ...((data ?? []) as ExportEntry[]).map((entry) => {
      const breaks = (entry.admin_time_breaks ?? []).filter((entryBreak) => entryBreak.status !== 'void');
      const lunchMinutes = completedBreakMinutes(breaks);
      const entryPaidMinutes = paidMinutes(entry, breaks);
      const rateCents = Number(entry.hourly_rate_cents_snapshot ?? 0);
      return [
        'time_entry',
        profileLabel(entry),
        entry.status ?? '',
        workTypeLabel(entry.work_type),
        formatCentralDateTime(entry.clock_in_at, ''),
        formatCentralDateTime(entry.clock_out_at, ''),
        hoursFromMinutes(lunchMinutes).toFixed(2),
        hoursFromMinutes(entryPaidMinutes).toFixed(2),
        usd(rateCents),
        usd(wageCentsForMinutes(entryPaidMinutes, rateCents)),
        entry.notes ?? '',
        entry.correction_request_note ?? '',
        entry.manual_reason ?? '',
        formatCentralDateTime(entry.approved_at, ''),
        formatCentralDateTime(entry.locked_at, ''),
        formatCentralDateTime(entry.voided_at, ''),
        entry.void_reason ?? '',
        'hourly',
        '',
      ];
    }),
    ...salaryRows.map((salary) => [
      'salary',
      adminProfileLabel(adminById.get(salary.profile_id)),
      'salary',
      workTypeLabel(salary.workType),
      '',
      '',
      '0.00',
      '0.00',
      usd(Number(salary.salary_amount_cents ?? 0)),
      usd(salary.salaryCents),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'salary',
      salaryPayFrequencyLabel(salary.salary_frequency),
    ]),
  ];

  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  return new Response(csv, {
    headers: {
      'content-disposition': `attachment; filename="time-entries-${fromInput}-to-${toInput}.csv"`,
      'content-type': 'text/csv',
    },
  });
}
