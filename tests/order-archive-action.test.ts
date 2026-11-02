import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  authorize: vi.fn(), createClient: vi.fn(), from: vi.fn(), update: vi.fn(),
  in: vi.fn(), is: vi.fn(), select: vi.fn(), revalidate: vi.fn(),
}));

vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionEdit: state.authorize }));
vi.mock('@/lib/supabase/server', () => ({ createClient: state.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { archiveSelectedOrders } from '@/app/admin/orders/actions';

const SHIPPED_ID = '11111111-1111-4111-8111-111111111111';
const PROCESSING_ID = '22222222-2222-4222-8222-222222222222';

function selection(ids: string[]) {
  const data = new FormData();
  for (const id of ids) data.append('order_id', id);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  state.authorize.mockResolvedValue({ isOwner: true });
  const query = { update: state.update, in: state.in, is: state.is, select: state.select };
  state.createClient.mockResolvedValue({ from: state.from });
  state.from.mockReturnValue(query);
  state.update.mockReturnValue(query);
  state.in.mockReturnValue(query);
  state.is.mockReturnValue(query);
  state.select.mockResolvedValue({ data: [{ id: SHIPPED_ID }, { id: PROCESSING_ID }], error: null });
});

afterEach(() => vi.restoreAllMocks());

describe('bulk order archive action', () => {
  it('archives the selected active processing and shipped orders with one guarded update', async () => {
    await expect(archiveSelectedOrders(selection([SHIPPED_ID, PROCESSING_ID, SHIPPED_ID])))
      .rejects.toThrow('REDIRECT /admin/orders?toast=archive_success');

    expect(state.authorize).toHaveBeenCalledExactlyOnceWith('orders', '/admin/orders?toast=admin_write_denied');
    expect(state.from).toHaveBeenCalledExactlyOnceWith('orders');
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ archived_at: expect.any(String) });
    expect(Number.isNaN(Date.parse(state.update.mock.calls[0][0].archived_at))).toBe(false);
    expect(state.in.mock.calls).toEqual([
      ['id', [SHIPPED_ID, PROCESSING_ID]], ['status', ['Processing', 'Shipped']],
    ]);
    expect(state.is).toHaveBeenCalledExactlyOnceWith('archived_at', null);
    expect(state.select).toHaveBeenCalledExactlyOnceWith('id');
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith('/admin', 'layout');
  });

  it('logs a database rejection and reports a general failure instead of blaming order status', async () => {
    const error = {
      code: '22023',
      message: 'The billed held-stock order must remain Shipped and linked to its customer allocation',
    };
    state.select.mockResolvedValue({ data: null, error });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(archiveSelectedOrders(selection([SHIPPED_ID, PROCESSING_ID])))
      .rejects.toThrow('REDIRECT /admin/orders?toast=archive_error');

    expect(log).toHaveBeenCalledExactlyOnceWith('[orders] archive failed', { ...error, selectedCount: 2 });
    expect(state.update).toHaveBeenCalledOnce();
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it.each([[], null])('reports unavailable orders when the guarded update returns %j', async (data) => {
    state.select.mockResolvedValue({ data, error: null });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(archiveSelectedOrders(selection([SHIPPED_ID])))
      .rejects.toThrow('REDIRECT /admin/orders?toast=archive_unavailable');

    expect(log).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it('requires an order selection before contacting the database', async () => {
    await expect(archiveSelectedOrders(selection([''])))
      .rejects.toThrow('REDIRECT /admin/orders?toast=archive_selection_required');
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it('rejects more than 1,000 distinct selections before contacting the database', async () => {
    const ids = Array.from({ length: 1001 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    await expect(archiveSelectedOrders(selection(ids)))
      .rejects.toThrow('REDIRECT /admin/orders?toast=archive_selection_limit');
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it('prevents nonowners from archiving even if they can edit orders', async () => {
    state.authorize.mockResolvedValue({ isOwner: false });
    await expect(archiveSelectedOrders(selection([SHIPPED_ID])))
      .rejects.toThrow('REDIRECT /admin/orders?toast=archive_denied');
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it('preserves the permission redirect without contacting the database', async () => {
    const denial = new Error('REDIRECT /admin/orders?toast=admin_write_denied');
    state.authorize.mockRejectedValue(denial);
    await expect(archiveSelectedOrders(selection([SHIPPED_ID]))).rejects.toBe(denial);
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});
