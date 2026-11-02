import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  write: vi.fn(), scope: vi.fn(), from: vi.fn(), createUser: vi.fn(), deleteUser: vi.fn(),
  updateUser: vi.fn(), welcome: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
  notFound: () => { throw new Error('NOT_FOUND'); },
}));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: async () => ({ access: { centers: { canEdit: true }, orders: { canView: false } }, centerScope: null }),
  requireManageAdmins: vi.fn(),
}));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: mocks.write }));
vi.mock('@/lib/admin-center-scope', () => ({ requireCenterAccess: mocks.scope }));
vi.mock('@/lib/admin-audit', () => ({ recordAdminAuditLog: vi.fn() }));
vi.mock('@/lib/last-seen', () => ({ scheduleUserLastSeen: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendCustomerWelcomeEmail: mocks.welcome }));
vi.mock('@/app/admin/users/[id]/quickbooks-actions', () => ({ retryCustomerQuickBooksSync: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => database }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: mocks.from, auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser, updateUserById: mocks.updateUser } } },
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));

const member = { id: 'user-1', center_id: 'center-1', email: 'buyer@example.com', full_name: 'Buyer', is_active: true, is_admin: false, is_superadmin: false };
const database = {
  from(table: string) {
    const query = {
      select: () => query, eq: () => query, order: () => query,
      maybeSingle: async () => ({ data: table === 'centers' ? { id: 'center-1', name: 'Customer', quickbooks_customer_id: 'qb-1' } : member, error: null }),
      then: (resolve: (result: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: table === 'profiles' ? [member] : [], error: null }).then(resolve),
    };
    return query;
  },
  auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut },
};

import UserDetailPage from '@/app/admin/users/[id]/page';
import CustomerWorkspaceTabs from '@/components/customer-workspace-tabs';
import { login } from '@/app/login/actions';
import { resetCenterLoginPassword } from '@/app/admin/users/[id]/login-actions';

type Props = { children?: ReactNode; panels?: Record<string, ReactNode>; action?: (data: FormData) => Promise<void>; saveAction?: (data: FormData) => Promise<void> };
function find(node: ReactNode, matches: (element: ReactElement<Props>) => boolean): ReactElement<Props> | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, matches)).find(Boolean);
  if (!isValidElement<Props>(node)) return;
  if (matches(node)) return node;
  return find(node.props.children, matches);
}
async function action(name: 'addCenterLogin' | 'updateCenterLogin') {
  const page = await UserDetailPage({ params: Promise.resolve({ id: 'center-1' }), searchParams: Promise.resolve({ tab: 'people' }) });
  const tabs = find(page, (node) => node.type === CustomerWorkspaceTabs);
  const form = find(tabs?.props.panels?.people, (node) => node.props.action?.name === name || node.props.saveAction?.name === name);
  const handler = form?.props.action ?? form?.props.saveAction;
  expect(handler).toBeTypeOf('function');
  return handler!;
}
function form(password: string | undefined, overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ center_id: 'center-1', member_id: 'user-1', email: member.email, full_name: member.full_name, is_active: 'on', password, confirm_password: password, ...overrides })) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

let profileError: { message: string } | null;
let profileMissing: boolean;
let savedPassword: string;
let auditError: { message: string } | null;
let auditThrows: boolean;
let auditRows: Array<Record<string, unknown>>;
let profileWrites: Array<Record<string, unknown>>;
let profiles: Array<Record<string, unknown>>;
beforeEach(() => {
  vi.resetAllMocks();
  profileError = null;
  profileMissing = false;
  savedPassword = 'previous-password';
  auditError = null;
  auditThrows = false;
  auditRows = [];
  profileWrites = [];
  profiles = [
    { ...member },
    { ...member, id: 'other-center-user', center_id: 'other-center', email: 'other@example.com' },
    { ...member, id: 'admin-user', is_admin: true, email: 'admin@example.com' },
  ];
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
  mocks.write.mockResolvedValue({ profile: { id: 'admin-1' } });
  mocks.createUser.mockImplementation(async ({ password }: { password: string }) => {
    savedPassword = password;
    return { data: { user: { id: member.id } }, error: null };
  });
  mocks.deleteUser.mockResolvedValue({ data: {}, error: null });
  mocks.updateUser.mockImplementation(async (_id: string, { password }: { password: string }) => {
    savedPassword = password;
    return { data: { user: member }, error: null };
  });
  mocks.welcome.mockResolvedValue({ ok: true });
  mocks.signIn.mockImplementation(async ({ password }: { password: string }) => ({
    data: { user: password === savedPassword ? member : null },
    error: password === savedPassword ? null : { code: 'invalid_credentials' },
  }));
  mocks.from.mockImplementation((table: string) => {
    const filters = new Map<string, unknown>();
    let write: Record<string, unknown> | undefined;
    const result = () => {
      if (table === 'admin_audit_log') {
        if (auditThrows) throw new Error('Audit unavailable');
        return { data: null, error: auditError };
      }
      if (table === 'centers') return { data: { name: 'Customer' }, error: null };
      const match = profileMissing ? undefined : profiles.find((profile) => [...filters].every(([key, value]) => profile[key] === value));
      if (!profileError && match && write) {
        profileWrites.push(write);
        Object.assign(match, write);
      }
      return { data: profileError ? null : match ?? null, error: profileError };
    };
    const query = {
      select: () => query,
      update: (payload: Record<string, unknown>) => { write = payload; return query; },
      upsert: (payload: Record<string, unknown>) => { write = payload; return query; },
      insert: (payload: Record<string, unknown>) => { if (table === 'admin_audit_log') auditRows.push(payload); return query; },
      eq: (key: string, value: unknown) => { filters.set(key, value); return query; },
      maybeSingle: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(result).then(resolve, reject),
    };
    return query;
  });
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('customer login password lifecycle', () => {
  it.each(['  Keep  My Spaces!  ', 'Snow☃<&"\' 123', ' abcdef '])('uses identical password bytes for added login, email, and sign-in: %j', async (password) => {
    await expect((await action('addCenterLogin'))(form(password))).rejects.toThrow('success=login_added');
    expect(mocks.createUser).toHaveBeenCalledWith({ email: member.email, password, email_confirm: true });
    expect(mocks.welcome).toHaveBeenCalledWith(expect.objectContaining({ password }));
    await expect(login(form(password))).rejects.toThrow('REDIRECT:/portal');
    expect(mocks.signIn).toHaveBeenCalledWith({ email: member.email, password });
  });

  it('does not welcome or modify an existing login when Auth rejects creation', async () => {
    mocks.createUser.mockResolvedValue({ data: { user: null }, error: { message: 'Account already exists' } });
    await expect((await action('addCenterLogin'))(form('new-password'))).rejects.toThrow('error=login_create_failed');
    expect(savedPassword).toBe('previous-password');
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.welcome).not.toHaveBeenCalled();
  });

  it('cleans up a newly created Auth user without sending welcome when the profile cannot be saved', async () => {
    profileError = { message: 'Profile save failed' };
    await expect((await action('addCenterLogin'))(form('new-password'))).rejects.toThrow('error=login_create_failed');
    expect(mocks.deleteUser).toHaveBeenCalledExactlyOnceWith(member.id);
    expect(mocks.welcome).not.toHaveBeenCalled();
  });

  it('keeps an added login and reports welcome delivery failure without changing its password', async () => {
    mocks.welcome.mockResolvedValue({ ok: false, error: 'Delivery failed' });
    await expect((await action('addCenterLogin'))(form('new-password'))).rejects.toThrow('success=login_added&warning=welcome_email_failed');
    expect(savedPassword).toBe('new-password');
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('validates new login password length before creating an account', async () => {
    await expect((await action('addCenterLogin'))(form('short'))).rejects.toThrow('error=login_password_invalid');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.welcome).not.toHaveBeenCalled();
  });
});

describe('ordinary customer login details save', () => {
  it.each([undefined, '', 'short', 'autofilled-manager-password', '  My  Password!  '])('never changes the password when the submitted field is %j', async (password) => {
    const data = form(password, { full_name: 'Updated buyer', confirm_password: 'irrelevant-confirmation' });
    data.delete('is_active');
    await expect((await action('updateCenterLogin'))(data)).rejects.toThrow('success=login_saved');
    expect(profileWrites).toEqual([{ full_name: 'Updated buyer', is_active: false }]);
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(savedPassword).toBe('previous-password');
    expect(auditRows).toEqual([]);
  });

  it.each(['profile-error', 'missing-profile', 'other-center-user', 'admin-user'])('fails a scoped profile save safely: %s', async (failure) => {
    const save = await action('updateCenterLogin');
    profileError = failure === 'profile-error' ? { message: 'Database unavailable' } : null;
    profileMissing = failure === 'missing-profile';
    const memberId = failure.endsWith('-user') ? failure : member.id;
    await expect(save(form('autofilled-password', { member_id: memberId }))).rejects.toThrow('error=login_save_failed');
    expect(profileWrites).toEqual([]);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});

describe('explicit customer password reset', () => {
  it.each(['  My  New Password!  ', 'Snow☃<&"\' 123', ' abcdef '])('resets only the intended user and preserves the confirmed password exactly: %j', async (password) => {
    await expect(resetCenterLoginPassword(form(password))).rejects.toThrow('success=login_password_reset');
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith('/admin/users/center-1?error=admin_write_denied', 'centers');
    expect(mocks.scope).toHaveBeenCalledExactlyOnceWith('center-1', '/admin/users/center-1?error=admin_write_denied');
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith(member.id, { password });
    expect(mocks.welcome).not.toHaveBeenCalled();
    expect(profileWrites).toEqual([]);
    await expect(login(form(password))).rejects.toThrow('REDIRECT:/portal');
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ actor_profile_id: 'admin-1', target_profile_id: member.id, section_key: 'centers' });
    expect(JSON.stringify(auditRows)).not.toContain(JSON.stringify(password).slice(1, -1));
    expect(JSON.stringify(auditRows)).not.toContain('confirm_password');
  });

  it.each([undefined, '', 'short'])('rejects a missing or short explicit reset password: %j', async (password) => {
    await expect(resetCenterLoginPassword(form(password))).rejects.toThrow('error=login_password_invalid');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each(['center_id', 'member_id'])('requires the intended customer and login identifiers: %s', async (field) => {
    const data = form('new-password');
    data.delete(field);
    await expect(resetCenterLoginPassword(data)).rejects.toThrow('REDIRECT:/admin/users');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each(['', 'new-password ', 'NEW-password', 'different-password'])('requires exact confirmation before any write: %j', async (confirmation) => {
    await expect(resetCenterLoginPassword(form('new-password', { confirm_password: confirmation }))).rejects.toThrow('error=login_password_mismatch');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects an omitted confirmation field', async () => {
    const data = form('new-password');
    data.delete('confirm_password');
    await expect(resetCenterLoginPassword(data)).rejects.toThrow('error=login_password_mismatch');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each(['profile-error', 'missing-profile', 'unknown-user', 'other-center-user', 'admin-user'])('does not reset a profile that does not match every scope filter: %s', async (failure) => {
    profileError = failure === 'profile-error' ? { message: 'Database unavailable' } : null;
    profileMissing = failure === 'missing-profile';
    const memberId = failure.endsWith('-user') ? failure : member.id;
    await expect(resetCenterLoginPassword(form('new-password', { member_id: memberId }))).rejects.toThrow('error=login_save_failed');
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(auditRows).toEqual([]);
  });

  it.each(['returned-error', 'network-throw'])('reports a failed reset without false success or an audit success record: %s', async (failure) => {
    if (failure === 'network-throw') mocks.updateUser.mockRejectedValue(new Error('Network unavailable'));
    else mocks.updateUser.mockResolvedValue({ error: { message: 'Password rejected' } });
    await expect(resetCenterLoginPassword(form('new-password'))).rejects.toThrow('error=login_password_failed');
    expect(savedPassword).toBe('previous-password');
    expect(auditRows).toEqual([]);
  });

  it.each(['returned-error', 'network-throw'])('reports an audit warning after a successful reset when logging fails: %s', async (failure) => {
    auditError = failure === 'returned-error' ? { message: 'Audit write rejected' } : null;
    auditThrows = failure === 'network-throw';
    await expect(resetCenterLoginPassword(form('new-password'))).rejects.toThrow('success=login_password_reset&warning=password_audit_failed');
    expect(savedPassword).toBe('new-password');
    expect(mocks.updateUser).toHaveBeenCalledTimes(1);
  });
});

describe('customer login action permission boundaries', () => {
  it.each([
    ['addCenterLogin', 'write'], ['addCenterLogin', 'scope'],
    ['updateCenterLogin', 'write'], ['updateCenterLogin', 'scope'],
    ['resetCenterLoginPassword', 'write'], ['resetCenterLoginPassword', 'scope'],
  ] as const)('requires %s %s permission before any mutation', async (name, permission) => {
    const handler = name === 'resetCenterLoginPassword' ? resetCenterLoginPassword : await action(name);
    mocks[permission].mockRejectedValue(new Error('Denied'));
    await expect(handler(form('new-password'))).rejects.toThrow('Denied');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.welcome).not.toHaveBeenCalled();
  });
});
