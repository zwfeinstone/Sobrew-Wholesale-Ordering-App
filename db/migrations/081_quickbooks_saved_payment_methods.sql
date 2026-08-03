alter table quickbooks_connections
  add column if not exists scope text;

update quickbooks_connections
set scope = 'com.intuit.quickbooks.accounting'
where scope is null;

alter table centers
  add column if not exists quickbooks_payment_method_id text,
  add column if not exists quickbooks_payment_method_type text,
  add column if not exists quickbooks_payment_method_brand text,
  add column if not exists quickbooks_payment_method_last4 text,
  add column if not exists quickbooks_payment_method_exp_month text,
  add column if not exists quickbooks_payment_method_exp_year text,
  add column if not exists quickbooks_payment_method_note text,
  add column if not exists quickbooks_payment_method_updated_at timestamptz;

alter table orders
  add column if not exists quickbooks_payment_charge_id text,
  add column if not exists quickbooks_payment_id text,
  add column if not exists quickbooks_payment_status text,
  add column if not exists quickbooks_payment_method_label text,
  add column if not exists quickbooks_payment_method_type text,
  add column if not exists quickbooks_payment_error text,
  add column if not exists quickbooks_payment_charged_at timestamptz,
  add column if not exists quickbooks_receipt_email_to text,
  add column if not exists quickbooks_receipt_email_sent_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'centers'::regclass
      and conname = 'centers_quickbooks_payment_method_type_check'
  ) then
    alter table centers
      add constraint centers_quickbooks_payment_method_type_check
      check (
        quickbooks_payment_method_type is null
        or quickbooks_payment_method_type in ('card', 'bank_account', 'echeck')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'orders'::regclass
      and conname = 'orders_quickbooks_payment_method_type_check'
  ) then
    alter table orders
      add constraint orders_quickbooks_payment_method_type_check
      check (
        quickbooks_payment_method_type is null
        or quickbooks_payment_method_type in ('card', 'bank_account', 'echeck')
      );
  end if;
end $$;

create unique index if not exists orders_quickbooks_payment_charge_id_unique
  on orders(quickbooks_payment_charge_id)
  where quickbooks_payment_charge_id is not null;

create unique index if not exists orders_quickbooks_payment_id_unique
  on orders(quickbooks_payment_id)
  where quickbooks_payment_id is not null;

create index if not exists orders_quickbooks_payment_status_idx
  on orders(quickbooks_payment_status)
  where quickbooks_payment_status is not null;

create index if not exists centers_quickbooks_payment_method_idx
  on centers(quickbooks_payment_method_type)
  where quickbooks_payment_method_id is not null;

notify pgrst, 'reload schema';
