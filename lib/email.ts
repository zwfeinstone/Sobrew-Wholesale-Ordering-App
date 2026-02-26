import { Resend } from 'resend';
import { env } from '@/lib/env';
import { usd } from '@/lib/utils';

const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

type Line = { name: string; qty: number; price: number; line: number };

export async function sendOrderEmails(payload: {
  customerEmail: string;
  customerName: string;
  orderId: string;
  shipping: Record<string, string | null>;
  items: Line[];
  subtotalCents: number;
}) {
  if (!resend) return;
  const rows = payload.items
    .map((i) => `<tr><td>${i.name}</td><td>${i.qty}</td><td>${usd(i.price)}</td><td>${usd(i.line)}</td></tr>`)
    .join('');
  const html = `<h2>Order ${payload.orderId}</h2><p>${payload.customerName} (${payload.customerEmail})</p><table><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr>${rows}</table><p>Subtotal: ${usd(payload.subtotalCents)}</p>`;

  await resend.emails.send({ from: env.resendFrom, to: env.sobrewAdminEmail, subject: `New Order ${payload.orderId}`, html });
  await resend.emails.send({ from: env.resendFrom, to: payload.customerEmail, subject: `Your SoBrew order ${payload.orderId}`, html });
}

export async function sendShippedEmail(to: string, orderId: string) {
  if (!resend) return;
  await resend.emails.send({
    from: env.resendFrom,
    to,
    subject: `Order ${orderId} shipped`,
    html: `<p>Your order <strong>${orderId}</strong> has been shipped.</p>`
  });
}
