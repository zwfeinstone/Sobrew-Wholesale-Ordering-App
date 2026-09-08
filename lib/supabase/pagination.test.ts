import { describe, expect, it, vi } from 'vitest';
import { fetchAllByIds, fetchAllPages } from './pagination';

describe('complete query pagination', () => {
  it('keeps reading when the server caps pages below the requested size', async () => {
    const rows = Array.from({ length: 1205 }, (_, id) => ({ id }));
    const fetchPage = vi.fn((from: number, to: number) => Promise.resolve({
      data: rows.slice(from, Math.min(from + 400, to + 1)), error: null,
    }));
    expect(await fetchAllPages(fetchPage)).toEqual({ data: rows, error: null });
    expect(fetchPage.mock.calls.map(([from]) => from)).toEqual([0, 400, 800, 1200, 1205]);
  });

  it('discards already loaded rows when a later page fails', async () => {
    const error = { message: 'Connection lost' };
    expect(await fetchAllPages((from) => Promise.resolve(from === 0
      ? { data: [1], error: null }
      : { data: null, error }))).toEqual({ data: [], error });
  });

  it('handles rejected transport requests without returning partial data', async () => {
    const result = await fetchAllPages(() => Promise.reject(new Error('Timeout')));
    expect(result).toEqual({ data: [], error: { message: 'Timeout' } });
  });

  it('deduplicates and batches related IDs without losing records', async () => {
    const ids = Array.from({ length: 405 }, (_, id) => String(id));
    const fetchPage = vi.fn((batch: string[], from: number, to: number) => Promise.resolve({
      data: batch.slice(from, to + 1), error: null,
    }));
    expect(await fetchAllByIds([...ids, ids[0]], fetchPage)).toEqual({ data: ids, error: null });
    expect(Math.max(...fetchPage.mock.calls.map(([batch]) => batch.length))).toBe(200);
  });
});
