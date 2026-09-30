begin;

-- Persist the exact email before sending so retries reuse one immutable quote
-- and one provider idempotency key for each sample order.
create table public.prospecting_sample_quotes (
  id uuid primary key default gen_random_uuid(),
  -- Deliberately retain the receipt independently of the order row. Moving an
  -- order to trash deletes it; restoring the same ID must not allow a new email.
  order_id uuid not null unique,
  lead_id uuid not null references public.prospecting_leads(id),
  -- Contact cleanup must not remove the copied recipient details or email receipt.
  contact_id uuid references public.prospecting_contacts(id) on delete set null,
  sender_profile_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  sender_name text not null,
  sender_email text not null,
  recipient_name text not null,
  recipient_email text not null,
  tracking_number text not null,
  lines jsonb not null,
  subject text not null,
  body_text text not null,
  body_html text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  resend_email_id text,
  constraint prospecting_sample_quotes_tracking_check
    check (tracking_number ~ '[^[:space:]]' and char_length(tracking_number) <= 120),
  constraint prospecting_sample_quotes_lines_check
    check (case when jsonb_typeof(lines) = 'array' then jsonb_array_length(lines) > 0 else false end),
  constraint prospecting_sample_quotes_sent_check
    check ((sent_at is null) = (resend_email_id is null))
);

create index prospecting_sample_quotes_lead_idx
  on public.prospecting_sample_quotes(lead_id, created_at desc);

alter table public.prospecting_sample_quotes enable row level security;
revoke all on public.prospecting_sample_quotes from public, anon, authenticated, service_role;
-- The server authorizes lead access and resolves the sender before inserting.
-- Only delivery metadata can be updated; quote content stays fixed for retries.
grant select, insert on public.prospecting_sample_quotes to service_role;
grant update (sent_at, resend_email_id) on public.prospecting_sample_quotes to service_role;

notify pgrst, 'reload schema';
commit;
