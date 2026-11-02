# Shopify products and paid orders

## Production activation — October 9, 2026

- Store: `a7mxi8-x1.myshopify.com`; portal: `https://app.sobrew.com`.
- Installed app: **Sobrew Wholesale Portal**, Shopify app ID `433621106689`, in organization `158255952`. Its client credentials are configured in Vercel Production; secrets are not stored in this document.
- Production deployment: `dpl_2EkvvtNMswn2fPrrG4mXyqS4zaJw`. The release preserves the exact 586-file source baseline of `dpl_BwL2Mv9mH84ejpceKS7KSoTGvUgr` plus the Shopify integration, because the working checkout contains other unreleased changes.
- Supabase project `ovrzooxvvernqqcotpkv` applied this repository's Shopify migration through the management API as history version `20261009140358`, name `shopify_paid_orders`. Do not blindly reapply the differently timestamped local file.
- `NEXT_PUBLIC_SITE_URL` is now `https://app.sobrew.com` in Production. Existing Preview and Development values were preserved separately.
- Initial catalog import: **23 Shopify products / 26 variants**. All 26 await portal recipe/COGS setup; 18 had no Shopify SKU and received unique portal SKUs. Shopify SKUs were not changed.
- Automatic `orders/paid`, `products/create`, and `products/update` subscriptions were activated through the portal, which confirmed successful setup against Shopify.
- Verified: production build, typecheck, lint, 329 targeted tests, isolated PostgreSQL checks, unauthorized-route and unsigned-webhook rejection, live catalog import, sync setup, and the import-attention screen. No error/fatal runtime logs appeared in the final deployment's launch check. A real newly paid order and its eventual shipment remain to be observed; no real order was charged or fulfilled for testing.

## Existing-order import — October 9, 2026

- Production `dpl_FZxkPKmFJ6sgbvmF1Q6hGZofzXct` adds exact order-number import and preserves consumed shipping box usage when a shipment save is retried. Based on the prior production release, including entered-box tape COGS.
- Imported Shopify orders #1160–#1165 through the authenticated portal. All six were verified `New`, `invoice_status=not_required`, with matching Shopify order IDs, delivery addresses, and 15 total bags. Each product has its recipe and shipping box-count requirement configured.
- Live order detail shows internal shipping expense, tracking, box size/count, and Mark shipped. No actual order was shipped or fulfilled during verification.
- Validation: 182 targeted tests, typecheck, focused lint, production build, deployment smoke check, live import/UI/database verification. No error/fatal logs in the deployment check.

## Integration behavior

The store is `a7mxi8-x1.myshopify.com`. Shopify products and variants can be imported into the portal’s **Products** list to configure production recipes and COGS. New products are imported automatically after webhook setup.

Paid Shopify orders enter the normal **Orders → New → Processing → Shipped** workflow. Each is labeled **Paid in Shopify** and displays the Shopify order number. Importing preserves the customer's delivery address, email, notes, exact product quantities, and discounted merchandise subtotal. Shopify customers do not need a portal login.

Shopify order donations are **$1 per bag**, including discounted bags; wholesale order donations remain **1% of merchandise revenue**. Shipment saves the donation on each line by bag quantity so product and profit reports use the correct costs. Processing remains the standard **2.99% + $0.30 per order**. Accounting/P&L reconciliation remains manual. The six imported orders #1160–#1165 had no shipment snapshots when this rule was introduced, so no historical COGS correction or database migration was required.

When shipping by carrier, enter the actual **shipping cost**, UPS tracking number(s), and the usual box usage. For **Local delivery / pickup**, tracking is omitted and $0 shipping is allowed with confirmation. Confirm zero boxes when no boxes were used. Shipping is an internal COGS expense; it does not charge the Shopify customer again. The portal saves the shipment and inventory costs, then creates a Shopify fulfillment (with tracking for carrier shipments) and requests Shopify's normal customer shipping notification. It skips QuickBooks invoices, payment charges, and duplicate portal shipping emails.

## Connect the store

1. Apply `db/migrations/20261009132818_shopify_paid_orders.sql` and then `db/migrations/20261009214649_shopify_local_delivery.sql` in the intended database before deploying this code. They create the private-to-API-clients webhook inbox, atomic import functions, source metadata, tracking storage, and database billing protection, including local delivery for prepaid Shopify orders. Check migration history before applying; repository files alone do **not** establish that migrations have been applied to production.
2. Create/install a Shopify app with `read_products`, `read_orders`, `read_merchant_managed_fulfillment_orders`, and `write_merchant_managed_fulfillment_orders`. The app needs access to order/customer names, email, and shipping addresses. Use a merchant-managed fulfillment location. Shopify's [fulfillment reference](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/fulfillmentCreate) explains the required fulfillment permissions.
3. Set server-side environment variables in the deployed portal:
   - `SHOPIFY_SHOP_DOMAIN`: the permanent `your-store.myshopify.com` domain, without a protocol or path.
   - `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`: credentials for an installed Dev Dashboard app owned by the same organization as the store. The portal exchanges them for an Admin API token and renews it before expiry. See [Shopify's client credentials setup](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant).
   - Alternatively, set `SHOPIFY_ADMIN_ACCESS_TOKEN` for an existing app with a valid Admin API token. When both client credentials are present, they take precedence.
   - `SHOPIFY_WEBHOOK_SECRET`: the secret used to sign the actual webhook subscription. App-created subscriptions default to `SHOPIFY_CLIENT_SECRET`. For a webhook created in Shopify Admin notifications, use that webhook's signing secret explicitly.
4. Set `NEXT_PUBLIC_SITE_URL` to the deployed portal’s public HTTPS origin. In **Products → Shopify products & COGS**, select **Import / refresh Shopify products**, then **Enable automatic product & order sync**. Enabling sync requires Products and Orders edit access. It checks app permissions and registers missing JSON subscriptions idempotently:
   - `orders/paid` → `/api/webhooks/shopify/orders`
   - `products/create` and `products/update` → `/api/webhooks/shopify/products`
   Use API version **2026-10** for the app/webhook version. Do not subscribe unpaid order-created events to the order endpoint. See Shopify's [webhook verification guide](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries).
5. Open each imported variant from the Shopify products screen and set its category, production recipe, materials, and labor. **Needs COGS setup** identifies products without a recipe. No COGS, wholesale prices, product assignments, or inventory balances are invented/imported from Shopify. One Shopify unit means one of that variant’s portal product; configure the recipe output accordingly. Existing receivable finished goods can use the normal received-inventory cost workflow.
6. Verify in a non-production store/environment with a real paid non-test order. Shopify orders flagged `test: true` are deliberately ignored. Confirm the order appears once, its products/destination/subtotal match, and it never appears in Invoicing. Ship with test tracking only in that non-production environment; confirm the fulfillment and tracking appear in Shopify. Replay the webhook and retry sync to confirm neither creates duplicates.

## Product identity and SKUs

Each Shopify variant is linked by its stable Shopify variant ID and store domain, not its SKU. The initial portal SKU uses Shopify’s SKU when available and unused; otherwise the portal generates a unique Shopify-prefixed SKU. Existing portal products with the same SKU are not automatically merged, because they may represent different package sizes. Blank or different Shopify SKUs do not block orders.

Refreshes update Shopify product details and availability, while preserving the portal SKU, category, recipe, costs, QuickBooks mappings, and product assignments. The original Shopify SKU is displayed separately so SKUs can be aligned later. Shopify updates never write costs back to Shopify. If a paid order arrives before its product event, the missing variant is fetched and imported before the order is saved. Deleted Shopify products/variants are not automatically removed from the portal.

Keep credentials in server environment settings or `.env.local`; never use `NEXT_PUBLIC_` or commit secrets. The GraphQL API version is pinned to `2026-10` in `lib/shopify.ts`.

## Handling issues

- **Orders → Shopify imports → Needs attention** shows order import errors. Fix the product or connection configuration and select **Retry import**. **All imports** includes completed and deliberately ignored deliveries. Temporary catalog/API/database failures request automatic Shopify redelivery. Permanent validation issues remain available for manual retry. The original webhook payload remains in a service-role-only inbox; only authorized Orders users can see its summary.
- Delivery is deduplicated by store and Shopify order ID inside a transaction. Retries cannot create partial or duplicate orders. Deleting a portal order does not erase its import receipt; restore that order from **Recently deleted** instead of reimporting it.
- Before shipping, the portal checks that Shopify still shows the order as fully paid and uncanceled, with matching items, quantities, and destination. Correct mismatches before shipping. Imported orders are snapshots; later Shopify edits/cancellations/refunds are not automatically applied to portal orders.
- Use **Recheck Shopify** on an unshipped order to verify readiness and clear a resolved validation error without shipping, consuming inventory, or notifying the customer. A single active fulfillment order does not require extra location access. If an order has multiple fulfillment groups, the app also needs location read access to verify they can be combined at the same location; split locations remain blocked.
- If Shopify is unavailable after the local shipment saves, the order shows **Shopify sync needs attention**. Use **Retry Shopify sync** on that order. This does not reship, consume inventory again, or create an invoice. The sync checks Shopify for an existing matching fulfillment before creating one, including when a previous response was lost.
- Only USD, wholly unfulfilled orders containing physical products are imported automatically. Mixed digital/physical orders, partial fulfillment, edited quantities, refunds, and mismatched totals are held for review. Fulfillment must be at one merchant-managed location, with no holds. Orders exceeding 100 line items or fulfillment orders need manual review. Resolve unsupported orders in Shopify; the portal will not guess how to fulfill them.
- Existing Shopify orders can be imported from **Orders → Shopify imports → Import existing paid orders** by entering up to 10 exact order numbers. Only fully paid, unfulfilled eligible orders are imported; existing order IDs are reused without duplicates. The webhook continues to import newly paid orders automatically after activation. This integration does not synchronize stock back to Shopify, customer accounts, shipping charges collected at checkout, taxes, refunds, or sales receipts into QuickBooks. Portal revenue uses the merchandise subtotal, consistent with its existing order workflow.

Product webhook errors remain visible in **Products → Shopify products & COGS** with a retry control, and return a non-success response so Shopify can retry delivery. A full catalog refresh is safe to repeat after partial failure; variant mappings prevent duplicate products and preserve COGS.

## Local verification

After loading nvm and running `nvm use`:

```sh
npm test -- lib/shopify.test.ts lib/shopify-import.test.ts lib/quickbooks-shopify-billing.test.ts lib/shopify-catalog.test.ts tests/shopify-admin-pages.test.ts tests/order-shipment-billing-action.test.ts
npm run typecheck
npm run lint
SHOPIFY_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-shopify-orders-db.mjs
```

The tests stub external API calls and run the migration against an isolated PostgreSQL-compatible database. They do not contact a store, collect money, or ship a real order.
