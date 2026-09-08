# Sobrew Wholesale Ordering Portal

Wholesale ordering portal built with Next.js 15 App Router, React 19, TypeScript, Tailwind CSS, Supabase, and Resend. The project uses Node.js 24 through nvm; `.nvmrc` pins the development and CI runtime.

## Features

- Customer auth (email/password)
- Customer-specific product visibility and pricing
- Cart, checkout, reordering, recurring orders, order history, and order detail
- Admin dashboard with left nav:
  - Orders management (status workflow + CSV export)
  - User management with create/assign/price wizard
  - Product management (CRUD + image upload)
  - Branding settings (logo/hero/accent)
- Bootstrap-first-admin flow at `/bootstrap` using `ADMIN_BOOTSTRAP_TOKEN`
- Server-side order email notifications via Resend
- Inventory and production planning, prospecting, accounting, payroll, reporting, and QuickBooks invoicing

## Environment

Copy `.env.example` to `.env.local` and configure:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `NEXT_PUBLIC_SITE_URL`
- `ADMIN_BOOTSTRAP_TOKEN`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (default `hello@sobrew.com`)
- `SOBREW_ADMIN_EMAIL` (default `hello@sobrew.com`)

## Supabase setup

1. Create a new Supabase project.
2. Apply SQL migrations under `db/migrations` in order.
3. Create storage buckets and set them public:
   - `branding`
   - `products`
   - `avatars`
4. Start app and create the first admin from `/bootstrap`.

Migration `048_quick_restock_performance.sql` must be applied before deploying the matching checkout/recurring-order code. It adds the server-priced atomic checkout and recurring-generation functions used by the app. Test database changes in an approved non-production environment before applying them to production.

### Database types

Application clients use `lib/supabase/schema.ts`, which extends the generated `lib/supabase/database.types.ts`. After an approved database schema change, regenerate the types using an installed, authenticated Supabase CLI with access to the project configured in `scripts/generate-database-types.mjs`:

```bash
npm run db:types
npm run typecheck
```

Run these commands after loading nvm as shown below. The generator reads the configured project's `public` schema and replaces the generated file only after a successful CLI response. It does not apply migrations. Keep manual adjustments in `schema.ts`; its current overlay records nullable RPC arguments and the pending recovery/catalog migration `db/migrations/20260908184205_recoverable_orders_and_catalog_pricing.sql`. Those declarations do not establish that the migration is deployed.

## Running locally

Load the project's Node version before running npm commands:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use
```

Install dependencies when they are missing or `package.json` / `package-lock.json` changed:

```bash
npm install
```

When you need to run the app, reuse an existing development server or start one:

```bash
npm run dev
```

## Verification

```bash
npm run check
npm run build
npm run test:e2e
```

`npm run check` runs TypeScript, ESLint, and Vitest. `npm run lint` invokes ESLint directly over `app`, `components`, and `lib`, with warnings treated as failures. CI runs `npm ci`, `npm run check`, and `npm run build` for pull requests and pushes to `main`, with live Supabase tests disabled. The workflow uses `.nvmrc` and placeholder database credentials for its build.

The Playwright suite checks the public login at 320, 390, 768, and 1440 pixels. Authenticated scenarios require the `E2E_*` credentials described in `tests/e2e/authenticated-flows.spec.ts`. Set `PLAYWRIGHT_BASE_URL` to test an already-running server; otherwise Playwright reuses an existing local server outside CI or starts one.

Protected sessions are verified locally with a bundled copy of Supabase's public signing keys, so normal admin and portal requests do not depend on JWKS network availability. Run `npm run auth:jwks:check` as a regular drift check and before any signing-key rotation. Follow [AUTH_SIGNING_KEYS.md](./AUTH_SIGNING_KEYS.md) for the zero-downtime update and emergency-revocation procedure.

## Deployment performance

- Vercel functions are configured for `pdx1` in `vercel.json` to align with the Oregon Supabase region.
- Vercel Speed Insights and privacy-safe server timings cover authenticated context, checkout, reports, and recurring cron work.
- Re-run Supabase security and performance advisors after migration 048 is applied.

## Running recurring orders locally

Recurring orders only generate when the cron endpoint is called.

1. Set `CRON_SECRET` in `.env.local`.
2. Start the app with `npm run dev`.
3. In a second terminal, run:

```bash
npm run cron:recurring
```

That script sends a `POST` request to `NEXT_PUBLIC_SITE_URL` (default `http://localhost:3000`) with the required `x-cron-secret` header.

## Bootstrap first admin (no dashboard day-to-day)

Visit `/bootstrap` and submit email/password/token. If token matches `ADMIN_BOOTSTRAP_TOKEN` and bootstrap not completed, app creates/elevates the admin profile and locks bootstrap afterward.

## Resend setup

- Set `RESEND_API_KEY`.
- Orders send:
  - admin notification to `hello@sobrew.com`
  - customer confirmation to ordering customer
- Optional shipped email is sent when order status becomes `Shipped`.

## Seed data

`db/migrations/002_seed.sql` adds two example products and includes assignment snippets for a sample user.

## Money format

All money in database is stored as integer cents. UI formats values as USD.

The [September 8 optimization implementation note](docs/optimization-2026-09-08.md) describes the code cleanup, data-loading changes, and retained workflows.
