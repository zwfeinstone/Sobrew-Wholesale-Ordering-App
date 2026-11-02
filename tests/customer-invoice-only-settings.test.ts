import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  center: {} as Record<string, unknown>,
  canEdit: true,
  centerScope: null as string[] | null,
  write: vi.fn(),
  scope: vi.fn(),
  update: vi.fn(),
  adminFrom: vi.fn(),
  updateError: null as { message: string } | null,
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT:${url}`), { digest: 'NEXT_REDIRECT;replace' }); },
  notFound: () => { throw new Error('NOT_FOUND'); },
}));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: async () => ({
    access: { centers: { canEdit: state.canEdit }, orders: { canView: false } },
    centerScope: state.centerScope,
  }),
  requireManageAdmins: vi.fn(),
}));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: state.write }));
vi.mock('@/lib/admin-center-scope', () => ({ requireCenterAccess: state.scope }));
vi.mock('@/lib/admin-audit', () => ({ recordAdminAuditLog: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendCustomerWelcomeEmail: vi.fn() }));
vi.mock('@/app/admin/users/[id]/quickbooks-actions', () => ({ retryCustomerQuickBooksSync: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => database }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: state.adminFrom } }));

class Query {
  constructor(private table: string) {}
  select() { return this; }
  eq() { return this; }
  order() { return this; }
  maybeSingle() { return Promise.resolve({ data: this.table === 'centers' ? state.center : null, error: null }); }
  then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
    return Promise.resolve({ data: [], error: null }).then(resolve);
  }
}
const database = { from: (table: string) => new Query(table) };

import UserDetailPage from '@/app/admin/users/[id]/page';
import CustomerWorkspaceTabs from '@/components/customer-workspace-tabs';
import { UserWizard } from '@/components/user-wizard';

type NodeProps = {
  children?: ReactNode;
  panels?: Record<string, ReactNode>;
  action?: (data: FormData) => Promise<void>;
  name?: string;
};
function findElement(node: ReactNode, matches: (element: ReactElement<NodeProps>) => boolean): ReactElement<NodeProps> | undefined {
  if (Array.isArray(node)) return node.map((child) => findElement(child, matches)).find(Boolean);
  if (!isValidElement<NodeProps>(node)) return;
  if (matches(node)) return node;
  return findElement(node.props.children, matches);
}
async function settings() {
  const page = await UserDetailPage({ params: Promise.resolve({ id: 'center-1' }), searchParams: Promise.resolve({ tab: 'settings' }) });
  const tabs = findElement(page, (node) => node.type === CustomerWorkspaceTabs);
  expect(tabs?.props.panels?.settings).toBeDefined();
  const panel = tabs!.props.panels!.settings;
  const form = findElement(panel, (node) => node.type === 'form');
  expect(form?.props.action).toBeTypeOf('function');
  return { panel, action: form!.props.action! };
}
function form(checked: boolean) {
  const data = new FormData();
  data.set('center_id', 'center-1');
  data.set('name', 'Arise Cafe');
  data.set('is_active', 'on');
  if (checked) data.set('automatic_invoice_only', 'on');
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  state.center = { id: 'center-1', name: 'Arise Cafe', is_active: true, automatic_invoice_only: false, quickbooks_customer_id: 'qb-1' };
  state.canEdit = true;
  state.centerScope = null;
  state.updateError = null;
  state.adminFrom.mockReturnValue({ update: state.update });
  state.update.mockImplementation((values: Record<string, unknown>) => ({
    eq: async (column: string, value: string) => {
      expect(column).toBe('id');
      expect(value).toBe('center-1');
      if (!state.updateError) Object.assign(state.center, values);
      return { error: state.updateError };
    },
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('customer invoice-only setting', () => {
  it.each([false, true])('renders the persisted checkbox state %s in the customer Settings tab', async (checked) => {
    state.center.automatic_invoice_only = checked;
    const markup = renderToStaticMarkup((await settings()).panel);
    const input = markup.match(/<input\b[^>]*name="automatic_invoice_only"[^>]*>/)?.[0];
    expect(input).toBeDefined();
    expect(input?.includes('checked')).toBe(checked);
    expect(input).not.toContain('disabled');
    expect(input).toContain('aria-describedby="automatic-invoice-only-help"');
    expect(markup).toContain('Send PDF invoices only');
    expect(markup).toContain('without automatically charging saved payment methods');
    expect(markup).toContain('invoice email and CC rules still apply');
    if (checked && process.env.GENERATE_INVOICE_ONLY_PREVIEW === '1') {
      writeFileSync('/tmp/sobrew-invoice-only-settings.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Customer Settings</title></head><body><main class="mx-auto max-w-5xl space-y-6 px-3 py-6 sm:px-6"><h1 class="page-title">Arise Cafe · Settings</h1>${markup}</main></body></html>`);
    }
  });

  it.each([true, false])('saves %s through the actual form action after checking edit permission and customer scope', async (checked) => {
    state.center.automatic_invoice_only = !checked;
    const { action } = await settings();
    await expect(action(form(checked))).rejects.toThrow('REDIRECT:/admin/users/center-1?tab=settings&success=center_saved');
    expect(state.write).toHaveBeenCalledExactlyOnceWith('/admin/users/center-1?error=admin_write_denied', 'centers');
    expect(state.scope).toHaveBeenCalledExactlyOnceWith('center-1', '/admin/users/center-1?error=admin_write_denied');
    expect(state.write.mock.invocationCallOrder[0]).toBeLessThan(state.scope.mock.invocationCallOrder[0]);
    expect(state.scope.mock.invocationCallOrder[0]).toBeLessThan(state.adminFrom.mock.invocationCallOrder[0]);
    expect(state.adminFrom).toHaveBeenCalledExactlyOnceWith('centers');
    expect(state.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ automatic_invoice_only: checked }));
    const savedMarkup = renderToStaticMarkup((await settings()).panel);
    expect(savedMarkup.match(/<input\b[^>]*name="automatic_invoice_only"[^>]*>/)?.[0]?.includes('checked')).toBe(checked);
  });

  it('disables the checkbox and save button for a read-only viewer', async () => {
    state.canEdit = false;
    state.center.automatic_invoice_only = true;
    const markup = renderToStaticMarkup((await settings()).panel);
    expect(markup.match(/<input\b[^>]*name="automatic_invoice_only"[^>]*>/)?.[0]).toContain('disabled');
    expect(markup.match(/<button\b[^>]*>Save customer<\/button>/)?.[0]).toContain('disabled');
  });

  it.each(['write', 'scope'] as const)('rejects a direct save without %s access before any database mutation', async (permission) => {
    const { action } = await settings();
    state[permission].mockRejectedValue(new Error('Denied'));
    await expect(action(form(true))).rejects.toThrow('Denied');
    expect(state.adminFrom).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });

  it('rejects viewing a customer outside the allowed center scope', async () => {
    state.centerScope = ['other-center'];
    await expect(settings()).rejects.toThrow('REDIRECT:/admin/access-denied?section=centers');
    expect(state.update).not.toHaveBeenCalled();
  });

  it('reports a failed save without silently changing the setting', async () => {
    const { action } = await settings();
    state.updateError = { message: 'Save failed' };
    await expect(action(form(true))).rejects.toThrow('REDIRECT:/admin/users/center-1?tab=settings&error=center_save_failed');
    expect(state.center.automatic_invoice_only).toBe(false);
  });

  it('does not add the option to the new-customer wizard', () => {
    const markup = renderToStaticMarkup(createElement(UserWizard, { products: [] }));
    expect(markup).not.toContain('automatic_invoice_only');
    expect(markup).not.toContain('Send PDF invoices only');
  });
});
