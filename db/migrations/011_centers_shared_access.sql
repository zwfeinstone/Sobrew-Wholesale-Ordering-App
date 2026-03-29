create table if not exists centers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

alter table centers enable row level security;

alter table profiles
  add column if not exists center_id uuid references centers(id) on delete set null;

insert into centers (id, name, notes, is_active, created_at)
select
  p.id,
  coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'Unnamed center'),
  p.notes,
  coalesce(p.is_active, true),
  coalesce(p.created_at, now())
from profiles p
where coalesce(p.is_admin, false) = false
  and p.center_id is null
  and not exists (select 1 from centers c where c.id = p.id);

update profiles
set center_id = id
where coalesce(is_admin, false) = false
  and center_id is null;

create index if not exists profiles_center_id_idx on profiles(center_id);

alter table user_products
  add column if not exists center_id uuid references centers(id) on delete cascade;

update user_products
set center_id = user_id
where center_id is null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'user_products'::regclass
      and conname = 'user_products_pkey'
  ) then
    alter table user_products drop constraint user_products_pkey;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'user_products'::regclass
      and conname = 'user_products_pkey'
  ) then
    alter table user_products add constraint user_products_pkey primary key (center_id, product_id);
  end if;
end $$;

create index if not exists user_products_user_id_idx on user_products(user_id);

alter table user_product_prices
  add column if not exists center_id uuid references centers(id) on delete cascade;

update user_product_prices
set center_id = user_id
where center_id is null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'user_product_prices'::regclass
      and conname = 'user_product_prices_pkey'
  ) then
    alter table user_product_prices drop constraint user_product_prices_pkey;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'user_product_prices'::regclass
      and conname = 'user_product_prices_pkey'
  ) then
    alter table user_product_prices add constraint user_product_prices_pkey primary key (center_id, product_id);
  end if;
end $$;

create index if not exists user_product_prices_user_id_idx on user_product_prices(user_id);

alter table orders
  add column if not exists center_id uuid references centers(id);

update orders
set center_id = user_id
where center_id is null;

create index if not exists orders_center_id_idx on orders(center_id);

alter table recurring_orders
  add column if not exists center_id uuid references centers(id);

update recurring_orders
set center_id = user_id
where center_id is null;

create index if not exists recurring_orders_center_id_idx on recurring_orders(center_id);

create or replace function current_center_id() returns uuid as $$
  select p.center_id
  from profiles p
  where p.id = auth.uid()
    and p.is_active = true
  limit 1;
$$ language sql stable security definer;

create or replace function public.guard_profile_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if is_admin() then
    return new;
  end if;

  if auth.uid() = old.id then
    if new.is_admin is distinct from old.is_admin
      or new.is_active is distinct from old.is_active
      or new.center_id is distinct from old.center_id then
      raise exception 'restricted profile update';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_self_update on profiles;
create trigger guard_profile_self_update
before update on profiles
for each row execute procedure public.guard_profile_self_update();

drop policy if exists "admin all centers" on centers;
create policy "admin all centers" on centers for all using (is_admin()) with check (is_admin());

drop policy if exists "self read center" on centers;
create policy "self read center" on centers for select using (id = current_center_id());

drop policy if exists "customer read assigned products" on products;
create policy "customer read assigned products" on products for select using (
  exists(select 1 from user_products up where up.center_id = current_center_id() and up.product_id = products.id)
);

drop policy if exists "self read user_products" on user_products;
create policy "self read user_products" on user_products for select using (center_id = current_center_id());

drop policy if exists "self read user_product_prices" on user_product_prices;
create policy "self read user_product_prices" on user_product_prices for select using (center_id = current_center_id());

drop policy if exists "self create orders" on orders;
create policy "self create orders" on orders for insert with check (
  center_id = current_center_id()
  and user_id = auth.uid()
);

drop policy if exists "self read orders" on orders;
create policy "self read orders" on orders for select using (center_id = current_center_id());

drop policy if exists "self read order_items" on order_items;
create policy "self read order_items" on order_items for select using (
  exists(select 1 from orders o where o.id = order_items.order_id and o.center_id = current_center_id())
);

drop policy if exists "self insert order_items" on order_items;
create policy "self insert order_items" on order_items for insert with check (
  exists(select 1 from orders o where o.id = order_items.order_id and o.center_id = current_center_id())
);

drop policy if exists "self create recurring_orders" on recurring_orders;
create policy "self create recurring_orders" on recurring_orders for insert with check (
  center_id = current_center_id()
  and user_id = auth.uid()
);

drop policy if exists "self read recurring_orders" on recurring_orders;
create policy "self read recurring_orders" on recurring_orders for select using (center_id = current_center_id());

drop policy if exists "self update recurring_orders" on recurring_orders;
create policy "self update recurring_orders" on recurring_orders for update using (center_id = current_center_id()) with check (center_id = current_center_id());

drop policy if exists "self delete recurring_orders" on recurring_orders;
create policy "self delete recurring_orders" on recurring_orders for delete using (center_id = current_center_id());

drop policy if exists "self read recurring_order_items" on recurring_order_items;
create policy "self read recurring_order_items" on recurring_order_items for select using (
  exists(select 1 from recurring_orders ro where ro.id = recurring_order_items.recurring_order_id and ro.center_id = current_center_id())
);

drop policy if exists "self create recurring_order_items" on recurring_order_items;
create policy "self create recurring_order_items" on recurring_order_items for insert with check (
  exists(select 1 from recurring_orders ro where ro.id = recurring_order_items.recurring_order_id and ro.center_id = current_center_id())
);

drop policy if exists "self update recurring_order_items" on recurring_order_items;
create policy "self update recurring_order_items" on recurring_order_items for update using (
  exists(select 1 from recurring_orders ro where ro.id = recurring_order_items.recurring_order_id and ro.center_id = current_center_id())
) with check (
  exists(select 1 from recurring_orders ro where ro.id = recurring_order_items.recurring_order_id and ro.center_id = current_center_id())
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c on c.oid = pr.prrelid
      join pg_namespace n on n.oid = c.relnamespace
      where p.pubname = 'supabase_realtime'
        and n.nspname = 'public'
        and c.relname = 'centers'
    ) then
      alter publication supabase_realtime add table public.centers;
    end if;
  end if;
end $$;
