import Link from 'next/link';
import ProspectingQueuePanel from '@/components/prospecting-queue-panel';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { prospectingPath, prospectingQueueContextFromParams } from '@/lib/prospecting';
import { isProspectingWorkspaceEnabled } from '@/lib/prospecting-rollout';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { formatCentralDateInput, parseCentralDateInput } from '@/lib/time-clock';
import LegacyProspectingPage from './legacy-page';

type SearchParams = Record<string, string | string[] | undefined>;

function calendarDay(value: string, offset: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export default async function ProspectingPage(props: { searchParams?: Promise<SearchParams> }) {
  if (!await isProspectingWorkspaceEnabled()) return LegacyProspectingPage(props);
  const searchParams = await props.searchParams;
  const current = await requireAdminSectionView('prospecting');
  const context = { ...prospectingQueueContextFromParams(searchParams), repId: current.profile.id };
  const today = formatCentralDateInput(new Date());
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = calendarDay(today, -(weekday === 0 ? 6 : weekday - 1));
  const todayStart = parseCentralDateInput(today)!.toISOString();
  const tomorrowStart = parseCentralDateInput(calendarDay(today, 1))!.toISOString();
  const [daily, weekly] = await Promise.all([
    supabaseAdmin.from('prospecting_activities').select('id', { count: 'exact', head: true }).eq('created_by', current.profile.id).eq('activity_type', 'call').gte('created_at', todayStart).lt('created_at', tomorrowStart),
    supabaseAdmin.from('prospecting_activities').select('id', { count: 'exact', head: true }).eq('created_by', current.profile.id).eq('activity_type', 'call').gte('created_at', parseCentralDateInput(weekStart)!.toISOString()).lt('created_at', tomorrowStart),
  ]);
  const messages: Record<string, string> = {
    lead_recycled: 'Lead recycled to the unassigned pool.',
    lead_reviewed: 'Lead moved to superadmin review.',
    sample_order_created: 'Sample order created.',
    sample_requested: 'Sample request recorded for the team.',
    record_saved: 'Changes saved.',
  };
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';

  return <div className="space-y-5">
    {messages[toast] ? <StatusToast message={messages[toast]} tone="success" /> : null}
    {toast === 'missing_lead' ? <StatusToast message="That lead is no longer in your assigned queue." tone="error" /> : null}
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-teal-700">Prospecting</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Your next conversation</h1><p className="mt-1 text-sm text-slate-500">Follow up, work new leads, and keep every next step clear.</p></div>
      <div className="flex flex-wrap gap-2">
        <details className="relative"><summary className="btn-secondary cursor-pointer list-none">Samples</summary><div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"><Link className="block rounded-lg p-2 text-sm hover:bg-slate-50" href="/admin/sales/prospecting/sample-order">Order shipment</Link><Link className="block rounded-lg p-2 text-sm hover:bg-slate-50" href="/admin/sales/prospecting/sample-boxes">Sample cost &amp; history</Link></div></details>
        {current.isOwner ? <Link className="btn-secondary" href="/admin/sales/prospecting/admin">Manage</Link> : null}
      </div>
    </header>
    <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600" aria-label="My call activity">
      <p><span className="mr-1 font-semibold text-slate-950">{daily.error ? '—' : (daily.count ?? 0).toLocaleString()}</span> calls today</p>
      <p><span className="mr-1 font-semibold text-slate-950">{weekly.error ? '—' : (weekly.count ?? 0).toLocaleString()}</span> this week</p>
      <p className="text-xs sm:ml-auto sm:self-center">Calls logged by you · Central time</p>
    </div>
    {toast === 'queue_end' || toast === 'queue_complete' ? <section role="status" aria-labelledby="queue-end-title" className="rounded-xl border border-teal-200 bg-teal-50 p-4"><h2 id="queue-end-title" className="font-semibold text-teal-950">End of this queue</h2><p className="mt-1 text-sm leading-6 text-teal-900">You’ve worked through the available leads in this session. Choose another view, or start a new session below.</p>{context.state ? <Link className="btn-secondary mt-3 inline-flex" href={prospectingPath({ ...context, state: '', page: 1 }, { includePageSize: true })}>Continue across all states</Link> : null}</section> : null}
    <ProspectingQueuePanel context={context} profileId={current.profile.id} compact={false} />
  </div>;
}
