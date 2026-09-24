import { describe, expect, it } from 'vitest';
import { managerGroupForTab, managerTabFromSearch, PROSPECTING_MANAGER_TABS, reviewedBulkCountMatches } from '@/lib/prospecting-manager-navigation';

describe('prospecting manager navigation', () => {
  it('lands in Leads and keeps every legacy management capability in its group', () => {
    expect(managerTabFromSearch()).toBe('leads');
    expect(managerGroupForTab('pipeline')).toBe('leads');
    expect(managerGroupForTab('duplicates')).toBe('imports');
    expect(managerGroupForTab('add')).toBe('imports');
    expect(managerGroupForTab('samples')).toBe('samples');
    expect(managerGroupForTab('hubspot')).toBe('hubspot');
    expect(managerGroupForTab('overview')).toBe('reports');
    expect(managerGroupForTab('recycle')).toBe('reports');
    for (const tab of ['overview', 'pipeline', 'samples', 'recycle', 'add', 'leads', 'hubspot']) expect(PROSPECTING_MANAGER_TABS.map((item) => item.id)).toContain(tab);
  });
  it('resolves legacy report pagination, export queue, and import error redirects', () => {
    expect(managerTabFromSearch({ review_rep: 'rep-1' })).toBe('pipeline');
    expect(managerTabFromSearch({ sample_page: '2' })).toBe('samples');
    expect(managerTabFromSearch({ recycle_page: '2' })).toBe('recycle');
    expect(managerTabFromSearch({ tab: 'leads', bucket: 'hubspot' })).toBe('hubspot_queue');
    expect(managerTabFromSearch({ tab: 'add', toast: 'import_parse_error' })).toBe('imports');
    expect(managerTabFromSearch({ tab: 'add', toast: 'single_error' })).toBe('add');
    expect(managerTabFromSearch({ tab: 'requests', sample_page: '2' })).toBe('requests');
  });
  it('rejects missing, empty, invalid, or stale bulk review counts before mutation', () => {
    expect(reviewedBulkCountMatches('250', 250)).toBe(true);
    for (const value of [null, '', '0', '-1', '250.5', 'NaN', '249', '251']) expect(reviewedBulkCountMatches(value, 250)).toBe(false);
    expect(reviewedBulkCountMatches('0', 0)).toBe(false);
  });
});
