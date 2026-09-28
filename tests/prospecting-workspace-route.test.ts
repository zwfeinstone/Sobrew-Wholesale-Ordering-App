import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ enabled: true, redirect: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    state.redirect(href);
    throw new Error('Workspace redirect');
  },
}));
vi.mock('@/lib/prospecting-rollout', () => ({ isProspectingWorkspaceEnabled: () => state.enabled }));
vi.mock('@/app/admin/sales/prospecting/[id]/legacy-page', () => ({
  default: () => createElement('section', null, 'Legacy lead detail'),
}));

import LeadDetailPage from '@/app/admin/sales/prospecting/[id]/page';
import LegacyLeadDetailPage from '@/app/admin/sales/prospecting/[id]/legacy-page';

const leadId = '22222222-2222-4222-8222-222222222222';
const otherLeadId = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  state.enabled = true;
  state.redirect.mockClear();
});

describe('prospecting saved record URLs', () => {
  it('redirects to the workspace while preserving record, queue, and manager return parameters', async () => {
    const search = {
      sample: '1',
      history_page: '3',
      activity: 'email',
      fresh: '1',
      tab: 'pipeline',
      stage: 'working',
      state: 'IL',
      page: '2',
      page_size: '25',
      q: 'Recovery & treatment',
      origin: 'leads',
      return_to: '/admin/sales/prospecting/admin?tab=pipeline&state=IL&page=2',
      repeated: ['first', 'second & third'],
      lead: [otherLeadId, 'conflicting-query-record'],
      omitted: undefined,
    };
    await expect(LeadDetailPage({ params: Promise.resolve({ id: leadId }), searchParams: Promise.resolve(search) })).rejects.toThrow('Workspace redirect');

    expect(state.redirect).toHaveBeenCalledOnce();
    const target = new URL(state.redirect.mock.calls[0][0], 'https://example.test');
    expect(target.pathname).toBe('/admin/sales/prospecting');
    expect(target.searchParams.getAll('lead')).toEqual([leadId]);
    expect(target.searchParams.getAll('repeated')).toEqual(search.repeated);
    expect(target.searchParams.has('omitted')).toBe(false);
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === 'string') expect(target.searchParams.get(key), key).toBe(value);
    }
  });

  it('opens a saved record URL without requiring any queue parameters', async () => {
    await expect(LeadDetailPage({ params: Promise.resolve({ id: leadId }) })).rejects.toThrow('Workspace redirect');
    expect(state.redirect).toHaveBeenCalledWith(`/admin/sales/prospecting?lead=${leadId}`);
  });

  it('renders the legacy page with its original props when the workspace is disabled', async () => {
    state.enabled = false;
    const props = {
      params: Promise.resolve({ id: leadId }),
      searchParams: Promise.resolve({ tab: 'tasks', sample: '1', lead: otherLeadId }),
    };
    const result = await LeadDetailPage(props);
    expect(isValidElement(result)).toBe(true);
    expect(result.type).toBe(LegacyLeadDetailPage);
    expect(result.props).toEqual(props);
    expect(renderToStaticMarkup(result)).toContain('Legacy lead detail');
    expect(state.redirect).not.toHaveBeenCalled();
  });
});
