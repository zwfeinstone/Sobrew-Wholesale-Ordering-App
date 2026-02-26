insert into products (name, description, sku)
values
 ('Cold Brew Concentrate', 'Classic concentrate', 'CB-001'),
 ('Nitro Keg', 'Nitro draft keg', 'NK-002')
on conflict (sku) do nothing;

-- sample assignment helper (replace user uuid)
-- insert into user_products(user_id, product_id)
-- select '<user-uuid>', id from products;
-- insert into user_product_prices(user_id, product_id, price_cents)
-- select '<user-uuid>', id, case when sku='CB-001' then 1250 else 2200 end from products;
