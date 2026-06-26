alter table orders
  add column if not exists donation_cogs_cents numeric(14, 4) not null default 0 check (donation_cogs_cents >= 0),
  add column if not exists processing_fee_cents numeric(14, 4) not null default 0 check (processing_fee_cents >= 0);

alter table order_items
  add column if not exists cogs_processing_fee_cents numeric(14, 4) check (cogs_processing_fee_cents is null or cogs_processing_fee_cents >= 0),
  add column if not exists cogs_donation_cents numeric(14, 4) check (cogs_donation_cents is null or cogs_donation_cents >= 0);

alter table order_commission_snapshots
  add column if not exists processing_fee_cogs_cents numeric(14, 4) not null default 0,
  add column if not exists donation_cogs_cents numeric(14, 4) not null default 0;

alter table monthly_commission_payouts
  add column if not exists processing_fee_cogs_cents numeric(14, 4) not null default 0,
  add column if not exists donation_cogs_cents numeric(14, 4) not null default 0,
  add column if not exists total_cogs_cents numeric(14, 4) not null default 0;

notify pgrst, 'reload schema';
