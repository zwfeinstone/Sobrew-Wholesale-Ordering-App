-- Hosted migration: restrict_thomas_to_assigned_customers.
-- Verified with a rolled-back assignment: no assignments => zero customer rows;
-- one assignment => that customer's rows only; Haskins's access unchanged.
-- The 34 copied customer assignments were removed separately and audit logged.
-- Restrict Thomas Sheddan to his own assigned customers and prospecting work.
-- Resolve the target from the account email at migration time, so the artifact
-- contains no environment-specific generated auth UUID.
-- Other authenticated users retain their existing authorization. Existing
-- permissive policies and grants must still authorize every operation.
-- Service-role workflows retain their existing RLS bypass. New customer
-- creation uses the service role and assigns the creator to the customer.
-- No function definitions, grants, table schemas, or existing policies change.
-- The caller controls BEGIN/ROLLBACK/COMMIT; this file has no transaction command.

DO $thomas_scope$
DECLARE
  target_profile_id uuid;
  policy_spec record;
BEGIN
  SELECT id INTO STRICT target_profile_id
  FROM public.profiles
  WHERE lower(btrim(email)) = 'thomas@sobrew.com';

  FOR policy_spec IN
    SELECT * FROM (VALUES
      ('centers', $predicate$
    EXISTS (
      SELECT 1 FROM public.admin_center_assignments AS assignment
      WHERE assignment.profile_id = (SELECT auth.uid())
        AND assignment.center_id = centers.id
    )
      $predicate$),
      ('profiles', $predicate$
    profiles.id = (SELECT auth.uid())
    OR profiles.is_admin IS TRUE
    OR EXISTS (
      SELECT 1 FROM public.admin_center_assignments AS assignment
      WHERE assignment.profile_id = (SELECT auth.uid())
        AND assignment.center_id = profiles.center_id
    )
      $predicate$),
      ('orders', $predicate$
    EXISTS (
      SELECT 1 FROM public.admin_center_assignments AS assignment
      WHERE assignment.profile_id = (SELECT auth.uid())
        AND assignment.center_id = orders.center_id
    )
    OR EXISTS (
      SELECT 1 FROM public.prospecting_leads AS own_lead
      WHERE own_lead.id = orders.prospecting_lead_id
        AND own_lead.assigned_profile_id = (SELECT auth.uid())
    )
      $predicate$),
      ('recurring_orders', $predicate$
    EXISTS (
      SELECT 1 FROM public.admin_center_assignments AS assignment
      WHERE assignment.profile_id = (SELECT auth.uid())
        AND assignment.center_id = recurring_orders.center_id
    )
      $predicate$),
      ('order_items', $predicate$
    EXISTS (
      SELECT 1 FROM public.orders AS visible_order
      WHERE visible_order.id = order_items.order_id
    )
      $predicate$),
      ('order_item_shipping_boxes', $predicate$
    EXISTS (
      SELECT 1 FROM public.orders AS visible_order
      WHERE visible_order.id = order_item_shipping_boxes.order_id
    )
      $predicate$),
      ('held_stock_sales', $predicate$
    EXISTS (
      SELECT 1 FROM public.orders AS visible_order
      WHERE visible_order.id = held_stock_sales.order_id
    )
      $predicate$),
      ('recurring_order_items', $predicate$
    EXISTS (
      SELECT 1 FROM public.recurring_orders AS visible_schedule
      WHERE visible_schedule.id = recurring_order_items.recurring_order_id
    )
      $predicate$),
      ('center_locations', $predicate$
    EXISTS (
      SELECT 1 FROM public.admin_center_assignments AS assignment
      WHERE assignment.profile_id = (SELECT auth.uid())
        AND assignment.center_id = center_locations.center_id
    )
      $predicate$),
      ('user_products', $predicate$
    EXISTS (
      SELECT 1 FROM public.admin_center_assignments AS assignment
      WHERE assignment.profile_id = (SELECT auth.uid())
        AND assignment.center_id = user_products.center_id
    )
      $predicate$),
      ('user_product_prices', $predicate$
    EXISTS (
      SELECT 1 FROM public.admin_center_assignments AS assignment
      WHERE assignment.profile_id = (SELECT auth.uid())
        AND assignment.center_id = user_product_prices.center_id
    )
      $predicate$),
      ('order_trash', $predicate$
    EXISTS (
      SELECT 1 FROM public.admin_center_assignments AS assignment
      WHERE assignment.profile_id = (SELECT auth.uid())
        AND assignment.center_id = order_trash.center_id
    )
      $predicate$),
      ('customer_stock_allocations', $predicate$
    EXISTS (
      SELECT 1 FROM public.admin_center_assignments AS assignment
      WHERE assignment.profile_id = (SELECT auth.uid())
        AND assignment.center_id = customer_stock_allocations.center_id
    )
      $predicate$),
      ('inventory_center_par_levels', $predicate$
    EXISTS (
      SELECT 1 FROM public.admin_center_assignments AS assignment
      WHERE assignment.profile_id = (SELECT auth.uid())
        AND assignment.center_id = inventory_center_par_levels.center_id
    )
      $predicate$),
      ('sample_box_runs', $predicate$
    sample_box_runs.sales_profile_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.admin_center_assignments AS assignment
      WHERE assignment.profile_id = (SELECT auth.uid())
        AND assignment.center_id = sample_box_runs.center_id
    )
      $predicate$),
      ('order_activity', $predicate$
    EXISTS (
      SELECT 1 FROM public.admin_center_assignments AS assignment
      WHERE assignment.profile_id = (SELECT auth.uid())
        AND assignment.center_id = order_activity.center_id
    )
    OR EXISTS (
      SELECT 1 FROM public.orders AS visible_order
      WHERE visible_order.id = order_activity.order_id
    )
      $predicate$),
      ('sample_box_run_items', $predicate$
    EXISTS (
      SELECT 1 FROM public.sample_box_runs AS visible_run
      WHERE visible_run.id = sample_box_run_items.run_id
    )
      $predicate$),
      ('inventory_movements', $predicate$
    (
      inventory_movements.order_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.orders AS visible_order
        WHERE visible_order.id = inventory_movements.order_id
      )
    )
    AND (
      inventory_movements.sample_box_run_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.sample_box_runs AS visible_run
        WHERE visible_run.id = inventory_movements.sample_box_run_id
      )
    )
      $predicate$),
      ('customer_stock_products', $predicate$
    EXISTS (
      SELECT 1 FROM public.customer_stock_allocations AS visible_allocation
      WHERE visible_allocation.id = customer_stock_products.allocation_id
    )
      $predicate$),
      ('customer_stock_reservations', $predicate$
    EXISTS (
      SELECT 1 FROM public.customer_stock_allocations AS visible_allocation
      WHERE visible_allocation.id = customer_stock_reservations.allocation_id
    )
      $predicate$)
    ) AS scopes(table_name, scope_predicate)
  LOOP
    EXECUTE format($policy$
      CREATE POLICY thomas_customer_scope
      ON public.%I
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING (
        (SELECT auth.uid()) IS DISTINCT FROM %L::uuid
        OR (%s)
      )
      WITH CHECK (
        (SELECT auth.uid()) IS DISTINCT FROM %L::uuid
        OR (%s)
      )
    $policy$, policy_spec.table_name,
      target_profile_id, policy_spec.scope_predicate,
      target_profile_id, policy_spec.scope_predicate);
  END LOOP;
END;
$thomas_scope$;


