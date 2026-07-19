import { describe, expect, it } from 'vitest';
import { summarizePipelineReview } from '@/lib/prospecting-pipeline-review';

const NOW = new Date('2026-07-19T18:00:00.000Z');

describe('summarizePipelineReview', () => {
  it('counts only calls and emails as touches', () => {
    const summary = summarizePipelineReview({
      contacts: [{ lead_id: 'lead-1', full_name: 'Buyer One', email: 'buyer@example.com', phone: '555-0101' }],
      leads: [
        {
          id: 'lead-1',
          company_email: 'hello@example.com',
          company_name: 'Example Treatment',
          last_result: 'Voicemail',
          next_follow_up_at: '2026-07-18',
          phone: '555-0100',
          priority: 'high',
          stage: 'working',
          state_key: 'TN',
        },
      ],
      now: NOW,
      touches: [
        { lead_id: 'lead-1', activity_type: 'call', created_at: '2026-07-01T16:00:00.000Z' },
        { lead_id: 'lead-1', activity_type: 'email', created_at: '2026-07-17T16:00:00.000Z' },
        { lead_id: 'lead-1', activity_type: 'note', created_at: '2026-07-18T16:00:00.000Z' },
        { lead_id: 'lead-1', activity_type: 'stage_change', created_at: '2026-07-18T17:00:00.000Z' },
      ],
    });

    expect(summary.leadSummaries[0]).toMatchObject({
      calls: 1,
      emails: 1,
      recentTouches: 2,
      totalTouches: 2,
    });
    expect(summary.leadSummaries[0].lastTouchAt).toBe('2026-07-17T16:00:00.000Z');
    expect(summary.metrics.untouched).toBe(0);
    expect(summary.metrics.overdueFollowUps).toBe(1);
    expect(summary.metrics.highPriority).toBe(1);
  });

  it('summarizes selected rep pipeline health across all review stages', () => {
    const summary = summarizePipelineReview({
      contacts: [
        { lead_id: 'lead-active', full_name: 'Active Contact', email: null, phone: null },
        { lead_id: 'lead-sample', full_name: 'Sample Contact', email: 'sample@example.com', phone: '555-2222' },
      ],
      leads: [
        {
          id: 'lead-new',
          company_email: null,
          company_name: 'New Center',
          last_result: null,
          next_follow_up_at: null,
          phone: null,
          priority: 'normal',
          stage: 'new',
          state_key: null,
        },
        {
          id: 'lead-active',
          company_email: 'active@example.com',
          company_name: 'Active Center',
          last_result: 'No answer',
          next_follow_up_at: '2026-07-19',
          phone: '555-1111',
          priority: 'normal',
          stage: 'follow_up',
          state_key: 'TN',
        },
        {
          id: 'lead-sample',
          company_email: 'sample@example.com',
          company_name: 'Sample Center',
          hubspot_status: 'queued',
          last_result: 'Sample requested',
          next_follow_up_at: '2026-07-15',
          phone: '555-2222',
          priority: 'high',
          stage: 'sample_requested',
          state_key: 'MS',
        },
      ],
      now: NOW,
      touches: [
        { lead_id: 'lead-active', activity_type: 'call', created_at: '2026-06-20T16:00:00.000Z' },
        { lead_id: 'lead-active', activity_type: 'assignment', created_at: '2026-07-18T16:00:00.000Z' },
        { lead_id: 'lead-sample', activity_type: 'email', created_at: '2026-07-18T16:00:00.000Z' },
      ],
    });

    expect(summary.metrics).toMatchObject({
      dataGaps: 1,
      dueToday: 1,
      handoffOrActionNeeded: 1,
      highPriority: 1,
      overdueFollowUps: 1,
      stale14Days: 2,
      totalOpen: 3,
      untouched: 1,
    });
    expect(summary.stageSummaries).toEqual([
      { stage: 'new', count: 1 },
      { stage: 'working', count: 0 },
      { stage: 'follow_up', count: 1 },
      { stage: 'recycle_try_later', count: 0 },
      { stage: 'interested', count: 0 },
      { stage: 'sample_requested', count: 1 },
    ]);
    expect(summary.resultMix).toEqual([
      { result: 'No answer', count: 1 },
      { result: 'Sample requested', count: 1 },
    ]);
  });
});
