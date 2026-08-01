create sequence if not exists public.quickbooks_invoice_number_seq
  as bigint
  start with 1272
  increment by 1
  minvalue 1;

select setval(
  'public.quickbooks_invoice_number_seq',
  greatest(
    1271,
    coalesce((
      select max((regexp_match(quickbooks_invoice_doc_number, '^SO-([0-9]+)$'))[1]::bigint)
      from public.orders
      where quickbooks_invoice_doc_number ~ '^SO-[0-9]+$'
    ), 0),
    coalesce((
      select last_value
      from pg_sequences
      where schemaname = 'public'
        and sequencename = 'quickbooks_invoice_number_seq'
    ), 0)
  ),
  true
);

create or replace function public.assign_quickbooks_invoice_doc_number(order_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  existing_doc_number text;
  next_invoice_number bigint;
  assigned_doc_number text;
begin
  select quickbooks_invoice_doc_number
    into existing_doc_number
  from public.orders
  where id = order_id
  for update;

  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if btrim(coalesce(existing_doc_number, '')) <> '' then
    return existing_doc_number;
  end if;

  next_invoice_number := nextval('public.quickbooks_invoice_number_seq');
  assigned_doc_number := 'SO-' || next_invoice_number::text;

  update public.orders
  set quickbooks_invoice_doc_number = assigned_doc_number
  where id = order_id;

  return assigned_doc_number;
end;
$$;

revoke all on function public.assign_quickbooks_invoice_doc_number(uuid) from public, anon, authenticated;
grant execute on function public.assign_quickbooks_invoice_doc_number(uuid) to service_role;

revoke all on sequence public.quickbooks_invoice_number_seq from public, anon, authenticated;
grant usage, select, update on sequence public.quickbooks_invoice_number_seq to service_role;

notify pgrst, 'reload schema';
