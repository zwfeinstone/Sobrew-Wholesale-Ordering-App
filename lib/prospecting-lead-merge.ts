import type { TablesUpdate } from '@/lib/supabase/database.types';

type MergeFields = 'address_line_1' | 'address_line_2' | 'assigned_profile_id' | 'city' | 'company_email'
  | 'company_website' | 'country' | 'notes' | 'phone' | 'postal_code' | 'state' | 'state_key' | 'phone_key';

export function mergeMissingFields(existing: Partial<Record<MergeFields, string | null>>, incoming: TablesUpdate<'prospecting_leads'> | null, actorId: string) {
  if (!incoming) return {};
  const next: TablesUpdate<'prospecting_leads'> = {};
  const fields = [
    'address_line_1',
    'address_line_2',
    'assigned_profile_id',
    'city',
    'company_email',
    'company_website',
    'country',
    'notes',
    'phone',
    'postal_code',
  ] as const;

  for (const field of fields) {
    const current = existing[field];
    const incomingValue = incoming[field];
    if (!current && incomingValue) next[field] = incomingValue;
  }

  if (!existing.state && incoming.state) next.state = incoming.state;
  if (!existing.state_key && incoming.state_key) next.state_key = incoming.state_key;
  if (!existing.phone_key && incoming.phone_key) next.phone_key = incoming.phone_key;
  if (Object.keys(next).length) next.updated_by = actorId;
  return next;
}
