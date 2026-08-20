export const SAVE_SCROLL_STORAGE_KEY = 'sobrew:save-scroll-restoration:v1';
export const SAVE_SCROLL_MAX_AGE_MS = 30_000;

export type SaveScrollSnapshot = {
  pathname: string;
  x: number;
  y: number;
  createdAt: number;
};

export type RestoreDecision =
  | { type: 'none' }
  | { type: 'clear'; reason: 'expired' | 'path_mismatch' | 'invalid' }
  | { type: 'restore'; x: number; y: number };

type FormScrollIntent = {
  actionAttribute: string | null;
  currentHref: string;
  currentPathname: string;
  preserveScroll: string | null | undefined;
  target: string | null;
};

type ScrollBounds = {
  scrollHeight: number;
  scrollWidth: number;
  viewportHeight: number;
  viewportWidth: number;
};

export function createSaveScrollSnapshot(pathname: string, x: number, y: number, createdAt: number): SaveScrollSnapshot {
  return {
    pathname,
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    createdAt,
  };
}

export function isValidSaveScrollSnapshot(value: unknown): value is SaveScrollSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<SaveScrollSnapshot>;
  return (
    typeof snapshot.pathname === 'string'
    && snapshot.pathname.startsWith('/')
    && Number.isFinite(snapshot.x)
    && Number.isFinite(snapshot.y)
    && Number.isFinite(snapshot.createdAt)
  );
}

export function sameSaveScrollSnapshot(left: SaveScrollSnapshot | null, right: SaveScrollSnapshot) {
  return Boolean(
    left
    && left.pathname === right.pathname
    && left.x === right.x
    && left.y === right.y
    && left.createdAt === right.createdAt
  );
}

export function shouldClearPendingSaveScrollSnapshot({
  currentHref,
  latestSnapshot,
  now,
  submittedHref,
  submittedSnapshot,
  maxAgeMs = SAVE_SCROLL_MAX_AGE_MS,
}: {
  currentHref: string;
  latestSnapshot: SaveScrollSnapshot | null;
  now: number;
  submittedHref: string;
  submittedSnapshot: SaveScrollSnapshot;
  maxAgeMs?: number;
}) {
  return (
    sameSaveScrollSnapshot(latestSnapshot, submittedSnapshot)
    && currentHref === submittedHref
    && now - submittedSnapshot.createdAt >= maxAgeMs
  );
}

export function shouldStoreFormScroll({
  actionAttribute,
  currentHref,
  currentPathname,
  preserveScroll,
  target,
}: FormScrollIntent) {
  const mode = preserveScroll?.trim().toLowerCase();
  if (mode === 'off') return false;
  if (mode === 'on') return true;

  const normalizedTarget = target?.trim().toLowerCase();
  if (normalizedTarget && normalizedTarget !== '_self') return false;

  const actionPathname = sameOriginActionPathname(actionAttribute, currentHref);
  if (actionPathname && actionPathname !== currentPathname) return false;

  return true;
}

export function getScrollRestoreDecision(
  snapshot: SaveScrollSnapshot | null,
  currentPathname: string,
  now: number,
  maxAgeMs = SAVE_SCROLL_MAX_AGE_MS
): RestoreDecision {
  if (!snapshot) return { type: 'none' };
  if (!isValidSaveScrollSnapshot(snapshot)) return { type: 'clear', reason: 'invalid' };
  if (now - snapshot.createdAt > maxAgeMs) return { type: 'clear', reason: 'expired' };
  if (snapshot.pathname !== currentPathname) return { type: 'clear', reason: 'path_mismatch' };
  return { type: 'restore', x: snapshot.x, y: snapshot.y };
}

export function clampScrollPosition(x: number, y: number, bounds: ScrollBounds) {
  const maxX = Math.max(0, bounds.scrollWidth - bounds.viewportWidth);
  const maxY = Math.max(0, bounds.scrollHeight - bounds.viewportHeight);

  return {
    x: Math.min(Math.max(0, Math.round(x)), maxX),
    y: Math.min(Math.max(0, Math.round(y)), maxY),
  };
}

function sameOriginActionPathname(actionAttribute: string | null, currentHref: string) {
  const rawAction = actionAttribute?.trim();
  if (!rawAction) return null;

  try {
    const currentUrl = new URL(currentHref);
    const actionUrl = new URL(rawAction, currentUrl);
    if (actionUrl.protocol !== 'http:' && actionUrl.protocol !== 'https:') return null;
    if (actionUrl.origin !== currentUrl.origin) return '__external__';
    return actionUrl.pathname;
  } catch {
    return null;
  }
}
