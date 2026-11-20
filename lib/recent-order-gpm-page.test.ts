import { describe, expect, it } from 'vitest';
import { compareRecentReportOrders, recentOrderGpmPageOptions, recentOrderMergeOffset } from './recent-order-gpm-page';

describe('shipped order report dates', () => {
  it('includes the full Central calendar day at both DST transitions', () => {
    expect(recentOrderGpmPageOptions('2026-11-01', '2026-11-01', '2')).toMatchObject({
      options: { start: '2026-11-01T05:00:00.000Z', endExclusive: '2026-11-02T06:00:00.000Z', page: 2, limit: 25 },
    });
    expect(recentOrderGpmPageOptions('2026-03-08', '2026-03-08', undefined)).toMatchObject({
      options: { start: '2026-03-08T06:00:00.000Z', endExclusive: '2026-03-09T05:00:00.000Z', page: 1 },
    });
  });
  it('takes blank dates as unbounded, rejects invalid/reversed dates and sanitizes malformed pages', () => {
    expect(recentOrderGpmPageOptions('', '', '4.2').options).toEqual({ start: undefined, endExclusive: undefined, page: 1, limit: 25 });
    expect(recentOrderGpmPageOptions('2026-11-04', '', '2').options).toMatchObject({ start: '2026-11-04T06:00:00.000Z', endExclusive: undefined, page: 2 });
    expect(recentOrderGpmPageOptions('2026-02-30', '', '-2').error).toBe('Enter valid shipment dates.');
    expect(recentOrderGpmPageOptions('2026-11-04', '2026-11-01', undefined).error).toContain('on or after');
  });
  it('uses precision finer than milliseconds and then stable descending IDs', () => {
    const a = { id: 'a', shipped_at: '2026-11-01T01:00:00.100002Z', created_at: null };
    const z = { id: 'z', shipped_at: null, created_at: '2026-11-01T01:00:00.100001+00:00' };
    expect(compareRecentReportOrders(a, z)).toBeLessThan(0);
    expect(compareRecentReportOrders(a, { ...a, id: 'z' })).toBeGreaterThan(0);
  });
  it('partitions every prefix of skewed, balanced and empty streams without scanning them', async () => {
    for (const [left, right] of [
      [[9, 7, 2], [8, 6, 5, 4, 3, 1, 0]], [[9, 8, 7], [1]], [[1], [9, 8, 7]], [[3, 2, 1], []], [[], [3, 2, 1]],
    ]) {
      const combined = [...left, ...right].sort((a, b) => b - a);
      for (let offset = 0; offset <= combined.length; offset++) {
        const actual = await recentOrderMergeOffset(offset, left.length, right.length, async (i) => left[i]!, async (i) => right[i]!, (a, b) => b - a);
        expect(actual).toBe(combined.slice(0, offset).filter((item) => left.includes(item)).length);
      }
    }
  });
});
