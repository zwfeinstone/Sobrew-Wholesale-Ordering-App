import { describe, expect, it } from 'vitest';
import { parseBillingEmail, parseBillingEmailCc } from './billing-email';

describe('primary invoice recipient parsing', () => {
  it('normalizes a deliberately entered single address', () => {
    expect(parseBillingEmail('  Accounting+Invoices@Example.com  ')).toBe('accounting+invoices@example.com');
  });

  it.each([null, undefined, '', '   ', 'invalid', 'a@example.com, b@example.com',
    'a@example.com;b@example.com', 'Accounts <a@example.com>', 'a@example.com\r\nBcc: b@example.com',
    ['a@example.com'], `${'a'.repeat(65)}@example.com`])('rejects a missing or invalid primary recipient: %j', (value) => {
    expect(() => parseBillingEmail(value)).toThrow('Enter one valid invoice email address');
  });
});

describe('billing CC recipient parsing', () => {
  it('normalizes common separators and deduplicates addresses without changing their order', () => {
    expect(parseBillingEmailCc(' AP@example.com; accounts+invoices@example.com\r\nAP@EXAMPLE.COM, finance@example.org '))
      .toEqual(['ap@example.com', 'accounts+invoices@example.com', 'finance@example.org']);
    expect(parseBillingEmailCc(['AP@example.com', 'ap@example.com; finance@example.org']))
      .toEqual(['ap@example.com', 'finance@example.org']);
  });

  it.each([null, undefined, '', ' , ; \r\n ', []].map((value) => ({ value })))('allows an explicitly empty list input: $value', ({ value }) => {
    expect(parseBillingEmailCc(value)).toEqual([]);
  });

  it.each([
    'not-an-email',
    'AP <ap@example.com>',
    'ap@example.com another@example.com',
    'ap@localhost',
    'ap@-example.com',
    'ap@example..com',
    '.ap@example.com',
    'ap..team@example.com',
    'ap@example.com\r\nBcc: other@example.com',
    `${'a'.repeat(65)}@example.com`,
    `ap@${'a'.repeat(64)}.com`,
    123,
    ['ap@example.com', null],
    { email: 'ap@example.com' },
  ])('rejects invalid input instead of silently losing a recipient: %j', (value) => {
    expect(() => parseBillingEmailCc(value)).toThrow(/billing CC/i);
  });

  it('rejects the entire list if any address is invalid', () => {
    expect(() => parseBillingEmailCc('ap@example.com; invalid; finance@example.com')).toThrow('invalid');
  });

  it('limits unique recipients to 20 while permitting duplicates at the limit', () => {
    const addresses = Array.from({ length: 20 }, (_, index) => `ap${index}@example.com`);
    expect(parseBillingEmailCc([...addresses, 'AP0@EXAMPLE.COM'])).toEqual(addresses);
    expect(() => parseBillingEmailCc([...addresses, 'overflow@example.com'])).toThrow('no more than 20');
  });
});
