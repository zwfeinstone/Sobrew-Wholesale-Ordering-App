import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, string | number | null>;
type Table = 'orders' | 'profiles' | 'order_items';
type QueryResult = { data: Row[] | null; count: number | null; error: null };

// Apply the page's actual filters to fixture rows, so an incorrect timestamp
// changes the rendered totals instead of merely changing a mocked query call.
class ReadQuery implements PromiseLike<QueryResult> {
  private filters: Array<(row: Row) => boolean> = [];
  private ordering: Array<{ column: string; ascending: boolean }> = [];
  private maximum = Number.POSITIVE_INFINITY;
  private head = false;
  private counted = false;

  constructor(private readonly rows: Row[]) {}

  select(_columns: string, options?: { head?: boolean; count?: string }) {
    this.head = options?.head ?? false;
    this.counted = options?.count === 'exact';
    return this;
  }

  eq(column: string, value: string) { this.filters.push((row) => row[column] === value); return this; }
  neq(column: string, value: string) { this.filters.push((row) => row[column] != null && row[column] !== value); return this; }
  is(column: string, value: null) { this.filters.push((row) => row[column] === value); return this; }
  in(column: string, values: string[]) { this.filters.push((row) => values.includes(String(row[column]))); return this; }
  gte(column: string, value: string) {
    this.filters.push((row) => Date.parse(String(row[column])) >= Date.parse(value));
    return this;
  }
  lt(column: string, value: string) {
    this.filters.push((row) => Date.parse(String(row[column])) < Date.parse(value));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.ordering.push({ column, ascending: options?.ascending ?? true });
    return this;
  }
  limit(maximum: number) { this.maximum = maximum; return this; }

  then<TResult1 = QueryResult, TResult2 = never>(
    fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const matches = this.rows.filter((row) => this.filters.every((filter) => filter(row))).sort((left, right) => {
      for (const { column, ascending } of this.ordering) {
        const comparison = String(left[column]).localeCompare(String(right[column]));
        if (comparison) return ascending ? comparison : -comparison;
      }
      return 0;
    });
    return Promise.resolve({
      data: this.head ? null : matches.slice(0, this.maximum),
      count: this.counted ? matches.length : null,
      error: null,
    }).then(fulfilled, rejected);
  }
}

function database(tables: Partial<Record<Table, Row[]>> = {}) {
  return { from: (table: Table) => new ReadQuery(tables[table] ?? []) };
}

const state = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof database> }));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: async () => ({ isOwner: true, access: {}, profile: { id: 'owner' } }),
}));
vi.mock('@/lib/admin-permission-definitions', () => ({ canViewAdminSection: () => false }));
vi.mock('@/lib/admin-center-scope', () => ({
  getAssignedCenterIdsForAdmin: async () => null,
  scopeCenterRelatedQueryForAdmin: (query: unknown) => query,
}));
vi.mock('@/lib/admin-order-status', () => ({ getCachedNewOrderCount: async () => 0 }));
vi.mock('@/lib/payroll-status', () => ({ getCachedPayrollStatus: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children),
}));
vi.mock('@/components/tracked-link', () => ({
  TrackedLink: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children),
}));

import AdminDashboard from '@/app/admin/page';

function order(id: string, createdAt: string, subtotalCents = 10000, extra: Row = {}): Row {
  return {
    id, created_at: createdAt, subtotal_cents: subtotalCents, center_id: 'customer',
    order_kind: 'wholesale', status: 'Shipped', archived_at: null, ...extra,
  };
}

async function render(params: Record<string, string> = {}) {
  return renderToStaticMarkup(await AdminDashboard({ searchParams: Promise.resolve(params) }));
}

function card(markup: string, title: string) {
  const section = [...markup.matchAll(/<section class="card space-y-5">([\s\S]*?)<\/section>/g)]
    .map((match) => match[1]).find((content) => content.includes(`>${title}</p>`));
  expect(section, `Missing dashboard card: ${title}`).toBeDefined();
  const content = section!;
  const paragraphs = [...content.matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map((match) => match[1]);
  const visibleBuckets = [...content.matchAll(/<div class="font-semibold text-slate-700">([^<]*)<\/div><div class="mt-1">([^<]*)<\/div>/g)]
    .map((match) => ({ label: match[1], value: match[2] }));
  return { value: paragraphs[1], barCount: [...content.matchAll(/<rect\b/g)].length, visibleBuckets, content };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T18:00:00Z'));
  state.client = database();
});
afterEach(() => vi.useRealTimers());

describe('admin dashboard Central calendar ranges', () => {
  it('excludes the late September $108 order from October totals and includes Central midnight', async () => {
    const october = Array.from({ length: 28 }, (_, index) => order(
      `october-${index}`, index === 0 ? '2026-10-01T05:00:00Z' : '2026-10-08T18:00:00Z',
      index === 27 ? 23210 : 17500,
      index === 1 ? { archived_at: '2026-10-07T18:00:00Z' } : {},
    ));
    state.client = database({ orders: [
      ...october,
      order('late-september', '2026-10-01T04:59:59.999Z', 10800),
      order('sample', '2026-10-08T18:00:00Z', 99900, { order_kind: 'prospecting_sample' }),
      order('tomorrow', '2026-10-09T05:00:00Z', 99900),
    ] });

    const markup = await render();
    expect(card(markup, 'Orders').value).toBe('28');
    expect(card(markup, 'Revenue').value).toBe('$4,957.10');
    expect(card(markup, 'Orders').barCount).toBe(8);
    expect(card(markup, 'Orders').visibleBuckets.at(-1)).toEqual({ label: 'Oct 8', value: '27' });
  });

  it('applies distinct Sunday week, month, and year filters to orders, revenue, and users', async () => {
    state.client = database({
      orders: [
        order('late-september', '2026-10-01T04:59:59.999Z', 9900),
        order('october-start', '2026-10-01T05:00:00Z', 10000),
        order('late-saturday', '2026-10-04T04:59:59.999Z', 20000),
        order('sunday', '2026-10-04T05:00:00Z', 30000),
        order('late-today', '2026-10-09T04:59:59.999Z', 40000),
        order('tomorrow', '2026-10-09T05:00:00Z', 9900),
      ],
      profiles: [
        { id: 'last-year', created_at: '2026-01-01T05:59:59.999Z' },
        { id: 'year-start', created_at: '2026-01-01T06:00:00Z' },
        { id: 'late-today', created_at: '2026-10-09T04:59:59.999Z' },
        { id: 'tomorrow', created_at: '2026-10-09T05:00:00Z' },
      ],
    });

    const markup = await render({ ordersRange: 'week', revenueRange: 'month', usersRange: 'year' });
    expect(card(markup, 'Orders').value).toBe('2');
    expect(card(markup, 'Orders').barCount).toBe(7);
    expect(card(markup, 'Revenue').value).toBe('$1,000.00');
    expect(card(markup, 'New Users').value).toBe('2');
    expect(card(markup, 'New Users').barCount).toBe(10);
    expect(card(markup, 'Orders').content).toContain('name="revenueRange" value="month"');
    expect(card(markup, 'Revenue').content).toContain('name="ordersRange" value="week"');
  });

  it('keeps the Central month and year on December 31 while UTC is already January 1', async () => {
    vi.setSystemTime(new Date('2027-01-01T03:00:00Z'));
    state.client = database({
      orders: [
        order('previous-year', '2026-01-01T05:59:59.999Z', 1000),
        order('year-start', '2026-01-01T06:00:00Z', 2000),
        order('december-start', '2026-12-01T06:00:00Z', 3000),
        order('late-december', '2027-01-01T05:59:59.999Z', 4000),
        order('january-start', '2027-01-01T06:00:00Z', 5000),
      ],
      profiles: [
        { id: 'previous-year', created_at: '2026-01-01T05:59:59.999Z' },
        { id: 'year-start', created_at: '2026-01-01T06:00:00Z' },
      ],
    });

    const markup = await render({ ordersRange: 'month', revenueRange: 'year', usersRange: 'previous_years' });
    expect(card(markup, 'Orders').value).toBe('2');
    expect(card(markup, 'Orders').barCount).toBe(31);
    expect(card(markup, 'Orders').visibleBuckets.at(-1)).toEqual({ label: 'Dec 31', value: '1' });
    expect(card(markup, 'Revenue').value).toBe('$90.00');
    expect(card(markup, 'Revenue').barCount).toBe(12);
    expect(card(markup, 'Revenue').visibleBuckets.at(-1)).toEqual({ label: 'Dec', value: '$70' });
    expect(card(markup, 'New Users').value).toBe('1');
  });

  it('uses Central years for history while keeping lifetime totals unbounded', async () => {
    state.client = database({ orders: [
      order('late-2025', '2026-01-01T05:59:59.999Z', 10000),
      order('start-2026', '2026-01-01T06:00:00Z', 20000),
      order('late-2026', '2027-01-01T05:59:59.999Z', 30000),
      order('start-2027', '2027-01-01T06:00:00Z', 40000),
    ] });

    const markup = await render({ ordersRange: 'previous_years', revenueRange: 'lifetime' });
    expect(card(markup, 'Orders').value).toBe('1');
    expect(card(markup, 'Orders').visibleBuckets).toEqual([{ label: '2025', value: '1' }]);
    expect(card(markup, 'Revenue').value).toBe('$1,000.00');
    expect(card(markup, 'Revenue').visibleBuckets).toEqual([
      { label: '2025', value: '$100' }, { label: '2026', value: '$500' }, { label: '2027', value: '$400' },
    ]);
  });

  it('keeps daily month buckets continuous through spring and fall daylight-saving changes', async () => {
    const cases = [
      {
        now: '2026-03-09T18:00:00Z', days: 9,
        dates: ['2026-03-08T06:00:00Z', '2026-03-09T05:00:00Z'],
        ending: [{ label: 'Mar 8', value: '1' }, { label: 'Mar 9', value: '1' }],
      },
      {
        now: '2026-11-02T18:00:00Z', days: 2,
        dates: ['2026-11-01T05:00:00Z', '2026-11-01T06:30:00Z', '2026-11-01T07:30:00Z', '2026-11-02T06:00:00Z'],
        ending: [{ label: 'Nov 1', value: '3' }, { label: 'Nov 2', value: '1' }],
      },
    ];
    for (const scenario of cases) {
      vi.setSystemTime(new Date(scenario.now));
      state.client = database({ orders: scenario.dates.map((date, index) => order(`order-${index}`, date)) });
      const orders = card(await render(), 'Orders');
      expect(orders.value).toBe(String(scenario.dates.length));
      expect(orders.barCount).toBe(scenario.days);
      expect(orders.visibleBuckets.slice(-2)).toEqual(scenario.ending);
      expect(new Set(orders.visibleBuckets.map((bucket) => bucket.label)).size).toBe(orders.visibleBuckets.length);
    }
  });

  it('retains Sunday-based weeks and Monday chart values across both daylight-saving transitions', async () => {
    const cases = [
      { now: '2026-03-09T18:00:00Z', saturday: '2026-03-08T05:59:59.999Z', sunday: '2026-03-08T06:00:00Z', monday: '2026-03-09T05:00:00Z', tomorrow: '2026-03-10T05:00:00Z' },
      { now: '2026-11-02T18:00:00Z', saturday: '2026-11-01T04:59:59.999Z', sunday: '2026-11-01T05:00:00Z', monday: '2026-11-02T06:00:00Z', tomorrow: '2026-11-03T06:00:00Z' },
    ];
    for (const scenario of cases) {
      vi.setSystemTime(new Date(scenario.now));
      state.client = database({ orders: [
        order('saturday', scenario.saturday), order('sunday', scenario.sunday),
        order('monday', scenario.monday), order('tomorrow', scenario.tomorrow),
      ] });
      const orders = card(await render({ ordersRange: 'week' }), 'Orders');
      expect(orders.value).toBe('2');
      expect(orders.barCount).toBe(7);
      expect(orders.visibleBuckets).toEqual([
        { label: 'Mon', value: '1' }, { label: 'Tue', value: '0' }, { label: 'Wed', value: '0' },
        { label: 'Thu', value: '0' }, { label: 'Fri', value: '0' }, { label: 'Sat', value: '0' },
      ]);
    }
  });
});
