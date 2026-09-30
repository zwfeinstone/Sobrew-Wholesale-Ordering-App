export type SampleQuoteItem = {
  id: string;
  category: string;
  description: string;
  packLabel: string;
  defaultPriceCents: number;
  pounds?: number;
};

export const SAMPLE_QUOTE_ITEMS: readonly SampleQuoteItem[] = [
  { id: 'bulk-regular', category: 'Bulk Coffee (5lb bags)', description: 'Medium or Dark Roast (Ground)', packLabel: 'per bag', defaultPriceCents: 4000, pounds: 5 },
  { id: 'bulk-decaf', category: 'Bulk Coffee (5lb bags)', description: 'Decaf Dark Roast', packLabel: 'per bag', defaultPriceCents: 4800, pounds: 5 },
  { id: 'fraction-1-5oz', category: 'Fraction Pack', description: 'Medium, Dark, Espresso, or French Roast (Ground)', packLabel: '100 x 1.5oz', defaultPriceCents: 9000 },
  { id: 'fraction-2oz', category: 'Fraction Pack', description: 'Medium, Dark, Espresso, or French Roast (Ground)', packLabel: '100 x 2oz', defaultPriceCents: 11500 },
  { id: 'fraction-2-5oz', category: 'Fraction Pack', description: 'Medium, Dark, Espresso, or French Roast (Ground)', packLabel: '100 x 2.5oz', defaultPriceCents: 14000 },
  { id: 'fraction-3oz', category: 'Fraction Pack', description: 'Medium, Dark, Espresso, or French Roast (Ground)', packLabel: '100 x 3oz', defaultPriceCents: 17000 },
  { id: 'fraction-decaf', category: 'Fraction Pack', description: 'Decaf Roast', packLabel: '100 x 1.5oz', defaultPriceCents: 11500 },
  { id: 'filter-1-5oz', category: 'Filter Pack', description: 'Medium, Dark, Espresso, or French Roast (Ground)', packLabel: '40 x 1.5oz', defaultPriceCents: 4900 },
  { id: 'filter-2oz', category: 'Filter Pack', description: 'Medium, Dark, Espresso, or French Roast (Ground)', packLabel: '40 x 2oz', defaultPriceCents: 5500 },
  { id: 'k-cups-regular', category: 'K Cups', description: 'Medium, Dark, Espresso, or French Roast', packLabel: '50ct', defaultPriceCents: 4000 },
  { id: 'k-cups-fourth-dimension', category: 'K Cups', description: 'Specialty Fourth Dimension Medium Roast', packLabel: '50ct', defaultPriceCents: 5000 },
];

export type SampleQuoteLine = { id: string; priceCents: number };

type SampleQuoteValidation =
  | { ok: true; trackingNumber: string; lines: SampleQuoteLine[] }
  | { ok: false; error: string };

/** Treat submitted pricing as untrusted; descriptions and units always come from the catalog. */
export function validateSampleQuoteInput(tracking: string, lines: unknown): SampleQuoteValidation {
  const trackingNumber = typeof tracking === 'string' ? tracking.trim() : '';
  if (!trackingNumber || trackingNumber.length > 120 || !/^[a-z0-9][a-z0-9 -]*$/i.test(trackingNumber)) {
    return { ok: false, error: 'Enter a valid sample tracking number using letters, numbers, spaces, or hyphens (up to 120 characters).' };
  }
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > SAMPLE_QUOTE_ITEMS.length) {
    return { ok: false, error: 'Select at least one coffee item to include in the quote.' };
  }
  const selected = new Map<string, number>();
  for (const line of lines) {
    if (!line || typeof line !== 'object' || typeof line.id !== 'string' || !SAMPLE_QUOTE_ITEMS.some(item => item.id === line.id)) {
      return { ok: false, error: 'The quote includes an unknown item. Refresh the page and select the items again.' };
    }
    if (selected.has(line.id)) return { ok: false, error: 'Each coffee item can appear only once in the quote.' };
    if (typeof line.priceCents !== 'number' || !Number.isSafeInteger(line.priceCents) || line.priceCents <= 0) {
      return { ok: false, error: 'Enter a price greater than $0.00 with no more than two decimal places for each selected item.' };
    }
    selected.set(line.id, line.priceCents);
  }
  return {
    ok: true,
    trackingNumber,
    lines: SAMPLE_QUOTE_ITEMS.filter(item => selected.has(item.id)).map(item => ({ id: item.id, priceCents: selected.get(item.id)! })),
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatSampleQuotePrice(item: SampleQuoteItem, priceCents: number) {
  return item.pounds
    ? `${money(priceCents)} ${item.packLabel} (${money(priceCents / item.pounds)}/lb)`
    : `${item.packLabel} - ${money(priceCents)}`;
}

export function buildSampleQuoteEmail(input: {
  contactName: string;
  senderName: string;
  trackingNumber: string;
  lines: SampleQuoteLine[];
}): { subject: string; text: string; html: string } {
  const validated = validateSampleQuoteInput(input.trackingNumber, input.lines);
  if (!validated.ok) throw new Error(validated.error);
  const firstName = input.contactName.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName}!` : 'Hi!';
  const senderName = input.senderName.trim() || 'The Sobrew Coffee Team';
  const introduction = "Thanks for your interest in Sobrew Coffee! We're looking forward to you trying the coffee.";
  const pricingIntroduction = 'Please find our coffee pricing below.';
  const mission = 'A portion of every order goes back to helping recovery and mental health-focused organizations!';
  const login = 'To place an order, we will create a login for you on our online ordering portal.';
  const portal = 'We built this to make ordering as simple and hands-off as possible. Most of our partners love the ability to set it and forget it:';
  const benefits = [
    'Set up recurring orders so you never run out',
    'Adjust frequency or quantities anytime as your needs change',
    'Reorder in seconds from past purchases',
    'Access your full catalog of products in one place',
  ];
  const convenience = 'No more last-minute orders or back-and-forth; just consistent delivery on your terms.';
  const closing = "I'd love to hear your thoughts on everything when you are ready.";
  const priceText: string[] = [];
  const priceHtml: string[] = [];
  let lastCategory = '';
  let lastDescription = '';
  for (const line of validated.lines) {
    const item = SAMPLE_QUOTE_ITEMS.find(candidate => candidate.id === line.id)!;
    if (item.category !== lastCategory) {
      priceText.push(item.category);
      priceHtml.push(`<h2 style="font-size:18px;margin:24px 0 8px">${escapeHtml(item.category)}</h2>`);
      lastCategory = item.category;
      lastDescription = '';
    }
    if (item.description !== lastDescription) {
      priceText.push(item.description);
      priceHtml.push(`<p style="margin:12px 0 4px">${escapeHtml(item.description)}</p>`);
      lastDescription = item.description;
    }
    const price = formatSampleQuotePrice(item, line.priceCents);
    priceText.push(`- ${price}`);
    priceHtml.push(`<p style="margin:4px 0 4px 16px"><strong>${escapeHtml(price)}</strong></p>`);
  }
  const text = [
    greeting,
    introduction,
    `Samples Tracking: ${validated.trackingNumber}`,
    pricingIntroduction,
    priceText.join('\n'),
    mission,
    'Ordering is simple:',
    login,
    portal,
    benefits.map(benefit => `- ${benefit}`).join('\n'),
    convenience,
    closing,
    `Best,\n${senderName}`,
  ].join('\n\n');
  const paragraph = (value: string) => `<p>${escapeHtml(value)}</p>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:640px">${[
    paragraph(greeting),
    paragraph(introduction),
    `<p><strong>Samples Tracking:</strong> ${escapeHtml(validated.trackingNumber)}</p>`,
    paragraph(pricingIntroduction),
    ...priceHtml,
    `<p><strong>${escapeHtml(mission)}</strong></p>`,
    paragraph('Ordering is simple:'),
    paragraph(login),
    paragraph(portal),
    `<ul>${benefits.map(benefit => `<li>${escapeHtml(benefit)}</li>`).join('')}</ul>`,
    paragraph(convenience),
    paragraph(closing),
    `<p>Best,<br />${escapeHtml(senderName)}</p>`,
  ].join('\n')}</div>`;
  return { subject: 'Sobrew Coffee Samples, Pricing, and Ordering Process', text, html };
}
