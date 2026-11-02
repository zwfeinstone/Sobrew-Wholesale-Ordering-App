import { US_ADDRESS_STATES } from '@/lib/customer-address';

export type PortalLocationFields = {
  name: string;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
};

export type PortalLocationFormState = {
  status: 'idle' | 'success' | 'error';
  message: string;
};

export const initialPortalLocationFormState: PortalLocationFormState = { status: 'idle', message: '' };

export function parsePortalLocationForm(formData: FormData): { location: PortalLocationFields; error: string | null } {
  let invalidValue = false;
  function field(name: string) {
    const value = formData.get(name);
    if (value === null) return '';
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
      invalidValue = true;
      return '';
    }
    return value.trim();
  }
  const location = {
    name: field('location_name'),
    address1: field('address1'),
    address2: field('address2') || null,
    city: field('city'),
    state: field('state').toUpperCase(),
    zip: field('zip'),
  };
  let error: string | null = null;
  if (invalidValue) error = 'Enter plain text without line breaks for your location and address.';
  else if (!location.name || !location.address1 || !location.city || !location.state || !location.zip) {
    error = 'Enter a location name, street address, city, state, and ZIP code.';
  } else if (location.name.length > 100 || location.address1.length > 200 || (location.address2?.length ?? 0) > 200 || location.city.length > 100) {
    error = 'Use up to 100 characters for the location name and city, and 200 for each address line.';
  } else if (!US_ADDRESS_STATES.some((state) => state === location.state)) {
    error = 'Choose a valid US state or territory.';
  } else if (!/^\d{5}(-\d{4})?$/.test(location.zip)) {
    error = 'Enter a valid ZIP code (12345 or 12345-6789).';
  }
  return { location, error };
}
