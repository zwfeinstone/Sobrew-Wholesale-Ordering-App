import { cache } from 'react';
import { scopeCenterRelatedQueryForAdmin } from '@/lib/admin-center-scope';
import { getCurrentAdminAccess } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';

async function loadNewOrderCount() {
  const [supabase, current] = await Promise.all([
    createClient(),
    getCurrentAdminAccess(),
  ]);
  const query = scopeCenterRelatedQueryForAdmin(
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'New').is('archived_at', null),
    'center_id',
    current.centerScope,
  );
  const { count, error } = await query;

  if (error) {
    console.error('[admin-order-status] failed to count new orders', { error });
    return 0;
  }

  return count ?? 0;
}

/** Shared by the admin layout badge and dashboard cards during one render. */
export const getCachedNewOrderCount = cache(loadNewOrderCount);
