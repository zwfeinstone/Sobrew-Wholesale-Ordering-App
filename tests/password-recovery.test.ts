import { NextRequest } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { siteUrl: 'https://app.sobrew.com', serviceRole: 'test-recovery-signing-key', supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'test-public-key' },
  withRecoveryClient: vi.fn(),
  createClient: vi.fn(),
  createRouteClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  cookieGet: vi.fn(),
  cookieGetAll: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookieGet, getAll: mocks.cookieGetAll, set: mocks.cookieSet, delete: mocks.cookieDelete }),
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/route', () => ({ createRouteClient: mocks.createRouteClient }));
vi.mock('@/lib/supabase/recovery-client', () => ({ withRecoveryClient: mocks.withRecoveryClient }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/components/pending-submit-button', () => ({
  default: ({ label }: { label: string }) => createElement('button', { type: 'submit' }, label),
}));

import { GET as recoverFromEmail } from '@/app/auth/recovery/route';
import { requestPasswordReset } from '@/app/forgot-password/actions';
import { updateRecoveredPassword, verifyRecoveryLink } from '@/app/reset-password/actions';
import ResetPasswordPage from '@/app/reset-password/page';
import { getRecoveryState, RECOVERY_COOKIE, RECOVERY_SESSION_COOKIE } from '@/lib/password-recovery';

const recoveryUser = { id: 'verified-customer', email: 'buyer@example.com' };
const pendingToken = 'a'.repeat(64);
const sensitivePassword = '  Keep  My <&> Password!  ';
const cookieValues = new Map<string, string>();
let recoverySession: ReturnType<typeof session>;

function session(user = recoveryUser, sessionId = 'session-a', method = 'otp') {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const claims = Buffer.from(JSON.stringify({ sub: user.id, session_id: sessionId, exp: expires, amr: [{ method, timestamp: expires - 3600 }] })).toString('base64url');
  return { access_token: `header.${claims}.signature`, expires_at: expires, user };
}

function pendingCookie(token = pendingToken) {
  cookieValues.set(RECOVERY_COOKIE, token);
}

async function pendingForm(values: Record<string, string> = {}) {
  const state = await getRecoveryState();
  if (state.status !== 'pending') throw new Error('Expected a pending recovery flow');
  return form({ flow_id: state.flowId, ...values });
}

async function establishRecovery() {
  pendingCookie();
  const data = await pendingForm();
  const flowId = String(data.get('flow_id'));
  await expect(verifyRecoveryLink(data)).rejects.toThrow('REDIRECT:/reset-password');
  mocks.verifyOtp.mockClear();
  mocks.cookieSet.mockClear();
  return flowId;
}

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries(values).forEach(([name, value]) => data.set(name, value));
  return data;
}

function passwordForm(password = sensitivePassword, confirmation = password, flowId?: string) {
  return form({ password, confirm_password: confirmation, ...(flowId ? { flow_id: flowId } : {}) });
}

beforeEach(() => {
  vi.resetAllMocks();
  cookieValues.clear();
  recoverySession = session();
  mocks.env.siteUrl = 'https://app.sobrew.com';
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const client = { auth: {
    resetPasswordForEmail: mocks.resetPasswordForEmail,
    getUser: mocks.getUser,
    getSession: mocks.getSession,
    updateUser: mocks.updateUser,
    verifyOtp: mocks.verifyOtp,
    signOut: mocks.signOut,
    exchangeCodeForSession: mocks.exchangeCodeForSession,
  } };
  mocks.createClient.mockResolvedValue(client);
  mocks.withRecoveryClient.mockImplementation(async (operation) => operation(client));
  mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: recoveryUser }, error: null });
  mocks.getSession.mockResolvedValue({ data: { session: recoverySession }, error: null });
  mocks.updateUser.mockResolvedValue({ data: { user: recoveryUser }, error: null });
  mocks.verifyOtp.mockResolvedValue({ data: { user: recoveryUser, session: recoverySession }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.exchangeCodeForSession.mockResolvedValue({ data: { user: recoveryUser, session: session(recoveryUser, 'session-a', 'recovery'), redirectType: 'recovery' }, error: null });
  mocks.createRouteClient.mockReturnValue({ auth: { exchangeCodeForSession: mocks.exchangeCodeForSession } });
  mocks.cookieGet.mockImplementation((name: string) => cookieValues.has(name) ? { name, value: cookieValues.get(name) } : undefined);
  mocks.cookieGetAll.mockImplementation(() => Array.from(cookieValues, ([name, value]) => ({ name, value })));
  mocks.cookieSet.mockImplementation((name: string, value: string, options?: { maxAge?: number }) => {
    if (options?.maxAge === 0) cookieValues.delete(name);
    else cookieValues.set(name, value);
  });
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(sensitivePassword);
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(sensitivePassword);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(pendingToken);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('requesting password recovery', () => {
  it('normalizes the email and sends only the trusted recovery destination', async () => {
    const data = form({ email: '  Buyer@Example.COM  ', redirectTo: 'https://attacker.example/reset', next: '//attacker.example' });
    await expect(requestPasswordReset(data)).rejects.toThrow('REDIRECT:/forgot-password?sent=1');
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith('buyer@example.com', {
      redirectTo: 'https://app.sobrew.com/auth/recovery',
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it.each(['', ' ', 'buyer', 'buyer@', '@example.com', 'buyer @example.com', `${'a'.repeat(243)}@example.com`])(
    'rejects an invalid email without requesting delivery: %j', async (email) => {
      await expect(requestPasswordReset(form({ email }))).rejects.toThrow('REDIRECT:/forgot-password?error=email');
      expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
    }
  );

  it('returns the same success when Auth supplies no account details', async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await expect(requestPasswordReset(form({ email: 'unknown@example.com' }))).rejects.toThrow('REDIRECT:/forgot-password?sent=1');
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each(['over_email_send_rate_limit', 'over_request_rate_limit'])(
    'keeps %s indistinguishable from an unknown account', async (code) => {
      mocks.resetPasswordForEmail.mockResolvedValue({ error: { code, status: 429 } });
      await expect(requestPasswordReset(form({ email: recoveryUser.email }))).rejects.toThrow('REDIRECT:/forgot-password?sent=1');
    }
  );

  it.each(['returned-error', 'network-error'])('does not claim delivery succeeded after %s', async (failure) => {
    if (failure === 'network-error') mocks.resetPasswordForEmail.mockRejectedValue(new Error('Network unavailable'));
    else mocks.resetPasswordForEmail.mockResolvedValue({ error: { code: 'unexpected_failure' } });
    await expect(requestPasswordReset(form({ email: recoveryUser.email }))).rejects.toThrow('REDIRECT:/forgot-password?error=unavailable');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each(['https://user:password@app.sobrew.com', 'https://app.sobrew.com/untrusted-path', 'https://app.sobrew.com?next=evil', 'http://app.sobrew.com', 'invalid-url'])(
    'does not send a recovery email with unsafe site configuration: %s', async (siteUrl) => {
      mocks.env.siteUrl = siteUrl;
      await expect(requestPasswordReset(form({ email: recoveryUser.email }))).rejects.toThrow('REDIRECT:/forgot-password?error=unavailable');
      expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
    }
  );

  it('does not send a production customer to a localhost recovery page', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.env.siteUrl = 'http://localhost:3000';
    await expect(requestPasswordReset(form({ email: recoveryUser.email }))).rejects.toThrow('REDIRECT:/forgot-password?error=unavailable');
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe('opening a recovery email', () => {
  it.each([
    { label: 'ordinary', token: pendingToken },
    { label: 'PKCE-prefixed', token: `pkce_${pendingToken}` },
  ])('stores a $label token in a scoped HTTP-only cookie without consuming it on GET', async ({ token }) => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = await recoverFromEmail(new NextRequest(`https://app.sobrew.com/auth/recovery?token_hash=${token}&type=recovery&next=https://attacker.example`));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://app.sobrew.com/reset-password');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.cookies.get('sobrew-password-recovery')).toMatchObject({
      value: token, path: '/reset-password', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 3600,
    });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.createRouteClient).not.toHaveBeenCalled();
  });

  it.each([
    '', '?token_hash=not-a-token', '?code=', `?code=${'a'.repeat(2049)}`,
    `?token_hash=${pendingToken}&type=signup`, `?token_hash=${pendingToken}&error=access_denied`,
    '?token_hash=bad&code=otherwise-valid-code',
  ])('rejects invalid recovery parameters and clears stale recovery state: %s', async (query) => {
    const response = await recoverFromEmail(new NextRequest(`https://app.sobrew.com/auth/recovery${query}`));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://app.sobrew.com/reset-password?error=invalid_link');
    expect(response.cookies.get('sobrew-password-recovery')).toMatchObject({ value: '', path: '/reset-password', maxAge: 0 });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('stages a default PKCE email without exchanging or consuming it on GET', async () => {
    const response = await recoverFromEmail(new NextRequest('https://app.sobrew.com/auth/recovery?code=valid-pkce-code&next=https://attacker.example'));
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('https://app.sobrew.com/reset-password');
    expect(response.cookies.get(RECOVERY_COOKIE)).toMatchObject({ path: '/reset-password', httpOnly: true, sameSite: 'lax', maxAge: 3600 });
    const value = response.cookies.get(RECOVERY_COOKIE)?.value;
    expect(value).toBeTruthy();
    pendingCookie(value);
    const html = renderToStaticMarkup(await ResetPasswordPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Continue to reset password');
    expect(html).not.toContain('valid-pkce-code');
    expect(html).not.toContain(value);
  });

});

describe('verifying a recovery link', () => {
  it('requires the pending server cookie and ignores a token supplied by the form', async () => {
    await expect(verifyRecoveryLink(form({ token_hash: pendingToken, type: 'email' }))).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each(['', 'a'.repeat(39), 'a'.repeat(129), 'z'.repeat(64), '<script>not-a-token</script>'])(
    'rejects a malformed pending cookie before contacting Auth: %j', async (value) => {
      pendingCookie(value);
      await expect(verifyRecoveryLink(form())).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
      expect(mocks.verifyOtp).not.toHaveBeenCalled();
    }
  );

  it.each([
    { label: 'ordinary', token: pendingToken },
    { label: 'PKCE-prefixed', token: `pkce_${pendingToken}` },
  ])('passes the $label server-held token unchanged to password-recovery verification', async ({ token }) => {
    pendingCookie(token);
    await expect(verifyRecoveryLink(await pendingForm({ token_hash: 'b'.repeat(64), type: 'signup', next: 'https://attacker.example' })))
      .rejects.toThrow('REDIRECT:/reset-password');
    expect(mocks.verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash: token, type: 'recovery' });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(cookieValues.has(RECOVERY_COOKIE)).toBe(false);
    expect(cookieValues.has(RECOVERY_SESSION_COOKIE)).toBe(true);
    expect(mocks.cookieSet).toHaveBeenCalledWith(RECOVERY_SESSION_COOKIE, expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/reset-password' }));
  });

  it('does not consume a newer link opened in another tab when an old form is submitted', async () => {
    pendingCookie();
    const staleForm = await pendingForm();
    pendingCookie('b'.repeat(64));
    const newerState = await getRecoveryState();
    await expect(verifyRecoveryLink(staleForm)).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(await getRecoveryState()).toEqual(newerState);
    expect(cookieValues.get(RECOVERY_COOKIE)).toBe('b'.repeat(64));
  });

  it('rejects a missing flow identity without consuming the pending token', async () => {
    pendingCookie();
    await expect(verifyRecoveryLink(form())).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(cookieValues.get(RECOVERY_COOKIE)).toBe(pendingToken);
  });

  it('clears a confirmed expired token and never falls back to an unrelated session', async () => {
    pendingCookie();
    const data = await pendingForm();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'different-user', email: 'other@example.com' } }, error: null });
    mocks.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'otp_expired', status: 403 } });
    await expect(verifyRecoveryLink(data)).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(cookieValues.has(RECOVERY_COOKIE)).toBe(false);
    expect(cookieValues.has(RECOVERY_SESSION_COOKIE)).toBe(false);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('does not erase a successful proof when a concurrent verification reports token reuse', async () => {
    await establishRecovery();
    const successfulProof = cookieValues.get(RECOVERY_SESSION_COOKIE)!;
    cookieValues.delete(RECOVERY_SESSION_COOKIE);
    pendingCookie();
    const data = await pendingForm();
    mocks.verifyOtp.mockImplementationOnce(async () => {
      // A second tab's successful response arrives while this request is in flight.
      cookieValues.set(RECOVERY_SESSION_COOKIE, successfulProof);
      return { data: { user: null, session: null }, error: { code: 'otp_expired', status: 403 } };
    });
    await expect(verifyRecoveryLink(data)).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(cookieValues.get(RECOVERY_SESSION_COOKIE)).toBe(successfulProof);
    expect((await getRecoveryState()).status).toBe('ready');
  });

  it.each(['network-error', 'provider-503', 'rate-limit'])(
    'preserves a valid pending link across %s and allows a later retry', async (failure) => {
      pendingCookie();
      const data = await pendingForm();
      if (failure === 'network-error') mocks.verifyOtp.mockRejectedValueOnce(new TypeError('Network unavailable'));
      else mocks.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { status: failure === 'rate-limit' ? 429 : 503, code: failure === 'rate-limit' ? 'over_request_rate_limit' : 'unexpected_failure' } });
      await expect(verifyRecoveryLink(data)).rejects.toThrow('REDIRECT:/reset-password?error=recovery_unavailable');
      expect(cookieValues.get(RECOVERY_COOKIE)).toBe(pendingToken);
      expect(cookieValues.has(RECOVERY_SESSION_COOKIE)).toBe(false);
      await expect(verifyRecoveryLink(data)).rejects.toThrow('REDIRECT:/reset-password');
      expect(cookieValues.has(RECOVERY_COOKIE)).toBe(false);
      expect((await getRecoveryState()).status).toBe('ready');
    }
  );

  async function stagePkce() {
    const response = await recoverFromEmail(new NextRequest('https://app.sobrew.com/auth/recovery?code=valid-pkce-code'));
    const pending = response.cookies.get(RECOVERY_COOKIE)?.value;
    if (!pending) throw new Error('Expected staged PKCE code');
    pendingCookie(pending);
    return pendingForm();
  }

  it('exchanges PKCE only after confirmation and binds the recovered session', async () => {
    const data = await stagePkce();
    await expect(verifyRecoveryLink(data)).rejects.toThrow('REDIRECT:/reset-password');
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('valid-pkce-code');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(cookieValues.has(RECOVERY_SESSION_COOKIE)).toBe(true);
    expect(cookieValues.has(RECOVERY_COOKIE)).toBe(false);
  });

  it('rejects PKCE sign-in links that are not a password recovery', async () => {
    const data = await stagePkce();
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { user: recoveryUser, session: recoverySession, redirectType: 'magiclink' }, error: null });
    await expect(verifyRecoveryLink(data)).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(cookieValues.has(RECOVERY_SESSION_COOKIE)).toBe(false);
  });

  it('requires a recovery-authenticated PKCE session even if the verifier labels it recovery', async () => {
    const data = await stagePkce();
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { user: recoveryUser, session: recoverySession, redirectType: 'recovery' }, error: null });
    await expect(verifyRecoveryLink(data)).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(cookieValues.has(RECOVERY_SESSION_COOKIE)).toBe(false);
  });

  it('shows an invalid result when PKCE cannot find its initiating-browser verifier', async () => {
    const data = await stagePkce();
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'bad_code_verifier', status: 400 } });
    await expect(verifyRecoveryLink(data)).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(cookieValues.has(RECOVERY_SESSION_COOKIE)).toBe(false);
  });

  it('restores the initiating-browser verifier after a retryable PKCE failure', async () => {
    const data = await stagePkce();
    const verifierName = 'sb-example-auth-token-code-verifier';
    cookieValues.set(verifierName, 'test-verifier/PASSWORD_RECOVERY');
    mocks.exchangeCodeForSession.mockImplementationOnce(async () => {
      cookieValues.delete(verifierName);
      return { data: { user: null, session: null }, error: { status: 503, code: 'unexpected_failure' } };
    });
    await expect(verifyRecoveryLink(data)).rejects.toThrow('REDIRECT:/reset-password?error=recovery_unavailable');
    expect(cookieValues.get(verifierName)).toBe('test-verifier/PASSWORD_RECOVERY');
    expect(cookieValues.has(RECOVERY_COOKIE)).toBe(true);
    await expect(verifyRecoveryLink(data)).rejects.toThrow('REDIRECT:/reset-password');
    expect(cookieValues.has(RECOVERY_SESSION_COOKIE)).toBe(true);
  });

  it('does not authorize a response that has a user but no session', async () => {
    pendingCookie();
    const data = await pendingForm();
    mocks.verifyOtp.mockResolvedValue({ data: { user: recoveryUser, session: null }, error: null });
    await expect(verifyRecoveryLink(data)).rejects.toThrow('REDIRECT:/reset-password?error=recovery_unavailable');
    expect(cookieValues.get(RECOVERY_COOKIE)).toBe(pendingToken);
    expect(cookieValues.has(RECOVERY_SESSION_COOKIE)).toBe(false);
  });
});

describe('setting the recovered password', () => {
  let flowId: string;
  beforeEach(async () => { flowId = await establishRecovery(); });

  it.each(['', 'short', '1234567', '😀😀😀😀'])(
    'rejects fewer than eight Unicode characters without updating Auth: %j', async (password) => {
      await expect(updateRecoveredPassword(passwordForm(password, password, flowId))).rejects.toThrow('REDIRECT:/reset-password?error=password_length');
      expect(mocks.updateUser).not.toHaveBeenCalled();
      expect(mocks.signOut).not.toHaveBeenCalled();
    }
  );

  it.each(['a'.repeat(73), '界'.repeat(25)])('rejects passwords longer than 72 UTF-8 bytes', async (password) => {
    await expect(updateRecoveredPassword(passwordForm(password, password, flowId))).rejects.toThrow('REDIRECT:/reset-password?error=password_too_long');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each(['a'.repeat(72), '界'.repeat(24), '😀'.repeat(8)])('preserves valid boundary and Unicode passwords exactly', async (password) => {
    await expect(updateRecoveredPassword(passwordForm(password, password, flowId))).rejects.toThrow('REDIRECT:/login?success=password_reset');
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ password });
  });

  it('rejects uploaded files instead of converting them to a password string', async () => {
    const data = passwordForm(sensitivePassword, sensitivePassword, flowId);
    data.set('password', new Blob(['not a password']), 'password.txt');
    data.set('confirm_password', new Blob(['not a password']), 'confirmation.txt');
    await expect(updateRecoveredPassword(data)).rejects.toThrow('REDIRECT:/reset-password?error=password_length');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each(['', 'different-password', `${sensitivePassword} `])('requires exact confirmation: %j', async (confirmation) => {
    await expect(updateRecoveredPassword(passwordForm(sensitivePassword, confirmation, flowId))).rejects.toThrow('REDIRECT:/reset-password?error=password_mismatch');
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('denies an ordinary signed-in session without recovery proof', async () => {
    cookieValues.delete(RECOVERY_SESSION_COOKIE);
    mocks.getSession.mockResolvedValue({ data: { session: session(recoveryUser, 'ordinary-session', 'password') }, error: null });
    await expect(updateRecoveredPassword(passwordForm(sensitivePassword, sensitivePassword, flowId))).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects a tampered recovery proof', async () => {
    cookieValues.set(RECOVERY_SESSION_COOKIE, `${cookieValues.get(RECOVERY_SESSION_COOKIE)}tampered`);
    await expect(updateRecoveredPassword(passwordForm(sensitivePassword, sensitivePassword, flowId))).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects an expired recovery proof', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    try {
      await expect(updateRecoveredPassword(passwordForm(sensitivePassword, sensitivePassword, flowId))).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
      expect(mocks.updateUser).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('does not change account B from a reset form opened for account A', async () => {
    const other = { id: 'different-user', email: 'other@example.com' };
    mocks.getSession.mockResolvedValue({ data: { session: session(other, 'session-b') }, error: null });
    mocks.getUser.mockResolvedValue({ data: { user: other }, error: null });
    await expect(updateRecoveredPassword(passwordForm(sensitivePassword, sensitivePassword, flowId))).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects a replaced session even if it belongs to the same account', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: session(recoveryUser, 'replacement-session') }, error: null });
    await expect(updateRecoveredPassword(passwordForm(sensitivePassword, sensitivePassword, flowId))).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('does not let a stale form overwrite a newer completed recovery flow', async () => {
    const staleForm = passwordForm(sensitivePassword, sensitivePassword, flowId);
    pendingCookie('b'.repeat(64));
    const next = await pendingForm();
    await expect(verifyRecoveryLink(next)).rejects.toThrow('REDIRECT:/reset-password');
    await expect(updateRecoveredPassword(staleForm)).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each(['missing-user', 'auth-error'])('fails closed for %s', async (failure) => {
    mocks.getUser.mockResolvedValue({ data: { user: failure === 'auth-error' ? recoveryUser : null }, error: failure === 'auth-error' ? { code: 'session_not_found', status: 401 } : null });
    await expect(updateRecoveredPassword(passwordForm(sensitivePassword, sensitivePassword, flowId))).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it.each(['network-error', 'provider-503'])('preserves recovery proof when user verification has a %s', async (failure) => {
    const marker = cookieValues.get(RECOVERY_SESSION_COOKIE);
    if (failure === 'network-error') mocks.getUser.mockRejectedValue(new TypeError('Network unavailable'));
    else mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 503, code: 'unexpected_failure' } });
    await expect(updateRecoveredPassword(passwordForm(sensitivePassword, sensitivePassword, flowId))).rejects.toThrow('REDIRECT:/reset-password?error=recovery_unavailable');
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(cookieValues.get(RECOVERY_SESSION_COOKIE)).toBe(marker);
  });

  it('uses only the verified recovered account, preserves exact spaces, and ends only this session', async () => {
    const data = passwordForm(sensitivePassword, sensitivePassword, flowId);
    data.set('user_id', 'different-user');
    data.set('email', 'other@example.com');
    data.set('next', 'https://attacker.example');
    await expect(updateRecoveredPassword(data)).rejects.toThrow('REDIRECT:/login?success=password_reset');
    expect(mocks.getUser).toHaveBeenCalledWith(recoverySession.access_token);
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ password: sensitivePassword });
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
    expect(cookieValues.has(RECOVERY_SESSION_COOKIE)).toBe(false);
  });

  it.each(['same_password', 'weak_password'])(
    'preserves the recovery session when Auth rejects %s so the customer can retry', async (code) => {
      mocks.updateUser.mockResolvedValue({ data: { user: null }, error: { code } });
      await expect(updateRecoveredPassword(passwordForm(sensitivePassword, sensitivePassword, flowId))).rejects.toThrow(`REDIRECT:/reset-password?error=${code}`);
      expect(mocks.signOut).not.toHaveBeenCalled();
      expect(cookieValues.has(RECOVERY_SESSION_COOKIE)).toBe(true);
    }
  );

  it.each(['returned-error', 'network-error'])('does not report success after a password update %s', async (failure) => {
    if (failure === 'network-error') mocks.updateUser.mockRejectedValue(new Error('Network unavailable'));
    else mocks.updateUser.mockResolvedValue({ data: { user: null }, error: { code: 'validation_failed', status: 400 } });
    const expected = failure === 'network-error' ? 'update_unconfirmed' : 'update_failed';
    await expect(updateRecoveredPassword(passwordForm(sensitivePassword, sensitivePassword, flowId))).rejects.toThrow(`REDIRECT:/reset-password?error=${expected}`);
    expect(mocks.updateUser).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it.each(['thrown-error', 'returned-error'])('reports the saved password even when sign-out has a %s', async (failure) => {
    if (failure === 'thrown-error') mocks.signOut.mockRejectedValue(new Error('Network unavailable after password saved'));
    else mocks.signOut.mockResolvedValue({ error: { status: 503, code: 'unexpected_failure' } });
    await expect(updateRecoveredPassword(passwordForm(sensitivePassword, sensitivePassword, flowId))).rejects.toThrow('REDIRECT:/login?success=password_reset');
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ password: sensitivePassword });
    expect(cookieValues.has(RECOVERY_SESSION_COOKIE)).toBe(false);
  });
});

describe('password recovery page states', () => {
  async function markup(params: Record<string, string> = {}) {
    return renderToStaticMarkup(await ResetPasswordPage({ searchParams: Promise.resolve(params) }));
  }

  it('keeps an ordinary logged-in user out of the reset form', async () => {
    const html = await markup();
    expect(html).toContain('invalid or has expired');
    expect(html).not.toContain('name="password"');
  });

  it('renders the flow identity without exposing the pending bearer token', async () => {
    pendingCookie();
    const pending = await getRecoveryState();
    expect(pending.status).toBe('pending');
    if (pending.status !== 'pending') throw new Error('Expected pending state');
    const html = await markup();
    expect(html).toContain(`name="flow_id" value="${pending.flowId}"`);
    expect(html).not.toContain(pendingToken);
    expect(html).not.toContain('name="password"');
  });

  it('shows a retryable verification error alongside the pending confirmation', async () => {
    pendingCookie();
    const html = await markup({ error: 'recovery_unavailable' });
    expect(html).toContain('Continue to reset password');
    expect(html).toContain('Please try again');
    expect(html).not.toContain('invalid or has expired');
  });

  it('shows the recovered password form with its bound flow identity', async () => {
    const flowId = await establishRecovery();
    const html = await markup();
    expect(html).toContain('name="password"');
    expect(html).toContain('Resetting password for');
    expect(html).toContain(recoveryUser.email);
    expect(html).toContain(`name="flow_id" value="${flowId}"`);
    expect(html).not.toContain(cookieValues.get(RECOVERY_SESSION_COOKIE));
  });

  it('shows a service retry instead of declaring a valid recovered session expired during an outage', async () => {
    await establishRecovery();
    mocks.getUser.mockRejectedValue(new TypeError('Network unavailable'));
    const html = await markup();
    expect(html).toContain('Password reset unavailable');
    expect(html).toContain('href="/reset-password"');
    expect(html).toContain('Try again');
    expect(html).not.toContain('invalid or has expired');
    expect(html).not.toContain('name="password"');
    expect(cookieValues.has(RECOVERY_SESSION_COOKIE)).toBe(true);
  });

  it('offers sign-in when the provider may have saved the password before losing its response', async () => {
    await establishRecovery();
    const html = await markup({ error: 'update_unconfirmed' });
    expect(html).toContain('confirm the password change');
    expect(html).toContain('Try signing in');
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/forgot-password"');
    expect(html).not.toContain('name="password"');
  });
});
