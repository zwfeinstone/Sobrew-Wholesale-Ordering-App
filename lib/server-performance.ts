export function elapsedMilliseconds(startedAt: number) {
  return Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10);
}

export function serverTimingHeader(metrics: Array<{ durationMs: number; name: string }>) {
  return metrics
    .map(({ durationMs, name }) => `${name.replace(/[^a-z0-9_-]/gi, '_')};dur=${Math.max(0, durationMs).toFixed(1)}`)
    .join(', ');
}

export function logServerTiming(
  operation: string,
  startedAt: number,
  dimensions: Record<string, boolean | number | string> = {}
) {
  console.info('[server-performance]', {
    operation,
    duration_ms: elapsedMilliseconds(startedAt),
    ...dimensions,
  });
}
