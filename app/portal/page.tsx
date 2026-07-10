import { PortalRestockWorkspace } from '@/components/portal-restock-workspace';
import { requireUser } from '@/lib/auth';
import { cartStorageKeyForUser } from '@/lib/cart';
import { loadPortalRestockData } from '@/lib/portal-restock-loader';
import { createClient } from '@/lib/supabase/server';

export default async function PortalPage() {
  const { user, profile } = await requireUser();
  const supabase = await createClient();
  const centerId = profile.center_id ?? user.id;
  const cartStorageKey = cartStorageKeyForUser(user.id);
  const { products, recentOrder, recurringSummary } = await loadPortalRestockData(supabase, centerId);
  const centerName = !profile.is_admin ? profile.center?.name?.trim() ?? '' : '';

  return (
    <PortalRestockWorkspace
      cartStorageKey={cartStorageKey}
      centerName={centerName}
      products={products}
      recentOrder={recentOrder}
      recurringSummary={recurringSummary}
    />
  );
}
