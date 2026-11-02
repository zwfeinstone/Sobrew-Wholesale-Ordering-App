import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_NAV_LINKS, ADMIN_ROLE_PRESETS, adminSectionForPath, canViewAdminSection } from '@/lib/admin-permission-definitions';
import { buildSampleQuoteEmail } from '@/lib/prospecting-sample-quote';

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), current: { profile: { id: 'rep' }, isOwner: true }, permission: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ prefetch: _prefetch, ...props }: Record<string, unknown>) => createElement('a', props) }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not-found'); } }));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: mocks.permission }));
vi.mock('@/lib/center-pricing', async importOriginal => ({ ...await importOriginal<object>(), loadCenterPricingList: mocks.list, loadCenterPricingDetail: mocks.detail }));

import ListPage from '@/app/admin/center-pricing/page';
import DetailPage from '@/app/admin/center-pricing/[id]/page';

const center = {
  id: '11111111-1111-4111-8111-111111111111', company_name: 'Lakeview Recovery', city: 'Chicago', state: 'IL', stage: 'sample_requested', archived_at: null,
  assigned_profile_id: 'rep', owner: { full_name: 'Haskins', email: 'haskins@sobrew.com' }, quotes: [{ id: 'quote', sent_at: '2026-10-15T15:24:13Z' }],
};
const content = buildSampleQuoteEmail({ contactName: 'Ron Buyer', greetingName: 'Ron', senderName: 'Haskins', trackingNumber: '1Z12345', lines: [{ id: 'bulk-regular', priceCents: 3500 }, { id: 'filter-1-5oz', priceCents: 4200 }] });
const email = { id: 'quote', subject: content.subject, body_html: content.html, body_text: content.text, sender_name: 'Haskins', sender_email: 'haskins@sobrew.com', recipient_name: 'Ron Buyer', recipient_email: 'ron@example.test', sent_at: '2026-10-15T15:24:13Z', tracking_number: '1Z12345' };
const renderList = (params = {}) => ListPage({ searchParams: Promise.resolve(params) }).then(renderToStaticMarkup);
const renderDetail = () => DetailPage({ params: Promise.resolve({ id: center.id }), searchParams: Promise.resolve({}) }).then(renderToStaticMarkup);

beforeEach(() => {
  vi.clearAllMocks(); mocks.current.isOwner = true;
  mocks.permission.mockResolvedValue(mocks.current);
  mocks.list.mockResolvedValue({ ok: true, centers: [center], total: 27 });
  mocks.detail.mockResolvedValue({ ok: true, center, emails: [email], total: 1 });
});

describe('Center Pricing screens', () => {
  it('uses existing prospecting permissions for navigation and direct URLs', async () => {
    const link = ADMIN_NAV_LINKS.find(link => link.name === 'Center Pricing')!;
    expect(link).toMatchObject({ href: '/admin/center-pricing', sectionKey: 'prospecting' });
    expect(adminSectionForPath(`${link.href}/${center.id}`)).toBe('prospecting');
    expect(canViewAdminSection(ADMIN_ROLE_PRESETS.find(role => role.key === 'sales')!.permissions, link.sectionKey)).toBe(true);
    expect(canViewAdminSection(ADMIN_ROLE_PRESETS.find(role => role.key === 'marketing')!.permissions, link.sectionKey)).toBe(false);
    mocks.permission.mockRejectedValue(new Error('access-denied'));
    await expect(renderList()).rejects.toThrow('access-denied');
    await expect(renderDetail()).rejects.toThrow('access-denied');
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('lists one link per center without embedding the email bodies, and keeps filters across pages', async () => {
    const html = await renderList({ q: 'Recovery', status: 'sent' });
    expect(html).toContain(`href="/admin/center-pricing/${center.id}"`);
    expect(html).not.toContain('No sent email recorded');
    expect(html).not.toContain('Pricing status');
    expect(html).toContain('Centers with sent pricing emails');
    expect(html).toContain('Assigned to Haskins');
    expect(html).toContain('q=Recovery&amp;page=2');
    expect(html).not.toContain('<iframe');
    expect(mocks.permission).toHaveBeenCalledWith('prospecting');
    expect(mocks.list).toHaveBeenCalledWith({ actorId: 'rep', isOwner: true }, { search: 'Recovery', page: 1 });
  });

  it('passes a rep’s current identity to both scoped readers', async () => {
    mocks.current.isOwner = false;
    expect(await renderList()).toContain('Centers with sent pricing emails currently assigned to you');
    await renderDetail();
    expect(mocks.list).toHaveBeenCalledWith({ actorId: 'rep', isOwner: false }, expect.any(Object));
    expect(mocks.detail).toHaveBeenCalledWith({ actorId: 'rep', isOwner: false }, center.id, 1);
  });

  it('shows the immutable saved email in a sandbox with sender, recipient and date', async () => {
    const html = await renderDetail();
    expect(html).toContain('sandbox=""');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('ron@example.test');
    expect(html).toContain('haskins@sobrew.com');
    expect(html).toContain('1Z12345');
    expect(html).toContain('$35.00');
    expect(html).toContain('View plain text email');
    expect(html).not.toContain('Send samples');
  });

  it('returns not found for another rep’s center instead of displaying its name or emails', async () => {
    mocks.detail.mockResolvedValue({ ok: false, unavailable: true });
    await expect(renderDetail()).rejects.toThrow('not-found');
  });

  it('distinguishes no recorded email from a failed lookup', async () => {
    mocks.detail.mockResolvedValue({ ok: true, center, emails: [], total: 0 });
    expect(await renderDetail()).toContain('No sent pricing email recorded');
    mocks.detail.mockResolvedValue({ ok: false, error: 'The saved pricing emails could not be loaded.' });
    expect(await renderDetail()).toContain('role="alert"');
    mocks.list.mockResolvedValue({ ok: false, error: 'Center pricing could not be loaded.' });
    const failed = await renderList();
    expect(failed).toContain('role="alert"'); expect(failed).not.toContain('No centers found');
  });

  it('renders reviewable list and email screens', async () => {
    const screens = { list: await renderList(), detail: await renderDetail() };
    for (const [name, html] of Object.entries(screens)) {
      expect(html).toContain('Lakeview Recovery');
      if (process.env.GENERATE_CENTER_PRICING_PREVIEWS === '1') {
        const directory = '/tmp/sobrew-center-pricing-preview';
        mkdirSync(directory, { recursive: true });
        writeFileSync(`${directory}/${name}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Center Pricing · sample data</title><link rel="stylesheet" href="styles.css"><style>body{font-family:Arial,sans-serif;padding:24px;max-width:1200px;margin:auto}@media(max-width:600px){body{padding:12px}}</style></head><body>${html}</body></html>`);
      }
    }
  });
});
