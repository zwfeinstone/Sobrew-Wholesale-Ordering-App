-- Customer-specific delivery changes use an editable saved location. Keep the
-- notice receipt after consumption so recurring source notes cannot repeat it.
create table private.center_order_delivery_updates (
  center_id uuid primary key references public.centers(id) on delete cascade,
  location_id uuid references public.center_locations(id) on delete set null,
  next_order_note text not null check (btrim(next_order_note) <> ''),
  noted_order_id uuid,
  created_at timestamptz not null default now()
);
create index center_order_delivery_updates_location_idx
  on private.center_order_delivery_updates(location_id);
alter table private.center_order_delivery_updates enable row level security;
revoke all on private.center_order_delivery_updates from public, anon, authenticated, service_role;

comment on table private.center_order_delivery_updates is
  'Operator-configured saved delivery location and one-time next standard-order notice. noted_order_id deliberately survives order deletion. No client access.';

create function private.apply_center_order_delivery_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_update private.center_order_delivery_updates%rowtype;
  v_location public.center_locations%rowtype;
begin
  if new.center_id is null or new.order_kind is distinct from 'standard'
    or current_setting('app.restoring_order', true) = new.id::text then
    return new;
  end if;
  if not exists (select 1 from private.center_order_delivery_updates where center_id = new.center_id) then
    return new;
  end if;

  -- Match the center-first lock order used by first-order receipts. RLS on the
  -- initiating order still authorizes its insertion; neither function is an RPC.
  perform 1 from public.centers where id = new.center_id for no key update;
  select * into v_update from private.center_order_delivery_updates
    where center_id = new.center_id for no key update;
  if not found then return new; end if;

  -- This trigger runs after recurring notes are copied. Remove only the exact
  -- reserved paragraph, preserving every other delivery/customer note.
  if new.notes is not null then
    new.notes := nullif(array_to_string(array(
      select paragraph
      from unnest(string_to_array(new.notes, E'\n\n')) with ordinality as parts(paragraph, position)
      where btrim(paragraph) <> v_update.next_order_note
      order by position
    ), E'\n\n'), '');
  end if;

  -- An explicitly selected different location remains authoritative.
  if new.center_location_id is not null and new.center_location_id is distinct from v_update.location_id then
    return new;
  end if;
  select * into v_location from public.center_locations
    where id = v_update.location_id and center_id = new.center_id and is_active;
  if not found then return new; end if;

  new.center_location_id := v_location.id;
  new.shipping_address1 := v_location.address1;
  new.shipping_address2 := v_location.address2;
  new.shipping_city := v_location.city;
  new.shipping_state := v_location.state;
  new.shipping_zip := v_location.zip;
  return new;
end;
$$;
revoke all on function private.apply_center_order_delivery_update() from public, anon, authenticated, service_role;

create function private.mark_center_order_delivery_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_note text;
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = new.order_id;
  if not found or v_order.center_id is null or v_order.order_kind is distinct from 'standard'
    or current_setting('app.restoring_order', true) = v_order.id::text then
    return new;
  end if;
  if not exists (select 1 from private.center_order_delivery_updates where center_id = v_order.center_id) then
    return new;
  end if;
  perform 1 from public.centers where id = v_order.center_id for no key update;

  -- Claim only after a real line item is saved. Some older order flows insert
  -- the header and items in separate transactions; a failed item batch must not
  -- consume the notice. Atomic checkout failures and skipped inserts are safe.
  update private.center_order_delivery_updates d
    set noted_order_id = v_order.id
    where d.center_id = v_order.center_id and d.noted_order_id is null
      and v_order.created_at >= d.created_at
      and d.location_id = v_order.center_location_id
      and exists (select 1 from public.center_locations l
        where l.id = d.location_id and l.center_id = v_order.center_id and l.is_active)
    returning d.next_order_note into v_note;
  if found then
    update public.orders
      set notes = concat_ws(E'\n\n', nullif(btrim(notes), ''), v_note)
      where id = v_order.id and center_id = v_order.center_id;
  end if;
  return new;
end;
$$;
revoke all on function private.mark_center_order_delivery_update() from public, anon, authenticated, service_role;

create trigger zz_apply_center_order_delivery_update before insert on public.orders
  for each row execute function private.apply_center_order_delivery_update();
create trigger zz_mark_center_order_delivery_update after insert on public.order_items
  for each row execute function private.mark_center_order_delivery_update();
