alter table orders
  add column if not exists quickbooks_invoice_email_to text,
  add column if not exists quickbooks_invoice_email_sent_at timestamptz;

notify pgrst, 'reload schema';
