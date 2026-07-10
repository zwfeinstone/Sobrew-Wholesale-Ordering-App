-- Exact, bounded prospecting-report aggregates. Authorization and scope are
-- resolved by the server before this service-role-only function is called.

begin;

create or replace function public.admin_prospecting_report_v1(
  p_range_start date,
  p_range_end_exclusive date,
  p_as_of_date date,
  p_sales_profile_id uuid,
  p_center_ids uuid[]
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with
  params as (
    select
      p_range_start as range_start,
      p_range_end_exclusive as range_end_exclusive,
      p_as_of_date as as_of_date,
      p_sales_profile_id as sales_profile_id,
      p_center_ids as center_ids,
      p_range_start::timestamp at time zone 'America/Chicago' as range_start_at,
      p_range_end_exclusive::timestamp at time zone 'America/Chicago' as range_end_at
  ),
  period_leads as (
    select
      lead.id,
      lead.assigned_profile_id
    from public.prospecting_leads lead
    cross join params
    where lead.created_at >= params.range_start_at
      and lead.created_at < params.range_end_at
      and (
        params.sales_profile_id is null
        or lead.assigned_profile_id = params.sales_profile_id
      )
  ),
  current_leads as (
    select
      lead.id,
      lead.assigned_profile_id,
      lead.stage,
      lead.next_follow_up_at,
      lead.hubspot_status
    from public.prospecting_leads lead
    cross join params
    where lead.archived_at is null
      and (
        params.sales_profile_id is null
        or lead.assigned_profile_id = params.sales_profile_id
      )
  ),
  period_activities_all as (
    select
      activity.id,
      activity.lead_id,
      activity.activity_type,
      activity.result,
      activity.previous_stage,
      activity.next_stage,
      activity.created_by,
      activity.created_at,
      lower(btrim(coalesce(activity.result, ''))) as result_key
    from public.prospecting_activities activity
    cross join params
    where activity.created_at >= params.range_start_at
      and activity.created_at < params.range_end_at
  ),
  period_activities as (
    select activity.*
    from period_activities_all activity
    cross join params
    where params.sales_profile_id is null
      or activity.created_by = params.sales_profile_id
  ),
  activity_counts as (
    select
      count(*)::bigint as source_rows,
      count(distinct activity.lead_id) filter (
        where activity.activity_type in ('call', 'email', 'note')
      )::bigint as tracked_unique_leads,
      count(*) filter (where activity.activity_type = 'call')::bigint as calls,
      count(*) filter (
        where activity.activity_type = 'call'
          and activity.result_key in (
            'reached gatekeeper',
            'reached decision maker',
            'call back later',
            'requested info',
            'interested',
            'sample requested',
            'requested sample',
            'not interested',
            'do not contact'
          )
      )::bigint as live_contacts,
      count(*) filter (
        where activity.activity_type = 'call'
          and activity.result_key = 'no answer'
      )::bigint as calls_no_answer,
      count(*) filter (
        where activity.activity_type = 'call'
          and activity.result_key = 'left voicemail'
      )::bigint as calls_voicemail,
      count(*) filter (
        where activity.activity_type = 'call'
          and activity.result_key = 'wrong number'
      )::bigint as calls_invalid,
      count(*) filter (
        where activity.activity_type = 'call'
          and activity.result_key not in (
            'no answer',
            'left voicemail',
            'wrong number',
            'reached gatekeeper',
            'reached decision maker',
            'call back later',
            'requested info',
            'interested',
            'sample requested',
            'requested sample',
            'not interested',
            'do not contact'
          )
      )::bigint as calls_unclassified,
      count(*) filter (where activity.activity_type = 'email')::bigint as emails,
      count(*) filter (where activity.activity_type = 'note')::bigint as notes
    from period_activities activity
  ),
  detailed_sample_requests_all as (
    select distinct on (activity.lead_id)
      activity.id,
      activity.lead_id,
      activity.activity_type,
      activity.created_by,
      activity.created_at
    from period_activities_all activity
    where (
        activity.next_stage = 'sample_requested'
        or activity.result_key in ('sample requested', 'requested sample')
      )
      and activity.previous_stage is distinct from 'sample_requested'
    order by activity.lead_id, activity.created_at, activity.id
  ),
  detailed_sample_requests as (
    select request.*
    from detailed_sample_requests_all request
    cross join params
    where params.sales_profile_id is null
      or request.created_by = params.sales_profile_id
  ),
  detailed_sample_counts as (
    select
      count(*)::bigint as sample_requests,
      count(*) filter (where request.activity_type = 'call')::bigint as phone_sample_requests,
      count(*) filter (where request.activity_type = 'call')::bigint as live_contact_sample_requests,
      count(*) filter (where request.activity_type = 'email')::bigint as email_sample_requests,
      count(*) filter (where request.activity_type = 'text')::bigint as text_sample_requests,
      count(*) filter (
        where request.activity_type not in ('call', 'email', 'text')
      )::bigint as other_sample_requests
    from detailed_sample_requests request
  ),
  latest_terminal_events_all as (
    select distinct on (activity.lead_id)
      activity.id,
      activity.lead_id,
      activity.activity_type,
      activity.next_stage,
      activity.created_by,
      activity.created_at
    from period_activities_all activity
    where activity.next_stage in ('converted', 'lost')
      and activity.previous_stage is distinct from activity.next_stage
    order by activity.lead_id, activity.created_at desc, activity.id desc
  ),
  latest_terminal_events as (
    select terminal.*
    from latest_terminal_events_all terminal
    cross join params
    where params.sales_profile_id is null
      or terminal.created_by = params.sales_profile_id
  ),
  terminal_counts as (
    select
      count(*) filter (where terminal.next_stage = 'converted')::bigint as deals_won,
      count(*) filter (where terminal.next_stage = 'lost')::bigint as deals_lost,
      count(*) filter (
        where terminal.next_stage = 'converted'
          and terminal.activity_type = 'call'
      )::bigint as phone_deals_won,
      count(*) filter (
        where terminal.next_stage = 'lost'
          and terminal.activity_type = 'call'
      )::bigint as phone_deals_lost,
      count(*) filter (
        where terminal.next_stage = 'converted'
          and terminal.activity_type = 'email'
      )::bigint as email_deals_won,
      count(*) filter (
        where terminal.next_stage = 'lost'
          and terminal.activity_type = 'email'
      )::bigint as email_deals_lost,
      count(*) filter (
        where terminal.next_stage = 'converted'
          and terminal.activity_type = 'text'
      )::bigint as text_deals_won,
      count(*) filter (
        where terminal.next_stage = 'lost'
          and terminal.activity_type = 'text'
      )::bigint as text_deals_lost
    from latest_terminal_events terminal
  ),
  period_blocks as (
    select block.*
    from public.sales_prospecting_blocks block
    cross join params
    where block.activity_date >= params.range_start
      and block.activity_date < params.range_end_exclusive
      and (
        params.sales_profile_id is null
        or block.created_by = params.sales_profile_id
      )
  ),
  block_counts as (
    select
      count(*)::bigint as source_rows,
      coalesce(sum(block.calls_no_contact), 0)::bigint as calls_no_answer,
      coalesce(sum(block.calls_voicemail), 0)::bigint as calls_voicemail,
      coalesce(sum(block.calls_contact), 0)::bigint as live_contacts,
      coalesce(sum(
        block.calls_no_contact
        + block.calls_voicemail
        + block.calls_contact
      ), 0)::bigint as calls,
      coalesce(sum(block.calls_email), 0)::bigint as emails,
      coalesce(sum(block.calls_text), 0)::bigint as texts,
      coalesce(sum(block.samples_from_contact), 0)::bigint as contact_sample_requests,
      coalesce(sum(block.samples_from_voicemail_callback), 0)::bigint as voicemail_sample_requests,
      coalesce(sum(block.samples_from_email_reply), 0)::bigint as email_sample_requests,
      coalesce(sum(block.samples_from_text_reply), 0)::bigint as text_sample_requests,
      coalesce(sum(block.samples_other), 0)::bigint as other_sample_requests,
      coalesce(sum(
        block.samples_from_contact
        + block.samples_from_voicemail_callback
        + block.samples_from_email_reply
        + block.samples_from_text_reply
        + block.samples_other
      ), 0)::bigint as sample_requests
    from period_blocks block
  ),
  period_followup_blocks as (
    select followup.*
    from public.sales_prospecting_followup_blocks followup
    cross join params
    where followup.activity_date >= params.range_start
      and followup.activity_date < params.range_end_exclusive
      and (
        params.sales_profile_id is null
        or followup.created_by = params.sales_profile_id
      )
  ),
  followup_counts as (
    select
      count(*)::bigint as source_rows,
      coalesce(sum(followup.followups_email), 0)::bigint as followups_email,
      coalesce(sum(followup.followups_phone), 0)::bigint as followups_phone,
      coalesce(sum(followup.followups_text), 0)::bigint as followups_text,
      coalesce(sum(
        followup.followups_email
        + followup.followups_phone
        + followup.followups_text
      ), 0)::bigint as followups,
      coalesce(sum(
        followup.deals_closed_email
        + followup.deals_closed_phone
        + followup.deals_closed_text
      ), 0)::bigint as deals_won,
      coalesce(sum(
        followup.deals_lost_email
        + followup.deals_lost_phone
        + followup.deals_lost_text
      ), 0)::bigint as deals_lost,
      coalesce(sum(followup.deals_closed_email), 0)::bigint as email_deals_won,
      coalesce(sum(followup.deals_closed_phone), 0)::bigint as phone_deals_won,
      coalesce(sum(followup.deals_closed_text), 0)::bigint as text_deals_won,
      coalesce(sum(followup.deals_lost_email), 0)::bigint as email_deals_lost,
      coalesce(sum(followup.deals_lost_phone), 0)::bigint as phone_deals_lost,
      coalesce(sum(followup.deals_lost_text), 0)::bigint as text_deals_lost
    from period_followup_blocks followup
  ),
  period_sample_runs as (
    select run.*
    from public.sample_box_runs run
    cross join params
    where run.sent_at >= params.range_start_at
      and run.sent_at < params.range_end_at
      and (
        params.sales_profile_id is null
        or run.sales_profile_id = params.sales_profile_id
      )
      and (
        params.center_ids is null
        or run.center_id is null
        or run.center_id = any(params.center_ids)
      )
  ),
  sample_counts as (
    select
      count(*)::bigint as sample_runs,
      coalesce(sum(run.quantity_boxes), 0::numeric) as sample_boxes,
      coalesce(sum(run.total_cogs_cents), 0::numeric) as sample_cogs_cents
    from period_sample_runs run
  ),
  lead_counts as (
    select count(*)::bigint as new_leads
    from period_leads
  ),
  pipeline_counts as (
    select
      count(*)::bigint as total_leads,
      count(*) filter (
        where lead.stage in (
          'new',
          'working',
          'follow_up',
          'recycle_try_later',
          'interested',
          'sample_requested'
        )
      )::bigint as open_pipeline,
      count(*) filter (
        where lead.stage in ('new', 'working', 'follow_up', 'recycle_try_later')
      )::bigint as active_queue,
      count(*) filter (
        where lead.stage in (
          'working',
          'follow_up',
          'recycle_try_later',
          'interested',
          'sample_requested'
        )
      )::bigint as leads_beyond_new,
      count(*) filter (
        where lead.stage in (
          'new',
          'working',
          'follow_up',
          'recycle_try_later',
          'interested',
          'sample_requested'
        )
          and not exists (
            select 1
            from public.prospecting_activities activity
            where activity.lead_id = lead.id
              and activity.activity_type in ('call', 'email')
          )
      )::bigint as untouched_open,
      count(*) filter (
        where lead.stage in (
          'new',
          'working',
          'follow_up',
          'recycle_try_later',
          'interested',
          'sample_requested'
        )
          and lead.assigned_profile_id is null
      )::bigint as unassigned_open,
      count(*) filter (
        where lead.stage in (
          'new',
          'working',
          'follow_up',
          'recycle_try_later',
          'interested',
          'sample_requested'
        )
          and lead.next_follow_up_at = params.as_of_date
      )::bigint as due_today,
      count(*) filter (
        where lead.stage in (
          'new',
          'working',
          'follow_up',
          'recycle_try_later',
          'interested',
          'sample_requested'
        )
          and lead.next_follow_up_at < params.as_of_date
      )::bigint as overdue_followups,
      count(*) filter (
        where lead.stage in ('interested', 'sample_requested')
          or lead.hubspot_status = 'queued'
      )::bigint as hubspot_ready
    from current_leads lead
    cross join params
  ),
  stage_catalog as (
    select *
    from (
      values
        (1, 'new'::text),
        (2, 'working'::text),
        (3, 'follow_up'::text),
        (4, 'recycle_try_later'::text),
        (5, 'interested'::text),
        (6, 'sample_requested'::text),
        (7, 'not_a_fit'::text),
        (8, 'lost'::text),
        (9, 'converted'::text)
    ) as stages(sort_order, stage)
  ),
  stage_rows as (
    select
      stage.sort_order,
      stage.stage,
      count(lead.id)::bigint as count
    from stage_catalog stage
    left join current_leads lead on lead.stage = stage.stage
    group by stage.sort_order, stage.stage
    order by stage.sort_order
  ),
  channel_rows as (
    select
      1 as sort_order,
      'phone'::text as channel,
      (activity.calls + block.calls)::bigint as attempts,
      (activity.live_contacts + block.live_contacts)::bigint as live_contacts,
      (samples.live_contact_sample_requests + block.contact_sample_requests)::bigint as contact_sample_requests,
      (
        samples.phone_sample_requests
        + block.contact_sample_requests
        + block.voicemail_sample_requests
      )::bigint as sample_requests,
      followup.followups_phone::bigint as followups,
      (terminal.phone_deals_won + followup.phone_deals_won)::bigint as deals_won,
      (terminal.phone_deals_lost + followup.phone_deals_lost)::bigint as deals_lost
    from activity_counts activity
    cross join block_counts block
    cross join detailed_sample_counts samples
    cross join terminal_counts terminal
    cross join followup_counts followup

    union all

    select
      2,
      'email',
      (activity.emails + block.emails)::bigint,
      0::bigint,
      (samples.email_sample_requests + block.email_sample_requests)::bigint,
      (samples.email_sample_requests + block.email_sample_requests)::bigint,
      followup.followups_email::bigint,
      (terminal.email_deals_won + followup.email_deals_won)::bigint,
      (terminal.email_deals_lost + followup.email_deals_lost)::bigint
    from activity_counts activity
    cross join block_counts block
    cross join detailed_sample_counts samples
    cross join terminal_counts terminal
    cross join followup_counts followup

    union all

    select
      3,
      'text',
      block.texts::bigint,
      0::bigint,
      (samples.text_sample_requests + block.text_sample_requests)::bigint,
      (samples.text_sample_requests + block.text_sample_requests)::bigint,
      followup.followups_text::bigint,
      (terminal.text_deals_won + followup.text_deals_won)::bigint,
      (terminal.text_deals_lost + followup.text_deals_lost)::bigint
    from block_counts block
    cross join detailed_sample_counts samples
    cross join terminal_counts terminal
    cross join followup_counts followup
  ),
  rep_events as (
    select
      coalesce(lead.assigned_profile_id::text, '__unassigned_rep__') as rep_key,
      count(*)::numeric as new_leads,
      0::numeric as calls,
      0::numeric as live_contacts,
      0::numeric as sample_requests,
      0::numeric as phone_sample_requests,
      0::numeric as deals_won,
      0::numeric as deals_lost,
      0::numeric as sample_boxes,
      0::numeric as sample_cogs_cents
    from period_leads lead
    group by coalesce(lead.assigned_profile_id::text, '__unassigned_rep__')

    union all

    select
      coalesce(activity.created_by::text, '__unknown_rep__'),
      0::numeric,
      count(*) filter (where activity.activity_type = 'call')::numeric,
      count(*) filter (
        where activity.activity_type = 'call'
          and activity.result_key in (
            'reached gatekeeper',
            'reached decision maker',
            'call back later',
            'requested info',
            'interested',
            'sample requested',
            'requested sample',
            'not interested',
            'do not contact'
          )
      )::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric
    from period_activities activity
    group by coalesce(activity.created_by::text, '__unknown_rep__')

    union all

    select
      coalesce(request.created_by::text, '__unknown_rep__'),
      0::numeric,
      0::numeric,
      0::numeric,
      count(*)::numeric,
      count(*) filter (where request.activity_type = 'call')::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric
    from detailed_sample_requests request
    group by coalesce(request.created_by::text, '__unknown_rep__')

    union all

    select
      coalesce(terminal.created_by::text, '__unknown_rep__'),
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      count(*) filter (where terminal.next_stage = 'converted')::numeric,
      count(*) filter (where terminal.next_stage = 'lost')::numeric,
      0::numeric,
      0::numeric
    from latest_terminal_events terminal
    group by coalesce(terminal.created_by::text, '__unknown_rep__')

    union all

    select
      coalesce(block.created_by::text, '__unknown_rep__'),
      0::numeric,
      coalesce(sum(
        block.calls_no_contact
        + block.calls_voicemail
        + block.calls_contact
      ), 0)::numeric,
      coalesce(sum(block.calls_contact), 0)::numeric,
      coalesce(sum(
        block.samples_from_contact
        + block.samples_from_voicemail_callback
        + block.samples_from_email_reply
        + block.samples_from_text_reply
        + block.samples_other
      ), 0)::numeric,
      coalesce(sum(
        block.samples_from_contact
        + block.samples_from_voicemail_callback
      ), 0)::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric
    from period_blocks block
    group by coalesce(block.created_by::text, '__unknown_rep__')

    union all

    select
      coalesce(followup.created_by::text, '__unknown_rep__'),
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      coalesce(sum(
        followup.deals_closed_email
        + followup.deals_closed_phone
        + followup.deals_closed_text
      ), 0)::numeric,
      coalesce(sum(
        followup.deals_lost_email
        + followup.deals_lost_phone
        + followup.deals_lost_text
      ), 0)::numeric,
      0::numeric,
      0::numeric
    from period_followup_blocks followup
    group by coalesce(followup.created_by::text, '__unknown_rep__')

    union all

    select
      coalesce(run.sales_profile_id::text, '__unassigned_rep__'),
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      coalesce(sum(run.quantity_boxes), 0::numeric),
      coalesce(sum(run.total_cogs_cents), 0::numeric)
    from period_sample_runs run
    group by coalesce(run.sales_profile_id::text, '__unassigned_rep__')
  ),
  rep_rows_all as (
    select
      event.rep_key,
      sum(event.new_leads) as new_leads,
      sum(event.calls) as calls,
      sum(event.live_contacts) as live_contacts,
      sum(event.sample_requests) as sample_requests,
      sum(event.phone_sample_requests) as phone_sample_requests,
      sum(event.deals_won) as deals_won,
      sum(event.deals_lost) as deals_lost,
      sum(event.sample_boxes) as sample_boxes,
      sum(event.sample_cogs_cents) as sample_cogs_cents
    from rep_events event
    group by event.rep_key
  ),
  rep_rows as (
    select row.*
    from rep_rows_all row
    where row.new_leads <> 0
      or row.calls <> 0
      or row.sample_requests <> 0
      or row.deals_won <> 0
      or row.deals_lost <> 0
      or row.sample_boxes <> 0
    order by row.calls desc, row.new_leads desc, row.rep_key
    limit 100
  ),
  source_rows as (
    select
      1 as sort_order,
      'lead_activity'::text as source,
      activity.source_rows::numeric as source_rows,
      activity.calls::numeric as calls,
      activity.emails::numeric as emails,
      0::numeric as texts,
      activity.notes::numeric as notes,
      0::numeric as followups,
      samples.sample_requests::numeric as sample_requests,
      terminal.deals_won::numeric as deals_won,
      terminal.deals_lost::numeric as deals_lost,
      0::numeric as sample_boxes,
      0::numeric as sample_cogs_cents
    from activity_counts activity
    cross join detailed_sample_counts samples
    cross join terminal_counts terminal

    union all

    select
      2,
      'prospecting_blocks',
      block.source_rows::numeric,
      block.calls::numeric,
      block.emails::numeric,
      block.texts::numeric,
      0::numeric,
      0::numeric,
      block.sample_requests::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric
    from block_counts block

    union all

    select
      3,
      'followup_blocks',
      followup.source_rows::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      followup.followups::numeric,
      0::numeric,
      followup.deals_won::numeric,
      followup.deals_lost::numeric,
      0::numeric,
      0::numeric
    from followup_counts followup

    union all

    select
      4,
      'leads_created',
      leads.new_leads::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric
    from lead_counts leads

    union all

    select
      5,
      'sample_box_runs',
      samples.sample_runs::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      samples.sample_boxes,
      samples.sample_cogs_cents
    from sample_counts samples
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'new_leads', leads.new_leads,
      'tracked_unique_leads', activity.tracked_unique_leads,
      'call_attempts', activity.calls + block.calls,
      'live_contacts', activity.live_contacts + block.live_contacts,
      'calls_no_answer', activity.calls_no_answer + block.calls_no_answer,
      'calls_voicemail', activity.calls_voicemail + block.calls_voicemail,
      'calls_invalid', activity.calls_invalid,
      'calls_unclassified', activity.calls_unclassified,
      'emails', activity.emails + block.emails,
      'texts', block.texts,
      'notes', activity.notes,
      'followups_email', followup.followups_email,
      'followups_phone', followup.followups_phone,
      'followups_text', followup.followups_text,
      'sample_requests', detailed_samples.sample_requests + block.sample_requests,
      'phone_sample_requests',
        detailed_samples.phone_sample_requests
        + block.contact_sample_requests
        + block.voicemail_sample_requests,
      'live_contact_sample_requests',
        detailed_samples.live_contact_sample_requests
        + block.contact_sample_requests,
      'email_sample_requests',
        detailed_samples.email_sample_requests
        + block.email_sample_requests,
      'text_sample_requests',
        detailed_samples.text_sample_requests
        + block.text_sample_requests,
      'other_sample_requests',
        detailed_samples.other_sample_requests
        + block.other_sample_requests,
      'deals_won', terminal.deals_won + followup.deals_won,
      'deals_lost', terminal.deals_lost + followup.deals_lost,
      'sample_runs', samples.sample_runs,
      'sample_boxes', samples.sample_boxes,
      'sample_cogs_cents', samples.sample_cogs_cents
    ),
    'pipeline_snapshot', jsonb_build_object(
      'total_leads', pipeline.total_leads,
      'open_pipeline', pipeline.open_pipeline,
      'active_queue', pipeline.active_queue,
      'leads_beyond_new', pipeline.leads_beyond_new,
      'untouched_open', pipeline.untouched_open,
      'unassigned_open', pipeline.unassigned_open,
      'due_today', pipeline.due_today,
      'overdue_followups', pipeline.overdue_followups,
      'hubspot_ready', pipeline.hubspot_ready
    ),
    'stages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'stage', stage.stage,
          'count', stage.count
        )
        order by stage.sort_order
      )
      from stage_rows stage
    ), '[]'::jsonb),
    'channels', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'channel', channel.channel,
          'attempts', channel.attempts,
          'live_contacts', channel.live_contacts,
          'contact_sample_requests', channel.contact_sample_requests,
          'sample_requests', channel.sample_requests,
          'followups', channel.followups,
          'deals_won', channel.deals_won,
          'deals_lost', channel.deals_lost
        )
        order by channel.sort_order
      )
      from channel_rows channel
    ), '[]'::jsonb),
    'reps', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'rep_key', rep.rep_key,
          'new_leads', rep.new_leads,
          'calls', rep.calls,
          'live_contacts', rep.live_contacts,
          'sample_requests', rep.sample_requests,
          'phone_sample_requests', rep.phone_sample_requests,
          'deals_won', rep.deals_won,
          'deals_lost', rep.deals_lost,
          'sample_boxes', rep.sample_boxes,
          'sample_cogs_cents', rep.sample_cogs_cents
        )
        order by rep.calls desc, rep.new_leads desc, rep.rep_key
      )
      from rep_rows rep
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'source', source.source,
          'source_rows', source.source_rows,
          'calls', source.calls,
          'emails', source.emails,
          'texts', source.texts,
          'notes', source.notes,
          'followups', source.followups,
          'sample_requests', source.sample_requests,
          'deals_won', source.deals_won,
          'deals_lost', source.deals_lost,
          'sample_boxes', source.sample_boxes,
          'sample_cogs_cents', source.sample_cogs_cents
        )
        order by source.sort_order
      )
      from source_rows source
    ), '[]'::jsonb)
  )
  from lead_counts leads
  cross join activity_counts activity
  cross join detailed_sample_counts detailed_samples
  cross join terminal_counts terminal
  cross join block_counts block
  cross join followup_counts followup
  cross join sample_counts samples
  cross join pipeline_counts pipeline;
$function$;

revoke all on function public.admin_prospecting_report_v1(
  date,
  date,
  date,
  uuid,
  uuid[]
) from public, anon, authenticated;

grant execute on function public.admin_prospecting_report_v1(
  date,
  date,
  date,
  uuid,
  uuid[]
) to service_role;

notify pgrst, 'reload schema';

commit;
