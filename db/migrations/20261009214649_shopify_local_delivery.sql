-- Shopify orders may be delivered locally, while retaining every prepaid
-- billing and imported-identity safeguard from the original integration.
alter table public.orders
  drop constraint orders_shopify_billing_check,
  add constraint orders_shopify_billing_check check (order_source <> 'shopify' or (
    shopify_shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
    and shopify_order_id ~ '^gid://shopify/Order/[1-9][0-9]*$'
    and shopify_shop_domain is not null and shopify_order_id is not null
    and jsonb_array_length(shopify_line_items) > 0
    and invoice_status = 'not_required'
    and quickbooks_invoice_id is null and quickbooks_payment_id is null and quickbooks_payment_charge_id is null
    and user_id is null and center_id is null and center_location_id is null
    and recurring_order_id is null and recurring_scheduled_for is null and prospecting_lead_id is null
    and order_kind = 'standard' and fulfillment_method in ('carrier', 'local_delivery')
  ));
