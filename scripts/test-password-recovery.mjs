// Opt-in LIVE Auth QA. Requests no recovery/welcome email, creates one marked
// example.invalid account with no center, and deletes only that verified account.
// Project-enabled security notifications can target only this invalid QA address.
// Usage: node scripts/test-password-recovery.mjs --project-ref <project-ref>
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

const usage = 'Usage: node scripts/test-password-recovery.mjs --project-ref <project-ref>';
const safeCodes = new Set([
  'user_not_found', 'invalid_credentials', 'otp_expired', 'weak_password',
  'same_password', 'reauthentication_needed', 'reauthentication_not_valid',
  'over_request_rate_limit', 'request_timeout', 'unexpected_failure',
  'validation_failed', 'email_address_invalid', 'session_not_found',
  'PGRST116', '42501', '23503', '23505',
]);

class QaFailure extends Error {
  constructor(label, error) {
    super(label);
    // API messages/bodies can contain credentials. Keep only allowlisted codes.
    this.code = safeCodes.has(error?.code) ? error.code : undefined;
    this.status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599
      ? error.status : undefined;
  }
}

function check(condition, label, error) {
  if (!condition) throw new QaFailure(label, error);
}

function safeFailure(error) {
  if (!(error instanceof QaFailure)) return 'Unexpected runtime or network failure (details withheld).';
  return `${error.message}${error.code ? ` [${error.code}]` : ''}${error.status ? ` (HTTP ${error.status})` : ''}`;
}

async function run() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  check(args.length === 2 && args[0] === '--project-ref' && /^[a-z0-9]{20}$/.test(args[1]), usage);

  let envFailed = false;
  nextEnv.loadEnvConfig(fileURLToPath(new URL('..', import.meta.url)), false, {
    info() {}, error() { envFailed = true; },
  });
  check(!envFailed, 'Local environment could not be loaded safely.');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  check(Boolean(serviceKey && publicKey && process.env.NEXT_PUBLIC_SUPABASE_URL), 'Required Supabase configuration is missing.');
  let projectUrl;
  try { projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL); }
  catch { throw new QaFailure('Configured Supabase URL is invalid.'); }
  check(projectUrl.protocol === 'https:' && projectUrl.hostname === `${args[1]}.supabase.co`
    && !projectUrl.username && !projectUrl.password && !projectUrl.port
    && !projectUrl.search && !projectUrl.hash && projectUrl.pathname === '/',
  'The explicit project reference must exactly match the configured hosted Supabase URL.');

  const runId = randomUUID();
  const userId = randomUUID();
  const email = `password-recovery-qa-${runId}@example.invalid`;
  const marker = { qa_run_id: runId, qa_purpose: 'password-recovery' };
  const password = () => `  Qa9!<&> ${randomBytes(16).toString('hex')}  Two  `;
  const oldPassword = password();
  const newPassword = password();
  const cleanupIds = new Set();
  const interrupted = new AbortController();
  let cleaningUp = false;
  let stage = 'initialization';
  let passed = 0;
  let failed = false;
  let cleanupFailed = false;

  const onSignal = () => interrupted.abort();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  async function boundedFetch(input, init) {
    const url = new URL(input instanceof Request ? input.url : String(input));
    check(url.origin === projectUrl.origin && !url.username && !url.password,
      'Refusing a request outside the confirmed Supabase project.');
    const signals = [AbortSignal.timeout(20_000)];
    if (init?.signal) signals.push(init.signal);
    if (!cleaningUp) signals.push(interrupted.signal);
    return fetch(input, { ...init, credentials: 'omit', redirect: 'error', signal: AbortSignal.any(signals) });
  }

  function client(key) {
    return createClient(projectUrl.origin, key, {
      global: { fetch: boundedFetch },
      auth: {
        autoRefreshToken: false, persistSession: false, detectSessionInUrl: false,
        storageKey: `password-recovery-qa-${randomUUID()}`, debug: false,
      },
    });
  }
  const admin = client(serviceKey);
  // Fresh public client has no saved session or verifier from the request browser.
  const recovery = client(publicKey);
  const owned = (user) => user?.email === email && user.app_metadata?.qa_run_id === runId
    && user.app_metadata?.qa_purpose === marker.qa_purpose;

  async function test(label, action) {
    check(!interrupted.signal.aborted, 'Run interrupted.');
    stage = label;
    await action();
    passed += 1;
    console.log(`PASS ${label}`);
  }

  async function requirePassword(value) {
    const result = await client(publicKey).auth.signInWithPassword({ email, password: value });
    check(!result.error && result.data?.user?.id === userId && result.data?.session,
      'Expected password did not authenticate the QA account.', result.error);
  }

  console.log(`LIVE password recovery QA: project=${args[1]} run=${runId} user=${userId}; no recovery email requested.`);
  try {
    await test('create a marked disposable account without a center', async () => {
      const before = await admin.auth.admin.getUserById(userId);
      check(before.error?.code === 'user_not_found' && !before.data?.user,
        'Cannot confirm the random QA user ID is unused; refusing creation.', before.error);
      // A known ID allows cleanup even when creation succeeds but its response is lost.
      cleanupIds.add(userId);
      const created = await admin.auth.admin.createUser({
        id: userId, email, password: oldPassword, email_confirm: true, app_metadata: marker,
      });
      if (owned(created.data?.user) && typeof created.data.user.id === 'string') cleanupIds.add(created.data.user.id);
      check(!created.error && created.data?.user?.id === userId && owned(created.data.user),
        'QA account creation failed or returned an unexpected identity.', created.error);
      const profile = await admin.from('profiles').select('id,is_admin,center_id').eq('id', userId).maybeSingle();
      check(!profile.error && profile.data?.id === userId && profile.data.is_admin === false && profile.data.center_id === null,
        'QA account profile is not an isolated non-admin profile.', profile.error);
    });

    let tokenHash;
    await test('generate a recovery link without sending email or changing the password', async () => {
      const generated = await admin.auth.admin.generateLink({ type: 'recovery', email });
      check(!generated.error && generated.data?.user?.id === userId && owned(generated.data.user),
        'Recovery link generation failed or targeted an unexpected user.', generated.error);
      tokenHash = generated.data.properties?.hashed_token;
      check(typeof tokenHash === 'string' && /^(?:pkce_)?[a-f0-9]{40,128}$/i.test(tokenHash),
        'Recovery link did not return a supported token hash.');
      // Never print or navigate to action_link, hashed_token, or email_otp.
      await requirePassword(oldPassword);
    });

    await test('verify recovery on a fresh client without an initiating browser session', async () => {
      const verified = await recovery.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
      check(!verified.error && verified.data?.user?.id === userId && verified.data?.session,
        'Recovery verification did not establish the intended QA session.', verified.error);
      const current = await recovery.auth.getUser();
      check(!current.error && current.data?.user?.id === userId,
        'Recovery session could not verify its QA user.', current.error);
    });

    await test('change the password through the recovered user session', async () => {
      const updated = await recovery.auth.updateUser({ password: newPassword });
      check(!updated.error && updated.data?.user?.id === userId,
        'Recovered-session password change failed.', updated.error);
    });

    await test('reject the old password and accept the new exact password', async () => {
      const rejected = await client(publicKey).auth.signInWithPassword({ email, password: oldPassword });
      check(rejected.error?.code === 'invalid_credentials' && !rejected.data?.user && !rejected.data?.session,
        'Old password was not rejected with invalid credentials.', rejected.error);
      await requirePassword(newPassword);
    });

    await test('reject reuse of the consumed recovery token', async () => {
      const reused = await client(publicKey).auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
      check(reused.error?.code === 'otp_expired' && !reused.data?.user && !reused.data?.session,
        'Consumed recovery token was not rejected as expired or invalid.', reused.error);
    });
  } catch (error) {
    failed = true;
    console.error(`FAIL ${stage}: ${interrupted.signal.aborted ? 'Run interrupted.' : safeFailure(error)}`);
  } finally {
    cleaningUp = true;
    for (const id of cleanupIds) {
      try {
        const lookup = await admin.auth.admin.getUserById(id);
        if (lookup.error?.code === 'user_not_found' && !lookup.data?.user) {
          console.log(`CLEANUP absent user=${id}`);
          continue;
        }
        check(!lookup.error && lookup.data?.user?.id === id && owned(lookup.data.user),
          'QA ownership marker did not match; refusing deletion.', lookup.error);
        const deleted = await admin.auth.admin.deleteUser(id, false);
        check(!deleted.error, 'QA account deletion failed.', deleted.error);
        const verify = await admin.auth.admin.getUserById(id);
        check(verify.error?.code === 'user_not_found' && !verify.data?.user,
          'QA account deletion could not be confirmed.', verify.error);
        const profile = await admin.from('profiles').select('id').eq('id', id).maybeSingle();
        check(!profile.error && !profile.data, 'QA profile cleanup could not be confirmed.', profile.error);
        console.log(`CLEANUP deleted and verified user=${id}`);
      } catch (error) {
        cleanupFailed = true;
        console.error(`CLEANUP FAILED user=${id} run=${runId}: ${safeFailure(error)}`);
      }
    }
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  console.log(`RESULT ${passed}/6 checks passed; cleanup=${cleanupFailed ? 'FAILED; manual review required' : 'verified'}.`);
  if (failed || cleanupFailed || interrupted.signal.aborted) process.exitCode = 1;
}

try { await run(); }
catch (error) {
  console.error(`FAIL before QA execution: ${safeFailure(error)}`);
  process.exitCode = 1;
}
