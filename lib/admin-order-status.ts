import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

async function loadNewOrderCount() {
  const supabase = await createClient();
  const query = supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'New')
    .is('archived_at', null);
  const { count, error } = await query;

  if (error) {
    console.error('[admin-order-status] failed to count new orders', { error });
    return 0;
  }

  return count ?? 0;
}

/** Shared by the admin layout badge and dashboard cards during one render. */
export const getCachedNewOrderCount = cache(loadNewOrderCount);
