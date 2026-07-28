export type HubSpotProspectingLead = {
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  company_name: string;
  company_website?: string | null;
  country?: string | null;
  id: string;
  phone?: string | null;
  postal_code?: string | null;
  state?: string | null;
};

export type HubSpotProspectingContact = {
  email?: string | null;
  full_name?: string | null;
  is_primary?: boolean | null;
  phone?: string | null;
  title?: string | null;
};

type HubSpotObject = {
  id: string;
  properties?: Record<string, string | null | undefined>;
};

type HubSpotSearchResponse = {
  results?: HubSpotObject[];
};

type HubSpotObjectResponse = HubSpotObject;

type FetchLike = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  text: () => Promise<string>;
}>;

export type HubSpotPushResult = {
  companyId: string | null;
  contactId: string | null;
  message: string;
  status: 'exported' | 'partial';
};

export class HubSpotApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HubSpotApiError';
    this.status = status;
  }
}

function compactProperties(properties: Record<string, string | null | undefined>) {
  return Object.fromEntries(
    Object.entries(properties)
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
      .filter(([, value]) => typeof value === 'string' && value.length > 0),
  ) as Record<string, string>;
}

function missingOnlyProperties(
  incoming: Record<string, string>,
  existing: Record<string, string | null | undefined> | undefined,
) {
  return Object.fromEntries(
    Object.entries(incoming).filter(([key]) => {
      const current = existing?.[key];
      return current === null || current === undefined || String(current).trim() === '';
    }),
  ) as Record<string, string>;
}

function hubSpotErrorMessage(body: unknown) {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') return body.message;
  return '';
}

export function canPushProspectingHubSpot(access: { isOwner?: boolean; isSuperadmin?: boolean } | null | undefined) {
  return Boolean(access?.isOwner || access?.isSuperadmin);
}

export function extractHubSpotDomain(value?: string | null) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function splitHubSpotName(fullName?: string | null) {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstname: '', lastname: '' };
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') };
}

export function buildHubSpotCompanyProperties(lead: HubSpotProspectingLead) {
  return compactProperties({
    address: lead.address_line_1,
    address2: lead.address_line_2,
    city: lead.city,
    country: lead.country,
    domain: extractHubSpotDomain(lead.company_website),
    name: lead.company_name,
    phone: lead.phone,
    state: lead.state,
    zip: lead.postal_code,
  });
}

export function buildHubSpotContactProperties(lead: HubSpotProspectingLead, contact: HubSpotProspectingContact) {
  const { firstname, lastname } = splitHubSpotName(contact.full_name);
  return compactProperties({
    address: lead.address_line_1,
    address2: lead.address_line_2,
    city: lead.city,
    country: lead.country,
    email: contact.email,
    firstname,
    jobtitle: contact.title,
    lastname,
    phone: contact.phone,
    state: lead.state,
    zip: lead.postal_code,
  });
}

export function primaryHubSpotContact(contacts: HubSpotProspectingContact[]) {
  return contacts.find((contact) => contact.is_primary) ?? contacts[0] ?? null;
}

async function hubSpotRequest<T>(
  path: string,
  accessToken: string,
  options: { body?: unknown; fetchImpl?: FetchLike; method?: string } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`https://api.hubapi.com${path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    throw new HubSpotApiError(hubSpotErrorMessage(data) || response.statusText || 'HubSpot request failed.', response.status);
  }
  return data as T;
}

async function searchHubSpotObject(
  accessToken: string,
  objectType: 'companies' | 'contacts',
  filters: Array<{ operator: 'EQ'; propertyName: string; value: string }>,
  properties: string[],
  fetchImpl?: FetchLike,
) {
  const data = await hubSpotRequest<HubSpotSearchResponse>(`/crm/v3/objects/${objectType}/search`, accessToken, {
    body: {
      filterGroups: [{ filters }],
      limit: 1,
      properties,
    },
    fetchImpl,
  });
  return data.results?.[0] ?? null;
}

async function searchCompany(accessToken: string, properties: Record<string, string>, fetchImpl?: FetchLike) {
  const companyProperties = ['name', 'domain', 'phone', 'address', 'address2', 'city', 'state', 'zip', 'country'];
  if (properties.domain) {
    const match = await searchHubSpotObject(accessToken, 'companies', [
      { operator: 'EQ', propertyName: 'domain', value: properties.domain },
    ], companyProperties, fetchImpl);
    if (match) return match;
  }

  if (properties.name && properties.phone) {
    const match = await searchHubSpotObject(accessToken, 'companies', [
      { operator: 'EQ', propertyName: 'name', value: properties.name },
      { operator: 'EQ', propertyName: 'phone', value: properties.phone },
    ], companyProperties, fetchImpl);
    if (match) return match;
  }

  if (properties.name) {
    const match = await searchHubSpotObject(accessToken, 'companies', [
      { operator: 'EQ', propertyName: 'name', value: properties.name },
    ], companyProperties, fetchImpl);
    if (match) return match;
  }

  if (properties.phone) {
    return searchHubSpotObject(accessToken, 'companies', [
      { operator: 'EQ', propertyName: 'phone', value: properties.phone },
    ], companyProperties, fetchImpl);
  }

  return null;
}

async function searchContact(accessToken: string, email: string, fetchImpl?: FetchLike) {
  return searchHubSpotObject(accessToken, 'contacts', [
    { operator: 'EQ', propertyName: 'email', value: email },
  ], ['email', 'firstname', 'lastname', 'phone', 'jobtitle', 'address', 'address2', 'city', 'state', 'zip', 'country'], fetchImpl);
}

async function upsertHubSpotObject(
  accessToken: string,
  objectType: 'companies' | 'contacts',
  properties: Record<string, string>,
  existing: HubSpotObject | null,
  fetchImpl?: FetchLike,
) {
  if (existing) {
    const updateProperties = missingOnlyProperties(properties, existing.properties);
    if (Object.keys(updateProperties).length) {
      await hubSpotRequest<HubSpotObjectResponse>(`/crm/v3/objects/${objectType}/${existing.id}`, accessToken, {
        body: { properties: updateProperties },
        fetchImpl,
        method: 'PATCH',
      });
    }
    return existing.id;
  }

  const created = await hubSpotRequest<HubSpotObjectResponse>(`/crm/v3/objects/${objectType}`, accessToken, {
    body: { properties },
    fetchImpl,
  });
  return created.id;
}

async function associateContactToCompany(accessToken: string, contactId: string, companyId: string, fetchImpl?: FetchLike) {
  await hubSpotRequest('/crm/v3/associations/contacts/companies/batch/create', accessToken, {
    body: {
      inputs: [{
        from: { id: contactId },
        to: { id: companyId },
        type: 'contact_to_company',
      }],
    },
    fetchImpl,
  });
}

export async function pushProspectingLeadToHubSpot(options: {
  accessToken: string;
  contacts: HubSpotProspectingContact[];
  fetchImpl?: FetchLike;
  lead: HubSpotProspectingLead;
}): Promise<HubSpotPushResult> {
  const companyProperties = buildHubSpotCompanyProperties(options.lead);
  const existingCompany = await searchCompany(options.accessToken, companyProperties, options.fetchImpl);
  const companyId = await upsertHubSpotObject(options.accessToken, 'companies', companyProperties, existingCompany, options.fetchImpl);
  const primaryContact = primaryHubSpotContact(options.contacts);
  const contactEmail = String(primaryContact?.email ?? '').trim();

  if (!primaryContact || !contactEmail) {
    return {
      companyId,
      contactId: null,
      message: 'Company pushed; missing primary contact email.',
      status: 'partial',
    };
  }

  const contactProperties = buildHubSpotContactProperties(options.lead, primaryContact);
  const existingContact = await searchContact(options.accessToken, contactEmail, options.fetchImpl);
  const contactId = await upsertHubSpotObject(options.accessToken, 'contacts', contactProperties, existingContact, options.fetchImpl);
  await associateContactToCompany(options.accessToken, contactId, companyId, options.fetchImpl);

  return {
    companyId,
    contactId,
    message: 'Company and primary contact pushed to HubSpot.',
    status: 'exported',
  };
}

export function hubSpotRecordUrl(portalId: string, objectType: 'company' | 'contact', id: string | null | undefined) {
  const cleanPortalId = portalId.trim();
  if (!cleanPortalId || !id) return '';
  return `https://app.hubspot.com/contacts/${cleanPortalId}/${objectType}/${id}`;
}
