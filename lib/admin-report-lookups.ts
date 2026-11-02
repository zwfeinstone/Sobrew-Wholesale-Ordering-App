import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/schema';
import { fetchAllPages } from '@/lib/supabase/pagination';

/** One authenticated join replaces the settings → ID batches → profiles waterfall. */
export function loadReportSalesReps(supabase: SupabaseClient<Database>) {
  return fetchAllPages((from, to) => supabase
    .from('profiles')
    .select('id,email,full_name,is_active,sales_settings:admin_commission_settings!admin_commission_settings_profile_id_fkey!inner(profile_id)')
    .eq('is_admin', true)
    .eq('sales_settings.is_sales_rep', true)
    .order('full_name', { ascending: true }).order('id').range(from, to));
}
