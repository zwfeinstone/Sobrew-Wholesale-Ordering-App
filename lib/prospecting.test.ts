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

describe('prospecting queue context', () => {
  it('round-trips the full working queue through URL params', () => {
    const context = prospectingQueueContextFromParams({
      list: LIST_ID,
      page_size: '25',
      priority: 'high',
      q: 'detox center',
      stage: 'follow_up',
      state: 'TX',
      tab: 'pipeline',
    });

    expect(context).toEqual({
      listId: LIST_ID,
      pageSize: 25,
      priority: 'high',
      q: 'detox center',
      stage: 'follow_up',
      state: 'TX',
      tab: 'pipeline',
    });

    const path = prospectingPath(context, { includePageSize: true, page: 2 });
    expect(prospectingQueueContextFromParams(new URLSearchParams(path.split('?')[1]))).toEqual(context);
  });

  it('builds lead detail links that preserve task filters and import-list context', () => {
    const context = prospectingQueueContextFromParams({
      list: LIST_ID,
      page_size: '25',
      priority: 'high',
      q: 'Chicago',
      state: 'missing',
      tab: 'tasks',
    });

    expect(prospectingLeadPath('lead-123', context, { includePageSize: true })).toBe(
      `/admin/sales/prospecting/lead-123?tab=tasks&q=Chicago&priority=high&state=missing&list=${LIST_ID}&page_size=25`,
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
      pageSize: 50,
      priority: '',
      stage: '',
      state: '',
      tab: 'tasks',
    });
  });

  it('keeps hidden form fields aligned with the parsed queue context', () => {
    const context = prospectingQueueContextFromParams({
      list: LIST_ID,
      page_size: '25',
      priority: 'low',
      q: 'Austin',
      state: 'TX',
      tab: 'list',
    });

    expect(prospectingQueueHiddenFields(context)).toEqual([
      { name: 'tab', value: 'list' },
      { name: 'q', value: 'Austin' },
      { name: 'priority', value: 'low' },
      { name: 'stage', value: '' },
      { name: 'state', value: 'TX' },
      { name: 'page_size', value: '25' },
      { name: 'list', value: LIST_ID },
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
