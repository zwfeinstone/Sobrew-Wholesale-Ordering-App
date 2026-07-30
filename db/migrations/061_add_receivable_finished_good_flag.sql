alter table products
  add column if not exists receivable_finished_good boolean not null default false;

update products
set receivable_finished_good = true
where sku = 'TEA-SWEET-3.3LBX8';
