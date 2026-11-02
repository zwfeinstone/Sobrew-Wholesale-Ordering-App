-- Customers manage their own active center's address book through the session
-- client. Existing admin policies continue to govern admin location management.
create or replace function private.customer_location_center_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $function$
  select p.center_id
  from public.profiles p
  join public.centers c on c.id = p.center_id
  where p.id = (select auth.uid())
    and p.is_active = true
    and p.is_admin = false
    and c.is_active = true;
$function$;

revoke all on function private.customer_location_center_id() from public, anon;
grant execute on function private.customer_location_center_id() to authenticated, service_role;

create or replace function private.guard_customer_location_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if private.is_admin() then
    return new;
  end if;

  if (select auth.uid()) is null
    or new.center_id is distinct from private.customer_location_center_id() then
    raise exception 'You may only save locations for your active customer account.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if row(new.id, new.center_id, new.is_active, new.created_at, new.notes)
      is distinct from row(old.id, old.center_id, old.is_active, old.created_at, old.notes) then
      raise exception 'Location identity, status, and internal notes cannot be changed by customers.' using errcode = '42501';
    end if;
    if old.is_active is distinct from true then
      raise exception 'Inactive locations cannot be edited by customers.' using errcode = '42501';
    end if;
  else
    if new.is_active is distinct from true or new.notes is not null then
      raise exception 'New customer locations must be active and cannot contain internal notes.' using errcode = '42501';
    end if;
    -- Do not trust caller-supplied identifiers or creation timestamps.
    new.id := gen_random_uuid();
    new.created_at := statement_timestamp();
  end if;

  -- Reject control characters before trimming so API callers cannot sneak
  -- multiline/tab-delimited values past the same rules used by the form.
  if concat_ws('', new.name, new.address1, new.address2, new.city, new.state, new.zip)
    ~ E'[\\x01-\\x1F\\x7F]' then
    raise exception 'Location names and shipping addresses cannot contain control characters.' using errcode = '22023';
  end if;

  new.name := btrim(new.name);
  new.address1 := btrim(new.address1);
  new.address2 := nullif(btrim(new.address2), '');
  new.city := btrim(new.city);
  new.state := upper(btrim(new.state));
  new.zip := btrim(new.zip);

  if coalesce(char_length(new.name), 0) not between 1 and 100
    or coalesce(char_length(new.address1), 0) not between 1 and 200
    or coalesce(char_length(new.address2), 0) > 200
    or coalesce(char_length(new.city), 0) not between 1 and 100
    or not coalesce(new.state = any(array[
      'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
      'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
      'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
      'VT','VA','WA','WV','WI','WY','AS','GU','MP','PR','VI','AA','AE','AP'
    ]), false)
    or not coalesce(new.zip ~ '^[0-9]{5}(-[0-9]{4})?$', false) then
    raise exception 'Enter a location name and complete US shipping address with a valid state and ZIP code.' using errcode = '22023';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

revoke all on function private.guard_customer_location_write() from public, anon, authenticated, service_role;
drop trigger if exists guard_customer_location_write on public.center_locations;
create trigger guard_customer_location_write
  before insert or update on public.center_locations
  for each row execute function private.guard_customer_location_write();

alter table public.center_locations enable row level security;
revoke all on public.center_locations from public, anon;
-- TRUNCATE bypasses RLS and must not become a customer deletion path.
revoke truncate on public.center_locations from authenticated;
grant select, insert, update on public.center_locations to authenticated;

drop policy if exists "self read active center_locations" on public.center_locations;
create policy "self read active center_locations"
  on public.center_locations for select to authenticated
  using (is_active = true and center_id = (select private.customer_location_center_id()));

create policy "customer create own active center_locations"
  on public.center_locations for insert to authenticated
  with check (is_active = true and center_id = (select private.customer_location_center_id()));

create policy "customer update own active center_locations"
  on public.center_locations for update to authenticated
  using (is_active = true and center_id = (select private.customer_location_center_id()))
  with check (is_active = true and center_id = (select private.customer_location_center_id()));

-- Recurring orders keep a new address snapshot when generated. Historical
-- orders and restores retain their original snapshot; manual checkout keeps
-- the address chosen during checkout.
create or replace function private.apply_recurring_saved_location()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_location public.center_locations%rowtype;
begin
  if new.recurring_order_id is null or new.order_kind is distinct from 'standard'
    or current_setting('app.restoring_order', true) = new.id::text then
    return new;
  end if;

  select l.* into v_location
  from public.center_locations l
  join public.centers c on c.id = l.center_id and c.is_active = true
  where l.id = new.center_location_id
    and l.center_id = new.center_id
    and l.is_active = true;
  if not found then return new; end if;

  new.shipping_name := v_location.name;
  new.shipping_address1 := v_location.address1;
  new.shipping_address2 := v_location.address2;
  new.shipping_city := v_location.city;
  new.shipping_state := v_location.state;
  new.shipping_zip := v_location.zip;
  return new;
end;
$function$;

revoke all on function private.apply_recurring_saved_location() from public, anon, authenticated, service_role;
-- The existing zz_apply_center_order_delivery_update trigger may set an
-- operator-configured default location. Use its final selection and preserve
-- its delivery notes; an explicitly selected different location wins there.
create trigger zzz_apply_recurring_saved_location
  before insert on public.orders
  for each row execute function private.apply_recurring_saved_location();
