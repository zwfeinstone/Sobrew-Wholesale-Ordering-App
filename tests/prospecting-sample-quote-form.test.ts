import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: (props: Record<string, unknown>) => createElement('a', props) }));
vi.mock('@/components/use-prospecting-draft-navigation', () => ({ useProspectingDraftNavigation: () => ({ destination: null, stay: vi.fn(), navigate: vi.fn() }) }));
vi.mock('@/components/prospecting-dialog', () => ({ default: () => null }));

import ProspectingSampleQuoteForm from '@/components/prospecting-sample-quote-form';

const props = {
  action: async () => ({}), orderId: 'order-1', contactName: 'Ron Smith', contactEmail: 'ron@example.test',
  senderName: 'Haskins', senderEmail: 'haskins@sobrew.com', canEdit: true, backHref: '/admin/sales/prospecting',
};

describe('sample quote review form', () => {
  it('renders all catalog items selected and previews the lead owner as sender', () => {
    const html = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, props));
    expect((html.match(/type="checkbox" checked=""/g) || []).length).toBe(11);
    expect(html).toContain('value="40.00"');
    expect(html).toContain('value="48.00"');
    expect(html).toContain('$8.00/lb');
    expect(html).toContain('Haskins &lt;haskins@sobrew.com&gt;');
    expect(html).toContain('Ron Smith &lt;ron@example.test&gt;');
    expect(html).toContain('Sobrew Coffee Samples, Pricing, and Ordering Process');
    expect(html).toContain('Tracking number pending');
  });

  it('previews a bulk-only custom quote while preserving the complete selection catalog', () => {
    const html = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, { ...props, initialTrackingNumber: '1Z0751H30305695303', initialLines: [{ id: 'bulk-regular', priceCents: 3500 }] }));
    const preview = html.slice(html.indexOf('Email preview'));
    expect((html.match(/type="checkbox" checked=""/g) || []).length).toBe(1);
    expect(preview).toContain('$35.00 per bag ($7.00/lb)');
    expect(preview).toContain('1Z0751H30305695303');
    expect(preview).not.toContain('Fraction Pack');
    expect(preview).not.toContain('Decaf Dark Roast');
    expect(html).toContain('Fraction Pack');
  });

  it('renders an empty or invalid draft without throwing from the email renderer', () => {
    const empty = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, { ...props, initialLines: [] }));
    expect(empty).toContain('Select at least one item');
    const invalid = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, { ...props, initialTrackingNumber: '<invalid>' }));
    expect(invalid).toContain('Enter valid tracking details');
  });

  it('keeps sent quotes visible and removes the send button', () => {
    const html = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, { ...props, sentAt: '2026-09-30T12:00:00Z', locked: true, initialTrackingNumber: '1Z123', initialLines: [{ id: 'bulk-regular', priceCents: 3500 }] }));
    expect(html).toContain('Samples and pricing email sent');
    expect(html).not.toContain('Send samples &amp; pricing email');
    expect(html).not.toContain('Check / retry email send');
    expect(html).toContain('$35.00 per bag ($7.00/lb)');
  });

  it('displays the exact saved subject and body for a locked quote', () => {
    const savedEmail = { subject: 'Original sample pricing offer', html: '<p>Previously sent quote with original wording.</p>' };
    const html = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, { ...props, locked: true, initialTrackingNumber: '1Z123', initialLines: [{ id: 'bulk-regular', priceCents: 3500 }], savedEmail }));
    const preview = html.slice(html.indexOf('Email preview'));
    expect(preview).toContain(savedEmail.subject);
    expect(preview).toContain(savedEmail.html);
    expect(preview).not.toContain('Sobrew Coffee Samples, Pricing, and Ordering Process');
    expect(preview).not.toContain('$35.00 per bag ($7.00/lb)');
    expect(preview).not.toContain('Thanks for your interest in Sobrew Coffee');
  });
});
