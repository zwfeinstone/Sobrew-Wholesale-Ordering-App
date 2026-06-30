import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { adminCanEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { getCurrentPayrollWeekWindow } from '@/lib/payroll-status';
import { createClient } from '@/lib/supabase/server';

type MarketingRecap = {
  created_at: string;
  id: string;
  next_week_notes: string | null;
  profile_id: string;
  results_notes: string | null;
  updated_at: string;
  week_end_date: string;
  week_start_date: string;
  work_notes: string;
};

type ProfileSummary = {
  email: string | null;
  full_name: string | null;
  id: string;
};

function marketingHref(toast?: string) {
  if (!toast) return '/admin/marketing';
  return `/admin/marketing?${new URLSearchParams({ toast }).toString()}`;
}

function cleanText(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function optionalText(formData: FormData, key: string) {
  return cleanText(formData, key) || null;
}

function validDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function profileName(profile: ProfileSummary | undefined) {
  return profile?.full_name?.trim() || profile?.email?.trim() || 'Unknown admin';
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatWeekLabel(recap: Pick<MarketingRecap, 'week_end_date' | 'week_start_date'>) {
  return `${formatDateLabel(recap.week_start_date)} to ${formatDateLabel(recap.week_end_date)}`;
}

function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: 'America/Chicago',
    year: 'numeric',
  });
}

function FormToast({ toast }: { toast: string }) {
  const messages: Record<string, { message: string; tone: 'error' | 'success' }> = {
    admin_write_denied: { message: 'You do not have permission to edit Marketing.', tone: 'error' },
    delete_error: { message: 'Unable to delete that marketing recap.', tone: 'error' },
    deleted: { message: 'Marketing recap deleted.', tone: 'success' },
    invalid_date: { message: 'Choose a valid marketing week.', tone: 'error' },
    missing_notes: { message: 'Add what was done this week before saving.', tone: 'error' },
    missing_recap: { message: 'Choose a valid recap.', tone: 'error' },
    save_error: { message: 'Unable to save the marketing recap. Make sure the marketing migration has been run.', tone: 'error' },
    saved: { message: 'Marketing recap saved.', tone: 'success' },
    update_error: { message: 'Unable to update that marketing recap.', tone: 'error' },
    updated: { message: 'Marketing recap updated.', tone: 'success' },
  };
  const selected = messages[toast];
  return selected ? <StatusToast message={selected.message} tone={selected.tone} /> : null;
}

async function saveWeeklyRecap(formData: FormData) {
  'use server';

  const current = await requireAdminWriteAccess(marketingHref('admin_write_denied'), 'marketing');
  const weekStartDate = cleanText(formData, 'week_start_date');
  const weekEndDate = cleanText(formData, 'week_end_date');
  const workNotes = cleanText(formData, 'work_notes');

  if (!validDateInput(weekStartDate) || !validDateInput(weekEndDate)) {
    redirect(marketingHref('invalid_date'));
  }
  if (!workNotes) {
    redirect(marketingHref('missing_notes'));
  }

  const supabase = await createClient();
  const { error } = await supabase.from('marketing_weekly_recaps').upsert(
    {
      created_by: current.profile.id,
      next_week_notes: optionalText(formData, 'next_week_notes'),
      profile_id: current.profile.id,
      results_notes: optionalText(formData, 'results_notes'),
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
      week_end_date: weekEndDate,
      week_start_date: weekStartDate,
      work_notes: workNotes,
    },
    { onConflict: 'profile_id,week_start_date' }
  );

  if (error) {
    console.error('[admin-marketing] save failed', { error, profileId: current.profile.id, weekStartDate });
  }
  redirect(marketingHref(error ? 'save_error' : 'saved'));
}

async function updateWeeklyRecap(formData: FormData) {
  'use server';

  const current = await requireAdminWriteAccess(marketingHref('admin_write_denied'), 'marketing');
  const recapId = cleanText(formData, 'recap_id');
  const weekStartDate = cleanText(formData, 'week_start_date');
  const weekEndDate = cleanText(formData, 'week_end_date');
  const workNotes = cleanText(formData, 'work_notes');

  if (!recapId) {
    redirect(marketingHref('missing_recap'));
  }
  if (!validDateInput(weekStartDate) || !validDateInput(weekEndDate)) {
    redirect(marketingHref('invalid_date'));
  }
  if (!workNotes) {
    redirect(marketingHref('missing_notes'));
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('marketing_weekly_recaps')
    .update({
      next_week_notes: optionalText(formData, 'next_week_notes'),
      results_notes: optionalText(formData, 'results_notes'),
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
      week_end_date: weekEndDate,
      week_start_date: weekStartDate,
      work_notes: workNotes,
    })
    .eq('id', recapId);

  if (error) {
    console.error('[admin-marketing] update failed', { error, recapId, weekStartDate });
  }
  redirect(marketingHref(error ? 'update_error' : 'updated'));
}

async function deleteWeeklyRecap(formData: FormData) {
  'use server';

  await requireAdminWriteAccess(marketingHref('admin_write_denied'), 'marketing');
  const recapId = cleanText(formData, 'recap_id');

  if (!recapId) {
    redirect(marketingHref('missing_recap'));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from('marketing_weekly_recaps').delete().eq('id', recapId).select('id');

  if (error) {
    console.error('[admin-marketing] delete failed', { error, recapId });
  }
  redirect(marketingHref(error || !data?.length ? 'delete_error' : 'deleted'));
}

function RecapNotes({ recap }: { recap: MarketingRecap }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="rounded-xl bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Done</p>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{recap.work_notes}</p>
      </div>
      <div className="rounded-xl bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Results</p>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{recap.results_notes || 'No results added.'}</p>
      </div>
      <div className="rounded-xl bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Next</p>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{recap.next_week_notes || 'No next steps added.'}</p>
      </div>
    </div>
  );
}

function RecapFields({ recap }: { recap?: MarketingRecap | null }) {
  return (
    <>
      <label className="space-y-2 text-sm font-medium text-slate-700">
        What was done this week?
        <textarea className="input min-h-36" name="work_notes" defaultValue={recap?.work_notes ?? ''} required />
      </label>
      <label className="space-y-2 text-sm font-medium text-slate-700">
        Results or wins
        <textarea className="input min-h-24" name="results_notes" defaultValue={recap?.results_notes ?? ''} />
      </label>
      <label className="space-y-2 text-sm font-medium text-slate-700">
        Next steps
        <textarea className="input min-h-24" name="next_week_notes" defaultValue={recap?.next_week_notes ?? ''} />
      </label>
    </>
  );
}

export default async function MarketingPage({
  searchParams,
}: {
  searchParams?: { toast?: string };
}) {
  const current = await requireAdminSectionView('marketing');
  const canEdit = adminCanEdit(current.access, 'marketing');
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const week = getCurrentPayrollWeekWindow(new Date());
  const supabase = await createClient();

  const { data: recapData, error: recapsError } = await supabase
    .from('marketing_weekly_recaps')
    .select('id,profile_id,week_start_date,week_end_date,work_notes,results_notes,next_week_notes,created_at,updated_at')
    .order('week_start_date', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(100);

  if (recapsError) {
    console.error('[admin-marketing] page load failed', { error: recapsError });
  }

  const recaps = ((recapData ?? []) as MarketingRecap[]).filter((recap) => recap.work_notes?.trim());
  const profileIds = Array.from(new Set(recaps.map((recap) => recap.profile_id).filter(Boolean)));
  const { data: profileData } = profileIds.length
    ? await supabase.from('profiles').select('id,email,full_name').in('id', profileIds)
    : { data: [] };
  const profilesById = new Map(((profileData ?? []) as ProfileSummary[]).map((profile) => [profile.id, profile]));
  const currentRecap = recaps.find((recap) => recap.profile_id === current.profile.id && recap.week_start_date === week.weekStartInput) ?? null;
  const currentWeekRecaps = recaps.filter((recap) => recap.week_start_date === week.weekStartInput);
  const lastUpdated = recaps[0]?.updated_at ? formatUpdatedAt(recaps[0].updated_at) : 'No recaps yet';

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Marketing</span>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="page-title">Weekly marketing recaps</h1>
            <p className="page-subtitle mt-3">
              {formatDateLabel(week.weekStartInput)} to {formatDateLabel(week.weekEndInput)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-600">
            <span className="font-semibold text-slate-950">{currentWeekRecaps.length}</span> current week
          </div>
        </div>
      </section>

      <FormToast toast={toast} />

      {recapsError ? (
        <section className="card text-sm text-red-700">Marketing data could not be loaded. Make sure the marketing migration has been run.</section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">This Week</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{currentWeekRecaps.length}</p>
          <p className="mt-2 text-sm text-slate-500">Submitted recaps</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Total</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{recaps.length}</p>
          <p className="mt-2 text-sm text-slate-500">Saved recaps</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Last Update</p>
          <p className="mt-3 text-lg font-semibold tracking-tight text-slate-950">{lastUpdated}</p>
          <p className="mt-2 text-sm text-slate-500">Most recent save</p>
        </div>
      </section>

      {canEdit ? (
        <form action={saveWeeklyRecap} className="card space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Your Week</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Record this week</h2>
          </div>
          <input name="week_start_date" type="hidden" value={week.weekStartInput} />
          <input name="week_end_date" type="hidden" value={week.weekEndInput} />
          <RecapFields recap={currentRecap} />
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" data-press-lock-key="marketing-save-recap" label={currentRecap ? 'Update recap' : 'Save recap'} pendingLabel="Saving..." />
        </form>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-600">You have view-only Marketing access.</section>
      )}

      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Recent recaps</h2>
          <p className="mt-1 text-sm text-slate-500">Current week appears first.</p>
        </div>

        {!recaps.length ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white/50 px-4 py-8 text-center">
            <p className="font-semibold text-slate-950">No marketing recaps yet.</p>
            <p className="mt-2 text-sm text-slate-500">Saved weekly recaps will show here.</p>
          </div>
        ) : null}

        <div className="space-y-3">
          {recaps.map((recap) => (
            <article key={recap.id} className="rounded-xl border border-slate-200 bg-white/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">{profileName(profilesById.get(recap.profile_id))}</h3>
                  <p className="mt-1 text-sm text-slate-500">{formatWeekLabel(recap)}</p>
                </div>
                <p className="text-sm text-slate-500">Updated {formatUpdatedAt(recap.updated_at)}</p>
              </div>

              <div className="mt-4">
                <RecapNotes recap={recap} />
              </div>

              {canEdit ? (
                <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-700">Edit recap</summary>
                  <form action={updateWeeklyRecap} className="mt-4 space-y-4">
                    <input name="recap_id" type="hidden" value={recap.id} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="space-y-2 text-sm font-medium text-slate-700">
                        Week start
                        <input className="input" name="week_start_date" type="date" defaultValue={recap.week_start_date} required />
                      </label>
                      <label className="space-y-2 text-sm font-medium text-slate-700">
                        Week end
                        <input className="input" name="week_end_date" type="date" defaultValue={recap.week_end_date} required />
                      </label>
                    </div>
                    <RecapFields recap={recap} />
                    <PendingSubmitButton className="btn-primary w-full sm:w-auto" data-press-lock-key={`marketing-update-${recap.id}`} label="Update recap" pendingLabel="Updating..." />
                  </form>
                  <form action={deleteWeeklyRecap} className="mt-4">
                    <input name="recap_id" type="hidden" value={recap.id} />
                    <PendingSubmitButton
                      className="rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50"
                      data-press-lock-key={`marketing-delete-${recap.id}`}
                      label="Delete recap"
                      pendingLabel="Deleting..."
                    />
                  </form>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
