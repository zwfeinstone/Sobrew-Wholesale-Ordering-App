import 'server-only';

import { Resend } from 'resend';
import { normalizeShipmentTrackingLines, type ShipmentTrackingLine } from '@/lib/shipment-tracking';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { usd } from '@/lib/utils';

const RESEND_FROM = 'Sobrew Wholesale <orders@orders.sobrew.com>';
const REPLY_TO_EMAIL = 'hello@sobrew.com';
const ADMIN_EMAIL = 'hello@sobrew.com';
const HASKINS_EMAIL = 'haskins@sobrew.com';
const PORTAL_URL = 'https://app.sobrew.com';
const WEBSITE_URL = 'https://sobrew.com';
const INSTAGRAM_URL = 'https://www.instagram.com/sobrew_official';
const LINKEDIN_URL = 'https://www.linkedin.com/company/sobrew/';
const LOGO_URL = `${PORTAL_URL}/sobrew-logo.png`;
const INSTAGRAM_ICON_CID = 'sobrew-instagram';
const LINKEDIN_ICON_CID = 'sobrew-linkedin';
const INSTAGRAM_ICON_BASE64 = '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';
const LINKEDIN_ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAASKADAAQAAAABAAAASAAAAACz+WTVAAAE20lEQVR4Ae2cW0gUURjHv1lttVDJSLNSrEyRMLQrBCtU1GMFRVBhb93orYwoCKrneisoIegh6KEeCkqoIMnoThbS0ouVgUJpWbRe0l1Xm/+GsTvnnDmzeWrnOPOBuPN9Z87M/zfnMmfOzDHGTSPfhAQCwogfSBDwAUkKgg9IAihbEk+E0UzFRyI0av7Fo0M0PjZq+nVrugwyAtmUFZxB2TkFlGX+GYYhlW/IGunR4QiNDHym8XhUmplOCYysIOXklVB2boHtaQsBodREB3ooNvTVNgPdg9NmzKZg3hxhaRK2QV6Ag4uLAgCtIuMCQrWa6iUnGQi0QjPPGECoWmhzvGaJdpZzz8wAQm811RpkJxcbmqHdagwgdOVeNZ52BhDuc7xqPO0MoN83gd5ExNPOANLvDlnlxWRHBxxAKg+of14+IMk19AFJADkazUvySISHhofpcnMztbx8SX0/IlRaXEybQiHavn4dBQL6XgdmsDrQE3bCIyUN4Bw8c5bedXen+LGxfsUKOr13j3AwyOyQYUfenJqUM1ByaVFyeHBwpJa2NrNUtaUcVKcNJYBQrezsviRut2+mY0oAoc2xs77ID7uwq2NKAM0vKrIVWVpUbBt3c1AJoM319bYa0ZvpakoAoStHb8WzfVu2UF1VJS+khU9JNw+leNCG3goNMtocVCuUHN3gWLt5ZYC0KA4OTtIKSEkVc3BcbZMoG2r8LwKRwUF6Fg7Tm/cfqPtLLw3+/EkBI0CFBfm0YO5cWlldTcuqqpQNb5RUsUft7XTy0iUaicYYToX5+XT+SCOVl5QwMThC+w9w/XBurg/R0YaGRPzzt290+dZtuvfiBcVGMbMrtjJzHHhw21aqr6sTJxJE/kkVe/omzIWDc/je30/tHR2C03Hmvv34Me0+dZqanzyRwkGOXb29dPzCRTp79Wqi83B2FH4qJVVsXDJPz5lN4Z8Nx9t04yZduXOHE5G7brY+JHNGnhp37ZQnFqRQAkiQ96TdD169JrQ5k7Ebra1mVaul1UuW/FU2ru7FJgtngsi5a9cnfqb939WA0lYj2KHz0ycKm73e35irq1iyoJzgNNqxYQOtM4c0GBzj3Z6unh66+/w5XW9poXh8LDk58xt3+DUVixi/zKEFoJnmrcK5w4do4bx5KXoqy8oIfzWLKuhEU1NKzLrx9mOn1eVoW4sqdmx3AwMnWd3a5csoVFub7GJ+d3R109iYfSljdjIdrgeEu2OZeAjbuHoVT98fXzQWo/6h9KfVXQ8IXbQTqy4vlyYbMIcl6ZrrAS0uLXWkaVaB/buGyASzL+ma6wE5EQ7RucGgVHt8KrZB04M5UuFI4OSVXkcZWRK5vgSZQ6mMmvsBZRSPBt18hvm4/z7IB5RpApLj+22QD0hCQBL2S9D/AITnvnbm4LMsu90zGlNSgtYsrSE80OIZpn1qK/25eR4bLX3/ZF5MSxIOT1pJFXN4LC2T+YAkl40DyL5HkuSneZjVzgDCp9NeNZ52BhC+K/eq8bQzgPDRvVeNp50BlFiRwPzo3muGhQag3WoMIDzbxYoEXjNo5j3XZgABDJZrwIoEXjFoFS1RwQUEMFiuwQuQJpamEBUG5h1Fa0J/cRO8AS4xJPGXx5FA8mpY2AZ5FYhVtw/ISsSy7QOyALFu/gI/+IfQbSnW+wAAAABJRU5ErkJggg==';
const WELCOME_EMAIL_CC = ['haskins@sobrew.com', 'zach@sobrew.com'];
const TEXT_SOCIAL_FOOTER_LINES = [
  'Follow Sobrew:',
  `Sobrew.com: ${WEBSITE_URL}`,
  `Instagram: ${INSTAGRAM_URL}`,
  `LinkedIn: ${LINKEDIN_URL}`,
] as const;

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
type TrackingLine = ShipmentTrackingLine;
type SendEmailResult = { ok: true } | { error: unknown; ok: false };

type OrderEmailPayload = {
  centerId?: string | null;
  customerEmail: string | string[];
  customerName: string;
  orderId: string;
  orderedAt?: Date | string | null;
  shipping: Record<string, string | null>;
  items: Line[];
  subtotalCents: number;
};

type WelcomeEmailPayload = {
  centerName?: string | null;
  email: string;
  fullName?: string | null;
  password: string;
};

type ShippedEmailContext = {
  customerName?: string | null;
  orderId?: string | null;
  shippedAt?: Date | string | null;
};

type InvoicePdfEmailPayload = {
  cc?: string | string[] | null;
  customerName: string;
  invoiceNumber: string;
  orderId: string;
  pdf: Buffer;
  to: string | string[];
};

type InvoicePdfEmailContentPayload = Pick<InvoicePdfEmailPayload, 'customerName' | 'invoiceNumber'>;

type PaymentReceiptEmailPayload = {
  amountCents: number;
  cc?: string | string[] | null;
  customerName: string;
  invoiceNumber: string;
  orderId: string;
  paymentMethodLabel: string;
  paymentStatus: string;
  paymentMethodType: string;
  pdf: Buffer;
  to: string | string[];
};

type PaymentReceiptEmailContentPayload = Omit<PaymentReceiptEmailPayload, 'orderId' | 'pdf' | 'to'>;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitEmailAddresses(value: string | string[] | null | undefined) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item ?? '').split(/[,;\n]+/))
    .map((address) => address.trim())
    .filter(Boolean);
}

export function outgoingEmailRecipients(to: string | string[] | null | undefined, cc?: string | string[] | null) {
  const seen = new Set<string>();
  const unique = (addresses: string[]) => {
    const result: string[] = [];
    for (const address of addresses) {
      const key = address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(address);
    }
    return result;
  };
  const toRecipients = unique(splitEmailAddresses(to));
  const ccRecipients = unique(splitEmailAddresses(cc));
  return { cc: ccRecipients, to: toRecipients };
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

function formatEmailDate(value?: Date | string | null) {
  const parsed = value instanceof Date ? value : value ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Chicago',
    year: 'numeric',
  }).format(date);
}

export function adminOrderCcForAssignedSalesEmail(email: string | null | undefined) {
  return String(email ?? '').trim().toLowerCase() === HASKINS_EMAIL ? [HASKINS_EMAIL] : [];
}

async function adminOrderCcForCenter(centerId: string | null | undefined) {
  if (!centerId) return [];

  const { data: assignment, error: assignmentError } = await supabaseAdmin
    .from('center_sales_assignments')
    .select('sales_profile_id')
    .eq('center_id', centerId)
    .maybeSingle();

  if (assignmentError) {
    console.error('Failed to load sales assignment for order email CC', assignmentError);
    return [];
  }

  const salesProfileId = assignment?.sales_profile_id;
  if (!salesProfileId) return [];

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('id', salesProfileId)
    .maybeSingle();

  if (profileError) {
    console.error('Failed to load assigned sales profile for order email CC', profileError);
    return [];
  }

  return adminOrderCcForAssignedSalesEmail(profile?.email);
}

export function buildCustomerWelcomeEmailContent(payload: WelcomeEmailPayload) {
  const greetingName = welcomeGreetingName(payload.fullName, payload.email);
  const safeName = escapeHtml(greetingName);
  const centerName = cleanEmailText(payload.centerName) || 'your center';
  const safeCenterName = escapeHtml(centerName);
  const safeEmail = escapeHtml(payload.email);
  const safePassword = escapeHtml(payload.password);

  const html = emailShell({
    body: `
      <tr>
        <td style="padding:34px 32px 8px 32px;">
          <p style="margin:0 0 14px 0; color:#291f18; font-size:17px; line-height:1.55;">Hi ${safeName},</p>
          <p style="margin:0; color:#594f46; font-size:16px; line-height:1.7;">We've set up Sobrew ordering for ${safeCenterName}. Use the details below whenever you're ready to place an order.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 32px 0 32px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; table-layout:fixed; background:#f5f1e9; border:1px solid #ded8cc; border-radius:12px; overflow:hidden;">
            <tr><td colspan="2" style="padding:18px 18px 10px 18px; color:#29382d; font-size:17px; font-weight:800;">Your login details</td></tr>
            <tr>
              <td colspan="2" style="box-sizing:border-box; padding:8px 18px;">
                <p style="margin:0 0 4px 0; color:#73675c; font-size:12px; font-weight:700; text-transform:uppercase;">Portal</p>
                <p style="margin:0; color:#241a12; font-size:15px; font-weight:700; overflow-wrap:anywhere; word-break:break-all; word-wrap:break-word;"><a href="${PORTAL_URL}" style="color:#29382d; text-decoration:none; overflow-wrap:anywhere; word-break:break-all; word-wrap:break-word;">app.sobrew.com</a></p>
              </td>
            </tr>
            <tr>
              <td colspan="2" style="box-sizing:border-box; padding:8px 18px;">
                <p style="margin:0 0 4px 0; color:#73675c; font-size:12px; font-weight:700; text-transform:uppercase;">Email</p>
                <p style="margin:0; color:#241a12; font-size:15px; font-weight:700; overflow-wrap:anywhere; word-break:break-all; word-wrap:break-word;">${safeEmail}</p>
              </td>
            </tr>
            <tr>
              <td colspan="2" style="box-sizing:border-box; padding:8px 18px 16px 18px;">
                <p style="margin:0 0 4px 0; color:#73675c; font-size:12px; font-weight:700; text-transform:uppercase;">Password</p>
                <p style="margin:0; color:#241a12; font-size:15px; font-weight:700; overflow-wrap:anywhere; word-break:break-all; word-wrap:break-word;">${safePassword}</p>
              </td>
            </tr>
            <tr>
              <td colspan="2" style="padding:0 18px 18px 18px;">
                <a href="${PORTAL_URL}" style="display:block; background:#35563f; border-radius:8px; color:#ffffff; font-size:15px; font-weight:800; padding:14px 18px; text-align:center; text-decoration:none;">Open the ordering portal</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:30px 32px 0 32px;">
          <p style="margin:0 0 9px 0; color:#29382d; font-size:18px; font-weight:800;">Ordering is easy</p>
          <p style="margin:0; color:#594f46; font-size:15px; line-height:1.7;">Choose what you need from your catalog and send the order our way. You can also repeat a past order or set up recurring orders whenever that makes life easier.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:26px 32px 0 32px;">
          <div style="border-top:1px solid #ded8cc; line-height:1px; font-size:1px;">&nbsp;</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 34px 32px;">
          <p style="margin:0 0 9px 0; color:#29382d; font-size:18px; font-weight:800;">A quick note about Sobrew</p>
          <p style="margin:0 0 22px 0; color:#594f46; font-size:15px; line-height:1.7;">Every order helps fund recovery. It's at the heart of what we do, and we're glad to have you with us.</p>
          <p style="margin:0; color:#594f46; font-size:15px; line-height:1.7;"><strong style="color:#291f18;">Questions?</strong> Just reply to this email. We're happy to help.</p>
        </td>
      </tr>
    `,
    eyebrow: 'Sobrew wholesale',
    footerMessage: 'Thanks for being part of Sobrew.',
    footerSignature: 'The Sobrew Team',
    logoSize: 64,
    preheader: 'Your Sobrew wholesale portal is ready.',
    showTextSocialFooter: true,
    title: `Welcome, ${greetingName}!`,
    variant: 'welcome',
  });

  const text = [
    `Hi ${greetingName},`,
    '',
    `We've set up Sobrew ordering for ${centerName}. Use the details below whenever you're ready to place an order.`,
    '',
    'Your login details',
    `Portal: ${PORTAL_URL}`,
    `Email: ${payload.email}`,
    `Password: ${payload.password}`,
    '',
    'Ordering is easy',
    'Choose what you need from your catalog and send the order our way. You can also repeat a past order or set up recurring orders whenever that makes life easier.',
    '',
    'A quick note about Sobrew',
    "Every order helps fund recovery. It's at the heart of what we do, and we're glad to have you with us.",
    '',
    "Questions? Just reply to this email. We're happy to help.",
    '',
    'Thanks for being part of Sobrew.',
    '',
    'The Sobrew Team',
    '',
    ...TEXT_SOCIAL_FOOTER_LINES,
  ].join('\n');

  return { html, text };
}

function buildOrderHtml(payload: OrderEmailPayload) {
  const rows = payload.items
    .map((i) => `<tr><td>${i.name}</td><td>${i.qty}</td><td>${usd(i.price)}</td><td>${usd(i.line)}</td></tr>`)
    .join('');

  return `<h2>Order ${payload.orderId}</h2><p>${payload.customerName} (${payload.customerEmail})</p><table><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr>${rows}</table><p>Subtotal: ${usd(payload.subtotalCents)}</p>`;
}

function trackingUrlForLine(tracking: TrackingLine) {
  const explicitUrl = cleanEmailText(tracking.trackingUrl);
  if (/^https?:\/\//i.test(explicitUrl)) return explicitUrl;
  const trackingCode = cleanEmailText(tracking.trackingCode);
  if (!trackingCode) return '';
  const carrier = cleanEmailText(tracking.carrier).toLowerCase();
  if (carrier.includes('ups')) return `https://www.ups.com/track?tracknum=${encodeURIComponent(trackingCode)}`;
  if (carrier.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(trackingCode)}`;
  if (carrier.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(trackingCode)}`;
  return '';
}

type EmailShellVariant = 'invoice' | 'order' | 'shipped' | 'welcome';

const EMAIL_SHELL_THEMES: Record<EmailShellVariant, {
  background: string;
  eyebrow: string;
  header: string;
  logoBorder: string;
  stripes: [string, string, string, string];
  title: string;
}> = {
  invoice: {
    background: '#eef2ef',
    eyebrow: '#31563f',
    header: '#ffffff',
    logoBorder: '#31563f',
    stripes: ['#31563f', '#31563f', '#31563f', '#31563f'],
    title: '#26372c',
  },
  order: {
    background: '#eaf5f1',
    eyebrow: '#d9604b',
    header: '#ffe4bd',
    logoBorder: '#84c7bf',
    stripes: ['#e56f5a', '#f2c85b', '#84c7bf', '#4f7250'],
    title: '#2f3d2b',
  },
  shipped: {
    background: '#edf4ef',
    eyebrow: '#4f7250',
    header: '#f4e6cb',
    logoBorder: '#4f7250',
    stripes: ['#4f7250', '#4f7250', '#4f7250', '#4f7250'],
    title: '#2f4f3b',
  },
  welcome: {
    background: '#f4f2ed',
    eyebrow: '#4f7250',
    header: '#ffffff',
    logoBorder: '#d7d0c3',
    stripes: ['#4f7250', '#4f7250', '#4f7250', '#4f7250'],
    title: '#29382d',
  },
};

function emailShell({
  body,
  eyebrow,
  footerMessage = 'Sobrew Wholesale',
  footerSignature,
  logoSize = 78,
  preheader,
  showSocialFooter = false,
  showTextSocialFooter = false,
  title,
  variant,
}: {
  body: string;
  eyebrow: string;
  footerMessage?: string;
  footerSignature?: string;
  logoSize?: 64 | 78;
  preheader: string;
  showSocialFooter?: boolean;
  showTextSocialFooter?: boolean;
  title: string;
  variant: EmailShellVariant;
}) {
  const theme = EMAIL_SHELL_THEMES[variant];
  const hasSocialFooter = showSocialFooter || showTextSocialFooter;
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(title)}</title>
      </head>
      <body style="margin:0; padding:0; background:${theme.background}; color:#291f18; font-family:Arial, Helvetica, sans-serif;">
        <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${escapeHtml(preheader)}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; background:${theme.background}; margin:0;">
          <tr>
            <td align="center" style="padding:28px 12px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; max-width:640px; box-sizing:border-box; background:#ffffff; border:1px solid ${variant === 'welcome' ? '#ded8cc' : '#cbe2da'}; border-radius:18px; overflow:hidden;">
                <tr>
                  <td style="background:${theme.header}; padding:26px 28px 22px 28px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td width="96" valign="middle">
                          <table role="presentation" width="84" height="84" cellspacing="0" cellpadding="0" border="0" style="width:84px; height:84px; background:#ffffff; border:3px solid ${theme.logoBorder}; border-radius:999px;">
                            <tr>
                              <td align="center" valign="middle" style="padding:0;">
                                <img src="${LOGO_URL}" width="${logoSize}" height="${logoSize}" alt="Sobrew" style="display:block; width:${logoSize}px; height:${logoSize}px; margin:0 auto; border:0; border-radius:999px; object-fit:contain;">
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td valign="middle" style="padding-left:16px;">
                          <p style="margin:0 0 6px 0; color:${theme.eyebrow}; font-size:12px; font-weight:700; letter-spacing:2.2px; text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
                          <h1 style="margin:0; color:${theme.title}; font-size:30px; line-height:1.12; font-weight:800;">${escapeHtml(title)}</h1>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        ${theme.stripes.map((color) => `<td style="height:9px; background:${color}; line-height:9px; font-size:9px;">&nbsp;</td>`).join('')}
                      </tr>
                    </table>
                  </td>
                </tr>
                ${body}
                <tr>
                  <td align="center" style="background:#2f4f3b; padding:24px 28px;">
                    <p style="margin:0 0 ${footerSignature ? '8px' : hasSocialFooter ? '14px' : '10px'} 0; color:${variant === 'welcome' ? '#ffffff' : '#f3e8d3'}; font-size:14px; line-height:1.6;">${escapeHtml(footerMessage)}</p>
                    ${footerSignature ? `<p style="margin:0 0 12px 0; color:${variant === 'welcome' ? '#dbe3d8' : '#f2c85b'}; font-size:13px; line-height:1.6;">${escapeHtml(footerSignature)}</p>` : ''}
                    ${showTextSocialFooter ? `
                      <p style="margin:0 0 13px 0; color:#f3e8d3; font-size:13px; line-height:1.8;">
                        <span style="color:#f3e8d3;">Follow Sobrew:</span>&nbsp;
                        <a href="${WEBSITE_URL}" style="color:#f3e8d3; text-decoration:none; font-weight:700; white-space:nowrap;">Sobrew.com</a>
                        <span style="color:#8fa696;">&nbsp;|&nbsp;</span>
                        <a href="${INSTAGRAM_URL}" style="color:#f3e8d3; text-decoration:none; font-weight:700; white-space:nowrap;">Instagram</a>
                        <span style="color:#8fa696;">&nbsp;|&nbsp;</span>
                        <a href="${LINKEDIN_URL}" style="color:#f3e8d3; text-decoration:none; font-weight:700; white-space:nowrap;">LinkedIn</a>
                      </p>
                    ` : ''}
                    ${showSocialFooter ? `
                      <p style="margin:0 0 13px 0; color:#f3e8d3; font-size:13px; line-height:1.8;">
                        <a href="${WEBSITE_URL}" style="color:#f3e8d3; text-decoration:none; font-weight:700;">Sobrew.com</a>
                        <span style="color:#8fa696;">&nbsp;&nbsp;&bull;&nbsp;&nbsp;</span>
                        <a href="${INSTAGRAM_URL}" style="color:#f3e8d3; text-decoration:none; font-weight:700; white-space:nowrap;"><img src="cid:${INSTAGRAM_ICON_CID}" width="18" height="18" alt="" style="display:inline-block; width:18px; height:18px; margin:0 6px 0 0; border:0; vertical-align:-4px;">Instagram</a>
                        <span style="color:#8fa696;">&nbsp;&nbsp;&bull;&nbsp;&nbsp;</span>
                        <a href="${LINKEDIN_URL}" style="color:#f3e8d3; text-decoration:none; font-weight:700; white-space:nowrap;"><img src="cid:${LINKEDIN_ICON_CID}" width="18" height="18" alt="" style="display:inline-block; width:18px; height:18px; margin:0 6px 0 0; border:0; vertical-align:-4px;">LinkedIn</a>
                      </p>
                    ` : ''}
                    <p style="margin:0; color:#f2c85b; font-size:13px; line-height:1.6;">
                      <a href="${PORTAL_URL}" style="color:${variant === 'welcome' ? '#ffffff' : '#f3e8d3'}; text-decoration:none; font-weight:700;">Open portal</a>
                      &nbsp;|&nbsp;
                      <a href="mailto:${REPLY_TO_EMAIL}" style="color:${variant === 'welcome' ? '#ffffff' : '#f3e8d3'}; text-decoration:none; font-weight:700;">${REPLY_TO_EMAIL}</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `.trim();
}

export function buildCustomerOrderEmailContent(payload: OrderEmailPayload) {
  const safeCustomerName = escapeHtml(payload.customerName || 'there');
  const orderedDate = formatEmailDate(payload.orderedAt);
  const productCount = payload.items.length;
  const productLabel = `${productCount.toLocaleString()} ${productCount === 1 ? 'product' : 'products'}`;
  const itemRows = payload.items
    .map((item, index) => `
      <tr>
        <td width="45%" style="width:45%; box-sizing:border-box; padding:14px 12px; ${index % 2 === 0 ? 'background:#f5fbf9;' : ''} ${index < payload.items.length - 1 ? 'border-bottom:1px solid #d5e6df;' : ''} color:#241a12; font-size:15px; font-weight:700; overflow-wrap:anywhere; word-break:break-word; word-wrap:break-word;">${escapeHtml(item.name)}</td>
        <td width="15%" align="center" style="width:15%; box-sizing:border-box; padding:14px 4px; ${index % 2 === 0 ? 'background:#f5fbf9;' : ''} ${index < payload.items.length - 1 ? 'border-bottom:1px solid #d5e6df;' : ''} color:#594736; font-size:14px; overflow-wrap:anywhere; word-break:break-all; word-wrap:break-word;">${item.qty}</td>
        <td width="40%" align="right" style="width:40%; box-sizing:border-box; padding:14px 8px; ${index % 2 === 0 ? 'background:#f5fbf9;' : ''} ${index < payload.items.length - 1 ? 'border-bottom:1px solid #d5e6df;' : ''} color:#241a12; font-size:15px; font-weight:700; overflow-wrap:anywhere; word-break:break-all; word-wrap:break-word;">${usd(item.line)}</td>
      </tr>
    `)
    .join('');

  const html = emailShell({
    eyebrow: 'Order received',
    logoSize: 64,
    preheader: `We have your Sobrew order ${payload.orderId}.`,
    showTextSocialFooter: true,
    title: 'We have your Sobrew order.',
    variant: 'order',
    body: `
      <tr>
        <td style="padding:30px 28px 10px 28px;">
          <p style="margin:0 0 14px 0; font-size:17px; line-height:1.55; color:#291f18;">Hi ${safeCustomerName},</p>
          <p style="margin:0; color:#594736; font-size:16px; line-height:1.65;">Thanks for the order. We are getting the coffee rounded up and will send a shipment email once it is on the road.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 28px 0 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fff0d0; border:1px solid #e5ca7f; border-radius:14px;">
            <tr>
              <td style="padding:16px 18px;">
                <p style="margin:0 0 7px 0; color:#241a12; font-size:15px; font-weight:800;">Turns out, a coffee order can do a lot.</p>
                <p style="margin:0; color:#594736; font-size:14px; line-height:1.6;">Every Sobrew order helps fund recovery. That means your coffee order does some good before the first cup is even poured. That's a lot of good packed into one order.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 28px 0 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5fbf9; border:1px solid #cbe2da; border-radius:14px;">
            <tr>
              <td style="padding:17px 18px 15px 18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="32" height="32" align="center" valign="middle" style="width:32px; height:32px; background:#4f7250; color:#ffffff; border-radius:50%; font-size:14px; font-weight:800;">1</td>
                    <td style="border-top:3px solid #f2c85b; font-size:1px; line-height:1px;">&nbsp;</td>
                    <td width="32" height="32" align="center" valign="middle" style="width:32px; height:32px; background:#f2c85b; color:#47331f; border-radius:50%; font-size:14px; font-weight:800;">2</td>
                    <td style="border-top:3px solid #84c7bf; font-size:1px; line-height:1px;">&nbsp;</td>
                    <td width="32" height="32" align="center" valign="middle" style="width:32px; height:32px; background:#84c7bf; color:#234640; border-radius:50%; font-size:14px; font-weight:800;">3</td>
                  </tr>
                  <tr>
                    <td colspan="5" style="padding-top:9px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td width="33.33%" align="left" style="color:#2f4f3b; font-size:11px; font-weight:800; text-transform:uppercase;">Received</td>
                          <td width="33.33%" align="center" style="color:#806144; font-size:11px; font-weight:700; text-transform:uppercase;">Preparing</td>
                          <td width="33.33%" align="right" style="color:#806144; font-size:11px; font-weight:700; text-transform:uppercase;">Shipped</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 28px 0 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; table-layout:fixed; background:#fff0dc; border:1px solid #f0cda0; border-radius:14px;">
            <tr>
              <td style="padding:18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; table-layout:fixed;">
                  <tr>
                    <td width="60%" valign="top" style="width:60%; box-sizing:border-box; padding-right:10px;">
                      <p style="margin:0 0 6px 0; color:#6b4c35; font-size:12px; font-weight:700; letter-spacing:1.8px; text-transform:uppercase;">Order summary</p>
                      <p style="margin:0; color:#241a12; font-size:22px; line-height:1.25; font-weight:800; overflow-wrap:anywhere; word-break:break-all; word-wrap:break-word;">Order ${escapeHtml(payload.orderId)}</p>
                    </td>
                    <td width="40%" align="right" valign="top" style="width:40%; box-sizing:border-box;">
                      <span style="display:inline-block; background:#e56f5a; color:#ffffff; border-radius:999px; padding:8px 9px; font-size:11px; font-weight:800; letter-spacing:0.8px; text-transform:uppercase; white-space:nowrap;">Confirmed</span>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding-top:16px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; table-layout:fixed;">
                        <tr>
                          <td width="32%" style="width:32%; box-sizing:border-box; padding:10px 7px; background:#fff3ca; border-radius:12px;">
                            <p style="margin:0 0 4px 0; color:#526037; font-size:11px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase;">Ordered</p>
                            <p style="margin:0; color:#241a12; font-size:14px; font-weight:700;">${orderedDate}</p>
                          </td>
                          <td width="2%" style="width:2%; font-size:1px; line-height:1px;">&nbsp;</td>
                          <td width="32%" style="width:32%; box-sizing:border-box; padding:10px 7px; background:#e5f4ef; border-radius:12px;">
                            <p style="margin:0 0 4px 0; color:#806144; font-size:11px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase;">Items</p>
                            <p style="margin:0; color:#241a12; font-size:14px; font-weight:700;">${productLabel}</p>
                          </td>
                          <td width="2%" style="width:2%; font-size:1px; line-height:1px;">&nbsp;</td>
                          <td width="32%" style="width:32%; box-sizing:border-box; padding:10px 7px; background:#fce6e0; border-radius:12px;">
                            <p style="margin:0 0 4px 0; color:#412713; font-size:11px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase;">Total</p>
                            <p style="margin:0; color:#241a12; font-size:14px; font-weight:800;">${usd(payload.subtotalCents)}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px 0 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; table-layout:fixed; border:1px solid #d5e6df; border-radius:14px; overflow:hidden;">
            <tr>
              <td width="45%" style="width:45%; box-sizing:border-box; background:#4f7250; color:#ffffff; padding:12px; font-size:13px; font-weight:800; letter-spacing:1.2px; text-transform:uppercase;">Items purchased</td>
              <td width="15%" align="center" style="width:15%; box-sizing:border-box; background:#4f7250; color:#ffffff; padding:12px 4px; font-size:12px; font-weight:800;">Qty</td>
              <td width="40%" align="right" style="width:40%; box-sizing:border-box; background:#4f7250; color:#ffffff; padding:12px 8px; font-size:12px; font-weight:800;">Line</td>
            </tr>
            ${itemRows}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 28px 0 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="color:#594736; font-size:14px;">Subtotal</td>
              <td align="right" style="color:#241a12; font-size:14px; font-weight:700;">${usd(payload.subtotalCents)}</td>
            </tr>
            <tr>
              <td style="padding-top:8px; color:#594736; font-size:14px;">Shipping</td>
              <td align="right" style="padding-top:8px; color:#4f7250; font-size:14px; font-weight:800;">Free</td>
            </tr>
            <tr>
              <td colspan="2" style="padding-top:14px; border-bottom:1px solid #d5e6df;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding-top:14px; color:#241a12; font-size:17px; font-weight:800;">Order total</td>
              <td align="right" style="padding-top:14px; color:#241a12; font-size:22px; font-weight:800;">${usd(payload.subtotalCents)}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#e7f5f1; border-left:5px solid #e56f5a; border-radius:12px;">
            <tr>
              <td style="padding:16px 18px;">
                <p style="margin:0 0 8px 0; color:#241a12; font-size:15px; font-weight:800;">Need to make a change?</p>
                <p style="margin:0; color:#594736; font-size:14px; line-height:1.6;">Reply to this email before your order is packed, and we'll take care of it.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `,
  });

  const text = [
    `Hi ${payload.customerName || 'there'},`,
    '',
    'Thanks for the order. We are getting the coffee rounded up and will send a shipment email once it is on the road.',
    '',
    'Turns out, a coffee order can do a lot.',
    "Every Sobrew order helps fund recovery. That means your coffee order does some good before the first cup is even poured. That's a lot of good packed into one order.",
    '',
    `Order ${payload.orderId}`,
    `Ordered: ${orderedDate}`,
    `Items: ${productLabel}`,
    '',
    ...payload.items.map((item) => `- ${item.name} | Qty ${item.qty} | ${usd(item.line)}`),
    '',
    `Subtotal: ${usd(payload.subtotalCents)}`,
    'Shipping: Free',
    `Order total: ${usd(payload.subtotalCents)}`,
    '',
    "Need to make a change? Reply to this email before your order is packed, and we'll take care of it.",
    '',
    ...TEXT_SOCIAL_FOOTER_LINES,
  ].join('\n');

  return { html, text };
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
      replyTo: REPLY_TO_EMAIL,
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
  const cc = await adminOrderCcForCenter(payload.centerId);

  try {
    const response = await resend.emails.send({
      from: RESEND_FROM,
      replyTo: REPLY_TO_EMAIL,
      to: ADMIN_EMAIL,
      ...(cc.length ? { cc } : {}),
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

  const { html, text } = buildCustomerOrderEmailContent(payload);

  try {
    const response = await resend.emails.send({
      from: RESEND_FROM,
      replyTo: REPLY_TO_EMAIL,
      to: recipients,
      subject: 'Thank You For Your Order!',
      html,
      text,
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

export function buildShippedEmailContent(
  items: ShippedLine[],
  trackingLines: TrackingLine[] = [],
  context: ShippedEmailContext = {},
) {
  const customerName = cleanEmailText(context.customerName) || 'there';
  const orderId = cleanEmailText(context.orderId) || 'Not available';
  const shippedDate = formatEmailDate(context.shippedAt);
  const itemRows = items
    .map((item, index) => `
      <tr>
        <td style="padding:14px 16px; ${index % 2 === 0 ? 'background:#f2faf7;' : ''} ${index < items.length - 1 ? 'border-bottom:1px solid #cbe2da;' : ''} color:#241a12; font-size:15px; font-weight:700;">${escapeHtml(item.name)}</td>
        <td align="center" style="padding:14px 16px; ${index % 2 === 0 ? 'background:#f2faf7;' : ''} ${index < items.length - 1 ? 'border-bottom:1px solid #cbe2da;' : ''} color:#594736; font-size:15px;">${item.qty}</td>
      </tr>
    `)
    .join('');
  const itemsHtml = itemRows || `
    <tr>
      <td colspan="2" style="padding:14px 16px; color:#594736; font-size:15px;">Unavailable</td>
    </tr>
  `;
  const validTrackingLines = normalizeShipmentTrackingLines(trackingLines);
  const trackingCards = validTrackingLines
    .map((tracking, index) => {
      const carrier = [tracking.carrier, tracking.service].map((value) => cleanEmailText(value)).filter(Boolean).join(' ');
      const trackingCode = escapeHtml(cleanEmailText(tracking.trackingCode));
      const trackingUrl = trackingUrlForLine(tracking);
      const safeTrackingUrl = escapeHtml(trackingUrl);
      const trackingButtonLabel = validTrackingLines.length > 1 ? `Track package ${index + 1}` : 'Track this shipment';
      const trackingLabel = carrier ? `${carrier} tracking number` : 'Tracking number';
      return `
        <tr>
          <td style="padding-top:${index === 0 ? '0' : '14px'};">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; table-layout:fixed;">
              <tr>
                <td style="padding:14px 16px; background:#ffffff; border-radius:12px;">
                  <p style="margin:0 0 5px 0; color:#806144; font-size:11px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase;">${escapeHtml(trackingLabel)}</p>
                  <p style="display:block; width:100%; max-width:100%; box-sizing:border-box; margin:0; color:#241a12; font-size:18px; font-weight:800; overflow-wrap:anywhere; word-break:break-all; word-wrap:break-word;">${trackingCode}</p>
                </td>
              </tr>
              ${trackingUrl ? `
                <tr>
                  <td style="padding-top:12px;">
                    <a href="${safeTrackingUrl}" style="display:block; background:#2f4f3b; border-radius:12px; color:#ffffff; font-size:15px; font-weight:800; padding:14px 18px; text-align:center; text-decoration:none;">${trackingButtonLabel}</a>
                  </td>
                </tr>
              ` : ''}
            </table>
          </td>
        </tr>
      `;
    })
    .join('');

  return emailShell({
    eyebrow: 'On the road',
    logoSize: 64,
    preheader: 'Your Sobrew order has shipped.',
    showTextSocialFooter: true,
    title: 'Your Sobrew order shipped.',
    variant: 'shipped',
    body: `
      <tr>
        <td style="padding:30px 28px 10px 28px;">
          <p style="margin:0 0 14px 0; color:#291f18; font-size:17px; line-height:1.55;">Hi ${escapeHtml(customerName)},</p>
          <p style="margin:0; color:#594736; font-size:16px; line-height:1.65;">Good news: your order is officially on the road. While the boxes make their way to you, your purchase is helping fund recovery back here. Not a bad little two-for-one. Tracking details are below.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 28px 0 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5fbf9; border:1px solid #cbe2da; border-radius:14px;">
            <tr>
              <td style="padding:17px 18px 15px 18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="32" height="32" align="center" valign="middle" style="width:32px; height:32px; background:#87a588; color:#ffffff; border-radius:50%; font-size:15px; font-weight:800;">&#10003;</td>
                    <td style="border-top:3px solid #87a588; font-size:1px; line-height:1px;">&nbsp;</td>
                    <td width="32" height="32" align="center" valign="middle" style="width:32px; height:32px; background:#87a588; color:#ffffff; border-radius:50%; font-size:15px; font-weight:800;">&#10003;</td>
                    <td style="border-top:3px solid #4f7250; font-size:1px; line-height:1px;">&nbsp;</td>
                    <td width="32" height="32" align="center" valign="middle" style="width:32px; height:32px; background:#4f7250; color:#ffffff; border-radius:50%; font-size:15px; font-weight:800;">&#10003;</td>
                  </tr>
                  <tr>
                    <td colspan="5" style="padding-top:9px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td width="33.33%" align="left" style="color:#806144; font-size:11px; font-weight:700; text-transform:uppercase;">Received</td>
                          <td width="33.33%" align="center" style="color:#806144; font-size:11px; font-weight:700; text-transform:uppercase;">Packed</td>
                          <td width="33.33%" align="right" style="color:#2f4f3b; font-size:11px; font-weight:800; text-transform:uppercase;">Shipped</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 28px 0 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; table-layout:fixed; background:#f7f3eb; border:1px solid #ded4c3; border-radius:14px;">
            <tr>
              <td style="padding:18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; table-layout:fixed;">
                  <tr>
                    <td width="60%" valign="top" style="width:60%; box-sizing:border-box; padding-right:10px;">
                      <p style="margin:0; color:#6b4c35; font-size:12px; font-weight:700; letter-spacing:1.8px; text-transform:uppercase;">Shipment status</p>
                    </td>
                    <td width="40%" align="right" valign="top" style="width:40%; box-sizing:border-box;">
                      <span style="display:inline-block; background:#4f7250; color:#ffffff; border-radius:999px; padding:8px 9px; font-size:11px; font-weight:800; letter-spacing:0.8px; text-transform:uppercase; white-space:nowrap;">In transit</span>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding-top:8px;">
                      <p style="margin:0; color:#241a12; font-size:22px; line-height:1.25; font-weight:800;">Packed and shipped</p>
                    </td>
                  </tr>
                  ${trackingCards ? `
                    <tr>
                      <td colspan="2" style="padding-top:18px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; table-layout:fixed;">
                          ${trackingCards}
                        </table>
                      </td>
                    </tr>
                  ` : `
                    <tr>
                      <td colspan="2" style="padding-top:16px; color:#594736; font-size:14px; line-height:1.6;">Tracking details will be shared by the carrier when available.</td>
                    </tr>
                  `}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px 0 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #cbe2da; border-radius:14px; overflow:hidden;">
            <tr>
              <td style="background:#4f7250; color:#ffffff; padding:12px 16px; font-size:13px; font-weight:800; letter-spacing:1.4px; text-transform:uppercase;">Items in this shipment</td>
              <td align="center" style="background:#4f7250; color:#ffffff; padding:12px 16px; font-size:13px; font-weight:800;">Qty</td>
            </tr>
            ${itemsHtml}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px 0 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="width:50%; padding:16px; background:#f5fbf9; border:1px solid #cbe2da; border-radius:14px;">
                <p style="margin:0 0 6px 0; color:#526037; font-size:11px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase;">Shipped</p>
                <p style="margin:0; color:#241a12; font-size:15px; line-height:1.45; font-weight:800;">${shippedDate}</p>
              </td>
              <td style="width:12px;">&nbsp;</td>
              <td style="width:50%; padding:16px; background:#f5fbf9; border:1px solid #cbe2da; border-radius:14px;">
                <p style="margin:0 0 6px 0; color:#806144; font-size:11px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase;">Order</p>
                <p style="margin:0; color:#241a12; font-size:15px; line-height:1.45; font-weight:800; word-break:break-word;">${escapeHtml(orderId)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fff7e8; border-left:5px solid #c6a15b; border-radius:12px;">
            <tr>
              <td style="padding:16px 18px;">
                <p style="margin:0 0 8px 0; color:#241a12; font-size:15px; font-weight:800;">Your coffee is on the way.</p>
                <p style="margin:0; color:#594736; font-size:14px; line-height:1.6;">Thanks for supporting Sobrew and the recovery programs your order helps fund. If anything doesn't look right when your shipment arrives, reply to this email and we'll take care of it.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `,
  });
}

export function buildShippedEmailText(
  items: ShippedLine[],
  trackingLines: TrackingLine[] = [],
  context: ShippedEmailContext = {},
) {
  const customerName = cleanEmailText(context.customerName) || 'there';
  const orderId = cleanEmailText(context.orderId) || 'Not available';
  const validTrackingLines = normalizeShipmentTrackingLines(trackingLines);
  const trackingText = validTrackingLines.length
    ? validTrackingLines.flatMap((tracking, index) => {
        const carrier = [tracking.carrier, tracking.service].map(cleanEmailText).filter(Boolean).join(' ');
        const label = validTrackingLines.length > 1 ? `Package ${index + 1}` : 'Shipment';
        const url = trackingUrlForLine(tracking);
        return [`${label}: ${carrier ? `${carrier} ` : ''}${cleanEmailText(tracking.trackingCode)}`, ...(url ? [`Track: ${url}`] : [])];
      })
    : ['Tracking details will be shared by the carrier when available.'];

  return [
    `Hi ${customerName},`,
    '',
    'Good news: your order is officially on the road. While the boxes make their way to you, your purchase is helping fund recovery back here. Not a bad little two-for-one.',
    '',
    ...trackingText,
    '',
    'Items in this shipment:',
    ...(items.length ? items.map((item) => `- ${item.name} | Qty ${item.qty}`) : ['- Unavailable']),
    '',
    `Shipped: ${formatEmailDate(context.shippedAt)}`,
    `Order: ${orderId}`,
    '',
    'Your coffee is on the way.',
    "Thanks for supporting Sobrew and the recovery programs your order helps fund. If anything doesn't look right when your shipment arrives, reply to this email and we'll take care of it.",
    '',
    ...TEXT_SOCIAL_FOOTER_LINES,
  ].join('\n');
}

function cleanEmailText(value: unknown) {
  return String(value ?? '').trim();
}

export function buildInvoicePdfEmailContent(payload: InvoicePdfEmailContentPayload) {
  const customerName = cleanEmailText(payload.customerName) || 'there';
  const invoiceNumber = cleanEmailText(payload.invoiceNumber) || 'your invoice';
  const safeName = escapeHtml(customerName);
  const safeInvoiceNumber = escapeHtml(invoiceNumber);
  const safeReplyTo = escapeHtml(REPLY_TO_EMAIL);
  const html = emailShell({
    eyebrow: 'Invoice attached',
    footerMessage: 'Funding recovery, one cup at a time.',
    preheader: `Your Sobrew invoice ${invoiceNumber} is attached as a PDF.`,
    showSocialFooter: true,
    title: 'Your Sobrew invoice is attached.',
    variant: 'invoice',
    body: `
      <tr>
        <td style="padding:30px 32px 10px 32px;">
          <p style="margin:0 0 14px 0; color:#291f18; font-size:17px; line-height:1.55;">Hi ${safeName},</p>
          <p style="margin:0; color:#594736; font-size:16px; line-height:1.65;">Thanks for your order. Your Sobrew invoice <strong style="color:#241a12;">${safeInvoiceNumber}</strong> is attached as a PDF.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 32px 0 32px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f4; border-left:4px solid #31563f; border-radius:6px;">
            <tr>
              <td style="padding:17px 19px;">
                <p style="margin:0 0 5px 0; color:#607265; font-size:11px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase;">Invoice</p>
                <p style="margin:0 0 10px 0; color:#26372c; font-size:23px; line-height:1.25; font-weight:800; word-break:break-word;">${safeInvoiceNumber}</p>
                <p style="margin:0; color:#526158; font-size:14px; line-height:1.6;">Please mail checks using the payment details listed on the invoice.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 0 32px;">
          <p style="margin:0 0 7px 0; color:#26372c; font-size:15px; font-weight:800;">Questions or adjustments?</p>
          <p style="margin:0; color:#594736; font-size:14px; line-height:1.65;">Reply to this email or reach us at <a href="mailto:${safeReplyTo}" style="color:#31563f; font-weight:700; text-decoration:none;">${safeReplyTo}</a> and we will take care of it.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:26px 32px 30px 32px;">
          <p style="margin:0 0 14px 0; color:#594736; font-size:15px; line-height:1.65;">Thank you for your partnership.</p>
          <p style="margin:0; color:#291f18; font-size:15px; line-height:1.65;">Best,<br />The Sobrew Team</p>
        </td>
      </tr>
    `,
  });
  const text = [
    `Hi ${customerName},`,
    '',
    `Thanks for your order. Your Sobrew invoice ${invoiceNumber} is attached as a PDF.`,
    '',
    'Please mail checks using the payment details listed on the invoice.',
    `If you have any questions or need anything adjusted, just reply to this email or reach us at ${REPLY_TO_EMAIL} and we will take care of it.`,
    '',
    'Stay connected:',
    `Website: ${WEBSITE_URL}`,
    `Instagram: ${INSTAGRAM_URL}`,
    `LinkedIn: ${LINKEDIN_URL}`,
    '',
    'Thank you for your partnership.',
    '',
    'Best,',
    'The Sobrew Team',
  ].join('\n');

  return { html, text };
}

export function buildPaymentReceiptEmailContent(payload: PaymentReceiptEmailContentPayload) {
  const customerName = cleanEmailText(payload.customerName) || 'there';
  const invoiceNumber = cleanEmailText(payload.invoiceNumber) || 'your invoice';
  const paymentMethodLabel = cleanEmailText(payload.paymentMethodLabel) || 'saved payment method';
  const paymentStatus = cleanEmailText(payload.paymentStatus).toUpperCase() || 'SUBMITTED';
  const amount = usd(Math.round(payload.amountCents));
  const isPending = paymentStatus === 'PENDING' || payload.paymentMethodType === 'bank_account' || payload.paymentMethodType === 'echeck';
  const actionLabel = isPending ? 'Payment submitted' : 'Payment received';
  const statusLine = isPending
    ? `Your ${paymentMethodLabel} payment for ${amount} was submitted. QuickBooks status: ${paymentStatus}.`
    : `Your ${paymentMethodLabel} was charged ${amount}.`;
  const safeName = escapeHtml(customerName);
  const safeInvoiceNumber = escapeHtml(invoiceNumber);
  const safePaymentMethodLabel = escapeHtml(paymentMethodLabel);
  const safeAmount = escapeHtml(amount);
  const safeStatus = escapeHtml(paymentStatus);
  const safeStatusLine = escapeHtml(statusLine);
  const safeReplyTo = escapeHtml(REPLY_TO_EMAIL);
  const html = emailShell({
    eyebrow: actionLabel,
    footerMessage: 'Funding recovery, one cup at a time.',
    preheader: `Sobrew receipt ${invoiceNumber}: ${amount}.`,
    showSocialFooter: true,
    title: isPending ? 'Your Sobrew payment was submitted.' : 'Your Sobrew payment is complete.',
    variant: 'invoice',
    body: `
      <tr>
        <td style="padding:30px 32px 10px 32px;">
          <p style="margin:0 0 14px 0; color:#291f18; font-size:17px; line-height:1.55;">Hi ${safeName},</p>
          <p style="margin:0; color:#594736; font-size:16px; line-height:1.65;">${safeStatusLine} A receipt copy of Sobrew invoice <strong style="color:#241a12;">${safeInvoiceNumber}</strong> is attached.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 32px 0 32px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f4; border-left:4px solid #31563f; border-radius:6px;">
            <tr>
              <td style="padding:17px 19px;">
                <p style="margin:0 0 5px 0; color:#607265; font-size:11px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase;">Receipt</p>
                <p style="margin:0 0 10px 0; color:#26372c; font-size:23px; line-height:1.25; font-weight:800; word-break:break-word;">${safeAmount}</p>
                <p style="margin:0; color:#526158; font-size:14px; line-height:1.6;">${safePaymentMethodLabel} · QuickBooks status ${safeStatus}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 0 32px;">
          <p style="margin:0 0 7px 0; color:#26372c; font-size:15px; font-weight:800;">Questions or adjustments?</p>
          <p style="margin:0; color:#594736; font-size:14px; line-height:1.65;">Reply to this email or reach us at <a href="mailto:${safeReplyTo}" style="color:#31563f; font-weight:700; text-decoration:none;">${safeReplyTo}</a> and we will take care of it.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:26px 32px 30px 32px;">
          <p style="margin:0 0 14px 0; color:#594736; font-size:15px; line-height:1.65;">Thank you for your partnership.</p>
          <p style="margin:0; color:#291f18; font-size:15px; line-height:1.65;">Best,<br />The Sobrew Team</p>
        </td>
      </tr>
    `,
  });
  const text = [
    `Hi ${customerName},`,
    '',
    `${statusLine} A receipt copy of Sobrew invoice ${invoiceNumber} is attached.`,
    '',
    `Receipt amount: ${amount}`,
    `Payment method: ${paymentMethodLabel}`,
    `QuickBooks status: ${paymentStatus}`,
    `If you have any questions or need anything adjusted, just reply to this email or reach us at ${REPLY_TO_EMAIL} and we will take care of it.`,
    '',
    'Stay connected:',
    `Website: ${WEBSITE_URL}`,
    `Instagram: ${INSTAGRAM_URL}`,
    `LinkedIn: ${LINKEDIN_URL}`,
    '',
    'Thank you for your partnership.',
    '',
    'Best,',
    'The Sobrew Team',
  ].join('\n');

  return { html, text };
}

export async function sendShippedEmail(
  to: string | string[] | null | undefined,
  items: ShippedLine[],
  trackingLines: TrackingLine[] = [],
  context: ShippedEmailContext = {},
) {
  const resend = getResend();
  if (!resend) {
    console.error('Resend disabled: missing RESEND_API_KEY');
    return;
  }

  const recipients = outgoingEmailRecipients(to);
  if (!recipients.to.length) {
    console.error('Shipped email skipped: missing recipient');
    return;
  }

  const html = buildShippedEmailContent(items, trackingLines, context);
  const text = buildShippedEmailText(items, trackingLines, context);

  try {
    const response = await resend.emails.send({
      from: RESEND_FROM,
      replyTo: REPLY_TO_EMAIL,
      to: recipients.to,
      subject: 'Your Order Has Been Shipped!',
      html,
      text,
    });
    console.log('Shipped email sent', response);
  } catch (error) {
    console.error('Failed to send shipped email', error);
  }
}

export async function sendInvoicePdfEmail(payload: InvoicePdfEmailPayload): Promise<SendEmailResult> {
  const resend = getResend();
  if (!resend) {
    const error = new Error('Resend disabled: missing RESEND_API_KEY');
    console.error(error.message);
    return { error, ok: false };
  }

  const recipients = outgoingEmailRecipients(payload.to, payload.cc);
  if (!recipients.to.length) {
    const error = new Error('Invoice PDF email skipped: missing recipient');
    console.error(error.message);
    return { error, ok: false };
  }

  const attachmentInvoiceNumber = payload.invoiceNumber.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const { html, text } = buildInvoicePdfEmailContent({
    customerName: payload.customerName,
    invoiceNumber: payload.invoiceNumber,
  });

  try {
    const response = await resend.emails.send({
      attachments: [
        {
          content: payload.pdf,
          contentType: 'application/pdf',
          filename: `Sobrew-Invoice-${attachmentInvoiceNumber || payload.orderId.slice(0, 8)}.pdf`,
        },
        {
          content: Buffer.from(INSTAGRAM_ICON_BASE64, 'base64'),
          contentType: 'image/png',
          filename: 'sobrew-instagram.png',
          inlineContentId: INSTAGRAM_ICON_CID,
        },
        {
          content: Buffer.from(LINKEDIN_ICON_BASE64, 'base64'),
          contentType: 'image/png',
          filename: 'sobrew-linkedin.png',
          inlineContentId: LINKEDIN_ICON_CID,
        },
      ],
      from: RESEND_FROM,
      replyTo: REPLY_TO_EMAIL,
      ...(recipients.cc.length ? { cc: recipients.cc } : {}),
      to: recipients.to,
      subject: `Sobrew Invoice ${payload.invoiceNumber}`,
      html,
      text,
    });
    console.log('Invoice PDF email sent', response);
    return { ok: true };
  } catch (error) {
    console.error('Failed to send invoice PDF email', error);
    return { error, ok: false };
  }
}

export async function sendPaymentReceiptEmail(payload: PaymentReceiptEmailPayload): Promise<SendEmailResult> {
  const resend = getResend();
  if (!resend) {
    const error = new Error('Resend disabled: missing RESEND_API_KEY');
    console.error(error.message);
    return { error, ok: false };
  }

  const recipients = outgoingEmailRecipients(payload.to, payload.cc);
  if (!recipients.to.length) {
    const error = new Error('Payment receipt email skipped: missing recipient');
    console.error(error.message);
    return { error, ok: false };
  }

  const attachmentInvoiceNumber = payload.invoiceNumber.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const { html, text } = buildPaymentReceiptEmailContent({
    amountCents: payload.amountCents,
    customerName: payload.customerName,
    invoiceNumber: payload.invoiceNumber,
    paymentMethodLabel: payload.paymentMethodLabel,
    paymentMethodType: payload.paymentMethodType,
    paymentStatus: payload.paymentStatus,
  });

  try {
    const response = await resend.emails.send({
      attachments: [
        {
          content: payload.pdf,
          contentType: 'application/pdf',
          filename: `Sobrew-Receipt-${attachmentInvoiceNumber || payload.orderId.slice(0, 8)}.pdf`,
        },
        {
          content: Buffer.from(INSTAGRAM_ICON_BASE64, 'base64'),
          contentType: 'image/png',
          filename: 'sobrew-instagram.png',
          inlineContentId: INSTAGRAM_ICON_CID,
        },
        {
          content: Buffer.from(LINKEDIN_ICON_BASE64, 'base64'),
          contentType: 'image/png',
          filename: 'sobrew-linkedin.png',
          inlineContentId: LINKEDIN_ICON_CID,
        },
      ],
      from: RESEND_FROM,
      replyTo: REPLY_TO_EMAIL,
      ...(recipients.cc.length ? { cc: recipients.cc } : {}),
      to: recipients.to,
      subject: `Sobrew Receipt ${payload.invoiceNumber}`,
      html,
      text,
    });
    console.log('Payment receipt email sent', response);
    return { ok: true };
  } catch (error) {
    console.error('Failed to send payment receipt email', error);
    return { error, ok: false };
  }
}
