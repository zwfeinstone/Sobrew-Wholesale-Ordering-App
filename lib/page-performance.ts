import { elapsedMilliseconds } from '@/lib/server-performance';

export type PagePerformanceSample = {
  id: string;
  operation: string;
  environment: string;
  total_ms: number;
  phases_ms: Record<string, number>;
  spans_ms: Record<string, number>;
  counts: Record<string, number>;
};

export function pagePerformanceEnabled() {
  return process.env.NODE_ENV === 'development' || process.env.PORTAL_PERFORMANCE_TIMINGS === '1';
}

/** Checkpoints partition page work. Spans can overlap; never add them to checkpoints. */
export function createPagePerformance(operation: string, enabled = pagePerformanceEnabled()) {
  const startedAt = performance.now();
  let checkpointAt = startedAt;
  const phases: Record<string, number> = {};
  const spans: Record<string, number> = {};
  return {
    checkpoint(name: string) {
      if (!enabled) return;
      phases[name] = (phases[name] ?? 0) + elapsedMilliseconds(checkpointAt);
      checkpointAt = performance.now();
    },
    async measure<T>(name: string, work: T): Promise<Awaited<T>> {
      if (!enabled) return await work;
      const start = performance.now();
      try { return await work; }
      finally { spans[name] = (spans[name] ?? 0) + elapsedMilliseconds(start); }
    },
    finish(counts: Record<string, number> = {}): PagePerformanceSample | null {
      if (!enabled) return null;
      const sample: PagePerformanceSample = {
        id: crypto.randomUUID(), operation, environment: process.env.NODE_ENV ?? 'unknown',
        total_ms: elapsedMilliseconds(startedAt), phases_ms: { ...phases }, spans_ms: { ...spans }, counts,
      };
      // Only fixed operation names, durations and aggregate row counts; no filters or business records.
      console.info('[page-performance]', JSON.stringify(sample));
      return sample;
    },
  };
}
