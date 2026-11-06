import { NextRequest, type NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { siteUrl: 'https://app.sobrew.com' },
  createClient: vi.fn(),
  createRouteClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet, delete: mocks.cookieDelete }),
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/route', () => ({ createRouteClient: mocks.createRouteClient }));

import { GET as recoverFromEmail } from '@/app/auth/recovery/route';
import { requestPasswordReset } from '@/app/forgot-password/actions';
import { updateRecoveredPassword, verifyRecoveryLink } from '@/app/reset-password/actions';

const recoveryUser = { id: 'verified-customer', email: 'buyer@example.com' };
const pendingToken = 'a'.repeat(64);
const sensitivePassword = '  Keep  My <&> Password!  ';

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries(values).forEach(([name, value]) => data.set(name, value));
  return data;
}

function passwordForm(password = sensitivePassword, confirmation = password) {
  return form({ password, confirm_password: confirmation });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.siteUrl = 'https://app.sobrew.com';
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mocks.createClient.mockResolvedValue({ auth: {
    resetPasswordForEmail: mocks.resetPasswordForEmail,
    getUser: mocks.getUser,
    updateUser: mocks.updateUser,
    verifyOtp: mocks.verifyOtp,
    signOut: mocks.signOut,
  } });
  mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: recoveryUser }, error: null });
  mocks.updateUser.mockResolvedValue({ data: { user: recoveryUser }, error: null });
  mocks.verifyOtp.mockResolvedValue({ data: { user: recoveryUser, session: { user: recoveryUser } }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.exchangeCodeForSession.mockResolvedValue({ data: { user: recoveryUser, session: { user: recoveryUser } }, error: null });
  mocks.createRouteClient.mockReturnValue({ auth: { exchangeCodeForSession: mocks.exchangeCodeForSession } });
  mocks.cookieGet.mockReturnValue(undefined);
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

  it('supports a default PKCE email and preserves cookies written by the exchange', async () => {
    mocks.createRouteClient.mockImplementation((_request: NextRequest, response: NextResponse) => {
      response.cookies.set('sb-recovery-session', 'test-session', { path: '/', httpOnly: true });
      return { auth: { exchangeCodeForSession: mocks.exchangeCodeForSession } };
    });
    const response = await recoverFromEmail(new NextRequest('https://app.sobrew.com/auth/recovery?code=valid-pkce-code&next=https://attacker.example'));
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('valid-pkce-code');
    expect(response.headers.get('location')).toBe('https://app.sobrew.com/reset-password');
    expect(response.cookies.get('sb-recovery-session')?.value).toBe('test-session');
    expect(response.cookies.get('sobrew-password-recovery')).toMatchObject({ value: '', path: '/reset-password', maxAge: 0 });
  });

  it.each(['missing-verifier', 'network-error'])('shows an invalid-link result after a PKCE %s', async (failure) => {
    if (failure === 'network-error') mocks.exchangeCodeForSession.mockRejectedValue(new Error('Network unavailable'));
    else mocks.exchangeCodeForSession.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'bad_code_verifier' } });
    const response = await recoverFromEmail(new NextRequest('https://app.sobrew.com/auth/recovery?code=expired-code'));
    expect(response.headers.get('location')).toBe('https://app.sobrew.com/reset-password?error=invalid_link');
    expect(mocks.updateUser).not.toHaveBeenCalled();
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
      mocks.cookieGet.mockReturnValue({ name: 'sobrew-password-recovery', value });
      await expect(verifyRecoveryLink(form())).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
      expect(mocks.verifyOtp).not.toHaveBeenCalled();
    }
  );

  it.each([
    { label: 'ordinary', token: pendingToken },
    { label: 'PKCE-prefixed', token: `pkce_${pendingToken}` },
  ])('passes the $label server-held token unchanged to password-recovery verification', async ({ token }) => {
    mocks.cookieGet.mockReturnValue({ name: 'sobrew-password-recovery', value: token });
    await expect(verifyRecoveryLink(form({ token_hash: 'b'.repeat(64), type: 'signup', next: 'https://attacker.example' })))
      .rejects.toThrow('REDIRECT:/reset-password');
    expect(mocks.verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash: token, type: 'recovery' });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith('sobrew-password-recovery', '', expect.objectContaining({ path: '/reset-password', maxAge: 0 }));
  });

  it.each(['expired-token', 'network-error'])(
    'does not fall back to an existing unrelated session after %s', async (failure) => {
      mocks.cookieGet.mockReturnValue({ name: 'sobrew-password-recovery', value: pendingToken });
      mocks.getUser.mockResolvedValue({ data: { user: { id: 'different-user', email: 'other@example.com' } }, error: null });
      if (failure === 'network-error') mocks.verifyOtp.mockRejectedValue(new Error('Network unavailable'));
      else mocks.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'otp_expired' } });
      await expect(verifyRecoveryLink(form())).rejects.toThrow('REDIRECT:/reset-password?error=invalid_link');
      expect(mocks.updateUser).not.toHaveBeenCalled();
    }
  );
});

describe('setting the recovered password', () => {
  it.each(['', 'short', '1234567'])(
    'rejects a short password without updating Auth: %j', async (password) => {
      await expect(updateRecoveredPassword(passwordForm(password))).rejects.toThrow('REDIRECT:/reset-password?error=password_length');
      expect(mocks.updateUser).not.toHaveBeenCalled();
      expect(mocks.signOut).not.toHaveBeenCalled();
    }
  );

  it.each(['', 'different-password', `${sensitivePassword} `])('requires exact confirmation: %j', async (confirmation) => {
    await expect(updateRecoveredPassword(passwordForm(sensitivePassword, confirmation))).rejects.toThrow('REDIRECT:/reset-password?error=password_mismatch');
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it.each(['missing-user', 'auth-error', 'network-error'])('fails closed for %s', async (failure) => {
    if (failure === 'network-error') mocks.getUser.mockRejectedValue(new Error('Network unavailable'));
    else mocks.getUser.mockResolvedValue({
      data: { user: failure === 'auth-error' ? recoveryUser : null },
      error: failure === 'auth-error' ? { code: 'session_not_found' } : null,
    });
    const expectedError = failure === 'network-error' ? 'update_failed' : 'invalid_link';
    await expect(updateRecoveredPassword(passwordForm())).rejects.toThrow(`REDIRECT:/reset-password?error=${expectedError}`);
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('updates only the authenticated user, preserves exact characters, and ends only this session', async () => {
    const data = passwordForm();
    data.set('user_id', 'different-user');
    data.set('email', 'other@example.com');
    data.set('next', 'https://attacker.example');
    await expect(updateRecoveredPassword(data)).rejects.toThrow('REDIRECT:/login?success=password_reset');
    expect(mocks.getUser).toHaveBeenCalled();
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ password: sensitivePassword });
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  });

  it.each(['same_password', 'weak_password'])(
    'preserves the recovery session when Auth rejects %s so the customer can retry', async (code) => {
      mocks.updateUser.mockResolvedValue({ data: { user: null }, error: { code } });
      await expect(updateRecoveredPassword(passwordForm())).rejects.toThrow(`REDIRECT:/reset-password?error=${code}`);
      expect(mocks.signOut).not.toHaveBeenCalled();
    }
  );

  it.each(['returned-error', 'network-error'])('does not report success after a password update %s', async (failure) => {
    if (failure === 'network-error') mocks.updateUser.mockRejectedValue(new Error('Network unavailable'));
    else mocks.updateUser.mockResolvedValue({ data: { user: null }, error: { code: 'unexpected_failure' } });
    await expect(updateRecoveredPassword(passwordForm())).rejects.toThrow('REDIRECT:/reset-password?error=update_failed');
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('reports a successful password change even when local sign-out has a transport error', async () => {
    mocks.signOut.mockRejectedValue(new Error('Network unavailable after password saved'));
    await expect(updateRecoveredPassword(passwordForm())).rejects.toThrow('REDIRECT:/login?success=password_reset');
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ password: sensitivePassword });
  });
});
