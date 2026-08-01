import { describe, expect, it } from 'vitest';
import { adminOrderCcForAssignedSalesEmail, buildCustomerWelcomeEmailContent, buildShippedEmailContent } from '@/lib/email';

describe('buildCustomerWelcomeEmailContent', () => {
  it('uses the first name from the full name', () => {
    const content = buildCustomerWelcomeEmailContent({
      email: 'maya@example.com',
      fullName: 'Maya Patel',
      password: 'temporary-pass-1',
    });

    expect(content.text).toContain('Hi Maya,');
    expect(content.html).toContain('Hi Maya,');
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
      email: 'orders@example.com',
      fullName: 'Orders Team',
      password: 'VisiblePass123!',
    });

    expect(content.text).toContain('Portal: https://app.sobrew.com');
    expect(content.text).toContain('Email: orders@example.com');
    expect(content.text).toContain('Password: VisiblePass123!');
    expect(content.html).toContain('href="https://app.sobrew.com"');
    expect(content.html).toContain('<strong>Email:</strong> orders@example.com');
    expect(content.html).toContain('<strong>Password:</strong> VisiblePass123!');
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

describe('buildShippedEmailContent', () => {
  it('includes multiple tracking numbers in the customer shipped email', () => {
    const html = buildShippedEmailContent(
      [{ name: 'Cold Brew', qty: 2 }],
      [
        { trackingCode: 'TRACK-001' },
        { trackingCode: 'TRACK-002' },
      ],
    );

    expect(html).toContain('TRACK-001');
    expect(html).toContain('TRACK-002');
  });

  it('escapes customer-visible shipment values', () => {
    const html = buildShippedEmailContent(
      [{ name: '<strong>Cold Brew</strong>', qty: 1 }],
      [{ carrier: '<Carrier>', trackingCode: '<TRACK>' }],
    );

    expect(html).toContain('&lt;strong&gt;Cold Brew&lt;/strong&gt;');
    expect(html).toContain('&lt;Carrier&gt;');
    expect(html).toContain('&lt;TRACK&gt;');
  });
});
