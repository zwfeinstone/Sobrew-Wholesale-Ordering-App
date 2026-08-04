import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../db/migrations/082_weekly_sales_spiffs_unpaid_until_marked.sql', import.meta.url)
);
const migration = readFileSync(migrationPath, 'utf8');

describe('weekly sales SPIFF unpaid migration contract', () => {
  it('keeps saved SPIFF records unpaid until they are explicitly marked paid', () => {
    expect(migration).toContain('alter column paid_at drop default');
    expect(migration).toContain('alter column paid_at drop not null');
  });
});
