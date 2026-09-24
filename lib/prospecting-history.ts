const POSITION_KEY = '__sobrewProspectingHistoryV2';

export function prospectingHistoryPosition(state: unknown): number | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[POSITION_KEY];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

export function withProspectingHistoryPosition(state: unknown, position: number) {
  return { ...(state && typeof state === 'object' ? state : {}), [POSITION_KEY]: position };
}

type HistoryWindow = Pick<Window, 'history' | 'location' | 'addEventListener' | 'removeEventListener'>;

/**
 * History API fallback for browsers without the Navigation API. Next's private
 * routing state is copied intact. Indexed traversals restore their original
 * position. A pre-existing unindexed entry has no discoverable direction: that
 * narrow case restores the current entry with pushState, which can truncate its
 * unknown forward branch, then offers the destination through the normal guard.
 */
export function installProspectingHistoryGuard(
  browser: HistoryWindow,
  { shouldBlock, onBlocked }: { shouldBlock: () => boolean; onBlocked: (destination: string) => void },
) {
  const history = browser.history;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  let position = prospectingHistoryPosition(history.state) ?? 0;
  let currentState = withProspectingHistoryPosition(history.state, position);
  let currentHref = browser.location.href;
  let restoring = false;
  originalReplace.call(history, currentState, '', currentHref);

  function remember() {
    currentState = withProspectingHistoryPosition(history.state, position);
    currentHref = browser.location.href;
  }

  const push: History['pushState'] = function (state, unused, url) {
    position += 1;
    originalPush.call(history, withProspectingHistoryPosition(state, position), unused, url);
    remember();
  };
  const replace: History['replaceState'] = function (state, unused, url) {
    originalReplace.call(history, withProspectingHistoryPosition(state, position), unused, url);
    remember();
  };
  history.pushState = push;
  history.replaceState = replace;

  function onPopState(raw: Event) {
    const event = raw as PopStateEvent;
    if (restoring) {
      event.stopImmediatePropagation();
      restoring = false;
      return;
    }
    const destinationPosition = prospectingHistoryPosition(event.state);
    if (!shouldBlock()) {
      position = destinationPosition ?? position - 1;
      originalReplace.call(history, withProspectingHistoryPosition(event.state, position), '', browser.location.href);
      remember();
      return;
    }
    const destinationHref = browser.location.href;
    event.stopImmediatePropagation();
    if (destinationPosition !== null && destinationPosition !== position) {
      restoring = true;
      history.go(position - destinationPosition);
    } else {
      // Unlike popstate, pushState does not trigger Next's route restoration.
      originalPush.call(history, currentState, '', currentHref);
    }
    onBlocked(destinationHref);
  }
  browser.addEventListener('popstate', onPopState, true);

  return () => {
    browser.removeEventListener('popstate', onPopState, true);
    if (history.pushState === push) history.pushState = originalPush;
    if (history.replaceState === replace) history.replaceState = originalReplace;
  };
}
