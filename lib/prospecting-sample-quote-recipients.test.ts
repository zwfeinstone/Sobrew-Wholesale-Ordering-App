import { describe, expect, it } from 'vitest';
import { SAMPLE_QUOTE_CC_MAX_LENGTH, validateSampleQuoteCcEmails } from './prospecting-sample-quote-recipients';

const recipient = 'buyer@example.com';

describe('sample pricing CC recipients', () => {
  it.each([undefined, null, '', '  ', ',;\r\n', []])('allows optional empty CC input %j', value => {
    expect(validateSampleQuoteCcEmails(value, recipient)).toEqual({ ok: true, ccEmails: [] });
  });

  it('accepts comma, semicolon, and new-line separators and normalizes addresses', () => {
    expect(validateSampleQuoteCcEmails(' Ann@Example.com ; bob+pricing@example.com,\nCAROL@example.org\r\ndev@example.co.uk ', recipient))
      .toEqual({ ok: true, ccEmails: ['ann@example.com', 'bob+pricing@example.com', 'carol@example.org', 'dev@example.co.uk'] });
  });

  it('deduplicates case-insensitively and excludes the primary recipient', () => {
    expect(validateSampleQuoteCcEmails([' buyer@example.com ', 'ANN@EXAMPLE.COM', 'ann@example.com'], ' BUYER@EXAMPLE.COM '))
      .toEqual({ ok: true, ccEmails: ['ann@example.com'] });
  });

  it.each([
    'not-an-email', 'Ann <ann@example.com>', 'ann@example.com bob@example.com', 'a@b', 'a@@example.com',
    '.ann@example.com', 'ann..smith@example.com', 'ann@example..com', 'ann@-example.com',
    'ann@example.com\r\nBcc: other@example.com', 'ann@example.com\u0000', 'ann@exam\tple.com',
    ['ann@example.com\nother@example.com'], ['ann@example.com', 1], { cc: 'ann@example.com' }, 1,
  ])('rejects malformed addresses and header syntax: %j', value => {
    expect(validateSampleQuoteCcEmails(value, recipient)).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it('limits the number of unique additional recipients to 20', () => {
    const twenty = Array.from({ length: 20 }, (_, index) => `person${index}@example.com`);
    expect(validateSampleQuoteCcEmails([...twenty, twenty[0], recipient], recipient)).toEqual({ ok: true, ccEmails: twenty });
    expect(validateSampleQuoteCcEmails([...twenty, 'extra@example.com'], recipient)).toMatchObject({ ok: false, error: expect.stringContaining('20') });
  });

  it('limits raw input and individual email lengths', () => {
    expect(validateSampleQuoteCcEmails(' '.repeat(SAMPLE_QUOTE_CC_MAX_LENGTH + 1), recipient)).toMatchObject({ ok: false });
    expect(validateSampleQuoteCcEmails([' '.repeat(SAMPLE_QUOTE_CC_MAX_LENGTH + 1)], recipient)).toMatchObject({ ok: false });
    expect(validateSampleQuoteCcEmails(`${'a'.repeat(65)}@example.com`, recipient)).toMatchObject({ ok: false });
    expect(validateSampleQuoteCcEmails(`a@${'b'.repeat(64)}.com`, recipient)).toMatchObject({ ok: false });
    expect(validateSampleQuoteCcEmails(`${'a'.repeat(64)}@${Array(4).fill('b'.repeat(60)).join('.')}`, recipient)).toMatchObject({ ok: false });
  });
});
