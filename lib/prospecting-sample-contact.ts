type SampleContact = { full_name?: unknown; email?: unknown };

export const SAMPLE_CONTACT_REQUIRED = 'Add a contact name and valid email for that contact before moving this prospect to Sample Requested.';

export function hasSampleRequestContact(contacts: SampleContact[]) {
  return contacts.some((contact) => String(contact.full_name ?? '').trim()
    && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(contact.email ?? '').trim()));
}

export function isSampleContactError(error: { message?: string } | null | undefined) {
  return error?.message?.includes('sample_requested_contact_required') ?? false;
}
