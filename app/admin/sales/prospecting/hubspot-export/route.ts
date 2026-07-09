import { NextResponse } from 'next/server';
import { requireAdminSectionEdit } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';
import { csvLine, stageLabel } from '@/lib/prospecting';

type LeadRow = {
  address_line_1: string | null;
  address_line_2: string | null;
  assigned_profile_id: string | null;
  city: string | null;
  company_email: string | null;
  company_name: string;
  company_website: string | null;
  country: string | null;
  hubspot_status: string | null;
  id: string;
  last_result: string | null;
  notes: string | null;
  phone: string | null;
  postal_code: string | null;
  stage: string | null;
  state: string | null;
};

type ContactRow = {
  email: string | null;
  full_name: string | null;
  is_primary: boolean | null;
  lead_id: string;
  phone: string | null;
  title: string | null;
};

type ProfileRow = {
  email: string | null;
  full_name: string | null;
  id: string;
};

export async function GET() {
  const current = await requireAdminSectionEdit('prospecting', '/admin/sales/prospecting/admin?bucket=hubspot&toast=admin_write_denied');
  if (!current.isOwner) {
    return NextResponse.redirect('/admin/sales/prospecting/admin?bucket=hubspot&toast=admin_write_denied');
  }

  const supabase = await createClient();
  const { data: leadsData } = await supabase
    .from('prospecting_leads')
    .select('*')
    .eq('hubspot_status', 'queued')
    .is('archived_at', null)
    .in('stage', ['interested', 'sample_requested'])
    .order('updated_at', { ascending: false })
    .limit(2000);

  const leads = (leadsData ?? []) as LeadRow[];
  const leadIds = leads.map((lead) => lead.id);
  const assignedIds = [...new Set(leads.map((lead) => lead.assigned_profile_id).filter(Boolean))] as string[];

  const [{ data: contactsData }, { data: profilesData }] = await Promise.all([
    leadIds.length
      ? supabase.from('prospecting_contacts').select('lead_id,full_name,title,email,phone,is_primary').in('lead_id', leadIds)
      : Promise.resolve({ data: [] }),
    assignedIds.length
      ? supabase.from('profiles').select('id,email,full_name').in('id', assignedIds)
      : Promise.resolve({ data: [] }),
  ]);

  const contactsByLead = new Map<string, ContactRow[]>();
  for (const contact of (contactsData ?? []) as ContactRow[]) {
    contactsByLead.set(contact.lead_id, [...(contactsByLead.get(contact.lead_id) ?? []), contact]);
  }
  const profilesById = new Map(((profilesData ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));

  const lines = [
    csvLine([
      'company_name',
      'company_phone',
      'company_email',
      'company_website',
      'address_line_1',
      'address_line_2',
      'city',
      'state',
      'postal_code',
      'country',
      'primary_contact_name',
      'primary_contact_title',
      'primary_contact_email',
      'primary_contact_phone',
      'assigned_rep_name',
      'assigned_rep_email',
      'stage',
      'last_result',
      'notes',
    ]),
    ...leads.map((lead) => {
      const contacts = contactsByLead.get(lead.id) ?? [];
      const primary = contacts.find((contact) => contact.is_primary) ?? contacts[0] ?? null;
      const rep = lead.assigned_profile_id ? profilesById.get(lead.assigned_profile_id) : null;
      return csvLine([
        lead.company_name,
        lead.phone,
        lead.company_email,
        lead.company_website,
        lead.address_line_1,
        lead.address_line_2,
        lead.city,
        lead.state,
        lead.postal_code,
        lead.country,
        primary?.full_name,
        primary?.title,
        primary?.email,
        primary?.phone,
        rep?.full_name,
        rep?.email,
        stageLabel(lead.stage),
        lead.last_result,
        lead.notes,
      ]);
    }),
  ];

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Disposition': `attachment; filename="sobrew-hubspot-prospecting-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Content-Type': 'text/csv; charset=utf-8',
    },
  });
}
