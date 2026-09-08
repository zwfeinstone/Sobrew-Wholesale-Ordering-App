export const ADMIN_QUERY_ROW_LIMIT = 1000;
export const REPORT_DETAIL_ROW_LIMIT = 100;

export function reportDetailPage(total: number, requestedPage = 1) {
  const page = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1;
  return Math.max(1, Math.min(page, Math.max(1, Math.ceil(total / REPORT_DETAIL_ROW_LIMIT))));
}

export function limitReportDetailRows<T>(rows: readonly T[], requestedPage = 1) {
  const from = (reportDetailPage(rows.length, requestedPage) - 1) * REPORT_DETAIL_ROW_LIMIT;
  return rows.slice(from, from + REPORT_DETAIL_ROW_LIMIT);
}

export function queryReachedAdminRowLimit(rows: readonly unknown[] | null | undefined) {
  return (rows?.length ?? 0) >= ADMIN_QUERY_ROW_LIMIT;
}
