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
    : `${item.packLabel} — ${money(priceCents)}`;
}

// Repeat typography on text-bearing elements: email clients and portal CSS reset inheritance differently.
const EMAIL_TEXT_STYLE = 'font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#202124;';
const EMAIL_CELL_STYLE = `${EMAIL_TEXT_STYLE}font-weight:400;margin:0;padding:0;border:0;text-align:left;vertical-align:top;`;
const EMAIL_PARAGRAPH_STYLE = `${EMAIL_TEXT_STYLE}font-weight:400;margin:0;padding:0;`;

function emailStrong(value: string) {
  return `<strong style="${EMAIL_TEXT_STYLE}font-weight:700;margin:0;padding:0;">${escapeHtml(value)}</strong>`;
}

/** contentHtml is composed only from escaped text and the helpers in this module. */
function emailRow(contentHtml: string, bottom = 18, top = 0) {
  return `<tr><td style="${EMAIL_CELL_STYLE}padding-top:${top}px;padding-bottom:${bottom}px;"><p style="${EMAIL_PARAGRAPH_STYLE}">${contentHtml}</p></td></tr>`;
}

function emailTable(rows: string[]) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border:0;border-collapse:collapse;table-layout:fixed;margin:0;padding:0;"><tbody>${rows.join('\n')}</tbody></table>`;
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
  const introduction = 'Thanks for your interest in Sobrew Coffee! Looking forward to y’all trying the coffee.';
  const pricingIntroduction = 'Please find your coffee pricing below.';
  const mission = 'A portion of every order goes back to helping recovery and mental health-focused organizations!';
  const login = 'To place an order, we’ll create a login for you on our online ordering portal.';
  const portalIntroduction = 'We built this to make ordering as simple and hands-off as possible. Most of our partners love the ability to ';
  const portalEmphasis = 'set it and forget it:';
  const benefits = [
    { before: '', emphasis: 'Set up recurring orders', after: ' so you never run out' },
    { before: '', emphasis: 'Adjust frequency or quantities anytime', after: ' as your needs change' },
    { before: '', emphasis: 'Reorder in seconds', after: ' from past purchases' },
    { before: 'Access your ', emphasis: 'full catalog of products', after: ' in one place' },
  ];
  const convenience = 'No more last-minute orders or back-and-forth; just consistent delivery on your terms.';
  const closing = 'I’d love to hear your thoughts once you’ve had a chance to try everything!';
  const priceText: string[] = [];
  const priceHtml: string[] = [];
  const selected = validated.lines.map(line => ({ item: SAMPLE_QUOTE_ITEMS.find(candidate => candidate.id === line.id)!, priceCents: line.priceCents }));
  let lastCategory = '';
  let lastDescription = '';
  for (const [index, { item, priceCents }] of selected.entries()) {
    if (item.category !== lastCategory) {
      if (lastCategory) priceText.push('');
      priceText.push(item.category);
      priceHtml.push(emailRow(emailStrong(item.category), 6, lastCategory ? 6 : 0));
      lastCategory = item.category;
      lastDescription = '';
    }
    if (item.description !== lastDescription) {
      if (lastDescription) priceText.push('');
      priceText.push(item.description);
      priceHtml.push(emailRow(escapeHtml(item.description), 3));
      lastDescription = item.description;
    }
    const price = formatSampleQuotePrice(item, priceCents);
    priceText.push(`- ${price}`);
    const nextItem = selected[index + 1]?.item;
    const endsGroup = !nextItem || nextItem.category !== item.category || nextItem.description !== item.description;
    const formattedPrice = item.pounds ? emailStrong(price) : `${escapeHtml(item.packLabel)} — ${emailStrong(money(priceCents))}`;
    priceHtml.push(emailRow(formattedPrice, endsGroup ? 18 : 3));
  }
  const text = [
    greeting,
    introduction,
    `Samples Tracking:\n${validated.trackingNumber}`,
    pricingIntroduction,
    priceText.join('\n'),
    mission,
    'Ordering is simple',
    login,
    `${portalIntroduction}${portalEmphasis}`,
    benefits.map(benefit => `- ${benefit.before}${benefit.emphasis}${benefit.after}`).join('\n'),
    convenience,
    closing,
    `Best,\n${senderName}`,
  ].join('\n\n');
  const benefitRows = benefits.map(benefit => `<tr><td width="18" style="${EMAIL_CELL_STYLE}width:18px;padding-bottom:5px;">•</td><td style="${EMAIL_CELL_STYLE}padding-bottom:5px;">${escapeHtml(benefit.before)}${emailStrong(benefit.emphasis)}${escapeHtml(benefit.after)}</td></tr>`);
  const html = `<div style="${EMAIL_TEXT_STYLE}font-weight:400;max-width:600px;margin:0;padding:0;">${emailTable([
    emailRow(escapeHtml(greeting)),
    emailRow(escapeHtml(introduction)),
    emailRow(`${emailStrong('Samples Tracking:')}<br /><span style="${EMAIL_TEXT_STYLE}font-weight:400;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(validated.trackingNumber)}</span>`),
    emailRow(escapeHtml(pricingIntroduction)),
    ...priceHtml,
    emailRow(emailStrong(mission)),
    emailRow(emailStrong('Ordering is simple'), 6),
    emailRow(escapeHtml(login)),
    emailRow(`${escapeHtml(portalIntroduction)}${emailStrong(portalEmphasis)}`),
    `<tr><td style="${EMAIL_CELL_STYLE}padding-bottom:18px;">${emailTable(benefitRows)}</td></tr>`,
    emailRow(escapeHtml(convenience)),
    emailRow(escapeHtml(closing)),
    emailRow(`Best,<br />${escapeHtml(senderName)}`, 0),
  ])}</div>`;
  return { subject: 'Sobrew Coffee Samples, Pricing, and Ordering Process', text, html };
}
