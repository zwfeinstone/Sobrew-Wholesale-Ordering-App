import { describe, expect, it, vi } from 'vitest';
import type { SampleQuoteRow } from '@/lib/supabase/schema';
import type { SupabaseAdminClient } from '@/lib/supabase/admin';
import { buildSampleQuoteEmail } from './prospecting-sample-quote';

// An accidentally uninjected dependency must fail locally rather than reaching a service.
vi.mock('resend', () => ({ Resend: class { constructor() { throw new Error('Unexpected real Resend client'); } } }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => { throw new Error('Unexpected real database client'); }, supabaseAdmin: {} }));

import { loadSampleQuoteContext, sendSampleQuote } from './prospecting-sample-quote-delivery';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const REP_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_ID = '44444444-4444-4444-8444-444444444444';
const CONTACT_ID = '55555555-5555-4555-8555-555555555555';
const QUOTE_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_CONTACT_ID = '77777777-7777-4777-8777-777777777777';
const NOW = new Date('2026-09-30T12:00:00.000Z');
const TRACKING = '1Z0751H30305695303';
const LINES = [{ id: 'bulk-regular', priceCents: 3500 }];
type Table = 'orders' | 'prospecting_leads' | 'prospecting_sample_quotes' | 'profiles' | 'prospecting_contacts' | 'prospecting_sample_requests';
type Row = Record<string, any>;
type DbError = { message: string; code?: string };
type DbResult = { data: Row[] | null; error: DbError | null };

class Query {
  private filters: Array<[string, unknown]> = [];
  private operation: 'select' | 'insert' | 'update' = 'select';
  private payload: Row = {};
  constructor(private db: FakeDatabase, private table: Table) {}
  select() { return this; }
  order() { return this; }
  eq(key: string, value: unknown) { this.filters.push([key, value]); return this; }
  is(key: string, value: unknown) { return this.eq(key, value); }
  insert(payload: Row) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload: Row) { this.operation = 'update'; this.payload = payload; return this; }
  async maybeSingle() {
    const result = await this.execute();
    return { data: result.data?.[0] ?? null, error: result.error };
  }
  single() { return this.maybeSingle(); }
  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) { return this.execute().then(onfulfilled, onrejected); }
  private async execute(): Promise<DbResult> {
    this.db.calls.push({ table: this.table, operation: this.operation, filters: [...this.filters] });
    const error = this.db.errors[`${this.table}:${this.operation}`];
    if (error) return { data: null, error };
    if (this.operation === 'insert') {
      if (this.db.insertRace) {
        this.db.tables.prospecting_sample_quotes.push(structuredClone(this.db.insertRace));
        this.db.insertRace = null;
        return { data: null, error: { code: '23505', message: 'Duplicate order' } };
      }
      const inserted = { ...structuredClone(this.payload), id: QUOTE_ID, created_at: NOW.toISOString(), sent_at: null, resend_email_id: null };
      this.db.tables[this.table].push(inserted);
      return { data: [structuredClone(inserted)], error: null };
    }
    const rows = this.db.tables[this.table].filter(row => this.filters.every(([key, value]) => row[key] === value));
    if (this.operation === 'update') rows.forEach(row => Object.assign(row, structuredClone(this.payload)));
    return { data: structuredClone(rows), error: null };
  }
}

class FakeDatabase {
  tables: Record<Table, Row[]> = {
    orders: [{ id: ORDER_ID, prospecting_lead_id: LEAD_ID, order_kind: 'prospecting_sample', shipping_name: 'Ron Buyer' }],
    prospecting_leads: [{ id: LEAD_ID, company_name: 'Sample Center', assigned_profile_id: REP_ID, archived_at: null, do_not_contact: false, stage: 'sample_sent' }],
    prospecting_sample_quotes: [],
    profiles: [{ id: REP_ID, full_name: 'Haskins', email: ' HASKINS@SOBREW.COM ', is_active: true }, { id: OWNER_ID, full_name: 'Zach', email: 'zach@sobrew.com', is_active: true }],
    prospecting_contacts: [
      { id: OTHER_CONTACT_ID, lead_id: LEAD_ID, full_name: 'Other Primary', email: 'primary@example.com', is_primary: true },
      { id: CONTACT_ID, lead_id: LEAD_ID, full_name: 'Ron Buyer', email: 'ron@example.com', is_primary: false },
    ],
    prospecting_sample_requests: [{ order_id: ORDER_ID, lead_id: LEAD_ID, contact_id: CONTACT_ID }],
  };
  errors: Partial<Record<`${Table}:${'select' | 'insert' | 'update'}`, DbError>> = {};
  calls: Array<{ table: Table; operation: string; filters: Array<[string, unknown]> }> = [];
  insertRace: SampleQuoteRow | null = null;
  from(table: Table) { return new Query(this, table); }
  get client() { return this as unknown as SupabaseAdminClient; }
}

function savedQuote(overrides: Partial<SampleQuoteRow> = {}): SampleQuoteRow {
  const content = buildSampleQuoteEmail({ contactName: 'Ron Buyer', senderName: 'Haskins', trackingNumber: TRACKING, lines: LINES });
  return {
    id: QUOTE_ID, order_id: ORDER_ID, lead_id: LEAD_ID, contact_id: CONTACT_ID,
    sender_profile_id: REP_ID, created_by: REP_ID, sender_name: 'Haskins', sender_email: 'haskins@sobrew.com',
    recipient_name: 'Ron Buyer', recipient_email: 'ron@example.com', tracking_number: TRACKING,
    lines: structuredClone(LINES), subject: content.subject, body_text: content.text, body_html: content.html,
    created_at: NOW.toISOString(), sent_at: null, resend_email_id: null, ...overrides,
  };
}

function setup() {
  const db = new FakeDatabase();
  const send = vi.fn().mockResolvedValue({ data: { id: 'resend-email-1' }, error: null });
  const listDomains = vi.fn().mockResolvedValue({ data: { data: [{ name: 'sobrew.com', status: 'verified' }] }, error: null });
  const options = {
    orderId: ORDER_ID, actorId: REP_ID, isOwner: false, workspaceEnabled: true, supabase: db.client,
    trackingNumber: TRACKING, lines: LINES, expectedRecipientEmail: 'ron@example.com', expectedSenderEmail: 'haskins@sobrew.com',
    resend: { emails: { send }, domains: { list: listDomains } } as unknown as NonNullable<Parameters<typeof sendSampleQuote>[0]['resend']>, now: NOW,
  };
  return { db, send, listDomains, options };
}

describe('sample quote authorized context', () => {
  it('allows an assigned rep and chooses the exact request contact even when another contact is primary', async () => {
    const { db, options } = setup();
    const result = await loadSampleQuoteContext(options);
    expect(result).toMatchObject({ ok: true, context: { contactId: CONTACT_ID, contactName: 'Ron Buyer', contactEmail: 'ron@example.com', senderProfileId: REP_ID, senderEmail: 'haskins@sobrew.com' } });
    expect(db.calls.find(call => call.table === 'orders')?.filters).toContainEqual(['order_kind', 'prospecting_sample']);
    expect(db.calls.find(call => call.table === 'prospecting_contacts')?.filters).toContainEqual(['lead_id', LEAD_ID]);
  });

  it('allows an owner to handle another rep’s lead while sending from that assigned rep', async () => {
    const { options, db, send } = setup();
    expect(await sendSampleQuote({ ...options, actorId: OWNER_ID, isOwner: true })).toEqual({ sentAt: NOW.toISOString(), locked: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'Haskins <haskins@sobrew.com>', replyTo: 'haskins@sobrew.com', to: ['ron@example.com'], bcc: ['haskins@sobrew.com'] }), { idempotencyKey: `sample-quote/${QUOTE_ID}` });
    expect(db.tables.prospecting_sample_quotes[0]).toMatchObject({ sender_profile_id: REP_ID, created_by: OWNER_ID, sent_at: NOW.toISOString(), resend_email_id: 'resend-email-1' });
  });

  it('denies an unrelated rep before reading contact information', async () => {
    const { options, db, send } = setup();
    expect(await sendSampleQuote({ ...options, actorId: OWNER_ID })).toMatchObject({ error: expect.stringContaining('do not have access') });
    expect(db.calls.some(call => ['prospecting_contacts', 'profiles', 'prospecting_sample_quotes'].includes(call.table))).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('denies invalid, ordinary, and archived sample orders', async () => {
    const invalid = setup();
    expect((await loadSampleQuoteContext({ ...invalid.options, orderId: 'not-a-uuid' })).ok).toBe(false);
    expect(invalid.db.calls).toEqual([]);
    const ordinary = setup();
    ordinary.db.tables.orders[0].order_kind = 'wholesale';
    expect((await loadSampleQuoteContext(ordinary.options)).ok).toBe(false);
    const archived = setup();
    archived.db.tables.prospecting_leads[0].archived_at = NOW.toISOString();
    expect((await loadSampleQuoteContext({ ...archived.options, isOwner: true })).ok).toBe(false);
  });

  it('lets the assigned rep complete the quote step immediately after creating a requested sample order', async () => {
    const { db, options, send } = setup();
    db.tables.prospecting_leads[0].stage = 'sample_requested';
    expect(await loadSampleQuoteContext(options)).toMatchObject({ ok: true, context: { leadId: LEAD_ID, senderProfileId: REP_ID } });
    expect(await sendSampleQuote(options)).toEqual({ sentAt: NOW.toISOString(), locked: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    { is_active: false, email: 'haskins@sobrew.com' },
    { is_active: true, email: 'haskins@example.com' },
    { is_active: true, email: 'haskins@sobrew.com.evil.example' },
    { is_active: true, email: 'haskins@sobrew.com\r\nBcc: stranger@example.com' },
  ])('rejects invalid or inactive lead sender %j', async profile => {
    const { db, options, send } = setup();
    Object.assign(db.tables.profiles[0], profile);
    expect(await sendSampleQuote(options)).toMatchObject({ error: expect.stringContaining('active profile') });
    expect(send).not.toHaveBeenCalled();
  });

  it('does not silently substitute a different recipient when the request contact lacks an email', async () => {
    const { db, options, send } = setup();
    db.tables.prospecting_contacts[1].email = '';
    expect(await sendSampleQuote(options)).toMatchObject({ error: expect.stringContaining('sample recipient') });
    expect(send).not.toHaveBeenCalled();
  });

  it('blocks do-not-contact leads and pending quotes whose assigned owner has changed', async () => {
    const dnc = setup();
    dnc.db.tables.prospecting_leads[0].do_not_contact = true;
    expect(await sendSampleQuote(dnc.options)).toMatchObject({ error: expect.stringContaining('do not contact') });
    expect(dnc.send).not.toHaveBeenCalled();
    expect(dnc.db.tables.prospecting_sample_quotes).toHaveLength(0);
    const reassigned = setup();
    reassigned.db.tables.prospecting_sample_quotes.push(savedQuote());
    reassigned.db.tables.prospecting_leads[0].assigned_profile_id = OWNER_ID;
    expect(await sendSampleQuote({ ...reassigned.options, isOwner: true })).toMatchObject({ error: expect.stringContaining('lead owner changed'), locked: true });
    expect(reassigned.send).not.toHaveBeenCalled();
  });
});

describe('sample quote delivery and immutable retries', () => {
  it('delivers and stores only checked items using the edited price and expected email subject', async () => {
    const { options, db, send } = setup();
    expect(await sendSampleQuote(options)).toMatchObject({ sentAt: NOW.toISOString() });
    const payload = send.mock.calls[0][0];
    expect(payload.bcc).toEqual(['haskins@sobrew.com']);
    expect(payload.subject).toBe('Sobrew Coffee Samples, Pricing, and Ordering Process');
    for (const body of [payload.text, payload.html]) {
      expect(body).toContain('$35.00 per bag ($7.00/lb)');
      expect(body).toContain(TRACKING);
      expect(body).not.toContain('Fraction Pack');
      expect(body).not.toContain('Decaf');
    }
    expect(db.tables.prospecting_sample_quotes[0]).toMatchObject({ lines: LINES, body_text: payload.text, body_html: payload.html });
  });

  it('retries the exact stored content and stable key even with JSONB key ordering and changed live contact name', async () => {
    const { db, options, send, listDomains } = setup();
    db.tables.prospecting_sample_quotes.push(savedQuote({ lines: [{ priceCents: 3500, id: 'bulk-regular' }], body_text: 'Immutable saved text', body_html: '<p>Immutable saved HTML</p>' }));
    db.tables.prospecting_contacts[1].full_name = 'New live contact name';
    send.mockRejectedValueOnce(new Error('lost acknowledgement'));
    expect(await sendSampleQuote(options)).toMatchObject({ error: expect.stringContaining('interrupted'), locked: true });
    expect(await sendSampleQuote(options)).toMatchObject({ sentAt: NOW.toISOString() });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(send.mock.calls[1]).toEqual([expect.objectContaining({ text: 'Immutable saved text', html: '<p>Immutable saved HTML</p>', bcc: ['haskins@sobrew.com'] }), { idempotencyKey: `sample-quote/${QUOTE_ID}` }]);
    expect(db.calls.filter(call => call.operation === 'insert')).toEqual([]);
    expect(listDomains).not.toHaveBeenCalled();
  });

  it('returns the existing confirmation without resending even after later inputs change', async () => {
    const { db, options, send } = setup();
    const sentAt = '2026-09-29T10:00:00.000Z';
    db.tables.prospecting_sample_quotes.push(savedQuote({ sent_at: sentAt }));
    expect(await sendSampleQuote({ ...options, lines: [], trackingNumber: '', resend: null })).toEqual({ sentAt, locked: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('retains the copied recipient and receipt after the original CRM contact is deleted', async () => {
    const { db, options, send } = setup();
    const sentAt = NOW.toISOString();
    db.tables.prospecting_sample_quotes.push(savedQuote({ contact_id: null, sent_at: sentAt }));
    db.tables.prospecting_contacts = [];
    expect(await loadSampleQuoteContext(options)).toMatchObject({ ok: true, context: { contactId: '', contactName: 'Ron Buyer', contactEmail: 'ron@example.com' } });
    expect(await sendSampleQuote(options)).toEqual({ sentAt, locked: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('uses the winning immutable snapshot after a duplicate-insert race', async () => {
    const { db, options, send } = setup();
    db.insertRace = savedQuote({ body_text: 'Race winner text' });
    expect(await sendSampleQuote(options)).toMatchObject({ sentAt: NOW.toISOString() });
    expect(db.tables.prospecting_sample_quotes).toHaveLength(1);
    expect(send.mock.calls[0][0].text).toBe('Race winner text');
    expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: `sample-quote/${QUOTE_ID}` });
  });

  it('does not send when the competing saved email contains different pricing', async () => {
    const { db, options, send } = setup();
    db.insertRace = savedQuote({ lines: [{ id: 'bulk-regular', priceCents: 4000 }] });
    expect(await sendSampleQuote(options)).toMatchObject({ error: expect.stringContaining('different details'), locked: true });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { trackingNumber: 'CHANGED123' },
    { lines: [{ id: 'bulk-regular', priceCents: 3400 }] },
    { expectedRecipientEmail: 'old-recipient@example.com' },
    { expectedSenderEmail: 'zach@sobrew.com' },
  ])('rejects changes to a saved quote or reviewed addresses: %j', async overrides => {
    const { db, options, send } = setup();
    db.tables.prospecting_sample_quotes.push(savedQuote());
    expect(await sendSampleQuote({ ...options, ...overrides })).toMatchObject({ error: expect.any(String), locked: true });
    expect(send).not.toHaveBeenCalled();
    expect(db.calls.filter(call => call.operation === 'update')).toEqual([]);
  });

  it.each(['2026-09-29T13:00:00.000Z', '2026-09-29T12:00:00.000Z', 'not-a-date', '2026-09-30T12:02:00.000Z'])('refuses retries outside the safe idempotency window %s', async created_at => {
    const { db, options, send } = setup();
    db.tables.prospecting_sample_quotes.push(savedQuote({ created_at }));
    expect(await sendSampleQuote(options)).toMatchObject({ error: expect.stringContaining('unconfirmed status'), locked: true });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: { message: 'Sender domain is not verified' } },
    { data: {}, error: null },
    { data: { id: '   ' }, error: null },
  ])('retains a retryable unsent snapshot when Resend rejects or omits acceptance: %j', async response => {
    const { db, options, send } = setup();
    send.mockResolvedValueOnce(response);
    expect(await sendSampleQuote(options)).toMatchObject({ error: expect.stringContaining('saved email can be retried'), locked: true });
    expect(db.tables.prospecting_sample_quotes[0].sent_at).toBeNull();
    expect(db.calls.filter(call => call.operation === 'update')).toEqual([]);
    expect(await sendSampleQuote(options)).toMatchObject({ sentAt: NOW.toISOString() });
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  });

  it('recovers a lost database confirmation using the same provider idempotency key and payload', async () => {
    const { db, options, send } = setup();
    db.errors['prospecting_sample_quotes:update'] = { message: 'Database disconnected' };
    expect(await sendSampleQuote(options)).toMatchObject({ error: expect.stringContaining('confirmation could not be saved'), locked: true });
    expect(db.tables.prospecting_sample_quotes[0].sent_at).toBeNull();
    delete db.errors['prospecting_sample_quotes:update'];
    expect(await sendSampleQuote(options)).toMatchObject({ sentAt: NOW.toISOString() });
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(db.tables.prospecting_sample_quotes[0].resend_email_id).toBe('resend-email-1');
  });

  it('does not create a pending send when Resend is missing or input is invalid', async () => {
    const disabled = setup();
    expect(await sendSampleQuote({ ...disabled.options, resend: null })).toMatchObject({ error: expect.stringContaining('not configured') });
    expect(disabled.send).not.toHaveBeenCalled();
    expect(disabled.db.tables.prospecting_sample_quotes).toEqual([]);
    const invalid = setup();
    expect(await sendSampleQuote({ ...invalid.options, lines: [] })).toMatchObject({ error: expect.stringContaining('Select at least one') });
    expect(invalid.send).not.toHaveBeenCalled();
    expect(invalid.db.tables.prospecting_sample_quotes).toEqual([]);
  });

  it.each([
    { domains: [{ name: 'orders.sobrew.com', status: 'verified' }] },
    { domains: [{ name: 'sobrew.com', status: 'pending' }] },
    { domains: [] },
  ])('does not save or send until the exact sender domain is verified: %j', async ({ domains }) => {
    const { db, options, send, listDomains } = setup();
    listDomains.mockResolvedValueOnce({ data: { data: domains }, error: null });
    expect(await sendSampleQuote(options)).toMatchObject({ error: expect.stringContaining('Verify sobrew.com') });
    expect(db.tables.prospecting_sample_quotes).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('lets Resend validate sending when a restricted API key cannot list domains', async () => {
    const { options, send, listDomains } = setup();
    listDomains.mockResolvedValueOnce({ data: null, error: { name: 'restricted_api_key', message: 'This API key can only send emails' } });
    expect(await sendSampleQuote(options)).toMatchObject({ sentAt: NOW.toISOString() });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps a draft editable when sender domain verification has a network failure', async () => {
    const { db, options, send, listDomains } = setup();
    listDomains.mockRejectedValueOnce(new Error('Network disconnected'));
    const result = await sendSampleQuote(options);
    expect(result.error).toBeTruthy();
    expect(result.locked).not.toBe(true);
    expect(db.tables.prospecting_sample_quotes).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing when durable quote storage cannot be read or written', async () => {
    const unavailable = setup();
    unavailable.db.errors['prospecting_sample_quotes:select'] = { code: '42P01', message: 'Missing table' };
    expect(await sendSampleQuote(unavailable.options)).toMatchObject({ error: expect.stringContaining('database update') });
    expect(unavailable.send).not.toHaveBeenCalled();
    const insertFailed = setup();
    insertFailed.db.errors['prospecting_sample_quotes:insert'] = { code: '42501', message: 'Permission denied' };
    expect(await sendSampleQuote(insertFailed.options)).toMatchObject({ error: expect.stringContaining('nothing was sent') });
    expect(insertFailed.send).not.toHaveBeenCalled();
  });
});
