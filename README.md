# Sobrew Wholesale Ordering Portal

Production-ready wholesale ordering portal built with Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase, and Resend.

## Features
- Customer auth (email/password)
- Per-user product visibility and per-user product pricing
- Cart, checkout, order history, order detail
- Admin dashboard with left nav:
  - Orders management (status workflow + CSV export)
  - User management with create/assign/price wizard
  - Product management (CRUD + image upload)
  - Branding settings (logo/hero/accent)
- Bootstrap-first-admin flow at `/bootstrap` using `ADMIN_BOOTSTRAP_TOKEN`
- Server-side order email notifications via Resend

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
- `EASYPOST_API_KEY` (optional; enables EasyPost rate lookup and label purchase)

## Supabase setup
1. Create a new Supabase project.
2. Apply SQL migrations under `db/migrations` in order.
3. Create storage buckets and set them public:
   - `branding`
   - `products`
   - `avatars`
4. Start app and create the first admin from `/bootstrap`.

Migration `048_quick_restock_performance.sql` must be applied before deploying the matching checkout/recurring-order code. It adds the server-priced atomic checkout and recurring-generation functions used by the app. Test database changes in an approved non-production environment before applying them to production.

## Running locally
```bash
nvm use
npm install
npm run dev
```

## Verification
```bash
npm run check
npm run build
npm run test:e2e
```

The Playwright suite always checks the public login at 320, 390, 768, and 1440 pixels. Authenticated role and center-isolation scenarios run when the documented `E2E_*` credentials are supplied.

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

## EasyPost setup
- Set `EASYPOST_API_KEY`.
- Add the ship-from origin address in Admin > Settings.
- Carrier shipments can then quote rates, buy labels, print labels, and automatically record shipping COGS from the purchased label cost.

## Seed data
`db/migrations/002_seed.sql` adds two example products and includes assignment snippets for a sample user.

## Money format
All money in database is stored as integer cents. UI formats values as USD.
