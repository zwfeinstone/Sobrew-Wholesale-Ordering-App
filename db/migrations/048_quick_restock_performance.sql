-- Quick Restock foundation: authenticated catalog, atomic checkout, activity
-- throttling, recurring-order idempotency, and RLS/security hardening.

begin;

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

alter table public.recurring_orders
  add column if not exists next_run_at timestamptz;

alter table public.orders
  add column if not exists recurring_order_id uuid,
  add column if not exists recurring_scheduled_for timestamptz;

do $do$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_recurring_order_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_recurring_order_id_fkey
      foreign key (recurring_order_id)
      references public.recurring_orders(id)
      on delete set null;
  end if;
end
$do$;

create unique index if not exists orders_recurring_generation_unique
  on public.orders (recurring_order_id, recurring_scheduled_for)
  where recurring_order_id is not null
    and recurring_scheduled_for is not null;

create index if not exists recurring_orders_due_idx
  on public.recurring_orders (next_run_at, id)
  where status = 'active';

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and coalesce(p.is_admin, false) = true
      and coalesce(p.is_active, false) = true
  );
$function$;

create or replace function private.current_center_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select p.center_id
  from public.profiles p
  where p.id = (select auth.uid())
    and coalesce(p.is_active, false) = true
  limit 1;
$function$;

create or replace function private.is_owner_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and coalesce(p.is_admin, false) = true
      and (
        lower(coalesce(p.email, '')) = 'zach@sobrew.com'
        or (
          coalesce(p.is_superadmin, false) = true
          and coalesce(p.is_active, true) = true
        )
      )
  );
$function$;

revoke all on function private.is_admin() from public, anon;
revoke all on function private.current_center_id() from public, anon;
revoke all on function private.is_owner_admin() from public, anon;
grant execute on function private.is_admin() to authenticated, service_role;
grant execute on function private.current_center_id() to authenticated, service_role;
grant execute on function private.is_owner_admin() to authenticated, service_role;

-- Keep compatibility for existing policies and stored procedures while moving
-- the privileged reads out of the exposed public API schema.
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select private.is_admin();
$function$;

create or replace function public.current_center_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $function$
  select private.current_center_id();
$function$;

create or replace function public.is_owner_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select private.is_owner_admin();
$function$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.current_center_id() from public, anon;
revoke all on function public.is_owner_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.current_center_id() to authenticated, service_role;
grant execute on function public.is_owner_admin() to authenticated, service_role;

create or replace function private.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$function$;

create or replace function private.guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_user_id uuid := (select auth.uid());
begin
  if acting_user_id is null or private.is_admin() then
    return new;
  end if;

  if acting_user_id = old.id then
    if new.is_admin is distinct from old.is_admin
      or new.is_superadmin is distinct from old.is_superadmin
      or new.is_active is distinct from old.is_active
      or new.center_id is distinct from old.center_id then
      raise exception 'restricted profile update' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user_profile();

drop trigger if exists guard_profile_self_update on public.profiles;
create trigger guard_profile_self_update
before update on public.profiles
for each row execute function private.guard_profile_self_update();

drop function if exists public.handle_new_user_profile();
drop function if exists public.guard_profile_self_update();

-- The event trigger remains owner-only and is not callable through the API.
do $do$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$do$;

-- These two inventory RPCs intentionally remain callable by authenticated
-- admins. Both functions perform their own admin/superadmin check before any
-- write; anonymous execution is removed.
revoke all on function public.record_inventory_production_run(
  uuid, numeric, numeric, text, numeric, jsonb, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric
) from public, anon;
grant execute on function public.record_inventory_production_run(
  uuid, numeric, numeric, text, numeric, jsonb, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric
) to authenticated, service_role;

revoke all on function public.void_inventory_production_run(uuid, numeric, text)
  from public, anon;
grant execute on function public.void_inventory_production_run(uuid, numeric, text)
  to authenticated, service_role;

create or replace function private.recurring_days(frequency text)
returns integer
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case frequency
    when '1_week' then 7
    when '2_weeks' then 14
    when '3_weeks' then 21
    when '4_weeks' then 28
    when '5_weeks' then 35
    when '6_weeks' then 42
    else null
  end;
$function$;

-- Recurring schedules are calendar-based in America/Chicago. We store each
-- due date at noon UTC so daylight-saving changes cannot shift the date.
create or replace function private.next_recurring_run(
  anchor_at timestamptz,
  frequency text
)
returns timestamptz
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case
    when anchor_at is null or private.recurring_days(frequency) is null then null
    else (
      (
        (anchor_at at time zone 'America/Chicago')::date
        + private.recurring_days(frequency)
        + time '12:00:00'
      ) at time zone 'UTC'
    )
  end;
$function$;

create or replace function private.set_recurring_next_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  schedule_days integer := private.recurring_days(new.frequency);
  anchor_at timestamptz;
begin
  if schedule_days is null then
    raise exception 'Unsupported recurring frequency: %', new.frequency;
  end if;

  if tg_op = 'UPDATE'
    and new.status is not distinct from old.status
    and new.active is distinct from old.active then
    new.status := case when new.active then 'active' else 'paused' end;
  else
    new.active := new.status = 'active';
  end if;

  if new.status <> 'active' then
    new.next_run_at := null;
    return new;
  end if;

  if tg_op = 'INSERT' then
    anchor_at := coalesce(new.last_generated_at, new.created_at, now());
  elsif new.status is distinct from old.status then
    -- Resuming a paused schedule starts a fresh interval from today instead
    -- of generating every missed historical occurrence.
    anchor_at := now();
  else
    anchor_at := coalesce(new.last_generated_at, new.created_at, now());
  end if;

  -- Never trust a caller-supplied schedule timestamp. Every active schedule is
  -- derived from its canonical frequency and generation anchor on every write.
  new.next_run_at := private.next_recurring_run(anchor_at, new.frequency);

  return new;
end;
$function$;

drop trigger if exists set_recurring_next_run on public.recurring_orders;
create trigger set_recurring_next_run
before insert or update
on public.recurring_orders
for each row execute function private.set_recurring_next_run();

update public.recurring_orders ro
set next_run_at = case
  when ro.status = 'active' then private.next_recurring_run(
    coalesce(ro.last_generated_at, ro.created_at, now()),
    ro.frequency
  )
  else null
end,
active = ro.status = 'active'
where ro.next_run_at is null
   or (ro.next_run_at at time zone 'UTC')::time <> time '12:00:00'
   or ro.active is distinct from (ro.status = 'active');

create or replace view public.portal_catalog
with (security_invoker = true)
as
select
  p.id as product_id,
  p.name,
  p.description,
  p.image_url,
  p.category,
  price.price_cents as current_price_cents
from public.products p
join public.user_products assignment
  on assignment.product_id = p.id
 and assignment.center_id = public.current_center_id()
join public.user_product_prices price
  on price.product_id = p.id
 and price.center_id = assignment.center_id
where coalesce(p.active, false) = true;

revoke all on public.portal_catalog from public, anon;
grant select on public.portal_catalog to authenticated, service_role;

create or replace function public.touch_profile_last_seen()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_user_id uuid := (select auth.uid());
  touched_at timestamptz;
begin
  if acting_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.profiles p
  set last_seen_at = now()
  where p.id = acting_user_id
    and coalesce(p.is_active, false) = true
    and (p.last_seen_at is null or p.last_seen_at <= now() - interval '5 minutes')
  returning p.last_seen_at into touched_at;

  if touched_at is null then
    select p.last_seen_at
    into touched_at
    from public.profiles p
    where p.id = acting_user_id;
  end if;

  return touched_at;
end;
$function$;

revoke all on function public.touch_profile_last_seen() from public, anon;
grant execute on function public.touch_profile_last_seen() to authenticated;

create or replace function public.place_portal_order(
  submission_id uuid,
  location_id uuid,
  notes text,
  items jsonb
)
returns table (
  order_id uuid,
  center_location_id uuid,
  shipping_name text,
  shipping_address1 text,
  shipping_address2 text,
  shipping_city text,
  shipping_state text,
  shipping_zip text,
  subtotal_cents integer,
  placed_items jsonb,
  was_created boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_user_id uuid := (select auth.uid());
  requested_submission_id uuid := $1;
  requested_location_id uuid := $2;
  requested_notes text := nullif(left(trim(coalesce($3, '')), 5000), '');
  requested_items jsonb := $4;
  active_center_id uuid;
  center_name text;
  profile_name text;
  profile_email text;
  selected_location_id uuid;
  location_count integer := 0;
  requested_count integer := 0;
  valid_count integer := 0;
  calculated_subtotal_numeric numeric := 0;
  calculated_subtotal integer := 0;
  priced_items jsonb := '[]'::jsonb;
  created_order_id uuid;
  existing_order_id uuid;
  snapshot_name text;
  snapshot_address1 text;
  snapshot_address2 text;
  snapshot_city text;
  snapshot_state text;
  snapshot_zip text;
begin
  if acting_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if requested_submission_id is null then
    raise exception 'A submission ID is required' using errcode = '22023';
  end if;

  select o.id
  into existing_order_id
  from public.orders o
  where o.submission_id = requested_submission_id
    and o.user_id = acting_user_id
  limit 1;

  if existing_order_id is not null then
    return query
    select
      o.id,
      o.center_location_id,
      o.shipping_name,
      o.shipping_address1,
      o.shipping_address2,
      o.shipping_city,
      o.shipping_state,
      o.shipping_zip,
      o.subtotal_cents,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'product_id', item.product_id,
            'name', item.product_name_snapshot,
            'qty', item.qty,
            'price_cents', item.unit_price_cents,
            'line_total_cents', item.line_total_cents
          )
          order by item.id
        )
        from public.order_items item
        where item.order_id = o.id
      ), '[]'::jsonb),
      false
    from public.orders o
    where o.id = existing_order_id;
    return;
  end if;

  select
    p.center_id,
    c.name,
    p.full_name,
    p.email
  into
    active_center_id,
    center_name,
    profile_name,
    profile_email
  from public.profiles p
  join public.centers c
    on c.id = p.center_id
   and c.is_active = true
  where p.id = acting_user_id
    and p.is_active = true
  limit 1;

  if active_center_id is null then
    raise exception 'Active center assignment required' using errcode = '42501';
  end if;

  if requested_items is null
    or jsonb_typeof(requested_items) <> 'array'
    or jsonb_array_length(requested_items) = 0
    or jsonb_array_length(requested_items) > 100 then
    raise exception 'Cart must contain between 1 and 100 items' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(requested_items) entry(value)
    where jsonb_typeof(entry.value) <> 'object'
      or coalesce(entry.value ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not (
        case
          when coalesce(entry.value ->> 'qty', '') ~ '^[0-9]+$'
            then (entry.value ->> 'qty')::numeric between 1 and 9999
          else false
        end
      )
  ) then
    raise exception 'Every cart item requires a valid product and quantity' using errcode = '22023';
  end if;

  -- Resolve and materialize every server-authoritative price exactly once.
  -- The same snapshot supplies both the order subtotal and inserted line items.
  with requested as materialized (
    select
      (entry.value ->> 'product_id')::uuid as product_id,
      sum((entry.value ->> 'qty')::numeric) as qty
    from jsonb_array_elements(requested_items) entry(value)
    group by (entry.value ->> 'product_id')::uuid
  ),
  valid as materialized (
    select
      requested.product_id,
      requested.qty,
      product.name,
      price.price_cents,
      requested.qty * price.price_cents::numeric as line_total_cents
    from requested
    join public.user_products assignment
      on assignment.center_id = active_center_id
     and assignment.product_id = requested.product_id
    join public.user_product_prices price
      on price.center_id = active_center_id
     and price.product_id = requested.product_id
    join public.products product
      on product.id = requested.product_id
     and product.active = true
    where requested.qty between 1 and 9999
      and price.price_cents >= 0
  )
  select
    (select count(*)::integer from requested),
    (select count(*)::integer from valid),
    coalesce((select sum(valid.line_total_cents) from valid), 0),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product_id', valid.product_id,
          'name', valid.name,
          'qty', valid.qty::integer,
          'price_cents', valid.price_cents,
          'line_total_cents', valid.line_total_cents
        )
        order by valid.product_id
      )
      from valid
    ), '[]'::jsonb)
  into
    requested_count,
    valid_count,
    calculated_subtotal_numeric,
    priced_items;

  if requested_count = 0 or requested_count <> valid_count then
    raise exception 'Cart contains unavailable or unpriced products' using errcode = '22023';
  end if;

  if calculated_subtotal_numeric < 0
    or calculated_subtotal_numeric > 2147483647 then
    raise exception 'Order subtotal exceeds the supported amount' using errcode = '22003';
  end if;
  calculated_subtotal := calculated_subtotal_numeric::integer;

  select count(*)::integer
  into location_count
  from public.center_locations location
  where location.center_id = active_center_id
    and location.is_active = true;

  if location_count = 1 then
    select
      location.id,
      location.name,
      location.address1,
      location.address2,
      location.city,
      location.state,
      location.zip
    into
      selected_location_id,
      snapshot_name,
      snapshot_address1,
      snapshot_address2,
      snapshot_city,
      snapshot_state,
      snapshot_zip
    from public.center_locations location
    where location.center_id = active_center_id
      and location.is_active = true
    limit 1;
  elsif location_count > 1 then
    select
      location.id,
      location.name,
      location.address1,
      location.address2,
      location.city,
      location.state,
      location.zip
    into
      selected_location_id,
      snapshot_name,
      snapshot_address1,
      snapshot_address2,
      snapshot_city,
      snapshot_state,
      snapshot_zip
    from public.center_locations location
    where location.id = requested_location_id
      and location.center_id = active_center_id
      and location.is_active = true
    limit 1;

    if selected_location_id is null then
      raise exception 'A valid delivery location is required' using errcode = '22023';
    end if;
  else
    select
      o.shipping_name,
      o.shipping_address1,
      o.shipping_address2,
      o.shipping_city,
      o.shipping_state,
      o.shipping_zip
    into
      snapshot_name,
      snapshot_address1,
      snapshot_address2,
      snapshot_city,
      snapshot_state,
      snapshot_zip
    from public.orders o
    where o.center_id = active_center_id
    order by o.created_at desc
    limit 1;
  end if;

  snapshot_name := coalesce(
    nullif(trim(snapshot_name), ''),
    nullif(trim(center_name), ''),
    nullif(trim(profile_name), ''),
    profile_email,
    ''
  );
  snapshot_address1 := coalesce(snapshot_address1, '');
  snapshot_address2 := coalesce(snapshot_address2, '');
  snapshot_city := coalesce(snapshot_city, '');
  snapshot_state := coalesce(snapshot_state, '');
  snapshot_zip := coalesce(snapshot_zip, '');

  begin
    insert into public.orders (
      center_id,
      center_location_id,
      submission_id,
      user_id,
      shipping_name,
      shipping_address1,
      shipping_address2,
      shipping_city,
      shipping_state,
      shipping_zip,
      notes,
      subtotal_cents
    )
    values (
      active_center_id,
      selected_location_id,
      requested_submission_id,
      acting_user_id,
      snapshot_name,
      snapshot_address1,
      snapshot_address2,
      snapshot_city,
      snapshot_state,
      snapshot_zip,
      requested_notes,
      calculated_subtotal
    )
    returning id into created_order_id;
  exception when unique_violation then
    select o.id
    into existing_order_id
    from public.orders o
    where o.submission_id = requested_submission_id
      and o.user_id = acting_user_id
    limit 1;

    if existing_order_id is null then
      raise;
    end if;

    return query
    select
      o.id,
      o.center_location_id,
      o.shipping_name,
      o.shipping_address1,
      o.shipping_address2,
      o.shipping_city,
      o.shipping_state,
      o.shipping_zip,
      o.subtotal_cents,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'product_id', item.product_id,
            'name', item.product_name_snapshot,
            'qty', item.qty,
            'price_cents', item.unit_price_cents,
            'line_total_cents', item.line_total_cents
          )
          order by item.id
        )
        from public.order_items item
        where item.order_id = o.id
      ), '[]'::jsonb),
      false
    from public.orders o
    where o.id = existing_order_id;
    return;
  end;

  insert into public.order_items (
    order_id,
    product_id,
    product_name_snapshot,
    qty,
    unit_price_cents,
    line_total_cents
  )
  select
    created_order_id,
    item.product_id,
    item.name,
    item.qty,
    item.price_cents,
    item.line_total_cents
  from jsonb_to_recordset(priced_items) as item(
    product_id uuid,
    name text,
    qty integer,
    price_cents integer,
    line_total_cents integer
  );

  return query
  select
    o.id,
    o.center_location_id,
    o.shipping_name,
    o.shipping_address1,
    o.shipping_address2,
    o.shipping_city,
    o.shipping_state,
    o.shipping_zip,
    o.subtotal_cents,
    priced_items,
    true
  from public.orders o
  where o.id = created_order_id;
end;
$function$;

revoke all on function public.place_portal_order(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.place_portal_order(uuid, uuid, text, jsonb)
  to authenticated;

-- The cron calls one service-role-only RPC per occurrence. Row locking,
-- the recurring generation key, and the transaction surrounding this function
-- make overlapping cron invocations idempotent.
create or replace function public.generate_recurring_order(
  p_recurring_order_id uuid,
  p_scheduled_for timestamptz
)
returns table (
  order_id uuid,
  was_created boolean,
  scheduled_for timestamptz,
  center_id uuid,
  user_id uuid,
  center_location_id uuid,
  shipping_name text,
  shipping_address1 text,
  shipping_address2 text,
  shipping_city text,
  shipping_state text,
  shipping_zip text,
  subtotal_cents integer,
  placed_items jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  recurring_record public.recurring_orders%rowtype;
  source_record public.orders%rowtype;
  existing_order_id uuid;
  created_order_id uuid;
  scheduled_at timestamptz := p_scheduled_for;
  item_count integer := 0;
  valid_item_count integer := 0;
  calculated_subtotal_numeric numeric := 0;
  calculated_subtotal integer := 0;
  priced_items jsonb := '[]'::jsonb;
begin
  if p_recurring_order_id is null or scheduled_at is null then
    raise exception 'A recurring order and scheduled occurrence are required'
      using errcode = '22023';
  end if;

  select ro.*
  into recurring_record
  from public.recurring_orders ro
  where ro.id = p_recurring_order_id
  for update;

  if not found then
    raise exception 'Recurring order not found' using errcode = 'P0002';
  end if;

  -- Check the immutable occurrence key after taking the schedule row lock.
  -- A second invocation waits here, then returns the first invocation's order.
  select o.id
  into existing_order_id
  from public.orders o
  where o.recurring_order_id = recurring_record.id
    and o.recurring_scheduled_for = scheduled_at
  limit 1;

  if existing_order_id is not null then
    select count(*)::integer
    into item_count
    from public.order_items item
    where item.order_id = existing_order_id;

    if item_count = 0 then
      -- Repair an orphan left by the legacy multi-statement cron. Deleting it
      -- inside this transaction frees the occurrence key so it can be rebuilt
      -- atomically below; any failure rolls the delete back as well.
      delete from public.orders o where o.id = existing_order_id;
      existing_order_id := null;
    else
      if recurring_record.next_run_at is null
        or recurring_record.next_run_at <= scheduled_at then
        update public.recurring_orders ro
        set last_generated_at = scheduled_at
        where ro.id = recurring_record.id;
      end if;

      return query
      select
        o.id,
        false,
        scheduled_at,
        o.center_id,
        o.user_id,
        o.center_location_id,
        o.shipping_name,
        o.shipping_address1,
        o.shipping_address2,
        o.shipping_city,
        o.shipping_state,
        o.shipping_zip,
        o.subtotal_cents,
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'product_id', item.product_id,
              'name', item.product_name_snapshot,
              'qty', item.qty,
              'price_cents', item.unit_price_cents,
              'line_total_cents', item.line_total_cents
            )
            order by item.id
          )
          from public.order_items item
          where item.order_id = o.id
        ), '[]'::jsonb)
      from public.orders o
      where o.id = existing_order_id;
      return;
    end if;
  end if;

  if recurring_record.status <> 'active' then
    raise exception 'Recurring order is not active' using errcode = '55000';
  end if;

  if recurring_record.next_run_at is distinct from scheduled_at then
    raise exception 'Recurring schedule changed before generation'
      using errcode = '40001';
  end if;

  select o.*
  into source_record
  from public.orders o
  where o.id = recurring_record.source_order_id
    and o.center_id = recurring_record.center_id
  limit 1;

  if not found then
    raise exception 'Recurring source order not found' using errcode = 'P0002';
  end if;

  -- Prefer the recurring snapshot. Legacy schedules without one fall back to
  -- their source order. This CTE materializes the exact item snapshot used by
  -- both the subtotal and the inserted line items.
  with chosen_items as materialized (
    select
      item.product_id,
      item.product_name_snapshot,
      item.qty,
      item.unit_price_cents
    from public.recurring_order_items item
    where item.recurring_order_id = recurring_record.id

    union all

    select
      item.product_id,
      item.product_name_snapshot,
      item.qty,
      item.unit_price_cents
    from public.order_items item
    where item.order_id = recurring_record.source_order_id
      and not exists (
        select 1
        from public.recurring_order_items recurring_item
        where recurring_item.recurring_order_id = recurring_record.id
      )
  ),
  valid_items as materialized (
    select
      chosen.product_id,
      coalesce(chosen.product_name_snapshot, 'Unknown product') as product_name_snapshot,
      chosen.qty,
      chosen.unit_price_cents,
      chosen.qty::numeric * chosen.unit_price_cents::numeric as line_total_cents
    from chosen_items chosen
    where chosen.qty between 1 and 9999
      and chosen.unit_price_cents >= 0
  )
  select
    (select count(*)::integer from chosen_items),
    (select count(*)::integer from valid_items),
    coalesce((select sum(valid.line_total_cents) from valid_items valid), 0),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product_id', valid.product_id,
          'name', valid.product_name_snapshot,
          'qty', valid.qty,
          'price_cents', valid.unit_price_cents,
          'line_total_cents', valid.line_total_cents
        )
        order by valid.product_id, valid.product_name_snapshot
      )
      from valid_items valid
    ), '[]'::jsonb)
  into
    item_count,
    valid_item_count,
    calculated_subtotal_numeric,
    priced_items;

  if item_count = 0 or item_count <> valid_item_count then
    raise exception 'Recurring order contains invalid line items'
      using errcode = '23514';
  end if;

  if calculated_subtotal_numeric < 0
    or calculated_subtotal_numeric > 2147483647 then
    raise exception 'Recurring order subtotal exceeds the supported amount'
      using errcode = '22003';
  end if;
  calculated_subtotal := calculated_subtotal_numeric::integer;

  insert into public.orders (
    center_id,
    center_location_id,
    submission_id,
    user_id,
    shipping_name,
    shipping_address1,
    shipping_address2,
    shipping_city,
    shipping_state,
    shipping_zip,
    notes,
    subtotal_cents,
    recurring_order_id,
    recurring_scheduled_for
  )
  values (
    recurring_record.center_id,
    source_record.center_location_id,
    gen_random_uuid(),
    recurring_record.user_id,
    coalesce(source_record.shipping_name, ''),
    coalesce(source_record.shipping_address1, ''),
    coalesce(source_record.shipping_address2, ''),
    coalesce(source_record.shipping_city, ''),
    coalesce(source_record.shipping_state, ''),
    coalesce(source_record.shipping_zip, ''),
    format('Auto-generated recurring order (%s)', recurring_record.frequency),
    calculated_subtotal,
    recurring_record.id,
    scheduled_at
  )
  returning id into created_order_id;

  insert into public.order_items (
    order_id,
    product_id,
    product_name_snapshot,
    qty,
    unit_price_cents,
    line_total_cents
  )
  select
    created_order_id,
    item.product_id,
    item.name,
    item.qty,
    item.price_cents,
    item.line_total_cents
  from jsonb_to_recordset(priced_items) as item(
    product_id uuid,
    name text,
    qty integer,
    price_cents integer,
    line_total_cents integer
  );

  update public.recurring_orders ro
  set last_generated_at = scheduled_at
  where ro.id = recurring_record.id;

  return query
  select
    o.id,
    true,
    scheduled_at,
    o.center_id,
    o.user_id,
    o.center_location_id,
    o.shipping_name,
    o.shipping_address1,
    o.shipping_address2,
    o.shipping_city,
    o.shipping_state,
    o.shipping_zip,
    o.subtotal_cents,
    priced_items
  from public.orders o
  where o.id = created_order_id;
end;
$function$;

revoke all on function public.generate_recurring_order(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.generate_recurring_order(uuid, timestamptz)
  to service_role;

-- Customer checkout must use place_portal_order so pricing and order items
-- cannot be supplied through direct table inserts. Admin access remains
-- available through explicit admin policies; service_role continues to bypass
-- RLS for trusted server workflows.
drop policy if exists "admin all orders" on public.orders;
drop policy if exists "self create orders" on public.orders;
drop policy if exists "self read orders" on public.orders;
create policy "authenticated read orders"
  on public.orders
  for select
  to authenticated
  using (
    private.is_admin()
    or center_id = private.current_center_id()
  );
create policy "admin insert orders"
  on public.orders
  for insert
  to authenticated
  with check (private.is_admin());
create policy "admin update orders"
  on public.orders
  for update
  to authenticated
  using (private.is_admin())
  with check (private.is_admin());
create policy "admin delete orders"
  on public.orders
  for delete
  to authenticated
  using (private.is_admin());

drop policy if exists "admin all order_items" on public.order_items;
drop policy if exists "self create order_items" on public.order_items;
drop policy if exists "self insert order_items" on public.order_items;
drop policy if exists "self read order_items" on public.order_items;
create policy "authenticated read order_items"
  on public.order_items
  for select
  to authenticated
  using (
    private.is_admin()
    or exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.center_id = private.current_center_id()
    )
  );
create policy "admin insert order_items"
  on public.order_items
  for insert
  to authenticated
  with check (private.is_admin());
create policy "admin update order_items"
  on public.order_items
  for update
  to authenticated
  using (private.is_admin())
  with check (private.is_admin());
create policy "admin delete order_items"
  on public.order_items
  for delete
  to authenticated
  using (private.is_admin());

-- Protect last_seen_at and all authorization fields from arbitrary profile
-- updates. The throttled security-definer RPC is the only authenticated path
-- that can write last_seen_at; trusted admin mutations use service_role.
revoke update on table public.profiles from authenticated;
revoke update on table public.profiles from anon;
grant update (full_name, avatar_url, notes) on public.profiles to authenticated;

drop policy if exists "admin all profiles" on public.profiles;
drop policy if exists "self read profile" on public.profiles;
drop policy if exists "self update safe profile" on public.profiles;
create policy "authenticated read profiles"
  on public.profiles
  for select
  to authenticated
  using (
    private.is_admin()
    or id = (select auth.uid())
  );
create policy "authenticated update profiles"
  on public.profiles
  for update
  to authenticated
  using (
    private.is_admin()
    or (id = (select auth.uid()) and is_active = true)
  )
  with check (
    private.is_admin()
    or id = (select auth.uid())
  );
create policy "admin insert profiles"
  on public.profiles
  for insert
  to authenticated
  with check (private.is_admin());
create policy "admin delete profiles"
  on public.profiles
  for delete
  to authenticated
  using (private.is_admin());

-- Keep customer recurring management intact while fixing its auth initplan and
-- limiting every policy to authenticated traffic.
drop policy if exists "admin all recurring_orders" on public.recurring_orders;
drop policy if exists "self create recurring_orders" on public.recurring_orders;
drop policy if exists "self read recurring_orders" on public.recurring_orders;
drop policy if exists "self update recurring_orders" on public.recurring_orders;
drop policy if exists "self delete recurring_orders" on public.recurring_orders;
create policy "authenticated read recurring_orders"
  on public.recurring_orders
  for select
  to authenticated
  using (
    private.is_admin()
    or center_id = private.current_center_id()
  );
create policy "authenticated insert recurring_orders"
  on public.recurring_orders
  for insert
  to authenticated
  with check (
    private.is_admin()
    or (
      center_id = private.current_center_id()
      and user_id = (select auth.uid())
    )
  );
create policy "authenticated update recurring_orders"
  on public.recurring_orders
  for update
  to authenticated
  using (
    private.is_admin()
    or center_id = private.current_center_id()
  )
  with check (
    private.is_admin()
    or center_id = private.current_center_id()
  );
create policy "authenticated delete recurring_orders"
  on public.recurring_orders
  for delete
  to authenticated
  using (
    private.is_admin()
    or center_id = private.current_center_id()
  );

drop policy if exists "admin all recurring_order_items" on public.recurring_order_items;
drop policy if exists "self read recurring_order_items" on public.recurring_order_items;
drop policy if exists "self create recurring_order_items" on public.recurring_order_items;
drop policy if exists "self update recurring_order_items" on public.recurring_order_items;
create policy "authenticated read recurring_order_items"
  on public.recurring_order_items
  for select
  to authenticated
  using (
    private.is_admin()
    or exists (
      select 1
      from public.recurring_orders ro
      where ro.id = recurring_order_items.recurring_order_id
        and ro.center_id = private.current_center_id()
    )
  );
create policy "authenticated insert recurring_order_items"
  on public.recurring_order_items
  for insert
  to authenticated
  with check (
    private.is_admin()
    or exists (
      select 1
      from public.recurring_orders ro
      where ro.id = recurring_order_items.recurring_order_id
        and ro.center_id = private.current_center_id()
    )
  );
create policy "authenticated update recurring_order_items"
  on public.recurring_order_items
  for update
  to authenticated
  using (
    private.is_admin()
    or exists (
      select 1
      from public.recurring_orders ro
      where ro.id = recurring_order_items.recurring_order_id
        and ro.center_id = private.current_center_id()
    )
  )
  with check (
    private.is_admin()
    or exists (
      select 1
      from public.recurring_orders ro
      where ro.id = recurring_order_items.recurring_order_id
        and ro.center_id = private.current_center_id()
    )
  );

-- Explicitly repair the remaining production auth_rls_initplan warnings. These
-- policy definitions preserve the existing access matrix and avoid rewriting
-- unrelated or future policies dynamically.
drop policy if exists "self read admin_permissions" on public.admin_permissions;
create policy "self read admin_permissions"
  on public.admin_permissions for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "self read admin_audit_log" on public.admin_audit_log;
create policy "self read admin_audit_log"
  on public.admin_audit_log for select to authenticated
  using (
    actor_profile_id = (select auth.uid())
    or target_profile_id = (select auth.uid())
  );

drop policy if exists "self read admin_time_entries" on public.admin_time_entries;
create policy "self read admin_time_entries"
  on public.admin_time_entries for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "self insert admin_time_entries" on public.admin_time_entries;
create policy "self insert admin_time_entries"
  on public.admin_time_entries for insert to authenticated
  with check (profile_id = (select auth.uid()));

drop policy if exists "self update admin_time_entries" on public.admin_time_entries;
create policy "self update admin_time_entries"
  on public.admin_time_entries for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists "self read admin_time_breaks" on public.admin_time_breaks;
create policy "self read admin_time_breaks"
  on public.admin_time_breaks for select to authenticated
  using (
    exists (
      select 1
      from public.admin_time_entries e
      where e.id = admin_time_breaks.time_entry_id
        and e.profile_id = (select auth.uid())
    )
  );

drop policy if exists "self insert admin_time_breaks" on public.admin_time_breaks;
create policy "self insert admin_time_breaks"
  on public.admin_time_breaks for insert to authenticated
  with check (
    exists (
      select 1
      from public.admin_time_entries e
      where e.id = admin_time_breaks.time_entry_id
        and e.profile_id = (select auth.uid())
    )
  );

drop policy if exists "self update admin_time_breaks" on public.admin_time_breaks;
create policy "self update admin_time_breaks"
  on public.admin_time_breaks for update to authenticated
  using (
    exists (
      select 1
      from public.admin_time_entries e
      where e.id = admin_time_breaks.time_entry_id
        and e.profile_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.admin_time_entries e
      where e.id = admin_time_breaks.time_entry_id
        and e.profile_id = (select auth.uid())
    )
  );

drop policy if exists "self read admin_commission_settings" on public.admin_commission_settings;
create policy "self read admin_commission_settings"
  on public.admin_commission_settings for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "sales self read center_sales_assignments" on public.center_sales_assignments;
create policy "sales self read center_sales_assignments"
  on public.center_sales_assignments for select to authenticated
  using (sales_profile_id = (select auth.uid()));

drop policy if exists "sales self read order_commission_snapshots" on public.order_commission_snapshots;
create policy "sales self read order_commission_snapshots"
  on public.order_commission_snapshots for select to authenticated
  using (sales_profile_id = (select auth.uid()));

drop policy if exists "sales self read monthly_commission_payouts" on public.monthly_commission_payouts;
create policy "sales self read monthly_commission_payouts"
  on public.monthly_commission_payouts for select to authenticated
  using (sales_profile_id = (select auth.uid()));

drop policy if exists "self read admin_labor_tag_assignments" on public.admin_labor_tag_assignments;
create policy "self read admin_labor_tag_assignments"
  on public.admin_labor_tag_assignments for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "self read admin_time_entry_allocations" on public.admin_time_entry_allocations;
create policy "self read admin_time_entry_allocations"
  on public.admin_time_entry_allocations for select to authenticated
  using (
    exists (
      select 1
      from public.admin_time_entries e
      where e.id = admin_time_entry_allocations.time_entry_id
        and e.profile_id = (select auth.uid())
    )
  );

drop policy if exists "self read admin_center_assignments" on public.admin_center_assignments;
create policy "self read admin_center_assignments"
  on public.admin_center_assignments for select to authenticated
  using (profile_id = (select auth.uid()));

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated, service_role;
grant execute on function private.current_center_id() to authenticated, service_role;
grant execute on function private.is_owner_admin() to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
