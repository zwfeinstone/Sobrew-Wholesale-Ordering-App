import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../db/migrations/20260804192543_fix_prospecting_rep_workflow.sql', import.meta.url)),
  'utf8',
);

describe('prospecting workflow migration contract', () => {
  it('keeps parked leads unassigned at the database boundary', () => {
    expect(migration).toMatch(
      /if new\.stage in \('recycle_try_later', 'not_a_fit', 'lost'\) then\s*new\.assigned_profile_id := null;\s*new\.next_follow_up_at := null;/s,
    );
    expect(migration).toContain('before insert or update of stage, assigned_profile_id, next_follow_up_at');
    expect(migration).toMatch(
      /where lead\.archived_at is null\s*and lead\.stage = 'recycle_try_later'\s*and lead\.assigned_profile_id is not null;/s,
    );
  });

  it('exposes the transactional save only to service role', () => {
    expect(migration).toMatch(
      /create or replace function public\.save_prospecting_record_v1\([\s\S]*?returns jsonb\s*language plpgsql\s*security invoker\s*set search_path = ''/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.save_prospecting_record_v1\([\s\S]*?\) from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.save_prospecting_record_v1\([\s\S]*?\) to service_role;/,
    );
    expect(migration).not.toContain('security definer');
  });

  it('locks and checks the lead before writing the full record', () => {
    expect(migration).toMatch(/where lead\.id = p_lead_id\s*for update;/s);
    expect(migration).toContain("raise exception using errcode = '40001'");
    expect(migration).toContain('update public.prospecting_contacts');
    expect(migration).toMatch(/where contact\.id = \(p_activity ->> 'contact_id'\)::uuid\s*and contact\.lead_id = p_lead_id/s);
    expect(migration).toContain('insert into public.prospecting_activities');
    expect(migration).toContain('insert into public.prospecting_hubspot_queue');
    expect(migration).toContain('on conflict (lead_id) do update');
  });
});
