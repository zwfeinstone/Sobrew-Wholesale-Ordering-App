import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../db/migrations/052_delete_order_restore_inventory.sql', import.meta.url)
);
const migration = readFileSync(migrationPath, 'utf8');

describe('delete order inventory restoration migration contract', () => {
  it('restores shipment lot quantities before deleting the order', () => {
    const restoreIndex = migration.indexOf('set quantity_remaining = lot.quantity_remaining + v_restore_quantity');
    const deleteOrderIndex = migration.indexOf('delete from public.orders o');

    expect(restoreIndex).toBeGreaterThan(-1);
    expect(deleteOrderIndex).toBeGreaterThan(restoreIndex);
  });

  it('removes shipment consumption movements before the order cascade clears references', () => {
    const deleteMovementIndex = migration.indexOf('delete from public.inventory_movements movement');
    const deleteOrderIndex = migration.indexOf('delete from public.orders o');

    expect(migration).toContain("movement.movement_type = 'shipment_consume'");
    expect(deleteMovementIndex).toBeGreaterThan(-1);
    expect(deleteOrderIndex).toBeGreaterThan(deleteMovementIndex);
  });

  it('is callable only by authenticated admins through the RPC', () => {
    expect(migration).toContain('if not public.is_admin() then');
    expect(migration).toMatch(
      /revoke all on function public\.delete_order_and_restore_inventory\(uuid\)[\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.delete_order_and_restore_inventory\(uuid\)[\s\S]*to authenticated;/
    );
  });
});
