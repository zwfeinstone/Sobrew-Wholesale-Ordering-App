alter table user_products
  drop constraint if exists user_products_user_id_fkey;

alter table user_products
  alter column user_id drop not null;

update user_products
set user_id = null
where center_id is not null;

alter table user_products
  add constraint user_products_user_id_fkey
  foreign key (user_id) references profiles(id) on delete set null;

alter table user_product_prices
  drop constraint if exists user_product_prices_user_id_fkey;

alter table user_product_prices
  alter column user_id drop not null;

update user_product_prices
set user_id = null
where center_id is not null;

alter table user_product_prices
  add constraint user_product_prices_user_id_fkey
  foreign key (user_id) references profiles(id) on delete set null;
