create or replace function private.validate_order_item_price()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  if current_setting('app.restoring_order', true) = new.order_id::text then return new; end if;
  if new.unit_price_cents < 0 then
    raise exception 'Product price cannot be negative' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = new.order_id;
  if v_order.order_kind <> 'prospecting_sample' and new.unit_price_cents = 0 and not exists(
    select 1 from public.user_product_prices p where p.center_id = v_order.center_id
      and p.product_id = new.product_id and p.price_cents = 0 and p.allow_zero_price
  ) then raise exception 'Product price requires review; complimentary pricing must be explicitly approved' using errcode = '22023'; end if;
  return new;
end;
$$;
