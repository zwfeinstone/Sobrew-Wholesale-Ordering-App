import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { withRecoveryClient } from '@/lib/supabase/recovery-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/schema';

export const RECOVERY_COOKIE = 'sobrew-password-recovery';
export const RECOVERY_COOKIE_PATH = '/reset-password';
export const RECOVERY_SESSION_COOKIE = 'sobrew-password-recovery-session';
const RECOVERY_SESSION_SECONDS = 30 * 60;

type RecoveryUser = { id: string; email?: string };
type RecoveryMarker = { v: 1; userId: string; sessionId: string; flowId: string; expiresAt: number };
export type PendingRecovery =
  | { kind: 'token'; token: string; flowId: string }
  | { kind: 'pkce'; code: string; flowId: string };
export type RecoveryState =
  | { status: 'pending'; flowId: string }
  | { status: 'ready'; flowId: string; user: RecoveryUser }
  | { status: 'invalid' }
  | { status: 'unavailable' };

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production',
    path: RECOVERY_COOKIE_PATH, maxAge,
  };
}

function signRecoveryValue(purpose: string, value: string) {
  if (!env.serviceRole) throw new Error('Recovery signing configuration is unavailable.');
  return createHmac('sha256', env.serviceRole).update(`sobrew-password-recovery:v1:${purpose}\0${value}`).digest('hex');
}

export function matchesRecoveryFlow(expected: unknown, actual: string) {
  return typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected)
    && /^[a-f0-9]{64}$/.test(actual)
    && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

export function pendingRecoveryFlowId(token: string) {
  return signRecoveryValue('pending-flow', token);
}

export function pendingRecoveryCode(code: string): string | null {
  return /^[A-Za-z0-9._~-]{1,2048}$/.test(code) ? `code:${Buffer.from(code).toString('base64url')}` : null;
}

function sessionClaims(accessToken: string): { sub: string; session_id: string; exp: number; recovery: boolean } | null {
  try {
    const pieces = accessToken.split('.');
    if (pieces.length !== 3 || pieces[1].length > 24_000) return null;
    const value: unknown = JSON.parse(Buffer.from(pieces[1], 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object') return null;
    const claims = value as Record<string, unknown>;
    if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.session_id !== 'string' || !claims.session_id
      || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null;
    const recovery = Array.isArray(claims.amr) && claims.amr.some((entry: unknown) => Boolean(entry)
      && typeof entry === 'object' && (entry as { method?: unknown }).method === 'recovery');
    return { sub: claims.sub, session_id: claims.session_id, exp: claims.exp, recovery };
  } catch { return null; }
}

// Use only on the authoritative code-exchange response. Unlike POST token-hash
// verification, PKCE sessions record the server's recovery authentication method.
export function hasPkceRecoveryProof(session: { access_token: string } | null) {
  return Boolean(session && sessionClaims(session.access_token)?.recovery);
}

// Call only with the authoritative response from recovery verification/code exchange.
// POST recovery verification uses Supabase's "otp" AMR, so AMR alone is not proof.
export function recoverySessionCookie(
  session: { access_token: string }, user: RecoveryUser, flowId: string,
) {
  const claims = sessionClaims(session.access_token);
  const now = Math.floor(Date.now() / 1000);
  if (!claims || claims.sub !== user.id || claims.exp <= now + 120 || !/^[a-f0-9]{64}$/.test(flowId)) {
    throw new Error('Recovery verification returned an invalid session.');
  }
  // Expire before the SDK's early-refresh window: a Server Component cannot
  // persist a refreshed cookie. The usual one-hour JWT allows a 30-minute form.
  const expiresAt = Math.min(now + RECOVERY_SESSION_SECONDS, claims.exp - 120);
  const marker: RecoveryMarker = { v: 1, userId: user.id, sessionId: claims.session_id, flowId, expiresAt };
  const payload = Buffer.from(JSON.stringify(marker)).toString('base64url');
  return {
    name: RECOVERY_SESSION_COOKIE,
    value: `${payload}.${signRecoveryValue('verified-session', payload)}`,
    options: cookieOptions(expiresAt - now),
  };
}

function readRecoveryMarker(value: string | undefined): RecoveryMarker | null {
  if (!value || value.length > 2048) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || extra !== undefined || !matchesRecoveryFlow(signature, signRecoveryValue('verified-session', payload))) return null;
  try {
    const marker: RecoveryMarker = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    return marker.v === 1 && typeof marker.userId === 'string' && Boolean(marker.userId)
      && typeof marker.sessionId === 'string' && Boolean(marker.sessionId)
      && typeof marker.flowId === 'string' && /^[a-f0-9]{64}$/.test(marker.flowId)
      && Number.isInteger(marker.expiresAt) && marker.expiresAt > now
      && marker.expiresAt <= now + RECOVERY_SESSION_SECONDS ? marker : null;
  } catch { return null; }
}

export function isDefinitiveRecoveryError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const { code, name } = error as { code?: string; name?: string };
  return name === 'AuthSessionMissingError' || [
    'otp_expired', 'bad_code_verifier', 'flow_state_not_found', 'flow_state_expired',
    'pkce_code_verifier_not_found', 'session_not_found', 'session_expired',
    'refresh_token_not_found', 'refresh_token_already_used', 'user_not_found',
    'user_banned', 'invalid_jwt', 'bad_jwt', 'invalid_credentials',
  ].includes(code ?? '');
}

export function isRecoveryToken(value: unknown): value is string {
  return typeof value === 'string' && /^(?:pkce_)?[a-f0-9]{40,128}$/i.test(value);
}

export function recoveryRedirectUrl() {
  // Use configured application identity, never the request Host or a form URL.
  const site = new URL(env.siteUrl);
  const local = site.hostname === 'localhost' || site.hostname === '127.0.0.1';
  if (site.username || site.password || site.search || site.hash || site.pathname !== '/'
    || (site.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && local && site.protocol === 'http:'))
    || (process.env.NODE_ENV === 'production' && local)) {
    throw new Error('Password recovery requires a trusted application URL.');
  }
  return new URL('/auth/recovery', site.origin).toString();
}

export async function getPendingRecoveryToken(): Promise<string | null> {
  const value = (await cookies()).get(RECOVERY_COOKIE)?.value;
  return isRecoveryToken(value) ? value : null;
}

export async function getPendingRecovery(): Promise<PendingRecovery | null> {
  const value = (await cookies()).get(RECOVERY_COOKIE)?.value;
  if (value?.startsWith('code:') && value.length <= 2740) {
    const code = Buffer.from(value.slice(5), 'base64url').toString('utf8');
    if (pendingRecoveryCode(code) === value) return { kind: 'pkce', code, flowId: pendingRecoveryFlowId(value) };
  }
  if (isRecoveryToken(value)) return { kind: 'token', token: value, flowId: pendingRecoveryFlowId(value) };
  return null;
}

export async function clearPendingRecoveryToken() {
  (await cookies()).set(RECOVERY_COOKIE, '', cookieOptions(0));
}

export async function clearRecoverySession() {
  (await cookies()).set(RECOVERY_SESSION_COOKIE, '', cookieOptions(0));
}

export async function verifiedRecoveryState(supabase: SupabaseClient<Database>): Promise<RecoveryState> {
  const marker = readRecoveryMarker((await cookies()).get(RECOVERY_SESSION_COOKIE)?.value);
  if (!marker) return { status: 'invalid' };
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) return { status: isDefinitiveRecoveryError(sessionError) ? 'invalid' : 'unavailable' };
  if (!sessionData.session?.access_token) return { status: 'invalid' };
  const accessToken = sessionData.session.access_token;
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error) return { status: isDefinitiveRecoveryError(error) ? 'invalid' : 'unavailable' };
  if (!data.user) return { status: 'invalid' };
  // Cookie session data is untrusted until Auth validates this exact token.
  const claims = sessionClaims(accessToken);
  if (!claims || claims.exp <= Date.now() / 1000 || claims.sub !== data.user.id
    || marker.userId !== data.user.id || marker.sessionId !== claims.session_id) return { status: 'invalid' };
  return { status: 'ready', flowId: marker.flowId, user: { id: data.user.id, email: data.user.email } };
}

export async function getRecoveryState(): Promise<RecoveryState> {
  try {
    const pending = await getPendingRecovery();
    if (pending) return { status: 'pending', flowId: pending.flowId };
    return await withRecoveryClient(verifiedRecoveryState);
  } catch {
    return { status: 'unavailable' };
  }
}
