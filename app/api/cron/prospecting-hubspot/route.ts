import { env } from '@/lib/env';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isSampleHubSpotSyncTime, pushRequestedSamplesToHubSpot } from '@/lib/prospecting-hubspot-schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!env.cronSecret || request.headers.get('authorization') !== `Bearer ${env.cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const now = new Date();
  if (!isSampleHubSpotSyncTime(now)) return Response.json({ skipped: true, reason: 'Outside 5 p.m. Central.' });
  const supabase = getSupabaseAdmin();
  let status: 'success' | 'error' = 'success';
  let summary = { exported: 0, skipped: 0, attempted: 0, incomplete: false, errors: [] as Array<{ leadId: string; message: string }> };
  try {
    if (!env.hubspotAccessToken) throw new Error('HubSpot access token is missing.');
    summary = await pushRequestedSamplesToHubSpot(supabase);
    if (summary.errors.length || summary.incomplete) status = 'error';
  } catch (error) {
    status = 'error';
    summary.errors.push({ leadId: '', message: error instanceof Error ? error.message : 'Unable to run HubSpot export.' });
  }
  const { error: logError } = await supabase.from('cron_run_log').insert({
    job_name: 'prospecting_hubspot', invoked_at: now.toISOString(), completed_at: new Date().toISOString(),
    request_method: request.method, cron_schedule: request.headers.get('x-vercel-cron-schedule'),
    user_agent: request.headers.get('user-agent'), created_count: summary.exported,
    error_count: summary.errors.length + Number(summary.incomplete),
    errors: [...summary.errors, ...(summary.incomplete ? [{ leadId: '', message: 'Time budget reached; remaining leads will continue on the next scheduled run.' }] : [])],
    status,
  });
  if (logError) console.error('[prospecting-hubspot-cron] unable to record run', logError);
  return Response.json({ ...summary, status }, { status: status === 'error' ? 500 : 200 });
}
