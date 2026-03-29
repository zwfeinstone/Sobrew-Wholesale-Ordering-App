alter table recurring_orders
  drop constraint if exists recurring_orders_frequency_check;

update recurring_orders
set frequency = '4_weeks'
where frequency = 'monthly';

alter table recurring_orders
  add constraint recurring_orders_frequency_check
  check (frequency in ('1_week', '2_weeks', '3_weeks', '4_weeks'));
