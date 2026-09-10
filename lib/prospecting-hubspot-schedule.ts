import 'server-only';
import { pushProspectingHubSpotLeadWithTracking, type HubSpotExportLead } from '@/lib/prospecting-hubspot-export';

export function isSampleHubSpotSyncTime(now: Date) {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: '2-digit', hourCycle: 'h23',
  }).format(now);
  return hour === '17';
}

async function allRows(query: any): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await query.range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

export async function pushRequestedSamplesToHubSpot(supabase: any, deadline = Date.now() + 240_000) {
  const summary = { exported: 0, skipped: 0, attempted: 0, incomplete: false, errors: [] as Array<{ leadId: string; message: string }> };
  // Even when Vercel invokes late, process the 5 p.m. queue only. Later arrivals wait until tomorrow.
  const cutoff = new Date();
  cutoff.setUTCMinutes(0, 0, 0);
  let cursor = '';
  while (Date.now() < deadline) {
    let query = supabase.from('prospecting_leads')
      .select('id,assigned_profile_id,company_name,company_website,phone,address_line_1,address_line_2,city,state,postal_code,country,hubspot_deal_id,hubspot_note_id,notes,stage,hubspot_status')
      .is('archived_at', null).eq('do_not_contact', false).eq('stage', 'sample_requested')
      .not('sample_requested_at', 'is', null)
      .lte('sample_requested_at', cutoff.toISOString())
      .neq('hubspot_status', 'exported').order('id', { ascending: true }).limit(10);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw error;
    const leads = (data ?? []) as HubSpotExportLead[];
    if (!leads.length) return summary;
    const ids = leads.map((lead) => lead.id);
    const profileIds = [...new Set(leads.map((lead) => lead.assigned_profile_id).filter(Boolean))];
    const [contacts, activities, profiles] = await Promise.all([
      allRows(supabase.from('prospecting_contacts').select('id,lead_id,full_name,email,phone,title,is_primary,notes').in('lead_id', ids).order('id')),
      allRows(supabase.from('prospecting_activities').select('id,lead_id,activity_type,result,body,previous_stage,next_stage,next_follow_up_at,created_at,hubspot_note_id').in('lead_id', ids).order('created_at').order('id')),
      profileIds.length ? allRows(supabase.from('profiles').select('id,email').in('id', profileIds).order('id')) : [],
    ]);
    for (const lead of leads) {
      if (Date.now() >= deadline) { summary.incomplete = true; return summary; }
      cursor = lead.id;
      summary.attempted += 1;
      try {
        const result = await pushProspectingHubSpotLeadWithTracking({
          supabase, lead,
          contacts: contacts.filter((contact) => contact.lead_id === lead.id),
          activities: activities.filter((activity) => activity.lead_id === lead.id),
          ownerEmail: profiles.find((profile) => profile.id === lead.assigned_profile_id)?.email ?? null,
          actorId: null,
        });
        if (result.status === 'exported') summary.exported += 1;
        else if (result.status === 'skipped') summary.skipped += 1;
        else summary.errors.push({ leadId: lead.id, message: result.message });
      } catch (error) {
        summary.errors.push({ leadId: lead.id, message: error instanceof Error ? error.message : 'Unable to push lead to HubSpot.' });
      }
    }
  }
  summary.incomplete = true;
  return summary;
}
