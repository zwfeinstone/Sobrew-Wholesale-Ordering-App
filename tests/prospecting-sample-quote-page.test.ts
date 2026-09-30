import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SampleQuoteContext } from '@/lib/prospecting-sample-quote-delivery';
import type { SampleQuoteRow } from '@/lib/supabase/schema';

const mocks = vi.hoisted(() => ({
  form: vi.fn((_props: Record<string, unknown>) => null),
  load: vi.fn(),
  send: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/components/prospecting-sample-quote-form', () => ({ default: mocks.form }));
vi.mock('@/lib/prospecting-sample-quote-delivery', () => ({ loadSampleQuoteContext: mocks.load, sendSampleQuote: mocks.send }));
vi.mock('@/lib/prospecting-rollout', () => ({ isProspectingWorkspaceEnabled: () => true }));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: async () => ({ profile: { id: 'actor-id' }, isOwner: true, access: {} }),
  requireAdminSectionEdit: async () => ({ profile: { id: 'actor-id' }, isOwner: true, access: {} }),
  adminCanEdit: () => true,
}));

import SampleQuotePage from '@/app/admin/sales/prospecting/sample-order/[orderId]/quote/page';

const context: SampleQuoteContext = {
  orderId: 'order-id', leadId: 'lead-id', companyName: 'Sample Center', contactId: 'contact-id',
  contactName: 'Ron Buyer', contactEmail: 'ron@example.com', senderProfileId: 'owner-id',
  senderName: 'Haskins', senderEmail: 'haskins@sobrew.com', quote: null,
};

function snapshot(greetingName: string | null): SampleQuoteRow {
  return {
    id: 'quote-id', order_id: context.orderId, lead_id: context.leadId, contact_id: context.contactId,
    sender_profile_id: context.senderProfileId, created_by: 'actor-id', sender_name: context.senderName,
    sender_email: context.senderEmail, recipient_name: context.contactName, recipient_email: context.contactEmail,
    greeting_name: greetingName, tracking_number: '1Z123', lines: [{ id: 'bulk-regular', priceCents: 3500 }],
    subject: 'Original subject', body_text: 'Original text', body_html: '<p>Original HTML</p>',
    created_at: '2026-09-30T12:00:00Z', sent_at: null, resend_email_id: null,
  };
}

async function renderForm(quote: SampleQuoteRow | null = null) {
  mocks.load.mockResolvedValue({ ok: true, context: { ...context, quote } });
  renderToStaticMarkup(await SampleQuotePage({ params: Promise.resolve({ orderId: context.orderId }) }));
  return mocks.form.mock.calls.at(-1)![0] as unknown as {
    initialGreetingName: string;
    contactName: string;
    savedEmail?: { subject: string; html: string };
    action: (previous: object, data: FormData) => Promise<{ error?: string; sentAt?: string }>;
  };
}

beforeEach(() => { vi.clearAllMocks(); mocks.send.mockResolvedValue({ sentAt: '2026-09-30T12:00:00Z' }); });

describe('sample quote page greeting boundary', () => {
  it('defaults new greetings to the first name while preserving the contact identity', async () => {
    const props = await renderForm();
    expect(props.initialGreetingName).toBe('Ron');
    expect(props.contactName).toBe('Ron Buyer');
  });

  it.each(['Ron and the team', null])('loads the stored greeting or legacy fallback alongside the exact saved email: %s', async greetingName => {
    const props = await renderForm(snapshot(greetingName));
    expect(props.initialGreetingName).toBe(greetingName ?? 'Ron');
    expect(props.savedEmail).toEqual({ subject: 'Original subject', html: '<p>Original HTML</p>' });
    expect(props.contactName).toBe('Ron Buyer');
  });

  it.each(['Ron and the team', undefined])('forwards the submitted greeting to validated delivery: %s', async greetingName => {
    const props = await renderForm();
    const data = new FormData();
    data.set('order_id', context.orderId);
    data.set('tracking_number', '1Z123');
    data.set('lines', JSON.stringify([{ id: 'bulk-regular', priceCents: 3500 }]));
    if (greetingName !== undefined) data.set('greeting_name', greetingName);
    await expect(props.action({}, data)).resolves.toMatchObject({ sentAt: '2026-09-30T12:00:00Z' });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ greetingName, actorId: 'actor-id', expectedRecipientEmail: context.contactEmail, expectedSenderEmail: context.senderEmail }));
  });

  it('rejects a non-text greeting field before invoking delivery', async () => {
    const props = await renderForm();
    const data = new FormData();
    data.set('order_id', context.orderId);
    data.set('greeting_name', new Blob(['Ron']), 'greeting.txt');
    await expect(props.action({}, data)).resolves.toMatchObject({ error: expect.stringContaining('greeting name') });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
