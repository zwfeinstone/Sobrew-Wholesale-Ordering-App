import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const leadId = '22222222-2222-4222-8222-222222222222';
vi.mock('next/link', () => ({ default: (props: Record<string, unknown>) => createElement('a', props) }));
vi.mock('next/navigation', () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`); }, notFound: () => { throw new Error('notFound'); }, useRouter: () => ({ push: vi.fn() }), usePathname: () => '', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/admin-permissions', () => ({ adminCanEdit: () => true, requireAdminSectionView: async () => ({ isOwner: true, access: {}, profile: { id: '11111111-1111-4111-8111-111111111111' } }), requireAdminSectionEdit: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => database }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => database, supabaseAdmin: { from: (table: string) => new Query(table) } }));
vi.mock('@/lib/prospecting-queue-neighbors', () => ({ loadProspectingQueueNeighbors: async () => ({ nextLeadId: null, previousLeadId: null }) }));
class Query {
  private single = false;
  constructor(private table: string) {}
  select() { return this; } eq() { return this; } neq() { return this; } is() { return this; } order() { return this; }
  in() { return this; } not() { return this; } lte() { return this; } lt() { return this; } gte() { return this; } gt() { return this; }
  or() { return this; } range() { return this; } limit() { return this; }
  result() {
    if (this.single && this.table === 'prospecting_leads') return { data: { id: leadId, company_name: 'Legacy prospect', stage: 'new', priority: 'normal', updated_at: '2026-09-24T10:00:00Z', assigned_profile_id: null }, error: null, count: 0 };
    return { data: this.single ? null : [], error: null, count: 0 };
  }
  maybeSingle() { this.single = true; return Promise.resolve(this.result()); }
  then(resolve: (result: ReturnType<Query['result']>) => unknown) { return Promise.resolve(this.result()).then(resolve); }
}
const database = { from: (table: string) => new Query(table) };

describe('rollout-off legacy navigation', () => {
  it.each([{}, { tab: 'today', preset: 'overdue' }, { tab: 'invalid' }])('keeps the legacy main view on List for %j', async (searchParams) => {
    const Page = (await import('@/app/admin/sales/prospecting/legacy-page')).default;
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
    expect(html).toContain('name="tab" value="list"');
    expect(html).not.toContain('name="tab" value="today"');
    expect(html).not.toContain('>All today<');
  });

  it.each([
    { params: {}, expected: 'list' },
    { params: { tab: 'today', preset: 'new' }, expected: 'list' },
    { params: { tab: 'tasks', state: 'IL' }, expected: 'tasks' },
    { params: { tab: 'pipeline', stage: 'interested' }, expected: 'pipeline' },
  ])('preserves legacy record and sample contexts for $expected', async ({ params, expected }) => {
    const RecordPage = (await import('@/app/admin/sales/prospecting/[id]/legacy-page')).default;
    const SamplePage = (await import('@/app/admin/sales/prospecting/sample-order/legacy-page')).default;
    const record = renderToStaticMarkup(await RecordPage({ params: Promise.resolve({ id: leadId }), searchParams: Promise.resolve(params) }));
    const sample = renderToStaticMarkup(await SamplePage({ searchParams: Promise.resolve(params) }));
    for (const html of [record, sample]) {
      expect(html).toContain(`name="queue_tab" value="${expected}"`);
      expect(html).not.toContain('name="queue_tab" value="today"');
      expect(html).not.toContain('name="queue_preset"');
      if (expected === 'tasks') expect(html).toContain('name="queue_state" value="IL"');
      if (expected === 'pipeline') expect(html).toContain('name="queue_stage" value="interested"');
    }
  });
});
