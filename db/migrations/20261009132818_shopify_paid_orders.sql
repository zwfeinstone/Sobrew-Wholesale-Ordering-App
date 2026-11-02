-- Shopify variants have their own identity even when store SKUs differ or are empty.
alter table public.products
  add column shopify_shop_domain text,
  add column shopify_product_id text,
  add column shopify_variant_id text,
  add column shopify_sku text,
  add column shopify_synced_at timestamptz,
  add column shopify_updated_at timestamptz,
  add constraint products_shopify_identity_check check (
    (shopify_shop_domain is null and shopify_product_id is null and shopify_variant_id is null)
    or (shopify_shop_domain is not null and shopify_product_id is not null and shopify_variant_id is not null
      and shopify_shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
      and shopify_product_id ~ '^gid://shopify/Product/[1-9][0-9]*$'
      and shopify_variant_id ~ '^gid://shopify/ProductVariant/[1-9][0-9]*$')
  );
create unique index products_shopify_variant_idx on public.products(shopify_shop_domain, shopify_variant_id)
  where shopify_variant_id is not null;

create or replace function public.protect_shopify_product_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if tg_op = 'INSERT' then
      if new.shopify_shop_domain is not null or new.shopify_product_id is not null or new.shopify_variant_id is not null
        or new.shopify_sku is not null or new.shopify_synced_at is not null or new.shopify_updated_at is not null then
        raise exception 'Shopify product identity is managed by the integration' using errcode = '42501';
      end if;
    elsif row(new.shopify_shop_domain, new.shopify_product_id, new.shopify_variant_id, new.shopify_sku, new.shopify_synced_at, new.shopify_updated_at)
      is distinct from row(old.shopify_shop_domain, old.shopify_product_id, old.shopify_variant_id, old.shopify_sku, old.shopify_synced_at, old.shopify_updated_at) then
      raise exception 'Shopify product identity is managed by the integration' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_shopify_product_identity() from public, anon, authenticated;
create trigger protect_shopify_product_identity before insert or update on public.products
  for each row execute function public.protect_shopify_product_identity();

create or replace function public.sync_shopify_product_variant(p_variant jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_existing public.products%rowtype;
  v_shop text := p_variant->>'shop_domain';
  v_product text := p_variant->>'product_id';
  v_variant text := p_variant->>'variant_id';
  v_updated timestamptz := (p_variant->>'updated_at')::timestamptz;
  v_source_sku text := nullif(btrim(p_variant->>'sku'), '');
  v_sku text;
  v_fallback text;
  v_id uuid;
  v_attempt int := 0;
begin
  if not coalesce(v_shop ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$', false)
    or not coalesce(v_product ~ '^gid://shopify/Product/[1-9][0-9]*$', false)
    or not coalesce(v_variant ~ '^gid://shopify/ProductVariant/[1-9][0-9]*$', false)
    or nullif(btrim(p_variant->>'name'), '') is null or v_updated is null
    or jsonb_typeof(p_variant->'active') is distinct from 'boolean' then
    raise exception 'Shopify variant metadata is invalid' using errcode = '22023';
  end if;
  -- Serializes same-variant creation without exposing an RPC to ordinary clients.
  perform pg_advisory_xact_lock(hashtextextended('shopify:variant:' || v_shop || ':' || v_variant, 0));
  select * into v_existing from public.products where shopify_shop_domain = v_shop and shopify_variant_id = v_variant for update;
  if found then
    if v_existing.shopify_updated_at is null or v_updated > v_existing.shopify_updated_at then
      update public.products set name = btrim(p_variant->>'name'), description = p_variant->>'description',
        active = (p_variant->>'active')::boolean, shopify_product_id = v_product, shopify_sku = v_source_sku,
        shopify_updated_at = v_updated, shopify_synced_at = now() where id = v_existing.id;
    end if;
    return jsonb_build_object('id', v_existing.id, 'created', false);
  end if;
  v_fallback := 'SHOPIFY-' || split_part(v_variant, '/', 5);
  v_sku := coalesce(v_source_sku, v_fallback);
  loop
    insert into public.products(name, description, sku, active, shopify_shop_domain, shopify_product_id,
      shopify_variant_id, shopify_sku, shopify_updated_at, shopify_synced_at)
    values (btrim(p_variant->>'name'), p_variant->>'description', v_sku, (p_variant->>'active')::boolean,
      v_shop, v_product, v_variant, v_source_sku, v_updated, now())
    on conflict (sku) do nothing returning id into v_id;
    if v_id is not null then exit; end if;
    v_attempt := v_attempt + 1;
    if v_attempt > 100 then raise exception 'Unable to allocate a unique portal SKU for Shopify variant'; end if;
    v_sku := case when v_attempt = 1 and v_sku <> v_fallback then v_fallback
      else v_fallback || '-' || substr(md5(v_shop), 1, 8) || '-' || v_attempt::text end;
  end loop;
  -- Category, image, inventory recipes and COGS settings retain their portal defaults.
  return jsonb_build_object('id', v_id, 'created', true);
end;
$$;
revoke all on function public.sync_shopify_product_variant(jsonb) from public, anon, authenticated;
grant execute on function public.sync_shopify_product_variant(jsonb) to service_role;

create table public.shopify_product_imports (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null check (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  shopify_product_id text not null check (shopify_product_id ~ '^gid://shopify/Product/[1-9][0-9]*$'),
  webhook_id text not null check (length(webhook_id) between 1 and 200),
  topic text not null check (topic in ('products/create', 'products/update')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'imported', 'error')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shop_domain, webhook_id)
);
alter table public.shopify_product_imports enable row level security;
revoke all on public.shopify_product_imports from public, anon, authenticated, service_role;
grant select, insert on public.shopify_product_imports to service_role;
grant update(status, error, updated_at) on public.shopify_product_imports to service_role;
create index shopify_product_imports_attention_idx on public.shopify_product_imports(created_at desc)
  where status in ('pending', 'error');

-- Paid Shopify orders use the same fulfillment/inventory workflow, without portal billing.
alter table public.orders
  add column order_source text not null default 'portal',
  add column shopify_shop_domain text,
  add column shopify_order_id text,
  add column shopify_order_name text,
  add column shopify_email text,
  add column shopify_line_items jsonb not null default '[]'::jsonb,
  add column shopify_fulfillment_id text,
  add column shopify_sync_status text not null default 'pending',
  add column shopify_sync_error text,
  add column shopify_synced_at timestamptz,
  add column shopify_sync_started_at timestamptz,
  add column shopify_sync_token uuid,
  add column shipping_tracking_numbers text[] not null default '{}',
  add column shipping_country text;

alter table public.orders drop constraint orders_invoice_status_check;
alter table public.orders
  add constraint orders_invoice_status_check check (invoice_status in ('not_invoiced', 'invoicing', 'invoiced', 'invoice_error', 'not_required')),
  add constraint orders_order_source_check check (order_source in ('portal', 'shopify')),
  add constraint orders_invoice_not_required_source_check check (invoice_status <> 'not_required' or order_source = 'shopify'),
  add constraint orders_shopify_sync_status_check check (shopify_sync_status in ('pending', 'syncing', 'synced', 'error')),
  add constraint orders_shopify_line_items_check check (jsonb_typeof(shopify_line_items) = 'array'),
  add constraint orders_shopify_billing_check check (order_source <> 'shopify' or (
    shopify_shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
    and shopify_order_id ~ '^gid://shopify/Order/[1-9][0-9]*$'
    and shopify_shop_domain is not null and shopify_order_id is not null
    and jsonb_array_length(shopify_line_items) > 0
    and invoice_status = 'not_required'
    and quickbooks_invoice_id is null and quickbooks_payment_id is null and quickbooks_payment_charge_id is null
    and user_id is null and center_id is null and center_location_id is null
    and recurring_order_id is null and recurring_scheduled_for is null and prospecting_lead_id is null
    and order_kind = 'standard' and fulfillment_method = 'carrier'
  ));
create unique index orders_shopify_identity_idx on public.orders(shopify_shop_domain, shopify_order_id)
  where order_source = 'shopify';

-- This is both a durable webhook inbox and an import receipt. There is intentionally
-- no order FK: deletion/recovery of a portal order cannot reset Shopify deduplication.
create table public.shopify_order_imports (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null check (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  shopify_order_id text not null check (shopify_order_id ~ '^gid://shopify/Order/[1-9][0-9]*$'),
  shopify_order_name text,
  topic text not null check (topic = 'orders/paid'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'imported', 'ignored', 'error')),
  error text,
  order_id uuid,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_domain, shopify_order_id),
  constraint shopify_import_order_receipt_check check ((status = 'imported') = (order_id is not null))
);
alter table public.shopify_order_imports enable row level security;
revoke all on public.shopify_order_imports from public, anon, authenticated, service_role;
grant select, insert on public.shopify_order_imports to service_role;
grant update (status, error, order_id, updated_at) on public.shopify_order_imports to service_role;
create index shopify_order_imports_attention_idx on public.shopify_order_imports(received_at desc)
  where status in ('pending', 'error');

create or replace function public.protect_shopify_import_receipt()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (to_jsonb(new) - array['status','error','order_id','updated_at'])
    is distinct from (to_jsonb(old) - array['status','error','order_id','updated_at'])
    or (old.status = 'imported' and new is distinct from old) then
    raise exception 'Shopify import receipts cannot be replaced' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_shopify_import_receipt() from public, anon, authenticated;
create trigger protect_shopify_import_receipt before update on public.shopify_order_imports
  for each row execute function public.protect_shopify_import_receipt();

create or replace function public.protect_shopify_order_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
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
        or new.shopify_sync_token is not null then
        raise exception 'Shopify identity is managed by the integration' using errcode = '42501';
      end if;
    elsif row(new.order_source, new.shopify_shop_domain, new.shopify_order_id, new.shopify_order_name, new.shopify_email,
      new.shopify_line_items, new.shopify_fulfillment_id, new.shopify_sync_status, new.shopify_sync_error,
      new.shopify_synced_at, new.shopify_sync_started_at, new.shopify_sync_token)
      is distinct from row(old.order_source, old.shopify_shop_domain, old.shopify_order_id, old.shopify_order_name, old.shopify_email,
      old.shopify_line_items, old.shopify_fulfillment_id, old.shopify_sync_status, old.shopify_sync_error,
      old.shopify_synced_at, old.shopify_sync_started_at, old.shopify_sync_token) then
      raise exception 'Shopify identity is managed by the integration' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_shopify_order_identity() from public, anon, authenticated;
create trigger protect_shopify_order_identity before insert or update on public.orders
  for each row execute function public.protect_shopify_order_identity();

-- Shopify can discount an item to zero; its trusted paid receipt is the approval.
-- Preserve the existing pricing protection for every portal order.
create or replace function private.validate_order_item_price()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  if current_setting('app.restoring_order', true) = new.order_id::text then return new; end if;
  if new.unit_price_cents < 0 then
    raise exception 'Product price cannot be negative' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = new.order_id;
  if v_order.order_kind <> 'prospecting_sample' and v_order.order_source <> 'shopify' and new.unit_price_cents = 0 and not exists(
    select 1 from public.user_product_prices p where p.center_id = v_order.center_id
      and p.product_id = new.product_id and p.price_cents = 0 and p.allow_zero_price
  ) then raise exception 'Product price requires review; complimentary pricing must be explicitly approved' using errcode = '22023'; end if;
  return new;
end;
$$;

create or replace function public.save_shopify_order_import(
  p_shop_domain text, p_shopify_order_id text, p_shopify_order_name text, p_topic text, p_payload jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.shopify_order_imports(shop_domain, shopify_order_id, shopify_order_name, topic, payload)
    values (p_shop_domain, p_shopify_order_id, p_shopify_order_name, p_topic, p_payload)
    on conflict (shop_domain, shopify_order_id) do nothing returning id into v_id;
  if v_id is null then
    select id into strict v_id from public.shopify_order_imports
      where shop_domain = p_shop_domain and shopify_order_id = p_shopify_order_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_shopify_order_import(text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_shopify_order_import(text,text,text,text,jsonb) to service_role;

create or replace function public.import_shopify_order(p_order jsonb, p_items jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_receipt public.shopify_order_imports%rowtype;
  v_order_id uuid;
  v_item jsonb;
  v_total bigint := 0;
  v_line_items jsonb;
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
  select jsonb_agg(jsonb_build_object('line_item_id', value->>'shopify_line_item_id',
    'quantity', (value->>'qty')::int, 'product_id', value->>'product_id')) into v_line_items from jsonb_array_elements(p_items);
  insert into public.orders(order_source, shopify_shop_domain, shopify_order_id, shopify_order_name, shopify_email,
    shopify_line_items, invoice_status, status, order_kind, fulfillment_method,
    shipping_name, shipping_company, shipping_address1, shipping_address2, shipping_city, shipping_state, shipping_zip,
    shipping_country, notes, subtotal_cents, created_at)
  values ('shopify', v_receipt.shop_domain, v_receipt.shopify_order_id, v_receipt.shopify_order_name, p_order->>'shopify_email',
    v_line_items, 'not_required', 'New', 'standard', 'carrier',
    p_order->>'shipping_name', p_order->>'shipping_company', p_order->>'shipping_address1', p_order->>'shipping_address2',
    p_order->>'shipping_city', p_order->>'shipping_state', p_order->>'shipping_zip', p_order->>'shipping_country',
    p_order->>'notes', v_total, (p_order->>'created_at')::timestamptz) returning id into v_order_id;
  insert into public.order_items(order_id, product_id, product_name_snapshot, qty, unit_price_cents, line_total_cents)
  select v_order_id, (value->>'product_id')::uuid, value->>'product_name_snapshot',
    (value->>'qty')::int, (value->>'unit_price_cents')::int, (value->>'line_total_cents')::int from jsonb_array_elements(p_items);
  update public.shopify_order_imports set status = 'imported', order_id = v_order_id, error = null, updated_at = now()
    where id = v_receipt.id;
  return v_order_id;
end;
$$;
revoke all on function public.import_shopify_order(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.import_shopify_order(jsonb,jsonb) to service_role;

notify pgrst, 'reload schema';
