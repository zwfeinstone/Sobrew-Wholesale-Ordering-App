import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const snapshotUrl = new URL('../lib/supabase/bundled-jwks.json', import.meta.url);
const snapshotPath = fileURLToPath(snapshotUrl);
const temporaryPath = `${snapshotPath}.${process.pid}.tmp`;
const shouldWrite = process.argv.includes('--write');
const privateFields = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];
const snapshotReviewAfterMs = 30 * 24 * 60 * 60 * 1_000;

async function validPublicJwks(value) {
  if (!value || !Array.isArray(value.keys) || value.keys.length === 0 || value.keys.length > 10) return false;

  const kids = new Set();
  for (const key of value.keys) {
    if (!key || typeof key !== 'object') return false;
    if (key.alg !== 'ES256' && key.alg !== 'RS256') return false;
    if (key.kty !== 'EC' && key.kty !== 'RSA') return false;
    if ((key.alg === 'ES256') !== (key.kty === 'EC')) return false;
    if (typeof key.kid !== 'string' || !key.kid || kids.has(key.kid)) return false;
    if (!Array.isArray(key.key_ops) || !key.key_ops.includes('verify')) return false;
    if (key.use !== undefined && key.use !== 'sig') return false;
    if (key.kty === 'EC' && (key.crv !== 'P-256' || typeof key.x !== 'string' || typeof key.y !== 'string')) return false;
    if (key.kty === 'RSA' && (typeof key.n !== 'string' || typeof key.e !== 'string')) return false;
    if (privateFields.some((field) => field in key)) return false;

    const algorithm = key.alg === 'ES256'
      ? { name: 'ECDSA', namedCurve: 'P-256' }
      : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    await crypto.subtle.importKey('jwk', key, algorithm, false, ['verify']);
    kids.add(key.kid);
  }
  return true;
}

function canonicalJwks(value) {
  const canonicalKeys = value.keys
    .map((key) => Object.fromEntries(
      Object.entries(key)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, fieldValue]) => [name, Array.isArray(fieldValue) ? [...fieldValue].sort() : fieldValue])
    ))
    .sort((left, right) => left.kid.localeCompare(right.kid));
  return JSON.stringify({ keys: canonicalKeys });
}

const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8'));
const endpoint = new URL('/auth/v1/.well-known/jwks.json', snapshot.projectOrigin);
const response = await fetch(endpoint, {
  headers: { Accept: 'application/json' },
  signal: AbortSignal.timeout(10_000),
});

if (!response.ok) {
  throw new Error(`Supabase JWKS request failed with HTTP ${response.status}`);
}

const liveJwks = await response.json();
if (!await validPublicJwks(liveJwks)) {
  throw new Error('Supabase returned an invalid or non-public JWKS document');
}

const bundledKids = snapshot.jwks.keys.map((key) => key.kid).sort();
const liveKids = liveJwks.keys.map((key) => key.kid).sort();
const matches = canonicalJwks(snapshot.jwks) === canonicalJwks(liveJwks);
const reviewOverdue =
  Number.isNaN(Date.parse(snapshot.capturedAt)) ||
  Date.now() - Date.parse(snapshot.capturedAt) > snapshotReviewAfterMs;

if (matches && !reviewOverdue && !shouldWrite) {
  console.log(`Bundled Supabase JWKS is current (${liveKids.length} public verification key${liveKids.length === 1 ? '' : 's'}).`);
  process.exit(0);
}

if (!shouldWrite) {
  console.error(reviewOverdue
    ? 'Bundled Supabase JWKS review timestamp is more than 30 days old.'
    : 'Bundled Supabase JWKS differs from the live trusted key set.');
  console.error(`Bundled key IDs: ${bundledKids.join(', ') || '(none)'}`);
  console.error(`Live key IDs: ${liveKids.join(', ')}`);
  console.error('Run npm run auth:jwks:update, review the diff, test, and deploy before rotating keys.');
  process.exit(1);
}

const updatedSnapshot = {
  projectOrigin: snapshot.projectOrigin,
  capturedAt: new Date().toISOString(),
  jwks: liveJwks,
};
await writeFile(temporaryPath, `${JSON.stringify(updatedSnapshot, null, 2)}\n`, { flag: 'wx' });
await rename(temporaryPath, snapshotPath);
console.log(`${matches ? 'Reconfirmed' : 'Updated'} bundled Supabase JWKS with ${liveKids.length} public verification key${liveKids.length === 1 ? '' : 's'}.`);
