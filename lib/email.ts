import 'server-only';

import { Resend } from 'resend';
import { usd } from '@/lib/utils';

const RESEND_FROM = 'Sobrew Wholesale <orders@orders.sobrew.com>';
const ADMIN_EMAIL = 'hello@sobrew.com';

let resendClient: Resend | null | undefined;

export function getResend() {
  if (typeof window !== 'undefined') {
    throw new Error('The Resend client can only be used on the server.');
  }

  if (resendClient === undefined) {
    resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  }

  return resendClient;
}

type Line = { name: string; qty: number; price: number; line: number };
type ShippedLine = { name: string; qty: number };
type TrackingLine = { carrier?: string | null; service?: string | null; trackingCode: string };

type OrderEmailPayload = {
  customerEmail: string | string[];
  customerName: string;
  orderId: string;
  shipping: Record<string, string | null>;
  items: Line[];
  subtotalCents: number;
};

function buildOrderHtml(payload: OrderEmailPayload) {
  const rows = payload.items
    .map((i) => `<tr><td>${i.name}</td><td>${i.qty}</td><td>${usd(i.price)}</td><td>${usd(i.line)}</td></tr>`)
    .join('');

  return `<h2>Order ${payload.orderId}</h2><p>${payload.customerName} (${payload.customerEmail})</p><table><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr>${rows}</table><p>Subtotal: ${usd(payload.subtotalCents)}</p>`;
}

function buildCustomerOrderHtml(payload: OrderEmailPayload) {
  const itemRows = payload.items
    .map((item) => `<li>${item.name} x ${item.qty}</li>`)
    .join('');

  return `<p>Thank you for your order!</p><p>Items purchased:</p><ul>${itemRows}</ul><p>Total: ${usd(payload.subtotalCents)}</p>`;
}

export async function sendAdminNotificationEmail(payload: OrderEmailPayload) {
  const resend = getResend();
  if (!resend) {
    console.error('Resend disabled: missing RESEND_API_KEY');
    return;
  }

  const html = buildOrderHtml(payload);

  try {
    const response = await resend.emails.send({
      from: RESEND_FROM,
      to: ADMIN_EMAIL,
      subject: `New Order ${payload.orderId}`,
      html,
    });
    console.log('Admin notification email sent', response);
  } catch (error) {
    console.error('Failed to send admin notification email', error);
  }
}

export async function sendOrderEmail(payload: OrderEmailPayload) {
  const resend = getResend();
  if (!resend) {
    console.error('Resend disabled: missing RESEND_API_KEY');
    return;
  }

  const recipients = Array.isArray(payload.customerEmail) ? payload.customerEmail.filter(Boolean) : [payload.customerEmail].filter(Boolean);
  if (!recipients.length) {
    console.error('Customer confirmation email skipped: missing recipient');
    return;
  }

  const html = buildCustomerOrderHtml(payload);

  try {
    const response = await resend.emails.send({
      from: RESEND_FROM,
      to: recipients,
      subject: 'Thank You For Your Order!',
      html,
    });
    console.log('Customer confirmation email sent', response);
  } catch (error) {
    console.error('Failed to send customer confirmation email', error);
  }
}

export async function sendOrderEmails(payload: OrderEmailPayload) {
  await Promise.all([
    sendAdminNotificationEmail(payload),
    sendOrderEmail(payload),
  ]);
}

export async function sendShippedEmail(to: string | string[], items: ShippedLine[], trackingLines: TrackingLine[] = []) {
  const resend = getResend();
  if (!resend) {
    console.error('Resend disabled: missing RESEND_API_KEY');
    return;
  }

  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!recipients.length) {
    console.error('Shipped email skipped: missing recipient');
    return;
  }

  const itemRows = items
    .map((item) => `<li>${item.name} x ${item.qty}</li>`)
    .join('');
  const itemsHtml = itemRows ? `<p>Items in this shipment:</p><ul>${itemRows}</ul>` : '<p>Items in this shipment:</p><p>Unavailable</p>';
  const trackingRows = trackingLines
    .map((tracking) => {
      const carrier = [tracking.carrier, tracking.service].filter(Boolean).join(' ');
      return `<li>${carrier ? `${carrier}: ` : ''}${tracking.trackingCode}</li>`;
    })
    .join('');
  const trackingHtml = trackingRows ? `<p>Tracking:</p><ul>${trackingRows}</ul>` : '';

  try {
    const response = await resend.emails.send({
      from: RESEND_FROM,
      to: recipients,
      subject: 'Your Order Has Been Shipped!',
      html: `<p>Thank you for your business!</p>${itemsHtml}${trackingHtml}`,
    });
    console.log('Shipped email sent', response);
  } catch (error) {
    console.error('Failed to send shipped email', error);
  }
}
