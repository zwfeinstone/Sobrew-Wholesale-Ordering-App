import { describe, expect, it } from 'vitest';
import {
  centralDateInput,
  emptyProspectingReportAggregate,
  formatRatePercent,
  formatRateWithRatio,
  normalizeProspectingReportAggregate,
  rate,
  safeRawCount,
} from '@/lib/prospecting-reporting';

describe('prospecting report RPC normalization', () => {
  it('preserves exact totals beyond the former 1,000-row limit', () => {
    const report = normalizeProspectingReportAggregate({
      period: { new_leads: 3899 },
      pipeline_snapshot: { total_leads: '3899', open_pipeline: '3897' },
      stages: [{ stage: 'new', count: 3204 }],
      channels: [{ channel: 'phone', attempts: 1250 }],
      reps: [{ rep_key: 'rep-1', calls: 1101 }],
      sources: [{ source: 'leads_created', source_rows: 3899 }],
    });

    expect(report.period.new_leads).toBe(3899);
    expect(report.pipeline_snapshot).toMatchObject({ total_leads: 3899, open_pipeline: 3897 });
    expect(report.stages.find((row) => row.stage === 'new')?.count).toBe(3204);
    expect(report.channels.find((row) => row.channel === 'phone')?.attempts).toBe(1250);
    expect(report.reps[0].calls).toBe(1101);
    expect(report.sources.find((row) => row.source === 'leads_created')?.source_rows).toBe(3899);
  });

  it('returns a complete zero-filled contract for null or malformed payloads', () => {
    const empty = emptyProspectingReportAggregate();
    const malformed = normalizeProspectingReportAggregate({
      period: 'not-an-object',
      pipeline_snapshot: { total_leads: 'not-a-count', open_pipeline: -12 },
      stages: [{ stage: 'unknown', count: 10 }, null],
      channels: [{ channel: 'fax', attempts: 20 }],
      reps: [null, 'bad-row'],
      sources: [{ source: 'unknown', source_rows: 4 }],
    });

    expect(malformed).toEqual(empty);
    expect(malformed.stages).toHaveLength(9);
    expect(malformed.channels.map((row) => row.channel)).toEqual(['phone', 'email', 'text']);
    expect(malformed.sources).toHaveLength(5);
  });

  it('safely parses count-like values without truncating valid large totals', () => {
    expect(safeRawCount('2,000')).toBe(0);
    expect(safeRawCount('2000')).toBe(2000);
    expect(safeRawCount(10.9)).toBe(10);
    expect(safeRawCount(-1)).toBe(0);
    expect(safeRawCount(null)).toBe(0);
    expect(safeRawCount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(safeRawCount(BigInt(Number.MAX_SAFE_INTEGER) + 10n)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('prospecting conversion rates', () => {
  it('displays an em dash for a zero denominator', () => {
    const value = rate(0, 0);
    expect(value).toEqual({ numerator: 0, denominator: 0, percent: null });
    expect(formatRatePercent(value.percent)).toBe('—');
    expect(formatRateWithRatio(value)).toBe('—');
  });

  it('keeps a valid zero-percent result distinct from an undefined rate', () => {
    const value = rate(0, 10);
    expect(value.percent).toBe(0);
    expect(formatRateWithRatio(value)).toBe('0.0% · 0 / 10');
  });

  it('formats repeating percentages to one decimal with the raw ratio', () => {
    const value = rate(1, 3);
    expect(value.percent).toBeCloseTo(33.3333333333);
    expect(formatRateWithRatio(value)).toBe('33.3% · 1 / 3');
  });

  it('preserves legitimate rates above 100 percent', () => {
    const value = rate(15, 10);
    expect(value.percent).toBe(150);
    expect(formatRateWithRatio(value)).toBe('150.0% · 15 / 10');
  });
});

describe('centralDateInput', () => {
  it('uses America/Chicago at a daylight-saving date boundary', () => {
    expect(centralDateInput(new Date('2026-07-10T04:59:59.000Z'))).toBe('2026-07-09');
    expect(centralDateInput(new Date('2026-07-10T05:00:00.000Z'))).toBe('2026-07-10');
  });

  it('uses America/Chicago across a calendar-year boundary', () => {
    expect(centralDateInput(new Date('2026-01-01T05:30:00.000Z'))).toBe('2025-12-31');
  });

  it('rejects invalid dates', () => {
    expect(() => centralDateInput(new Date('invalid'))).toThrow(RangeError);
  });
});
