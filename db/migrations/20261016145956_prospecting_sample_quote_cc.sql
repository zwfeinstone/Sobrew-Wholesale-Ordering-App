begin;

-- Freeze visible carbon-copy recipients with the email. Existing quotes keep
-- their original recipient payload because the default contains no addresses.
alter table public.prospecting_sample_quotes
  add column cc_emails text[] not null default '{}'::text[],
  add constraint prospecting_sample_quotes_cc_emails_check
    check (
      cardinality(cc_emails) <= 20
      and case
        when cardinality(cc_emails) = 0 then true
        when array_ndims(cc_emails) = 1 then array_position(cc_emails, null) is null
        else false
      end
    );

comment on column public.prospecting_sample_quotes.cc_emails is
  'Immutable normalized carbon-copy recipients; empty for quotes created before CC support.';

-- Keep service-role SELECT/INSERT and delivery-only UPDATE grants unchanged.
notify pgrst, 'reload schema';
commit;
