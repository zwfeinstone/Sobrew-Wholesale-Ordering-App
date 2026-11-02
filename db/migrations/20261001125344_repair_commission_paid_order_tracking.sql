-- Repair commission payments independently of the pending SPIFF policy update.
-- Existing payout amounts/statuses stay unchanged; NULL retains legacy semantics.
alter table public.monthly_commission_payouts
  add column if not exists paid_order_ids uuid[];

comment on column public.monthly_commission_payouts.paid_order_ids is
  'Cumulative order IDs included in commission payouts. Null on a legacy paid row means its month was settled before per-invoice payment tracking.';

notify pgrst, 'reload schema';
