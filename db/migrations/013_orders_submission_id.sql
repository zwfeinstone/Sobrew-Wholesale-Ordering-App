alter table orders
  add column if not exists submission_id uuid;

create unique index if not exists orders_submission_id_idx
  on orders (submission_id)
  where submission_id is not null;
