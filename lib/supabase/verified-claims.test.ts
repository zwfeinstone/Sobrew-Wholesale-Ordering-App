import { createClient, AuthInvalidJwtError } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import bundledSigningKeys from './bundled-jwks.json';
import {
  getVerifiedClaims,
  SUPABASE_AUTH_JWKS,
  SUPABASE_AUTH_JWKS_PROJECT_ORIGIN,
} from './verified-claims';
import { createResilientJwksFetch } from './resilient-jwks-fetch';

function base64Url(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function signingFixture() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const jwk = {
    ...exported,
    alg: 'ES256' as const,
    crv: 'P-256',
    key_ops: ['verify'],
    kid: 'test-signing-key',
    kty: 'EC' as const,
    use: 'sig',
    x: exported.x!,
    y: exported.y!,
  };

  const token = async (overrides: Record<string, unknown> = {}, privateKey = pair.privateKey) => {
    const now = Math.floor(Date.now() / 1_000);
    const encodedHeader = base64Url(JSON.stringify({ alg: 'ES256', kid: jwk.kid, typ: 'JWT' }));
    const encodedPayload = base64Url(JSON.stringify({
      aud: 'authenticated',
      exp: now + 3_600,
      iat: now,
      iss: `${SUPABASE_AUTH_JWKS_PROJECT_ORIGIN}/auth/v1`,
      role: 'authenticated',
      sub: '00000000-0000-4000-8000-000000000001',
      ...overrides,
    }));
    const unsigned = `${encodedHeader}.${encodedPayload}`;
    const signature = new Uint8Array(await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      new TextEncoder().encode(unsigned)
    ));
    return `${unsigned}.${base64Url(signature)}`;
  };

  return { jwks: { keys: [jwk] }, pair, token };
}

describe('bundled Supabase signing keys', () => {
  it('contains only unique public verification keys for the configured project', () => {
    expect(SUPABASE_AUTH_JWKS_PROJECT_ORIGIN).toBe('https://ovrzooxvvernqqcotpkv.supabase.co');
    expect(bundledSigningKeys.projectOrigin).toBe('https://ovrzooxvvernqqcotpkv.supabase.co');
    expect(Number.isNaN(Date.parse(bundledSigningKeys.capturedAt))).toBe(false);
    expect(bundledSigningKeys.jwks.keys.length).toBeGreaterThan(0);

    const kids = bundledSigningKeys.jwks.keys.map((key) => key.kid);
    expect(new Set(kids).size).toBe(kids.length);
    bundledSigningKeys.jwks.keys.forEach((key) => {
      expect(['ES256', 'RS256']).toContain(key.alg);
      expect(key.key_ops).toContain('verify');
      expect(key.use).toBe('sig');
      expect(key).not.toHaveProperty('d');
      expect(key).not.toHaveProperty('p');
      expect(key).not.toHaveProperty('q');
      expect(key).not.toHaveProperty('k');
    });
  });
});

describe('verified Supabase claims', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the bundled JWKS in the SDK call and validates authenticated claims', async () => {
    const getClaims = vi.fn().mockResolvedValue({
      data: {
        claims: {
          aud: 'authenticated',
          iss: `${SUPABASE_AUTH_JWKS_PROJECT_ORIGIN}/auth/v1`,
          role: 'authenticated',
          sub: 'user-123',
        },
      },
      error: null,
    });

    const result = await getVerifiedClaims({ getClaims } as never, SUPABASE_AUTH_JWKS_PROJECT_ORIGIN);

    expect(result.error).toBeNull();
    expect(getClaims).toHaveBeenCalledWith(undefined, { jwks: SUPABASE_AUTH_JWKS });
  });

  it('cryptographically verifies a valid ES256 token without any network request', async () => {
    const { jwks, token } = await signingFixture();
    const networkFetch = vi.fn(() => Promise.reject(new Error('network must not be used')));
    const client = createClient(SUPABASE_AUTH_JWKS_PROJECT_ORIGIN, 'test-anon-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { fetch: networkFetch },
    });

    const result = await client.auth.getClaims(await token(), { jwks });

    expect(result.error).toBeNull();
    expect(result.data?.claims.sub).toBe('00000000-0000-4000-8000-000000000001');
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it('loads a real SSR cookie session and verifies it locally without a JWKS request', async () => {
    const { jwks, token } = await signingFixture();
    const accessToken = await token();
    const networkFetch = vi.fn(() => Promise.reject(new Error('network must not be used')));
    const session = {
      access_token: accessToken,
      expires_at: Math.floor(Date.now() / 1_000) + 3_600,
      expires_in: 3_600,
      refresh_token: 'test-refresh-token',
      token_type: 'bearer',
      user: {
        app_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
        id: '00000000-0000-4000-8000-000000000001',
        user_metadata: {},
      },
    };
    const cookieValue = `base64-${base64Url(JSON.stringify(session))}`;
    const client = createServerClient(SUPABASE_AUTH_JWKS_PROJECT_ORIGIN, 'test-anon-key', {
      global: { fetch: networkFetch },
      cookies: {
        getAll: () => [{
          name: 'sb-ovrzooxvvernqqcotpkv-auth-token',
          value: cookieValue,
        }],
        setAll: vi.fn(),
      },
    });

    const result = await client.auth.getClaims(undefined, { jwks });

    expect(result.error).toBeNull();
    expect(result.data?.claims.sub).toBe('00000000-0000-4000-8000-000000000001');
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature locally without falling back to the network', async () => {
    const trusted = await signingFixture();
    const untrusted = await signingFixture();
    const networkFetch = vi.fn(() => Promise.reject(new Error('network must not be used')));
    const client = createClient(SUPABASE_AUTH_JWKS_PROJECT_ORIGIN, 'test-anon-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { fetch: networkFetch },
    });

    const result = await client.auth.getClaims(
      await trusted.token({}, untrusted.pair.privateKey),
      { jwks: trusted.jwks }
    );

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(AuthInvalidJwtError);
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it('coalesces real SDK discovery for a rotated key and then verifies every signature', async () => {
    const { jwks, token } = await signingFixture();
    const rotatedToken = await token();
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(jwks), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    }));
    const client = createClient('https://rotation-test.supabase.co', 'test-anon-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { fetch: createResilientJwksFetch({ fetch: upstreamFetch }) },
    });

    const results = await Promise.all(
      Array.from({ length: 25 }, () => client.auth.getClaims(rotatedToken, { jwks: { keys: [] } }))
    );

    expect(results.every((result) => result.error === null && result.data?.claims.sub)).toBe(true);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it('classifies auth-js expiration errors as invalid sessions instead of outages', async () => {
    const getClaims = vi.fn().mockRejectedValue(new Error('JWT has expired'));

    const result = await getVerifiedClaims({ getClaims } as never, SUPABASE_AUTH_JWKS_PROJECT_ORIGIN);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(AuthInvalidJwtError);
  });

  it('rejects a signed token whose issuer or audience is for another trust boundary', async () => {
    const baseClaims = {
      role: 'authenticated',
      sub: 'user-123',
    };
    const wrongIssuer = vi.fn().mockResolvedValue({
      data: { claims: { ...baseClaims, aud: 'authenticated', iss: 'https://attacker.example/auth/v1' } },
      error: null,
    });
    const wrongAudience = vi.fn().mockResolvedValue({
      data: {
        claims: {
          ...baseClaims,
          aud: 'anon',
          iss: `${SUPABASE_AUTH_JWKS_PROJECT_ORIGIN}/auth/v1`,
        },
      },
      error: null,
    });

    const issuerResult = await getVerifiedClaims({ getClaims: wrongIssuer } as never, SUPABASE_AUTH_JWKS_PROJECT_ORIGIN);
    const audienceResult = await getVerifiedClaims({ getClaims: wrongAudience } as never, SUPABASE_AUTH_JWKS_PROJECT_ORIGIN);

    expect(issuerResult.error).toBeInstanceOf(AuthInvalidJwtError);
    expect(audienceResult.error).toBeInstanceOf(AuthInvalidJwtError);
  });
});
