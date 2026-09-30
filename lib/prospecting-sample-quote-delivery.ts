import 'server-only';

import { getResend, resendEmailAcceptanceError } from '@/lib/email';
import { getSupabaseAdmin, type SupabaseAdminClient } from '@/lib/supabase/admin';
import type { SampleQuoteRow } from '@/lib/supabase/schema';
import { hasSampleRequestContact } from '@/lib/prospecting-sample-contact';
import { buildSampleQuoteEmail, validateSampleQuoteInput } from '@/lib/prospecting-sample-quote';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Resend keeps idempotency keys for 24 hours. Stop earlier on uncertain sends.
const SAFE_RETRY_MS = 23 * 60 * 60 * 1000;
const STORAGE_ERROR = 'Sample email records could not be loaded. Please try again after the sample pricing database update is available.';

export type SampleQuoteContext = {
  orderId: string;
  leadId: string;
  companyName: string;
  contactId: string;
  contactName: string;
  contactEmail: string;
  senderProfileId: string;
  senderName: string;
  senderEmail: string;
  quote: SampleQuoteRow | null;
  sendBlockedReason?: string;
};
type Access = { actorId: string; isOwner: boolean; workspaceEnabled: boolean };
type DeliveryResult = { error?: string; sentAt?: string; locked?: boolean };

/** Service-role reads are scoped here before any contact or quote is returned. */
export async function loadSampleQuoteContext({ orderId, actorId, isOwner, workspaceEnabled, supabase = getSupabaseAdmin() }: Access & {
  orderId: string;
  supabase?: SupabaseAdminClient;
}): Promise<{ ok: true; context: SampleQuoteContext } | { ok: false; error: string }> {
  if (!UUID.test(orderId)) return { ok: false, error: 'This sample order is unavailable.' };
  const orderResult = await supabase.from('orders').select('id,prospecting_lead_id,shipping_name')
    .eq('id', orderId).eq('order_kind', 'prospecting_sample').maybeSingle();
  const order = orderResult.data;
  if (orderResult.error || !order?.prospecting_lead_id) return { ok: false, error: 'This linked sample order is unavailable.' };
  const leadResult = await supabase.from('prospecting_leads').select('id,company_name,assigned_profile_id,archived_at,do_not_contact,stage')
    .eq('id', order.prospecting_lead_id).maybeSingle();
  const lead = leadResult.data;
  // The quote step remains available to the assigned rep after the lead leaves
  // their calling queue, so they can finish their own sample shipment email.
  if (leadResult.error || !lead || lead.archived_at || (!isOwner && lead.assigned_profile_id !== actorId)) {
    return { ok: false, error: 'This sample lead is unavailable or you do not have access.' };
  }
  const saved = await supabase.from('prospecting_sample_quotes').select('*').eq('order_id', orderId).maybeSingle();
  if (saved.error) return { ok: false, error: STORAGE_ERROR };
  const quote = saved.data;
  if (quote) {
    return { ok: true, context: {
      orderId, leadId: lead.id, companyName: lead.company_name,
      contactId: quote.contact_id ?? '', contactName: quote.recipient_name, contactEmail: quote.recipient_email,
      senderProfileId: quote.sender_profile_id, senderName: quote.sender_name, senderEmail: quote.sender_email, quote,
      sendBlockedReason: lead.do_not_contact ? 'This lead is marked do not contact. Update the lead before sending an email.'
        : lead.assigned_profile_id !== quote.sender_profile_id && !quote.sent_at ? 'The lead owner changed after this email was prepared. An administrator must review the pending email before it can be retried.' : undefined,
    } };
  }
  if (!lead.assigned_profile_id) return { ok: false, error: 'Assign a lead owner before sending the samples and pricing email.' };
  const [senderResult, contactsResult, requestResult] = await Promise.all([
    supabase.from('profiles').select('id,full_name,email,is_active').eq('id', lead.assigned_profile_id).maybeSingle(),
    supabase.from('prospecting_contacts').select('id,full_name,email,is_primary').eq('lead_id', lead.id).order('is_primary', { ascending: false }).order('created_at').order('id'),
    supabase.from('prospecting_sample_requests').select('contact_id').eq('order_id', orderId).eq('lead_id', lead.id).maybeSingle(),
  ]);
  const sender = senderResult.data;
  const senderEmail = sender?.email?.trim().toLowerCase() ?? '';
  if (senderResult.error || !sender || sender.is_active === false || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@sobrew\.com$/i.test(senderEmail)) {
    return { ok: false, error: 'The lead owner needs an active profile with a valid @sobrew.com email address before this email can be sent.' };
  }
  // Legacy installations may not have the request table yet; never hide other errors.
  if (contactsResult.error || (requestResult.error && (workspaceEnabled || !['42P01', 'PGRST205'].includes(requestResult.error.code)))) {
    return { ok: false, error: 'The sample contact could not be loaded. Please reload before sending.' };
  }
  const eligible = (contactsResult.data ?? []).filter(contact => hasSampleRequestContact([contact]));
  const requestContactId = requestResult.data?.contact_id;
  const contact = requestContactId ? eligible.find(item => item.id === requestContactId)
    : eligible.find(item => item.full_name?.trim().toLowerCase() === order.shipping_name?.trim().toLowerCase())
      ?? eligible.find(item => item.is_primary) ?? (eligible.length === 1 ? eligible[0] : undefined);
  if (!contact) return { ok: false, error: 'The sample recipient needs a name and valid email. Review the request contact or set the intended lead contact as primary before sending.' };
  return { ok: true, context: {
    orderId, leadId: lead.id, companyName: lead.company_name,
    contactId: contact.id, contactName: contact.full_name!.trim(), contactEmail: contact.email!.trim(),
    senderProfileId: sender.id, senderName: sender.full_name?.trim() || senderEmail.split('@')[0], senderEmail, quote: null,
    sendBlockedReason: lead.do_not_contact ? 'This lead is marked do not contact. Update the lead before sending an email.' : undefined,
  } };
}

export async function sendSampleQuote({ orderId, trackingNumber, lines, expectedRecipientEmail, expectedSenderEmail, actorId, isOwner, workspaceEnabled, supabase = getSupabaseAdmin(), resend = getResend(), now = new Date() }: Access & {
  orderId: string;
  trackingNumber: string;
  lines: unknown;
  expectedRecipientEmail: string;
  expectedSenderEmail: string;
  supabase?: SupabaseAdminClient;
  resend?: ReturnType<typeof getResend>;
  now?: Date;
}): Promise<DeliveryResult> {
  const loaded = await loadSampleQuoteContext({ orderId, actorId, isOwner, workspaceEnabled, supabase });
  if (!loaded.ok) return { error: loaded.error };
  const context = loaded.context;
  if (context.quote?.sent_at) return { sentAt: context.quote.sent_at, locked: true };
  if (context.sendBlockedReason) return { error: context.sendBlockedReason, locked: Boolean(context.quote) };
  if (context.contactEmail !== expectedRecipientEmail || context.senderEmail !== expectedSenderEmail) {
    return { error: 'The recipient or lead owner changed. Reload to review the current email addresses before sending.', locked: Boolean(context.quote) };
  }
  const input = validateSampleQuoteInput(trackingNumber, lines);
  if (!input.ok) return { error: input.error, locked: Boolean(context.quote) };
  if (!resend) return { error: 'Email sending is not configured. Your sample order is saved; try this email again after Resend is configured.', locked: Boolean(context.quote) };
  let quote = context.quote;
  if (!quote) {
    try {
      const domains = await resend.domains.list();
      // Sending-only API keys cannot list domains; Resend still enforces the
      // sender at send time. A successful listing lets us catch setup issues
      // before freezing the customer's quote for delivery.
      if (!domains.error && domains.data && !domains.data.data.some(domain => domain.name === 'sobrew.com' && domain.status === 'verified')) {
        return { error: 'Verify sobrew.com in Resend before sending from the lead owner’s email. Your tracking and pricing draft is still editable; no email has been sent.' };
      }
    } catch {
      return { error: 'The email sender could not be checked. Your draft is still editable; please try again.' };
    }
    const content = buildSampleQuoteEmail({ contactName: context.contactName, senderName: context.senderName, trackingNumber: input.trackingNumber, lines: input.lines });
    const inserted = await supabase.from('prospecting_sample_quotes').insert({
      order_id: orderId, lead_id: context.leadId, contact_id: context.contactId,
      sender_profile_id: context.senderProfileId, created_by: actorId,
      sender_name: context.senderName, sender_email: context.senderEmail,
      recipient_name: context.contactName, recipient_email: context.contactEmail,
      tracking_number: input.trackingNumber, lines: input.lines,
      subject: content.subject, body_text: content.text, body_html: content.html,
    }).select('*').single();
    if (inserted.error) {
      if (inserted.error.code !== '23505') return { error: 'The email could not be saved, so nothing was sent. Please try again.' };
      // Another click or tab won the unique order constraint. Use its exact payload.
      const existing = await supabase.from('prospecting_sample_quotes').select('*').eq('order_id', orderId).maybeSingle();
      if (existing.error || !existing.data) return { error: 'A send attempt is already being saved. Reload to check its status.', locked: true };
      quote = existing.data;
    } else quote = inserted.data;
  }
  if (!quote) return { error: 'The email could not be saved, so nothing was sent.' };
  if (quote.sent_at) return { sentAt: quote.sent_at, locked: true };
  const savedInput = validateSampleQuoteInput(quote.tracking_number, quote.lines);
  if (!savedInput.ok || quote.tracking_number !== input.trackingNumber || JSON.stringify(savedInput.lines) !== JSON.stringify(input.lines)
    || quote.recipient_email !== context.contactEmail || quote.sender_email !== context.senderEmail) {
    return { error: 'An email was already prepared for this order with different details. Reload to review and retry that original email.', locked: true };
  }
  const age = now.getTime() - new Date(quote.created_at).getTime();
  if (!Number.isFinite(age) || age >= SAFE_RETRY_MS || age < -60_000) {
    return { error: 'This earlier send has an unconfirmed status. Ask an administrator to check Resend before sending again, so the customer does not receive a duplicate.', locked: true };
  }
  try {
    const response = await resend.emails.send({
      from: `${quote.sender_name.replace(/[<>"\r\n]/g, '')} <${quote.sender_email}>`,
      replyTo: quote.sender_email, to: [quote.recipient_email], subject: quote.subject,
      text: quote.body_text, html: quote.body_html,
    }, { idempotencyKey: `sample-quote/${quote.id}` });
    const deliveryError = resendEmailAcceptanceError(response, 'Samples and pricing email');
    if (deliveryError) return { error: `${deliveryError.message} The saved email can be retried.`, locked: true };
    const sentAt = now.toISOString();
    const saved = await supabase.from('prospecting_sample_quotes').update({ sent_at: sentAt, resend_email_id: response.data!.id })
      .eq('id', quote.id).is('sent_at', null).select('sent_at').maybeSingle();
    if (saved.error) return { error: 'The email was accepted, but its confirmation could not be saved. Retry to recover the same email confirmation.', locked: true };
    return { sentAt: saved.data?.sent_at ?? sentAt, locked: true };
  } catch {
    return { error: 'The email response was interrupted. Retry this saved email to safely check whether it was sent.', locked: true };
  }
}
