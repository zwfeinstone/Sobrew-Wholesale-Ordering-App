import { NextRequest } from 'next/server';
import { isOwnerEmail } from '@/lib/admin-permission-definitions';
import { adminCanEdit, getAdminAccessForProfile } from '@/lib/admin-permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  completedBreakMinutes,
  formatCentralDateTime,
  hoursFromMinutes,
  normalizeWorkType,
  paidMinutes,
  parseCentralDateInput,
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

function csvCell(value: unknown) {
  const raw = String(value ?? '');
  return `"${raw.replaceAll('"', '""')}"`;
}

function profileLabel(entry: ExportEntry) {
  const profile = Array.isArray(entry.admin_profile) ? entry.admin_profile[0] : entry.admin_profile;
  return profile?.full_name || profile?.email || 'Unknown admin';
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id,email,is_admin,is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.is_admin || (profile.is_active !== true && !isOwnerEmail(user.email || profile.email))) {
    return new Response('Forbidden', { status: 403 });
  }

  const access = await getAdminAccessForProfile({ email: user.email || profile.email, profileId: profile.id, supabase });
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
  const { data, error } = await query;
  if (error) return new Response(error.message, { status: 500 });

  const rows = [
    [
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
    ],
    ...((data ?? []) as ExportEntry[]).map((entry) => {
      const breaks = (entry.admin_time_breaks ?? []).filter((entryBreak) => entryBreak.status !== 'void');
      const lunchMinutes = completedBreakMinutes(breaks);
      const entryPaidMinutes = paidMinutes(entry, breaks);
      const rateCents = Number(entry.hourly_rate_cents_snapshot ?? 0);
      return [
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
      ];
    }),
  ];

  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  return new Response(csv, {
    headers: {
      'content-disposition': `attachment; filename="time-entries-${fromInput}-to-${toInput}.csv"`,
      'content-type': 'text/csv',
    },
  });
}
