import { describe, expect, it, vi } from 'vitest';
import { getCenterLoginEmails } from '@/lib/center-logins';

function mockSupabaseWithProfiles(data: Array<{ email: string | null }>) {
  const query = {
    eq: vi.fn(() => query),
    order: vi.fn(() => Promise.resolve({ data })),
    select: vi.fn(() => query),
  };
  return {
    from: vi.fn(() => query),
    query,
  };
}

describe('getCenterLoginEmails', () => {
  it('trims and dedupes active center login emails case-insensitively', async () => {
    const supabase = mockSupabaseWithProfiles([
      { email: ' orders@example.com ' },
      { email: 'Orders@Example.com' },
      { email: 'billing@example.com' },
      { email: '' },
      { email: null },
    ]);

    await expect(getCenterLoginEmails(supabase, 'center-1')).resolves.toEqual([
      'orders@example.com',
      'billing@example.com',
    ]);
  });
});
