import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(new URL('../db/migrations/20260924213453_prospecting_atomic_workspace.sql', import.meta.url), 'utf8');
describe('prospecting atomic workspace migration boundary', () => {
  it('keeps new data and mutation RPCs restricted to service-role callers', () => {
    for (const table of ['prospecting_sample_requests', 'prospecting_submission_receipts']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated`);
    }
    expect(sql).toContain('grant execute on function public.commit_prospecting_record_v2(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[],jsonb,text,text) to service_role');
  });
  it('locks both the loaded record and stable operation, and tracks import/bulk stage transitions', () => {
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('v_before.updated_at is distinct from p_expected_updated_at');
    expect(sql).toContain('prospecting_leads_track_request_v2 after insert or update of stage, archived_at');
    expect(sql).toContain("'legacy_review'");
  });
});
