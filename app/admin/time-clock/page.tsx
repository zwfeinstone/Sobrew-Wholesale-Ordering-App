import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  LABOR_WORK_TYPES,
  UNASSIGNED_WORK_TYPE,
  formatCentralDateTime,
  isLaborWorkType,
  normalizeMoneyCents,
  workTypeLabel,
  type LaborWorkType,
} from '@/lib/time-clock';

type TimeBreak = {
  break_end_at: string | null;
  break_start_at: string;
  id: string;
  notes: string | null;
  status: string | null;
};

type TimeEntry = {
  admin_time_breaks?: TimeBreak[];
  clock_in_at: string;
  clock_out_at: string | null;
  id: string;
  notes: string | null;
  profile_id: string;
  status: string | null;
  work_type: string | null;
};

function timeClockHref(params: Record<string, string | null | undefined> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return `/admin/time-clock${query ? `?${query}` : ''}`;
}

function appendNote(existing: string | null | undefined, label: string, note: string) {
  const trimmed = note.trim();
  if (!trimmed) return existing ?? null;
  return [existing, `${label}: ${trimmed}`].filter(Boolean).join('\n');
}

function timeClockErrorMessage(error: string) {
  if (error === 'missing_schema') return 'Time clock storage is not ready. Apply the latest migrations and refresh Supabase schema cache.';
  if (error === 'already_clocked_in') return 'You are already clocked in.';
  if (error === 'not_clocked_in') return 'You are not clocked in.';
  if (error === 'lunch_open') return 'End lunch before clocking out.';
  if (error === 'lunch_already_open') return 'Lunch is already running.';
  if (error === 'no_lunch_open') return 'No open lunch was found.';
  if (error === 'work_type_required') return 'Choose what you are doing before clocking in.';
  if (error === 'save_failed') return 'The time clock change could not be saved.';
  return `Could not complete that time clock action (${error}).`;
}

function successMessage(success: string) {
  if (success === 'clocked_in') return 'Clocked in.';
  if (success === 'lunch_started') return 'Lunch started.';
  if (success === 'lunch_ended') return 'Lunch ended.';
  if (success === 'clocked_out') return 'Clocked out.';
  return '';
}

async function getOpenEntry(profileId: string) {
  return supabaseAdmin
    .from('admin_time_entries')
    .select('id,profile_id,clock_in_at,clock_out_at,status,notes,work_type,admin_time_breaks(id,break_start_at,break_end_at,status,notes)')
    .eq('profile_id', profileId)
    .is('clock_out_at', null)
    .neq('status', 'void')
    .order('clock_in_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

async function getOpenBreak(entryId: string) {
  return supabaseAdmin
    .from('admin_time_breaks')
    .select('id,time_entry_id,break_start_at,break_end_at,status,notes')
    .eq('time_entry_id', entryId)
    .is('break_end_at', null)
    .neq('status', 'void')
    .order('break_start_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

async function hourlyRateForProfile(profileId: string) {
  const { data } = await supabaseAdmin
    .from('admin_time_settings')
    .select('hourly_rate_cents')
    .eq('profile_id', profileId)
    .maybeSingle();
  return normalizeMoneyCents(data?.hourly_rate_cents);
}

async function assignedWorkTypesForProfile(profileId: string) {
  const { data, error } = await supabaseAdmin
    .from('admin_labor_tag_assignments')
    .select('work_type')
    .eq('profile_id', profileId);

  if (error) return { error, workTypes: [] as LaborWorkType[] };

  const workTypes = (data ?? [])
    .map((row: { work_type: string | null }) => row.work_type)
    .filter(isLaborWorkType);
  return { error: null, workTypes };
}

function resolveClockInWorkType(formData: FormData, assignedWorkTypes: LaborWorkType[]) {
  if (!assignedWorkTypes.length) return UNASSIGNED_WORK_TYPE;
  if (assignedWorkTypes.length === 1) return assignedWorkTypes[0];
  const selected = String(formData.get('work_type') ?? '');
  return assignedWorkTypes.includes(selected as LaborWorkType) ? selected : null;
}

async function clockIn(formData: FormData) {
  'use server';
  const current = await requireAdminSectionView('time_clock');
  const openEntry = await getOpenEntry(current.profile.id);
  if (openEntry.error) redirect(timeClockHref({ error: 'missing_schema' }));
  if (openEntry.data) redirect(timeClockHref({ error: 'already_clocked_in' }));

  const assigned = await assignedWorkTypesForProfile(current.profile.id);
  if (assigned.error) redirect(timeClockHref({ error: 'missing_schema' }));
  const workType = resolveClockInWorkType(formData, assigned.workTypes);
  if (!workType) redirect(timeClockHref({ error: 'work_type_required' }));

  const hourlyRate = await hourlyRateForProfile(current.profile.id);
  const result = await supabaseAdmin.from('admin_time_entries').insert({
    clock_in_at: new Date().toISOString(),
    created_by: current.profile.id,
    hourly_rate_cents_snapshot: hourlyRate,
    notes: String(formData.get('note') ?? '').trim() || null,
    profile_id: current.profile.id,
    status: 'open',
    updated_by: current.profile.id,
    work_type: workType,
  });

  redirect(timeClockHref({ error: result.error ? 'save_failed' : null, success: result.error ? null : 'clocked_in' }));
}

async function startLunch(formData: FormData) {
  'use server';
  const current = await requireAdminSectionView('time_clock');
  const openEntry = await getOpenEntry(current.profile.id);
  if (openEntry.error) redirect(timeClockHref({ error: 'missing_schema' }));
  if (!openEntry.data) redirect(timeClockHref({ error: 'not_clocked_in' }));

  const openBreak = await getOpenBreak(openEntry.data.id);
  if (openBreak.data) redirect(timeClockHref({ error: 'lunch_already_open' }));

  const result = await supabaseAdmin.from('admin_time_breaks').insert({
    break_start_at: new Date().toISOString(),
    created_by: current.profile.id,
    notes: String(formData.get('note') ?? '').trim() || null,
    status: 'open',
    time_entry_id: openEntry.data.id,
    updated_by: current.profile.id,
  });

  redirect(timeClockHref({ error: result.error ? 'save_failed' : null, success: result.error ? null : 'lunch_started' }));
}

async function endLunch(formData: FormData) {
  'use server';
  const current = await requireAdminSectionView('time_clock');
  const openEntry = await getOpenEntry(current.profile.id);
  if (openEntry.error) redirect(timeClockHref({ error: 'missing_schema' }));
  if (!openEntry.data) redirect(timeClockHref({ error: 'not_clocked_in' }));

  const openBreak = await getOpenBreak(openEntry.data.id);
  if (!openBreak.data) redirect(timeClockHref({ error: 'no_lunch_open' }));

  const result = await supabaseAdmin
    .from('admin_time_breaks')
    .update({
      break_end_at: new Date().toISOString(),
      notes: appendNote(openBreak.data.notes, 'End lunch', String(formData.get('note') ?? '')),
      status: 'completed',
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
    })
    .eq('id', openBreak.data.id);

  redirect(timeClockHref({ error: result.error ? 'save_failed' : null, success: result.error ? null : 'lunch_ended' }));
}

async function clockOut(formData: FormData) {
  'use server';
  const current = await requireAdminSectionView('time_clock');
  const openEntry = await getOpenEntry(current.profile.id);
  if (openEntry.error) redirect(timeClockHref({ error: 'missing_schema' }));
  if (!openEntry.data) redirect(timeClockHref({ error: 'not_clocked_in' }));

  const openBreak = await getOpenBreak(openEntry.data.id);
  if (openBreak.data) redirect(timeClockHref({ error: 'lunch_open' }));

  const result = await supabaseAdmin
    .from('admin_time_entries')
    .update({
      clock_out_at: new Date().toISOString(),
      notes: appendNote(openEntry.data.notes, 'Clock out', String(formData.get('note') ?? '')),
      status: 'submitted',
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
    })
    .eq('id', openEntry.data.id);

  redirect(timeClockHref({ error: result.error ? 'save_failed' : null, success: result.error ? null : 'clocked_out' }));
}

function entryBreaks(entry: TimeEntry) {
  return (entry.admin_time_breaks ?? []) as TimeBreak[];
}

function SelfClockCard({
  assignedWorkTypes,
  currentBreak,
  currentEntry,
}: {
  assignedWorkTypes: LaborWorkType[];
  currentBreak: TimeBreak | null;
  currentEntry: TimeEntry | null;
}) {
  const singleWorkType = assignedWorkTypes.length === 1 ? assignedWorkTypes[0] : null;

  return (
    <section className="card space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-950">Current status</h2>
        <p className="mt-1 text-sm text-slate-500">
          {currentEntry
            ? `Clocked in since ${formatCentralDateTime(currentEntry.clock_in_at)} as ${workTypeLabel(currentEntry.work_type)}.`
            : 'You are currently clocked out.'}
        </p>
      </div>

      {!currentEntry ? (
        <form action={clockIn} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end" data-admin-self-service="true">
          {assignedWorkTypes.length > 1 ? (
            <label className="space-y-2 text-sm font-medium text-slate-700">
              What are you doing?
              <select className="input" name="work_type" required defaultValue="">
                <option value="" disabled>Select work type</option>
                {assignedWorkTypes.map((workType) => (
                  <option key={workType} value={workType}>{workTypeLabel(workType)}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm">
              <p className="font-semibold text-slate-950">Work type</p>
              <p className="mt-1 text-slate-500">{singleWorkType ? workTypeLabel(singleWorkType) : 'Unassigned'}</p>
            </div>
          )}
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Note
            <input className="input" name="note" placeholder="Optional" />
          </label>
          <PendingSubmitButton className="btn-primary w-full md:w-auto" label="Clock In" pendingLabel="Clocking in..." />
        </form>
      ) : null}

      {currentEntry && !currentBreak ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <form action={startLunch} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end" data-admin-self-service="true">
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Lunch note
              <input className="input" name="note" placeholder="Optional" />
            </label>
            <PendingSubmitButton className="btn-secondary w-full md:w-auto" label="Start Lunch" pendingLabel="Starting..." />
          </form>
          <form action={clockOut} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end" data-admin-self-service="true">
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Clock-out note
              <input className="input" name="note" placeholder="Optional" />
            </label>
            <PendingSubmitButton className="btn-primary w-full md:w-auto" label="Clock Out" pendingLabel="Clocking out..." />
          </form>
        </div>
      ) : null}

      {currentEntry && currentBreak ? (
        <form action={endLunch} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end" data-admin-self-service="true">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            End lunch note
            <input className="input" name="note" placeholder={`Lunch started ${formatCentralDateTime(currentBreak.break_start_at)}`} />
          </label>
          <PendingSubmitButton className="btn-primary w-full md:w-auto" label="End Lunch" pendingLabel="Ending..." />
        </form>
      ) : null}
    </section>
  );
}

export default async function TimeClockPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const current = await requireAdminSectionView('time_clock');
  const success = typeof searchParams?.success === 'string' ? searchParams.success : '';
  const error = typeof searchParams?.error === 'string' ? searchParams.error : '';

  const [openEntryResult, assignedResult] = await Promise.all([
    getOpenEntry(current.profile.id),
    assignedWorkTypesForProfile(current.profile.id),
  ]);

  if (openEntryResult.error || assignedResult.error) {
    console.error('[admin-time-clock] page load failed', {
      assignedError: assignedResult.error,
      openEntryError: openEntryResult.error,
    });
    return (
      <div className="space-y-6">
        <section className="panel">
          <span className="eyebrow">Time Clock</span>
          <h1 className="page-title mt-4">Time Clock</h1>
          <p className="page-subtitle mt-3">The time clock data could not be loaded.</p>
        </section>
        <section className="card text-sm text-red-700">Refresh the page after confirming the latest migrations and Supabase schema cache are current.</section>
      </div>
    );
  }

  const currentEntry = (openEntryResult.data as TimeEntry | null) ?? null;
  const currentBreak = currentEntry
    ? (entryBreaks(currentEntry).find((entryBreak) => !entryBreak.break_end_at && entryBreak.status !== 'void') ?? null)
    : null;

  return (
    <div className="space-y-6">
      {successMessage(success) ? <div className="card text-sm text-green-700">{successMessage(success)}</div> : null}
      {error ? <div className="card text-sm text-red-700">{timeClockErrorMessage(error)}</div> : null}

      <section className="panel">
        <span className="eyebrow">Time Clock</span>
        <h1 className="page-title mt-4">Clock in and out</h1>
        <p className="page-subtitle mt-3">Clock in, start or end lunch when needed, and clock out at the end of your shift.</p>
      </section>

      <SelfClockCard
        assignedWorkTypes={assignedResult.workTypes}
        currentBreak={currentBreak}
        currentEntry={currentEntry}
      />
    </div>
  );
}
