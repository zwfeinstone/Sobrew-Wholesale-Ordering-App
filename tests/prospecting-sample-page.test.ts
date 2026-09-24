import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ owner: true, lead: null as Record<string, unknown> | null, contacts: [] as Record<string, unknown>[], request: null as Record<string, unknown> | null, leadError: null as object | null, replay: vi.fn(), commit: vi.fn() }));
vi.mock('next/link', () => ({ default: (props: Record<string, unknown>) => createElement('a', props) }));
vi.mock('next/navigation', () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`); }, useRouter: () => ({ push: vi.fn() }), usePathname: () => '', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/prospecting-rollout', () => ({ isProspectingWorkspaceEnabled: () => true }));
vi.mock('@/lib/admin-permissions', () => ({ adminCanEdit: () => true, requireAdminSectionView: async () => ({ isOwner: fixture.owner, access: {}, profile: { id: '11111111-1111-4111-8111-111111111111' } }), requireAdminSectionEdit: async () => ({ isOwner: fixture.owner, profile: { id: '11111111-1111-4111-8111-111111111111' } }) }));
vi.mock('@/lib/prospecting-mutations', () => ({ readProspectingMutationReceipt: (...args: unknown[]) => fixture.replay(...args), commitProspectingRecord: (...args: unknown[]) => fixture.commit(...args) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => database }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => database }));
class Query {
  constructor(private table: string) {}
  select() { return this; } eq() { return this; } neq() { return this; } is() { return this; } order() { return this; }
  result() {
    if (this.table === 'prospecting_leads') return { data: fixture.lead, error: fixture.leadError };
    if (this.table === 'prospecting_contacts') return { data: fixture.contacts, error: null };
    if (this.table === 'prospecting_sample_requests') return { data: fixture.request, error: null };
    return { data: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Sample box', sku: 'SAMPLE', product_recipes: [{ id: 'recipe' }] }], error: null };
  }
  maybeSingle() { return Promise.resolve(this.result()); }
  then(resolve: (result: ReturnType<Query['result']>) => unknown) { return Promise.resolve(this.result()).then(resolve); }
}
const database = { from: (table: string) => new Query(table) };
const leadId = '22222222-2222-4222-8222-222222222222';
beforeEach(() => { Object.assign(fixture, { owner: true, lead: null, contacts: [], request: null, leadError: null });fixture.replay.mockReset();fixture.commit.mockReset(); });
function findAction(node: ReactNode): ((previous: object, data: FormData) => Promise<Record<string, unknown>>) | undefined {
  if (Array.isArray(node)) return node.map(findAction).find(Boolean);
  if (!isValidElement<{ action?: (previous: object, data: FormData) => Promise<Record<string, unknown>>; children?: ReactNode }>(node)) return;
  return node.props.action || findAction(node.props.children);
}
function sampleFormData() {
  const form = new FormData();
  for (const [name, value] of Object.entries({ submission_id: leadId, center_name: 'Center', attention_name: 'Buyer', address1: 'Main', city: 'Chicago', state: 'IL', zip: '60601', product_id: leadId, quantity: '1', queue_origin: 'samples', queue_return_to: '/admin/sales/prospecting/admin?tab=requests&sample_page=3' })) form.set(name, value);
  return form;
}
describe('sample order entrypoint preserves user intent', () => {
  it('renders a standalone order only when no linked record was requested', async () => {
    const Page = (await import('@/app/admin/sales/prospecting/sample-order/page')).default;
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('standalone sample shipment');expect(html).toContain('name="submission_id"');expect(html).toContain('Create sample order');
  });
  it('does not silently turn a missing linked lead into a standalone order', async () => {
    const Page = (await import('@/app/admin/sales/prospecting/sample-order/page')).default;
    fixture.leadError = { message: 'network failed' };
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ lead: leadId }) }));
    expect(html).toContain('Sample request unavailable');expect(html).not.toContain('<form');expect(html).not.toContain('standalone');
  });
  it('routes a new linked sample through the shared record wizard with its queue', async () => {
    const Page = (await import('@/app/admin/sales/prospecting/sample-order/page')).default;
    fixture.lead = { id: leadId, stage: 'working', company_name: 'Center' };
    await expect(Page({ searchParams: Promise.resolve({ lead: leadId, tab: 'tasks', state: 'IL' }) })).rejects.toThrow(/redirect:.*sample=1/);
  });
  it('prefills saved manager request details and preserves the loaded version', async () => {
    const Page = (await import('@/app/admin/sales/prospecting/sample-order/page')).default;
    fixture.lead = { id: leadId, stage: 'sample_requested', company_name: 'Center', updated_at: '2026-09-24T10:00:00Z' };
    fixture.contacts = [{ id: 'contact', full_name: 'Jane', email: 'jane@example.com', is_primary: true }];
    fixture.request = { id: leadId, lead_id: leadId, status: 'pending', contact_id: 'contact', details: { address1: 'Saved request address', notes: 'Morning delivery' }, closed_at: null };
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ lead: leadId, request: leadId }) }));
    expect(html).toContain('Fulfill sample request');expect(html).toContain('Saved request address');expect(html).toContain('Morning delivery');expect(html).toContain('name="expected_updated_at" value="2026-09-24T10:00:00Z"');
    expect(html).toContain('href="/admin/sales/prospecting/admin?tab=requests"');
  });
  it('checks the full unsigned submission in the atomic RPC instead of bypassing changed values with an early receipt', async () => {
    const Page = (await import('@/app/admin/sales/prospecting/sample-order/page')).default;
    fixture.replay.mockResolvedValue({ orderId: 'existing-order' });
    fixture.commit.mockResolvedValue({ ok: false, error: { code: 'submission_reused', message: 'Values changed', fieldErrors: {} } });
    const action = findAction(await Page({ searchParams: Promise.resolve({}) }));
    expect(await action!({}, sampleFormData())).toMatchObject({ code: 'submission_reused', error: 'Values changed' });
    expect(fixture.replay).not.toHaveBeenCalled();expect(fixture.commit).toHaveBeenCalledOnce();
  });
  it('returns a successful RPC replay to the original manager request list and pagination', async () => {
    const Page = (await import('@/app/admin/sales/prospecting/sample-order/page')).default;
    fixture.commit.mockResolvedValue({ ok: true, receipt: { orderId: 'saved-order', replayed: true } });
    const action = findAction(await Page({ searchParams: Promise.resolve({}) }));
    expect(await action!({}, sampleFormData())).toEqual({ orderId: 'saved-order', successHref: '/admin/sales/prospecting/admin?tab=requests&sample_page=3' });
  });
});
