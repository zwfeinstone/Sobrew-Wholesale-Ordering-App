begin;

alter table public.centers
  add column billing_email_cc text[] not null default '{}'::text[],
  add column billing_email_cc_reviewed_at timestamptz;

-- Existing customers deliberately remain unreviewed. An empty list becomes a
-- confirmed "no CC needed" only after an admin explicitly reviews it.
comment on column public.centers.billing_email_cc is
  'Portal-managed billing CC recipients, retained when QuickBooks omits customer CC fields.';
comment on column public.centers.billing_email_cc_reviewed_at is
  'NULL means billing CC must be reviewed before an invoice or receipt can be sent; a reviewed empty array means no customer CC is needed.';

alter table public.centers
  add constraint centers_billing_email_cc_count_check
    check (cardinality(billing_email_cc) <= 20),
  add constraint centers_billing_email_cc_no_null_check
    check (array_position(billing_email_cc, null) is null);

-- These fields use the existing centers RLS policies. No new grants or broader
-- row access are needed. The trigger only changes the row already being updated.
create schema if not exists private;

create or replace function private.reset_center_billing_email_cc_review_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.quickbooks_customer_id is distinct from old.quickbooks_customer_id then
    new.billing_email_cc_reviewed_at := null;
  elsif new.billing_email_cc is distinct from old.billing_email_cc
      and new.billing_email_cc_reviewed_at is not distinct from old.billing_email_cc_reviewed_at then
    -- A deliberate save writes a fresh review timestamp with the recipient list.
    -- Other list changes must not inherit a stale review.
    new.billing_email_cc_reviewed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.reset_center_billing_email_cc_review_v1() from public, anon, authenticated;

create trigger centers_reset_billing_email_cc_review
before update of quickbooks_customer_id, billing_email_cc, billing_email_cc_reviewed_at on public.centers
for each row execute function private.reset_center_billing_email_cc_review_v1();

notify pgrst, 'reload schema';

commit;
