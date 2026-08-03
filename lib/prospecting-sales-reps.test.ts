import { describe, expect, it } from 'vitest';
import { filterProspectingSalesRepProfiles } from '@/lib/prospecting-sales-reps';

describe('Prospecting sales rep filters', () => {
  it('removes Benjamin from Prospecting sales rep options', () => {
    expect(filterProspectingSalesRepProfiles([
      { email: 'avery@example.com', full_name: 'Avery Jones', id: 'rep-a', is_active: true },
      { email: 'benjamin@example.com', full_name: 'Benjamin Stone', id: 'rep-b', is_active: true },
      { email: 'casey@example.com', full_name: 'Casey Lee', id: 'rep-c', is_active: true },
    ])).toEqual([
      { email: 'avery@example.com', full_name: 'Avery Jones', id: 'rep-a', is_active: true },
      { email: 'casey@example.com', full_name: 'Casey Lee', id: 'rep-c', is_active: true },
    ]);
  });

  it('keeps inactive reps out of Prospecting sales rep options', () => {
    expect(filterProspectingSalesRepProfiles([
      { email: 'active@example.com', full_name: 'Active Rep', id: 'rep-active', is_active: true },
      { email: 'inactive@example.com', full_name: 'Inactive Rep', id: 'rep-inactive', is_active: false },
    ])).toEqual([
      { email: 'active@example.com', full_name: 'Active Rep', id: 'rep-active', is_active: true },
    ]);
  });
});
