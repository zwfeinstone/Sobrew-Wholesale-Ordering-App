import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminSectionEdit } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';
import {
  PROSPECTING_IMPORT_MAX_BYTES,
  PROSPECTING_IMPORT_MAX_ROWS,
  chunkArray,
  cleanText,
  normalizePhoneKey,
  normalizeStateKey,
  normalizeTextKey,
  parseCsv,
  prospectingContactPayloadsFromCsv,
  type ProspectingPriority,
  type ProspectingStage,
} from '@/lib/prospecting';

type LeadRow = {
  address_line_1: string | null;
  address_line_2: string | null;
  assigned_profile_id: string | null;
  city: string | null;
  company_email: string | null;
  company_name: string;
  company_name_key: string;
  company_website: string | null;
  country: string | null;
  created_at: string | null;
  do_not_contact: boolean | null;
  hubspot_status: string | null;
  id: string;
  last_activity_at: string | null;
  last_result: string | null;
  next_follow_up_at: string | null;
  notes: string | null;
  phone: string | null;
  phone_key: string | null;
  postal_code: string | null;
  priority: ProspectingPriority | string | null;
  stage: ProspectingStage | string | null;
  state: string | null;
  state_key: string | null;
  updated_at: string | null;
};

type ProfileRow = {
  email: string | null;
  full_name: string | null;
  id: string;
  is_active: boolean | null;
};

const PROSPECTING_ADMIN_PATH = '/admin/sales/prospecting/admin';

function redirectTo(request: NextRequest, toast: string, params: Record<string, string> = {}) {
  const url = new URL(PROSPECTING_ADMIN_PATH, request.url);
  url.searchParams.set('toast', toast);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, 303);
}

function leadPayloadFromCsv(row: Record<string, string>, createdBy: string, salesRepId: string | null) {
  const companyName = cleanText(row.company_name);
  if (!companyName) return null;
  const phone = cleanText(row.company_phone);
  const state = cleanText(row.state);
  return {
    address_line_1: cleanText(row.address_line_1),
    address_line_2: cleanText(row.address_line_2),
    assigned_profile_id: salesRepId,
    city: cleanText(row.city),
    company_email: cleanText(row.company_email),
    company_name: companyName,
    company_name_key: normalizeTextKey(companyName),
    company_website: cleanText(row.company_website),
    country: cleanText(row.country),
    created_by: createdBy,
    notes: cleanText(row.notes),
    phone,
    phone_key: normalizePhoneKey(phone),
    postal_code: cleanText(row.postal_code),
    priority: 'normal' as ProspectingPriority,
    source: cleanText(row.list_name),
    stage: 'new' as ProspectingStage,
    state,
    state_key: normalizeStateKey(state),
    updated_by: createdBy,
  };
}

function mergeMissingFields(existing: LeadRow, incoming: ReturnType<typeof leadPayloadFromCsv>, actorId: string) {
  if (!incoming) return {};
  const next: Record<string, string | null> = {};
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

async function loadSalesReps(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: settings } = await supabase
    .from('admin_commission_settings')
    .select('profile_id')
    .eq('is_sales_rep', true);
  const ids = [...new Set(((settings ?? []) as Array<{ profile_id: string | null }>).map((row) => row.profile_id).filter(Boolean))] as string[];
  if (!ids.length) return [] as ProfileRow[];
  const { data } = await supabase
    .from('profiles')
    .select('id,email,full_name,is_active')
    .in('id', ids)
    .eq('is_admin', true);
  return (data ?? []) as ProfileRow[];
}

export async function POST(request: NextRequest) {
  const current = await requireAdminSectionEdit('prospecting', `${PROSPECTING_ADMIN_PATH}?toast=admin_write_denied`);
  if (!current.isOwner) {
    return redirectTo(request, 'admin_write_denied');
  }

  const supabase = await createClient();
  const formData = await request.formData();
  const file = formData.get('lead_csv');
  const requestedListId = String(formData.get('existing_list_id') ?? '').trim();
  const listNameInput = String(formData.get('list_name') ?? '').trim();

  if (!(file instanceof File) || !file.size) return redirectTo(request, 'import_missing');
  if (file.size > PROSPECTING_IMPORT_MAX_BYTES) return redirectTo(request, 'import_too_large');

  const parsed = parseCsv(await file.text());
  if (parsed.errors.length) return redirectTo(request, 'import_parse_error');
  if (parsed.rows.length > PROSPECTING_IMPORT_MAX_ROWS) return redirectTo(request, 'import_too_many_rows');
  if (!parsed.rows.length) return redirectTo(request, 'import_empty');
  if (!parsed.rows.some((row) => cleanText(row.company_name))) return redirectTo(request, 'import_no_company');

  const firstListName = parsed.rows.map((row) => cleanText(row.list_name)).find(Boolean);
  let listId = requestedListId;
  if (!listId) {
    const { data: createdList, error: listError } = await supabase
      .from('prospecting_lists')
      .insert({
        created_by: current.profile.id,
        description: `Imported from ${file.name}`,
        name: listNameInput || firstListName || file.name.replace(/\.[^.]+$/, '') || 'Imported Leads',
        source: 'csv',
        updated_by: current.profile.id,
      })
      .select('id')
      .single();
    if (listError || !createdList) return redirectTo(request, 'import_error');
    listId = createdList.id;
  }

  const { data: importRow, error: importError } = await supabase
    .from('prospecting_imports')
    .insert({
      file_name: file.name,
      list_id: listId,
      status: 'completed',
      uploaded_by: current.profile.id,
    })
    .select('id')
    .single();
  if (importError || !importRow) return redirectTo(request, 'import_error');

  const salesReps = await loadSalesReps(supabase);
  const repByEmail = new Map(salesReps.map((rep) => [String(rep.email ?? '').trim().toLowerCase(), rep.id]));
  const prepared = parsed.rows.map((row, index) => {
    const assignedRepId = repByEmail.get(String(row.assigned_rep_email ?? '').trim().toLowerCase()) ?? null;
    const payload = leadPayloadFromCsv(row, current.profile.id, assignedRepId);
    return { index: index + 2, payload, row };
  });

  const companyKeys = [...new Set(prepared.map((item) => item.payload?.company_name_key).filter(Boolean))] as string[];
  const existingRows: LeadRow[] = [];
  for (const keyBatch of chunkArray(companyKeys, 400)) {
    const { data, error } = await supabase.from('prospecting_leads').select('*').in('company_name_key', keyBatch);
    if (error) return redirectTo(request, 'import_error');
    existingRows.push(...((data ?? []) as LeadRow[]));
  }

  const exactByKey = new Map(existingRows.map((lead) => [`${lead.company_name_key}:${lead.phone_key ?? ''}`, lead]));
  const byCompany = new Map<string, LeadRow[]>();
  for (const lead of existingRows) byCompany.set(lead.company_name_key, [...(byCompany.get(lead.company_name_key) ?? []), lead]);

  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let reviewCount = 0;
  const errors: string[] = [];
  const activityRows: Array<Record<string, unknown>> = [];
  const duplicateReviewRows: Array<Record<string, unknown>> = [];
  const insertItems: Array<typeof prepared[number]> = [];
  const successfulItems: Array<{ exact: boolean; item: typeof prepared[number]; leadId: string }> = [];
  const queuedNewKeys = new Set<string>();

  for (const item of prepared) {
    if (!item.payload) {
      skippedCount += 1;
      errors.push(`Row ${item.index}: missing company_name.`);
      continue;
    }

    const key = `${item.payload.company_name_key}:${item.payload.phone_key}`;
    const exact = exactByKey.get(key);
    const sameCompany = byCompany.get(item.payload.company_name_key) ?? [];
    if (!exact && sameCompany.length && sameCompany.some((lead) => (lead.phone_key ?? '') !== item.payload?.phone_key)) {
      reviewCount += 1;
      skippedCount += 1;
      duplicateReviewRows.push({
        company_name: item.payload.company_name,
        existing_lead_id: sameCompany[0].id,
        import_id: importRow.id,
        list_id: listId,
        phone: item.payload.phone,
        raw_payload: item.row,
        reason: 'Company already exists with a different phone number.',
        row_number: item.index,
      });
      continue;
    }

    if (exact) {
      const updates = mergeMissingFields(exact, item.payload, current.profile.id);
      if (Object.keys(updates).length) {
        const { error } = await supabase.from('prospecting_leads').update(updates).eq('id', exact.id);
        if (error) {
          skippedCount += 1;
          errors.push(`Row ${item.index}: unable to update existing lead.`);
          continue;
        }
        updatedCount += 1;
      }
      successfulItems.push({ exact: true, item, leadId: exact.id });
    } else {
      if (queuedNewKeys.has(key)) {
        skippedCount += 1;
        errors.push(`Row ${item.index}: duplicate company and phone in this CSV.`);
        continue;
      }
      queuedNewKeys.add(key);
      insertItems.push(item);
    }
  }

  for (const batch of chunkArray(insertItems, 400)) {
    const { data, error } = await supabase
      .from('prospecting_leads')
      .insert(batch.map((item) => item.payload!))
      .select('id,company_name_key,phone_key');
    if (error || !data) {
      skippedCount += batch.length;
      errors.push(`Lead insert failed: ${error?.message ?? 'no returned rows'}`);
      continue;
    }

    const insertedByKey = new Map(((data ?? []) as Array<{ company_name_key: string | null; id: string; phone_key: string | null }>).map((lead) => [`${lead.company_name_key}:${lead.phone_key ?? ''}`, lead.id]));
    for (const item of batch) {
      const leadId = item.payload ? insertedByKey.get(`${item.payload.company_name_key}:${item.payload.phone_key}`) : null;
      if (!leadId) {
        skippedCount += 1;
        errors.push(`Row ${item.index}: unable to create lead.`);
        continue;
      }
      insertedCount += 1;
      successfulItems.push({ exact: false, item, leadId });
    }
  }

  const listLeadRows = successfulItems.map(({ leadId }) => ({
    added_by: current.profile.id,
    import_id: importRow.id,
    lead_id: leadId,
    list_id: listId,
  }));
  for (const batch of chunkArray(listLeadRows, 500)) {
    const { error } = await supabase.from('prospecting_list_leads').upsert(batch, { onConflict: 'list_id,lead_id' });
    if (error) errors.push('Some lead list memberships could not be saved.');
  }

  const contactRows = successfulItems.flatMap(({ item, leadId }) => prospectingContactPayloadsFromCsv(item.row, leadId, current.profile.id));
  for (const batch of chunkArray(contactRows, 500)) {
    const { error } = await supabase.from('prospecting_contacts').insert(batch);
    if (error) errors.push('Some key contacts could not be saved.');
  }

  for (const { exact, leadId } of successfulItems) {
    activityRows.push({
      activity_type: 'enrichment',
      body: `Imported from ${file.name}.`,
      created_by: current.profile.id,
      lead_id: leadId,
      result: exact ? 'CSV merge' : 'CSV import',
    });
  }
  for (const batch of chunkArray(duplicateReviewRows, 500)) {
    const { error } = await supabase.from('prospecting_duplicate_reviews').insert(batch);
    if (error) errors.push('Some duplicate review rows could not be saved.');
  }
  for (const batch of chunkArray(activityRows, 500)) {
    const { error } = await supabase.from('prospecting_activities').insert(batch);
    if (error) errors.push('Some import activity history could not be saved.');
  }

  if (!insertedCount && !updatedCount && !reviewCount && !skippedCount) {
    errors.push(`No leads were prepared from ${parsed.rows.length} parsed CSV rows.`);
  }

  await supabase
    .from('prospecting_imports')
    .update({
      error_summary: errors.slice(0, 8).join('\n') || null,
      inserted_count: insertedCount,
      review_count: reviewCount,
      skipped_count: skippedCount,
      status: errors.length || reviewCount ? 'completed_with_errors' : 'completed',
      updated_count: updatedCount,
    })
    .eq('id', importRow.id);

  return redirectTo(request, 'import_complete', { bucket: 'active', list: listId });
}
