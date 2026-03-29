import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AdminShell } from '@/components/admin-shell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const supabase = await createClient();
  const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'New').is('archived_at', null);

  return <AdminShell newOrders={count ?? 0}>{children}</AdminShell>;
}
