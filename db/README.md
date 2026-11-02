## Database setup

1. Run `db/migrations/001_init.sql`.
2. Run `db/migrations/002_seed.sql`.
3. Ensure storage buckets exist and are public:
   - `branding`
   - `products`
   - `avatars`

Use Supabase SQL editor or CLI migrations.

## Archiving prepaid customer-stock orders

`20261020232822_allow_held_stock_order_archiving.sql` allows the original billed
customer-stock order to be archived and unarchived while preserving its customer,
Shipped status, billed amount, allocation, and inventory. Previously that order
blocked a bulk archive containing it.

Production project `ovrzooxvvernqqcotpkv` applied this fix on October 20, 2026 as
migration `20261020232938`, named `allow_held_stock_order_archiving`. Check that
history entry before applying the differently timestamped local file again.
The isolated regression script is `scripts/test-customer-held-stock-db.mjs`.

## Sample pricing email CC recipients

Apply `20261016145956_prospecting_sample_quote_cc.sql` before deploying the sample
pricing CC form. It adds an optional `cc_emails` snapshot to each pricing email;
existing emails default to an empty list. CC recipients are saved with the quote
and cannot be changed after a send starts, including on a retry. Existing access
rules and the lead owner's automatic email copy are preserved.

The review form accepts up to 20 additional addresses separated by commas,
semicolons, or new lines. It validates addresses, removes duplicates, and shows
the CC list before sending.

## Customer delivery locations

`20261012151002_customer_location_self_service.sql` lets active customer accounts
create and edit active locations for their own active company. Customer writes
use the authenticated session client and RLS, with database validation and guards
on location identity, company, status, creation time, and internal notes. Customer
deletion is not enabled. Admin location management remains available.

New recurring orders snapshot the current saved location address after existing
delivery overrides. Already-created orders and restored orders retain their saved
addresses. Missing, inactive, or foreign saved locations retain the recurring
source address under the existing fallback behavior.

Production project `ovrzooxvvernqqcotpkv` applied this file on October 12, 2026
through the management API as migration version `20261012153531`, named
`customer_location_self_service`. Check that history entry before applying the
differently timestamped local file again.

Run the isolated regression checks without touching a live database:

```bash
CUSTOMER_LOCATIONS_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-customer-locations-db.mjs
```

## Automatic first-order sales SPIFF

The `first_order_sales_spiff` migration awards an unpaid $100 SPIFF when a customer
account places its first standard order. The original salesperson comes from the
`center_created` audit event (`actor_profile_id` and `sales_assigned_to_creator`),
which the account-creation API already records. Reassigning the account does not
change the recipient. Unknown or non-sales creators are not inferred from the
current assignment. Sample orders do not qualify or consume eligibility.

Awards appear in the existing payroll SPIFF list and the salesperson's week-hours
view, with the customer name and first order ID in the notes. They use the order's
Monday–Sunday payroll week in America/Chicago and remain unpaid until marked paid.
Multiple new customers can each earn a SPIFF in the same week.

The private receipt table enforces one award per customer across all logins,
retries, concurrent orders, and order deletion/restoration. Awarding and order
creation share a transaction. Deleting a payroll entry does not reset eligibility.
Existing standard orders (including archived orders and recoverable deleted
orders) are recorded as ineligible at migration time; no retroactive SPIFFs are
created. Accounts without prior standard orders remain eligible.

Run `db/tests/first-order-sales-spiff.sql` after the migration to verify the rule.
The regression fixtures and their payroll records are rolled back.

## Deferred hourly pay

`20261007140423_deferred_hourly_pay.sql` adds employee-scoped plans and seeds the
active `haskins@sobrew.com` account with a $5/hour accrual for October 7, 2026
through January 3, 2027, inclusive in America/Chicago, payable January 4, 2027.
His $15/hour weekly payroll setting and historical shift rates are unchanged.

Week Hours calculates the separate balance from completed shifts, including
weekends and previously paid weekly wages, less unpaid breaks. It clips work to
the plan dates, keeps the full history across January, and reconciles shift and
weekly cents to the total. Open and void shifts do not accrue. Corrections to
completed shifts update the accrual. The flat accrual does not modify payroll's
existing overtime calculation or send payments.

Accounting P&L (including its PDF), authorized Reports, Payroll, and the deferred
pay CSV share `loadDeferredPayAccounting`. Central calendar-date earnings are
recognized by labor allocation: production to COGS, other tags to operating
expense. Cumulative rounding at period boundaries keeps monthly and annual cents
consistent with Week Hours. The payable reconciles as opening balance + earnings
- recorded payments = closing balance. Corrections after settlement can expose
a remaining liability or an overpayment credit. Stored item/order inventory
costs are unchanged; Reports shows this company payroll expense separately.

The due date never automatically marks the balance paid. `paid_at` and
`paid_amount_cents` record an actual separate payment; only trusted backend access
can update them. Employee access is read-only. Load failures display an unavailable
balance rather than zero or a partial total. Shared saved AI reports contain a
coverage note only, without confidential payroll amounts.

`20261007145120_deferred_hourly_pay_settlement.sql` adds an audited payment action
and optional unique link to an imported bank transaction. After the due date, a
payroll editor may record the full actual gross payment. The service-only RPC
rechecks permissions and completed work/break intervals atomically and rejects
open shifts, stale totals, duplicate payments, and future payment dates. Bank
matching additionally requires Accounting edit access and a dedicated outflow
with the exact amount and payment date. Combined/net payments remain unmatched.
Matching assigns `Deferred Payroll / Compensation Payable` (liability, no P&L).
P&L also excludes the linked settlement independently of its bank category, while
retaining the original cash transaction. A later import can be linked without
recording the payment again. No payout happens automatically on January 4.

`db/tests/deferred-hourly-pay.sql` verifies constraints and access in a rolled-back
transaction. For isolated verification without connecting to a live database:

```bash
DEFERRED_PAY_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-deferred-hourly-pay-db.mjs
```

## Saved delivery moves and next-order notices

`20261009125507_center_order_delivery_updates.sql` adds an operator-only
`private.center_order_delivery_updates` configuration. A configured customer's
new standard orders use the current linked `center_locations` address when the
order has no saved location or selects that same location. This also redirects
recurring orders that otherwise copy an obsolete source-order address. Explicit
alternate locations, sample orders, restored orders, and shipped history are
preserved.

The notice is attached once, when the first qualifying new order successfully
saves a line item. A header without items, a failed item batch, or a rolled-back
checkout cannot consume it. `created_at` is the notice's arming timestamp, so
adding an item to an older order cannot consume it either. The durable
`noted_order_id` survives deletion, and the exact reserved notice paragraph is
removed when later orders copy it from a recurring source. Saved-location edits
continue to apply without rearming the notice. Private access is intentionally
denied to API roles; RLS has no client policies.

`db/tests/center-order-delivery-updates.sql` exercises the actual recurring
generator, exactly-once notes, failed/split requests, retries, multi-row items,
history, and permissions in a rolled-back transaction. This migration was
applied with the connected migration tool; the local filename matches its
recorded remote version.

## Filter-pack roll-stock inventory

`20261012194144_product_material_fallbacks.sql` adds recipe-specific primary and
secondary materials. Production consumes available primary stock first, then
uses the secondary material for the remaining quantity with its actual lot cost.

`20261012201650_filter_pack_roll_stock_inventory.sql` creates
`Filter Pack Bag - Roll Stock` (`MAT-BAG-FILTER-PACK-ROLL-STOCK`) as a material and
supply tracked in individual bags. It records 5,882 starting bags at 3.49 cents
per bag ($0.0349), with a matching lot, adjustment, and inventory movement. All
existing filter-pack recipes use roll stock as their primary material and
`Filter Pack Bag` (`MAT-BAG-FILTER-PACK`) as their secondary material.

The migration recognizes the starting count already entered on October 12, 2026.
Rerunning it does not add another starting count or restore consumed stock. A
fresh database without filter-pack products receives the material and starting
count without creating products or recipes. Existing filter-pack recipes must
match the reviewed 40-bag case format; unexpected inventory history or recipe
shapes stop the transaction without partial changes.

Both migrations are applied to production project `ovrzooxvvernqqcotpkv`; their
local filenames match the recorded production migration versions.

Run the isolated migration regression checks without connecting to production:

```bash
MATERIAL_FALLBACKS_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-filter-pack-roll-stock-db.mjs
```

## Recipe labor rate and pack timing

`20261012204451_recipe_labor_22_and_twenty_seconds_per_pack.sql` sets every existing
product recipe's labor rate to $22/hour (2,200 cents). Fraction-pack and filter-pack
recipes use 20 seconds per pack, based on their `fraction_bag` or `filter_pack`
component quantity. Minutes are rounded to two decimal places to match the recipe
and production editors. Recipe quantities and minutes describe the full recipe
output; the reviewed pack recipes each output one case. A different output size
requires review before applying this dated migration.

Other product categories retain their labor minutes. Products without recipes
are not given empty recipes. Inventory balances, material preferences, payroll,
and recorded production costs are unaffected. Missing or ambiguous pack recipes
abort the entire migration, and reapplying unchanged data is a no-op.

Applied to production project `ovrzooxvvernqqcotpkv` on October 12, 2026 with the
same recorded migration version: all 67 configured recipes use $22/hour, and all
38 fraction-pack plus four filter-pack recipes have the calculated pack times.

Run the isolated database regression checks:

```bash
MATERIAL_FALLBACKS_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-recipe-labor-db.mjs
```

## East End Grill 100 × 1.5 oz products

`20261013180925_east_end_grill_fraction_pack_variants.sql` creates medium- and
dark-roast 100 × 1.5 oz fraction packs with filters from the corresponding
100 × 2 oz recipes. Coffee is reduced from 200 to 150 oz; labor, waste, labels,
packaging, and material fallbacks are copied from each source recipe.

East End Grill receives both new products at $105 per case and its existing
medium- and dark-roast 50-count K-Cups at $42 per bag. All other guide assignments
and prices remain in place. The migration is transactional, avoids duplicate
products on replay, and does nothing on a fresh database without this customer.
New products receive separate QuickBooks identities through the app's normal
per-product sync after the migration; source catalog identities are not copied.

Applied to production project `ovrzooxvvernqqcotpkv` on October 13, 2026; the local
filename matches the recorded production migration version. All 12 isolated
regression scenarios passed before application.

Run the isolated database regression checks:

```bash
EAST_END_GRILL_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-east-end-grill-products-db.mjs
```
