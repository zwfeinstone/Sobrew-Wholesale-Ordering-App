import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../db/migrations/085_add_styrofoam_cups_receivable_finished_good.sql', import.meta.url)
);
const migration = readFileSync(migrationPath, 'utf8');

describe('styrofoam cups receivable finished good migration contract', () => {
  it('marks the retail product as receivable', () => {
    expect(migration).toContain("'RET-CUP-STYRO-12OZ-1000CT'");
    expect(migration).toContain('receivable_finished_good = excluded.receivable_finished_good');
    expect(migration).toMatch(/'retail',\s+true,\s+true/);
  });

  it('creates or updates a linked finished-good inventory item', () => {
    expect(migration).toContain("'FIN-RET-CUP-STYRO-12OZ-1000CT'");
    expect(migration).toContain("item_type = 'finished_good'");
    expect(migration).toContain("'finished_good'");
    expect(migration).toContain("base_unit = 'each'");
    expect(migration).toContain('product_id = product.id');
  });

  it('updates an existing linked item before inserting a new one', () => {
    const updateIndex = migration.indexOf('updated_inventory_item as (');
    const insertIndex = migration.indexOf('insert into inventory_items');

    expect(updateIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(updateIndex);
    expect(migration).toContain('where not exists (select 1 from updated_inventory_item)');
  });
});
