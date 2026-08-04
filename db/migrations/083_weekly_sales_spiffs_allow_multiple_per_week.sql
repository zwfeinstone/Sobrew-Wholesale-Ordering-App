alter table public.admin_weekly_sales_spiffs
  drop constraint if exists admin_weekly_sales_spiffs_profile_id_week_start_date_week_e_key;

notify pgrst, 'reload schema';
