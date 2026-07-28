import { describe, expect, it } from 'vitest';
import { buildCustomerWelcomeEmailContent } from '@/lib/email';

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
