import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPagePerformance } from './page-performance';

afterEach(() => vi.restoreAllMocks());

describe('page performance diagnostics', () => {
  it('does not serialize or log when disabled', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const timing = createPagePerformance('test', false);
    const result = { data: [1], error: null };
    expect(await timing.measure('query', Promise.resolve(result))).toBe(result);
    timing.checkpoint('data');
    expect(timing.finish()).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it('keeps overlapping query spans separate from elapsed page phases', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const timing = createPagePerformance('test', true);
    let resolveA!: (value: number) => void;
    let resolveB!: (value: number) => void;
    const a = timing.measure('a', new Promise<number>((resolve) => { resolveA = resolve; }));
    const b = timing.measure('b', new Promise<number>((resolve) => { resolveB = resolve; }));
    now = 20; resolveA(1); await a;
    now = 30; resolveB(2); await b;
    timing.checkpoint('parallel_queries');
    const sample = timing.finish({ rows: 3 });
    expect(sample).toMatchObject({ total_ms: 30, phases_ms: { parallel_queries: 30 }, spans_ms: { a: 20, b: 30 }, counts: { rows: 3 } });
  });

  it('preserves rejected query errors', async () => {
    const error = new Error('database unavailable');
    const timing = createPagePerformance('test', true);
    await expect(timing.measure('query', Promise.reject(error))).rejects.toBe(error);
  });
});
