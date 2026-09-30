begin;

-- Only the new-customer wizard explicitly opts a customer into configured invoice
-- recipients. No default, data updates, or trigger may opt existing customers in.
alter table public.centers
  add column invoice_recipients_configured_at timestamptz;

comment on column public.centers.invoice_recipients_configured_at is
  'Set when invoice recipients are explicitly collected by the new-customer wizard. NULL preserves legacy invoice recipient rules; existing customers are never backfilled.';

alter table public.centers
  add constraint centers_configured_invoice_recipients_email_check
    check (
      invoice_recipients_configured_at is null
      or coalesce(billing_email ~ '[^[:space:]]', false)
    );

-- Existing centers grants and RLS policies continue to apply unchanged.
notify pgrst, 'reload schema';

commit;
