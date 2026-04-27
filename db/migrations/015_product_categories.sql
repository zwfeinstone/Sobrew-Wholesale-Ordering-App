alter table products
  add column if not exists category text;

alter table products
  drop constraint if exists products_category_check;

alter table products
  add constraint products_category_check
  check (
    category is null
    or category in ('k_cups', 'fraction_packs', 'whole_bean', 'filter_packs', 'ground', 'retail')
  );

create index if not exists products_category_idx on products(category);
