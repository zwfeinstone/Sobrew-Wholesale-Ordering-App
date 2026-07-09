alter table prospecting_leads
  drop constraint if exists prospecting_leads_stage_check;

alter table prospecting_leads
  add constraint prospecting_leads_stage_check
  check (stage in (
    'new',
    'working',
    'follow_up',
    'recycle_try_later',
    'interested',
    'sample_requested',
    'not_a_fit',
    'lost',
    'converted'
  ));
