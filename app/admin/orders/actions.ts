'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdminSectionEdit } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';

export async function moveOrderToTrash(formData: FormData) {
  await requireAdminSectionEdit('orders', '/admin/orders?toast=admin_write_denied');
  const id = String(formData.get('id') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (!id || !reason || reason.length > 1000) redirect('/admin/orders?toast=trash_reason_required');
  const supabase = await createClient();
  const { error } = await supabase.rpc('move_order_to_trash', { p_order_id: id, p_reason: reason });
  if (error) {
    console.error('[orders] move to trash failed', { code: error.code, message: error.message });
    redirect('/admin/orders?toast=trash_error');
  }
  revalidatePath('/admin', 'layout');
  revalidatePath('/portal/orders');
  redirect('/admin/orders?toast=order_trashed');
}

export async function restoreOrderFromTrash(formData: FormData) {
  await requireAdminSectionEdit('orders', '/admin/orders?toast=admin_write_denied');
  const trashId = String(formData.get('trash_id') ?? '').trim();
  if (!trashId) redirect('/admin/orders/trash?toast=restore_error');
  const supabase = await createClient();
  const { data: orderId, error } = await supabase.rpc('restore_order_from_trash', { p_trash_id: trashId });
  if (error || !orderId) {
    console.error('[orders] restore failed', { code: error?.code, message: error?.message });
    const reason = error?.message?.includes('inventory') ? 'restore_inventory_required' : 'restore_error';
    redirect(`/admin/orders/trash?toast=${reason}`);
  }
  revalidatePath('/admin', 'layout');
  revalidatePath('/portal/orders');
  redirect(`/admin/orders/${orderId}?toast=order_restored`);
}

export async function archiveSelectedOrders(formData: FormData) {
  const current = await requireAdminSectionEdit('orders', '/admin/orders?toast=admin_write_denied');
  if (!current.isOwner) redirect('/admin/orders?toast=archive_denied');
  const ids = [...new Set(formData.getAll('order_id').map(String).filter(Boolean))];
  if (!ids.length || ids.length > 1000) redirect('/admin/orders?toast=archive_error');
  const supabase = await createClient();
  const result = await supabase.from('orders').update({ archived_at: new Date().toISOString() }).in('id', ids).in('status', ['Processing', 'Shipped']).is('archived_at', null).select('id');
  if (result.error || !result.data?.length) redirect('/admin/orders?toast=archive_error');
  revalidatePath('/admin', 'layout');
  redirect('/admin/orders?toast=archive_success');
}
