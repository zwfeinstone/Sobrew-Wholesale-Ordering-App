alter table products
  add column if not exists quickbooks_item_id text,
  add column if not exists quickbooks_item_name text,
  add column if not exists quickbooks_item_type text,
  add column if not exists quickbooks_sync_status text not null default 'unmapped',
  add column if not exists quickbooks_synced_at timestamptz,
  add column if not exists quickbooks_sync_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'products'::regclass
      and conname = 'products_quickbooks_sync_status_check'
  ) then
    alter table products
      add constraint products_quickbooks_sync_status_check
      check (quickbooks_sync_status in ('unmapped', 'matched', 'created', 'ignored', 'sync_error'));
  end if;
end $$;

create unique index if not exists products_quickbooks_item_id_unique
  on products(quickbooks_item_id)
  where quickbooks_item_id is not null;

create index if not exists products_quickbooks_sync_status_idx
  on products(quickbooks_sync_status);

alter table centers
  add column if not exists quickbooks_customer_id text,
  add column if not exists quickbooks_display_name text,
  add column if not exists quickbooks_company_name text,
  add column if not exists quickbooks_fully_qualified_name text,
  add column if not exists legal_name text,
  add column if not exists billing_email text,
  add column if not exists billing_phone text,
  add column if not exists billing_address1 text,
  add column if not exists billing_address2 text,
  add column if not exists billing_city text,
  add column if not exists billing_state text,
  add column if not exists billing_zip text,
  add column if not exists quickbooks_sync_status text not null default 'unmapped',
  add column if not exists quickbooks_synced_at timestamptz,
  add column if not exists quickbooks_sync_error text,
  add column if not exists quickbooks_mapping_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'centers'::regclass
      and conname = 'centers_quickbooks_sync_status_check'
  ) then
    alter table centers
      add constraint centers_quickbooks_sync_status_check
      check (quickbooks_sync_status in ('unmapped', 'matched', 'created', 'ignored', 'sync_error'));
  end if;
end $$;

create unique index if not exists centers_quickbooks_customer_id_unique
  on centers(quickbooks_customer_id)
  where quickbooks_customer_id is not null;

create index if not exists centers_quickbooks_sync_status_idx
  on centers(quickbooks_sync_status);

notify pgrst, 'reload schema';
