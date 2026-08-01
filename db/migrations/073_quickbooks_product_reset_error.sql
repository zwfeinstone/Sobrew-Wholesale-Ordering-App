alter table app_settings
  add column if not exists quickbooks_product_reset_error text,
  add column if not exists quickbooks_product_reset_error_at timestamptz,
  add column if not exists quickbooks_product_reset_last_result jsonb;

notify pgrst, 'reload schema';
