export const ADMIN_OWNER_EMAIL = 'zach@sobrew.com';

export const ADMIN_PERMISSION_KEYS = [
  'dashboard',
  'sales',
  'sales_admin',
  'commission',
  'payroll',
  'reports',
  'reports_sales',
  'reports_profitability',
  'prospecting',
  'orders',
  'archived_orders',
  'recurring_orders',
  'canceled_recurring_orders',
  'order_form',
  'centers',
  'products',
  'inventory',
  'receiving',
  'planning',
  'production',
  'time_clock',
  'settings',
  'manage_admins',
] as const;

export type AdminPermissionKey = (typeof ADMIN_PERMISSION_KEYS)[number];

export type AdminPermissionState = {
  canEdit: boolean;
  canView: boolean;
};

export type AdminAccessMap = Record<AdminPermissionKey, AdminPermissionState>;

export const ADMIN_SECTION_LABELS: Record<AdminPermissionKey, string> = {
  archived_orders: 'Archived Orders',
  canceled_recurring_orders: 'Canceled Recurring Orders',
  centers: 'Centers',
  dashboard: 'Dashboard',
  inventory: 'Inventory',
  manage_admins: 'Manage Admins',
  order_form: 'Order Form',
  orders: 'Orders',
  planning: 'Planning',
  production: 'Production',
  products: 'Products',
  prospecting: 'Prospecting',
  receiving: 'Receiving',
  recurring_orders: 'Recurring Orders',
  reports: 'Reports',
  reports_profitability: 'Profitability Reports',
  reports_sales: 'Sales Reports',
  sales: 'Sales',
  sales_admin: 'Sales Admin',
  commission: 'Commission',
  payroll: 'Payroll',
  settings: 'Settings',
  time_clock: 'Time Clock',
};

export const ADMIN_NAV_LINKS: Array<{
  child?: boolean;
  exact?: boolean;
  href: string;
  name: string;
  sectionKey: AdminPermissionKey;
}> = [
  { name: 'Dashboard', href: '/admin', exact: true, sectionKey: 'dashboard' },
  { name: 'Sales', href: '/admin/sales', exact: true, sectionKey: 'sales' },
  { name: 'Sales Admin', href: '/admin/sales-admin', sectionKey: 'sales_admin' },
  { name: 'Commission', href: '/admin/commission', sectionKey: 'commission' },
  { name: 'Reports', href: '/admin/reports', sectionKey: 'reports' },
  { name: 'Prospecting', href: '/admin/sales/prospecting', child: true, sectionKey: 'prospecting' },
  { name: 'Orders', href: '/admin/orders', sectionKey: 'orders' },
  { name: 'Archived Orders', href: '/admin/archived-orders', sectionKey: 'archived_orders' },
  { name: 'Recurring Orders', href: '/admin/recurring-orders', sectionKey: 'recurring_orders' },
  { name: 'Canceled Recurring Orders', href: '/admin/canceled-recurring-orders', sectionKey: 'canceled_recurring_orders' },
  { name: 'Order Form', href: '/admin/order-form', sectionKey: 'order_form' },
  { name: 'Centers', href: '/admin/users', sectionKey: 'centers' },
  { name: 'Products', href: '/admin/products', sectionKey: 'products' },
  { name: 'Inventory', href: '/admin/inventory', sectionKey: 'inventory' },
  { name: 'Receiving', href: '/admin/receiving', sectionKey: 'receiving' },
  { name: 'Planning', href: '/admin/planning', sectionKey: 'planning' },
  { name: 'Production', href: '/admin/production', sectionKey: 'production' },
  { name: 'Time Clock', href: '/admin/time-clock', sectionKey: 'time_clock' },
  { name: 'Payroll', href: '/admin/payroll', sectionKey: 'payroll' },
  { name: 'Settings', href: '/admin/settings', sectionKey: 'settings' },
];

export const ADMIN_PERMISSION_GROUPS: Array<{ keys: AdminPermissionKey[]; label: string }> = [
  { label: 'Core', keys: ['dashboard', 'orders', 'order_form', 'centers', 'settings', 'manage_admins'] },
  { label: 'Sales & Reports', keys: ['sales', 'sales_admin', 'commission', 'prospecting', 'reports', 'reports_sales', 'reports_profitability'] },
  { label: 'Catalog & Operations', keys: ['products', 'inventory', 'receiving', 'planning', 'production', 'time_clock', 'payroll'] },
  { label: 'Order History', keys: ['archived_orders', 'recurring_orders', 'canceled_recurring_orders'] },
];

function emptyAccess(): AdminAccessMap {
  return Object.fromEntries(ADMIN_PERMISSION_KEYS.map((key) => [key, { canEdit: false, canView: false }])) as AdminAccessMap;
}

function grant(access: AdminAccessMap, keys: AdminPermissionKey[], canEdit: boolean) {
  for (const key of keys) {
    access[key] = { canEdit, canView: true };
  }
}

export function ownerAccessMap(): AdminAccessMap {
  const access = emptyAccess();
  grant(access, [...ADMIN_PERMISSION_KEYS], true);
  return access;
}

export function legacyReadOnlyAccessMap(): AdminAccessMap {
  const access = emptyAccess();
  grant(access, ADMIN_NAV_LINKS.map((link) => link.sectionKey), false);
  grant(access, ['reports_sales'], false);
  return access;
}

export const ADMIN_ROLE_PRESETS: Array<{
  description: string;
  key: string;
  label: string;
  permissions: AdminAccessMap;
}> = [
  {
    key: 'owner',
    label: 'Owner',
    description: 'Full access. Zach is the only effective owner account.',
    permissions: ownerAccessMap(),
  },
  {
    key: 'operations',
    label: 'Operations',
    description: 'Can run orders, catalog, inventory, receiving, planning, and production.',
    permissions: (() => {
      const access = legacyReadOnlyAccessMap();
      grant(access, ['orders', 'products', 'inventory', 'receiving', 'planning', 'production'], true);
      grant(access, ['reports_sales'], false);
      return access;
    })(),
  },
  {
    key: 'sales',
    label: 'Sales',
    description: 'Can work sales/prospecting and view centers and orders.',
    permissions: (() => {
      const access = emptyAccess();
      grant(access, ['dashboard', 'sales', 'commission', 'prospecting', 'centers', 'orders', 'reports', 'reports_sales', 'time_clock'], false);
      grant(access, ['sales', 'prospecting', 'centers'], true);
      return access;
    })(),
  },
  {
    key: 'reporting',
    label: 'Reporting',
    description: 'Can view sales and customer reports without profit visibility.',
    permissions: (() => {
      const access = emptyAccess();
      grant(access, ['dashboard', 'reports', 'reports_sales', 'time_clock'], false);
      return access;
    })(),
  },
  {
    key: 'profit_reporting',
    label: 'Profit Reporting',
    description: 'Can view profitability, COGS, production, and inventory value reports.',
    permissions: (() => {
      const access = emptyAccess();
      grant(access, ['dashboard', 'reports', 'reports_profitability', 'time_clock'], false);
      return access;
    })(),
  },
];

export function isOwnerEmail(email: string | null | undefined) {
  return (email ?? '').trim().toLowerCase() === ADMIN_OWNER_EMAIL;
}

export function enforceOwnerOnlyPermissions(email: string | null | undefined, access: AdminAccessMap) {
  const normalized = normalizeAccessMap(access);
  if (!isOwnerEmail(email)) {
    normalized.manage_admins = { canEdit: false, canView: false };
    normalized.sales_admin = { canEdit: false, canView: false };
    normalized.payroll = { canEdit: false, canView: false };
    normalized.commission = { ...normalized.commission, canEdit: false };
    normalized.time_clock = { ...normalized.time_clock, canEdit: false };
  }
  return normalized;
}

export function normalizeAccessMap(access: Partial<Record<AdminPermissionKey, Partial<AdminPermissionState>>> | null | undefined): AdminAccessMap {
  const normalized = emptyAccess();
  for (const key of ADMIN_PERMISSION_KEYS) {
    const state = access?.[key];
    const canEdit = Boolean(state?.canEdit);
    const canView = Boolean(state?.canView || canEdit);
    normalized[key] = { canEdit, canView };
  }
  if (normalized.reports_sales.canView || normalized.reports_profitability.canView) {
    normalized.reports.canView = true;
  }
  if (normalized.reports_sales.canEdit || normalized.reports_profitability.canEdit) {
    normalized.reports.canEdit = true;
    normalized.reports.canView = true;
  }
  return normalized;
}

export function canViewAdminSection(access: AdminAccessMap, sectionKey: AdminPermissionKey) {
  if (sectionKey === 'reports') {
    return access.reports_sales.canView || access.reports_profitability.canView;
  }
  return access[sectionKey]?.canView ?? false;
}

export function canEditAdminSection(access: AdminAccessMap, sectionKey: AdminPermissionKey) {
  if (sectionKey === 'reports') {
    return access.reports_sales.canEdit || access.reports_profitability.canEdit;
  }
  return access[sectionKey]?.canEdit ?? false;
}

export function firstAllowedAdminHref(access: AdminAccessMap) {
  return ADMIN_NAV_LINKS.find((link) => canViewAdminSection(access, link.sectionKey))?.href ?? '/admin/access-denied';
}

export function adminSectionForPath(pathname: string): AdminPermissionKey | null {
  if (pathname === '/admin/access-denied' || pathname.startsWith('/admin/access-denied/')) return null;
  if (pathname === '/admin/admins/new' || pathname.startsWith('/admin/admins/new/')) return 'manage_admins';
  if (pathname === '/admin') return 'dashboard';
  if (pathname === '/admin/sales-admin' || pathname.startsWith('/admin/sales-admin/')) return 'sales_admin';
  if (pathname === '/admin/commission' || pathname.startsWith('/admin/commission/')) return 'commission';
  if (pathname === '/admin/sales/prospecting' || pathname.startsWith('/admin/sales/prospecting/')) return 'prospecting';
  if (pathname === '/admin/sales' || pathname.startsWith('/admin/sales/')) return 'sales';
  if (pathname === '/admin/reports' || pathname.startsWith('/admin/reports/')) return 'reports';
  if (pathname === '/admin/orders' || pathname.startsWith('/admin/orders/')) return 'orders';
  if (pathname === '/admin/archived-orders' || pathname.startsWith('/admin/archived-orders/')) return 'archived_orders';
  if (pathname === '/admin/recurring-orders' || pathname.startsWith('/admin/recurring-orders/')) return 'recurring_orders';
  if (pathname === '/admin/canceled-recurring-orders' || pathname.startsWith('/admin/canceled-recurring-orders/')) return 'canceled_recurring_orders';
  if (pathname === '/admin/order-form' || pathname.startsWith('/admin/order-form/')) return 'order_form';
  if (pathname === '/admin/users' || pathname.startsWith('/admin/users/')) return 'centers';
  if (pathname === '/admin/products' || pathname.startsWith('/admin/products/')) return 'products';
  if (pathname === '/admin/inventory' || pathname.startsWith('/admin/inventory/')) return 'inventory';
  if (pathname === '/admin/receiving' || pathname.startsWith('/admin/receiving/')) return 'receiving';
  if (pathname === '/admin/planning' || pathname.startsWith('/admin/planning/')) return 'planning';
  if (pathname === '/admin/production' || pathname.startsWith('/admin/production/')) return 'production';
  if (pathname === '/admin/time-clock' || pathname.startsWith('/admin/time-clock/')) return 'time_clock';
  if (pathname === '/admin/payroll' || pathname.startsWith('/admin/payroll/')) return 'payroll';
  if (pathname === '/admin/settings' || pathname.startsWith('/admin/settings/')) return 'settings';
  return null;
}
