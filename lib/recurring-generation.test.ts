import { describe, expect, it } from 'vitest';
import { recurringSubmissionId } from './recurring-generation';

describe('recurringSubmissionId', () => {
  const recurringOrderId = '9fb04aa4-12fd-4741-baf7-2b08de54cb3f';

  it('is deterministic and formatted as a custom UUID', () => {
    const scheduledFor = new Date('2026-07-24T12:00:00.000Z');
    const first = recurringSubmissionId(recurringOrderId, scheduledFor);
    const second = recurringSubmissionId(recurringOrderId, scheduledFor);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('changes when the scheduled generation changes', () => {
    const first = recurringSubmissionId(recurringOrderId, new Date('2026-07-24T12:00:00.000Z'));
    const second = recurringSubmissionId(recurringOrderId, new Date('2026-08-07T12:00:00.000Z'));

    expect(first).not.toBe(second);
  });

  it('keeps distinct scheduled timestamps on the same day unique', () => {
    const first = recurringSubmissionId(recurringOrderId, new Date('2026-07-24T12:00:00.000Z'));
    const second = recurringSubmissionId(recurringOrderId, new Date('2026-07-24T13:00:00.000Z'));

    expect(first).not.toBe(second);
  });
});
