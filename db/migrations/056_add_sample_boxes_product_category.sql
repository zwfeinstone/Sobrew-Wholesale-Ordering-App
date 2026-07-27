alter table products
  drop constraint if exists products_category_check;

alter table products
  add constraint products_category_check
  check (
    category is null
    or category in ('k_cups', 'fraction_packs', 'whole_bean', 'filter_packs', 'ground', 'retail', 'sample_boxes')
  );
