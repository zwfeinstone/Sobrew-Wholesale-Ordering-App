begin;

alter table public.centers
  add column automatic_invoice_only boolean not null default false;

comment on column public.centers.automatic_invoice_only is
  'When true, shipping automation sends a QuickBooks PDF invoice without automatically charging saved payment information. Managed later in the customer file; new customers default to false.';

-- Preserve the two customers already designated for invoice-only automation.
-- CooperRiis is stored under its full name, CooperRiis Healing Community.
-- This is a one-time transfer of those exceptions into an editable setting,
-- not a name-based default or trigger for future customers.
update public.centers as center
set automatic_invoice_only = true
where exists (
  select 1
  from unnest(array[
    center.name,
    center.quickbooks_display_name,
    center.quickbooks_company_name
  ]) as customer_name(value)
  where regexp_replace(
    lower(normalize(coalesce(customer_name.value, ''), NFKD)),
    '[^a-z0-9]', '', 'g'
  ) in ('arisecafe', 'cooperriis', 'cooperriishealingcommunity')
);

-- Existing billing recipients, grants, RLS policies, and triggers are unchanged.
notify pgrst, 'reload schema';

commit;
