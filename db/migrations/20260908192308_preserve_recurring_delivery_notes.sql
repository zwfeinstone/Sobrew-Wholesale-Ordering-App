create or replace function private.copy_recurring_delivery_notes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_notes text;
begin
  if current_setting('app.restoring_order',true) = new.id::text then return new; end if;
  if new.recurring_order_id is not null and new.notes like 'Auto-generated recurring order (%' then
    select o.notes into v_notes from public.recurring_orders r join public.orders o on o.id=r.source_order_id where r.id=new.recurring_order_id;
    if nullif(btrim(v_notes),'') is not null then new.notes := concat_ws(E'\n\n',v_notes,new.notes); end if;
  end if;
  return new;
end;
$$;
revoke all on function private.copy_recurring_delivery_notes() from public, anon, authenticated;
create trigger copy_recurring_delivery_notes before insert on public.orders
  for each row execute function private.copy_recurring_delivery_notes();
