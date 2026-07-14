import { describe, expect, it } from 'vitest';
import {
  adminSectionForPath,
  canEditAdminSection,
  canViewAdminSection,
  enforceOwnerOnlyPermissions,
  normalizeAccessMap,
  ownerAccessMap,
} from '@/lib/admin-permission-definitions';

describe('admin permissions', () => {
  it('makes edit imply view and rolls child report access into reports', () => {
    const access = normalizeAccessMap({
      reports_profitability: { canEdit: true },
    });

    expect(canViewAdminSection(access, 'reports')).toBe(true);
    expect(canEditAdminSection(access, 'reports')).toBe(true);
    expect(access.reports_profitability).toEqual({ canEdit: true, canView: true });
  });

  it('removes owner-only mutations for limited admins', () => {
    const limited = enforceOwnerOnlyPermissions('rep@example.com', ownerAccessMap(), false);

    expect(limited.manage_admins).toEqual({ canEdit: false, canView: false });
    expect(limited.payroll).toEqual({ canEdit: false, canView: false });
    expect(limited.commission).toEqual({ canEdit: false, canView: true });
  });

  it('maps nested routes to the correct authorization section', () => {
    expect(adminSectionForPath('/admin/orders/123')).toBe('orders');
    expect(adminSectionForPath('/admin/sales-price-guide')).toBe('sales');
    expect(adminSectionForPath('/admin/sales/prospecting/list/123')).toBe('prospecting');
    expect(adminSectionForPath('/admin/access-denied')).toBeNull();
  });
});
