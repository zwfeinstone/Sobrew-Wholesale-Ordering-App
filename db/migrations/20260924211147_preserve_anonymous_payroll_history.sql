-- Historical wages and paid sales bonuses must survive staff account deletion.
-- A null profile identifies an anonymous historical record with no login access.
alter table public.admin_time_entries
  alter column profile_id drop not null,
  drop constraint admin_time_entries_profile_id_fkey,
  add constraint admin_time_entries_profile_id_fkey
    foreign key (profile_id) references public.profiles(id) on delete set null;

alter table public.admin_weekly_sales_spiffs
  alter column profile_id drop not null,
  drop constraint admin_weekly_sales_spiffs_profile_id_fkey,
  add constraint admin_weekly_sales_spiffs_profile_id_fkey
    foreign key (profile_id) references public.profiles(id) on delete set null;

notify pgrst, 'reload schema';
