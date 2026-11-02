const PRELOAD_REPORTS = new Set(['overview', 'centers', 'recent_order_gpm']);
const PRELOAD_DATE_KEYS = ['month', 'rangeStart', 'rangeEnd'] as const;
const PRELOAD_EMPTY_FILTER_KEYS = new Set(['product', 'center', 'sales_rep']);

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Only warm the three measured, bounded report sources after explicit intent. */
export function getReportPreloadTarget(href: string): string | null {
  if (!href.startsWith('/') || href.startsWith('//')) return null;
  let url: URL;
  try {
    url = new URL(href, 'https://report-navigation.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://report-navigation.invalid' || url.pathname !== '/admin/reports') return null;
  const params = url.searchParams;
  for (const key of params.keys()) {
    if (params.getAll(key).length !== 1) return null;
    if (PRELOAD_EMPTY_FILTER_KEYS.has(key)) {
      if (params.get(key)) return null;
    } else if (key !== 'report' && !PRELOAD_DATE_KEYS.includes(key as typeof PRELOAD_DATE_KEYS[number])) {
      return null;
    }
  }
  const report = params.get('report') || 'overview';
  if (!PRELOAD_REPORTS.has(report)) return null;
  const normalized = new URLSearchParams({ report });
  for (const key of PRELOAD_DATE_KEYS) {
    const value = params.get(key);
    if (!value) continue;
    if (key === 'month' ? !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) : !validCalendarDate(value)) return null;
    normalized.set(key, value);
  }
  return `/admin/reports?${normalized.toString()}`;
}
