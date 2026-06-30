begin;

create temporary table _standardized_products (
  id uuid primary key,
  name text not null,
  sku text not null,
  category text
) on commit drop;

insert into _standardized_products (id, name, sku, category) values
  ('efa0380f-adbc-4ff2-8952-7e638d74b136', 'Meeting Coffee Dark Roast Filter Pack - 40 x 2 oz', 'MTC-FILT-DRK-40X2OZ', 'filter_packs'),
  ('c1f26dd0-0278-4292-9fe0-9d7df2d32072', 'Meeting Coffee Medium Roast Filter Pack - 40 x 2 oz', 'MTC-FILT-MED-40X2OZ', 'filter_packs'),
  ('84e5f990-c59d-40c6-bcb0-5b1ca59386b8', 'Meeting Coffee Medium Roast Filter Pack - 40 x 1.4 oz', 'MTC-FILT-MED-40X1.4OZ', 'filter_packs'),
  ('ce89fee7-5ef8-4db3-b648-4391fecd6cc2', 'Meeting Coffee Medium Roast Fraction Pack - 100 x 2.5 oz', 'MTC-FP-MED-100X2.5OZ', 'fraction_packs'),
  ('229bc28a-828a-400e-af60-3d1c7f9996ba', 'Meeting Coffee Dark Roast Fraction Pack - 72 x 1.5 oz', 'MTC-FP-DRK-72X1.5OZ', 'fraction_packs'),
  ('467b2e99-f8c1-4586-b5d4-863e68ddbccd', 'Meeting Coffee Medium Roast Fraction Pack - 72 x 1.5 oz', 'MTC-FP-MED-72X1.5OZ', 'fraction_packs'),
  ('723faa63-d443-4aea-aa74-618ada1fb38b', 'Meeting Coffee Dark Roast Fraction Pack - 100 x 1.5 oz', 'MTC-FP-DRK-100X1.5OZ', 'fraction_packs'),
  ('f43ef720-2606-471d-81fc-1841da4ec5a7', 'Meeting Coffee Dark Roast Fraction Pack - 100 x 2.5 oz', 'MTC-FP-DRK-100X2.5OZ', 'fraction_packs'),
  ('f3ba6ecd-f042-41dd-b5c5-e999b0d10116', 'Meeting Coffee Dark Roast Fraction Pack - 96 x 2 oz', 'MTC-FP-DRK-96X2OZ', 'fraction_packs'),
  ('e40b0e0f-50f5-4df1-8059-768dc41cdf24', 'Meeting Coffee Dark Roast Fraction Pack - 40 x 3 oz', 'MTC-FP-DRK-40X3OZ', 'fraction_packs'),
  ('02f6e677-daee-45f2-9602-287056395a2d', 'Meeting Coffee Decaf Fraction Pack - 100 x 1.25 oz', 'MTC-FP-DEC-100X1.25OZ', 'fraction_packs'),
  ('fe3715ea-ee42-4fce-b3d8-a8efb42f9afb', 'Meeting Coffee Espresso Roast Fraction Pack - 96 x 2 oz', 'MTC-FP-ESP-96X2OZ', 'fraction_packs'),
  ('fe2d6842-2365-46d8-82c0-d3395a5402dd', 'Meeting Coffee French Roast Fraction Pack - 96 x 2 oz', 'MTC-FP-FR-96X2OZ', 'fraction_packs'),
  ('9fe45e0d-642d-4352-a51f-9af8404f436b', 'Meeting Coffee Medium Roast Fraction Pack - 100 x 1.5 oz', 'MTC-FP-MED-100X1.5OZ', 'fraction_packs'),
  ('d3f984ea-4adc-45f1-a370-dec6a2a2ca60', 'Meeting Coffee Medium Roast Fraction Pack - 96 x 2 oz', 'MTC-FP-MED-96X2OZ', 'fraction_packs'),
  ('2d6adc02-241e-4977-8b53-9bca16211d15', 'Meeting Coffee Medium Roast Fraction Pack - 40 x 3 oz', 'MTC-FP-MED-40X3OZ', 'fraction_packs'),
  ('4831edb5-81fa-4e9b-8118-15b8a409ef43', 'Meeting Coffee Dark Roast Fraction Pack - 72 x 2 oz', 'MTC-FP-DRK-72X2OZ', 'fraction_packs'),
  ('ebbefdb5-006c-4e94-a262-1ef09bf688ae', 'Meeting Coffee Medium Roast Fraction Pack - 20 x 3 oz', 'MTC-FP-MED-20X3OZ', 'fraction_packs'),
  ('f461d4a3-13e3-427c-806c-b35efa8a9d7b', 'Meeting Coffee Medium Roast Ground - 5 lb', 'MTC-GRD-MED-5LB', 'ground'),
  ('c215209e-9a41-4267-9b05-858a0a43fd81', 'Meeting Coffee Decaf Ground - 2 lb', 'MTC-GRD-DEC-2LB', 'ground'),
  ('77c0ef4a-bf60-4406-8094-5ad8e136ec17', 'Fourth Dimension Medium Roast Ground - 5 lb', 'FD-GRD-MED-5LB', 'ground'),
  ('518b91e2-8963-4a21-bfe9-9cac58b5902e', 'Meeting Coffee French Roast Ground - 5 lb', 'MTC-GRD-FR-5LB', 'ground'),
  ('f1f2821a-1976-427e-9218-ef0dfd1fe660', 'Meeting Coffee Dark Roast Ground - 2 lb', 'MTC-GRD-DRK-2LB', 'ground'),
  ('4dead316-3f4d-42fe-95d0-b3bb3b298295', 'Meeting Coffee Dark Roast Ground - 5 lb', 'MTC-GRD-DRK-5LB', 'ground'),
  ('f23108e4-df68-443a-a6ee-9851af181fe1', 'Meeting Coffee Medium Roast Ground - 2 lb', 'MTC-GRD-MED-2LB', 'ground'),
  ('ce39e101-13be-4210-8f90-2c7a9cc056cd', 'Meeting Coffee Medium Roast K-Cup - 50 ct', 'MTC-KCUP-MED-50CT', 'k_cups'),
  ('0a4ab6c2-becd-4de5-9b5f-85908941a36d', 'Meeting Coffee Dark Roast K-Cup - 50 ct', 'MTC-KCUP-DRK-50CT', 'k_cups'),
  ('4eba2ef4-51dc-46be-bee4-1b2be06e5220', 'Fourth Dimension Medium Roast K-Cup - 50 ct', 'FD-KCUP-MED-50CT', 'k_cups'),
  ('9d22c006-8c97-433c-89b9-8851b3aeba96', 'Styrofoam Cups - 12 oz - 1000 ct', 'RET-CUP-STYRO-12OZ-1000CT', 'retail'),
  ('02c4509d-5977-46e1-a56c-eef4796509cf', 'Fourth Dimension Medium Roast Ground - 12 oz', 'FD-GRD-MED-12OZ', 'retail'),
  ('06b399e2-d854-4a1f-9d84-a6c6b6cbf3c7', 'Fourth Dimension Medium Roast Whole Bean - 12 oz', 'FD-WB-MED-12OZ', 'retail'),
  ('903dfd6f-3678-4fae-9efe-e2d76d6617f2', 'Splenda Sweetener - 2000 ct', 'RET-SPLENDA-2000CT', 'retail'),
  ('b2f5ba92-2798-47f1-8d98-8b5e4d293eb7', 'Stirrers - 500 ct', 'RET-STIRRER-500CT', 'retail'),
  ('1e8a33fb-2167-4d16-a469-3c6cd66dc28a', 'Meeting Coffee Dark Roast Decaf Whole Bean - 5 lb', 'MTC-WB-DRK-DEC-5LB', 'whole_bean'),
  ('bd73af03-9097-4640-b428-7e5dd55bc221', 'Meeting Coffee Cinnamon Vanilla Whole Bean - 5 lb', 'MTC-WB-CIN-VAN-5LB', 'whole_bean'),
  ('3842920a-0623-4eef-8de8-8b21186925f9', 'Fourth Dimension Medium Roast Whole Bean - 5 lb', 'FD-WB-MED-5LB', 'whole_bean'),
  ('d8c21884-f550-4794-ad69-40a7695aabb1', 'Meeting Coffee Dark Roast Whole Bean - 5 lb', 'MTC-WB-DRK-5LB', 'whole_bean'),
  ('3e22be85-80a1-4ea2-9146-2b26534aaff7', 'Meeting Coffee Medium Roast Whole Bean - 5 lb', 'MTC-WB-MED-5LB', 'whole_bean'),
  ('c543f167-c503-4201-9655-f73ba8997b77', 'Meeting Coffee Cold Brew Concentrate', 'MTC-CB-CONC', null),
  ('4e86ce7f-2f9a-4336-9d46-4e80579af9f3', 'Meeting Coffee Nitro Keg', 'MTC-NITRO-KEG', null);

create temporary table _standardized_inventory_items (
  id uuid primary key,
  name text not null,
  sku text not null
) on commit drop;

insert into _standardized_inventory_items (id, name, sku) values
  ('ec004948-21e9-4492-86d7-ad190f6ff286', 'Box - 16 x 16 x 6', 'MAT-BOX-16X16X6'),
  ('755567d5-8e48-4253-bf56-ee4431e1919f', 'Bag - 2 lb', 'MAT-BAG-2LB'),
  ('a34d9b8e-ce7b-42b5-9210-50079af0b464', 'Bag - 5 lb', 'MAT-BAG-5LB'),
  ('4a253ef0-0edb-4780-8552-a91017361691', 'Box - 12 x 12 x 10', 'MAT-BOX-12X12X10'),
  ('d357a288-3210-4159-8d07-f54cac3a2401', 'Box - 12 x 7 x 4', 'MAT-BOX-12X7X4'),
  ('fc0c0638-2be2-422b-92fd-746ff307447e', 'Box - 14 x 14 x 14', 'MAT-BOX-14X14X14'),
  ('6f5ab1da-a620-4d7e-8d8b-0ce5fab17400', 'Box - 16 x 16 x 16', 'MAT-BOX-16X16X16'),
  ('29d152cc-80ca-4fbb-be5d-7d1e0300c08f', 'Filter Pack Bag', 'MAT-BAG-FILTER-PACK'),
  ('a05bd5a2-e444-4dae-9a95-8aa89e057a7c', 'Fraction Pack Bag', 'MAT-BAG-FRACTION-PACK'),
  ('9a880325-e652-4074-aa8d-fe7322bec45c', 'K-Cup Pod', 'MAT-KCUP-POD'),
  ('f97078b7-de31-4499-ad3a-3be6d7d9c1f8', 'Tape', 'MAT-TAPE'),
  ('d346f894-876c-4387-baa3-4ac2e7948812', 'Raw Coffee - Decaf', 'RAW-COF-DEC'),
  ('92a28719-5387-4ca1-9619-c3d06ff5d7a3', 'Raw Coffee - Fourth Dimension Medium Roast', 'RAW-COF-FD-MED'),
  ('a8855392-9e3b-4455-a377-2c198a8be8cd', 'Raw Coffee - Meeting Coffee Dark Roast', 'RAW-COF-MTC-DRK'),
  ('bcdfd4f2-db80-4260-aa7c-13715f6544e1', 'Raw Coffee - Meeting Coffee Medium Roast', 'RAW-COF-MTC-MED');

-- Free the duplicate product's old SKU before the surviving product receives its final SKU.
update products
set sku = 'DUP-MERGE-E568CB2A'
where id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d';

insert into user_products (center_id, product_id)
select center_id, 'd8c21884-f550-4794-ad69-40a7695aabb1'::uuid
from user_products
where product_id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d'
on conflict (center_id, product_id) do nothing;

delete from user_products
where product_id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d';

insert into user_product_prices (center_id, product_id, price_cents)
select center_id, 'd8c21884-f550-4794-ad69-40a7695aabb1'::uuid, price_cents
from user_product_prices
where product_id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d'
on conflict (center_id, product_id) do nothing;

delete from user_product_prices
where product_id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d';

insert into inventory_center_par_levels (center_id, product_id, par_qty, minimum_qty, notes, updated_at)
select center_id, 'd8c21884-f550-4794-ad69-40a7695aabb1'::uuid, par_qty, minimum_qty, notes, updated_at
from inventory_center_par_levels
where product_id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d'
on conflict (center_id, product_id) do nothing;

delete from inventory_center_par_levels
where product_id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d';

update order_items
set product_id = 'd8c21884-f550-4794-ad69-40a7695aabb1'
where product_id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d';

update recurring_order_items
set product_id = 'd8c21884-f550-4794-ad69-40a7695aabb1'
where product_id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d';

update production_runs
set product_id = 'd8c21884-f550-4794-ad69-40a7695aabb1'
where product_id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d';

update sample_box_template_items
set product_id = 'd8c21884-f550-4794-ad69-40a7695aabb1'
where product_id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d';

update sample_box_run_items
set product_id = 'd8c21884-f550-4794-ad69-40a7695aabb1'
where product_id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d';

update inventory_items
set product_id = 'd8c21884-f550-4794-ad69-40a7695aabb1'
where product_id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d'
  and not exists (
    select 1
    from inventory_items existing
    where existing.product_id = 'd8c21884-f550-4794-ad69-40a7695aabb1'
  );

delete from product_recipes
where product_id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d';

delete from products
where id = 'e568cb2a-9910-41f8-b94c-f063dcf5e29d';

update products as product
set
  name = standardized.name,
  sku = standardized.sku,
  category = standardized.category
from _standardized_products as standardized
where product.id = standardized.id;

update inventory_items as item
set
  name = standardized.name,
  sku = standardized.sku
from _standardized_inventory_items as standardized
where item.id = standardized.id;

update inventory_items as item
set
  name = standardized.name,
  sku = 'FIN-' || standardized.sku
from _standardized_products as standardized
where item.product_id = standardized.id
  and item.item_type = 'finished_good';

do $$
begin
  if exists (
    select 1
    from products
    group by sku
    having count(*) > 1
  ) then
    raise exception 'Duplicate product SKU detected after standardization.';
  end if;

  if exists (
    select 1
    from inventory_items
    group by sku
    having count(*) > 1
  ) then
    raise exception 'Duplicate inventory item SKU detected after standardization.';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
