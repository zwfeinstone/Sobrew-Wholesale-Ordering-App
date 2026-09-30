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

export function getSampleQuoteGreetingName(contactName: string): string {
  return contactName.trim().split(/\s+/)[0] || '';
}

export function validateSampleQuoteGreetingName(value: unknown): { ok: true; greetingName: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) {
    return { ok: false, error: 'Enter a greeting name without control characters or line breaks.' };
  }
  const greetingName = value.trim();
  if (!greetingName || greetingName.length > 120) {
    return { ok: false, error: 'Enter a greeting name between 1 and 120 characters.' };
  }
  return { ok: true, greetingName };
}

const EMAIL_COLORS = { ink: '#202925', muted: '#66716b', paper: '#ffffff', line: '#dce3de', soft: '#f3f6f3', green: '#254f3e', warm: '#f8f5ed', forest: '#234435' };

// Repeat typography on text-bearing elements so email clients and portal CSS cannot change it.
function emailTextStyle(size = 15, lineHeight = 24, color = EMAIL_COLORS.ink, weight = 400) {
  return `font-family:Arial,Helvetica,sans-serif;font-size:${size}px;line-height:${lineHeight}px;font-weight:${weight};color:${color};margin:0;padding:0;overflow-wrap:anywhere;word-break:break-word;`;
}

const EMAIL_CELL_STYLE = `${emailTextStyle()}border:0;text-align:left;vertical-align:top;`;
const EMAIL_TABLE_STYLE = 'width:100%;border:0;border-collapse:collapse;table-layout:fixed;margin:0;padding:0;';

function emailStrong(value: string, size = 15, lineHeight = 24, color = EMAIL_COLORS.ink, extraStyle = '') {
  return `<strong style="${emailTextStyle(size, lineHeight, color, 700)}${extraStyle}">${escapeHtml(value)}</strong>`;
}

/** contentHtml is composed only from escaped text and the helpers in this module. */
function emailRow(contentHtml: string, bottom = 18, textStyle = emailTextStyle(), paragraphAttributes = '') {
  return `<tr><td style="${EMAIL_CELL_STYLE}padding-bottom:${bottom}px;"><p${paragraphAttributes} style="${textStyle}">${contentHtml}</p></td></tr>`;
}

function emailTable(rows: string[]) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${EMAIL_TABLE_STYLE}"><tbody>${rows.join('\n')}</tbody></table>`;
}

export function buildSampleQuoteEmail(input: {
  contactName: string;
  senderName: string;
  trackingNumber: string;
  lines: SampleQuoteLine[];
  greetingName?: string;
}): { subject: string; text: string; html: string } {
  const validated = validateSampleQuoteInput(input.trackingNumber, input.lines);
  if (!validated.ok) throw new Error(validated.error);
  const providedGreeting = input.greetingName === undefined ? null : validateSampleQuoteGreetingName(input.greetingName);
  if (providedGreeting && !providedGreeting.ok) throw new Error(providedGreeting.error);
  const greetingName = providedGreeting?.ok ? providedGreeting.greetingName : getSampleQuoteGreetingName(input.contactName);
  const greeting = greetingName ? `Hi ${greetingName}!` : 'Hi!';
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
  const selected = validated.lines.map(line => ({ item: SAMPLE_QUOTE_ITEMS.find(candidate => candidate.id === line.id)!, priceCents: line.priceCents }));
  const categories: Array<{ title: string; groups: Array<{ description: string; selections: typeof selected }> }> = [];
  let lastCategory = '';
  let lastDescription = '';
  for (const { item, priceCents } of selected) {
    if (item.category !== lastCategory) {
      if (lastCategory) priceText.push('');
      priceText.push(item.category);
      categories.push({ title: item.category, groups: [] });
      lastCategory = item.category;
      lastDescription = '';
    }
    if (item.description !== lastDescription) {
      if (lastDescription) priceText.push('');
      priceText.push(item.description);
      categories[categories.length - 1].groups.push({ description: item.description, selections: [] });
      lastDescription = item.description;
    }
    priceText.push(`- ${formatSampleQuotePrice(item, priceCents)}`);
    const groups = categories[categories.length - 1].groups;
    groups[groups.length - 1].selections.push({ item, priceCents });
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
  const categoryCards = categories.map((category, categoryIndex) => {
    const cardRows = [
      `<tr><td colspan="2" style="${EMAIL_CELL_STYLE}padding-bottom:12px;"><h2 data-email-category-title style="${emailTextStyle(16, 23, EMAIL_COLORS.green, 700)}padding-bottom:10px;border-bottom:1px solid ${EMAIL_COLORS.line};">${escapeHtml(category.title)}</h2></td></tr>`,
      ...category.groups.flatMap((group, groupIndex) => [
        `<tr><td colspan="2" style="${EMAIL_CELL_STYLE}padding-top:${groupIndex ? 13 : 0}px;padding-bottom:4px;"><p style="${emailTextStyle(14, 21, EMAIL_COLORS.muted)}">${escapeHtml(group.description)}</p></td></tr>`,
        ...group.selections.map(({ item, priceCents }) => item.pounds
          ? `<tr data-email-quote-item="${escapeHtml(item.id)}"><td colspan="2" style="${EMAIL_CELL_STYLE}padding:5px 0;">${emailStrong(formatSampleQuotePrice(item, priceCents), 14, 22)}</td></tr>`
          : `<tr data-email-quote-item="${escapeHtml(item.id)}"><td style="${emailTextStyle(14, 22)}border:0;text-align:left;vertical-align:top;padding:5px 8px 5px 0;">${escapeHtml(item.packLabel)}</td><td width="84" style="${emailTextStyle(14, 22)}width:84px;border:0;text-align:right;vertical-align:top;padding:5px 0;">${emailStrong(money(priceCents), 14, 22, EMAIL_COLORS.ink, 'font-variant-numeric:tabular-nums;')}</td></tr>`),
      ]),
    ];
    return `<tr><td style="${EMAIL_CELL_STYLE}padding-bottom:${categoryIndex === categories.length - 1 ? 22 : 12}px;">${emailTable([
      `<tr><td data-email-section="category" bgcolor="${EMAIL_COLORS.paper}" style="${EMAIL_CELL_STYLE}padding:19px 20px;background-color:${EMAIL_COLORS.paper};border-radius:8px;">${emailTable(cardRows)}</td></tr>`,
    ])}</td></tr>`;
  });

  // Fluid hybrid columns wrap without media-query support. Outlook desktop gets equivalent table columns.
  const benefitColumns = benefits.map((benefit, index) => `${index % 2 === 0 ? `<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${EMAIL_TABLE_STYLE}"><tr><![endif]-->` : ''}<!--[if mso]><td width="318" valign="top" style="${EMAIL_CELL_STYLE}width:318px;"><![endif]--><div data-email-benefit class="sobrew-email-benefit" style="display:inline-block;vertical-align:top;width:100%;max-width:318px;">${emailTable([
    `<tr><td style="${EMAIL_CELL_STYLE}padding-right:20px;">${emailTable([
      `<tr><td style="${emailTextStyle(14, 22)}text-align:left;vertical-align:top;border-top:1px solid ${EMAIL_COLORS.line};padding:11px 0 8px;">${escapeHtml(benefit.before)}${emailStrong(benefit.emphasis, 14, 22, EMAIL_COLORS.green, 'display:block;')}${escapeHtml(benefit.after)}</td></tr>`,
    ])}</td></tr>`,
  ])}</div><!--[if mso]></td><![endif]-->${index % 2 === 1 ? '<!--[if mso]></tr></table><![endif]-->' : ''}`).join('');

  const header = emailTable([
    `<tr><td class="sobrew-email-masthead-cell" style="${EMAIL_CELL_STYLE}padding-bottom:24px;"><p style="${emailTextStyle(19, 24, '#ffffff', 700)}letter-spacing:3px;">SOBREW<br /><span style="${emailTextStyle(10, 16, '#ffffff')}letter-spacing:2.7px;">COFFEE</span></p></td><td class="sobrew-email-masthead-cell" style="${EMAIL_CELL_STYLE}padding-bottom:24px;text-align:right;vertical-align:middle;"><p style="${emailTextStyle(11, 17, '#ffffff', 600)}text-transform:uppercase;letter-spacing:1.8px;">Your coffee quote</p></td></tr>`,
    `<tr><td colspan="2" style="${EMAIL_CELL_STYLE}"><h1 data-email-title style="font-family:Georgia,'Times New Roman',serif;font-size:31px;line-height:37px;font-weight:400;letter-spacing:-0.5px;color:#ffffff;max-width:340px;margin:0;padding:0;">Samples, pricing &amp; simple ordering.</h1></td></tr>`,
  ]);
  const body = emailTable([
    emailRow(escapeHtml(greeting), 18, emailTextStyle(15, 24, EMAIL_COLORS.ink, 600), ' data-email-greeting'),
    emailRow(escapeHtml(introduction)),
    `<tr><td style="${EMAIL_CELL_STYLE}padding-top:5px;padding-bottom:23px;">${emailTable([
      `<tr><td data-email-section="tracking" bgcolor="${EMAIL_COLORS.paper}" style="${EMAIL_CELL_STYLE}padding:15px 18px;background-color:${EMAIL_COLORS.paper};border-radius:7px;"><p style="${emailTextStyle(12, 24, EMAIL_COLORS.muted, 600)}padding-bottom:2px;">Samples Tracking:</p><p style="${emailTextStyle(16, 24, EMAIL_COLORS.green, 600)}letter-spacing:0.3px;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(validated.trackingNumber)}</p></td></tr>`,
    ])}</td></tr>`,
    emailRow(escapeHtml(pricingIntroduction)),
    ...categoryCards,
    `<tr><td style="${EMAIL_CELL_STYLE}padding-bottom:28px;">${emailTable([
      `<tr><td data-email-section="mission" bgcolor="${EMAIL_COLORS.soft}" style="${EMAIL_CELL_STYLE}padding:18px 20px;background-color:${EMAIL_COLORS.soft};border-radius:7px;"><p style="${emailTextStyle(14, 22, EMAIL_COLORS.green, 600)}">${escapeHtml(mission)}</p></td></tr>`,
    ])}</td></tr>`,
    `<tr><td style="${EMAIL_CELL_STYLE}padding-bottom:12px;"><h2 style="${emailTextStyle(18, 26, EMAIL_COLORS.ink, 700)}">Ordering is simple</h2></td></tr>`,
    emailRow(escapeHtml(login)),
    emailRow(`${escapeHtml(portalIntroduction)}${emailStrong(portalEmphasis)}`),
    `<tr><td style="${EMAIL_CELL_STYLE}padding-bottom:18px;font-size:0;line-height:0;">${benefitColumns}</td></tr>`,
    emailRow(escapeHtml(convenience), 23),
    emailRow(escapeHtml(closing)),
    emailRow(`Best,<br />${emailStrong(senderName, 15, 24, EMAIL_COLORS.green)}`, 0, emailTextStyle(15, 24, EMAIL_COLORS.green)),
  ]);
  const html = `<div data-sample-quote-email="brand" class="sobrew-sample-email" style="${emailTextStyle()}width:100%;max-width:700px;background-color:${EMAIL_COLORS.warm};"><style>@media only screen and (max-width:480px){.sobrew-sample-email .sobrew-email-inset{padding-left:21px!important;padding-right:21px!important;}.sobrew-sample-email .sobrew-email-benefit{max-width:100%!important;}.sobrew-sample-email .sobrew-email-masthead-cell{display:block!important;width:100%!important;text-align:left!important;padding-bottom:14px!important;}}</style>${emailTable([
    `<tr><td data-email-section="header" class="sobrew-email-inset" bgcolor="${EMAIL_COLORS.forest}" style="${EMAIL_CELL_STYLE}padding:26px 32px 27px;background-color:${EMAIL_COLORS.forest};">${header}</td></tr>`,
    `<tr><td class="sobrew-email-inset" bgcolor="${EMAIL_COLORS.warm}" style="${EMAIL_CELL_STYLE}padding:26px 32px 30px;background-color:${EMAIL_COLORS.warm};">${body}</td></tr>`,
  ])}</div>`;
  return { subject: 'Sobrew Coffee Samples, Pricing, and Ordering Process', text, html };
}
