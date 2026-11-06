// Opt-in live integration: real application actions and real Supabase Auth.
// Requests no emails. Creates two marked example.invalid users with no center,
// revokes their sessions, then deletes only the marker-verified QA records.
// RUN_LIVE_PASSWORD_RECOVERY_TEST=1 LIVE_PASSWORD_RECOVERY_PROJECT_REF=<ref>
//   npm test -- tests/password-recovery-live.test.ts
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { describe, it, vi } from 'vitest';

type JarCookie = { name: string; value: string; path: string; expiresAt?: number };
type CookieOptions = { path?: string; maxAge?: number; expires?: Date | number | string };

const browser = vi.hoisted(() => ({
  path: '/reset-password',
  jar: new Map<string, JarCookie>(),
  set(name: string, value: string, options: CookieOptions = {}) {
    const path = options.path ?? '/';
    const key = `${name}\0${path}`;
    const expiresAt = options.maxAge !== undefined
      ? Date.now() + options.maxAge * 1_000
      : options.expires !== undefined ? new Date(options.expires).getTime() : undefined;
    if (options.maxAge === 0 || (expiresAt !== undefined && expiresAt <= Date.now())) this.jar.delete(key);
    else this.jar.set(key, { name, value, path, expiresAt });
  },
  getAll() {
    for (const [key, cookie] of this.jar) {
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= Date.now()) this.jar.delete(key);
    }
    return [...this.jar.values()]
      .filter(({ path }) => this.path === path || this.path.startsWith(path.endsWith('/') ? path : `${path}/`))
      .sort((a, b) => b.path.length - a.path.length)
      .map(({ name, value }) => ({ name, value }));
  },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => browser.getAll(),
    get: (name: string) => browser.getAll().find((cookie) => cookie.name === name),
    set: (name: string, value: string, options?: CookieOptions) => browser.set(name, value, options),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw Object.assign(new Error('QA redirect'), { qaRedirect: path }); },
}));

const RUN_LIVE = process.env.RUN_LIVE_PASSWORD_RECOVERY_TEST === '1';
const SAFE_CODES = new Set(['user_not_found', 'invalid_credentials', 'otp_expired', 'weak_password',
  'same_password', 'validation_failed', 'over_request_rate_limit', 'session_not_found', '42501', '23503']);

class QaFailure extends Error {
  constructor(label: string, error?: { code?: string; status?: number } | null) {
    super(`${label}${error?.code && SAFE_CODES.has(error.code) ? ` [${error.code}]` : ''}`);
  }
}

function check(condition: unknown, label: string, error?: { code?: string; status?: number } | null): asserts condition {
  if (!condition) throw new QaFailure(label, error);
}

async function redirectedTo(action: () => Promise<unknown>, expected: string) {
  try { await action(); }
  catch (error) {
    if (error && typeof error === 'object' && 'qaRedirect' in error) {
      check(error.qaRedirect === expected, 'Application redirected to an unexpected recovery state.');
      return;
    }
    // Do not expose SDK errors, request URLs, passwords, or tokens to Vitest.
    throw new QaFailure('Application action threw instead of handling the recovery result.');
  }
  throw new QaFailure('Application action returned without its expected redirect.');
}

function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

describe.skipIf(!RUN_LIVE)('password recovery application/provider integration', () => {
  it('binds recovery to its account and session, rejects stale forms, and changes only the recovered password', async () => {
    let envFailed = false;
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      // Next intentionally skips .env.local under NODE_ENV=test. This opt-in
      // integration needs the operator's local project credentials, like the
      // standalone QA script, without changing the application's test mode.
      vi.stubEnv('NODE_ENV', 'production');
      nextEnv.loadEnvConfig(fileURLToPath(new URL('..', import.meta.url)), false, {
        info() {}, error() { envFailed = true; },
      });
    } finally {
      vi.stubEnv('NODE_ENV', originalNodeEnv);
    }
    check(!envFailed, 'Could not safely load the local environment.');
    const projectRef = process.env.LIVE_PASSWORD_RECOVERY_PROJECT_REF;
    check(projectRef && /^[a-z0-9]{20}$/.test(projectRef), 'Explicit LIVE_PASSWORD_RECOVERY_PROJECT_REF is required.');
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    check(publicKey && serviceKey, 'Supabase QA configuration is missing.');
    let projectUrl: URL;
    try { projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''); }
    catch { throw new QaFailure('Configured Supabase URL is invalid.'); }
    check(projectUrl.protocol === 'https:' && projectUrl.hostname === `${projectRef}.supabase.co`
      && !projectUrl.port && !projectUrl.username && !projectUrl.password && !projectUrl.search
      && !projectUrl.hash && projectUrl.pathname === '/', 'Configured project must exactly match the explicit QA project.');

    // Import after environment initialization; keep the application/provider
    // implementation real. Only Next request cookies and redirects are adapted.
    const [{ GET }, { verifyRecoveryLink, updateRecoveredPassword }, recovery, { withRecoveryClient }] = await Promise.all([
      import('@/app/auth/recovery/route'), import('@/app/reset-password/actions'),
      import('@/lib/password-recovery'), import('@/lib/supabase/recovery-client'),
    ]);

    const runId = randomUUID();
    const randomPassword = () => `  QA9! ${randomBytes(16).toString('hex')} <&>  `;
    const users = ['a', 'b'].map((label) => ({
      id: randomUUID(), email: `recovery-live-${label}-${runId}@example.invalid`, password: randomPassword(),
    }));
    const [a, b] = users;
    const newPassword = randomPassword();
    const cleanupIds = new Set<string>();
    const latestTokens = new Map<string, string>();
    const interrupted = new AbortController();
    const onSignal = () => interrupted.abort();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    const overallTimer = setTimeout(onSignal, 120_000);
    let cleaningUp = false;
    let stage = 'initialization';
    let failure: string | undefined;
    const cleanupFailures: string[] = [];

    const boundedFetch: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      check(url.origin === projectUrl.origin && !url.username && !url.password, 'Refusing a QA request outside the confirmed Supabase project.');
      // Reserve enough of the framework timeout to verify both cleanup paths.
      const signals = [AbortSignal.timeout(cleaningUp ? 15_000 : 20_000)];
      if (init?.signal) signals.push(init.signal);
      if (!cleaningUp) signals.push(interrupted.signal);
      return fetch(input, { ...init, credentials: 'omit', redirect: 'error', signal: AbortSignal.any(signals) });
    };
    function client(key: string) {
      return createClient(projectUrl.origin, key, {
        global: { fetch: boundedFetch },
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, debug: false,
          storageKey: `recovery-live-${randomUUID()}` },
      });
    }
    const admin = client(serviceKey);
    function owned(user: User | null | undefined) {
      return users.some((candidate) => candidate.id === user?.id && candidate.email === user.email)
        && user?.app_metadata.qa_run_id === runId && user.app_metadata.qa_purpose === 'password-recovery-live';
    }
    async function step(label: string, work: () => Promise<void>) {
      check(!interrupted.signal.aborted, 'QA was interrupted.');
      stage = label;
      await work();
    }
    async function requirePassword(user: typeof a, password: string) {
      const result = await client(publicKey!).auth.signInWithPassword({ email: user.email, password });
      check(!result.error && result.data.user?.id === user.id && result.data.session,
        'Expected QA password did not authenticate.', result.error);
      latestTokens.set(user.id, result.data.session.access_token);
    }
    async function browserSignIn(user: typeof a) {
      const result = await withRecoveryClient((supabase) => supabase.auth.signInWithPassword({ email: user.email, password: user.password }));
      check(!result.error && result.data.user?.id === user.id && result.data.session,
        'QA browser sign-in failed.', result.error);
      latestTokens.set(user.id, result.data.session.access_token);
    }
    async function generateToken(user: typeof a) {
      const result = await admin.auth.admin.generateLink({ type: 'recovery', email: user.email });
      check(!result.error && owned(result.data.user), 'QA recovery generation returned an unexpected identity.', result.error);
      check(recovery.isRecoveryToken(result.data.properties.hashed_token), 'QA recovery returned an unsupported token.');
      return result.data.properties.hashed_token;
    }
    async function openLink(token: string) {
      browser.path = '/auth/recovery';
      const response = await GET(new NextRequest(`https://app.sobrew.com/auth/recovery?token_hash=${encodeURIComponent(token)}&type=recovery`));
      check(response.status === 303 && response.headers.get('location') === 'https://app.sobrew.com/reset-password',
        'Recovery callback did not redirect to the clean reset URL.');
      response.cookies.getAll().forEach(({ name, value, ...options }) => browser.set(name, value, options));
      browser.path = '/reset-password';
      const state = await recovery.getRecoveryState();
      check(state.status === 'pending', 'Opening a recovery link did not produce the confirmation state.');
      return state.flowId;
    }
    function restore(snapshot: JarCookie[]) {
      browser.jar.clear();
      snapshot.forEach((cookie) => browser.jar.set(`${cookie.name}\0${cookie.path}`, { ...cookie }));
    }
    const passwordForm = (flowId: string) => form({ flow_id: flowId, password: newPassword, confirm_password: newPassword });

    try {
      browser.jar.clear();
      browser.path = '/reset-password';
      await step('create isolated marked QA accounts', async () => {
        for (const user of users) {
          const before = await admin.auth.admin.getUserById(user.id);
          check(before.error?.code === 'user_not_found' && !before.data.user, 'Cannot confirm the random QA ID is unused.', before.error);
          cleanupIds.add(user.id);
          const created = await admin.auth.admin.createUser({ ...user, email_confirm: true,
            app_metadata: { qa_run_id: runId, qa_purpose: 'password-recovery-live' } });
          check(!created.error && owned(created.data.user), 'QA account creation failed.', created.error);
          const profile = await admin.from('profiles').select('id,is_admin,center_id').eq('id', user.id).maybeSingle();
          check(!profile.error && profile.data?.id === user.id && profile.data.is_admin === false && profile.data.center_id === null,
            'QA profile is not an isolated non-admin account.', profile.error);
        }
      });
      await step('deny password reset from an ordinary signed-in session', async () => {
        await browserSignIn(b);
        check((await recovery.getRecoveryState()).status === 'invalid', 'An ordinary session was accepted as recovery.');
        await redirectedTo(() => updateRecoveredPassword(passwordForm('a'.repeat(64))), '/reset-password?error=invalid_link');
        await requirePassword(b, b.password);
      });

      browser.jar.clear();
      let aToken = '';
      let aFlow = '';
      let readyA: JarCookie[] = [];
      await step('preserve one-time tokens on GET and reject a stale confirmation from another tab', async () => {
        aToken = await generateToken(a);
        aFlow = await openLink(aToken);
        const pendingA = [...browser.jar.values()].map((cookie) => ({ ...cookie }));
        const bFlow = await openLink(await generateToken(b));
        check(aFlow !== bFlow, 'Different recovery links produced the same flow identity.');
        await redirectedTo(() => verifyRecoveryLink(form({ flow_id: aFlow })), '/reset-password?error=invalid_link');
        const pendingB = await recovery.getRecoveryState();
        check(pendingB.status === 'pending' && pendingB.flowId === bFlow, 'A stale tab destroyed the newer pending recovery.');
        restore(pendingA);
        await redirectedTo(() => verifyRecoveryLink(form({ flow_id: aFlow })), '/reset-password');
        const state = await recovery.getRecoveryState();
        check(state.status === 'ready' && state.user.id === a.id && state.flowId === aFlow,
          'Verified recovery did not bind to the intended QA account.');
        readyA = [...browser.jar.values()].map((cookie) => ({ ...cookie }));
      });
      await step('reject account switching without changing either password', async () => {
        await browserSignIn(b);
        check((await recovery.getRecoveryState()).status === 'invalid', 'A recovery marker accepted another account.');
        await redirectedTo(() => updateRecoveredPassword(passwordForm(aFlow)), '/reset-password?error=invalid_link');
        await requirePassword(a, a.password);
        await requirePassword(b, b.password);
      });
      await step('reject a replacement session even for the same account', async () => {
        restore(readyA);
        await browserSignIn(a);
        check((await recovery.getRecoveryState()).status === 'invalid', 'A recovery marker accepted a replacement sign-in session.');
        await redirectedTo(() => updateRecoveredPassword(passwordForm(aFlow)), '/reset-password?error=invalid_link');
        await requirePassword(a, a.password);
      });
      await step('save through the original verified session and clear recovery state', async () => {
        restore(readyA);
        await redirectedTo(() => updateRecoveredPassword(passwordForm(aFlow)), '/login?success=password_reset');
        check(!browser.getAll().some(({ name }) => name === recovery.RECOVERY_COOKIE || name === recovery.RECOVERY_SESSION_COOKIE),
          'Successful password change left recovery credentials in cookies.');
        const rejected = await client(publicKey!).auth.signInWithPassword({ email: a.email, password: a.password });
        check(rejected.error?.code === 'invalid_credentials' && !rejected.data.session, 'Old QA password was still accepted.', rejected.error);
        await requirePassword(a, newPassword);
        await requirePassword(b, b.password);
      });
      await step('reject reuse of the consumed recovery token through the application', async () => {
        browser.jar.clear();
        const reusedFlow = await openLink(aToken);
        await redirectedTo(() => verifyRecoveryLink(form({ flow_id: reusedFlow })), '/reset-password?error=invalid_link');
        check((await recovery.getRecoveryState()).status === 'invalid', 'Consumed recovery token restored a usable recovery session.');
      });
    } catch (error) {
      failure = `${stage}: ${error instanceof QaFailure ? error.message : 'Unexpected runtime or network failure (details withheld).'}`;
    } finally {
      clearTimeout(overallTimer);
      cleaningUp = true;
      for (const id of cleanupIds) {
        try {
          const lookup = await admin.auth.admin.getUserById(id);
          if (lookup.error?.code === 'user_not_found' && !lookup.data.user) continue;
          check(!lookup.error && owned(lookup.data.user), 'QA ownership marker did not match; refusing deletion.', lookup.error);
          const token = latestTokens.get(id);
          if (token) {
            const revoked = await admin.auth.admin.signOut(token, 'global');
            check(!revoked.error || [401, 403, 404].includes(revoked.error.status ?? 0), 'QA sessions could not be revoked.', revoked.error);
          }
          const deleted = await admin.auth.admin.deleteUser(id, false);
          check(!deleted.error, 'QA user deletion failed.', deleted.error);
          const absent = await admin.auth.admin.getUserById(id);
          const profile = await admin.from('profiles').select('id').eq('id', id).maybeSingle();
          check(absent.error?.code === 'user_not_found' && !absent.data.user && !profile.error && !profile.data,
            'QA account/profile cleanup could not be verified.');
        } catch {
          cleanupFailures.push(id);
        }
      }
      browser.jar.clear();
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
    check(!cleanupFailures.length, `QA cleanup needs review: run=${runId} users=${cleanupFailures.join(',')}`);
    check(!failure, failure ?? 'Live recovery QA failed.');
  }, 300_000);
});
