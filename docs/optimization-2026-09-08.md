# Optimization implementation — September 8, 2026

This pass reduces unnecessary rendering, repeated data processing, oversized queries, and duplicate code while retaining the ordering and administrative workflows.

## Implemented changes

- **Runtime and types:** upgraded to Next.js 15.5.25 and React 19.2.8, updated asynchronous route params and cookies, and pinned Supabase JS 2.114.0 / SSR 0.12.7. PostCSS is pinned to 8.5.28 and shared with transitive consumers through an override. Node 24 remains the runtime. Generated database types now feed the application clients through a small schema overlay; unused-local and unused-parameter checks are enabled. Removed unused `clsx` and `zod` dependencies.
- **Cart and catalog:** cached cart totals and product quantities once per storage update. Product controls subscribe to their own quantity; memoized catalog rows and separate order summaries avoid redrawing the catalog on every change. Products are sorted once before search/category filtering. Storage synchronization, current-price reconciliation, reorder merge/replace, cart undo, and accessible quantity feedback remain.
- **Styles and interaction code:** removed 766 lines of obsolete customer CSS, unused cart components, and the unreferenced inventory checklist. Surviving CSS declarations and their order were preserved. Read-only permission scanning skips display-only DOM changes and covers newly inserted submit buttons. Existing element IDs avoid layout measurements in button locking; pending and duplicate-submission protections remain.
- **Reports and exports:** shared pagination helpers load complete matching datasets and batch related IDs. Report commerce queries limit period reports to their comparison window while retaining lifetime inputs where required. Report detail pagination exposes records beyond the first 100 rows. P&L, orders CSV, and payroll CSV loaders report required-source failures instead of returning incomplete results. Existing permission scopes and financial calculations remain.
- **Accounting and calculations:** shared P&L input loading between the screen and export; grouped transactions, orders, products, and production inputs once instead of repeatedly scanning whole arrays. Shared product-category helpers and cached money/date formatters replace duplicate work. AI report generation reuses its business-snapshot loader.
- **Prospecting navigation:** replaced the 5,000-ID queue download with a filtered membership lookup and one-row Previous/Next queries. Existing filters, mixed ascending/descending sorting, null ordering, and the ID tie-breaker remain. If a lead leaves its filters, Next still opens the first matching record. Cursor/search values are quoted for PostgREST, and queue loading runs alongside profile reads.
- **Email and QuickBooks:** batch recurring-order admin CC lookups and limit concurrent delivery work. Order email results carry delivery failures through to callers. QuickBooks reconciliation reuses customer/date-window reads, pages invoice matches, and bounds independent lookups; shared request handling replaces duplicated accounting/payment transport code. Invoicing streams the selected view and uses smaller projections for summaries.
- **Repository and checks:** removed the unused JavaScript recurring-generation path while retaining atomic database generation. Removed 211 generated/local artifact files from Git tracking; their local copies are retained. Generated previews, business artifacts, local package stores, and build caches are excluded from source checks and deployment uploads. CI runs the application checks and production build with the pinned Node version.

## Retained workflows

Customer authentication, customer-specific catalogs/prices, checkout, recurring schedules, reordering, order history, and email notifications remain. Administrative permissions, inventory/production, prospecting, QuickBooks invoicing/payments, accounting, payroll, reports, and exports remain. The cleanup does not reduce reporting totals to the visible detail page.

## Database type maintenance

`npm run db:types` requires an installed, authenticated Supabase CLI with access to the project configured in `scripts/generate-database-types.mjs`. It regenerates `lib/supabase/database.types.ts` from the project's `public` schema and preserves the existing file when generation fails.

`lib/supabase/schema.ts` holds the nullable RPC argument overrides and declarations for the pending `20260908184205_recoverable_orders_and_catalog_pricing.sql` migration. The overlay is a compile-time contract; generating types does not install the recovery/catalog database objects.

No live database migration or deployment was performed as part of this optimization pass.

## Verification

Final checks passed:

- `npm run check`: TypeScript, ESLint, and **393 tests** passed; two optional live Supabase tests were skipped.
- `npm run build`: production compilation, type validation, static generation, and build tracing passed in an isolated copy to avoid the active dev server's generated files.
- Public login browser suite: **16 tests passed** at 320, 390, 768, and 1440 pixels, covering rendering, keyboard access, serious accessibility violations, persistent error alerts, and same-page scroll restoration.
- The dependency update's npm audit reported **zero known vulnerabilities**.
- Before/after reporting results matched on large mixed-history fixtures; bounded and complete profitability/simulator inputs matched across 20 date/filter scenarios, including DST and leap day. Actual rendered simulator forms preserve all 125 tested labor-minute and rate overrides across detail pages.

Tests also cover selective cart notifications, complete pagination, accounting/report inputs, export failure handling, email delivery results, QuickBooks reconciliation, and prospecting cursor/filter behavior. Authenticated browser flows were not run because E2E credentials are not configured. External email delivery and QuickBooks mutations were tested with mocked transport. Production page-speed changes have not been benchmarked.
