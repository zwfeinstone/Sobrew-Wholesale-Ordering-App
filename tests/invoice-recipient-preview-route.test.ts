import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdminSectionView: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  getQuickBooksInvoiceEmailPreviewForOrder: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: mocks.requireAdminSectionView }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));
vi.mock('@/lib/quickbooks', () => ({ getQuickBooksInvoiceEmailPreviewForOrder: mocks.getQuickBooksInvoiceEmailPreviewForOrder }));

import { GET } from '@/app/api/admin/quickbooks/invoices/recipients/route';

const orderId = '22222222-2222-4222-8222-222222222222';
const recipients = {
  to: ['billing@example.com'],
  cc: ['ap@example.com', 'accountant@example.com'],
  all: ['billing@example.com', 'ap@example.com', 'accountant@example.com'],
  display: 'billing@example.com, ap@example.com, accountant@example.com',
};

function request(value: string | null = orderId) {
  const url = new URL('https://portal.example.test/api/admin/quickbooks/invoices/recipients');
  if (value !== null) url.searchParams.set('orderId', value);
  return new Request(url);
}

beforeEach(() => {
  vi.resetAllMocks();
  // All authorization, database, and QuickBooks dependencies are mocked. Fail
  // rather than make a network request if a future route change adds one.
  mocks.fetch.mockRejectedValue(new Error('Unexpected network request in recipient preview test.'));
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.requireAdminSectionView.mockResolvedValue({ centerScope: null });
  mocks.getQuickBooksInvoiceEmailPreviewForOrder.mockResolvedValue(recipients);
  const query = { select: mocks.select, eq: mocks.eq, single: mocks.single };
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.single.mockResolvedValue({ data: { center_id: 'center-allowed' }, error: null });
  mocks.getSupabaseAdmin.mockReturnValue({ from: mocks.from });
});

afterEach(() => {
  expect(mocks.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('invoice recipient preview route', () => {
  it.each([
    { reason: 'unauthenticated', destination: '/login' },
    { reason: 'missing invoicing view permission', destination: '/admin/access-denied?section=invoicing' },
  ])('preserves the authorization redirect for $reason without loading recipients', async ({ destination }) => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: `NEXT_REDIRECT;replace;${destination};307;`,
    });
    mocks.requireAdminSectionView.mockRejectedValue(redirect);

    await expect(GET(request())).rejects.toBe(redirect);

    expect(mocks.requireAdminSectionView).toHaveBeenCalledWith('invoicing');
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
    expect(mocks.getQuickBooksInvoiceEmailPreviewForOrder).not.toHaveBeenCalled();
  });

  it.each([null, '', 'not-a-uuid', `${orderId}/another-order`])('rejects an invalid order ID before looking up an order: %j', async (value) => {
    const response = await GET(request(value));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'Choose an order to preview recipients.' });
    expect(mocks.requireAdminSectionView).toHaveBeenCalledWith('invoicing');
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
    expect(mocks.getQuickBooksInvoiceEmailPreviewForOrder).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'another center', centerScope: ['center-allowed'], data: { center_id: 'center-other' }, error: null },
    { label: 'no assigned centers', centerScope: [], data: { center_id: 'center-allowed' }, error: null },
    { label: 'an order without a center', centerScope: ['center-allowed'], data: { center_id: null }, error: null },
    { label: 'a missing order', centerScope: ['center-allowed'], data: null, error: null },
    { label: 'a failed order lookup', centerScope: ['center-allowed'], data: null, error: { message: 'Database unavailable' } },
  ])('does not expose recipients to a scoped admin for $label', async ({ centerScope, data, error }) => {
    mocks.requireAdminSectionView.mockResolvedValue({ centerScope });
    mocks.single.mockResolvedValue({ data, error });

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'This order is unavailable.' });
    expect(mocks.from).toHaveBeenCalledWith('orders');
    expect(mocks.select).toHaveBeenCalledWith('center_id');
    expect(mocks.eq).toHaveBeenCalledWith('id', orderId);
    expect(mocks.getQuickBooksInvoiceEmailPreviewForOrder).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'an unrestricted admin', centerScope: null },
    { label: 'an admin assigned to this center', centerScope: ['center-allowed'] },
  ])('returns To and CC without caching for $label', async ({ centerScope }) => {
    mocks.requireAdminSectionView.mockResolvedValue({ centerScope });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ to: recipients.to, cc: recipients.cc });
    expect(mocks.getQuickBooksInvoiceEmailPreviewForOrder).toHaveBeenCalledExactlyOnceWith(orderId);
    if (centerScope === null) expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
    else expect(mocks.single).toHaveBeenCalledOnce();
  });

  it('returns an empty CC list successfully', async () => {
    mocks.getQuickBooksInvoiceEmailPreviewForOrder.mockResolvedValue({
      to: ['billing@example.com'], cc: [], all: ['billing@example.com'], display: 'billing@example.com',
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ to: ['billing@example.com'], cc: [] });
  });

  it('returns a provider lookup failure without disclosing a partial recipient list', async () => {
    mocks.getQuickBooksInvoiceEmailPreviewForOrder.mockRejectedValue(new Error('Unable to load QuickBooks customer email recipients.'));

    const response = await GET(request());

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'Unable to load QuickBooks customer email recipients.' });
  });
});
