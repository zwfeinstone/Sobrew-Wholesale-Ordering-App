import { describe, expect, it } from 'vitest';
import { initialPortalLocationFormState, parsePortalLocationForm } from '@/lib/portal-locations';

function form(overrides: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({
    name: ' East building ', address1: ' 123 Recovery Way ', address2: ' Suite 2 ',
    city: ' Memphis ', state: ' tn ', zip: ' 38103-1234 ', ...overrides,
  })) result.set(key === 'name' ? 'location_name' : key, value);
  return result;
}

describe('portal delivery location validation', () => {
  it('starts without a success or error announcement', () => {
    expect(initialPortalLocationFormState).toEqual({ status: 'idle', message: '' });
  });

  it('normalizes address fields without inventing or dropping the optional unit', () => {
    expect(parsePortalLocationForm(form())).toEqual({
      location: {
        name: 'East building', address1: '123 Recovery Way', address2: 'Suite 2',
        city: 'Memphis', state: 'TN', zip: '38103-1234',
      },
      error: null,
    });
    expect(parsePortalLocationForm(form({ address2: '   ', zip: '38103' }))).toMatchObject({
      location: { address2: null, zip: '38103' }, error: null,
    });
  });

  it.each(['name', 'address1', 'city', 'state', 'zip'])('requires %s even for a forged native form', (field) => {
    const missing = form();
    missing.delete(field === 'name' ? 'location_name' : field);
    expect(parsePortalLocationForm(missing).error).toBeTruthy();
    expect(parsePortalLocationForm(form({ [field]: '   ' })).error).toBeTruthy();
  });

  it.each([
    ['name', 100], ['address1', 200], ['address2', 200], ['city', 100],
  ])('accepts the %s limit and rejects truncation at %i characters', (field, limit) => {
    const max = 'A'.repeat(Number(limit));
    expect(parsePortalLocationForm(form({ [field]: max })).error).toBeNull();
    const invalid = parsePortalLocationForm(form({ [field]: `${max}A` }));
    expect(invalid.error).toBeTruthy();
  });

  it.each(['CA', 'DC', 'PR', 'AP'])('accepts US state or territory code %s', (state) => {
    expect(parsePortalLocationForm(form({ state })).error).toBeNull();
  });

  it.each(['ZZ', 'Tennessee', 'USA', '1A'])('rejects unsupported state %s', (state) => {
    expect(parsePortalLocationForm(form({ state })).error).toMatch(/state|territory/i);
  });

  it.each(['1234', '123456', '12345-123', '12345-12345', 'ABCDE', '38103abc'])('rejects malformed ZIP %s', (zip) => {
    expect(parsePortalLocationForm(form({ zip })).error).toMatch(/ZIP|postal/i);
  });

  it.each(['name', 'address1', 'address2', 'city', 'state', 'zip'])('rejects an uploaded file in %s', (field) => {
    const payload = form();
    payload.set(field === 'name' ? 'location_name' : field, new Blob(['not an address'], { type: 'text/plain' }), 'address.txt');
    expect(parsePortalLocationForm(payload).error).toBeTruthy();
  });

  it.each(['\u0000', '\n', '\r', '\t', '\u001f', '\u007f'])('rejects control character %j even at an otherwise trimmed boundary', (control) => {
    expect(parsePortalLocationForm(form({ name: `${control}East building` })).error).toBeTruthy();
    expect(parsePortalLocationForm(form({ address2: `Suite${control}2` })).error).toBeTruthy();
  });

  it('preserves ordinary punctuation and Unicode in real location names and addresses', () => {
    const values = { name: 'Recovery – café', address1: "123 O'Connell St.", address2: '#2-B', city: 'San José' };
    expect(parsePortalLocationForm(form(values))).toMatchObject({ location: values, error: null });
  });

  it('allows only address and location-label fields from a submitted payload', () => {
    const result = parsePortalLocationForm(form({
      id: 'forged-id', center_id: 'other-center', is_active: 'false', notes: 'private note',
      quickbooks_customer_id: 'forged-qb', created_at: '2000-01-01',
    }));
    expect(Object.keys(result.location).sort()).toEqual(['address1', 'address2', 'city', 'name', 'state', 'zip']);
    expect(result.error).toBeNull();
  });
});
