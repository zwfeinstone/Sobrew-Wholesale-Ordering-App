alter table recurring_orders
  drop constraint if exists recurring_orders_frequency_check;

alter table recurring_orders
  add constraint recurring_orders_frequency_check
  check (frequency in ('1_week', '2_weeks', '3_weeks', '4_weeks', '5_weeks', '6_weeks'));
