// Opt-in LIVE Auth QA. Creates one disposable Auth user (and its trigger-created
// profile), sends no welcome/invite email, and creates no center or business data.
// Usage: node scripts/test-customer-auth-lifecycle.mjs --project-ref <project-ref>
// Load nvm first. This intentionally does not run through npm test or CI.
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

const usage = 'Usage: node scripts/test-customer-auth-lifecycle.mjs --project-ref <project-ref>';
const safeErrorCodes = new Set([
  'email_exists', 'user_already_exists', 'user_not_found', 'invalid_credentials',
  'weak_password', 'same_password', 'reauthentication_needed', 'reauthentication_not_valid',
  'over_request_rate_limit', 'over_email_send_rate_limit', 'request_timeout',
  'session_not_found', 'refresh_token_not_found', 'refresh_token_already_used',
  'unexpected_failure', 'validation_failed', 'email_address_invalid',
  'PGRST116', '42501', '23503', '23505',
]);

class QaFailure extends Error {
  constructor(label, error) {
    super(label);
    // Never retain/print API error messages, response bodies, or assertions with
    // actual/expected values: those may include credentials or session tokens.
    this.code = safeErrorCodes.has(error?.code) ? error.code : undefined;
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

  let envLoadFailed = false;
  nextEnv.loadEnvConfig(fileURLToPath(new URL('..', import.meta.url)), false, {
    info() {},
    error() { envLoadFailed = true; },
  });
  check(!envLoadFailed, 'Local environment could not be loaded safely.');

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  check(Boolean(rawUrl && serviceKey && publicKey), 'Required Supabase environment variables are missing.');
  let projectUrl;
  try { projectUrl = new URL(rawUrl); } catch { throw new QaFailure('Configured Supabase URL is invalid.'); }
  check(
    projectUrl.protocol === 'https:' && projectUrl.hostname === `${args[1]}.supabase.co`
      && !projectUrl.username && !projectUrl.password && !projectUrl.port
      && !projectUrl.search && !projectUrl.hash && projectUrl.pathname === '/',
    'The explicit project reference must exactly match the configured hosted Supabase URL.',
  );

  const runId = randomUUID();
  const userId = randomUUID();
  const duplicateAttemptId = randomUUID();
  const email = `auth-qa-${runId}@example.invalid`;
  const marker = { qa_run_id: runId, qa_purpose: 'customer-auth-lifecycle' };
  // Under bcrypt's 72-byte limit, with random entropy, surrounding/repeated
  // spaces, punctuation requiring HTML escaping, and a non-ASCII character.
  const password = () => `  Qa9!<&>"'☃ ${randomBytes(16).toString('hex')}  Two  `;
  const initialPassword = password();
  const duplicatePassword = password();
  const adminResetPassword = password();
  const customerPassword = password();
  const cleanupCandidates = new Set();
  const interrupted = new AbortController();
  let cleaningUp = false;
  let stage = 'initialization';
  let passed = 0;
  let cleanupFailed = false;
  let testFailed = false;

  function onSignal() {
    if (!interrupted.signal.aborted) interrupted.abort();
  }
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  async function boundedFetch(input, init) {
    const requestUrl = new URL(input instanceof Request ? input.url : String(input));
    check(requestUrl.origin === projectUrl.origin, 'Refusing a request outside the confirmed Supabase project.');
    const signals = [AbortSignal.timeout(20_000)];
    if (init?.signal) signals.push(init.signal);
    if (!cleaningUp) signals.push(interrupted.signal);
    return fetch(input, { ...init, credentials: 'omit', redirect: 'error', signal: AbortSignal.any(signals) });
  }

  function client(key) {
    return createClient(projectUrl.origin, key, {
      global: { fetch: boundedFetch },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
        storageKey: `auth-qa-${randomUUID()}`,
        debug: false,
      },
    });
  }
  const admin = client(serviceKey);

  async function test(label, action) {
    check(!interrupted.signal.aborted, 'Run interrupted.');
    stage = label;
    await action();
    passed += 1;
    console.log(`PASS ${label}`);
  }

  async function requireUnusedId(id) {
    const result = await admin.auth.admin.getUserById(id);
    check(result.error?.code === 'user_not_found' && !result.data?.user,
      'Could not confirm the random QA user ID is unused; refusing creation.', result.error);
  }

  function rememberReturnedQaUser(result) {
    const user = result.data?.user;
    if (user?.email === email && user.app_metadata?.qa_run_id === runId
      && user.app_metadata?.qa_purpose === marker.qa_purpose && typeof user.id === 'string') {
      // Defend against an unexpected server-generated ID despite an explicit
      // creation ID. This is still restricted to an account created by this run.
      cleanupCandidates.add(user.id);
    }
  }

  async function signInWithExactPassword(value) {
    const customer = client(publicKey);
    const result = await customer.auth.signInWithPassword({ email, password: value });
    check(!result.error && result.data?.user?.id === userId && Boolean(result.data?.session),
      'Expected QA password did not authenticate the QA user.', result.error);
    return customer;
  }

  async function requireRejectedPassword(value) {
    const result = await client(publicKey).auth.signInWithPassword({ email, password: value });
    check(result.error?.code === 'invalid_credentials' && !result.data?.user && !result.data?.session,
      'Expected an invalid-credentials rejection; a different failure is not a passing test.', result.error);
  }

  async function requireRefresh(customer) {
    const result = await customer.auth.refreshSession();
    check(!result.error && result.data?.user?.id === userId && Boolean(result.data?.session),
      'QA session could not refresh.', result.error);
  }

  console.log(`LIVE Auth QA: project=${args[1]} run=${runId} user=${userId}`);
  try {
    await test('create an isolated confirmed QA login', async () => {
      await requireUnusedId(userId);
      // Record a known random ID before the request so cleanup can safely locate
      // our account even if creation succeeds but its response is interrupted.
      cleanupCandidates.add(userId);
      const result = await admin.auth.admin.createUser({
        id: userId, email, password: initialPassword, email_confirm: true, app_metadata: marker,
      });
      rememberReturnedQaUser(result);
      check(!result.error && result.data?.user?.id === userId && result.data.user.email === email,
        'QA account creation failed or returned an unexpected identity.', result.error);
    });

    let customer;
    await test('initial password signs in exactly, including spaces and special characters', async () => {
      customer = await signInWithExactPassword(initialPassword);
      await requireRejectedPassword(initialPassword.trim());
    });

    await test('duplicate account creation cannot overwrite the existing password', async () => {
      await requireUnusedId(duplicateAttemptId);
      // A second ID makes this an email-uniqueness check, matching the app's
      // duplicate-email case. Normally no second user is created. If Auth ever
      // regresses, finally cleans only accounts bearing this run's exact marker.
      cleanupCandidates.add(duplicateAttemptId);
      const result = await admin.auth.admin.createUser({
        id: duplicateAttemptId, email, password: duplicatePassword, email_confirm: true, app_metadata: marker,
      });
      rememberReturnedQaUser(result);
      check(['email_exists', 'user_already_exists'].includes(result.error?.code) && !result.data?.user,
        'Duplicate QA email was not rejected as an existing account.', result.error);
      customer = await signInWithExactPassword(initialPassword);
      await requireRejectedPassword(duplicatePassword);
    });

    await test('saving the QA profile name preserves the password', async () => {
      const result = await admin.from('profiles').update({ full_name: 'Disposable Auth QA user' })
        .eq('id', userId).eq('email', email).eq('is_admin', false).select('id').maybeSingle();
      check(!result.error && result.data?.id === userId, 'The QA profile name could not be saved.', result.error);
      customer = await signInWithExactPassword(initialPassword);
    });

    await test('admin Auth metadata save preserves the password', async () => {
      const result = await admin.auth.admin.updateUserById(userId, { user_metadata: { qa_name: 'Admin metadata check' } });
      check(!result.error && result.data?.user?.id === userId, 'Admin metadata save failed.', result.error);
      customer = await signInWithExactPassword(initialPassword);
    });

    await test('customer Auth metadata save preserves the password', async () => {
      const result = await customer.auth.updateUser({ data: { qa_name: 'Customer metadata check' } });
      check(!result.error && result.data?.user?.id === userId, 'Customer metadata save failed.', result.error);
      customer = await signInWithExactPassword(initialPassword);
    });

    await test('session refresh preserves the password', async () => {
      await requireRefresh(customer);
      customer = await signInWithExactPassword(initialPassword);
    });

    await test('admin reset accepts only the new exact password', async () => {
      const result = await admin.auth.admin.updateUserById(userId, { password: adminResetPassword });
      check(!result.error && result.data?.user?.id === userId, 'Admin password reset failed.', result.error);
      customer = await signInWithExactPassword(adminResetPassword);
      await requireRejectedPassword(initialPassword);
      await requireRejectedPassword(adminResetPassword.trim());
    });

    await test('customer self-service change accepts only the new exact password', async () => {
      const result = await customer.auth.updateUser({ password: customerPassword, current_password: adminResetPassword });
      check(!result.error && result.data?.user?.id === userId, 'Customer password change failed.', result.error);
      customer = await signInWithExactPassword(customerPassword);
      await requireRejectedPassword(adminResetPassword);
      await requireRejectedPassword(customerPassword.trim());
    });

    await test('refresh after the customer change does not restore an old password', async () => {
      await requireRefresh(customer);
      customer = await signInWithExactPassword(customerPassword);
      await requireRejectedPassword(initialPassword);
    });
  } catch (error) {
    testFailed = true;
    console.error(`FAIL ${stage}: ${interrupted.signal.aborted ? 'Run interrupted.' : safeFailure(error)}`);
  } finally {
    cleaningUp = true;
    for (const id of cleanupCandidates) {
      try {
        const lookup = await admin.auth.admin.getUserById(id);
        if (lookup.error?.code === 'user_not_found' && !lookup.data?.user) {
          console.log(`CLEANUP absent user=${id}`);
          continue;
        }
        check(!lookup.error && lookup.data?.user, 'Cannot verify QA user ownership for cleanup.', lookup.error);
        const user = lookup.data.user;
        check(user.id === id && user.email === email && user.app_metadata?.qa_run_id === runId
          && user.app_metadata?.qa_purpose === marker.qa_purpose,
        'QA ownership marker did not match; refusing deletion.');
        const removed = await admin.auth.admin.deleteUser(id, false);
        check(!removed.error, 'QA account deletion failed.', removed.error);
        const verify = await admin.auth.admin.getUserById(id);
        check(verify.error?.code === 'user_not_found' && !verify.data?.user,
          'QA account deletion could not be confirmed.', verify.error);
        const profile = await admin.from('profiles').select('id').eq('id', id).maybeSingle();
        check(!profile.error && !profile.data, 'The QA profile cleanup could not be confirmed.', profile.error);
        console.log(`CLEANUP deleted and verified user=${id}`);
      } catch (error) {
        cleanupFailed = true;
        console.error(`CLEANUP FAILED user=${id} run=${runId}: ${safeFailure(error)}`);
      }
    }
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  console.log(`RESULT ${passed}/10 checks passed; cleanup=${cleanupFailed ? 'FAILED; manual review required' : 'verified'}.`);
  if (testFailed || cleanupFailed || interrupted.signal.aborted) process.exitCode = 1;
}

try {
  await run();
} catch (error) {
  console.error(`FAIL before QA execution: ${safeFailure(error)}`);
  process.exitCode = 1;
}
