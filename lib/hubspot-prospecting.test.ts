import { describe, expect, it } from 'vitest';
import {
  buildHubSpotCompanyProperties,
  buildHubSpotContactProperties,
  canPushProspectingHubSpot,
  extractHubSpotDomain,
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
    return jsonResponse(next);
  };
  return { calls, fetchImpl };
}

describe('HubSpot prospecting mapping', () => {
  it('parses company website URLs into HubSpot domains', () => {
    expect(extractHubSpotDomain('https://www.example.com/path?x=1')).toBe('example.com');
    expect(extractHubSpotDomain('Example.com/about')).toBe('example.com');
    expect(extractHubSpotDomain('')).toBe('');
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
    })).toMatchObject({
      address: '123 Main St',
      address2: 'Suite 4',
      city: 'Memphis',
      country: 'United States',
      email: 'maya@example.com',
      firstname: 'Maya',
      jobtitle: 'Director',
      lastname: 'Patel',
      state: 'TN',
      zip: '38103',
    });
  });

  it('builds company fields without empty values', () => {
    expect(buildHubSpotCompanyProperties({ ...lead, address_line_2: '' })).not.toHaveProperty('address2');
  });
});

describe('HubSpot prospecting push', () => {
  it('updates existing company and contact records, then associates them', async () => {
    const { calls, fetchImpl } = mockHubSpotFetch([
      { results: [{ id: 'company-1', properties: { address: '', domain: 'sobrew.example', name: 'Sobrew Recovery' } }] },
      { id: 'company-1' },
      { results: [{ id: 'contact-1', properties: { email: 'maya@example.com', firstname: 'Maya', lastname: '' } }] },
      { id: 'contact-1' },
      {},
    ]);

    await expect(pushProspectingLeadToHubSpot({
      accessToken: 'token',
      contacts: [{ email: 'maya@example.com', full_name: 'Maya Patel', is_primary: true }],
      fetchImpl,
      lead,
    })).resolves.toEqual({
      companyId: 'company-1',
      contactId: 'contact-1',
      message: 'Company and primary contact pushed to HubSpot.',
      status: 'exported',
    });

    expect(calls.map((call) => call.method)).toEqual(['POST', 'PATCH', 'POST', 'PATCH', 'POST']);
    expect(calls[1].body).toEqual({ properties: expect.objectContaining({ address: '123 Main St' }) });
    expect(calls[3].body).toEqual({ properties: expect.objectContaining({ lastname: 'Patel' }) });
    expect(calls[4].body).toEqual({
      inputs: [{
        from: { id: 'contact-1' },
        to: { id: 'company-1' },
        type: 'contact_to_company',
      }],
    });
  });

  it('creates new company and contact records when no duplicates are found', async () => {
    const { calls, fetchImpl } = mockHubSpotFetch([
      { results: [] },
      { results: [] },
      { results: [] },
      { id: 'company-2' },
      { results: [] },
      { id: 'contact-2' },
      {},
    ]);

    const result = await pushProspectingLeadToHubSpot({
      accessToken: 'token',
      contacts: [{ email: 'maya@example.com', full_name: 'Maya Patel', is_primary: true }],
      fetchImpl,
      lead: { ...lead, company_website: null },
    });

    expect(result).toMatchObject({ companyId: 'company-2', contactId: 'contact-2', status: 'exported' });
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/companies') && call.method === 'POST')).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/contacts') && call.method === 'POST')).toBe(true);
  });

  it('creates the company only and keeps the result actionable when the primary contact email is missing', async () => {
    const { calls, fetchImpl } = mockHubSpotFetch([
      { results: [] },
      { results: [] },
      { results: [] },
      { results: [] },
      { id: 'company-3' },
    ]);

    await expect(pushProspectingLeadToHubSpot({
      accessToken: 'token',
      contacts: [{ full_name: 'Maya Patel', is_primary: true }],
      fetchImpl,
      lead,
    })).resolves.toEqual({
      companyId: 'company-3',
      contactId: null,
      message: 'Company pushed; missing primary contact email.',
      status: 'partial',
    });

    expect(calls.map((call) => call.url)).not.toContain('https://api.hubapi.com/crm/v3/objects/contacts');
  });

  it('only allows SuperAdmin owner access to HubSpot push', () => {
    expect(canPushProspectingHubSpot({ isOwner: true, isSuperadmin: true })).toBe(true);
    expect(canPushProspectingHubSpot({ isOwner: false, isSuperadmin: false })).toBe(false);
  });
});
