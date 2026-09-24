import { describe, expect, it } from 'vitest';
import { installProspectingHistoryGuard, prospectingHistoryPosition, withProspectingHistoryPosition } from '@/lib/prospecting-history';

type Entry = { state: unknown; href: string };
function fixture(entries: Entry[], initialIndex = entries.length - 1) {
  let index = initialIndex;
  let listener: ((event: Event) => void) | undefined;
  const stack = [...entries];
  const calls: number[] = [];
  const blocked: string[] = [];
  const delivered: boolean[] = [];
  const browser = {
    location: { get href() { return stack[index].href; } },
    history: {
      get state() { return stack[index].state; },
      pushState(state: unknown, _unused: string, url?: string | URL | null) { stack.splice(index + 1); stack.push({ state, href: String(url ?? stack[index].href) }); index += 1; },
      replaceState(state: unknown, _unused: string, url?: string | URL | null) { stack[index] = { state, href: String(url ?? stack[index].href) }; },
      go(delta: number) {
        calls.push(delta);
        const next = index + delta;
        if (next < 0 || next >= stack.length) return;
        index = next;
        let stopped = false;
        listener?.({ state: stack[index].state, stopImmediatePropagation: () => { stopped = true; } } as unknown as Event);
        delivered.push(!stopped);
      },
    },
    addEventListener(_name: string, callback: EventListenerOrEventListenerObject) { listener = callback as (event: Event) => void; },
    removeEventListener() { listener = undefined; },
  };
  let dirty = true;
  const cleanup = installProspectingHistoryGuard(browser as unknown as Parameters<typeof installProspectingHistoryGuard>[0], { shouldBlock: () => dirty, onBlocked: (href) => blocked.push(href) });
  return { browser, stack, calls, blocked, delivered, cleanup, setDirty: (value: boolean) => { dirty = value; } };
}
const nextState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['root', { children: ['prospecting', {}] }], other: 'retained' };
const entry = (name: string, position?: number): Entry => ({ href: `https://app.example/${name}`, state: position === undefined ? nextState : withProspectingHistoryPosition(nextState, position) });

describe('draft navigation History API fallback', () => {
  it('preserves Next routing metadata when tracking push and replace', () => {
    const { browser } = fixture([entry('record')]);
    browser.history.pushState(nextState, '', 'https://app.example/next');
    expect(browser.history.state).toMatchObject(nextState);
    expect(prospectingHistoryPosition(browser.history.state)).toBe(1);
    browser.history.replaceState({ ...nextState, other: 'updated' }, '', 'https://app.example/next?filter=1');
    expect(browser.history.state).toMatchObject({ ...nextState, other: 'updated' });
    expect(prospectingHistoryPosition(browser.history.state)).toBe(1);
  });

  it('restores an indexed Back before offering the destination without notifying Next', () => {
    const result = fixture([entry('queue', 0), entry('record', 1)]);
    result.browser.history.go(-1);
    expect(result.browser.location.href).toBe('https://app.example/record');
    expect(result.calls).toEqual([-1, 1]);
    expect(result.blocked).toEqual(['https://app.example/queue']);
    expect(result.delivered).toEqual([false, false]);
    expect(result.stack).toHaveLength(2);
  });

  it('restores indexed Forward in the opposite direction', () => {
    const result = fixture([entry('record', 0), entry('next', 1)], 0);
    result.browser.history.go(1);
    expect(result.browser.location.href).toBe('https://app.example/record');
    expect(result.calls).toEqual([1, -1]);
    expect(result.blocked).toEqual(['https://app.example/next']);
    expect(result.stack).toHaveLength(2);
  });

  it('protects a draft when a pre-existing entry has no index', () => {
    const result = fixture([entry('old-queue'), entry('record')]);
    result.browser.history.go(-1);
    expect(result.browser.location.href).toBe('https://app.example/record');
    expect(result.browser.history.state).toMatchObject(nextState);
    expect(result.blocked).toEqual(['https://app.example/old-queue']);
    expect(result.delivered).toEqual([false]);
  });

  it('lets clean navigation reach Next and removes its wrappers on cleanup', () => {
    const result = fixture([entry('queue', 0), entry('record', 1)]);
    result.setDirty(false);
    result.browser.history.go(-1);
    expect(result.browser.location.href).toBe('https://app.example/queue');
    expect(result.delivered).toEqual([true]);
    expect(result.blocked).toEqual([]);
    result.cleanup();
    result.browser.history.pushState(nextState, '', 'https://app.example/after');
    expect(prospectingHistoryPosition(result.browser.history.state)).toBeNull();
  });
});
