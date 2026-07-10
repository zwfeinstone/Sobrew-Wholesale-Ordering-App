export const ADMIN_QUERY_ROW_LIMIT = 1000;
export const REPORT_DETAIL_ROW_LIMIT = 100;

export function limitReportDetailRows<T>(rows: readonly T[]) {
  return rows.slice(0, REPORT_DETAIL_ROW_LIMIT);
}

export function queryReachedAdminRowLimit(rows: readonly unknown[] | null | undefined) {
  return (rows?.length ?? 0) >= ADMIN_QUERY_ROW_LIMIT;
}
