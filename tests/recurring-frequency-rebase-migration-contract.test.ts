import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../db/migrations/054_recurring_frequency_changes_rebase_next_run.sql', import.meta.url)
);
const migration = readFileSync(migrationPath, 'utf8');

function triggerBody() {
  const start = migration.indexOf('create or replace function private.set_recurring_next_run');
  const end = migration.indexOf('$function$;', start) + '$function$;'.length;
  return migration.slice(start, end);
}

describe('recurring frequency change schedule rebase migration contract', () => {
  it('keeps generated orders advancing from their scheduled occurrence', () => {
    const body = triggerBody();

    expect(body).toContain('elsif new.last_generated_at is distinct from old.last_generated_at then');
    expect(body).toContain('anchor_at := coalesce(new.last_generated_at, new.created_at, now());');
  });

  it('rebases manual active schedule saves from today', () => {
    const body = triggerBody();
    const generationBranchIndex = body.indexOf('elsif new.last_generated_at is distinct from old.last_generated_at then');
    const manualSaveBranchIndex = body.indexOf('else\n    -- Manual schedule saves');

    expect(manualSaveBranchIndex).toBeGreaterThan(generationBranchIndex);
    expect(body).toContain('anchor_at := now();');
    expect(body).toContain('new.next_run_at := private.next_recurring_run(anchor_at, new.frequency);');
  });

  it('continues clearing inactive schedules', () => {
    const body = triggerBody();

    expect(body).toContain("if new.status <> 'active' then");
    expect(body).toContain('new.next_run_at := null;');
  });
});
