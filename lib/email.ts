import { Resend } from 'resend';
import { usd } from '@/lib/utils';

const RESEND_FROM = 'Sobrew Wholesale <orders@orders.sobrew.com>';
const ADMIN_EMAIL = 'hello@sobrew.com';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

type Line = { name: string; qty: number; price: number; line: number };

type OrderEmailPayload = {
  customerEmail: string;
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

export async function sendAdminNotificationEmail(payload: OrderEmailPayload) {
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
  if (!resend) {
    console.error('Resend disabled: missing RESEND_API_KEY');
    return;
  }

  const html = buildOrderHtml(payload);

  try {
    const response = await resend.emails.send({
      from: RESEND_FROM,
      to: payload.customerEmail,
      subject: `Your Sobrew order ${payload.orderId}`,
      html,
    });
    console.log('Customer confirmation email sent', response);
  } catch (error) {
    console.error('Failed to send customer confirmation email', error);
  }
}

export async function sendOrderEmails(payload: OrderEmailPayload) {
  await sendAdminNotificationEmail(payload);
  await sendOrderEmail(payload);
}

export async function sendShippedEmail(to: string, orderId: string) {
  if (!resend) {
    console.error('Resend disabled: missing RESEND_API_KEY');
    return;
  }

  try {
    const response = await resend.emails.send({
      from: RESEND_FROM,
      to,
      subject: `Order ${orderId} shipped`,
      html: `<p>Your order <strong>${orderId}</strong> has been shipped.</p>`,
    });
    console.log('Shipped email sent', response);
  } catch (error) {
    console.error('Failed to send shipped email', error);
  }
}
