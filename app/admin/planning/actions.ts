'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { recordRecipeProductionRun } from '@/lib/inventory-production';
import { planningReturnHref } from '@/lib/production-planning-view';
import { createClient } from '@/lib/supabase/server';

export async function producePlannedInventory(formData: FormData) {
  await requireAdminWriteAccess(planningReturnHref(formData, 'admin_write_denied'), 'planning');
  const productId = String(formData.get('product_id') ?? '');
  const quantityProduced = Number(formData.get('quantity_produced'));
  if (!productId || !Number.isSafeInteger(quantityProduced) || quantityProduced <= 0) {
    redirect(planningReturnHref(formData, 'invalid_quantity'));
  }
  const result = await recordRecipeProductionRun({
    notes: 'Completed production recorded from the daily production plan.',
    productId,
    quantityProduced,
    supabase: await createClient(),
  });
  if (!result.error) {
    revalidatePath('/admin/planning');
    revalidatePath('/admin/production');
    revalidatePath('/admin/inventory');
  }
  redirect(planningReturnHref(formData, result.error ?? 'production_recorded'));
}

export async function updateCenterParLevel(formData: FormData) {
  await requireAdminWriteAccess(planningReturnHref(formData, 'admin_write_denied'), 'planning');
  const centerId = String(formData.get('center_id') ?? '');
  const productId = String(formData.get('product_id') ?? '');
  const parQty = Number(formData.get('par_qty'));
  const minimumQty = Number(formData.get('minimum_qty'));
  if (!centerId || !productId || ![parQty, minimumQty].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    redirect(planningReturnHref(formData, 'par_error'));
  }
  const supabase = await createClient();
  const { error } = await supabase.from('inventory_center_par_levels').upsert({
    center_id: centerId,
    product_id: productId,
    par_qty: parQty,
    minimum_qty: minimumQty,
    notes: String(formData.get('notes') ?? '').trim() || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'center_id,product_id' });
  if (!error) revalidatePath('/admin/planning');
  redirect(planningReturnHref(formData, error ? 'par_error' : 'par_saved'));
}
