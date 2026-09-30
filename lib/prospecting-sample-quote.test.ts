import { describe, expect, it } from 'vitest';
import { buildSampleQuoteEmail, formatSampleQuotePrice, getSampleQuoteGreetingName, SAMPLE_QUOTE_ITEMS, validateSampleQuoteGreetingName, validateSampleQuoteInput } from './prospecting-sample-quote';

const tracking = '1Z0751H30305695303';
const bulkLine = { id: 'bulk-regular', priceCents: 3500 };
const visibleHtmlText = (html: string) => html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<\/td>/g, ' ').replace(/<[^>]*>/g, '').replaceAll('&amp;', '&').replaceAll('&#39;', "'").replace(/\s+/g, ' ');

describe('sample quote greeting name', () => {
  it('defaults to the contact’s first whitespace-delimited name and handles empty contacts', () => {
    expect(getSampleQuoteGreetingName('  Ron Buyer  ')).toBe('Ron');
    expect(getSampleQuoteGreetingName('Ron\tBuyer')).toBe('Ron');
    expect(getSampleQuoteGreetingName('')).toBe('');
    expect(getSampleQuoteGreetingName('   ')).toBe('');
  });

  it('accepts trimmed multiword and Unicode greetings without shortening them', () => {
    expect(validateSampleQuoteGreetingName('  Ron and María  ')).toEqual({ ok: true, greetingName: 'Ron and María' });
    expect(validateSampleQuoteGreetingName('A'.repeat(120))).toEqual({ ok: true, greetingName: 'A'.repeat(120) });
  });

  it.each([undefined, null, 123, {}, '', '   ', 'A'.repeat(121), 'Ron\nBuyer', '\nRon', 'Ron\r', 'Ron\tBuyer', 'Ron\u0000Buyer', 'Ron\u007fBuyer', 'Ron\u0085Buyer', 'Ron\u2028Buyer', 'Ron\u2029Buyer'])('rejects invalid greeting names %j', value => {
    expect(validateSampleQuoteGreetingName(value).ok).toBe(false);
  });
});

describe('sample quote validation', () => {
  it('keeps the requested default prices and all eleven independently selectable items', () => {
    expect(SAMPLE_QUOTE_ITEMS.map(item => [item.id, item.defaultPriceCents])).toEqual([
      ['bulk-regular', 4000], ['bulk-decaf', 4800],
      ['fraction-1-5oz', 9000], ['fraction-2oz', 11500], ['fraction-2-5oz', 14000], ['fraction-3oz', 17000], ['fraction-decaf', 11500],
      ['filter-1-5oz', 4900], ['filter-2oz', 5500],
      ['k-cups-regular', 4000], ['k-cups-fourth-dimension', 5000],
    ]);
  });

  it('trims tracking and canonicalizes selected item order without restoring unchecked items', () => {
    expect(validateSampleQuoteInput(` ${tracking} `, [{ id: 'filter-2oz', priceCents: 5125 }, bulkLine])).toEqual({
      ok: true, trackingNumber: tracking, lines: [bulkLine, { id: 'filter-2oz', priceCents: 5125 }],
    });
  });

  it.each(['', '   ', 'X'.repeat(121), '1Z\nSubject: surprise', '<script>alert(1)</script>'])('rejects invalid tracking %j', value => {
    expect(validateSampleQuoteInput(value, [bulkLine]).ok).toBe(false);
  });

  it.each([null, {}, [], [null], [{ id: 'unknown', priceCents: 100 }], [bulkLine, bulkLine]])('rejects invalid or duplicate selections %j', lines => {
    expect(validateSampleQuoteInput(tracking, lines).ok).toBe(false);
  });

  it.each([-1, 0, 35.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '3500', undefined])('rejects invalid cents %j', priceCents => {
    expect(validateSampleQuoteInput(tracking, [{ id: 'bulk-regular', priceCents }]).ok).toBe(false);
  });
});

describe('sample pricing and tracking email', () => {
  it('quotes only the selected bulk coffee at the custom price and correct per-pound price', () => {
    const email = buildSampleQuoteEmail({ contactName: 'Ron Jones', senderName: 'Zach', trackingNumber: tracking, lines: [bulkLine] });
    expect(email.subject).toBe('Sobrew Coffee Samples, Pricing, and Ordering Process');
    for (const body of [email.text, visibleHtmlText(email.html)]) {
      expect(body).toContain('Hi Ron!');
      expect(body).toContain(tracking);
      expect(body).toContain('$35.00 per bag ($7.00/lb)');
      expect(body).not.toContain('$40.00');
      expect(body).not.toContain('Decaf');
      expect(body).not.toContain('Fraction Pack');
      expect(body).not.toContain('Filter Pack');
      expect(body).not.toContain('K Cups');
      expect(body).toContain('recurring orders');
      expect(body).toContain('recovery and mental health-focused organizations');
      expect(body).toContain('Zach');
      expect(body).not.toContain('my call today');
    }
  });

  it('renders all sizes, roast descriptions and custom prices consistently in both formats', () => {
    const email = buildSampleQuoteEmail({
      contactName: 'Ron', senderName: 'Haskins', trackingNumber: tracking,
      lines: SAMPLE_QUOTE_ITEMS.map(item => ({ id: item.id, priceCents: item.defaultPriceCents })),
    });
    for (const body of [email.text, visibleHtmlText(email.html)]) {
      expect(body).toContain('$48.00 per bag ($9.60/lb)');
      expect(body).toContain('Specialty Fourth Dimension Medium Roast');
      expect(body).toContain('Haskins');
    }
    expect(email.html.match(/data-email-quote-item=/g)).toHaveLength(11);
    for (const item of SAMPLE_QUOTE_ITEMS) {
      expect(email.text).toContain(formatSampleQuotePrice(item, item.defaultPriceCents));
      const priceRow = email.html.match(new RegExp(`<tr data-email-quote-item="${item.id}">[\\s\\S]*?<\\/tr>`))?.[0] ?? '';
      expect(visibleHtmlText(priceRow)).toContain(item.packLabel);
      expect(priceRow).toMatch(new RegExp(`<strong[^>]*>\\$${(item.defaultPriceCents / 100).toFixed(2).replace('.', '\\.')}.*?<\\/strong>`));
    }
  });

  it('uses the approved personal copy and tracking line break in both email formats', () => {
    const email = buildSampleQuoteEmail({ contactName: 'Ron Buyer', senderName: 'Haskins', trackingNumber: tracking, lines: [bulkLine] });
    const approvedCopy = [
      'Thanks for your interest in Sobrew Coffee! Looking forward to y’all trying the coffee.',
      'Please find your coffee pricing below.',
      'To place an order, we’ll create a login for you on our online ordering portal.',
      'We built this to make ordering as simple and hands-off as possible. Most of our partners love the ability to set it and forget it:',
      'Set up recurring orders so you never run out',
      'Adjust frequency or quantities anytime as your needs change',
      'Reorder in seconds from past purchases',
      'Access your full catalog of products in one place',
      'I’d love to hear your thoughts once you’ve had a chance to try everything!',
    ];
    for (const body of [email.text, visibleHtmlText(email.html)]) {
      for (const paragraph of approvedCopy) expect(body).toContain(paragraph);
    }
    expect(email.text).toContain(`Samples Tracking:\n${tracking}`);
    expect(email.html).toMatch(/Samples Tracking:<\/p><p[^>]*>1Z0751H30305695303<\/p>/);
    expect(email.text).toMatch(/Best,\nHaskins$/);
    expect(email.html).toMatch(/Best,<br \/><strong[^>]*>Haskins<\/strong>/);
  });

  it('renders the approved branded hierarchy with email-safe typography and presentation tables', () => {
    const email = buildSampleQuoteEmail({ contactName: 'Ron', senderName: 'Zach', trackingNumber: tracking, lines: [bulkLine] });
    const elements = email.html.match(/<(?:td|p|strong)\b[^>]*>/g) ?? [];
    expect(elements.length).toBeGreaterThan(0);
    for (const element of elements) {
      expect(element).toContain('font-family:Arial,Helvetica,sans-serif;');
      expect(element).toMatch(/font-size:\d+px;/);
      expect(element).toMatch(/line-height:\d+px;/);
      expect(element).toContain('margin:0;');
      expect(element).toContain('padding:0;');
    }
    for (const table of email.html.match(/<table\b[^>]*>/g) ?? []) {
      expect(table).toContain('role="presentation"');
      expect(table).toContain('cellpadding="0"');
      expect(table).toContain('cellspacing="0"');
      expect(table).toContain('border-collapse:collapse;');
    }
    expect(email.html).toContain('data-sample-quote-email="brand"');
    expect(email.html).toMatch(/data-email-section="header"[^>]*background-color:#234435;/);
    expect(email.html).toContain('background-color:#f8f5ed;');
    expect(email.html).toMatch(/<h1 data-email-title[^>]*font-family:Georgia[^>]*font-size:31px;line-height:37px;[^>]*>Samples, pricing &amp; simple ordering\.<\/h1>/);
    expect(email.html).toMatch(/<p data-email-greeting[^>]*font-size:15px;line-height:24px;[^>]*>Hi Ron!<\/p>/);
    expect(email.html).toMatch(/<h2 data-email-category-title[^>]*font-size:16px;line-height:23px;[^>]*>Bulk Coffee \(5lb bags\)<\/h2>/);
    expect(email.html).toMatch(/data-email-section="category"[^>]*background-color:#ffffff;[^>]*border-radius:8px;/);
    expect(email.html).not.toMatch(/<(?:ul|li|select|script)\b/);
    expect(email.html).not.toContain(email.subject);
  });

  it('provides wrapping mobile layouts, readable long names, and four complete benefit blocks', () => {
    const email = buildSampleQuoteEmail({ contactName: 'Ron', greetingName: 'A'.repeat(120), senderName: 'Zach', trackingNumber: '1'.repeat(120), lines: [bulkLine] });
    expect(email.html.match(/data-email-benefit\b/g)).toHaveLength(4);
    expect(email.html).toMatch(/data-email-benefit[^>]*display:inline-block;[^>]*width:100%;max-width:318px;/);
    expect(email.html).toContain('<!--[if mso]>');
    expect(email.html).toContain('@media only screen and (max-width:480px)');
    expect(email.html).toMatch(/data-email-greeting[^>]*overflow-wrap:anywhere;word-break:break-word;/);
    expect(email.html).toMatch(/<p[^>]*overflow-wrap:anywhere;word-break:break-word;[^>]*>1{120}<\/p>/);
  });

  it('keeps selected descriptions grouped with their prices and omits unselected categories', () => {
    const email = buildSampleQuoteEmail({ contactName: 'Ron', senderName: 'Zach', trackingNumber: tracking, lines: [
      { id: 'fraction-3oz', priceCents: 16200 },
      { id: 'fraction-1-5oz', priceCents: 8700 },
    ] });
    expect(email.html.match(/data-email-section="category"/g)).toHaveLength(1);
    expect(email.html).toMatch(/<td[^>]*padding-bottom:4px;[^>]*><p[^>]*>Medium, Dark, Espresso, or French Roast \(Ground\)<\/p>/);
    expect(email.html).toMatch(/data-email-quote-item="fraction-1-5oz"[\s\S]*?<strong[^>]*>\$87\.00<\/strong>/);
    expect(email.html).toMatch(/data-email-quote-item="fraction-3oz"[\s\S]*?<strong[^>]*>\$162\.00<\/strong>/);
    for (const body of [email.text, visibleHtmlText(email.html)]) {
      expect(body.indexOf('100 x 1.5oz')).toBeLessThan(body.indexOf('100 x 3oz'));
      expect(body.match(/Medium, Dark, Espresso, or French Roast \(Ground\)/g)).toHaveLength(1);
      expect(body).not.toContain('Bulk Coffee');
      expect(body).not.toContain('Filter Pack');
      expect(body).not.toContain('K Cups');
      expect(body).not.toContain('100 x 2oz');
    }
  });

  it('escapes contact and sender names in HTML without changing the plain text values', () => {
    const email = buildSampleQuoteEmail({ contactName: '<Ron>', senderName: 'Zach <script> & "team"', trackingNumber: tracking, lines: [bulkLine] });
    expect(email.html).toContain('Hi &lt;Ron&gt;!');
    expect(email.html).toContain('Zach &lt;script&gt; &amp; &quot;team&quot;');
    expect(email.html).not.toContain('<script>');
    expect(email.text).toContain('Hi <Ron>!');
  });

  it('uses an explicit greeting in full, escapes it, and otherwise retains legacy first-name and empty fallbacks', () => {
    const input = { contactName: 'Ron Buyer', senderName: 'Zach', trackingNumber: tracking, lines: [bulkLine] };
    const personalized = buildSampleQuoteEmail({ ...input, greetingName: '  Ron and <María> & team  ' });
    expect(personalized.text).toMatch(/^Hi Ron and <María> & team!/);
    expect(personalized.html).toContain('Hi Ron and &lt;María&gt; &amp; team!');
    expect(buildSampleQuoteEmail(input).text).toMatch(/^Hi Ron!/);
    expect(buildSampleQuoteEmail({ ...input, contactName: ' ' }).text).toMatch(/^Hi!/);
    expect(() => buildSampleQuoteEmail({ ...input, greetingName: ' ' })).toThrow('greeting name');
    expect(() => buildSampleQuoteEmail({ ...input, greetingName: 'Ron\nSomeone else' })).toThrow('line breaks');
  });

  it('rejects malformed input instead of producing an incomplete email', () => {
    expect(() => buildSampleQuoteEmail({ contactName: 'Ron', senderName: 'Zach', trackingNumber: tracking, lines: [] })).toThrow('Select at least one');
  });
});
