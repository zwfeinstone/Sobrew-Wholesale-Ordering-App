import { describe, expect, it } from 'vitest';
import {
  adminOrderCcForAssignedSalesEmail,
  buildCustomerOrderEmailContent,
  buildCustomerWelcomeEmailContent,
  buildInvoicePdfEmailContent,
  buildPaymentReceiptEmailContent,
  buildShippedEmailContent,
  buildShippedEmailText,
} from '@/lib/email';

function expectApprovedTextSocialFooter(html: string, text: string) {
  expect(html).toContain('Follow Sobrew:');
  expect(html).toContain('href="https://sobrew.com"');
  expect(html).toContain('href="https://www.instagram.com/sobrew_official"');
  expect(html).toContain('href="https://www.linkedin.com/company/sobrew/"');
  expect(html).not.toContain('cid:sobrew-instagram');
  expect(html).not.toContain('cid:sobrew-linkedin');
  expect(text).toContain('Follow Sobrew:');
  expect(text).toContain('Sobrew.com: https://sobrew.com');
  expect(text).toContain('Instagram: https://www.instagram.com/sobrew_official');
  expect(text).toContain('LinkedIn: https://www.linkedin.com/company/sobrew/');
}

function htmlSectionBetween(html: string, start: string, end: string) {
  const marker = html.indexOf(start);
  const from = html.lastIndexOf('<table', marker);
  const to = html.indexOf(end, marker);
  expect(marker).toBeGreaterThanOrEqual(0);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(marker);
  return html.slice(from, to);
}

describe('buildCustomerWelcomeEmailContent', () => {
  it('uses the first name from the full name', () => {
    const content = buildCustomerWelcomeEmailContent({
      centerName: 'Lakeview Recovery',
      email: 'maya@example.com',
      fullName: 'Maya Patel',
      password: 'temporary-pass-1',
    });

    expect(content.text).toContain('Hi Maya,');
    expect(content.html).toContain('Hi Maya,');
    expect(content.html).toContain('Welcome, Maya!');
    expect(content.html).toContain("We've set up Sobrew ordering for Lakeview Recovery");
  });

  it('falls back to the first email prefix word when the name is blank', () => {
    const content = buildCustomerWelcomeEmailContent({
      email: 'jamie.ops@example.com',
      fullName: '',
      password: 'temporary-pass-2',
    });

    expect(content.text).toContain('Hi Jamie,');
    expect(content.html).toContain('Hi Jamie,');
  });

  it('includes the portal URL, email, and visible password', () => {
    const content = buildCustomerWelcomeEmailContent({
      centerName: 'Orders Center',
      email: 'orders@example.com',
      fullName: 'Orders Team',
      password: 'VisiblePass123!',
    });

    expect(content.text).toContain('Portal: https://app.sobrew.com');
    expect(content.text).toContain('Email: orders@example.com');
    expect(content.text).toContain('Password: VisiblePass123!');
    expect(content.html).toContain('href="https://app.sobrew.com"');
    expect(content.html).toContain('orders@example.com');
    expect(content.html).toContain('VisiblePass123!');
    expect(content.html).toContain('https://app.sobrew.com/sobrew-logo.png');
    expect(content.html).toContain("Every order helps fund recovery. It's at the heart of what we do");
    expect(content.html).toContain('width="64" height="64" alt="Sobrew"');
    expect(content.html).toContain("Just reply to this email. We're happy to help.");
    expect(content.html).toContain('Thanks for being part of Sobrew.');
    expect(content.text).toContain("Just reply to this email. We're happy to help.");
    expect(content.text).toContain('Thanks for being part of Sobrew.');
    expect(content.html).not.toContain('help with your first order');
    expect(content.html).not.toContain("Let's keep the coffee and the good work moving.");
    expect(content.html.toLowerCase()).not.toContain('restock');
    expect(content.text.toLowerCase()).not.toContain('restock');
    expectApprovedTextSocialFooter(content.html, content.text);
  });

  it('keeps long login credentials inside the mobile email width', () => {
    const content = buildCustomerWelcomeEmailContent({
      email: `${'mobile.credentials.'.repeat(5)}@example.com`,
      fullName: 'Mobile Test',
      password: 'A'.repeat(80),
    });
    const credentials = htmlSectionBetween(content.html, 'Your login details', 'Ordering is easy');

    expect(credentials).toContain('table-layout:fixed');
    expect(credentials).toContain('colspan="2"');
    expect(credentials).toContain('box-sizing:border-box');
    expect(credentials).toContain('overflow-wrap:anywhere');
    expect(credentials).toContain('word-break:break-all');
  });
});

describe('buildCustomerOrderEmailContent', () => {
  it('builds the branded confirmation with free shipping and order totals', () => {
    const content = buildCustomerOrderEmailContent({
      customerEmail: 'orders@lakeview.org',
      customerName: 'Lakeview Recovery',
      items: [
        { line: 7200, name: 'Cold Brew Case', price: 2400, qty: 3 },
        { line: 6000, name: 'Sweet Tea Case', price: 3000, qty: 2 },
        { line: 4200, name: 'Half Caff Bags', price: 700, qty: 6 },
      ],
      orderId: 'SO-1048',
      orderedAt: '2026-08-01T17:00:00.000Z',
      shipping: {},
      subtotalCents: 17400,
    });

    expect(content.html).toContain('https://app.sobrew.com/sobrew-logo.png');
    expect(content.html).toContain('Hi Lakeview Recovery,');
    expect(content.html).toContain('Cold Brew Case');
    expect(content.html).toContain('Aug 1, 2026');
    expect(content.html).toContain('3 products');
    expect(content.html).toContain('>Free<');
    expect(content.html).toContain('Order total');
    expect(content.html).toContain('$174.00');
    expect(content.html).toContain('href="https://app.sobrew.com"');
    expect(content.text).toContain('Shipping: Free');
    expect(content.text).toContain('Order total: $174.00');
    expect(content.html).toContain('width="64" height="64" alt="Sobrew"');
    expect(content.html).toContain('Need to make a change?');
    expect(content.html).toContain("Reply to this email before your order is packed, and we'll take care of it.");
    expect(content.text).toContain('Need to make a change?');
    expect(content.text).not.toContain('Need to adjust something?');
    expectApprovedTextSocialFooter(content.html, content.text);
  });

  it('escapes customer-visible order values', () => {
    const content = buildCustomerOrderEmailContent({
      customerEmail: 'orders@example.com',
      customerName: '<Lakeview>',
      items: [{ line: 1000, name: '<strong>Coffee</strong>', price: 1000, qty: 1 }],
      orderId: '<ORDER>',
      shipping: {},
      subtotalCents: 1000,
    });

    expect(content.html).toContain('Hi &lt;Lakeview&gt;,');
    expect(content.html).toContain('&lt;strong&gt;Coffee&lt;/strong&gt;');
    expect(content.html).toContain('Order &lt;ORDER&gt;');
  });

  it('constrains long order identifiers and summary tiles on mobile', () => {
    const content = buildCustomerOrderEmailContent({
      customerEmail: 'orders@example.com',
      customerName: 'Mobile Test',
      items: [{ line: 12345678, name: 'Coffee', price: 12345678, qty: 1234 }],
      orderId: `SO-${'A'.repeat(80)}`,
      shipping: {},
      subtotalCents: 12345678,
    });
    const summary = htmlSectionBetween(content.html, 'Order summary', 'Items purchased');
    const items = htmlSectionBetween(content.html, 'Items purchased', 'Subtotal');

    expect(summary).toContain('table-layout:fixed');
    expect(summary).toContain('word-break:break-all');
    expect(summary.match(/width="32%"/g)).toHaveLength(3);
    expect(summary.match(/width="2%"/g)).toHaveLength(2);
    expect(items).toContain('table-layout:fixed');
    expect(items).toContain('width="45%"');
    expect(items).toContain('width="15%"');
    expect(items).toContain('width="40%"');
    expect(items).toContain('word-break:break-all');
  });
});

describe('adminOrderCcForAssignedSalesEmail', () => {
  it('adds Haskins only when the assigned sales email matches', () => {
    expect(adminOrderCcForAssignedSalesEmail('haskins@sobrew.com')).toEqual(['haskins@sobrew.com']);
    expect(adminOrderCcForAssignedSalesEmail('HASKINS@SOBREW.COM')).toEqual(['haskins@sobrew.com']);
    expect(adminOrderCcForAssignedSalesEmail('another@sobrew.com')).toEqual([]);
    expect(adminOrderCcForAssignedSalesEmail(null)).toEqual([]);
  });
});

describe('buildInvoicePdfEmailContent', () => {
  it('builds a polished invoice PDF email with payment and reply instructions', () => {
    const content = buildInvoicePdfEmailContent({
      customerName: 'Lakeview Recovery',
      invoiceNumber: 'SO-1272',
    });

    expect(content.html).toContain('https://app.sobrew.com/sobrew-logo.png');
    expect(content.html).toContain('width="78" height="78" alt="Sobrew"');
    expect(content.html).toContain('Hi Lakeview Recovery,');
    expect(content.html).toContain('Your Sobrew invoice <strong style="color:#241a12;">SO-1272</strong> is attached as a PDF.');
    expect(content.html).toContain('Please mail checks using the payment details listed on the invoice.');
    expect(content.html).toContain('Questions or adjustments?');
    expect(content.html).toContain('mailto:hello@sobrew.com');
    expect(content.html).toContain('href="https://sobrew.com"');
    expect(content.html).toContain('href="https://www.instagram.com/sobrew_official"');
    expect(content.html).toContain('href="https://www.linkedin.com/company/sobrew/"');
    expect(content.html).toContain('src="cid:sobrew-instagram"');
    expect(content.html).toContain('src="cid:sobrew-linkedin"');
    expect(content.html).toContain('Funding recovery, one cup at a time.');
    expect(content.html).not.toContain('Stay connected');
    expect(content.text).toContain('Your Sobrew invoice SO-1272 is attached as a PDF.');
    expect(content.text).toContain('just reply to this email or reach us at hello@sobrew.com');
    expect(content.text).toContain('Website: https://sobrew.com');
    expect(content.text).toContain('Instagram: https://www.instagram.com/sobrew_official');
    expect(content.text).toContain('LinkedIn: https://www.linkedin.com/company/sobrew/');
  });

  it('escapes customer-visible invoice email values', () => {
    const content = buildInvoicePdfEmailContent({
      customerName: '<Center>',
      invoiceNumber: '<SO-1272>',
    });

    expect(content.html).toContain('Hi &lt;Center&gt;,');
    expect(content.html).toContain('&lt;SO-1272&gt;');
    expect(content.html).not.toContain('Hi <Center>,');
  });
});

describe('buildPaymentReceiptEmailContent', () => {
  it('builds a card receipt email after capture', () => {
    const content = buildPaymentReceiptEmailContent({
      amountCents: 11600,
      customerName: 'Lakeview Recovery',
      invoiceNumber: 'SO-1272',
      paymentMethodLabel: 'Visa ending 1111',
      paymentMethodType: 'card',
      paymentStatus: 'CAPTURED',
    });

    expect(content.html).toContain('Your Sobrew payment is complete.');
    expect(content.html).toContain('Visa ending 1111 was charged $116.00.');
    expect(content.html).toContain('QuickBooks status CAPTURED');
    expect(content.text).toContain('Visa ending 1111 was charged $116.00.');
    expect(content.text).toContain('Receipt amount: $116.00');
  });

  it('describes ACH and eCheck receipts as submitted while they settle', () => {
    const content = buildPaymentReceiptEmailContent({
      amountCents: 8000,
      customerName: 'Upon Awakening',
      invoiceNumber: 'SO-1273',
      paymentMethodLabel: 'Checking ending 6789',
      paymentMethodType: 'bank_account',
      paymentStatus: 'PENDING',
    });

    expect(content.html).toContain('Your Sobrew payment was submitted.');
    expect(content.html).toContain('Checking ending 6789 payment for $80.00 was submitted.');
    expect(content.text).toContain('QuickBooks status: PENDING');
  });
});

describe('buildShippedEmailContent', () => {
  it('includes multiple tracking numbers in the customer shipped email', () => {
    const items = [{ name: 'Cold Brew', qty: 2 }];
    const trackingLines = [
      { carrier: 'UPS', trackingCode: '1Z999AA10123456784' },
      { carrier: 'UPS', trackingCode: '1Z999AA10123456785' },
    ];
    const context = { customerName: 'Lakeview Recovery', orderId: 'SO-1048', shippedAt: '2026-08-01T17:00:00.000Z' };
    const html = buildShippedEmailContent(items, trackingLines, context);
    const text = buildShippedEmailText(items, trackingLines, context);

    expect(html).toContain('1Z999AA10123456784');
    expect(html).toContain('1Z999AA10123456785');
    expect(html).toContain('https://www.ups.com/track?tracknum=1Z999AA10123456784');
    expect(html).toContain('https://www.ups.com/track?tracknum=1Z999AA10123456785');
    expect(html).toContain('Track package 1');
    expect(html).toContain('Track package 2');
    expect(html).toContain('Hi Lakeview Recovery,');
    expect(html).toContain('SO-1048');
    expect(html).toContain('Aug 1, 2026');
    expect(html).toContain('Your coffee is on the way.');
    expect(html).toContain('Thanks for supporting Sobrew and the recovery programs your order helps fund.');
    expect(html).toContain("If anything doesn't look right when your shipment arrives, reply to this email and we'll take care of it.");
    expect(text).toContain('Your coffee is on the way.');
    expect(text).not.toContain('Coffee headed your way. Recovery moving forward.');
    expect(html).toContain('https://app.sobrew.com/sobrew-logo.png');
    expect(html).toContain('width="64" height="64" alt="Sobrew"');
    expectApprovedTextSocialFooter(html, text);
  });

  it('links UPS tracking numbers to the UPS tracking page', () => {
    const html = buildShippedEmailContent(
      [{ name: 'Cold Brew', qty: 2 }],
      [{ carrier: 'UPS', trackingCode: '1Z999AA10123456784' }],
    );

    expect(html).toContain('Track this shipment');
    expect(html).not.toContain('Track package 1');
    expect(html).toContain('https://www.ups.com/track?tracknum=1Z999AA10123456784');
  });

  it('escapes customer-visible shipment values', () => {
    const html = buildShippedEmailContent(
      [{ name: '<strong>Cold Brew</strong>', qty: 1 }],
      [{ carrier: '<Carrier>', trackingCode: '<TRACK>' }],
      { customerName: '<Center>', orderId: '<ORDER>' },
    );

    expect(html).toContain('&lt;strong&gt;Cold Brew&lt;/strong&gt;');
    expect(html).toContain('&lt;Carrier&gt;');
    expect(html).toContain('&lt;TRACK&gt;');
    expect(html).toContain('Hi &lt;Center&gt;,');
    expect(html).toContain('&lt;ORDER&gt;');
  });

  it('wraps long tracking codes without widening the mobile email', () => {
    const trackingCode = `1Z${'9'.repeat(80)}`;
    const html = buildShippedEmailContent(
      [{ name: 'Cold Brew', qty: 1 }],
      [{ carrier: 'UPS', trackingCode }],
    );
    const tracking = htmlSectionBetween(html, 'Shipment status', 'Items in this shipment');

    expect(tracking).toContain('table-layout:fixed');
    expect(tracking).toContain('overflow-wrap:anywhere');
    expect(tracking).toContain('word-break:break-all');
    expect(tracking).toContain(trackingCode);
  });
});
