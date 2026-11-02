import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ButtonPressLock } from '@/components/button-press-lock';

const effects = vi.hoisted(() => ({ cleanup: undefined as undefined | (() => void) }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (setup: () => (() => void) | undefined) => { effects.cleanup = setup(); },
}));

let sequence = 0;
class FixtureForm {
  id = `fixture-form-${++sequence}`;
  dataset: Record<string, string> = {};
  isConnected = true;
  constructor(readonly method: string, navigation = false) {
    if (navigation) this.dataset.navigationForm = 'true';
  }
  getAttribute() { return '/admin/reports'; }
  querySelectorAll() { return []; }
}

const listeners = new Map<string, (event: SubmitEvent) => void>();
function submit(form: FixtureForm) {
  const event = {
    target: form, submitter: null, defaultPrevented: false,
    preventDefault: vi.fn(function (this: { defaultPrevented: boolean }) { this.defaultPrevented = true; }),
    stopImmediatePropagation: vi.fn(),
  };
  listeners.get('submit')!(event as unknown as SubmitEvent);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('HTMLFormElement', FixtureForm);
  vi.stubGlobal('HTMLButtonElement', class {});
  vi.stubGlobal('window', { setTimeout, clearTimeout, location: { pathname: '/admin/reports' } });
  vi.stubGlobal('document', {
    addEventListener: (name: string, listener: (event: SubmitEvent) => void) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  ButtonPressLock();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  effects.cleanup?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('button press lock navigation exception', () => {
  it('accepts consecutive navigation GET submissions immediately', () => {
    const form = new FixtureForm('GET', true);
    const first = submit(form);
    const next = submit(form);
    expect(first.preventDefault).not.toHaveBeenCalled();
    expect(next.preventDefault).not.toHaveBeenCalled();
    expect(form.dataset.submitLocked).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['POST', true],
    ['POST', false],
    ['GET', false],
  ] as const)('retains duplicate-submit protection for %s with navigation marker %s', (method, navigation) => {
    const form = new FixtureForm(method, navigation);
    const first = submit(form);
    const duplicate = submit(form);
    expect(first.preventDefault).not.toHaveBeenCalled();
    expect(form.dataset.submitLocked).toBe('true');
    expect(duplicate.preventDefault).toHaveBeenCalledOnce();
    expect(duplicate.stopImmediatePropagation).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(8_000);
    expect(submit(form).preventDefault).not.toHaveBeenCalled();
  });
});
