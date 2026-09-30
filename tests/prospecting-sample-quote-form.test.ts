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
  it('starts with every catalog item unchecked and a neutral prompt to select items', () => {
    const html = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, props));
    expect((html.match(/type="checkbox"/g) || []).length).toBe(11);
    expect((html.match(/type="checkbox" checked=""/g) || []).length).toBe(0);
    expect(html).toContain('value="40.00"');
    expect(html).toContain('value="48.00"');
    expect(html).toContain('name="greeting_name"');
    expect(html).toContain('value="Ron"');
    expect(html).toContain('maxLength="120"');
    expect(html).toContain('Haskins &lt;haskins@sobrew.com&gt;');
    expect(html).toContain('Ron Smith &lt;ron@example.test&gt;');
    expect(html).toContain('Sobrew Coffee Samples, Pricing, and Ordering Process');
    expect(html).toContain('Select the items to include');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('data-testid="sample-quote-email-preview"');
  });

  it('previews a bulk-only custom quote while preserving the complete selection catalog', () => {
    const html = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, { ...props, initialTrackingNumber: '1Z0751H30305695303', initialLines: [{ id: 'bulk-regular', priceCents: 3500 }] }));
    const preview = html.slice(html.indexOf('Email preview'));
    expect((html.match(/type="checkbox" checked=""/g) || []).length).toBe(1);
    expect(preview.replace(/<[^>]+>/g, '')).toContain('$35.00 per bag ($7.00/lb)');
    expect(preview).toContain('1Z0751H30305695303');
    expect(preview).not.toContain('Fraction Pack');
    expect(preview).not.toContain('Decaf Dark Roast');
    expect(html).toContain('Fraction Pack');
  });

  it('uses a complete custom greeting name while keeping the recipient unchanged', () => {
    const html = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, { ...props, initialGreetingName: '  Ron and Lisa  ', initialTrackingNumber: '1Z123', initialLines: [{ id: 'bulk-regular', priceCents: 3500 }] }));
    const preview = html.slice(html.indexOf('Email preview'));
    expect(preview).toContain('Hi Ron and Lisa!');
    expect(preview).not.toContain('Hi Ron!');
    expect(preview).toContain('Ron Smith &lt;ron@example.test&gt;');
  });

  it('withholds the generated email preview for an invalid greeting name', () => {
    const html = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, { ...props, initialGreetingName: '   ', initialTrackingNumber: '1Z123', initialLines: [{ id: 'bulk-regular', priceCents: 3500 }] }));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('Enter a greeting name to preview your email.');
    expect(html).not.toContain('data-testid="sample-quote-email-preview"');
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>Send samples &amp; pricing email/);
  });

  it('renders an empty or invalid draft without throwing from the email renderer', () => {
    const empty = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, { ...props, initialLines: [] }));
    expect(empty).toContain('Select at least one item');
    expect(empty).not.toContain('role="alert"');
    const invalid = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, { ...props, initialTrackingNumber: '<invalid>', initialLines: [{ id: 'bulk-regular', priceCents: 3500 }] }));
    expect(invalid).toContain('Enter valid tracking details');
  });

  it('keeps sent quotes visible and removes the send button', () => {
    const html = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, { ...props, sentAt: '2026-09-30T12:00:00Z', locked: true, initialTrackingNumber: '1Z123', initialLines: [{ id: 'bulk-regular', priceCents: 3500 }] }));
    expect(html).toContain('Samples and pricing email sent');
    expect(html).not.toContain('Send samples &amp; pricing email');
    expect(html).not.toContain('Check / retry email send');
    expect(html.replace(/<[^>]+>/g, '')).toContain('$35.00 per bag ($7.00/lb)');
    expect(html).toMatch(/id="sample-greeting-name"[^>]*disabled=""/);
  });

  it('displays the exact saved subject and body for a locked quote', () => {
    const savedEmail = { subject: 'Original sample pricing offer', html: '<p>Previously sent quote with original wording.</p>' };
    const html = renderToStaticMarkup(createElement(ProspectingSampleQuoteForm, { ...props, locked: true, initialGreetingName: 'Previously saved name', initialTrackingNumber: '1Z123', initialLines: [{ id: 'bulk-regular', priceCents: 3500 }], savedEmail }));
    const preview = html.slice(html.indexOf('Email preview'));
    expect(preview).toContain(savedEmail.subject);
    expect(preview).toContain(savedEmail.html);
    expect(preview).not.toContain('Sobrew Coffee Samples, Pricing, and Ordering Process');
    expect(preview).not.toContain('$35.00 per bag ($7.00/lb)');
    expect(preview).not.toContain('Thanks for your interest in Sobrew Coffee');
    expect(preview).not.toContain('Hi Previously saved name!');
    expect(html).toMatch(/id="sample-greeting-name"[^>]*disabled=""/);
  });
});
