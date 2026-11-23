-- Keep the existing product-category constraints and allow liquid coffee concentrate.
alter table public.products
  drop constraint if exists products_category_check;

alter table public.products
  add constraint products_category_check
  check (
    category is null
    or category in ('k_cups', 'fraction_packs', 'whole_bean', 'filter_packs', 'ground', 'retail', 'tea', 'concentrate', 'sample_boxes')
  );

-- Classify only the existing Christopher Bean Colombian case. This does not
-- assign it to any customer or change any pricing, recipe, or inventory.
update public.products
set category = 'concentrate'
where sku = 'CB-LCC-COL-30-1-2X64'
  and category is null;
