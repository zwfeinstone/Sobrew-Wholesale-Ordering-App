create extension if not exists "pgcrypto";

create table if not exists app_settings (
  id uuid primary key default gen_random_uuid(),
  brand_name text,
  logo_url text,
  accent_color text,
  hero_image_url text,
  bootstrap_completed boolean default false,
  updated_at timestamptz default now()
);

insert into app_settings (brand_name, accent_color)
select 'Sobrew', '#7c3aed'
where not exists (select 1 from app_settings);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  notes text,
  is_admin boolean default false,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  sku text unique not null,
  image_url text,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists user_products (
  user_id uuid references profiles(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  primary key (user_id, product_id)
);

create table if not exists user_product_prices (
  user_id uuid references profiles(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  price_cents int not null check (price_cents >= 0),
  primary key (user_id, product_id)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  status text check (status in ('New','Processing','Shipped')) default 'New',
  shipping_name text,
  shipping_address1 text,
  shipping_address2 text,
  shipping_city text,
  shipping_state text,
  shipping_zip text,
  notes text,
  subtotal_cents int not null default 0,
  created_at timestamptz default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  product_id uuid references products(id),
  product_name_snapshot text,
  qty int not null,
  unit_price_cents int not null,
  line_total_cents int not null
);

alter table app_settings enable row level security;
alter table profiles enable row level security;
alter table products enable row level security;
alter table user_products enable row level security;
alter table user_product_prices enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

create or replace function is_admin() returns boolean as $$
  select exists(select 1 from profiles p where p.id = auth.uid() and p.is_admin = true and p.is_active = true);
$$ language sql stable security definer;

create policy "admin all app_settings" on app_settings for all using (is_admin()) with check (is_admin());

create policy "admin all profiles" on profiles for all using (is_admin()) with check (is_admin());
create policy "self read profile" on profiles for select using (id = auth.uid());
create policy "self update safe profile" on profiles for update using (id = auth.uid() and is_active = true) with check (id = auth.uid());

create policy "admin all products" on products for all using (is_admin()) with check (is_admin());
create policy "customer read assigned products" on products for select using (
  exists(select 1 from user_products up where up.user_id = auth.uid() and up.product_id = products.id)
);

create policy "admin all user_products" on user_products for all using (is_admin()) with check (is_admin());
create policy "self read user_products" on user_products for select using (user_id = auth.uid());

create policy "admin all user_product_prices" on user_product_prices for all using (is_admin()) with check (is_admin());
create policy "self read user_product_prices" on user_product_prices for select using (user_id = auth.uid());

create policy "admin all orders" on orders for all using (is_admin()) with check (is_admin());
create policy "self create orders" on orders for insert with check (user_id = auth.uid());
create policy "self read orders" on orders for select using (user_id = auth.uid());

create policy "admin all order_items" on order_items for all using (is_admin()) with check (is_admin());
create policy "self read order_items" on order_items for select using (
  exists(select 1 from orders o where o.id = order_items.order_id and o.user_id = auth.uid())
);

create or replace function public.handle_new_user_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();
