import { AuthInvalidJwtError, type SupabaseClient } from '@supabase/supabase-js';
import bundledSigningKeys from './bundled-jwks.json';

type ClaimsAuthClient = Pick<SupabaseClient['auth'], 'getClaims'>;
type GetClaimsOptions = NonNullable<Parameters<ClaimsAuthClient['getClaims']>[1]>;
type JsonWebKeySet = NonNullable<GetClaimsOptions['jwks']>;

const EMPTY_JWKS: JsonWebKeySet = { keys: [] };
const EXPECTED_SOBREW_SUPABASE_ORIGIN = 'https://ovrzooxvvernqqcotpkv.supabase.co';
const SNAPSHOT_REVIEW_AFTER_MS = 30 * 24 * 60 * 60 * 1_000;

if (bundledSigningKeys.projectOrigin !== EXPECTED_SOBREW_SUPABASE_ORIGIN) {
  throw new Error('Bundled Supabase JWKS belongs to an unexpected project');
}
if (Number.isNaN(Date.parse(bundledSigningKeys.capturedAt))) {
  throw new Error('Bundled Supabase JWKS has an invalid capture timestamp');
}

export const SUPABASE_AUTH_JWKS = bundledSigningKeys.jwks as JsonWebKeySet;
export const SUPABASE_AUTH_JWKS_CAPTURED_AT = bundledSigningKeys.capturedAt;
export const SUPABASE_AUTH_JWKS_PROJECT_ORIGIN = EXPECTED_SOBREW_SUPABASE_ORIGIN;

let snapshotAgeWarningLogged = false;
const mismatchedOriginsLogged = new Set<string>();

function normalizedOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function expectedIssuer(supabaseUrl: string) {
  try {
    return new URL('/auth/v1', supabaseUrl).toString();
  } catch {
    return null;
  }
}

function invalidJwt(message: string) {
  return { data: null, error: new AuthInvalidJwtError(message) } as const;
}

function validateAuthenticatedClaims(claims: Record<string, unknown>, supabaseUrl: string) {
  const issuer = expectedIssuer(supabaseUrl);
  if (!issuer || claims.iss !== issuer) return 'JWT issuer does not match this Supabase project';

  const audience = claims.aud;
  const hasAuthenticatedAudience =
    audience === 'authenticated' ||
    (Array.isArray(audience) && audience.includes('authenticated'));
  if (!hasAuthenticatedAudience) return 'JWT audience is not authenticated';
  if (claims.role !== 'authenticated') return 'JWT role is not authenticated';
  if (typeof claims.sub !== 'string' || !claims.sub) return 'JWT subject is missing';

  const now = Math.floor(Date.now() / 1_000);
  if (typeof claims.nbf === 'number' && claims.nbf > now) return 'JWT is not active yet';
  return null;
}

function isLocalJwtValidationFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === 'SyntaxError' || error.name === 'DataError') return true;
  return (
    error.message === 'JWT has expired' ||
    error.message === 'Missing exp claim' ||
    error.message === 'Invalid alg claim'
  );
}

/**
 * Verifies the request session with Supabase Auth while supplying SoBrew's
 * public signing keys. For the normal ES256 path this is local WebCrypto: no
 * Auth or JWKS request is needed. The SDK still owns session refresh, token
 * parsing, signature verification, and unknown-key recovery.
 */
export async function getVerifiedClaims(auth: ClaimsAuthClient, supabaseUrl: string) {
  const origin = normalizedOrigin(supabaseUrl);
  if (!snapshotAgeWarningLogged && Date.now() - Date.parse(SUPABASE_AUTH_JWKS_CAPTURED_AT) > SNAPSHOT_REVIEW_AFTER_MS) {
    snapshotAgeWarningLogged = true;
    console.warn('Bundled Supabase JWKS needs a drift review', {
      event: 'supabase_jwks_snapshot_review_due',
      capturedAt: SUPABASE_AUTH_JWKS_CAPTURED_AT,
    });
  }
  if (origin && origin !== SUPABASE_AUTH_JWKS_PROJECT_ORIGIN && !mismatchedOriginsLogged.has(origin)) {
    mismatchedOriginsLogged.add(origin);
    console.warn('Bundled Supabase JWKS does not match the configured project', {
      event: 'supabase_jwks_project_mismatch',
      configuredOrigin: origin,
    });
  }

  const jwks = origin === SUPABASE_AUTH_JWKS_PROJECT_ORIGIN
    ? SUPABASE_AUTH_JWKS
    : EMPTY_JWKS;

  try {
    const result = await auth.getClaims(undefined, { jwks });
    if (!result.data || result.error) return result;

    const claimsError = validateAuthenticatedClaims(result.data.claims, supabaseUrl);
    return claimsError ? invalidJwt(claimsError) : result;
  } catch (error) {
    // auth-js 2.98 throws plain Errors for a few local JWT validation failures,
    // notably expiration. Those are invalid sessions, not provider outages.
    if (isLocalJwtValidationFailure(error)) {
      return invalidJwt('JWT validation failed');
    }
    throw error;
  }
}
