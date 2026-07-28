import 'server-only';

import { Resend } from 'resend';
import { usd } from '@/lib/utils';

const RESEND_FROM = 'Sobrew Wholesale <orders@orders.sobrew.com>';
const ADMIN_EMAIL = 'hello@sobrew.com';
const PORTAL_URL = 'https://app.sobrew.com';
const WELCOME_EMAIL_CC = ['haskins@sobrew.com', 'zach@sobrew.com'];

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
type SendEmailResult = { ok: true } | { error: unknown; ok: false };

type OrderEmailPayload = {
  customerEmail: string | string[];
  customerName: string;
  orderId: string;
  shipping: Record<string, string | null>;
  items: Line[];
  subtotalCents: number;
};

type WelcomeEmailPayload = {
  email: string;
  fullName?: string | null;
  password: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function titleCaseWord(value: string) {
  if (!value) return value;
  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function fallbackNameFromEmail(email: string) {
  const prefix = email.split('@')[0] ?? '';
  const [firstPart] = prefix.split(/[._-]+/).filter(Boolean);
  return titleCaseWord(firstPart || 'there');
}

function welcomeGreetingName(fullName: string | null | undefined, email: string) {
  const [firstName] = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  return firstName || fallbackNameFromEmail(email);
}

export function buildCustomerWelcomeEmailContent(payload: WelcomeEmailPayload) {
  const greetingName = welcomeGreetingName(payload.fullName, payload.email);
  const safeName = escapeHtml(greetingName);
  const safeEmail = escapeHtml(payload.email);
  const safePassword = escapeHtml(payload.password);

  const html = `
    <p>Hi ${safeName},</p>
    <p>We are excited to work with y'all!</p>
    <p>I've set up your account in our new wholesale ordering portal so you can get started right away:</p>
    <h2>Login Details</h2>
    <p><strong>Portal:</strong> <a href="${PORTAL_URL}">app.sobrew.com</a></p>
    <p><strong>Email:</strong> ${safeEmail}</p>
    <p><strong>Password:</strong> ${safePassword}</p>
    <p>We built this to make ordering as simple and hands-off as possible. Most of our partners love the ability to <strong>set it and forget it</strong>:</p>
    <ul>
      <li>Set up <strong>recurring orders</strong> so you never run out</li>
      <li><strong>Adjust frequency or quantities anytime</strong> as your needs change</li>
      <li><strong>Reorder in seconds</strong> from past purchases</li>
      <li>Access your <strong>full catalog of products</strong> in one place</li>
    </ul>
    <p>No more last-minute orders or back-and-forth; just consistent delivery, on your terms.</p>
    <p>If you'd like a quick walkthrough or have any questions, I'm always happy to help.</p>
    <p>Thanks again for your partnership and for the work you do every day.</p>
    <p>Best,<br />The Sobrew Team</p>
  `.trim();

  const text = [
    `Hi ${greetingName},`,
    '',
    "We are excited to work with y'all!",
    '',
    "I've set up your account in our new wholesale ordering portal so you can get started right away:",
    '',
    'Login Details',
    `Portal: ${PORTAL_URL}`,
    `Email: ${payload.email}`,
    `Password: ${payload.password}`,
    '',
    'We built this to make ordering as simple and hands-off as possible. Most of our partners love the ability to set it and forget it:',
    '',
    '- Set up recurring orders so you never run out',
    '- Adjust frequency or quantities anytime as your needs change',
    '- Reorder in seconds from past purchases',
    '- Access your full catalog of products in one place',
    '',
    'No more last-minute orders or back-and-forth; just consistent delivery, on your terms.',
    '',
    "If you'd like a quick walkthrough or have any questions, I'm always happy to help.",
    '',
    'Thanks again for your partnership and for the work you do every day.',
    '',
    'Best,',
    'The Sobrew Team',
  ].join('\n');

  return { html, text };
}

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

export async function sendCustomerWelcomeEmail(payload: WelcomeEmailPayload): Promise<SendEmailResult> {
  const resend = getResend();
  if (!resend) {
    const error = new Error('Resend disabled: missing RESEND_API_KEY');
    console.error(error.message);
    return { error, ok: false };
  }

  if (!payload.email) {
    const error = new Error('Welcome email skipped: missing recipient');
    console.error(error.message);
    return { error, ok: false };
  }

  const { html, text } = buildCustomerWelcomeEmailContent(payload);

  try {
    const response = await resend.emails.send({
      from: RESEND_FROM,
      to: payload.email,
      cc: WELCOME_EMAIL_CC,
      subject: 'Welcome to Sobrew Wholesale Ordering',
      html,
      text,
    });
    console.log('Customer welcome email sent', response);
    return { ok: true };
  } catch (error) {
    console.error('Failed to send customer welcome email', error);
    return { error, ok: false };
  }
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
