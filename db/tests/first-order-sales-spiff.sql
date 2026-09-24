-- Run after the first_order_sales_spiff migration. All fixtures roll back.
begin;
do $test$
declare
  v_creator uuid;
  v_other_rep uuid;
  v_center uuid := gen_random_uuid();
  v_second_center uuid := gen_random_uuid();
  v_unknown_center uuid := gen_random_uuid();
  v_non_sales_center uuid := gen_random_uuid();
  v_late_center uuid := gen_random_uuid();
  v_historical_center uuid := gen_random_uuid();
  v_failed_center uuid := gen_random_uuid();
  v_portal_center uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_portal_submission uuid := gen_random_uuid();
  v_checkout record;
  v_order uuid := gen_random_uuid();
  v_other_order uuid := gen_random_uuid();
  v_submission uuid := gen_random_uuid();
  v_spiff uuid;
  v_trash uuid;
  v_first_count integer;
begin
  select id into v_creator from public.profiles where is_admin and is_active and is_superadmin limit 1;
  select id into v_other_rep from public.profiles where is_admin and id <> v_creator limit 1;
  if v_creator is null or v_other_rep is null then
    raise exception 'Two administrator fixtures, including an active superadmin, are required';
  end if;
  perform set_config('request.jwt.claim.sub', v_creator::text, true);
  select count(*) into v_first_count from public.admin_weekly_sales_spiffs;

  insert into public.centers(id, name) values
    (v_center, 'SPIFF regression: first customer'),
    (v_second_center, 'SPIFF regression: second customer'),
    (v_unknown_center, 'SPIFF regression: unknown creator'),
    (v_non_sales_center, 'SPIFF regression: non-sales creator'),
    (v_late_center, 'SPIFF regression: delayed attribution'),
    (v_historical_center, 'SPIFF regression: historical customer'),
    (v_failed_center, 'SPIFF regression: rolled-back order'),
    (v_portal_center, 'SPIFF regression: portal checkout');

  insert into public.admin_audit_log(action, actor_profile_id, after_value)
  select 'center_created', v_creator,
    jsonb_build_object('center_id', id, 'sales_assigned_to_creator', true)
  from public.centers where id in (v_center, v_second_center, v_historical_center, v_failed_center, v_portal_center);
  insert into public.admin_audit_log(action, actor_profile_id, after_value)
  values ('center_created', v_creator,
    jsonb_build_object('center_id', v_non_sales_center, 'sales_assigned_to_creator', false));

  -- Assignment is deliberately a different person; the original creator wins.
  insert into public.center_sales_assignments(center_id, sales_profile_id)
    values (v_center, v_other_rep), (v_unknown_center, v_other_rep), (v_non_sales_center, v_other_rep);

  insert into public.orders(center_id, user_id, order_kind)
    values (v_center, v_creator, 'prospecting_sample');
  if exists(select 1 from private.customer_first_order_spiffs where center_id = v_center) then
    raise exception 'Sample order consumed first-order eligibility';
  end if;

  -- 00:30 UTC Monday is still Sunday in Chicago: payroll belongs to the prior week.
  insert into public.orders(id, center_id, user_id, submission_id, subtotal_cents, created_at)
    values (v_order, v_center, v_other_rep, v_submission, 2500, '2026-09-21 00:30:00+00');
  select spiff_id into v_spiff from private.customer_first_order_spiffs where center_id = v_center;
  if v_spiff is null or not exists (
    select 1 from public.admin_weekly_sales_spiffs where id = v_spiff
      and profile_id = v_creator and amount_cents = 10000 and paid_at is null and paid_by is null
      and week_start_date = '2026-09-14' and week_end_date = '2026-09-20'
      and notes like '%' || v_order::text || '%'
  ) then raise exception 'First-order amount, creator, unpaid status, notes, or Chicago week is wrong'; end if;
  if not exists(select 1 from public.admin_audit_log
    where action = 'first_order_sales_spiff_awarded' and after_value->>'payment_id' = v_spiff::text
  ) then raise exception 'Automatic SPIFF audit is missing'; end if;

  -- Another login/order, submission retry, status change, and archive cannot re-award.
  insert into public.orders(center_id, user_id, subtotal_cents) values (v_center, v_creator, 5000);
  insert into public.orders(center_id, user_id, submission_id)
    values (v_center, v_other_rep, v_submission) on conflict do nothing;
  update public.orders set status = 'Processing', archived_at = now() where id = v_order;
  if (select count(*) from public.admin_weekly_sales_spiffs) <> v_first_count + 1 then
    raise exception 'Repeat order, retry, status change, or archive duplicated the SPIFF';
  end if;

  -- A separate customer earns a separate award in the same payroll week.
  insert into public.orders(id, center_id, user_id, created_at)
    values (v_other_order, v_second_center, v_creator, '2026-09-21 00:30:00+00');
  if not exists(select 1 from private.customer_first_order_spiffs
    where center_id = v_second_center and sales_profile_id = v_creator and spiff_id is not null
  ) or (select count(*) from public.admin_weekly_sales_spiffs) <> v_first_count + 2 then
    raise exception 'A second customer did not earn its own SPIFF in the same week';
  end if;

  -- Deletion/restoration and a paid payroll record preserve the single award.
  update public.admin_weekly_sales_spiffs set paid_at = now(), paid_by = v_creator where id = v_spiff;
  perform public.move_order_to_trash(v_order, 'SPIFF regression');
  select id into v_trash from public.order_trash where order_id = v_order and restored_at is null;
  perform public.restore_order_from_trash(v_trash);
  if (select spiff_id from private.customer_first_order_spiffs where center_id = v_center) <> v_spiff
    or (select count(*) from public.admin_weekly_sales_spiffs) <> v_first_count + 2 then
    raise exception 'Restoration duplicated or replaced the SPIFF';
  end if;
  delete from public.admin_weekly_sales_spiffs where id = v_spiff;
  insert into public.orders(center_id, user_id) values (v_center, v_creator);
  if (select count(*) from public.admin_weekly_sales_spiffs) <> v_first_count + 1 then
    raise exception 'Deleting a payroll entry reset first-order eligibility';
  end if;

  insert into public.orders(center_id, user_id)
    values (v_unknown_center, v_creator), (v_non_sales_center, v_creator);
  if exists(select 1 from private.customer_first_order_spiffs
    where center_id in (v_unknown_center, v_non_sales_center) and spiff_id is not null
  ) then raise exception 'Current assignee or non-sales creator incorrectly earned a SPIFF'; end if;

  -- Account creation can finish its audit just after the first order arrives.
  insert into public.orders(center_id, user_id) values (v_late_center, v_creator);
  insert into public.admin_audit_log(action, actor_profile_id, after_value)
    values ('center_created', v_creator,
      jsonb_build_object('center_id', v_late_center, 'sales_assigned_to_creator', true));
  if not exists(select 1 from private.customer_first_order_spiffs
    where center_id = v_late_center and spiff_id is not null
  ) then raise exception 'Delayed account attribution lost the first-order SPIFF'; end if;

  -- Prior customers are seeded as ineligible by the migration, including trash.
  insert into private.customer_first_order_spiffs(center_id, first_order_id, first_order_at, eligible)
    values (v_historical_center, gen_random_uuid(), '2026-01-01 12:00:00+00', false);
  insert into public.orders(center_id, user_id) values (v_historical_center, v_creator);
  if exists(select 1 from private.customer_first_order_spiffs
    where center_id = v_historical_center and spiff_id is not null
  ) then raise exception 'Existing customer received a retroactive SPIFF'; end if;

  -- Failed atomic checkouts must roll back both the receipt and the award.
  begin
    insert into public.orders(center_id, user_id) values (v_failed_center, v_creator);
    raise exception 'Simulated checkout failure' using errcode = '22023';
  exception when sqlstate '22023' then null;
  end;
  if exists(select 1 from private.customer_first_order_spiffs where center_id = v_failed_center) then
    raise exception 'Failed checkout left a receipt or payroll award';
  end if;
  if (select count(*) from public.admin_weekly_sales_spiffs) <> v_first_count + 2 then
    raise exception 'Unexpected payroll total after regression cases';
  end if;

  -- Exercise the actual portal checkout RPC, including its idempotency response.
  -- The profile's temporary center assignment is rolled back with all fixtures.
  update public.profiles set center_id = v_portal_center where id = v_creator;
  insert into public.products(id, name, sku, active)
    values (v_product, 'SPIFF regression product', 'SPIFF-TEST-' || v_product, true);
  insert into public.user_products(center_id, product_id) values (v_portal_center, v_product);
  insert into public.user_product_prices(center_id, product_id, price_cents)
    values (v_portal_center, v_product, 2500);
  select * into v_checkout from public.place_portal_order(v_portal_submission, null, 'SPIFF regression',
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'qty', 1)));
  if not v_checkout.was_created or not exists(
    select 1 from private.customer_first_order_spiffs where center_id = v_portal_center
      and first_order_id = v_checkout.order_id and spiff_id is not null
  ) then raise exception 'Portal checkout did not award a first-order SPIFF'; end if;
  select * into v_checkout from public.place_portal_order(v_portal_submission, null, 'SPIFF regression',
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'qty', 1)));
  if v_checkout.was_created or (select count(*) from public.admin_weekly_sales_spiffs) <> v_first_count + 3 then
    raise exception 'Portal checkout retry duplicated the SPIFF';
  end if;

  -- Neither customers, sales reps nor API service clients can mint/reset receipts.
  if has_table_privilege('authenticated', 'private.customer_first_order_spiffs', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'private.customer_first_order_spiffs', 'INSERT,UPDATE,DELETE')
    or has_function_privilege('authenticated', 'private.award_first_order_sales_spiff(uuid,uuid,timestamptz)', 'EXECUTE')
    or has_function_privilege('anon', 'private.award_first_order_sales_spiff(uuid,uuid,timestamptz)', 'EXECUTE')
    or has_function_privilege('service_role', 'private.award_first_order_sales_spiff(uuid,uuid,timestamptz)', 'EXECUTE')
  then raise exception 'SPIFF internals are exposed to API callers'; end if;
end;
$test$;
select 'PASS: first-order SPIFF amount, attribution, payroll week, samples, retries, repeat orders, recovery, delayed attribution, historical customers, rollback and access controls' as result;
rollback;
