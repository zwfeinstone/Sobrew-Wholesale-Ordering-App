import 'server-only';

import { getSupabaseAdmin, type SupabaseAdminClient } from '@/lib/supabase/admin';

export const CENTER_PRICING_PAGE_SIZE = 25;
export const CENTER_PRICING_EMAIL_PAGE_SIZE = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CENTER_COLUMNS = 'id,company_name,city,state,stage,archived_at,assigned_profile_id,owner:profiles!prospecting_leads_assigned_profile_id_fkey(full_name,email),quotes:prospecting_sample_quotes!prospecting_sample_quotes_lead_id_fkey(id,sent_at)' as const;

type Access = { actorId: string; isOwner: boolean; supabase?: SupabaseAdminClient };
export type CenterPricingFilters = { search: string; page: number };

export function pricingPage(value: unknown): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100_000) : 1;
}

export function centerPricingFilters(params: Record<string, string | string[] | undefined>): CenterPricingFilters {
  return {
    search: typeof params.q === 'string' ? params.q.trim().slice(0, 100) : '',
    page: pricingPage(params.page),
  };
}

export function centerPricingHref(filters: CenterPricingFilters, page = filters.page) {
  const params = new URLSearchParams();
  if (filters.search) params.set('q', filters.search);
  if (page > 1) params.set('page', String(page));
  return `/admin/center-pricing${params.size ? `?${params}` : ''}`;
}

/**
 * Quotes are service-role only. Always scope in the database by the CURRENT
 * prospect owner, never by the sender snapshot or customer center assignments.
 * Keep sent history even after conversion, archiving, or sample order deletion.
 */
function visibleCenters({ actorId, isOwner, supabase = getSupabaseAdmin() }: Access) {
  let query = supabase.from('prospecting_leads').select(CENTER_COLUMNS, { count: 'exact' })
    .not('quotes.sent_at', 'is', null)
    .not('quotes', 'is', null)
    .order('sent_at', { referencedTable: 'quotes', ascending: false })
    .order('id', { referencedTable: 'quotes' })
    .limit(1, { referencedTable: 'quotes' });
  if (!isOwner) query = query.eq('assigned_profile_id', actorId);
  return query;
}

export async function loadCenterPricingList(access: Access, filters: CenterPricingFilters) {
  let query = visibleCenters(access);
  if (filters.search) query = query.ilike('company_name', `%${filters.search.replace(/[\\%_]/g, '\\$&')}%`);
  const from = (filters.page - 1) * CENTER_PRICING_PAGE_SIZE;
  const { data, error, count } = await query.order('company_name').order('id').range(from, from + CENTER_PRICING_PAGE_SIZE - 1);
  if (error) {
    console.error('Center pricing list lookup failed', error);
    return { ok: false as const, error: 'Center pricing could not be loaded. Please try again.' };
  }
  return { ok: true as const, centers: data ?? [], total: count ?? 0 };
}

export async function loadCenterPricingDetail(access: Access, leadId: string, page = 1) {
  if (!UUID.test(leadId)) return { ok: false as const, unavailable: true as const };
  const lead = await visibleCenters(access).eq('id', leadId).maybeSingle();
  if (lead.error) {
    console.error('Center pricing lead lookup failed', lead.error);
    return { ok: false as const, error: 'Center pricing could not be loaded. Please try again.' };
  }
  if (!lead.data) return { ok: false as const, unavailable: true as const };

  const supabase = access.supabase ?? getSupabaseAdmin();
  // Repeat ownership in the email query so a reassignment between reads cannot
  // expose the saved message to the previous rep. Do not require an order row.
  let query = supabase.from('prospecting_sample_quotes')
    .select('id,subject,body_html,body_text,sender_name,sender_email,recipient_name,recipient_email,sent_at,tracking_number,lead:prospecting_leads!prospecting_sample_quotes_lead_id_fkey!inner(id,assigned_profile_id)', { count: 'exact' })
    .eq('lead_id', leadId).not('sent_at', 'is', null);
  if (!access.isOwner) query = query.eq('lead.assigned_profile_id', access.actorId);
  const from = (pricingPage(page) - 1) * CENTER_PRICING_EMAIL_PAGE_SIZE;
  const { data, error, count } = await query.order('sent_at', { ascending: false }).order('id').range(from, from + CENTER_PRICING_EMAIL_PAGE_SIZE - 1);
  if (error) {
    console.error('Center pricing email lookup failed', error);
    return { ok: false as const, error: 'The saved pricing emails could not be loaded. Please try again.' };
  }
  return { ok: true as const, center: lead.data, emails: data ?? [], total: count ?? 0 };
}
