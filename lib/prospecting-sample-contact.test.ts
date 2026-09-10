import { describe, expect, it } from 'vitest';
import { hasSampleRequestContact } from './prospecting-sample-contact';

describe('sample request contact requirement', () => {
  it('requires a name and valid email on the same contact', () => {
    expect(hasSampleRequestContact([])).toBe(false);
    expect(hasSampleRequestContact([{ full_name: 'Jane' }, { email: 'jane@example.com' }])).toBe(false);
    expect(hasSampleRequestContact([{ full_name: 'Jane', email: 'invalid' }])).toBe(false);
    expect(hasSampleRequestContact([{ full_name: 'Jane', email: 'jane@example.com; ap@example.com' }])).toBe(false);
    expect(hasSampleRequestContact([{ full_name: ' Jane ', email: ' jane+samples@example.com ' }])).toBe(true);
    expect(hasSampleRequestContact([{ full_name: 'Incomplete' }, { full_name: 'Jane', email: 'jane@example.com' }])).toBe(true);
  });
});
