import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../db/migrations/048_quick_restock_performance.sql', import.meta.url)
);
const migration = readFileSync(migrationPath, 'utf8');

function functionBody(name: string) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  const end = migration.indexOf('$function$;', start) + '$function$;'.length;
  return migration.slice(start, end);
}

describe('atomic recurring-order migration contract', () => {
  it('serializes simultaneous generation attempts around one occurrence key', () => {
    const body = functionBody('generate_recurring_order');

    expect(migration).toContain('orders_recurring_generation_unique');
    expect(body).toContain('for update;');
    expect(body.indexOf('for update;')).toBeLessThan(body.indexOf('o.recurring_scheduled_for = scheduled_at'));
    expect(body).toContain("recurring_record.next_run_at is distinct from scheduled_at");
    expect(body).toContain('delete from public.orders o where o.id = existing_order_id');
  });

  it('derives every active schedule instead of accepting next_run_at from a caller', () => {
    const triggerStart = migration.indexOf('create or replace function private.set_recurring_next_run');
    const triggerEnd = migration.indexOf('$function$;', triggerStart) + '$function$;'.length;
    const triggerBody = migration.slice(triggerStart, triggerEnd);

    expect(triggerBody).toContain('new.next_run_at := private.next_recurring_run(anchor_at, new.frequency);');
    expect(triggerBody).not.toContain('if new.next_run_at is null');
  });

  it('keeps order, line-item, and schedule writes in one server-only RPC', () => {
    const body = functionBody('generate_recurring_order');

    expect(migration).toMatch(/begin;[\s\S]*commit;\s*$/);
    expect(body).toContain('insert into public.orders');
    expect(body).toContain('insert into public.order_items');
    expect(body).toContain('update public.recurring_orders');
    expect(migration).toMatch(
      /revoke all on function public\.generate_recurring_order\(uuid, timestamptz\)[\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.generate_recurring_order\(uuid, timestamptz\)[\s\S]*to service_role;/
    );
  });

  it('removes direct customer order inserts and the broad policy rewrite', () => {
    expect(migration).toContain('drop policy if exists "self create orders"');
    expect(migration).toContain('drop policy if exists "self create order_items"');
    expect(migration).toContain('drop policy if exists "self insert order_items"');
    expect(migration).not.toContain('quick_restock_policy_tables');
    expect(migration).not.toContain('from pg_policy policy');
  });
});
