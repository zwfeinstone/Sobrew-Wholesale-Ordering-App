alter table orders
  add column if not exists invoice_status text not null default 'not_invoiced',
  add column if not exists quickbooks_invoice_id text,
  add column if not exists quickbooks_invoice_doc_number text,
  add column if not exists quickbooks_invoice_url text,
  add column if not exists invoiced_at timestamptz,
  add column if not exists invoice_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'orders'::regclass
      and conname = 'orders_invoice_status_check'
  ) then
    alter table orders
      add constraint orders_invoice_status_check
      check (invoice_status in ('not_invoiced', 'invoicing', 'invoiced', 'invoice_error'));
  end if;
end $$;

create index if not exists orders_invoice_queue_idx
  on orders(created_at desc)
  where status = 'Shipped'
    and quickbooks_invoice_id is null
    and archived_at is null;

create table if not exists quickbooks_connections (
  id text primary key default 'default',
  realm_id text not null,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz,
  connected_by uuid references profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table quickbooks_connections enable row level security;

drop policy if exists "owner all quickbooks_connections" on quickbooks_connections;
create policy "owner all quickbooks_connections"
  on quickbooks_connections
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

notify pgrst, 'reload schema';
