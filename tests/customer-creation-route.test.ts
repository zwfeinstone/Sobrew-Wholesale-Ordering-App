import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  authorize: vi.fn(),
  audit: vi.fn(),
  sync: vi.fn(),
  welcome: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: mocks.from, auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } } } }));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionEdit: mocks.authorize }));
vi.mock('@/lib/admin-audit', () => ({ recordAdminAuditLog: mocks.audit }));
vi.mock('@/lib/quickbooks', () => ({ createQuickBooksCustomerFromPortalCenter: mocks.sync }));
vi.mock('@/lib/email', () => ({ sendCustomerWelcomeEmail: mocks.welcome }));

import { POST } from '@/app/api/admin/users/new/route';

type Operation = { table: string; operation: string; values?: unknown };
let operations: Operation[];
let events: string[];
let failTable: string | null;

function request(changes: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    center_name: '  New Customer  ', login_email: '  Buyer@Example.com  ', login_name: 'Buyer', password: 'test-password-123',
    center_notes: 'Test note', address1: '  105 Johnson Dr  ', address2: '', city: ' Somerville ', state: 'tn', zip: '38068', selected_json: '[]', ...changes,
  })) form.set(key, value);
  return new Request('https://portal.example.test/api/admin/users/new', { method: 'POST', body: form });
}

beforeEach(() => {
  vi.resetAllMocks();
  operations = [];
  events = [];
  failTable = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
  mocks.authorize.mockResolvedValue({ profile: { id: 'admin-1' }, isOwner: false });
  mocks.createUser.mockImplementation(async () => { events.push('auth'); return { data: { user: { id: 'user-1' } }, error: null }; });
  mocks.deleteUser.mockResolvedValue({ error: null });
  mocks.audit.mockImplementation(async () => { events.push('audit'); });
  mocks.sync.mockImplementation(async () => { events.push('quickbooks'); return { id: 'qb-1' }; });
  mocks.welcome.mockImplementation(async () => { events.push('welcome'); return { ok: true }; });
  mocks.from.mockImplementation((table: string) => {
    let operation = 'select';
    let values: unknown;
    const result = () => {
      operations.push({ table, operation, values });
      events.push(`${table}:${operation}`);
      return {
        data: table === 'centers' && operation === 'insert' ? { id: 'center-1' } : table === 'admin_commission_settings' ? { is_sales_rep: true } : null,
        error: table === failTable && operation !== 'delete' ? { message: 'Save failed' } : null,
      };
    };
    const query = {
      select: () => query,
      eq: () => query,
      insert: (value: unknown) => { operation = 'insert'; values = value; return query; },
      upsert: (value: unknown) => { operation = 'upsert'; values = value; return query; },
      delete: () => { operation = 'delete'; return query; },
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  });
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('new customer creation', () => {
  it.each<Record<string, string>>([
    { address1: '' }, { address1: '  ' }, { city: '' }, { city: '  ' }, { state: '' }, { state: 'ZZ' }, { zip: '' }, { zip: '123' }, { zip: 'abcde' },
  ])('rejects an incomplete/invalid address before database, auth, QuickBooks, or welcome: %j', async (changes) => {
    const response = await POST(request(changes));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('error=address_required');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.welcome).not.toHaveBeenCalled();
  });

  it('saves normalized billing and delivery details before login, sync, and welcome, allowing an empty guide', async () => {
    const response = await POST(request());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://portal.example.test/admin/users/center-1?success=center_created');
    const center = operations.find((row) => row.table === 'centers' && row.operation === 'insert');
    expect(center?.values).toMatchObject({ name: 'New Customer', billing_email: 'buyer@example.com', billing_email_cc: [], billing_email_cc_reviewed_at: expect.any(String), billing_address1: '105 Johnson Dr', billing_address2: null, billing_city: 'Somerville', billing_state: 'TN', billing_zip: '38068' });
    expect(operations.find((row) => row.table === 'center_locations')?.values).toMatchObject({ center_id: 'center-1', name: 'New Customer', address1: '105 Johnson Dr', address2: null, city: 'Somerville', state: 'TN', zip: '38068', is_active: true });
    expect(events.indexOf('center_locations:insert')).toBeLessThan(events.indexOf('auth'));
    expect(events.indexOf('profiles:upsert')).toBeLessThan(events.indexOf('quickbooks'));
    expect(events.indexOf('quickbooks')).toBeLessThan(events.indexOf('welcome'));
    expect(operations.some((row) => row.table === 'user_products' || row.table === 'user_product_prices')).toBe(false);
    expect(mocks.createUser).toHaveBeenCalledWith({ email: 'buyer@example.com', password: 'test-password-123', email_confirm: true });
    expect(mocks.sync).toHaveBeenCalledExactlyOnceWith('center-1');
    expect(mocks.welcome).toHaveBeenCalledWith({ centerName: 'New Customer', email: 'buyer@example.com', fullName: 'Buyer', password: 'test-password-123' });
    expect(operations.find((row) => row.table === 'admin_center_assignments')?.values).toMatchObject({ center_id: 'center-1', profile_id: 'admin-1' });
    expect(operations.find((row) => row.table === 'center_sales_assignments')?.values).toMatchObject({ center_id: 'center-1', sales_profile_id: 'admin-1' });
  });

  it('allows optional address line 2 and ZIP+4', async () => {
    const response = await POST(request({ address2: ' Suite 2 ', zip: '38068-1234' }));
    expect(response.headers.get('location')).toContain('success=center_created');
    expect(operations.find((row) => row.table === 'center_locations')?.values).toMatchObject({ address2: 'Suite 2', zip: '38068-1234' });
  });

  it('never creates a login or sends email if the delivery address cannot be persisted', async () => {
    failTable = 'center_locations';
    const response = await POST(request());
    expect(response.headers.get('location')).toContain('error=address_save_failed');
    expect(operations).toContainEqual({ table: 'centers', operation: 'delete', values: undefined });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.welcome).not.toHaveBeenCalled();
  });

  it('cleans up local creation failures before attempting QuickBooks or welcome', async () => {
    failTable = 'profiles';
    await POST(request());
    expect(mocks.deleteUser).toHaveBeenCalledExactlyOnceWith('user-1');
    expect(operations).toContainEqual({ table: 'centers', operation: 'delete', values: undefined });
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.welcome).not.toHaveBeenCalled();
  });

  it('finishes the selected catalog and pricing before QuickBooks and welcome', async () => {
    await POST(request({ selected_json: '["product-1"]', 'price_product-1': '7.50' }));
    expect(operations.find((row) => row.table === 'user_product_prices')?.values).toEqual([{ center_id: 'center-1', product_id: 'product-1', price_cents: 750 }]);
    expect(events.indexOf('user_product_prices:insert')).toBeLessThan(events.indexOf('quickbooks'));
    expect(events.indexOf('user_product_prices:insert')).toBeLessThan(events.indexOf('welcome'));
  });

  it('never creates a QuickBooks customer or sends welcome after a catalog save failure', async () => {
    failTable = 'user_product_prices';
    await POST(request({ selected_json: '["product-1"]', 'price_product-1': '7.50' }));
    expect(mocks.deleteUser).toHaveBeenCalledWith('user-1');
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.welcome).not.toHaveBeenCalled();
  });

  it('retains the completed customer after a QuickBooks outage and redirects to its recovery screen', async () => {
    mocks.sync.mockRejectedValue(new Error('QuickBooks unavailable'));
    const response = await POST(request());
    expect(response.headers.get('location')).toBe('https://portal.example.test/admin/users/center-1?success=center_created&quickbooks=pending');
    expect(mocks.createUser).toHaveBeenCalledOnce();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(operations.some((row) => row.operation === 'delete')).toBe(false);
    expect(mocks.welcome).toHaveBeenCalledOnce();
  });

  it('reports both QuickBooks and welcome failures on the saved customer', async () => {
    mocks.sync.mockRejectedValue(new Error('QuickBooks unavailable'));
    mocks.welcome.mockResolvedValue({ ok: false });
    const response = await POST(request());
    expect(response.headers.get('location')).toContain('/admin/users/center-1?success=center_created&warning=welcome_email_failed&quickbooks=pending');
  });

  it('checks creation permission before reading or writing customer data', async () => {
    mocks.authorize.mockRejectedValue(new Error('Access denied'));
    await expect(POST(request())).rejects.toThrow('Access denied');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});
