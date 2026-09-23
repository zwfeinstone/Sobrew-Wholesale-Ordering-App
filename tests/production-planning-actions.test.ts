import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planningReturnHref, planningView, planningViewHref } from '@/lib/production-planning-view';

const state = vi.hoisted(() => ({
  authorize: vi.fn(), record: vi.fn(), revalidate: vi.fn(), upsert: vi.fn(),
}));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: state.authorize }));
vi.mock('@/lib/inventory-production', () => ({ recordRecipeProductionRun: state.record }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: () => ({ upsert: state.upsert }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { producePlannedInventory, updateCenterParLevel } from '@/app/admin/planning/actions';

function form(quantity = '8', returnTo = '/admin/planning?sort=quantity&focus=recurring&q=House&covered=1') {
  const result = new FormData();
  result.set('product_id', 'coffee');
  result.set('quantity_produced', quantity);
  result.set('return_to', returnTo);
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.authorize.mockResolvedValue({});
  state.record.mockResolvedValue({ error: null });
  state.upsert.mockResolvedValue({ error: null });
});

describe('production completion', () => {
  it('records the actual quantity, refreshes stock views, and preserves the worker filters', async () => {
    await expect(producePlannedInventory(form())).rejects.toThrow('REDIRECT /admin/planning?q=House&focus=recurring&sort=quantity&covered=1&toast=production_recorded');
    expect(state.authorize).toHaveBeenCalledWith(expect.stringContaining('admin_write_denied'), 'planning');
    expect(state.record).toHaveBeenCalledWith(expect.objectContaining({ productId: 'coffee', quantityProduced: 8 }));
    expect(state.revalidate.mock.calls.flat()).toEqual(['/admin/planning', '/admin/production', '/admin/inventory']);
  });

  it.each(['1junk', '0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'])('rejects invalid actual quantity %s before changing inventory', async (quantity) => {
    await expect(producePlannedInventory(form(quantity))).rejects.toThrow('toast=invalid_quantity');
    expect(state.record).not.toHaveBeenCalled();
  });

  it('does not record when edit authorization fails', async () => {
    state.authorize.mockRejectedValueOnce(new Error('Denied'));
    await expect(producePlannedInventory(form())).rejects.toThrow('Denied');
    expect(state.record).not.toHaveBeenCalled();
  });

  it('surfaces an authoritative inventory shortage without a success toast', async () => {
    state.record.mockResolvedValueOnce({ error: 'insufficient_inventory' });
    await expect(producePlannedInventory(form())).rejects.toThrow('toast=insufficient_inventory');
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});

describe('planning navigation and targets', () => {
  it.each(['https://example.com/admin/planning?q=bad', '//example.com/admin/planning', '/admin/planning-other', 'http://['])('rejects a foreign or invalid return location %s', (returnTo) => {
    expect(planningReturnHref(form('1', returnTo), 'production_recorded')).toBe('/admin/planning?toast=production_recorded');
  });

  it('normalizes unknown filters and removes legacy week navigation', () => {
    expect(planningViewHref(planningView({ sort: 'bogus', focus: 'bogus', week_start: '2020-01-01' }))).toBe('/admin/planning');
  });

  it('saves overlapping par targets with filters retained', async () => {
    const data = form();
    data.set('center_id', 'customer');
    data.set('par_qty', '10');
    data.set('minimum_qty', '2');
    await expect(updateCenterParLevel(data)).rejects.toThrow('toast=par_saved');
    expect(state.upsert).toHaveBeenCalledWith(expect.objectContaining({ par_qty: 10, minimum_qty: 2 }), { onConflict: 'center_id,product_id' });
  });
});
