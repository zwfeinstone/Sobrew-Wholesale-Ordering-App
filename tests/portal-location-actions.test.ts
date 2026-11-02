import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  adminFrom: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: state.requireUser }));
vi.mock('@/lib/supabase/server', () => ({ createClient: state.createClient }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: state.adminFrom } }));
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }));

import { addPortalLocation, updatePortalLocation } from '@/app/portal/settings/location-actions';
import { initialPortalLocationFormState } from '@/lib/portal-locations';

const CENTER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CENTER_ID = '22222222-2222-4222-8222-222222222222';
const LOCATION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

function authenticatedCustomer(profileOverrides: Record<string, unknown> = {}) {
  return {
    user: { id: USER_ID, email: 'buyer@example.test' },
    profile: {
      id: USER_ID,
      center_id: CENTER_ID,
      is_active: true,
      is_admin: false,
      center: { id: CENTER_ID, is_active: true, name: 'Recovery Center' },
      ...profileOverrides,
    },
  };
}

function locationForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    location_id: LOCATION_ID,
    name: '  East building  ',
    address1: '  123 Recovery Way  ',
    address2: '  Suite 2  ',
    city: '  Memphis  ',
    state: ' tn ',
    zip: ' 38103-1234 ',
    ...overrides,
  })) form.set(key === 'name' ? 'location_name' : key, value);
  return form;
}

const normalizedLocation = {
  name: 'East building', address1: '123 Recovery Way', address2: 'Suite 2',
  city: 'Memphis', state: 'TN', zip: '38103-1234',
};

function expectNoWrite() {
  expect(state.insert).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  expect(state.adminFrom).not.toHaveBeenCalled();
  expect(state.revalidate).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  state.requireUser.mockResolvedValue(authenticatedCustomer());
  const query = {
    insert: state.insert, update: state.update, eq: state.eq,
    select: state.select, maybeSingle: state.maybeSingle,
  };
  state.createClient.mockResolvedValue({ from: state.from });
  state.from.mockReturnValue(query);
  state.insert.mockReturnValue(query);
  state.update.mockReturnValue(query);
  state.eq.mockReturnValue(query);
  state.select.mockReturnValue(query);
  state.maybeSingle.mockResolvedValue({ data: { id: LOCATION_ID }, error: null });
});

describe('customer delivery location actions', () => {
  it('adds an active location to the authenticated customer and ignores forged protected fields', async () => {
    const result = await addPortalLocation(initialPortalLocationFormState, locationForm({
      center_id: OTHER_CENTER_ID, user_id: OTHER_CENTER_ID, is_active: 'false',
      id: OTHER_CENTER_ID, notes: 'forged operator notes', created_at: '2000-01-01',
    }));

    expect(result.status).toBe('success');
    expect(result.message).toBeTruthy();
    expect(state.requireUser).toHaveBeenCalledOnce();
    expect(state.createClient).toHaveBeenCalledOnce();
    expect(state.from).toHaveBeenCalledExactlyOnceWith('center_locations');
    expect(state.insert).toHaveBeenCalledExactlyOnceWith({
      ...normalizedLocation, center_id: CENTER_ID, is_active: true,
    });
    expect(state.update).not.toHaveBeenCalled();
    expect(state.adminFrom).not.toHaveBeenCalled();
    expect(state.revalidate.mock.calls.map(([path]) => path)).toEqual(['/portal/settings', '/portal/checkout']);
  });

  it('updates only an active location belonging to the authenticated customer', async () => {
    const result = await updatePortalLocation(initialPortalLocationFormState, locationForm({
      center_id: OTHER_CENTER_ID, is_active: 'false', notes: 'forged note',
      created_at: '2000-01-01', updated_at: '2000-01-01',
    }));

    expect(result.status).toBe('success');
    expect(state.update).toHaveBeenCalledExactlyOnceWith(normalizedLocation);
    expect(state.eq.mock.calls).toEqual(expect.arrayContaining([
      ['id', LOCATION_ID], ['center_id', CENTER_ID], ['is_active', true],
    ]));
    expect(state.insert).not.toHaveBeenCalled();
    expect(state.adminFrom).not.toHaveBeenCalled();
    expect(state.revalidate.mock.calls.map(([path]) => path)).toEqual(['/portal/settings', '/portal/checkout']);
  });

  it.each([
    ['add', addPortalLocation], ['update', updatePortalLocation],
  ] as const)('%s accepts a blank second address line without changing unrelated order or billing data', async (_name, action) => {
    const result = await action(initialPortalLocationFormState, locationForm({ address2: '  ' }));
    expect(result.status).toBe('success');
    const payload = (state.insert.mock.calls[0] ?? state.update.mock.calls[0])[0];
    expect(payload.address2).toBeNull();
    expect(state.from.mock.calls).toEqual([['center_locations']]);
  });

  for (const [name, action] of [['add', addPortalLocation], ['update', updatePortalLocation]] as const) {
    describe(name, () => {
      it.each([
        ['missing customer membership', { center_id: null }],
        ['inactive customer', { is_active: false }],
        ['unknown customer status', { is_active: null }],
        ['admin', { is_admin: true }],
        ['unknown account role', { is_admin: null }],
        ['missing center', { center: null }],
        ['inactive center', { center: { id: CENTER_ID, is_active: false } }],
        ['unknown center status', { center: { id: CENTER_ID, is_active: null } }],
      ])('rejects %s before any database mutation', async (_label, overrides) => {
        state.requireUser.mockResolvedValue(authenticatedCustomer(overrides));
        const result = await action(initialPortalLocationFormState, locationForm());
        expect(result.status).toBe('error');
        expectNoWrite();
      });

      it.each(['name', 'address1', 'city', 'state', 'zip'])('rejects an empty %s before writing', async (field) => {
        const result = await action(initialPortalLocationFormState, locationForm({ [field]: '  ' }));
        expect(result.status).toBe('error');
        expectNoWrite();
      });

      it.each<Record<string, string>>([{ state: 'ZZ' }, { zip: '1234' }, { zip: '38103abc' }])('rejects an invalid US address %j', async (fields) => {
        const result = await action(initialPortalLocationFormState, locationForm(fields));
        expect(result.status).toBe('error');
        expectNoWrite();
      });

      it('preserves the authentication redirect instead of mutating without a session', async () => {
        const authError = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' });
        state.requireUser.mockRejectedValue(authError);
        await expect(action(initialPortalLocationFormState, locationForm())).rejects.toBe(authError);
        expectNoWrite();
      });

      it('returns a safe error when the database rejects the write', async () => {
        const databaseMessage = 'private DB credential or internal constraint detail';
        state.maybeSingle.mockResolvedValue({ data: null, error: { message: databaseMessage } });
        const result = await action(initialPortalLocationFormState, locationForm());
        expect(result.status).toBe('error');
        expect(result.message).toBeTruthy();
        expect(result.message).not.toContain(databaseMessage);
        expect(state.revalidate).not.toHaveBeenCalled();
      });

      it('does not report success when no row was returned', async () => {
        state.maybeSingle.mockResolvedValue({ data: null, error: null });
        const result = await action(initialPortalLocationFormState, locationForm());
        expect(result.status).toBe('error');
        expect(state.revalidate).not.toHaveBeenCalled();
      });

      it('reports a safe retryable failure when the database connection throws', async () => {
        const internal = 'Internal database network and connection details';
        state.maybeSingle.mockRejectedValue(new Error(internal));
        const result = await action(initialPortalLocationFormState, locationForm());
        expect(result.status).toBe('error');
        expect(result.message).toBeTruthy();
        expect(result.message).not.toContain(internal);
        expect(state.revalidate).not.toHaveBeenCalled();
      });
    });
  }

  it.each(['', 'not-a-uuid', `${LOCATION_ID},center_id.eq.${OTHER_CENTER_ID}`])('rejects malformed update ID %s', async (locationId) => {
    const result = await updatePortalLocation(initialPortalLocationFormState, locationForm({ location_id: locationId }));
    expect(result.status).toBe('error');
    expectNoWrite();
  });

  it('treats a forged valid location ID as unavailable when ownership filters match no row', async () => {
    state.maybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await updatePortalLocation(initialPortalLocationFormState, locationForm({ location_id: OTHER_CENTER_ID }));
    expect(result.status).toBe('error');
    expect(state.eq.mock.calls).toEqual(expect.arrayContaining([
      ['id', OTHER_CENTER_ID], ['center_id', CENTER_ID], ['is_active', true],
    ]));
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});
