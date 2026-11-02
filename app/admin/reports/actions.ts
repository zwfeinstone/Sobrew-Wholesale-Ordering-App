'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { invalidateReportData } from '@/lib/report-cache-invalidation';

/** Refreshes query data only; the resulting render checks current permissions. */
export async function refreshReportData() {
  await requireAdminSectionView('reports');
  invalidateReportData();
  revalidatePath('/admin/reports');
}
