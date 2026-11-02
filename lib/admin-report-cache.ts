import 'server-only';

import { unstable_cache } from 'next/cache';
import type { CurrentAdminAccess } from '@/lib/admin-permissions';
import { env } from '@/lib/env';
import { getReportCacheGeneration, REPORT_DATA_CACHE_TAG } from '@/lib/report-cache-invalidation';

export const REPORT_DATA_CACHE_WINDOW_MS = 30_000;

/** Preserve types and sort object keys without conflating null, missing, or empty filters. */
function canonicalKey(value: unknown): unknown {
  if (value === null) return ['null'];
  if (value === undefined) return ['undefined'];
  if (value instanceof Date) return ['date', value.toISOString()];
  if (Array.isArray(value)) return ['array', value.map(canonicalKey)];
  if (typeof value === 'object') {
    return ['object', Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalKey(item)])];
  }
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
  if (typeof value === 'number' && Number.isFinite(value)) return ['number', value];
  throw new TypeError('Report cache keys must contain only finite JSON values or dates.');
}

/** Query envelopes may be nested (commerce has orders and orderItems). Rows are not envelopes. */
function containsQueryError(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.error !== undefined && record.error !== null) return true;
  return Object.entries(record).some(([key, item]) => key !== 'data' && containsQueryError(item));
}

class UncacheableReportResult extends Error {
  // Next logs errors from background revalidation. Keep financial rows out of
  // the error's enumerable properties while preserving the caller's result.
  #result: unknown;

  constructor(result: unknown) {
    super('Report query returned an error; its result was not cached.');
    this.#result = result;
  }

  get result() { return this.#result; }
}

type CachedReportResult<T> = { readStartedAt: number; data: T };

/**
 * Cache only data after the caller has freshly authenticated and authorized the
 * requested report and resolved its center scope. Never cache those checks.
 * Query IDs describe shared underlying reads, not the tab displaying them.
 */
export function createReportDataCache(access: CurrentAdminAccess, scopedCenterIds: string[] | null) {
  const identity = JSON.stringify(canonicalKey({
    source: env.supabaseUrl,
    actor: access.profile.id,
    user: access.user?.id ?? access.profile.id,
    access: access.access,
    owner: Boolean(access.isOwner),
    superadmin: Boolean(access.isSuperadmin),
    profile: {
      is_admin: access.profile.is_admin,
      is_superadmin: access.profile.is_superadmin,
      is_active: access.profile.is_active,
      center_id: access.profile.center_id,
    },
    centerScope: scopedCenterIds === null ? null : [...new Set(scopedCenterIds)].sort(),
  }));
  const stats = { hits: 0, misses: 0 };

  return {
    stats,
    async read<T>(query: string, filters: unknown, loader: () => Promise<T>): Promise<T> {
      let loaded = false;
      let loadPromise: Promise<CachedReportResult<T>> | undefined;
      const load = () => {
        // Next may start this callback in the background before returning an
        // expired entry. Foreground verification awaits this same work, rather
        // than issuing a duplicate read or accepting Next's stale-on-error value.
        loadPromise ??= (async () => {
          loaded = true;
          stats.misses += 1;
          const readStartedAt = Date.now();
          const result = await loader();
          if (containsQueryError(result)) throw new UncacheableReportResult(result);
          return { readStartedAt, data: result };
        })();
        return loadPromise;
      };
      const cached = unstable_cache(load, [
        // Envelope version changes prevent reuse of earlier unwrapped results.
        'admin-report-data-v2',
        identity,
        query,
        JSON.stringify(canonicalKey(filters)),
        String(getReportCacheGeneration()),
      ], { tags: [REPORT_DATA_CACHE_TAG], revalidate: REPORT_DATA_CACHE_WINDOW_MS / 1000 });

      try {
        let result = await cached();
        // A stable key avoids accumulating a new persistent entry every 30s.
        // The envelope independently enforces freshness because Next's TTL
        // normally serves stale data while revalidating. Starting the clock
        // before the query also accounts for a slow database response.
        if (loaded || Date.now() - result.readStartedAt >= REPORT_DATA_CACHE_WINDOW_MS) {
          result = await load();
        } else {
          stats.hits += 1;
        }
        return result.data;
      } catch (error) {
        // Preserve existing error handling while keeping error-shaped results
        // out of Next's persistent cache. Genuine thrown failures still reject.
        if (error instanceof UncacheableReportResult) return error.result as T;
        throw error;
      }
    },
  };
}
