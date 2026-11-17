-- Customer-paid shipping is separate from the carrier/fulfillment shipping cost.
-- Tax is a liability, not revenue or COGS. NULL means the source was not verified.
-- Existing rows deliberately remain unchanged until verified receipt backfill.
alter table public.orders
  add column shopify_shipping_collected_cents integer,
  add column shopify_tax_collected_cents integer,
  add column shopify_total_paid_cents integer,
  add constraint orders_shopify_collected_amounts_check check (
    num_nonnulls(shopify_shipping_collected_cents, shopify_tax_collected_cents, shopify_total_paid_cents) = 0
    or (
      order_source = 'shopify'
      and num_nonnulls(shopify_shipping_collected_cents, shopify_tax_collected_cents, shopify_total_paid_cents) = 3
      and shopify_shipping_collected_cents >= 0
      and shopify_tax_collected_cents >= 0
      and shopify_total_paid_cents >= 0
      and subtotal_cents::bigint + shopify_shipping_collected_cents::bigint + shopify_tax_collected_cents::bigint
        = shopify_total_paid_cents::bigint
    )
  );

comment on column public.orders.shopify_shipping_collected_cents is
  'USD customer shipping collected, excluding tax and after shipping discounts; separate from shipping_cost_cents. NULL means not verified.';
comment on column public.orders.shopify_tax_collected_cents is
  'USD Shopify tax collected, including shipping tax; a liability excluded from revenue and COGS. NULL means not verified.';
comment on column public.orders.shopify_total_paid_cents is
  'USD original paid order total; reconciles merchandise subtotal plus customer shipping plus tax. Not net payout or refund-adjusted. NULL means not verified.';

-- Retain existing integration-managed identity protections and restrict the new
-- collected amounts to the same trusted roles. Normal fulfillment edits remain allowed.
CREATE OR REPLACE FUNCTION public.protect_shopify_order_identity()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER
 SET search_path TO ''
AS $function$
begin
  -- Old order-trash snapshots predate these columns and populate them with null.
  new.order_source := coalesce(new.order_source, 'portal');
  new.shopify_line_items := coalesce(new.shopify_line_items, '[]'::jsonb);
  new.shopify_sync_status := coalesce(new.shopify_sync_status, 'pending');
  new.shipping_tracking_numbers := coalesce(new.shipping_tracking_numbers, '{}'::text[]);
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if tg_op = 'INSERT' then
      if new.order_source <> 'portal' or new.shopify_order_id is not null or new.shopify_shop_domain is not null
        or new.shopify_order_name is not null or new.shopify_email is not null or new.shopify_line_items <> '[]'::jsonb
        or new.shopify_fulfillment_id is not null or new.shopify_sync_status <> 'pending'
        or new.shopify_sync_error is not null or new.shopify_synced_at is not null or new.shopify_sync_started_at is not null
        or new.shopify_sync_token is not null
        or new.shopify_shipping_collected_cents is not null or new.shopify_tax_collected_cents is not null
        or new.shopify_total_paid_cents is not null then
        raise exception 'Shopify identity is managed by the integration' using errcode = '42501';
      end if;
    elsif row(new.order_source, new.shopify_shop_domain, new.shopify_order_id, new.shopify_order_name, new.shopify_email,
      new.shopify_line_items, new.shopify_fulfillment_id, new.shopify_sync_status, new.shopify_sync_error,
      new.shopify_synced_at, new.shopify_sync_started_at, new.shopify_sync_token,
      new.shopify_shipping_collected_cents, new.shopify_tax_collected_cents, new.shopify_total_paid_cents)
      is distinct from row(old.order_source, old.shopify_shop_domain, old.shopify_order_id, old.shopify_order_name, old.shopify_email,
      old.shopify_line_items, old.shopify_fulfillment_id, old.shopify_sync_status, old.shopify_sync_error,
      old.shopify_synced_at, old.shopify_sync_started_at, old.shopify_sync_token,
      old.shopify_shipping_collected_cents, old.shopify_tax_collected_cents, old.shopify_total_paid_cents) then
      raise exception 'Shopify identity is managed by the integration' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.import_shopify_order(p_order jsonb, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare
  v_receipt public.shopify_order_imports%rowtype;
  v_order_id uuid;
  v_item jsonb;
  v_total bigint := 0;
  v_line_items jsonb;
  v_money_key text;
  v_shipping_collected integer;
  v_tax_collected integer;
  v_total_paid integer;
begin
  select * into strict v_receipt from public.shopify_order_imports where id = (p_order->>'import_id')::uuid for update;
  if v_receipt.status = 'imported' then return v_receipt.order_id; end if;
  if p_order->>'shopify_shop_domain' is distinct from v_receipt.shop_domain
    or p_order->>'shopify_order_id' is distinct from v_receipt.shopify_order_id
    or v_receipt.payload->>'financial_status' is distinct from 'paid'
    or v_receipt.payload->>'currency' is distinct from 'USD'
    or coalesce((v_receipt.payload->>'test')::boolean, false)
    or v_receipt.payload->>'cancelled_at' is not null
    or v_receipt.payload->>'fulfillment_status' is not null then
    raise exception 'Shopify receipt is not an eligible paid order' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Shopify order requires mapped items' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce((v_item->>'qty')::int, 0) not between 1 and 9999
      or coalesce((v_item->>'unit_price_cents')::int, -1) < 0
      or coalesce((v_item->>'line_total_cents')::int, -1) < 0
      or not coalesce(v_item->>'shopify_line_item_id' ~ '^gid://shopify/LineItem/[1-9][0-9]*$', false) then
      raise exception 'Invalid Shopify line item' using errcode = '22023';
    end if;
    perform id from public.products where id = (v_item->>'product_id')::uuid
      and shopify_shop_domain = v_receipt.shop_domain and shopify_variant_id = v_item->>'shopify_variant_id'
      and active = true for share;
    if not found then raise exception 'Shopify variant no longer matches an active portal product' using errcode = '22023'; end if;
    v_total := v_total + (v_item->>'line_total_cents')::int;
  end loop;
  if v_total is distinct from (p_order->>'subtotal_cents')::bigint
    or (select count(distinct value->>'shopify_line_item_id') from jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) then
    raise exception 'Shopify item totals or IDs are invalid' using errcode = '22023';
  end if;
  -- Older app versions omit all three fields. Preserve unknown amounts as NULL,
  -- rather than reporting unverified historical shipping or tax as zero.
  if p_order ?| array['shopify_shipping_collected_cents', 'shopify_tax_collected_cents', 'shopify_total_paid_cents'] then
    if not (p_order ?& array['shopify_shipping_collected_cents', 'shopify_tax_collected_cents', 'shopify_total_paid_cents']) then
      raise exception 'Shopify collected amounts must be supplied together' using errcode = '22023';
    end if;
    foreach v_money_key in array array['shopify_shipping_collected_cents', 'shopify_tax_collected_cents', 'shopify_total_paid_cents'] loop
      if jsonb_typeof(p_order->v_money_key) is distinct from 'number'
        or not coalesce(p_order->>v_money_key ~ '^(0|[1-9][0-9]*)$', false)
        or length(p_order->>v_money_key) > 10 then
        raise exception 'Shopify collected amounts must be nonnegative integer cents' using errcode = '22023';
      end if;
      if (p_order->>v_money_key)::bigint > 2147483647 then
        raise exception 'Shopify collected amounts exceed the supported range' using errcode = '22023';
      end if;
    end loop;
    v_shipping_collected := (p_order->>'shopify_shipping_collected_cents')::integer;
    v_tax_collected := (p_order->>'shopify_tax_collected_cents')::integer;
    v_total_paid := (p_order->>'shopify_total_paid_cents')::integer;
    if v_total + v_shipping_collected::bigint + v_tax_collected::bigint <> v_total_paid::bigint then
      raise exception 'Shopify subtotal, shipping and tax do not reconcile to the paid total' using errcode = '22023';
    end if;
  end if;
  select jsonb_agg(jsonb_build_object('line_item_id', value->>'shopify_line_item_id',
    'quantity', (value->>'qty')::int, 'product_id', value->>'product_id')) into v_line_items from jsonb_array_elements(p_items);
  insert into public.orders(order_source, shopify_shop_domain, shopify_order_id, shopify_order_name, shopify_email,
    shopify_line_items, invoice_status, status, order_kind, fulfillment_method,
    shipping_name, shipping_company, shipping_address1, shipping_address2, shipping_city, shipping_state, shipping_zip,
    shipping_country, notes, subtotal_cents, created_at,
    shopify_shipping_collected_cents, shopify_tax_collected_cents, shopify_total_paid_cents)
  values ('shopify', v_receipt.shop_domain, v_receipt.shopify_order_id, v_receipt.shopify_order_name, p_order->>'shopify_email',
    v_line_items, 'not_required', 'New', 'standard', 'carrier',
    p_order->>'shipping_name', p_order->>'shipping_company', p_order->>'shipping_address1', p_order->>'shipping_address2',
    p_order->>'shipping_city', p_order->>'shipping_state', p_order->>'shipping_zip', p_order->>'shipping_country',
    p_order->>'notes', v_total, (p_order->>'created_at')::timestamptz,
    v_shipping_collected, v_tax_collected, v_total_paid) returning id into v_order_id;
  insert into public.order_items(order_id, product_id, product_name_snapshot, qty, unit_price_cents, line_total_cents)
  select v_order_id, (value->>'product_id')::uuid, value->>'product_name_snapshot',
    (value->>'qty')::int, (value->>'unit_price_cents')::int, (value->>'line_total_cents')::int from jsonb_array_elements(p_items);
  update public.shopify_order_imports set status = 'imported', order_id = v_order_id, error = null, updated_at = now()
    where id = v_receipt.id;
  return v_order_id;
end;
$function$;

revoke all on function public.protect_shopify_order_identity() from public, anon, authenticated;
revoke all on function public.import_shopify_order(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.import_shopify_order(jsonb,jsonb) to service_role;

notify pgrst, 'reload schema';
