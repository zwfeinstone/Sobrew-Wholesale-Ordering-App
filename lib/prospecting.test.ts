import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PROSPECTING_STAGES,
  REP_PIPELINE_STAGES,
  prospectingLeadPath,
  prospectingPath,
  prospectingQueueContextFromParams,
  prospectingQueueExcludesFollowUpDue,
  prospectingQueueHiddenFields,
  prospectingQueueOrderFields,
  prospectingQueueRequiresFollowUp,
  prospectingQueueSkipsTouchedToday,
  prospectingQueueStageFilter,
  prospectingQueueWithoutStateFilter,
  parseCsv,
  prospectingContactPayloadsFromCsv,
  resolveActivityNextFollowUp,
  resolveActivityStage,
} from '@/lib/prospecting';

const LIST_ID = '11111111-2222-3333-4444-555555555555';
const REP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('prospecting queue context', () => {
  it('round-trips the full working queue through URL params', () => {
    const context = prospectingQueueContextFromParams({
      list: LIST_ID,
      page: '3',
      page_size: '25',
      priority: 'high',
      q: 'detox center',
      rep: REP_ID,
      stage: 'follow_up',
      state: 'TX',
      tab: 'pipeline',
    });

    expect(context).toEqual({
      listId: LIST_ID,
      page: 3,
      pageSize: 25,
      priority: 'high',
      q: 'detox center',
      repId: REP_ID,
      sort: '',
      stage: 'follow_up',
      state: 'TX',
      tab: 'pipeline',
    });

    const path = prospectingPath(context, { includePageSize: true, page: 2 });
    expect(prospectingQueueContextFromParams(new URLSearchParams(path.split('?')[1]))).toEqual({ ...context, page: 2 });
  });

  it('builds lead detail links that preserve task filters and import-list context', () => {
    const context = prospectingQueueContextFromParams({
      list: LIST_ID,
      page: '4',
      page_size: '25',
      priority: 'high',
      q: 'Chicago',
      rep: REP_ID,
      sort: 'list',
      state: 'missing',
      tab: 'tasks',
    });

    expect(prospectingLeadPath('lead-123', context, { includePageSize: true })).toBe(
      `/admin/sales/prospecting/lead-123?tab=tasks&q=Chicago&priority=high&sort=list&state=missing&list=${LIST_ID}&rep=${REP_ID}&page_size=25&page=4`,
    );
  });

  it('normalizes invalid or irrelevant queue params instead of carrying them forward', () => {
    const context = prospectingQueueContextFromParams({
      list: 'not-a-list-id',
      page_size: '999',
      priority: 'urgent',
      stage: 'sample_requested',
      state: 'not-a-state',
      tab: 'tasks',
    });

    expect(context).toMatchObject({
      listId: '',
      page: 1,
      pageSize: 50,
      priority: '',
      repId: '',
      sort: '',
      stage: '',
      state: '',
      tab: 'tasks',
    });
  });

  it('keeps queue hidden fields from colliding with editable lead fields', () => {
    const context = prospectingQueueContextFromParams({
      priority: 'low',
      queue_priority: 'high',
      queue_rep_id: REP_ID,
      queue_stage: 'new',
      queue_tab: 'pipeline',
      stage: 'interested',
    });

    expect(context).toMatchObject({
      priority: 'high',
      repId: REP_ID,
      stage: 'new',
      tab: 'pipeline',
    });
  });

  it('does not infer filters from editable lead fields when hidden queue fields are empty', () => {
    const formData = new FormData();
    formData.set('queue_tab', 'pipeline');
    formData.set('queue_priority', '');
    formData.set('queue_stage', '');
    formData.set('queue_state', '');
    formData.set('priority', 'high');
    formData.set('stage', 'working');
    formData.set('state', 'TX');

    expect(prospectingQueueContextFromParams(formData)).toMatchObject({
      priority: '',
      stage: '',
      state: '',
      tab: 'pipeline',
    });
  });

  it('keeps hidden form fields aligned with the parsed queue context', () => {
    const context = prospectingQueueContextFromParams({
      list: LIST_ID,
      page: '2',
      page_size: '25',
      priority: 'low',
      q: 'Austin',
      rep: REP_ID,
      state: 'TX',
      tab: 'list',
    });

    expect(prospectingQueueHiddenFields(context)).toEqual([
      { name: 'queue_tab', value: 'list' },
      { name: 'queue_q', value: 'Austin' },
      { name: 'queue_priority', value: 'low' },
      { name: 'queue_sort', value: '' },
      { name: 'queue_stage', value: '' },
      { name: 'queue_state', value: 'TX' },
      { name: 'queue_page', value: '2' },
      { name: 'queue_page_size', value: '25' },
      { name: 'queue_list', value: LIST_ID },
      { name: 'queue_rep_id', value: REP_ID },
    ]);
  });

  it('clears the state filter and restarts pagination for exhausted state queues', () => {
    const context = prospectingQueueContextFromParams({
      list: LIST_ID,
      page: '3',
      page_size: '25',
      priority: 'high',
      q: 'detox',
      rep: REP_ID,
      state: 'TX',
      tab: 'tasks',
    });

    expect(prospectingQueueWithoutStateFilter(context)).toEqual({
      ...context,
      page: 1,
      state: '',
    });
  });
});

describe('prospecting queue filtering rules', () => {
  it('keeps the active List tab inside active assigned stages', () => {
    const context = prospectingQueueContextFromParams({ tab: 'list' });

    expect(prospectingQueueRequiresFollowUp(context)).toBe(false);
    expect(prospectingQueueStageFilter(context)).toEqual(ACTIVE_PROSPECTING_STAGES);
  });

  it('keeps Tasks inside follow-up rows without changing the pipeline stage set', () => {
    const context = prospectingQueueContextFromParams({ tab: 'tasks' });

    expect(prospectingQueueRequiresFollowUp(context)).toBe(true);
    expect(prospectingQueueStageFilter(context)).toEqual(REP_PIPELINE_STAGES);
  });

  it('honors a selected Pipeline stage for next and previous records', () => {
    const context = prospectingQueueContextFromParams({
      stage: 'interested',
      tab: 'pipeline',
    });

    expect(prospectingQueueRequiresFollowUp(context)).toBe(false);
    expect(prospectingQueueStageFilter(context)).toEqual(['interested']);
  });

  it('keeps Sample Requested out of rep-visible pipeline and task queues', () => {
    expect(REP_PIPELINE_STAGES).not.toContain('sample_requested');
    expect(prospectingQueueContextFromParams({ stage: 'sample_requested', tab: 'pipeline' }).stage).toBe('');
    expect(prospectingQueueStageFilter(prospectingQueueContextFromParams({ tab: 'tasks' }))).not.toContain('sample_requested');
  });

  it('keeps Recycle / Try Later out of active rep and assignment queues', () => {
    expect(ACTIVE_PROSPECTING_STAGES).not.toContain('recycle_try_later');
    expect(REP_PIPELINE_STAGES).not.toContain('recycle_try_later');
    expect(prospectingQueueStageFilter(prospectingQueueContextFromParams({ tab: 'list' }))).not.toContain('recycle_try_later');
    expect(prospectingQueueStageFilter(prospectingQueueContextFromParams({ tab: 'tasks' }))).not.toContain('recycle_try_later');
  });

  it('uses stable queue ordering for due tasks and next-record navigation', () => {
    expect(prospectingQueueOrderFields(prospectingQueueContextFromParams({ tab: 'tasks' }))).toEqual([
      { column: 'next_follow_up_at', ascending: true },
      { column: 'last_activity_at', ascending: true },
      { column: 'created_at', ascending: true },
      { column: 'id', ascending: true },
    ]);
  });

  it('sorts selected lead lists by state, city, then company for rep list view', () => {
    expect(prospectingQueueOrderFields(prospectingQueueContextFromParams({ list: LIST_ID, tab: 'list' }))).toEqual([
      { column: 'state_key', ascending: true },
      { column: 'city', ascending: true },
      { column: 'company_name', ascending: true },
      { column: 'id', ascending: true },
    ]);
  });

  it('keeps stage-filtered pipeline queues stable after saving activity', () => {
    expect(prospectingQueueOrderFields(prospectingQueueContextFromParams({ stage: 'new', tab: 'pipeline' }))).toEqual([
      { column: 'created_at', ascending: true },
      { column: 'id', ascending: true },
    ]);
  });

  it('skips leads touched today only when reps are working the New pipeline queue', () => {
    expect(prospectingQueueSkipsTouchedToday(prospectingQueueContextFromParams({ stage: 'new', tab: 'pipeline' }))).toBe(true);
    expect(prospectingQueueSkipsTouchedToday(prospectingQueueContextFromParams({ stage: 'working', tab: 'pipeline' }))).toBe(false);
    expect(prospectingQueueSkipsTouchedToday(prospectingQueueContextFromParams({ tab: 'tasks' }))).toBe(false);
    expect(prospectingQueueSkipsTouchedToday(prospectingQueueContextFromParams({ list: LIST_ID, tab: 'list' }))).toBe(false);
  });

  it('keeps due follow-ups out of the New pipeline queue only', () => {
    expect(prospectingQueueExcludesFollowUpDue(prospectingQueueContextFromParams({ stage: 'new', tab: 'pipeline' }))).toBe(true);
    expect(prospectingQueueExcludesFollowUpDue(prospectingQueueContextFromParams({ stage: 'working', tab: 'pipeline' }))).toBe(false);
    expect(prospectingQueueExcludesFollowUpDue(prospectingQueueContextFromParams({ tab: 'tasks' }))).toBe(false);
    expect(prospectingQueueExcludesFollowUpDue(prospectingQueueContextFromParams({ list: LIST_ID, tab: 'list' }))).toBe(false);
  });
});

describe('prospecting activity stage resolution', () => {
  it('uses canned results to advance the stage when no explicit stage is selected', () => {
    expect(resolveActivityStage({
      currentStage: 'new',
      explicitStage: '',
      result: 'No answer',
    })).toBe('follow_up');
    expect(resolveActivityStage({
      currentStage: 'new',
      explicitStage: '',
      result: 'Left voicemail',
    })).toBe('follow_up');
    expect(resolveActivityStage({
      currentStage: 'new',
      explicitStage: '',
      result: 'Reached gatekeeper',
    })).toBe('working');
    expect(resolveActivityStage({
      currentStage: 'working',
      explicitStage: '',
      result: 'Interested',
    })).toBe('interested');
  });

  it('keeps the current stage when a canned result has no stage mapping', () => {
    expect(resolveActivityStage({
      currentStage: 'working',
      explicitStage: '',
      result: 'Custom note',
    })).toBe('working');
  });

  it('moves the stage when an explicit stage is selected', () => {
    expect(resolveActivityStage({
      currentStage: 'working',
      explicitStage: 'interested',
      result: 'Left voicemail',
    })).toBe('interested');
  });

  it('still sends hard-stop results to Not a Fit', () => {
    expect(resolveActivityStage({
      currentStage: 'interested',
      explicitStage: '',
      result: 'Do not contact',
    })).toBe('not_a_fit');
  });
});

describe('prospecting activity follow-up resolution', () => {
  it('clears the due task when an activity is saved without a new follow-up date', () => {
    expect(resolveActivityNextFollowUp({
      requestedNextFollowUp: null,
      shouldUnassign: false,
    })).toBeNull();
  });

  it('uses a newly entered follow-up date when one is provided', () => {
    expect(resolveActivityNextFollowUp({
      requestedNextFollowUp: '2026-08-07',
      shouldUnassign: false,
    })).toBe('2026-08-07');
  });

  it('clears the follow-up date when the lead is unassigned from the rep queue', () => {
    expect(resolveActivityNextFollowUp({
      requestedNextFollowUp: '2026-08-07',
      shouldUnassign: true,
    })).toBeNull();
  });
});

describe('prospecting CSV key contacts', () => {
  it('normalizes singular key contact headers into the primary contact fields', () => {
    const parsed = parseCsv([
      'company_name,key_contact_name,key_contact_title,key_contact_email,key_contact_phone',
      'Blue River Recovery,Maya Patel,Director,maya@example.com,555-0101',
    ].join('\n'));

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      key_contact_1_email: 'maya@example.com',
      key_contact_1_name: 'Maya Patel',
      key_contact_1_phone: '555-0101',
      key_contact_1_title: 'Director',
    });
  });

  it('builds primary and secondary contact payloads from imported CSV rows', () => {
    const contacts = prospectingContactPayloadsFromCsv({
      key_contact_1_email: 'maya@example.com',
      key_contact_1_name: 'Maya Patel',
      key_contact_1_phone: '555-0101',
      key_contact_1_title: 'Director',
      key_contact_2_email: 'sam@example.com',
      key_contact_2_name: 'Sam Lee',
      key_contact_2_phone: '555-0102',
      key_contact_2_title: 'Chef',
    }, 'lead-1', 'admin-1');

    expect(contacts).toEqual([
      {
        created_by: 'admin-1',
        email: 'maya@example.com',
        full_name: 'Maya Patel',
        is_primary: true,
        lead_id: 'lead-1',
        phone: '555-0101',
        title: 'Director',
        updated_by: 'admin-1',
      },
      {
        created_by: 'admin-1',
        email: 'sam@example.com',
        full_name: 'Sam Lee',
        is_primary: false,
        lead_id: 'lead-1',
        phone: '555-0102',
        title: 'Chef',
        updated_by: 'admin-1',
      },
    ]);
  });
});
