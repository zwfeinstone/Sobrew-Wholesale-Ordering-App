# Supabase auth signing keys

SoBrew supplies Supabase's public asymmetric signing keys directly to `auth.getClaims`. A valid session signed by a bundled key is verified with local Web Crypto and does not depend on the Supabase JWKS endpoint. Unknown key IDs still use Supabase's secure discovery flow through a two-second, single-flight refresh with a 30-second failure cooldown.

The bundled file contains public verification material only: `lib/supabase/bundled-jwks.json`. Public keys cannot sign tokens and are safe to commit. Never add a private JWK field or the legacy JWT secret.

## Routine drift check

Run this before every signing-key change and as a regular operational check:

```bash
npm run auth:jwks:check
```

The command compares the complete canonical public keys—not only key IDs—and also fails once the checked-in review timestamp is 30 days old. To refresh or reconfirm the public snapshot timestamp:

```bash
npm run auth:jwks:update
npm run check
npm run build
```

Review the key-only diff and deploy it before changing which key Supabase uses to sign new access tokens.

The `Supabase JWKS drift` GitHub Actions workflow runs the same public comparison daily and fails if any key material, algorithm, or key ID changes. A workflow failure is an operational alert to refresh, test, and deploy the snapshot.

## Zero-downtime rotation

1. Create the standby asymmetric key in Supabase.
2. Wait at least 20 minutes for Supabase's discovery caches.
3. Run `npm run auth:jwks:update`, review the public keys, test, and deploy.
4. Rotate the standby key into use.
5. Wait the configured access-token lifetime plus 15 minutes before revoking the previous key.
6. Revoke the previous key, immediately refresh the snapshot again, test, and deploy so application verification no longer trusts it.

For an emergency revocation, revoke in Supabase and immediately deploy a snapshot that excludes the compromised key. Supabase products enforce revocation independently, but the application intentionally trusts its bundled public set until a deployment removes a key.

## Monitoring

Alert on these structured events:

- `middleware_auth_unavailable`: protected auth did not complete; inspect `phase`, `reason`, and the support reference.
- `supabase_jwks_refresh_unavailable`: an exceptional unknown-key refresh failed or returned invalid key data.
- `supabase_jwks_refresh_succeeded`: a runtime encountered a key outside the bundled snapshot and successfully refreshed. Treat this as a drift alert and update/deploy the bundle.
- `supabase_jwks_snapshot_review_due`: the checked-in snapshot has not been refreshed for 30 days.
- `supabase_jwks_project_mismatch`: the runtime Supabase origin differs from SoBrew's pinned production project, so the bundle was deliberately not trusted.

A normal protected request signed by a bundled key emits neither event and makes no JWKS network request.
