import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  profileId: 'haskins',
  client: null as unknown as ReturnType<typeof supabaseReadStub>['client'],
  requireView: vi.fn(async () => ({ profile: { id: state.profileId } })),
}));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: state.requireView }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (table: string) => state.client.from(table) } }));
vi.mock('next/link', () => ({ default: 'a' }));
import WeekHoursPage from '@/app/admin/week-hours/page';

const plan = { id: 'plan', profile_id: 'haskins', label: 'January 4 deferred pay', start_date: '2026-10-07', end_date: '2027-01-03', payout_date: '2027-01-04', accrual_rate_cents: 500, weekly_rate_cents: 1500, paid_at: null, paid_amount_cents: null };
const entry = { id: 'shift', profile_id: 'haskins', clock_in_at: '2026-10-07T13:00:00Z', clock_out_at: '2026-10-07T21:00:00Z', hourly_rate_cents_snapshot: 1500, status: 'locked', work_type: 'sales', admin_time_breaks: [] };
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T14:00:00Z'));
  state.profileId = 'haskins';
  vi.clearAllMocks();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Week Hours deferred pay integration', () => {
  it('shows the employee accrual while keeping the existing hours and SPIFF sections', async () => {
    const { client, reads } = supabaseReadStub({ tables: { admin_deferred_pay_plans: [plan], admin_time_entries: [entry] } });
    state.client = client;
    const html = await renderToStaticMarkup(await WeekHoursPage({ searchParams: Promise.resolve({ profile_id: 'someone-else' }) }));
    const text = plain(html);
    expect(state.requireView).toHaveBeenCalledWith('week_hours');
    expect(text).toContain('Your deferred pay');
    expect(text).toContain('$40.00');
    expect(text).toContain('8.00');
    expect(text).toContain('$15.00');
    expect(text).toContain('This week shifts');
    expect(text).toContain('SPIFF history');
    expect(reads.filter((read) => read.table === 'admin_deferred_pay_plans').every((read) => read.filters.some((filter) => filter.column === 'profile_id' && filter.value === 'haskins'))).toBe(true);
    expect(html).not.toContain('Mark paid');
  });

  it('does not render Haskins’s plan when a different employee views their own page', async () => {
    state.profileId = 'another-employee';
    state.client = supabaseReadStub({ tables: { admin_deferred_pay_plans: [plan] } }).client;
    const html = renderToStaticMarkup(await WeekHoursPage({}));
    expect(plain(html)).not.toContain('Your deferred pay');
    expect(plain(html)).toContain('Your hours');
  });

  it('retains October accrual when the page rolls into January', async () => {
    vi.setSystemTime(new Date('2027-01-04T14:00:00Z'));
    state.client = supabaseReadStub({ tables: { admin_deferred_pay_plans: [plan], admin_time_entries: [entry] } }).client;
    const html = renderToStaticMarkup(await WeekHoursPage({}));
    expect(plain(html)).toContain('$40.00');
    expect(plain(html)).toContain('2026');
    expect(plain(html)).toContain('2027');
    expect(plain(html)).not.toContain('Payment recorded');
  });

  it('shows an unavailable warning instead of a misleading balance on a plan load failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.client = supabaseReadStub({ fail: (read) => read.table === 'admin_deferred_pay_plans' ? 'Unavailable' : undefined }).client;
    const html = renderToStaticMarkup(await WeekHoursPage({}));
    expect(plain(html)).toContain('Deferred pay could not be loaded');
    expect(plain(html)).not.toContain('Your deferred pay');
    expect(plain(html)).toContain('SPIFF history');
  });
});
