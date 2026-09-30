export const US_ADDRESS_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT',
  'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'AS', 'GU', 'MP', 'PR', 'VI', 'AA', 'AE', 'AP',
] as const;

export type CustomerAddress = {
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
};

export function normalizeCustomerAddress(address: CustomerAddress): CustomerAddress {
  return {
    address1: address.address1.trim(),
    address2: address.address2.trim(),
    city: address.city.trim(),
    state: address.state.trim().toUpperCase(),
    zip: address.zip.trim(),
  };
}

export function customerAddressError(address: CustomerAddress): string | null {
  const normalized = normalizeCustomerAddress(address);
  if (!normalized.address1 || !normalized.city || !normalized.state || !normalized.zip) {
    return 'Enter the street address, city, state, and ZIP code before creating this customer.';
  }
  if (!US_ADDRESS_STATES.some((state) => state === normalized.state)) {
    return 'Choose a valid US state or territory.';
  }
  if (!/^\d{5}(-\d{4})?$/.test(normalized.zip)) {
    return 'Enter a valid ZIP code (12345 or 12345-6789).';
  }
  return null;
}
