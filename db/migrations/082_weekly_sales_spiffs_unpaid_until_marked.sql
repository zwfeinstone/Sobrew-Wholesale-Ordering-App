alter table public.admin_weekly_sales_spiffs
  alter column paid_at drop default,
  alter column paid_at drop not null;

notify pgrst, 'reload schema';
