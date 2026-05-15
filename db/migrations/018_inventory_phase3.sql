create table if not exists inventory_center_par_levels (
  center_id uuid not null references centers(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  par_qty numeric(14, 4) not null default 0 check (par_qty >= 0),
  minimum_qty numeric(14, 4) not null default 0 check (minimum_qty >= 0),
  notes text,
  updated_at timestamptz not null default now(),
  primary key (center_id, product_id)
);

alter table inventory_center_par_levels enable row level security;

drop policy if exists "admin all inventory_center_par_levels" on inventory_center_par_levels;
create policy "admin all inventory_center_par_levels"
  on inventory_center_par_levels
  for all
  using (is_admin())
  with check (is_admin());

create index if not exists inventory_center_par_levels_product_idx
  on inventory_center_par_levels(product_id);

notify pgrst, 'reload schema';
