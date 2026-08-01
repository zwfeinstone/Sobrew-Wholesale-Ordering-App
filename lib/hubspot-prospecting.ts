export type HubSpotProspectingLead = {
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  company_name: string;
  company_website?: string | null;
  country?: string | null;
  hubspot_deal_id?: string | null;
  hubspot_note_id?: string | null;
  id: string;
  notes?: string | null;
  phone?: string | null;
  postal_code?: string | null;
  state?: string | null;
};

export type HubSpotProspectingContact = {
  email?: string | null;
  full_name?: string | null;
  is_primary?: boolean | null;
  notes?: string | null;
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

type HubSpotOwner = {
  archived?: boolean;
  email?: string | null;
  id: string;
};

type HubSpotOwnersResponse = {
  results?: HubSpotOwner[];
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
  dealId: string | null;
  message: string;
  noteId: string | null;
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
  overwriteProperties: string[] = [],
) {
  return Object.fromEntries(
    Object.entries(incoming).filter(([key]) => {
      const current = existing?.[key];
      if (overwriteProperties.includes(key)) return String(current ?? '').trim() !== incoming[key];
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

export function normalizeHubSpotWebsite(value?: string | null) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return parsed.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function splitHubSpotName(fullName?: string | null) {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstname: '', lastname: '' };
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') };
}

export function buildHubSpotCompanyProperties(lead: HubSpotProspectingLead, ownerId?: string | null) {
  return compactProperties({
    address: lead.address_line_1,
    address2: lead.address_line_2,
    city: lead.city,
    country: lead.country,
    domain: extractHubSpotDomain(lead.company_website),
    hubspot_owner_id: ownerId,
    hs_lead_status: 'IN_PROGRESS',
    lifecyclestage: 'opportunity',
    name: lead.company_name,
    phone: lead.phone,
    state: lead.state,
    zip: lead.postal_code,
  });
}

export function buildHubSpotContactProperties(lead: HubSpotProspectingLead, contact: HubSpotProspectingContact, ownerId?: string | null) {
  const { firstname, lastname } = splitHubSpotName(contact.full_name);
  return compactProperties({
    address: lead.address_line_1,
    address2: lead.address_line_2,
    city: lead.city,
    country: lead.country,
    email: contact.email,
    firstname,
    company: lead.company_name,
    hubspot_owner_id: ownerId,
    hs_lead_status: 'IN_PROGRESS',
    jobtitle: contact.title,
    lastname,
    lifecyclestage: 'opportunity',
    phone: contact.phone,
    state: lead.state,
    website: normalizeHubSpotWebsite(lead.company_website),
    zip: lead.postal_code,
  });
}

export function buildHubSpotDealProperties(options: {
  dealPipeline: string;
  dealStage: string;
  lead: HubSpotProspectingLead;
  ownerId: string;
}) {
  return compactProperties({
    dealname: options.lead.company_name,
    dealstage: options.dealStage,
    hubspot_owner_id: options.ownerId,
    hs_priority: 'medium',
    pipeline: options.dealPipeline,
  });
}

export function buildHubSpotProspectingNoteBody(contacts: HubSpotProspectingContact[]) {
  const noteBlocks = contacts
    .map((contact) => {
      const notes = String(contact.notes ?? '').trim();
      if (!notes) return '';
      const name = String(contact.full_name ?? '').trim() || String(contact.email ?? '').trim() || 'Contact';
      return `<strong>${escapeHubSpotNoteHtml(name)}</strong><br>${escapeHubSpotNoteHtml(notes).replace(/\n/g, '<br>')}`;
    })
    .filter(Boolean);
  return noteBlocks.join('<br><br>');
}

function escapeHubSpotNoteHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  const companyProperties = ['name', 'domain', 'phone', 'address', 'address2', 'city', 'state', 'zip', 'country', 'hubspot_owner_id', 'hs_lead_status', 'lifecyclestage'];
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
  ], ['email', 'firstname', 'lastname', 'phone', 'jobtitle', 'address', 'address2', 'city', 'state', 'zip', 'country', 'company', 'website', 'hubspot_owner_id', 'hs_lead_status', 'lifecyclestage'], fetchImpl);
}

export async function lookupHubSpotOwnerIdByEmail(accessToken: string, email: string | null | undefined, fetchImpl?: FetchLike) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!normalizedEmail) throw new HubSpotApiError('Assigned rep email is missing; unable to match HubSpot owner.', 0);

  const data = await hubSpotRequest<HubSpotOwnersResponse>(
    `/crm/owners/2026-03?email=${encodeURIComponent(normalizedEmail)}&limit=1&archived=false`,
    accessToken,
    { fetchImpl },
  );
  const owner = data.results?.find((item) => String(item.email ?? '').trim().toLowerCase() === normalizedEmail && !item.archived);
  if (!owner?.id) throw new HubSpotApiError(`No HubSpot owner found for ${normalizedEmail}.`, 0);
  return owner.id;
}

async function upsertHubSpotObject(
  accessToken: string,
  objectType: 'companies' | 'contacts',
  properties: Record<string, string>,
  existing: HubSpotObject | null,
  fetchImpl?: FetchLike,
  overwriteProperties = ['hubspot_owner_id'],
) {
  if (existing) {
    const updateProperties = missingOnlyProperties(properties, existing.properties, overwriteProperties);
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

function dealAssociations(companyId: string, contactId: string) {
  return [
    {
      to: { id: companyId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }],
    },
    {
      to: { id: contactId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
    },
  ];
}

async function associateDealToObject(
  accessToken: string,
  dealId: string,
  toObjectType: 'companies' | 'contacts',
  toObjectId: string,
  associationTypeId: 3 | 5,
  fetchImpl?: FetchLike,
) {
  await hubSpotRequest(
    `/crm/v3/objects/deals/${dealId}/associations/${toObjectType}/${toObjectId}/${associationTypeId}`,
    accessToken,
    { fetchImpl, method: 'PUT' },
  );
}

async function upsertHubSpotDeal(options: {
  accessToken: string;
  companyId: string;
  contactId: string;
  existingDealId?: string | null;
  fetchImpl?: FetchLike;
  properties: Record<string, string>;
}) {
  const existingDealId = String(options.existingDealId ?? '').trim();
  if (existingDealId) {
    await hubSpotRequest<HubSpotObjectResponse>(`/crm/v3/objects/deals/${existingDealId}`, options.accessToken, {
      body: { properties: options.properties },
      fetchImpl: options.fetchImpl,
      method: 'PATCH',
    });
    await associateDealToObject(options.accessToken, existingDealId, 'companies', options.companyId, 5, options.fetchImpl);
    await associateDealToObject(options.accessToken, existingDealId, 'contacts', options.contactId, 3, options.fetchImpl);
    return existingDealId;
  }

  const created = await hubSpotRequest<HubSpotObjectResponse>('/crm/v3/objects/deals', options.accessToken, {
    body: {
      associations: dealAssociations(options.companyId, options.contactId),
      properties: options.properties,
    },
    fetchImpl: options.fetchImpl,
  });
  return created.id;
}

function noteAssociations(companyId: string, contactId: string, dealId: string) {
  return [
    {
      to: { id: companyId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }],
    },
    {
      to: { id: contactId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
    },
    {
      to: { id: dealId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }],
    },
  ];
}

async function associateNoteToObject(
  accessToken: string,
  noteId: string,
  toObjectType: 'companies' | 'contacts' | 'deals',
  toObjectId: string,
  associationTypeId: 190 | 202 | 214,
  fetchImpl?: FetchLike,
) {
  await hubSpotRequest(
    `/crm/v3/objects/notes/${noteId}/associations/${toObjectType}/${toObjectId}/${associationTypeId}`,
    accessToken,
    { fetchImpl, method: 'PUT' },
  );
}

async function associateNoteToRecords(
  accessToken: string,
  noteId: string,
  companyId: string,
  contactId: string,
  dealId: string,
  fetchImpl?: FetchLike,
) {
  await associateNoteToObject(accessToken, noteId, 'companies', companyId, 190, fetchImpl);
  await associateNoteToObject(accessToken, noteId, 'contacts', contactId, 202, fetchImpl);
  await associateNoteToObject(accessToken, noteId, 'deals', dealId, 214, fetchImpl);
}

async function createHubSpotProspectingNote(options: {
  accessToken: string;
  body: string;
  companyId: string;
  contactId: string;
  dealId: string;
  fetchImpl?: FetchLike;
  ownerId: string;
}) {
  const created = await hubSpotRequest<HubSpotObjectResponse>('/crm/v3/objects/notes', options.accessToken, {
    body: {
      associations: noteAssociations(options.companyId, options.contactId, options.dealId),
      properties: {
        hs_note_body: options.body,
        hs_timestamp: new Date().toISOString(),
        hubspot_owner_id: options.ownerId,
      },
    },
    fetchImpl: options.fetchImpl,
  });
  return created.id;
}

async function upsertHubSpotProspectingNote(options: {
  accessToken: string;
  body: string;
  companyId: string;
  contactId: string;
  dealId: string;
  existingNoteId?: string | null;
  fetchImpl?: FetchLike;
  ownerId: string;
}) {
  const existingNoteId = String(options.existingNoteId ?? '').trim();
  if (!existingNoteId) return createHubSpotProspectingNote(options);

  try {
    await hubSpotRequest<HubSpotObjectResponse>(`/crm/v3/objects/notes/${existingNoteId}`, options.accessToken, {
      body: {
        properties: {
          hs_note_body: options.body,
          hubspot_owner_id: options.ownerId,
        },
      },
      fetchImpl: options.fetchImpl,
      method: 'PATCH',
    });
    await associateNoteToRecords(options.accessToken, existingNoteId, options.companyId, options.contactId, options.dealId, options.fetchImpl);
    return existingNoteId;
  } catch (error) {
    if (error instanceof HubSpotApiError && error.status === 404) {
      return createHubSpotProspectingNote(options);
    }
    throw error;
  }
}

export async function pushProspectingLeadToHubSpot(options: {
  accessToken: string;
  contacts: HubSpotProspectingContact[];
  dealPipeline: string;
  dealStage: string;
  fetchImpl?: FetchLike;
  lead: HubSpotProspectingLead;
  ownerEmail?: string | null;
}): Promise<HubSpotPushResult> {
  const ownerId = await lookupHubSpotOwnerIdByEmail(options.accessToken, options.ownerEmail, options.fetchImpl);
  const companyProperties = buildHubSpotCompanyProperties(options.lead, ownerId);
  const existingCompany = await searchCompany(options.accessToken, companyProperties, options.fetchImpl);
  const companyId = await upsertHubSpotObject(options.accessToken, 'companies', companyProperties, existingCompany, options.fetchImpl, [
    'hs_lead_status',
    'hubspot_owner_id',
    'lifecyclestage',
  ]);
  const primaryContact = primaryHubSpotContact(options.contacts);
  const contactEmail = String(primaryContact?.email ?? '').trim();

  if (!primaryContact || !contactEmail) {
    return {
      companyId,
      contactId: null,
      dealId: null,
      message: 'Company pushed; missing primary contact email.',
      noteId: null,
      status: 'partial',
    };
  }

  const contactProperties = buildHubSpotContactProperties(options.lead, primaryContact, ownerId);
  const existingContact = await searchContact(options.accessToken, contactEmail, options.fetchImpl);
  const contactId = await upsertHubSpotObject(options.accessToken, 'contacts', contactProperties, existingContact, options.fetchImpl, [
    'address',
    'address2',
    'city',
    'company',
    'country',
    'hs_lead_status',
    'hubspot_owner_id',
    'lifecyclestage',
    'state',
    'website',
    'zip',
  ]);
  await associateContactToCompany(options.accessToken, contactId, companyId, options.fetchImpl);
  const dealId = await upsertHubSpotDeal({
    accessToken: options.accessToken,
    companyId,
    contactId,
    existingDealId: options.lead.hubspot_deal_id,
    fetchImpl: options.fetchImpl,
    properties: buildHubSpotDealProperties({
      dealPipeline: options.dealPipeline,
      dealStage: options.dealStage,
      lead: options.lead,
      ownerId,
    }),
  });
  const noteBody = buildHubSpotProspectingNoteBody(options.contacts);
  const noteId = noteBody
    ? await upsertHubSpotProspectingNote({
        accessToken: options.accessToken,
        body: noteBody,
        companyId,
        contactId,
        dealId,
        existingNoteId: options.lead.hubspot_note_id,
        fetchImpl: options.fetchImpl,
        ownerId,
      })
    : null;

  return {
    companyId,
    contactId,
    dealId,
    message: 'Company, primary contact, and deal pushed to HubSpot.',
    noteId,
    status: 'exported',
  };
}

export function hubSpotRecordUrl(portalId: string, objectType: 'company' | 'contact' | 'deal', id: string | null | undefined) {
  const cleanPortalId = portalId.trim();
  if (!cleanPortalId || !id) return '';
  return `https://app.hubspot.com/contacts/${cleanPortalId}/${objectType}/${id}`;
}
