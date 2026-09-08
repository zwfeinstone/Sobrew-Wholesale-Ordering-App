import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './async-work';

describe('mapWithConcurrency', () => {
  it('starts new work as slots free up without exceeding the limit or changing result order', async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const pending = mapWithConcurrency([0, 1, 2, 3], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => { releases[item] = resolve; });
      active -= 1;
      return item * 2;
    });
    expect(releases.filter(Boolean)).toHaveLength(2);
    releases[1]();
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(releases[2]).toBeTypeOf('function');
    releases[2]();
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    releases[3]();
    releases[0]();
    expect(await pending).toEqual([0, 2, 4, 6]);
    expect(peak).toBe(2);
  });

  it('handles empty work and rejects invalid concurrency', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    await expect(mapWithConcurrency([1], 0, async (item) => item)).rejects.toThrow('positive integer');
  });
});
