import { isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { bootstrapToken: 'configured-bootstrap-token' },
  from: vi.fn(), settings: vi.fn(), upsert: vi.fn(), updateSettings: vi.fn(),
  createClient: vi.fn(), listUsers: vi.fn(), createUser: vi.fn(), updateUser: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: mocks.from,
    auth: { admin: { listUsers: mocks.listUsers, createUser: mocks.createUser, updateUserById: mocks.updateUser } },
  },
}));
vi.mock('@/components/pending-submit-button', () => ({ default: () => null }));

import BootstrapPage from '@/app/bootstrap/page';

type FormAction = (data: FormData) => Promise<void>;
function findAction(node: ReactNode): FormAction | undefined {
  if (Array.isArray(node)) return node.map(findAction).find(Boolean);
  if (!isValidElement<{ children?: ReactNode; action?: FormAction }>(node)) return;
  if (node.type === 'form') return node.props.action;
  return findAction(node.props.children);
}
function submit(token: string | undefined = 'configured-bootstrap-token', password = '  Exact  Password!  ') {
  const data = new FormData();
  data.set('email', '  Buyer@Example.com  ');
  data.set('password', password);
  if (token !== undefined) data.set('token', token);
  const action = findAction(BootstrapPage());
  expect(action).toBeTypeOf('function');
  return action!(data);
}
function expectNoAuthOrWrites() {
  for (const call of [mocks.createClient, mocks.listUsers, mocks.createUser, mocks.updateUser, mocks.signIn, mocks.signOut, mocks.upsert, mocks.updateSettings]) {
    expect(call).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
  mocks.env.bootstrapToken = 'configured-bootstrap-token';
  mocks.settings.mockResolvedValue({ data: { id: 'settings-1', bootstrap_completed: false }, error: null });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.updateSettings.mockResolvedValue({ data: { id: 'settings-1' }, error: null });
  mocks.from.mockImplementation((table: string) => {
    if (table === 'profiles') return { upsert: mocks.upsert };
    if (table === 'app_settings') return {
      select: () => ({ single: mocks.settings }),
      update: (values: unknown) => ({
        eq: (column: string, id: string) => ({
          select: (selected: string) => ({ single: () => mocks.updateSettings(values, column, id, selected) }),
        }),
      }),
    };
    throw new Error(`Unexpected table: ${table}`);
  });
  mocks.createClient.mockResolvedValue({ auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut } });
  mocks.listUsers.mockResolvedValue({ data: { users: [{ id: 'existing-user', email: 'buyer@example.com' }] }, error: null });
  mocks.createUser.mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null });
  mocks.updateUser.mockResolvedValue({ data: { user: { id: 'existing-user' } }, error: null });
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('bootstrap password safety', () => {
  it.each([
    { label: 'unset configuration and omitted token', configured: '', submitted: undefined },
    { label: 'unset configuration and empty token', configured: '', submitted: '' },
    { label: 'whitespace-only configuration and matching token', configured: '   ', submitted: '   ' },
    { label: 'omitted token', configured: 'configured-bootstrap-token', submitted: undefined },
    { label: 'empty token', configured: 'configured-bootstrap-token', submitted: '' },
    { label: 'wrong token', configured: 'configured-bootstrap-token', submitted: 'wrong-token' },
    { label: 'token with added whitespace', configured: 'configured-bootstrap-token', submitted: ' configured-bootstrap-token ' },
  ])('rejects $label before reading settings or accessing Auth', async ({ configured, submitted }) => {
    mocks.env.bootstrapToken = configured;
    // Omission must remain an omitted form field, including in the configured-token case.
    const data = new FormData();
    data.set('email', 'buyer@example.com');
    data.set('password', 'replacement-password');
    if (submitted !== undefined) data.set('token', submitted);
    await expect(findAction(BootstrapPage())!(data)).rejects.toThrow('REDIRECT:/bootstrap?error=token');
    expect(mocks.from).not.toHaveBeenCalled();
    expectNoAuthOrWrites();
  });

  it.each([
    { label: 'missing settings row', data: null, error: null },
    { label: 'settings read error', data: null, error: { message: 'Unavailable' } },
    { label: 'ambiguous singleton read', data: null, error: { code: 'PGRST116', message: 'Multiple rows' } },
    { label: 'error alongside an incomplete row', data: { id: 'settings-1', bootstrap_completed: false }, error: { message: 'Read failed' } },
    { label: 'null completion status', data: { id: 'settings-1', bootstrap_completed: null }, error: null },
    { label: 'missing completion status', data: { id: 'settings-1' }, error: null },
    { label: 'string completion status', data: { id: 'settings-1', bootstrap_completed: 'false' }, error: null },
    { label: 'numeric completion status', data: { id: 'settings-1', bootstrap_completed: 0 }, error: null },
    { label: 'missing settings identifier', data: { bootstrap_completed: false }, error: null },
    { label: 'empty settings identifier', data: { id: '', bootstrap_completed: false }, error: null },
    { label: 'blank settings identifier', data: { id: '   ', bootstrap_completed: false }, error: null },
  ])('fails closed for $label', async ({ data, error }) => {
    mocks.settings.mockResolvedValue({ data, error });
    await expect(submit()).rejects.toThrow('REDIRECT:/bootstrap?error=config');
    expectNoAuthOrWrites();
  });

  it('cannot change an existing password after bootstrap is complete', async () => {
    mocks.settings.mockResolvedValue({ data: { id: 'settings-1', bootstrap_completed: true }, error: null });
    await expect(submit()).rejects.toThrow('REDIRECT:/login?bootstrap=done');
    expectNoAuthOrWrites();
  });

  it.each(['  Exact  Password!  ', 'Snow☃<&\"\'123'])('preserves the exact password during permitted initial setup of an existing user: %j', async (password) => {
    await expect(submit('configured-bootstrap-token', password)).rejects.toThrow('REDIRECT:/admin');
    expect(mocks.settings).toHaveBeenCalledOnce();
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith('existing-user', { password, email_confirm: true });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith({ email: 'buyer@example.com', password });
    expect(mocks.updateSettings).toHaveBeenCalledExactlyOnceWith({ bootstrap_completed: true }, 'id', 'settings-1', 'id');
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.settings.mock.invocationCallOrder[0]).toBeLessThan(mocks.listUsers.mock.invocationCallOrder[0]);
  });

  it('retains initial admin creation when settings explicitly allow bootstrap', async () => {
    mocks.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
    await expect(submit()).rejects.toThrow('REDIRECT:/admin');
    expect(mocks.createUser).toHaveBeenCalledExactlyOnceWith({ email: 'buyer@example.com', password: '  Exact  Password!  ', email_confirm: true });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith({ id: 'new-user', email: 'buyer@example.com', is_admin: true, is_active: true }, { onConflict: 'id' });
  });

  it.each(['returned', 'thrown'])('stops before sign-in and completion when the profile write has a %s error', async (failure) => {
    if (failure === 'returned') mocks.upsert.mockResolvedValue({ error: { message: 'Profile write failed' } });
    else mocks.upsert.mockRejectedValue(new Error('Profile write failed'));
    await expect(submit()).rejects.toThrow('REDIRECT:/bootstrap?error=profile');
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'returned error', data: null, error: { message: 'Lock write failed' } },
    { label: 'error alongside a returned row', data: { id: 'settings-1' }, error: { message: 'Lock write failed' } },
    { label: 'no returned row', data: null, error: null },
    { label: 'wrong returned identifier', data: { id: 'other-settings' }, error: null },
  ])('clears the new session and denies setup success after completion $label', async ({ data, error }) => {
    mocks.updateSettings.mockResolvedValue({ data, error });
    await expect(submit()).rejects.toThrow('REDIRECT:/bootstrap?error=lock');
    expect(mocks.signIn).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
    expect(mocks.signIn.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateSettings.mock.invocationCallOrder[0]);
    expect(mocks.updateSettings.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]);
  });

  it('clears the new session when the completion write throws', async () => {
    mocks.updateSettings.mockRejectedValue(new Error('Lock write failed'));
    await expect(submit()).rejects.toThrow('REDIRECT:/bootstrap?error=lock');
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  });

  it.each(['returned', 'thrown'])('continues to report lock failure if session cleanup has a %s error', async (failure) => {
    mocks.updateSettings.mockResolvedValue({ data: null, error: null });
    if (failure === 'returned') mocks.signOut.mockResolvedValue({ error: { message: 'Sign-out failed' } });
    else mocks.signOut.mockRejectedValue(new Error('Sign-out failed'));
    await expect(submit()).rejects.toThrow('REDIRECT:/bootstrap?error=lock');
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  });
});
