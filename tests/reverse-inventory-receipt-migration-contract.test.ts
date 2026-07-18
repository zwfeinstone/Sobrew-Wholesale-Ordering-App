import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../db/migrations/053_reverse_inventory_receipts.sql', import.meta.url)
);
const migration = readFileSync(migrationPath, 'utf8');

describe('reverse inventory receipt migration contract', () => {
  it('tracks receipt reversal audit fields', () => {
    expect(migration).toContain('add column if not exists reversed_at timestamptz');
    expect(migration).toContain('add column if not exists reversed_by uuid references public.profiles(id) on delete set null');
    expect(migration).toContain('add column if not exists reversal_reason text');
  });

  it('only allows superadmins to call the reversal RPC', () => {
    expect(migration).toContain('if not public.is_owner_admin() then');
    expect(migration).toMatch(
      /revoke all on function public\.reverse_inventory_receipt\(uuid, text\)[\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.reverse_inventory_receipt\(uuid, text\)[\s\S]*to authenticated;/
    );
  });

  it('blocks reversal once the received lot has been used', () => {
    expect(migration).toContain('coalesce(v_lot.quantity_remaining, 0) < v_quantity');
    expect(migration).toContain('Receipt lot has already been consumed and cannot be fully reversed.');
  });

  it('subtracts the receipt quantity from the lot before marking the receipt reversed', () => {
    const subtractLotIndex = migration.indexOf('set quantity_remaining = quantity_remaining - v_quantity');
    const markReversedIndex = migration.indexOf('set reversed_at = now()');

    expect(subtractLotIndex).toBeGreaterThan(-1);
    expect(markReversedIndex).toBeGreaterThan(subtractLotIndex);
  });

  it('records an offsetting adjustment movement tied to the receipt', () => {
    expect(migration).toContain("movement_type,\n    quantity_change");
    expect(migration).toContain("'adjustment',\n    -v_quantity");
    expect(migration).toContain('v_receipt.id');
  });
});
