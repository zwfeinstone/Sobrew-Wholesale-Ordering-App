## Database setup

1. Run `db/migrations/001_init.sql`.
2. Run `db/migrations/002_seed.sql`.
3. Ensure storage buckets exist and are public:
   - `branding`
   - `products`
   - `avatars`

Use Supabase SQL editor or CLI migrations.

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
