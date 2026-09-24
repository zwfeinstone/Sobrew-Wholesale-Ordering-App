-- Verify normalized signup and email-change blocking without retaining fixtures.
begin;

insert into private.revoked_login_emails (email_sha256)
values (sha256(convert_to('offboarding-fixture@example.invalid', 'UTF8')))
on conflict do nothing;

do $$
declare
  candidate text;
  account_id uuid := gen_random_uuid();
  blocked_constraint text;
begin
  foreach candidate in array array[
    'offboarding-fixture@example.invalid',
    'OFFBOARDING-FIXTURE@EXAMPLE.INVALID',
    ' Offboarding-Fixture@Example.Invalid '
  ] loop
    begin
      insert into auth.users (id, email) values (gen_random_uuid(), candidate);
      raise exception 'Revoked email unexpectedly allowed';
    exception when check_violation then
      get stacked diagnostics blocked_constraint = constraint_name;
      if blocked_constraint <> 'revoked_login_email' then raise; end if;
    end;
  end loop;

  -- Unrelated users can still be created and change their email normally.
  insert into auth.users (id, email)
  values (account_id, 'allowed-fixture-' || account_id || '@example.invalid');
  update auth.users set email = 'changed-fixture-' || account_id || '@example.invalid'
  where id = account_id;

  begin
    update auth.users set email = 'offboarding-fixture@example.invalid' where id = account_id;
    raise exception 'Revoked email change unexpectedly allowed';
  exception when check_violation then
    get stacked diagnostics blocked_constraint = constraint_name;
    if blocked_constraint <> 'revoked_login_email' then raise; end if;
  end;

  begin
    update auth.users set email_change = 'offboarding-fixture@example.invalid' where id = account_id;
    raise exception 'Revoked pending email change unexpectedly allowed';
  exception when check_violation then
    get stacked diagnostics blocked_constraint = constraint_name;
    if blocked_constraint <> 'revoked_login_email' then raise; end if;
  end;
end $$;

rollback;
