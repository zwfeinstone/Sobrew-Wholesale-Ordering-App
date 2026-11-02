import { describe, expect, it } from 'vitest';
import { getReportPreloadTarget } from '@/lib/report-navigation-policy';

describe('report intent preload policy', () => {
  it('allows the measured default and related report destinations', () => {
    expect(getReportPreloadTarget('/admin/reports')).toBe('/admin/reports?report=overview');
    for (const report of ['overview', 'centers', 'recent_order_gpm']) {
      expect(getReportPreloadTarget(`/admin/reports?report=${report}`)).toBe(`/admin/reports?report=${report}`);
    }
  });

  it('canonicalizes dates and empty selectors without broadening nonempty filters', () => {
    expect(getReportPreloadTarget('/admin/reports?rangeEnd=2026-10-31&center=&report=centers&month=2026-10&rangeStart=2026-10-01&product=&sales_rep='))
      .toBe('/admin/reports?report=centers&month=2026-10&rangeStart=2026-10-01&rangeEnd=2026-10-31');
  });

  it.each([
    '/admin/reports?report=sales', '/admin/reports?report=ai_overview', '/admin/reports?report=labor_paid_gpm',
    '/admin/orders', '/admin/reports/other', '//external.test/admin/reports',
    'https://external.test/admin/reports', '/\\external.test/admin/reports',
    '/admin/reports?product=product-1', '/admin/reports?center=center-1', '/admin/reports?sales_rep=rep-1',
    '/admin/reports?report=overview&report=centers', '/admin/reports?product=&product=product-1',
    '/admin/reports?rangeStart=2026-02-30', '/admin/reports?rangeEnd=not-a-date',
    '/admin/reports?month=2026-13', '/admin/reports?month=2026-00', '/admin/reports?asOf=2026-10-01',
  ])('does not speculate for unsupported destination %s', (href) => {
    expect(getReportPreloadTarget(href)).toBeNull();
  });
});
