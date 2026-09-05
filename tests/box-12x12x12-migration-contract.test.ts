import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../db/migrations/20260905120000_replace_12x12x10_box_with_12x12x12.sql', import.meta.url)
);
const migration = readFileSync(migrationPath, 'utf8');

describe('12x12x12 box material migration contract', () => {
  it('creates or reactivates the 12x12x12 box material supply for dropdowns', () => {
    expect(migration).toContain("'Box - 12 x 12 x 12'");
    expect(migration).toContain("'MAT-BOX-12X12X12'");
    expect(migration).toContain("'material_supply'");
    expect(migration).toContain("active = excluded.active");
  });

  it('moves recipes off the legacy 12x12x10 box items', () => {
    expect(migration).toContain("'MAT-BOX-12X12X10'");
    expect(migration).toContain("'BOX-12X12X10'");
    expect(migration).toContain('update product_recipe_components as component');
    expect(migration).toContain('component.inventory_item_id = old_boxes.id');
    expect(migration).toContain('inventory_item_id = new_box.id');
  });
});
