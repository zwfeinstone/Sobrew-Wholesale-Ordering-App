create table if not exists center_locations (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references centers(id) on delete cascade,
  name text not null,
  address1 text not null default '',
  address2 text,
  city text not null default '',
  state text not null default '',
  zip text not null default '',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists center_locations_center_id_idx on center_locations(center_id);
create index if not exists center_locations_active_center_idx on center_locations(center_id, is_active);

alter table center_locations enable row level security;

drop policy if exists "admin all center_locations" on center_locations;
create policy "admin all center_locations" on center_locations for all using (is_admin()) with check (is_admin());

drop policy if exists "self read active center_locations" on center_locations;
create policy "self read active center_locations" on center_locations for select using (
  is_active = true
  and center_id = current_center_id()
);

alter table orders
  add column if not exists center_location_id uuid references center_locations(id) on delete set null;

create index if not exists orders_center_location_id_idx on orders(center_location_id);

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
        and c.relname = 'center_locations'
    ) then
      alter publication supabase_realtime add table public.center_locations;
    end if;
  end if;
end $$;
