begin;

-- Keep the email greeting separate from the contact's name. Existing receipts
-- retain their original body; null uses the original first-name greeting.
alter table public.prospecting_sample_quotes
  add column greeting_name text,
  add constraint prospecting_sample_quotes_greeting_name_check
    check (greeting_name is null or (
      char_length(btrim(greeting_name)) between 1 and 120
      and greeting_name = btrim(greeting_name)
      and greeting_name !~ '[[:cntrl:]]'
    ));

comment on column public.prospecting_sample_quotes.greeting_name is
  'Immutable greeting name used in the email snapshot; null for legacy receipts.';

-- Existing service-role SELECT/INSERT and delivery-only UPDATE grants remain.
notify pgrst, 'reload schema';
commit;
