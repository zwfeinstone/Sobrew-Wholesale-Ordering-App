# Prospecting workspace rollout and verification

Implementation date: September 24, 2026. The new workspace is available in development. Production remains on the legacy UI unless the server explicitly enables `PROSPECTING_WORKSPACE_V2=true` (or `1`). Setting it to `false` or `0` restores the legacy screens in any environment.

Final automated validation: **707 tests passed across 85 suites**, with two opt-in live suites skipped; typecheck and lint passed. **18 isolated PostgreSQL scenarios passed.** The browser suite discovers **36 cases**; execution and release gates below remain pending.

## Behavior and feature preservation

| Area | Implementation | Verification |
| --- | --- | --- |
| Today | Overdue → due today → untouched unscheduled New; Upcoming and Needs scheduling presets; Central dates; shared rows/counts/navigation | Query and cursor tests, including 5,000 visited IDs; read-only desktop inspection |
| Leads / Pipeline | Search, source, state/missing state, stage, priority, geographic ordering, 25/50 pagination | Queue tests; legacy URL tests |
| Rep activity summary | Actor-attributed calls today/week, small summary above useful rows | Existing scoreboard tests; desktop inspection |
| Record | Contact context and priority first; explicit Edit only / Log call / Log email / Add note; one stage and follow-up control; contact addition, primary selection and deletion; company/ownership, DNC, notes, source, paginated history | Pure record tests and mocked action tests; read-only desktop interaction |
| Follow-up | Keep is default; reschedule and clear are explicit; parked stages still clear assignment and date | All supported outcomes and parked-stage tests |
| Drafts | Controlled fields, tab-local recovery, navigation confirmation, unload protection, frozen retry identity, conflict review | Builder/action/history tests; keyboard confirmation checked in running app; fixture journeys added |
| Save and next | Advance after commit; original continuation saved in receipt; visited leads excluded; no automatic wrap; explicit queue completion/state expansion | Cursor tests, signed replay tests and PostgreSQL transaction scenarios |
| Sample handoff | Contact → shipment or manager request → review; zero default quantities; atomic record/contact/activity/request/order save; cancellation preserves draft | Mutation tests, isolated PostgreSQL scenarios, fixture journeys added |
| Sample management | Specific request identity, pending/order-created/legacy review; manager fulfills one request; existing order links; repeat requests distinct | Request-list tests and isolated PostgreSQL scenarios |
| Manage → Leads | Existing buckets, explicit assignment/reassignment/unassignment, selected/all-filtered scope review, Pipeline Review, parked-stage and archive maintenance | Manager regression tests and original service tests |
| Manage → Imports | Existing single-lead form, CSV template/upload, source lists, history/errors, exact-match enrichment and different-phone duplicate review retained | Existing import/enrichment tests; sample contact preflight and request triggers |
| Manage → Samples | Existing outcomes/notes/Won/Lost, costs, inventory checks, historical snapshots and owner templates retained | Existing sample accounting tests; request-list tests |
| Manage → HubSpot | Existing queue, push/retry, failures, IDs/links, CSV/manual exported marking and scheduled processing retained | Existing HubSpot suites; new fulfillment tests preserve exported state |
| Manage → Reports | Existing overview/recycle attribution/sample outcome and Prospecting/Sample Spend report routes retained | Existing report suites |
| Samples menu | Standalone ordering remains separate from cost recording/history | Sample wrapper/form tests |
| Legacy routes | Original list, record, manager and sample pages retained behind flag; `tab=tasks` remains due-only; legacy flag-off default stays List | Rendered legacy fallback tests |

This table distinguishes implemented coverage from release sign-off. It does not claim a rep/owner usability session, live Supabase integration run, or the entire browser matrix has passed.

## Database contract

Apply `db/migrations/20260924213453_prospecting_atomic_workspace.sql` before enabling the new workspace in a deployed environment. It is additive and has not been applied to a live database by this implementation task.

- `commit_prospecting_record_v2` locks actor/permission/lead rows, checks the loaded version and current ownership, and commits record, contacts, history, sample request, shipment and receipt together.
- Both new public RPCs are restricted to `service_role`. Server actions derive the actor from the authenticated session; clients do not choose it. The new tables deny direct anonymous/authenticated access.
- The record action signs immutable raw record/version/draft/sample input. Reusing an ID with changed input fails. A lost response can replay the original receipt even after the lead leaves the rep's scope. Receipts retain the original continuation URL.
- Contact changes bump the parent record version, including changes made through older interfaces.
- Explicit sample requests have their own identity. Request-only creates no order. Fulfilling a request does not create another request or another sample-stage transition.
- Existing sample-stage leads are backfilled as `legacy_review`, retaining the latest available linked order. An absent link is not evidence that nothing shipped.
- Bulk/import sample-stage transitions create a pending request through database triggers and retain the existing named-contact/email checks. Existing HubSpot scheduling, including 5 p.m. Central handling, remains in place.
- Shipment quantities are positive integers after zero/unselected rows are omitted; active sample products and recipes are rechecked under locks. Sample-cost accounting remains independent.

The isolated database harness runs the exact new migration, the existing atomic-save migration, and the existing sample-contact/HubSpot-schedule migration against temporary PGlite tables. It checks rollback, stale forms, permission changes, contact changes, idempotent calls/orders, request-only fulfillment, repeat requests, exported-state preservation, signed replay, original navigation, deferred constraints and service-role execution. It does **not** replace a staging Supabase/PostgREST/RLS check against the complete deployed schema.

## Repeatable checks

Use the repository's nvm setup first:

```sh
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use
npm run check
```

The isolated database runner never connects to a live database:

```sh
PROSPECTING_PGLITE_MODULE=/private/tmp/sobrew-prospecting-db-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-prospecting-atomic.mjs
```

That temporary module is local test tooling, not an application dependency. On another machine, point `PROSPECTING_PGLITE_MODULE` at an installed `@electric-sql/pglite/dist/index.js` module.

The browser fixture bundles the actual editor and CSS with simulated server actions and routing. It neither contacts the live database nor creates real orders:

```sh
PLAYWRIGHT_BASE_URL=http://fixture.invalid npm run test:e2e -- tests/e2e/prospecting-workspace.spec.ts
```

The fixture matrix covers 320, 390, 768 and 1440px: activity logging, outcome changes, preserved follow-ups, response interruption/retry, draft recovery, keyboard navigation, conflict links, sample Back/cancel/retry, collapsed invalid fields, read-only controls, overflow and serious/critical axe checks. Discovery and fixture bundling were verified. Automated Chromium execution hit a sandbox boundary and was not retried. The browser policy also blocked opening the local HTML fixture. These browser cases must run in a permitted test environment before rollout.

Read-only checks in the existing in-app browser verified the 1440×900 split layout, visible composer, queue counts, outcome switching, draft restoration, and the unsaved-changes dialog's focus/Escape behavior. No live writes were performed. The viewport override did not change the reported viewport, so mobile visual acceptance remains pending. Later list navigation was blocked by the browser (`ERR_BLOCKED_BY_CLIENT`); no retry or alternate browser probe was attempted after that boundary. The local QA draft was discarded without saving.

The production build was attempted but could not fetch the existing Manrope font from `fonts.googleapis.com` (`ENOTFOUND`). Retry `npm run build` with font-network access; do not count the blocked build as a passing release gate.

## Release gates and pilot

1. Apply the additive migration to an isolated staging Supabase project with the full application schema. Confirm function grants, RLS behavior, triggers, and schema-cache refresh.
2. Run all checks above, a network-enabled production build, and live integration tests only against disposable fixture data. Check owner, editing/view-only/inactive reps, cross-owner URLs, direct action submissions, concurrent reassignment/contact deletion and late transaction failures.
3. Run the browser matrix and complete the feature-preservation table with real rep and owner scripted sessions: daily calls, scheduling, request-only and linked shipment handoff, standalone ordering, import/assignment, maintenance, sample costs/outcomes, and failed HubSpot retry. Require completion without coaching.
4. Verify Central midnight/DST, 40+ history entries, unavailable counts/history, empty and filtered-empty queues, queue exhaustion, preserved list position, retained filters and canceled drafts. Confirm no serious/critical axe violations and no sideways primary-action scrolling.
5. Enable the server flag only in the pilot deployment. Inspect save outcomes, conflicts, replay rates, pending/legacy sample requests, and existing HubSpot failures before enabling production broadly.

Record saves emit `prospecting_record_save` log events containing only outcome and duration, without prospect/contact text. Receipts and request rows support checking duplicate submissions and incomplete handoffs. Review pending requests by `created_at`, `status`, `closed_at` and `order_id`; review the existing HubSpot queue for partial failures and retries.

For rollback, disable the flag and retain the additive schema and receipts. Do not delete historical requests or orders. The legacy pages remain available; committed records and shipment orders remain valid.

Browser limitation: when the Navigation API is unavailable, indexed Back/Forward entries are restored before prompting. A history entry created before the fallback installed has no discoverable direction; protecting the draft may truncate that unknown forward-history branch. The intended destination remains available through the confirmation dialog.
