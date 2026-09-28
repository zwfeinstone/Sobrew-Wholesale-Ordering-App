import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeTextKey } from '@/lib/prospecting';

type Row = Record<string, unknown>;
type Operation = 'select' | 'insert' | 'update' | 'upsert';
const state = vi.hoisted(() => ({
  owner: true,
  tables: {} as Record<string, Row[]>,
  calls: [] as Array<{ table: string; operation: Operation; payload?: Row; signal?: AbortSignal }>,
  failure: null as { table: string; operation: Operation; message?: string; empty?: boolean } | null,
  requireEdit: vi.fn(),
  createClient: vi.fn(),
  nextId: 0,
}));
vi.mock('next/navigation', () => ({
  redirect: (href: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;${href}` }); },
  unstable_rethrow: (error: unknown) => { if (error && typeof error === 'object' && 'digest' in error) throw error; },
}));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionEdit: (...args: unknown[]) => state.requireEdit(...args) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => state.createClient() }));

class Query {
  private operation: Operation = 'select';
  private filters: Array<[string, unknown]> = [];
  private payload?: Row;
  private one = false;
  private signal?: AbortSignal;
  constructor(private table: string) {}
  select() { return this; }
  eq(field: string, value: unknown) { this.filters.push([field, value]); return this; }
  is(field: string, value: unknown) { return this.eq(field, value); }
  order() { return this; }
  limit() { return this; }
  abortSignal(signal: AbortSignal) { this.signal = signal; return this; }
  insert(payload: Row) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload: Row) { this.operation = 'update'; this.payload = payload; return this; }
  upsert(payload: Row) { this.operation = 'upsert'; this.payload = payload; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.one = true; return this; }
  result() {
    state.calls.push({ table: this.table, operation: this.operation, payload: this.payload, signal: this.signal });
    if (this.signal?.aborted) return { data: null, error: { message: 'TimeoutError' } };
    if (state.failure?.table === this.table && state.failure.operation === this.operation) {
      const failure = state.failure; state.failure = null;
      return { data: null, error: failure.empty ? null : { message: failure.message ?? 'Database unavailable' } };
    }
    const table = state.tables[this.table] ??= [];
    let rows = table.filter((row) => this.filters.every(([field, value]) => (row[field] ?? null) === value));
    if (this.operation === 'update') rows.forEach((row) => Object.assign(row, this.payload));
    if (this.operation === 'insert' || this.operation === 'upsert') {
      const existing = this.operation === 'upsert' ? table.find((row) => row.lead_id === this.payload?.lead_id && row.list_id === this.payload?.list_id) : undefined;
      if (existing) { Object.assign(existing, this.payload); rows = [existing]; }
      else {
        const defaults = this.table === 'prospecting_leads' ? { archived_at: null, do_not_contact: false, hubspot_status: 'not_queued' } : {};
        const row = { id: `${this.table}-${++state.nextId}`, ...defaults, ...this.payload };
        table.push(row); rows = [row];
      }
    }
    return { data: this.one ? rows[0] ?? null : rows, error: null };
  }
  then(resolve: (result: ReturnType<Query['result']>) => unknown) { return Promise.resolve(this.result()).then(resolve); }
}
const database = { from: (table: string) => new Query(table) };
import { createSingleLead } from '@/app/admin/sales/prospecting/admin/create-lead';

const actor = 'owner-1';
function form(overrides: Record<string, string> = {}) {
  const result = new FormData();
  Object.entries({
    company_name: 'Sample Center', phone: '504-439-6645', stage: 'sample_requested',
    contact_full_name: 'Sample Buyer', contact_email: 'buyer@example.com', contact_phone: '504-439-6645', contact_title: 'Director',
    ...overrides,
  }).forEach(([key, value]) => result.set(key, value));
  return result;
}
function existingLead(overrides: Row = {}) {
  const row = {
    id: 'existing-lead', company_name: 'Sample Center', company_name_key: normalizeTextKey('Sample Center'), phone_key: '5044396645',
    stage: 'new', hubspot_status: 'not_queued', archived_at: null, do_not_contact: false, country: 'US', ...overrides,
  };
  state.tables.prospecting_leads = [row];
  return row;
}
beforeEach(() => {
  Object.assign(state, { owner: true, tables: {}, calls: [], failure: null, nextId: 0 });
  state.requireEdit.mockReset().mockImplementation(async () => ({ isOwner: state.owner, profile: { id: actor } }));
  state.createClient.mockReset().mockResolvedValue(database);
});
afterEach(() => vi.restoreAllMocks());

describe('single lead server action', () => {
  it('returns a confirmed result without redirecting and queues a sample after saving its contact', async () => {
    const result = await createSingleLead(form({ existing_list_id: 'list-1' }));
    expect(result).toMatchObject({ ok: true, message: 'Lead added. Added to the HubSpot queue.' });
    if (!result.ok) throw new Error(result.message);
    expect(result.href).toBe(`/admin/sales/prospecting/${result.leadId}`);
    expect(result.sampleOrderHref).toBe(`/admin/sales/prospecting/sample-order?lead=${result.leadId}`);
    expect(state.tables.prospecting_leads).toHaveLength(1);
    expect(state.tables.prospecting_leads[0]).toMatchObject({ stage: 'sample_requested', hubspot_status: 'queued' });
    expect(state.tables.prospecting_hubspot_queue).toEqual([expect.objectContaining({ lead_id: result.leadId, queued_stage: 'sample_requested', status: 'queued', queued_by: actor })]);
    expect(state.tables.prospecting_list_leads[0]).toMatchObject({ lead_id: result.leadId, list_id: 'list-1' });
    const contactIndex = state.calls.findIndex((call) => call.table === 'prospecting_contacts' && call.operation === 'insert');
    const stageIndex = state.calls.findIndex((call) => call.table === 'prospecting_leads' && call.payload?.stage === 'sample_requested');
    expect(contactIndex).toBeLessThan(stageIndex);
    expect(new Set(state.calls.map((call) => call.signal)).size).toBe(1);
    expect(state.calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('moves an exact-match merge to Sample Requested and queues it', async () => {
    const lead = existingLead();
    expect(await createSingleLead(form())).toMatchObject({ ok: true, leadId: lead.id, message: expect.stringContaining('HubSpot queue'), sampleOrderHref: `/admin/sales/prospecting/sample-order?lead=${lead.id}` });
    expect(state.tables.prospecting_leads).toHaveLength(1);
    expect(lead).toMatchObject({ stage: 'sample_requested', hubspot_status: 'queued', updated_by: actor });
    expect(state.tables.prospecting_hubspot_queue[0]).toMatchObject({ lead_id: lead.id, status: 'queued' });
  });

  it('reports a partial queue failure and reuses the saved lead and contact on retry', async () => {
    state.failure = { table: 'prospecting_hubspot_queue', operation: 'upsert' };
    const failed = await createSingleLead(form());
    expect(failed).toMatchObject({ ok: false, leadId: expect.any(String), message: expect.stringContaining('HubSpot queue') });
    expect(await createSingleLead(form())).toMatchObject({ ok: true, leadId: failed.leadId });
    expect(state.tables.prospecting_leads).toHaveLength(1);
    expect(state.tables.prospecting_contacts).toHaveLength(1);
    expect(state.tables.prospecting_hubspot_queue).toHaveLength(1);
  });

  it('preserves an already exported sample lead on an exact-match merge', async () => {
    const lead = existingLead({ stage: 'sample_requested', hubspot_status: 'exported' });
    state.tables.prospecting_hubspot_queue = [{ lead_id: lead.id, status: 'exported', queued_stage: 'sample_requested' }];
    expect(await createSingleLead(form())).toMatchObject({ ok: true, message: expect.stringContaining('Already exported') });
    expect(lead.hubspot_status).toBe('exported');
    expect(state.tables.prospecting_hubspot_queue[0].status).toBe('exported');
    expect(state.calls.some((call) => call.table === 'prospecting_hubspot_queue')).toBe(false);
  });

  it.each<Record<string, string>>([{ company_name: '' }, { contact_email: '' }, { contact_full_name: '' }])('validates required input before any write: %j', async (overrides) => {
    expect(await createSingleLead(form({ list_name: 'New list', ...overrides }))).toMatchObject({ ok: false });
    expect(state.calls.filter((call) => call.operation !== 'select')).toHaveLength(0);
  });

  it('prevents ordinary new leads from being queued or changing an existing stage', async () => {
    const result = await createSingleLead(form({ stage: 'new' }));
    expect(result).toMatchObject({ ok: true, message: 'Lead added.' });
    expect(result).not.toHaveProperty('sampleOrderHref');
    expect(state.tables.prospecting_leads[0].stage).toBe('new');
    expect(state.tables.prospecting_hubspot_queue).toBeUndefined();
    state.tables.prospecting_leads[0].stage = 'working';
    expect(await createSingleLead(form({ stage: 'new' }))).toMatchObject({ ok: true });
    expect(state.tables.prospecting_leads[0].stage).toBe('working');
    expect(state.tables.prospecting_contacts).toHaveLength(1);
  });

  it('does not report success or create a queue row when the stage update matched no lead', async () => {
    existingLead();
    state.failure = { table: 'prospecting_leads', operation: 'update', empty: true };
    // Avoid missing-field enrichment so this failure reaches the stage mutation.
    Object.assign(state.tables.prospecting_leads[0], { phone: '504-439-6645' });
    expect(await createSingleLead(form())).toMatchObject({ ok: false, message: expect.stringContaining('no longer available') });
    expect(state.tables.prospecting_hubspot_queue).toBeUndefined();
  });

  it('checks the activity write before confirming success', async () => {
    state.failure = { table: 'prospecting_activities', operation: 'insert' };
    expect(await createSingleLead(form())).toMatchObject({ ok: false, leadId: expect.any(String), message: expect.stringContaining('activity') });
  });

  it('retains auth and owner redirects without querying or writing lead data', async () => {
    state.owner = false;
    await expect(createSingleLead(form())).rejects.toThrow('NEXT_REDIRECT');
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.requireEdit).toHaveBeenCalledWith('prospecting', '/admin/sales/prospecting/admin?tab=add&toast=admin_write_denied');
    state.requireEdit.mockRejectedValue(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;/login' }));
    await expect(createSingleLead(form())).rejects.toThrow('NEXT_REDIRECT');
  });

  it('returns a retryable error after the shared database deadline', async () => {
    const controller = new AbortController(); controller.abort();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    expect(await createSingleLead(form())).toMatchObject({ ok: false, message: expect.stringContaining('took too long') });
    expect(timeout).toHaveBeenCalledWith(20_000);
    expect(state.calls.filter((call) => call.operation !== 'select')).toHaveLength(0);
  });

  it('rejects unavailable reps before writing and checks their lookup errors', async () => {
    expect(await createSingleLead(form({ assigned_profile_id: 'rep-1' }))).toMatchObject({ ok: false, message: expect.stringContaining('active sales rep') });
    state.failure = { table: 'admin_commission_settings', operation: 'select' };
    expect(await createSingleLead(form({ assigned_profile_id: 'rep-1' }))).toMatchObject({ ok: false, message: expect.stringContaining('check the assigned rep') });
    expect(state.calls.filter((call) => call.operation !== 'select')).toHaveLength(0);
  });

  it('preserves the existing primary contact when adding a different contact', async () => {
    const lead = existingLead();
    state.tables.prospecting_contacts = [{ lead_id: lead.id, full_name: 'Existing buyer', email: 'old@example.com', is_primary: true }];
    expect(await createSingleLead(form())).toMatchObject({ ok: true });
    expect(state.tables.prospecting_contacts[1]).toMatchObject({ full_name: 'Sample Buyer', is_primary: false });
  });

  it('reuses a new manual list after a partial save', async () => {
    state.failure = { table: 'prospecting_list_leads', operation: 'upsert' };
    expect(await createSingleLead(form({ list_name: 'Sample prospects' }))).toMatchObject({ ok: false });
    expect(await createSingleLead(form({ list_name: 'Sample prospects' }))).toMatchObject({ ok: true });
    expect(state.tables.prospecting_lists).toHaveLength(1);
    expect(state.tables.prospecting_contacts).toHaveLength(1);
    expect(state.tables.prospecting_list_leads).toHaveLength(1);
  });
});
