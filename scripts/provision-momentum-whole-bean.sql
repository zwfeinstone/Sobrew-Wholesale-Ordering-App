-- Add two fulfillment choices to Momentum's existing purchased allocation.
-- Apply shared_customer_stock_variants and deploy its application support first.
-- No new stock, raw consumption, sale, invoice, payment, or production is created.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

do $momentum_whole_bean$
declare
  v_center constant uuid := 'f5f284c6-cd7c-4a1b-9e4b-497fe7299837';
  v_user constant uuid := 'f2780be5-b012-4900-b3fd-69d39e56bc81';
  v_ground constant uuid := '54af36ea-36fe-40af-85c9-c2b9ff21b53e';
  v_allocation constant uuid := '1aa5cbb2-f424-4e65-8198-feab359d100f';
  v_order constant uuid := '973a468e-cbb4-4116-8282-6e9e18a6a410';
  v_sku constant text := 'MOMENTUM-CUSTOM-8OZ-WHOLE-BEAN-20261020';
  v_whole uuid;
  v_order_before jsonb;
  v_costs_before jsonb;
  v_quantity_before numeric;
  v_reservations_before jsonb;
  v_movements_before bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_sku, 0));
  perform 1 from public.products where id = v_ground for update;
  perform 1 from public.orders where id = v_order for update;
  perform 1 from public.customer_stock_allocations where id = v_allocation for update;
  perform 1 from public.inventory_items where product_id = v_ground for update;
  if not exists (select 1 from public.centers where id = v_center and name = 'Momentum Recovery' and is_active)
    or not exists (select 1 from public.profiles where id = v_user and center_id = v_center and is_active)
    or not exists (select 1 from public.customer_stock_allocations where id = v_allocation
      and center_id = v_center and product_id = v_ground and initial_order_id = v_order and initial_quantity = 1000)
    or not exists (select 1 from public.customer_stock_products where product_id = v_ground and allocation_id = v_allocation)
    or not exists (select 1 from public.products where id = v_ground and sku = 'MOMENTUM-CUSTOM-8OZ-20261020'
      and name in ('Custom 8-ounce bags', 'Custom 8-ounce bags - Ground') and active)
    or not exists (select 1 from public.orders where id = v_order and center_id = v_center and status = 'Shipped'
      and subtotal_cents = 690000 and quickbooks_invoice_id = '1761' and quickbooks_invoice_doc_number = 'SO-1522') then
    raise exception 'The verified Momentum batch identity changed; no variant was created';
  end if;
  select to_jsonb(o) into v_order_before from public.orders o where id = v_order;
  select jsonb_agg(to_jsonb(i) order by i.id) into v_costs_before from public.order_items i where order_id = v_order;
  select coalesce(sum(l.quantity_remaining),0) into v_quantity_before
    from public.inventory_lots l join public.inventory_items i on i.id=l.inventory_item_id where i.product_id=v_ground;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.order_item_id),'[]'::jsonb) into v_reservations_before
    from public.customer_stock_reservations r where r.allocation_id=v_allocation;
  select count(*) into v_movements_before from public.inventory_movements m
    join public.inventory_items i on i.id=m.inventory_item_id where i.product_id=v_ground;

  select id into v_whole from public.products where sku=v_sku for update;
  if found then
    if not exists (select 1 from public.products p join public.customer_stock_products m on m.product_id=p.id
      where p.id=v_whole and p.name='Custom 8-ounce bags - Whole Bean' and p.active
        and p.shipping_box_count_required and not p.receivable_finished_good and m.allocation_id=v_allocation) then
      raise exception 'Whole-bean SKU already exists without the expected shared allocation';
    end if;
  else
    insert into public.products (name,sku,description,category,active,shipping_box_count_required,receivable_finished_good)
      values ('Custom 8-ounce bags - Whole Bean',v_sku,
        'Meeting Coffee Medium Roast, whole bean. Shares your purchased custom 8-ounce bag balance with Ground. Held at Sobrew for delivery on request.',
        'retail',true,true,false) returning id into v_whole;
    insert into public.customer_stock_products (product_id,allocation_id) values (v_whole,v_allocation);
  end if;

  update public.products set name='Custom 8-ounce bags - Ground',
    description='Meeting Coffee Medium Roast, ground to order. Shares your purchased custom 8-ounce bag balance with Whole Bean. Held at Sobrew for delivery on request.',
    shipping_box_count_required=true,receivable_finished_good=false where id=v_ground;
  update public.inventory_items set name='Custom 8-ounce bags - Momentum Recovery (shared)',
    description='Customer-owned shared bag allocation for Ground and Whole Bean. Coffee is held whole bean and ground only when Ground is ordered. Original batch costs were recorded once; release stock has zero carrying cost.'
    where product_id=v_ground and item_type='finished_good';

  insert into public.user_products (center_id,user_id,product_id) values (v_center,v_user,v_whole)
    on conflict (center_id,product_id) do nothing;
  insert into public.user_product_prices (center_id,user_id,product_id,price_cents,allow_zero_price)
    values (v_center,v_user,v_whole,0,true)
    on conflict (center_id,product_id) do update set price_cents=0,allow_zero_price=true;

  if not exists (select 1 from public.user_product_prices where center_id=v_center and product_id=v_ground and price_cents=0 and allow_zero_price)
    or exists (select 1 from public.user_products where product_id in (v_ground,v_whole) and center_id<>v_center)
    or exists (select 1 from public.inventory_items where product_id=v_whole)
    or exists (select 1 from public.production_runs where product_id=v_whole)
    or (select count(*) from public.customer_stock_products where allocation_id=v_allocation)<>2 then
    raise exception 'Shared-stock catalog or physical inventory verification failed';
  end if;
  if (select to_jsonb(o) from public.orders o where id=v_order) is distinct from v_order_before
    or (select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where order_id=v_order) is distinct from v_costs_before
    or (select coalesce(sum(l.quantity_remaining),0) from public.inventory_lots l join public.inventory_items i on i.id=l.inventory_item_id where i.product_id=v_ground) is distinct from v_quantity_before
    or (select coalesce(jsonb_agg(to_jsonb(r) order by r.order_item_id),'[]'::jsonb) from public.customer_stock_reservations r where r.allocation_id=v_allocation) is distinct from v_reservations_before
    or (select count(*) from public.inventory_movements m join public.inventory_items i on i.id=m.inventory_item_id where i.product_id=v_ground)<>v_movements_before then
    raise exception 'Existing sale, costs, stock, or reservations changed; entire variant setup rolled back';
  end if;
  raise notice 'Momentum Ground and Whole Bean now share allocation %. Physical bags remain %.',v_allocation,v_quantity_before;
end;
$momentum_whole_bean$;
commit;

select p.id,p.name,p.sku,m.allocation_id,a.initial_quantity,u.price_cents,p.shipping_box_count_required
from public.customer_stock_products m
join public.customer_stock_allocations a on a.id=m.allocation_id
join public.products p on p.id=m.product_id
join public.user_product_prices u on u.product_id=p.id and u.center_id=a.center_id
where a.id='1aa5cbb2-f424-4e65-8198-feab359d100f' order by p.name;
