-- Keep revoked login identifiers private without retaining plaintext email.
create table private.revoked_login_emails (
  email_sha256 bytea primary key check (octet_length(email_sha256) = 32),
  revoked_at timestamptz not null default now()
);
alter table private.revoked_login_emails enable row level security;
revoke all on private.revoked_login_emails from public, anon, authenticated;

create function private.reject_revoked_login_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from private.revoked_login_emails r
    where r.email_sha256 = pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(new.email)), 'UTF8'))
       or (
         nullif(pg_catalog.btrim(new.email_change), '') is not null
         and r.email_sha256 = pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(new.email_change)), 'UTF8'))
       )
  ) then
    raise exception 'Login email is unavailable'
      using errcode = '23514', constraint = 'revoked_login_email';
  end if;
  return new;
end;
$$;
revoke all on function private.reject_revoked_login_email() from public, anon, authenticated;

create trigger reject_revoked_login_email
before insert or update of email, email_change on auth.users
for each row execute function private.reject_revoked_login_email();
