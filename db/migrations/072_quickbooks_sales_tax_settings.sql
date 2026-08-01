alter table app_settings
  add column if not exists quickbooks_sales_tax_states text[] not null default array['TN']::text[];

update app_settings
set quickbooks_sales_tax_states = array(
  select distinct upper(trim(state_code))
  from unnest(coalesce(quickbooks_sales_tax_states, array['TN']::text[])) as state_code
  where upper(trim(state_code)) ~ '^[A-Z]{2}$'
)
where quickbooks_sales_tax_states is not null;

update app_settings
set quickbooks_sales_tax_states = array['TN']::text[]
where coalesce(array_length(quickbooks_sales_tax_states, 1), 0) = 0;

alter table centers
  add column if not exists customer_tax_status text not null default 'unknown',
  add column if not exists customer_tax_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'centers'::regclass
      and conname = 'centers_customer_tax_status_check'
  ) then
    alter table centers
      add constraint centers_customer_tax_status_check
      check (customer_tax_status in ('unknown', 'for_profit', 'tax_exempt'));
  end if;
end $$;

create index if not exists centers_customer_tax_status_idx
  on centers(customer_tax_status);

notify pgrst, 'reload schema';
