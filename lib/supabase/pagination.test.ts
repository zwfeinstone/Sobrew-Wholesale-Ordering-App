import { describe, expect, it, vi } from 'vitest';
import { fetchAllByIds, fetchAllPages } from './pagination';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

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

  it('fully reads every ID batch when related rows exceed the server page cap', async () => {
    const ids = Array.from({ length: 405 }, (_, id) => String(id));
    const relatedRows = (batch: string[]) => batch.flatMap((id) => [`${id}:a`, `${id}:b`]);
    const fetchPage = vi.fn((batch: string[], from: number, to: number) => Promise.resolve({
      data: relatedRows(batch).slice(from, Math.min(from + 73, to + 1)), error: null,
    }));

    expect(await fetchAllByIds(ids, fetchPage)).toEqual({ data: relatedRows(ids), error: null });
    for (const firstId of ['0', '200']) {
      expect(fetchPage.mock.calls.filter(([batch]) => batch[0] === firstId).map(([, from]) => from))
        .toEqual([0, 73, 146, 219, 292, 365, 400]);
    }
    expect(fetchPage.mock.calls.filter(([batch]) => batch[0] === '400').map(([, from]) => from))
      .toEqual([0, 10]);
  });

  it('overlaps at most three batches and preserves row order when batches finish out of order', async () => {
    const ids = Array.from({ length: 801 }, (_, id) => String(id));
    const gates = Array.from({ length: 5 }, deferred);
    let active = 0;
    let maximumActive = 0;
    const fetchPage = vi.fn(async (batch: string[], from: number) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      try {
        if (from) return { data: [], error: null };
        await gates[Number(batch[0]) / 200].promise;
        return { data: batch, error: null };
      } finally {
        active--;
      }
    });
    const result = fetchAllByIds(ids, fetchPage);
    const startedBatches = () => fetchPage.mock.calls.filter(([, from]) => from === 0).map(([batch]) => batch[0]);
    expect(startedBatches()).toEqual(['0', '200', '400']);

    gates[2].resolve();
    await vi.waitFor(() => expect(startedBatches()).toEqual(['0', '200', '400', '600']));
    gates[3].resolve();
    await vi.waitFor(() => expect(startedBatches()).toEqual(['0', '200', '400', '600', '800']));
    gates[4].resolve();
    gates[1].resolve();
    gates[0].resolve();

    expect(await result).toEqual({ data: ids, error: null });
    expect(maximumActive).toBe(3);
  });

  it('stops starting batches after failure and returns the first error in ID-batch order', async () => {
    const ids = Array.from({ length: 801 }, (_, id) => String(id));
    const gates = Array.from({ length: 3 }, deferred);
    const firstError = { message: 'Earlier batch failed', code: 'EARLIER' };
    const fetchPage = vi.fn(async (batch: string[], from: number) => {
      if (from) return { data: [], error: null };
      const batchIndex = Number(batch[0]) / 200;
      await gates[batchIndex].promise;
      if (batchIndex === 1) return { data: null, error: firstError };
      if (batchIndex === 2) throw new Error('Later batch failed first');
      return { data: batch, error: null };
    });
    const result = fetchAllByIds(ids, fetchPage);
    gates[2].resolve();
    // Let the rejection reach the worker before another batch finishes.
    await vi.waitFor(() => expect(fetchPage.mock.settledResults[2]?.type).toBe('rejected'));
    gates[0].resolve();
    gates[1].resolve();

    expect(await result).toEqual({ data: [], error: firstError });
    expect(fetchPage.mock.calls.filter(([, from]) => from === 0).map(([batch]) => batch[0]))
      .toEqual(['0', '200', '400']);
  });

  it('supports serial batches when requested and makes no requests for empty IDs', async () => {
    const ids = Array.from({ length: 201 }, (_, id) => String(id));
    const fetchPage = vi.fn(async (batch: string[], from: number) => ({ data: from ? [] : batch, error: null }));
    expect(await fetchAllByIds([], fetchPage)).toEqual({ data: [], error: null });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(await fetchAllByIds(ids, fetchPage, { concurrency: 1 })).toEqual({ data: ids, error: null });
    expect(fetchPage.mock.calls.map(([batch, from]) => [batch[0], from]))
      .toEqual([['0', 0], ['0', 200], ['200', 0], ['200', 1]]);
  });

  it.each([0, 1.5, 5, NaN, Infinity])('rejects unsafe ID batch concurrency %s', async (concurrency) => {
    const fetchPage = vi.fn();
    await expect(fetchAllByIds(['id'], fetchPage, { concurrency })).rejects.toThrow(RangeError);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
