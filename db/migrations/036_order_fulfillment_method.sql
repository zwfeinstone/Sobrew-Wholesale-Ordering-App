alter table orders
  add column if not exists fulfillment_method text;

update orders
set fulfillment_method = 'carrier'
where fulfillment_method is null;

alter table orders
  alter column fulfillment_method set default 'carrier',
  alter column fulfillment_method set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_fulfillment_method_check'
      and conrelid = 'orders'::regclass
  ) then
    alter table orders
      add constraint orders_fulfillment_method_check
      check (fulfillment_method in ('carrier', 'local_delivery'));
  end if;
end $$;
