create table if not exists inventory_reorder_settings (
  inventory_item_id uuid primary key references inventory_items(id) on delete cascade,
  reorder_point numeric(14, 4) not null default 0 check (reorder_point >= 0),
  target_stock numeric(14, 4) not null default 0 check (target_stock >= 0),
  lead_time_days int not null default 14 check (lead_time_days >= 0),
  preferred_supplier text,
  notes text,
  updated_at timestamptz not null default now()
);

alter table inventory_reorder_settings enable row level security;

drop policy if exists "admin all inventory_reorder_settings" on inventory_reorder_settings;
create policy "admin all inventory_reorder_settings"
  on inventory_reorder_settings
  for all
  using (is_admin())
  with check (is_admin());

create index if not exists inventory_reorder_settings_lead_time_idx
  on inventory_reorder_settings(lead_time_days);

notify pgrst, 'reload schema';
