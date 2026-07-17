import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PROSPECTING_STAGES,
  REP_PIPELINE_STAGES,
  prospectingLeadPath,
  prospectingPath,
  prospectingQueueContextFromParams,
  prospectingQueueHiddenFields,
  prospectingQueueRequiresFollowUp,
  prospectingQueueStageFilter,
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
      state: 'missing',
      tab: 'tasks',
    });

    expect(prospectingLeadPath('lead-123', context, { includePageSize: true })).toBe(
      `/admin/sales/prospecting/lead-123?tab=tasks&q=Chicago&priority=high&state=missing&list=${LIST_ID}&rep=${REP_ID}&page_size=25&page=4`,
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
      { name: 'queue_stage', value: '' },
      { name: 'queue_state', value: 'TX' },
      { name: 'queue_page', value: '2' },
      { name: 'queue_page_size', value: '25' },
      { name: 'queue_list', value: LIST_ID },
      { name: 'queue_rep_id', value: REP_ID },
    ]);
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
      stage: 'sample_requested',
      tab: 'pipeline',
    });

    expect(prospectingQueueRequiresFollowUp(context)).toBe(false);
    expect(prospectingQueueStageFilter(context)).toEqual(['sample_requested']);
  });
});
