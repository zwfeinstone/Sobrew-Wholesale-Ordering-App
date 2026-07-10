import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../db/migrations/049_prospecting_report_aggregates.sql', import.meta.url)
);
const migration = readFileSync(migrationPath, 'utf8');

describe('prospecting report aggregate migration contract', () => {
  it('exposes only the approved service-role RPC signature', () => {
    expect(migration).toMatch(
      /create or replace function public\.admin_prospecting_report_v1\(\s*p_range_start date,\s*p_range_end_exclusive date,\s*p_as_of_date date,\s*p_sales_profile_id uuid,\s*p_center_ids uuid\[\]\s*\)\s*returns jsonb\s*language sql\s*stable\s*security invoker\s*set search_path = ''/s
    );
    expect(migration).toMatch(
      /revoke all on function public\.admin_prospecting_report_v1\([\s\S]*?\) from public, anon, authenticated;/
    );
    expect(migration).toMatch(
      /grant execute on function public\.admin_prospecting_report_v1\([\s\S]*?\) to service_role;/
    );
    expect(migration).not.toContain('security definer');
  });

  it('uses inclusive/exclusive Central Time boundaries and preserves null-center samples', () => {
    expect(migration).toContain("p_range_start::timestamp at time zone 'America/Chicago'");
    expect(migration).toContain("p_range_end_exclusive::timestamp at time zone 'America/Chicago'");
    expect(migration).toContain('activity.created_at >= params.range_start_at');
    expect(migration).toContain('activity.created_at < params.range_end_at');
    expect(migration).toContain('block.activity_date >= params.range_start');
    expect(migration).toContain('block.activity_date < params.range_end_exclusive');
    expect(migration).toMatch(
      /params\.center_ids is null\s*or run\.center_id is null\s*or run\.center_id = any\(params\.center_ids\)/s
    );
  });

  it('deduplicates lead-level samples and terminal transitions before rep filtering', () => {
    const sampleDedupe = migration.indexOf('detailed_sample_requests_all as');
    const sampleScope = migration.indexOf('detailed_sample_requests as');
    const terminalDedupe = migration.indexOf('latest_terminal_events_all as');
    const terminalScope = migration.indexOf('latest_terminal_events as');

    expect(migration).toContain('select distinct on (activity.lead_id)');
    expect(migration).toMatch(
      /activity\.next_stage = 'sample_requested'[\s\S]*activity\.result_key in \('sample requested', 'requested sample'\)[\s\S]*activity\.previous_stage is distinct from 'sample_requested'/
    );
    expect(sampleDedupe).toBeGreaterThan(-1);
    expect(sampleScope).toBeGreaterThan(sampleDedupe);
    expect(terminalDedupe).toBeGreaterThan(sampleScope);
    expect(terminalScope).toBeGreaterThan(terminalDedupe);
    expect(migration).toContain("activity.next_stage in ('converted', 'lost')");
    expect(migration).toContain('activity.previous_stage is distinct from activity.next_stage');
    expect(migration).not.toMatch(/next_stage\s*=\s*'not_a_fit'[\s\S]*deals_lost/);
  });

  it('returns only bounded aggregate collections with the agreed fields', () => {
    for (const key of [
      'period',
      'pipeline_snapshot',
      'stages',
      'channels',
      'reps',
      'sources',
      'tracked_unique_leads',
      'call_attempts',
      'live_contact_sample_requests',
      'untouched_open',
      'contact_sample_requests',
      'sample_cogs_cents',
    ]) {
      expect(migration).toContain(`'${key}'`);
    }

    expect(migration).toContain('limit 100');
    expect(migration).not.toMatch(/create\s+(?:unique\s+)?index/i);
  });

  it('keeps the call and sample numerator rules explicit', () => {
    expect(migration).toContain("activity.result_key = 'no answer'");
    expect(migration).toContain("activity.result_key = 'left voicemail'");
    expect(migration).toContain("activity.result_key = 'wrong number'");
    expect(migration).toContain('block.samples_from_voicemail_callback');

    const periodStart = migration.indexOf("'period', jsonb_build_object(");
    const pipelineStart = migration.indexOf("'pipeline_snapshot', jsonb_build_object(");
    const periodBody = migration.slice(periodStart, pipelineStart);

    expect(periodBody).toMatch(
      /'phone_sample_requests',[\s\S]*block\.voicemail_sample_requests/
    );
    expect(periodBody).toMatch(
      /'live_contact_sample_requests',[\s\S]*block\.contact_sample_requests/
    );
    expect(periodBody).not.toMatch(
      /'live_contact_sample_requests',[\s\S]*block\.voicemail_sample_requests/
    );
  });
});
