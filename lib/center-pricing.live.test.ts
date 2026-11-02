import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '@/lib/supabase/schema';

// Read-only verification of the real PostgREST joins, sent history and rep scope.
describe.skipIf(process.env.RUN_CENTER_PRICING_LIVE !== '1')('center pricing live reads', () => {
  it('finds existing sent emails and restricts both routes to current assignments', async () => {
    process.loadEnvFile('.env.local');
    const { loadCenterPricingList, loadCenterPricingDetail } = await import('@/lib/center-pricing');
    const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const noRepId = '00000000-0000-4000-8000-000000000000';
    const owner = { actorId: noRepId, isOwner: true, supabase };
    const list = await loadCenterPricingList(owner, { page: 1, search: '' });
    expect(list.ok).toBe(true);
    if (!list.ok) throw new Error(list.error);
    expect(list.total).toBeGreaterThan(0);
    expect(list.centers.every(center => Boolean(center.quotes[0]?.sent_at))).toBe(true);
    const sample = list.centers.find(center => center.assigned_profile_id)!;
    expect(sample).toBeTruthy();
    const detail = await loadCenterPricingDetail(owner, sample.id);
    expect(detail.ok).toBe(true);
    if (!detail.ok) throw new Error('Historical detail unavailable');
    expect(detail.total).toBeGreaterThan(0);
    expect(detail.emails[0].body_html.length).toBeGreaterThan(0);
    const rep = { ...owner, actorId: sample.assigned_profile_id!, isOwner: false };
    const repList = await loadCenterPricingList(rep, { page: 1, search: '' });
    expect(repList.ok && repList.centers.every(center => center.assigned_profile_id === rep.actorId)).toBe(true);
    expect((await loadCenterPricingDetail(rep, sample.id)).ok).toBe(true);
    const deniedList = await loadCenterPricingList({ ...owner, isOwner: false }, { page: 1, search: '' });
    expect(deniedList).toMatchObject({ ok: true, centers: [], total: 0 });
    expect(await loadCenterPricingDetail({ ...owner, isOwner: false }, sample.id)).toEqual({ ok: false, unavailable: true });
    console.info(`Verified ${list.total} centers, all with sent pricing; current assignment access enforced.`);
  }, 30_000);
});
