import { describe, expect, it } from 'vitest';
import {
  buildHubSpotCompanyProperties,
  buildHubSpotContactProperties,
  buildHubSpotDealProperties,
  buildHubSpotProspectingNoteBody,
  canPushProspectingHubSpot,
  extractHubSpotDomain,
  lookupHubSpotOwnerIdByEmail,
  normalizeHubSpotWebsite,
  pushProspectingLeadToHubSpot,
  splitHubSpotName,
  type HubSpotProspectingLead,
} from '@/lib/hubspot-prospecting';

const lead: HubSpotProspectingLead = {
  address_line_1: '123 Main St',
  address_line_2: 'Suite 4',
  city: 'Memphis',
  company_name: 'Sobrew Recovery',
  company_website: 'https://www.sobrew.example/path',
  country: 'United States',
  id: 'lead-1',
  phone: '901-555-0101',
  postal_code: '38103',
  state: 'TN',
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    text: async () => JSON.stringify(body),
  };
}

function mockHubSpotFetch(responses: unknown[]) {
  const calls: Array<{ body: unknown; method: string | undefined; url: string }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({
      body: init?.body ? JSON.parse(String(init.body)) as unknown : null,
      method: init?.method,
      url,
    });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected HubSpot request: ${url}`);
    if (next && typeof next === 'object' && '__status' in next && 'body' in next) {
      return jsonResponse((next as { body: unknown }).body, (next as { __status: number }).__status);
    }
    return jsonResponse(next);
  };
  return { calls, fetchImpl };
}

function hubSpotError(body: unknown, status: number) {
  return { __status: status, body };
}

describe('HubSpot prospecting mapping', () => {
  it('parses company website URLs into HubSpot domains', () => {
    expect(extractHubSpotDomain('https://www.example.com/path?x=1')).toBe('example.com');
    expect(extractHubSpotDomain('Example.com/about')).toBe('example.com');
    expect(extractHubSpotDomain('')).toBe('');
  });

  it('normalizes website URLs for HubSpot contact website fields', () => {
    expect(normalizeHubSpotWebsite('sobrew.example/path')).toBe('https://sobrew.example/path');
    expect(normalizeHubSpotWebsite('https://sobrew.example/')).toBe('https://sobrew.example');
    expect(normalizeHubSpotWebsite('')).toBe('');
  });

  it('splits full names into HubSpot first and last names', () => {
    expect(splitHubSpotName('Maya Patel')).toEqual({ firstname: 'Maya', lastname: 'Patel' });
    expect(splitHubSpotName('Cher')).toEqual({ firstname: 'Cher', lastname: '' });
  });

  it('copies the main company address onto the primary contact payload', () => {
    expect(buildHubSpotContactProperties(lead, {
      email: 'maya@example.com',
      full_name: 'Maya Patel',
      phone: '901-555-1212',
      title: 'Director',
    }, 'owner-1')).toMatchObject({
      address: '123 Main St',
      address2: 'Suite 4',
      city: 'Memphis',
      country: 'United States',
      email: 'maya@example.com',
      firstname: 'Maya',
      company: 'Sobrew Recovery',
      hubspot_owner_id: 'owner-1',
      hs_lead_status: 'IN_PROGRESS',
      jobtitle: 'Director',
      lastname: 'Patel',
      lifecyclestage: 'opportunity',
      state: 'TN',
      website: 'https://www.sobrew.example/path',
      zip: '38103',
    });
  });

  it('builds company fields without empty values', () => {
    expect(buildHubSpotCompanyProperties({ ...lead, address_line_2: '' }, 'owner-1')).toMatchObject({
      hs_lead_status: 'IN_PROGRESS',
      hubspot_owner_id: 'owner-1',
      lifecyclestage: 'opportunity',
    });
    expect(buildHubSpotCompanyProperties({ ...lead, address_line_2: '' }, 'owner-1')).not.toHaveProperty('address2');
  });

  it('sets HubSpot deal name to the company, stage to Samples Requested, and priority to medium', () => {
    expect(buildHubSpotDealProperties({
      dealPipeline: 'default',
      dealStage: 'appointmentscheduled',
      lead,
      ownerId: 'owner-1',
    })).toEqual({
      dealname: 'Sobrew Recovery',
      dealstage: 'appointmentscheduled',
      hubspot_owner_id: 'owner-1',
      hs_priority: 'medium',
      pipeline: 'default',
    });
  });

  it('builds one HubSpot note body from contact notes only', () => {
    expect(buildHubSpotProspectingNoteBody([
      { full_name: 'Maya Patel', notes: 'Decision maker\nLikes espresso.' },
      { email: 'ops@example.com', notes: 'Use <main> address.' },
      { full_name: 'Blank Contact', notes: '  ' },
    ])).toBe('<strong>Maya Patel</strong><br>Decision maker<br>Likes espresso.<br><br><strong>ops@example.com</strong><br>Use &lt;main&gt; address.');
  });
});

describe('HubSpot prospecting push', () => {
  it('looks up HubSpot owner IDs by email', async () => {
    const { calls, fetchImpl } = mockHubSpotFetch([
      { results: [{ archived: false, email: 'maya@example.com', id: 'owner-1' }] },
    ]);

    await expect(lookupHubSpotOwnerIdByEmail('token', 'Maya@Example.com', fetchImpl)).resolves.toBe('owner-1');
    expect(calls[0].url).toBe('https://api.hubapi.com/crm/owners/2026-03?email=maya%40example.com&limit=1&archived=false');
  });

  it('updates existing company and contact records, then associates them', async () => {
    const { calls, fetchImpl } = mockHubSpotFetch([
      { results: [{ archived: false, email: 'maya@example.com', id: 'owner-1' }] },
      { results: [{ id: 'company-1', properties: { address: '', city: 'Memphis', domain: 'sobrew.example', hs_lead_status: 'OPEN', hubspot_owner_id: 'owner-2', lifecyclestage: 'lead', name: 'Sobrew Recovery' } }] },
      { id: 'company-1' },
      { results: [{ id: 'contact-1', properties: { address: 'Old contact address', city: 'Old City', company: 'Old Company', email: 'maya@example.com', firstname: 'Maya', hs_lead_status: 'OPEN', hubspot_owner_id: 'owner-2', lastname: '', lifecyclestage: 'lead', website: 'https://old.example' } }] },
      { id: 'contact-1' },
      {},
      { id: 'deal-1' },
    ]);

    await expect(pushProspectingLeadToHubSpot({
      accessToken: 'token',
      contacts: [{ email: 'maya@example.com', full_name: 'Maya Patel', is_primary: true }],
      dealPipeline: 'default',
      dealStage: 'appointmentscheduled',
      fetchImpl,
      lead,
      ownerEmail: 'maya@example.com',
    })).resolves.toEqual({
      companyId: 'company-1',
      contactId: 'contact-1',
      dealId: 'deal-1',
      message: 'Company, primary contact, and deal pushed to HubSpot.',
      noteId: null,
      status: 'exported',
    });

    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST', 'PATCH', 'POST', 'PATCH', 'POST', 'POST']);
    expect(calls[2].body).toEqual({ properties: expect.objectContaining({ address: '123 Main St', hs_lead_status: 'IN_PROGRESS', hubspot_owner_id: 'owner-1', lifecyclestage: 'opportunity' }) });
    expect(calls[2].body).toEqual({ properties: expect.not.objectContaining({ city: 'Memphis' }) });
    expect(calls[4].body).toEqual({
      properties: expect.objectContaining({
        address: '123 Main St',
        address2: 'Suite 4',
        city: 'Memphis',
        company: 'Sobrew Recovery',
        country: 'United States',
        hs_lead_status: 'IN_PROGRESS',
        hubspot_owner_id: 'owner-1',
        lastname: 'Patel',
        lifecyclestage: 'opportunity',
        state: 'TN',
        website: 'https://www.sobrew.example/path',
        zip: '38103',
      }),
    });
    expect(calls[4].body).toEqual({ properties: expect.not.objectContaining({ firstname: 'Maya' }) });
    expect(calls[5].body).toEqual({
      inputs: [{
        from: { id: 'contact-1' },
        to: { id: 'company-1' },
        type: 'contact_to_company',
      }],
    });
    expect(calls[6].url).toBe('https://api.hubapi.com/crm/v3/objects/deals');
    expect(calls[6].body).toEqual({
      associations: [
        {
          to: { id: 'company-1' },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }],
        },
        {
          to: { id: 'contact-1' },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
        },
      ],
      properties: {
        dealname: 'Sobrew Recovery',
        dealstage: 'appointmentscheduled',
        hs_priority: 'medium',
        hubspot_owner_id: 'owner-1',
        pipeline: 'default',
      },
    });
  });

  it('creates new company and contact records when no duplicates are found', async () => {
    const { calls, fetchImpl } = mockHubSpotFetch([
      { results: [{ archived: false, email: 'maya@example.com', id: 'owner-1' }] },
      { results: [] },
      { results: [] },
      { results: [] },
      { id: 'company-2' },
      { results: [] },
      { id: 'contact-2' },
      {},
      { id: 'deal-2' },
    ]);

    const result = await pushProspectingLeadToHubSpot({
      accessToken: 'token',
      contacts: [{ email: 'maya@example.com', full_name: 'Maya Patel', is_primary: true }],
      dealPipeline: 'default',
      dealStage: 'appointmentscheduled',
      fetchImpl,
      lead: { ...lead, company_website: null },
      ownerEmail: 'maya@example.com',
    });

    expect(result).toMatchObject({ companyId: 'company-2', contactId: 'contact-2', dealId: 'deal-2', noteId: null, status: 'exported' });
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/companies') && call.method === 'POST')).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/contacts') && call.method === 'POST')).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/deals') && call.method === 'POST')).toBe(true);
    expect(calls.find((call) => call.url.endsWith('/crm/v3/objects/companies'))?.body).toEqual({ properties: expect.objectContaining({ hubspot_owner_id: 'owner-1' }) });
  });

  it('updates a stored HubSpot deal instead of creating a duplicate', async () => {
    const { calls, fetchImpl } = mockHubSpotFetch([
      { results: [{ archived: false, email: 'maya@example.com', id: 'owner-1' }] },
      { results: [{ id: 'company-1', properties: { address: '123 Main St', address2: 'Suite 4', city: 'Memphis', country: 'United States', domain: 'sobrew.example', hs_lead_status: 'IN_PROGRESS', hubspot_owner_id: 'owner-1', lifecyclestage: 'opportunity', name: 'Sobrew Recovery', phone: '901-555-0101', state: 'TN', zip: '38103' } }] },
      { results: [{ id: 'contact-1', properties: { address: '123 Main St', address2: 'Suite 4', city: 'Memphis', company: 'Sobrew Recovery', country: 'United States', email: 'maya@example.com', hs_lead_status: 'IN_PROGRESS', hubspot_owner_id: 'owner-1', lifecyclestage: 'opportunity', state: 'TN', website: 'https://www.sobrew.example/path', zip: '38103' } }] },
      {},
      { id: 'deal-1' },
      {},
      {},
      {},
      {},
      {},
    ]);

    const result = await pushProspectingLeadToHubSpot({
      accessToken: 'token',
      contacts: [{ email: 'maya@example.com', full_name: 'Maya Patel', is_primary: true }],
      dealPipeline: 'default',
      dealStage: 'appointmentscheduled',
      fetchImpl,
      lead: { ...lead, hubspot_deal_id: 'deal-1' },
      ownerEmail: 'maya@example.com',
    });

    expect(result).toMatchObject({ dealId: 'deal-1', status: 'exported' });
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/deals') && call.method === 'POST')).toBe(false);
    expect(calls.find((call) => call.url.endsWith('/crm/v3/objects/deals/deal-1'))?.body).toEqual({
      properties: {
        dealname: 'Sobrew Recovery',
        dealstage: 'appointmentscheduled',
        hubspot_owner_id: 'owner-1',
        hs_priority: 'medium',
        pipeline: 'default',
      },
    });
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/deals/deal-1/associations/companies/company-1/5') && call.method === 'PUT')).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/deals/deal-1/associations/contacts/contact-1/3') && call.method === 'PUT')).toBe(true);
  });

  it('creates the company only and keeps the result actionable when the primary contact email is missing', async () => {
    const { calls, fetchImpl } = mockHubSpotFetch([
      { results: [{ archived: false, email: 'maya@example.com', id: 'owner-1' }] },
      { results: [] },
      { results: [] },
      { results: [] },
      { results: [] },
      { id: 'company-3' },
    ]);

    await expect(pushProspectingLeadToHubSpot({
      accessToken: 'token',
      contacts: [{ full_name: 'Maya Patel', is_primary: true }],
      dealPipeline: 'default',
      dealStage: 'appointmentscheduled',
      fetchImpl,
      lead,
      ownerEmail: 'maya@example.com',
    })).resolves.toEqual({
      companyId: 'company-3',
      contactId: null,
      dealId: null,
      message: 'Company pushed; missing primary contact email.',
      noteId: null,
      status: 'partial',
    });

    expect(calls.map((call) => call.url)).not.toContain('https://api.hubapi.com/crm/v3/objects/contacts');
    expect(calls.map((call) => call.url)).not.toContain('https://api.hubapi.com/crm/v3/objects/deals');
    expect(calls.find((call) => call.url.endsWith('/crm/v3/objects/companies'))?.body).toEqual({ properties: expect.objectContaining({ hubspot_owner_id: 'owner-1' }) });
  });

  it('creates one HubSpot note and associates it to company, contact, and deal', async () => {
    const { calls, fetchImpl } = mockHubSpotFetch([
      { results: [{ archived: false, email: 'maya@example.com', id: 'owner-1' }] },
      { results: [{ id: 'company-1', properties: { address: '123 Main St', city: 'Memphis', domain: 'sobrew.example', hubspot_owner_id: 'owner-2', name: 'Sobrew Recovery' } }] },
      { id: 'company-1' },
      { results: [{ id: 'contact-1', properties: { email: 'maya@example.com', hubspot_owner_id: 'owner-2' } }] },
      { id: 'contact-1' },
      {},
      { id: 'deal-1' },
      { id: 'note-1' },
    ]);

    const result = await pushProspectingLeadToHubSpot({
      accessToken: 'token',
      contacts: [
        { email: 'maya@example.com', full_name: 'Maya Patel', is_primary: true, notes: 'Decision maker.' },
        { full_name: 'Sam Rivera', notes: 'Handles samples.' },
      ],
      dealPipeline: 'default',
      dealStage: 'appointmentscheduled',
      fetchImpl,
      lead,
      ownerEmail: 'maya@example.com',
    });

    expect(result).toMatchObject({ noteId: 'note-1', status: 'exported' });
    const noteCreate = calls.find((call) => call.url.endsWith('/crm/v3/objects/notes'));
    expect(noteCreate?.body).toEqual({
      associations: [
        { to: { id: 'company-1' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }] },
        { to: { id: 'contact-1' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] },
        { to: { id: 'deal-1' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }] },
      ],
      properties: expect.objectContaining({
        hs_note_body: '<strong>Maya Patel</strong><br>Decision maker.<br><br><strong>Sam Rivera</strong><br>Handles samples.',
        hubspot_owner_id: 'owner-1',
      }),
    });
  });

  it('updates a stored HubSpot note and reassociates it to all pushed records', async () => {
    const { calls, fetchImpl } = mockHubSpotFetch([
      { results: [{ archived: false, email: 'maya@example.com', id: 'owner-1' }] },
      { results: [{ id: 'company-1', properties: { address: '123 Main St', address2: 'Suite 4', city: 'Memphis', country: 'United States', domain: 'sobrew.example', hs_lead_status: 'IN_PROGRESS', hubspot_owner_id: 'owner-1', lifecyclestage: 'opportunity', name: 'Sobrew Recovery', phone: '901-555-0101', state: 'TN', zip: '38103' } }] },
      { results: [{ id: 'contact-1', properties: { address: '123 Main St', address2: 'Suite 4', city: 'Memphis', company: 'Sobrew Recovery', country: 'United States', email: 'maya@example.com', hs_lead_status: 'IN_PROGRESS', hubspot_owner_id: 'owner-1', lifecyclestage: 'opportunity', state: 'TN', website: 'https://www.sobrew.example/path', zip: '38103' } }] },
      {},
      { id: 'deal-1' },
      {},
      {},
      {},
      {},
      {},
      {},
      {},
    ]);

    const result = await pushProspectingLeadToHubSpot({
      accessToken: 'token',
      contacts: [{ email: 'maya@example.com', full_name: 'Maya Patel', is_primary: true, notes: 'Updated note.' }],
      dealPipeline: 'default',
      dealStage: 'appointmentscheduled',
      fetchImpl,
      lead: { ...lead, hubspot_deal_id: 'deal-1', hubspot_note_id: 'note-1' },
      ownerEmail: 'maya@example.com',
    });

    expect(result).toMatchObject({ noteId: 'note-1', status: 'exported' });
    expect(calls.find((call) => call.url.endsWith('/crm/v3/objects/notes/note-1'))?.body).toEqual({
      properties: {
        hs_note_body: '<strong>Maya Patel</strong><br>Updated note.',
        hubspot_owner_id: 'owner-1',
      },
    });
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/notes/note-1/associations/companies/company-1/190') && call.method === 'PUT')).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/notes/note-1/associations/contacts/contact-1/202') && call.method === 'PUT')).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/notes/note-1/associations/deals/deal-1/214') && call.method === 'PUT')).toBe(true);
  });

  it('creates a replacement HubSpot note when the stored note was deleted', async () => {
    const { calls, fetchImpl } = mockHubSpotFetch([
      { results: [{ archived: false, email: 'maya@example.com', id: 'owner-1' }] },
      { results: [{ id: 'company-1', properties: { address: '123 Main St', address2: 'Suite 4', city: 'Memphis', country: 'United States', domain: 'sobrew.example', hs_lead_status: 'IN_PROGRESS', hubspot_owner_id: 'owner-1', lifecyclestage: 'opportunity', name: 'Sobrew Recovery', phone: '901-555-0101', state: 'TN', zip: '38103' } }] },
      { results: [{ id: 'contact-1', properties: { address: '123 Main St', address2: 'Suite 4', city: 'Memphis', company: 'Sobrew Recovery', country: 'United States', email: 'maya@example.com', hs_lead_status: 'IN_PROGRESS', hubspot_owner_id: 'owner-1', lifecyclestage: 'opportunity', state: 'TN', website: 'https://www.sobrew.example/path', zip: '38103' } }] },
      {},
      { id: 'deal-1' },
      {},
      {},
      {},
      hubSpotError({ message: 'Not found' }, 404),
      { id: 'note-2' },
    ]);

    const result = await pushProspectingLeadToHubSpot({
      accessToken: 'token',
      contacts: [{ email: 'maya@example.com', full_name: 'Maya Patel', is_primary: true, notes: 'Fresh note.' }],
      dealPipeline: 'default',
      dealStage: 'appointmentscheduled',
      fetchImpl,
      lead: { ...lead, hubspot_deal_id: 'deal-1', hubspot_note_id: 'deleted-note' },
      ownerEmail: 'maya@example.com',
    });

    expect(result).toMatchObject({ noteId: 'note-2', status: 'exported' });
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/notes/deleted-note') && call.method === 'PATCH')).toBe(true);
    expect(calls.find((call) => call.url.endsWith('/crm/v3/objects/notes') && call.method === 'POST')?.body).toEqual({
      associations: [
        { to: { id: 'company-1' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }] },
        { to: { id: 'contact-1' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] },
        { to: { id: 'deal-1' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }] },
      ],
      properties: expect.objectContaining({
        hs_note_body: '<strong>Maya Patel</strong><br>Fresh note.',
        hubspot_owner_id: 'owner-1',
      }),
    });
  });

  it('does not create or update records when the assigned rep has no HubSpot owner match', async () => {
    const { calls, fetchImpl } = mockHubSpotFetch([
      { results: [] },
    ]);

    await expect(pushProspectingLeadToHubSpot({
      accessToken: 'token',
      contacts: [{ email: 'maya@example.com', full_name: 'Maya Patel', is_primary: true }],
      dealPipeline: 'default',
      dealStage: 'appointmentscheduled',
      fetchImpl,
      lead,
      ownerEmail: 'missing@example.com',
    })).rejects.toThrow('No HubSpot owner found for missing@example.com.');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/crm/owners/2026-03');
  });

  it('only allows SuperAdmin owner access to HubSpot push', () => {
    expect(canPushProspectingHubSpot({ isOwner: true, isSuperadmin: true })).toBe(true);
    expect(canPushProspectingHubSpot({ isOwner: false, isSuperadmin: false })).toBe(false);
  });
});
