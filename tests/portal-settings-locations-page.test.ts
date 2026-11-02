import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  requireUser: vi.fn(), createClient: vi.fn(), from: vi.fn(), updateUser: vi.fn(),
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  rows: [] as Array<Record<string, unknown>>,
  readError: null as { message: string } | null,
}));
vi.mock('@/lib/auth', () => ({ requireUser: state.requireUser }));
vi.mock('@/lib/supabase/server', () => ({ createClient: state.createClient }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/components/portal-location-form', () => ({
  default: ({ location }: { location?: { id: string; name: string } }) => createElement('div', {
    'data-location-form': location?.id ?? 'add',
  }, location?.name ?? 'New location form'),
}));
vi.mock('@/components/pending-submit-button', () => ({
  default: ({ label }: { label: string }) => createElement('button', { type: 'submit' }, label),
}));

import PortalSettingsPage from '@/app/portal/settings/page';

const CENTER_ID = 'center-1';
function customer(overrides: Record<string, unknown> = {}) {
  return { profile: {
    center_id: CENTER_ID, email: 'buyer@example.test', is_admin: false, is_active: true,
    center: { id: CENTER_ID, is_active: true }, ...overrides,
  } };
}
function location(id: string, overrides: Record<string, unknown> = {}) {
  return { id, center_id: CENTER_ID, is_active: true, name: `Location ${id}`,
    address1: '123 Recovery Way', address2: 'Suite 2', city: 'Memphis', state: 'TN', zip: '38103', ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  state.requireUser.mockResolvedValue(customer());
  state.rows = [location('east')];
  state.reads = [];
  state.readError = null;
  state.updateUser.mockResolvedValue({ error: null });
  state.from.mockImplementation((table: string) => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
      order: () => query,
      then: (resolve: (value: unknown) => unknown) => {
        state.reads.push({ table, filters });
        const data = state.readError ? null : state.rows.filter((row) => filters.every(([key, value]) => row[key] === value));
        return Promise.resolve({ data, error: state.readError }).then(resolve);
      },
    };
    return query;
  });
  state.createClient.mockResolvedValue({ from: state.from, auth: { updateUser: state.updateUser } });
});

async function markup(searchParams?: { success?: string; error?: string }) {
  return renderToStaticMarkup(await PortalSettingsPage({ searchParams: Promise.resolve(searchParams ?? {}) }));
}

describe('customer account delivery locations', () => {
  it('renders only the current company’s active locations with edit/add forms and checkout return link', async () => {
    state.rows = [location('east'), location('west'), location('private', { center_id: 'other-center' }), location('inactive', { is_active: false })];
    const html = await markup();
    expect(html).toContain('data-location-form="east"');
    expect(html).toContain('data-location-form="west"');
    expect(html).toContain('data-location-form="add"');
    expect(html).not.toContain('Location private');
    expect(html).not.toContain('Location inactive');
    expect(html).toContain('Suite 2');
    expect(html).toContain('Memphis');
    expect(html).toContain('href="/portal/checkout"');
    expect(html).toContain('Already-placed orders keep their original address');
    expect(state.reads).toEqual([{ table: 'center_locations', filters: [['center_id', CENTER_ID], ['is_active', true]] }]);
  });

  it('opens the add-location section when the customer has no saved locations', async () => {
    state.rows = [];
    const html = await markup();
    expect(html).toContain('Add your first address below');
    expect(html).toContain('data-location-form="add"');
    expect(html).toMatch(/<details\b[^>]*open=""/);
  });

  it.each([
    ['admin', { is_admin: true }],
    ['inactive customer', { is_active: false }],
    ['missing membership', { center_id: null }],
    ['missing center', { center: null }],
    ['inactive center', { center: { is_active: false } }],
    ['unknown center status', { center: { is_active: null } }],
  ])('does not query or render location forms for %s', async (_label, overrides) => {
    state.requireUser.mockResolvedValue(customer(overrides));
    const html = await markup();
    expect(html).not.toContain('data-location-form');
    expect(state.from).not.toHaveBeenCalled();
    expect(html).toContain('Update your password');
  });

  it('shows a safe load error without a misleading empty state or writable add form', async () => {
    state.readError = { message: 'internal database details' };
    const html = await markup();
    expect(html).toContain('role="alert"');
    expect(html).toContain('load your locations');
    expect(html).toContain('Reload your account');
    expect(html).not.toContain('internal database details');
    expect(html).not.toContain('Add your first address');
    expect(html).not.toContain('data-location-form');
    expect(html).toContain('Save new password');
  });

  it('retains password fields, autocomplete, and success/error feedback', async () => {
    const success = await markup({ success: 'password_updated' });
    expect(success).toContain('name="password"');
    expect(success).toContain('name="confirm_password"');
    expect(success).toContain('autoComplete="new-password"');
    expect(success).toContain('password was updated successfully');
    expect(await markup({ error: 'password_length' })).toContain('at least 8 characters');
    expect(await markup({ error: 'password_mismatch' })).toContain('confirmation did not match');
    expect(await markup({ error: 'update_failed' })).toContain('update your password right now');
  });
});

type FormProps = { action?: (data: FormData) => Promise<void>; children?: ReactNode };
function passwordAction(node: ReactNode): ((data: FormData) => Promise<void>) | undefined {
  if (Array.isArray(node)) return node.map(passwordAction).find(Boolean);
  if (!isValidElement<FormProps>(node)) return;
  if (node.type === 'form') return node.props.action;
  return passwordAction(node.props.children);
}

describe('password action remains available alongside saved locations', () => {
  it.each([
    ['', '', '/portal/settings?error=password_length'],
    ['short', 'short', '/portal/settings?error=password_length'],
    ['new-password-123', 'different-password', '/portal/settings?error=password_mismatch'],
    ['new-password-123', '', '/portal/settings?error=password_mismatch'],
    [' new-password-123 ', 'new-password-123', '/portal/settings?error=password_mismatch'],
  ])('rejects invalid password input without writing %s', async (password, confirm, destination) => {
    const action = passwordAction(await PortalSettingsPage({}));
    expect(action).toBeTypeOf('function');
    const form = new FormData();
    form.set('password', password); form.set('confirm_password', confirm);
    await expect(action!(form)).rejects.toThrow(`REDIRECT:${destination}`);
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it.each(['new-password-123', '  Keep  My Spaces!  ', 'Snow☃<&"\' 123', ' abcdef '])('saves the exact password through the authenticated session without changing locations: %j', async (password) => {
    const action = passwordAction(await PortalSettingsPage({}));
    state.from.mockClear();
    const form = new FormData();
    form.set('password', password); form.set('confirm_password', password);
    form.set('member_id', 'somebody-else');
    await expect(action!(form)).rejects.toThrow('REDIRECT:/portal/settings?success=password_updated');
    expect(state.updateUser).toHaveBeenCalledExactlyOnceWith({ password });
    expect(state.requireUser).toHaveBeenCalledTimes(2);
    expect(state.from).not.toHaveBeenCalled();
  });

  it('rejects an expired or denied session before calling Auth', async () => {
    const action = passwordAction(await PortalSettingsPage({}));
    state.createClient.mockClear();
    state.requireUser.mockRejectedValue(new Error('REDIRECT:/login'));
    const form = new FormData();
    form.set('password', 'new-password-123'); form.set('confirm_password', 'new-password-123');
    await expect(action!(form)).rejects.toThrow('REDIRECT:/login');
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it('reports Auth rejection without claiming the password was changed', async () => {
    const action = passwordAction(await PortalSettingsPage({}));
    state.updateUser.mockResolvedValue({ error: { message: 'Password policy rejected this value' } });
    const form = new FormData();
    form.set('password', 'new-password-123'); form.set('confirm_password', 'new-password-123');
    await expect(action!(form)).rejects.toThrow('REDIRECT:/portal/settings?error=update_failed');
    expect(state.updateUser).toHaveBeenCalledTimes(1);
  });

  it('rejects a form missing both password fields without changing Auth', async () => {
    const action = passwordAction(await PortalSettingsPage({}));
    await expect(action!(new FormData())).rejects.toThrow('REDIRECT:/portal/settings?error=password_length');
    expect(state.updateUser).not.toHaveBeenCalled();
  });
});
