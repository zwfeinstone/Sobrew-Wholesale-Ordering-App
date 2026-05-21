alter table if exists sales_prospecting_followup_blocks
  add column if not exists deals_lost_email integer not null default 0 check (deals_lost_email >= 0);

alter table if exists sales_prospecting_followup_blocks
  add column if not exists deals_lost_phone integer not null default 0 check (deals_lost_phone >= 0);

alter table if exists sales_prospecting_followup_blocks
  add column if not exists deals_lost_text integer not null default 0 check (deals_lost_text >= 0);

notify pgrst, 'reload schema';
