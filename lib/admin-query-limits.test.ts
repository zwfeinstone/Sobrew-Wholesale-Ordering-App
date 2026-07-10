import { describe, expect, it } from 'vitest';
import {
  ADMIN_QUERY_ROW_LIMIT,
  limitReportDetailRows,
  queryReachedAdminRowLimit,
  REPORT_DETAIL_ROW_LIMIT,
} from './admin-query-limits';

describe('admin query limits', () => {
  it('keeps ordinary source requests at no more than 1,000 rows', () => {
    expect(ADMIN_QUERY_ROW_LIMIT).toBe(1000);
  });

  it('caps report detail rows at 100 without mutating the source', () => {
    const rows = Array.from({ length: 125 }, (_, index) => index);

    expect(limitReportDetailRows(rows)).toHaveLength(REPORT_DETAIL_ROW_LIMIT);
    expect(rows).toHaveLength(125);
  });

  it('flags a source that may have been truncated by the request limit', () => {
    expect(queryReachedAdminRowLimit(Array.from({ length: 999 }))).toBe(false);
    expect(queryReachedAdminRowLimit(Array.from({ length: 1000 }))).toBe(true);
  });
});
