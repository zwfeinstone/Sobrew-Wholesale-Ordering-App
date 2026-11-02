import { revalidateTag } from 'next/cache';

export const REPORT_DATA_CACHE_TAG = 'admin-report-data-v1';

type ReportCacheState = { generation: number };
const reportCacheGlobal = globalThis as typeof globalThis & {
  __sobrewReportCacheState?: ReportCacheState;
};

// Preserve the generation across development module reloads. The numeric key
// also lets fresh production instances share entries via Next's Data Cache.
function reportCacheState() {
  return reportCacheGlobal.__sobrewReportCacheState ??= { generation: 0 };
}

export function getReportCacheGeneration(): number {
  return reportCacheState().generation;
}

/**
 * Successful application writes invalidate shared report data on every server
 * instance. The local generation also prevents reuse after repeated writes in
 * development, where Next's filesystem tag timestamps may not advance.
 *
 * Call from a Server Action or Route Handler. A committed write must never look
 * like a retryable database failure if cache invalidation fails: advance the
 * local generation, log a non-sensitive diagnostic, and leave other instances
 * bounded by the report cache's hard maximum age.
 */
export function invalidateReportData(): void {
  reportCacheState().generation += 1;
  try {
    revalidateTag(REPORT_DATA_CACHE_TAG);
  } catch {
    console.error('[report-cache] Shared invalidation failed; local entries were expired and other instances use the hard cache age limit.');
  }
}
