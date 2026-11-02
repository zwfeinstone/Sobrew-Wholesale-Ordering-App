import { invalidateReportData } from '@/lib/report-cache-invalidation';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const REPORT_NEUTRAL_RPCS = new Set([
  'admin_prospecting_report_v1',
  'read_prospecting_receipt_v2',
  // Authentication schedules this activity-only write during page rendering.
  'touch_profile_last_seen',
]);

function reportDataWrite(input: RequestInfo | URL, init: RequestInit | undefined, supabaseUrl: string) {
  const request = input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  if (!WRITE_METHODS.has(method)) return false;

  try {
    const url = new URL(request ? request.url : String(input));
    if (url.origin !== new URL(supabaseUrl).origin || !url.pathname.startsWith('/rest/v1/')) return false;
    const resource = decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
    if (!resource) return false;
    return !resource.startsWith('rpc/') || !REPORT_NEUTRAL_RPCS.has(resource.slice('rpc/'.length));
  } catch {
    return false;
  }
}

/**
 * Conservatively invalidate reports for successful PostgREST mutations,
 * including RPCs that update several financial tables atomically. Forward the
 * original request and untouched response; never consume credentials or bodies.
 *
 * Direct database writes and standalone repair scripts do not use this hook;
 * the report cache's hard maximum age bounds their freshness on the next visit.
 */
export function createReportInvalidatingFetch(baseFetch: typeof fetch, supabaseUrl: string): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.ok && reportDataWrite(input, init, supabaseUrl)) invalidateReportData();
    return response;
  };
}
