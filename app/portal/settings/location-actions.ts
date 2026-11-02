'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { parsePortalLocationForm, type PortalLocationFormState } from '@/lib/portal-locations';
import { createClient } from '@/lib/supabase/server';

async function saveLocation(formData: FormData, updating: boolean): Promise<PortalLocationFormState> {
  const { profile } = await requireUser();
  const centerId = profile.center_id;
  if (!centerId || profile.is_admin !== false || profile.is_active !== true || profile.center?.is_active !== true) {
    return { status: 'error', message: 'An active customer account is required to manage delivery locations.' };
  }
  const { location, error: validationError } = parsePortalLocationForm(formData);
  if (validationError) return { status: 'error', message: validationError };
  const locationId = formData.get('location_id');
  if (updating && (typeof locationId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(locationId))) {
    return { status: 'error', message: 'This location is unavailable. Refresh your account page and try again.' };
  }

  try {
    const supabase = await createClient();
    const query = updating
      ? supabase.from('center_locations').update(location).eq('id', locationId as string).eq('center_id', centerId).eq('is_active', true)
      : supabase.from('center_locations').insert({ ...location, center_id: centerId, is_active: true });
    const { data, error } = await query.select('id').maybeSingle();
    if (error || !data) {
      return { status: 'error', message: 'We couldn’t save this location. Check that it is still available and try again.' };
    }
  } catch {
    return { status: 'error', message: 'We couldn’t save this location right now. Please try again.' };
  }
  revalidatePath('/portal/settings');
  revalidatePath('/portal/checkout');
  return { status: 'success', message: updating ? 'Delivery address updated.' : 'Delivery location added. It is ready to use at checkout.' };
}

export async function addPortalLocation(_previousState: PortalLocationFormState, formData: FormData) {
  return saveLocation(formData, false);
}

export async function updatePortalLocation(_previousState: PortalLocationFormState, formData: FormData) {
  return saveLocation(formData, true);
}
