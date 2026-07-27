import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(
  fileURLToPath(new URL('../db/migrations/057_prospecting_sample_orders.sql', import.meta.url)),
  'utf8'
);

describe('prospecting sample order migration contract', () => {
  it('adds sample order metadata to orders', () => {
    expect(migration).toContain('add column if not exists order_kind text not null default');
    expect(migration).toContain('add column if not exists prospecting_lead_id uuid references prospecting_leads(id) on delete set null');
    expect(migration).toContain('add column if not exists shipping_company text');
  });

  it('restricts order kind values and adds lookup indexes', () => {
    expect(migration).toMatch(/check \(order_kind in \('standard', 'prospecting_sample'\)\)/);
    expect(migration).toContain('create index if not exists orders_order_kind_idx on orders(order_kind)');
    expect(migration).toContain('create index if not exists orders_prospecting_lead_id_idx on orders(prospecting_lead_id)');
  });
});
