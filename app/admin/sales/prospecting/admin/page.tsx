import Link from 'next/link';
import { redirect } from 'next/navigation';
import ConfirmSubmitButton from '@/components/confirm-submit-button';
import PendingSubmitButton from '@/components/pending-submit-button';
import ProspectingBulkSelectionControls from '@/components/prospecting-bulk-selection-controls';
import StatusToast from '@/components/status-toast';
import { adminCanEdit, requireAdminSectionEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';
import {
  ACTIVE_PROSPECTING_STAGES,
  DEFAULT_PROSPECTING_PAGE_SIZE,
  HUBSPOT_QUEUE_STAGES,
  MAINTENANCE_PROSPECTING_STAGES,
  MISSING_STATE_FILTER,
  PROSPECTING_CSV_HEADERS,
  PROSPECTING_IMPORT_MAX_BYTES,
  PROSPECTING_IMPORT_MAX_ROWS,
  PROSPECTING_PAGE_SIZES,
  PROSPECTING_PRIORITIES,
  PROSPECTING_STAGES,
  US_STATE_OPTIONS,
  chunkArray,
  cleanText,
  csvLine,
  formatDate,
  formatDateTime,
  isHubspotQueueStage,
  isMaintenanceStage,
  missingLeadFields,
  normalizePageNumber,
  normalizePageSize,
  normalizePhoneKey,
  normalizePriority,
  normalizeStateFilter,
  normalizeStateKey,
  normalizeStage,
  normalizeTextKey,
  paginationRange,
  parseCsv,
  postgrestIlikePattern,
  priorityLabel,
  stageLabel,
  totalPageCount,
  type ProspectingPriority,
  type ProspectingStateFilter,
  type ProspectingStage,
} from '@/lib/prospecting';

type SearchParams = Record<string, string | string[] | undefined>;

type LeadRow = {
  address_line_1: string | null;
  address_line_2: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
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

type ContactSummary = {
  email: string | null;
  full_name: string | null;
  lead_id: string;
  phone: string | null;
};

type ListRow = {
  created_at: string | null;
  description: string | null;
  id: string;
  name: string;
  source: string | null;
};

type ListLeadRow = {
  lead_id: string;
  list_id: string;
  prospecting_lists?: { name: string | null } | { name: string | null }[] | null;
};

type ProfileRow = {
  email: string | null;
  full_name: string | null;
  id: string;
  is_active: boolean | null;
};

type ImportRow = {
  created_at: string | null;
  error_summary: string | null;
  file_name: string | null;
  id: string;
  inserted_count: number | null;
  prospecting_lists?: { name: string | null } | { name: string | null }[] | null;
  review_count: number | null;
  skipped_count: number | null;
  status: string | null;
  updated_count: number | null;
};

type DuplicateReviewRow = {
  company_name: string | null;
  created_at: string | null;
  id: string;
  phone: string | null;
  reason: string;
  row_number: number;
};

type ActivityReportRow = {
  activity_type: string | null;
  created_at: string | null;
  created_by: string | null;
  lead_id: string | null;
  next_stage: string | null;
  previous_assigned_profile_id: string | null;
  result: string | null;
};

type RecycleReportLeadRow = Pick<LeadRow, 'assigned_profile_id' | 'city' | 'company_name' | 'id' | 'last_result' | 'phone' | 'stage' | 'state'>;

type RecycleReportActivityRow = {
  activity_type: string | null;
  body: string | null;
  created_at: string | null;
  created_by: string | null;
  id: string;
  lead_id: string;
  previous_assigned_profile_id: string | null;
  previous_stage: string | null;
  result: string | null;
  prospecting_leads?: RecycleReportLeadRow | RecycleReportLeadRow[] | null;
};

type RecycleTouchRow = {
  activity_type: string | null;
  created_at: string | null;
  lead_id: string;
};

type LeadFilterState = {
  bucket: Bucket;
  isOwner: boolean;
  listId: string;
  priority: string;
  q: string;
  repId: string;
  stage: string;
  stateKey: '' | ProspectingStateFilter;
};

const PROSPECTING_ADMIN_PATH = '/admin/sales/prospecting/admin';

const BUCKETS = [
  { id: 'active', label: 'Active Leads' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'interested', label: 'Interested' },
  { id: 'sample_requested', label: 'Sample Requested' },
  { id: 'not_a_fit_review', label: 'Not a Fit Review' },
  { id: 'lost_review', label: 'Lost Review' },
  { id: 'hubspot', label: 'HubSpot Queue' },
  { id: 'all', label: 'All Leads' },
] as const;

type Bucket = (typeof BUCKETS)[number]['id'];

function stringParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

function normalizeBucket(value: string | string[] | undefined): Bucket {
  return BUCKETS.some((bucket) => bucket.id === value) ? value as Bucket : 'active';
}

function isMaintenanceBucket(bucket: Bucket) {
  return bucket === 'not_a_fit_review' || bucket === 'lost_review';
}

function maintenanceStageForBucket(bucket: Bucket): ProspectingStage | null {
  if (bucket === 'not_a_fit_review') return 'not_a_fit';
  if (bucket === 'lost_review') return 'lost';
  return null;
}

function prospectingHref(params: {
  bucket?: Bucket;
  list?: string;
  page?: number | string;
  pageSize?: number | string;
  priority?: string;
  q?: string;
  rep?: string;
  recyclePage?: number | string;
  recyclePageSize?: number | string;
  stage?: string;
  state?: string;
  toast?: string;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    if (key === 'pageSize') query.set('page_size', String(value));
    else if (key === 'recyclePage') query.set('recycle_page', String(value));
    else if (key === 'recyclePageSize') query.set('recycle_page_size', String(value));
    else query.set(key, String(value));
  }
  const qs = query.toString();
  return `${PROSPECTING_ADMIN_PATH}${qs ? `?${qs}` : ''}`;
}

function adminFilterHref(filters: LeadFilterState, params: { page?: number; pageSize?: number; toast?: string } = {}) {
  return prospectingHref({
    bucket: filters.bucket,
    list: filters.listId,
    page: params.page,
    pageSize: params.pageSize,
    priority: filters.priority,
    q: filters.q,
    rep: filters.repId,
    stage: filters.stage,
    state: filters.stateKey,
    toast: params.toast,
  });
}

function assignmentRedirectFromForm(formData: FormData, toast: string) {
  return prospectingHref({
    bucket: normalizeBucket(String(formData.get('bucket') ?? 'active')),
    list: String(formData.get('list') ?? '').trim(),
    page: normalizePageNumber(String(formData.get('page') ?? '1')),
    pageSize: normalizePageSize(String(formData.get('page_size') ?? String(DEFAULT_PROSPECTING_PAGE_SIZE))),
    priority: String(formData.get('priority') ?? '').trim(),
    q: String(formData.get('q') ?? '').trim(),
    rep: String(formData.get('rep') ?? '').trim(),
    stage: String(formData.get('stage') ?? '').trim(),
    state: normalizeStateFilter(String(formData.get('state') ?? '')),
    toast,
  });
}

function leadDetailHref(leadId: string, stateKey: '' | ProspectingStateFilter = '') {
  const query = new URLSearchParams();
  if (stateKey) query.set('state', stateKey);
  const qs = query.toString();
  return `/admin/sales/prospecting/${leadId}${qs ? `?${qs}` : ''}`;
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function profileLabel(profile: ProfileRow | null | undefined) {
  return profile?.full_name || profile?.email || 'Unassigned';
}

function unknownProfileLabel(profile: ProfileRow | null | undefined) {
  return profile?.full_name || profile?.email || 'Unknown';
}

function listName(row: ListLeadRow) {
  return relatedOne(row.prospecting_lists)?.name || 'Lead list';
}

function importListName(row: ImportRow) {
  return relatedOne(row.prospecting_lists)?.name || 'Lead list';
}

function salesRepOptionRows(profiles: ProfileRow[]) {
  return profiles
    .filter((profile) => profile.is_active !== false)
    .sort((a, b) => profileLabel(a).localeCompare(profileLabel(b)));
}

function safeDateInput(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
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

function contactPayloadsFromCsv(row: Record<string, string>, leadId: string, createdBy: string) {
  return [1, 2].flatMap((index) => {
    const fullName = cleanText(row[`key_contact_${index}_name`]);
    const title = cleanText(row[`key_contact_${index}_title`]);
    const email = cleanText(row[`key_contact_${index}_email`]);
    const phone = cleanText(row[`key_contact_${index}_phone`]);
    if (!fullName && !title && !email && !phone) return [];
    return [{
      created_by: createdBy,
      email,
      full_name: fullName,
      is_primary: index === 1,
      lead_id: leadId,
      phone,
      title,
      updated_by: createdBy,
    }];
  });
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
  if (Object.keys(next).length) {
    next.updated_by = actorId;
  }
  return next;
}

async function requireProspectingOwner(redirectTo = `${PROSPECTING_ADMIN_PATH}?toast=admin_write_denied`) {
  const current = await requireAdminSectionEdit('prospecting', redirectTo);
  if (!current.isOwner) redirect(redirectTo);
  return current;
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

function filteredLeadQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters: LeadFilterState,
  columns: string,
  options?: { count?: 'exact'; head?: boolean },
) {
  const selectColumns = filters.listId ? `${columns},prospecting_list_leads!inner(list_id)` : columns;
  let query = supabase.from('prospecting_leads').select(selectColumns, options).is('archived_at', null);
  if (filters.bucket === 'unassigned') {
    query = query.is('assigned_profile_id', null).in('stage', ACTIVE_PROSPECTING_STAGES);
  } else if (isMaintenanceBucket(filters.bucket)) {
    const maintenanceStage = maintenanceStageForBucket(filters.bucket);
    if (maintenanceStage) query = query.eq('stage', maintenanceStage);
  } else {
    if (!filters.isOwner) query = query.eq('assigned_profile_id', filters.repId);
    if (filters.repId) query = query.eq('assigned_profile_id', filters.repId);
  }
  if (filters.priority) query = query.eq('priority', filters.priority);
  if (filters.stage && !isMaintenanceBucket(filters.bucket)) query = query.eq('stage', filters.stage);
  if (filters.bucket === 'active') query = query.in('stage', ACTIVE_PROSPECTING_STAGES);
  if (filters.bucket === 'all') query = query.not('stage', 'in', `(${MAINTENANCE_PROSPECTING_STAGES.join(',')})`);
  if (filters.bucket === 'interested') query = query.eq('stage', 'interested');
  if (filters.bucket === 'sample_requested') query = query.eq('stage', 'sample_requested');
  if (filters.bucket === 'hubspot') query = query.eq('hubspot_status', 'queued').in('stage', HUBSPOT_QUEUE_STAGES);
  if (filters.listId) query = query.eq('prospecting_list_leads.list_id', filters.listId);
  if (filters.stateKey === MISSING_STATE_FILTER) query = query.is('state_key', null);
  else if (filters.stateKey) query = query.eq('state_key', filters.stateKey);
  if (filters.q) {
    const search = postgrestIlikePattern(filters.q);
    query = query.or([
      `company_name.ilike.${search}`,
      `phone.ilike.${search}`,
      `company_email.ilike.${search}`,
      `city.ilike.${search}`,
      `state.ilike.${search}`,
    ].join(','));
  }
  return query;
}

async function fetchFilteredLeadIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters: LeadFilterState,
  maxRows = PROSPECTING_IMPORT_MAX_ROWS,
) {
  const ids: string[] = [];
  const batchSize = 1000;
  while (ids.length < maxRows) {
    const { data, error } = await filteredLeadQuery(supabase, filters, 'id')
      .order('id', { ascending: true })
      .range(ids.length, Math.min(ids.length + batchSize - 1, maxRows - 1));
    if (error) return { error, ids };
    const rows = ((data ?? []) as unknown as Array<{ id: string | null }>).map((row) => row.id).filter(Boolean) as string[];
    ids.push(...rows);
    if (rows.length < batchSize) break;
  }
  return { error: null, ids };
}

async function updateLeadAssignments({
  actorId,
  leadIds,
  salesProfileId,
  supabase,
}: {
  actorId: string;
  leadIds: string[];
  salesProfileId: string | null;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const now = new Date().toISOString();
  for (const batch of chunkArray(leadIds, 500)) {
    const { error } = await supabase
      .from('prospecting_leads')
      .update({
        assigned_profile_id: salesProfileId,
        updated_at: now,
        updated_by: actorId,
      })
      .in('id', batch);
    if (error) return error;

    const activityRows = batch.map((leadId) => ({
      activity_type: 'assignment',
      body: salesProfileId ? 'Lead assigned from bulk action.' : 'Lead unassigned from bulk action.',
      created_by: actorId,
      lead_id: leadId,
      result: salesProfileId ? 'Assigned' : 'Unassigned',
    }));
    const { error: activityError } = await supabase.from('prospecting_activities').insert(activityRows);
    if (activityError) return activityError;
  }
  return null;
}

async function importLeadCsv(formData: FormData) {
  'use server';

  const current = await requireProspectingOwner();
  const supabase = await createClient();
  const file = formData.get('lead_csv') as File | null;
  const requestedListId = String(formData.get('existing_list_id') ?? '').trim();
  const listNameInput = String(formData.get('list_name') ?? '').trim();

  if (!file || !file.size) redirect(`${PROSPECTING_ADMIN_PATH}?toast=import_missing`);
  if (file.size > PROSPECTING_IMPORT_MAX_BYTES) redirect(`${PROSPECTING_ADMIN_PATH}?toast=import_too_large`);
  const parsed = parseCsv(await file.text());
  if (parsed.errors.length) redirect(`${PROSPECTING_ADMIN_PATH}?toast=import_parse_error`);
  if (parsed.rows.length > PROSPECTING_IMPORT_MAX_ROWS) redirect(`${PROSPECTING_ADMIN_PATH}?toast=import_too_many_rows`);
  if (!parsed.rows.length) redirect(`${PROSPECTING_ADMIN_PATH}?toast=import_empty`);
  if (!parsed.rows.some((row) => cleanText(row.company_name))) redirect(`${PROSPECTING_ADMIN_PATH}?toast=import_no_company`);

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
    if (listError || !createdList) redirect(`${PROSPECTING_ADMIN_PATH}?toast=import_error`);
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
  if (importError || !importRow) redirect(`${PROSPECTING_ADMIN_PATH}?toast=import_error`);

  const salesReps = await loadSalesReps(supabase);
  const repByEmail = new Map(salesReps.map((rep) => [String(rep.email ?? '').trim().toLowerCase(), rep.id]));
  const prepared = parsed.rows.map((row, index) => {
    const assignedRepId = repByEmail.get(String(row.assigned_rep_email ?? '').trim().toLowerCase()) ?? null;
    const payload = leadPayloadFromCsv(row, current.profile.id, assignedRepId);
    return { assignedRepId, index: index + 2, payload, row };
  });

  const companyKeys = [...new Set(prepared.map((item) => item.payload?.company_name_key).filter(Boolean))] as string[];
  const existingRows: LeadRow[] = [];
  for (const keyBatch of chunkArray(companyKeys, 400)) {
    const { data, error } = await supabase.from('prospecting_leads').select('*').in('company_name_key', keyBatch);
    if (error) redirect(`${PROSPECTING_ADMIN_PATH}?toast=import_error`);
    existingRows.push(...((data ?? []) as LeadRow[]));
  }
  const exactByKey = new Map(existingRows.map((lead) => [`${lead.company_name_key}:${lead.phone_key ?? ''}`, lead]));
  const byCompany = new Map<string, LeadRow[]>();
  for (const lead of existingRows) {
    byCompany.set(lead.company_name_key, [...(byCompany.get(lead.company_name_key) ?? []), lead]);
  }

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
      for (const item of batch) errors.push(`Row ${item.index}: unable to create lead.`);
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

  const contactRows = successfulItems.flatMap(({ item, leadId }) => contactPayloadsFromCsv(item.row, leadId, current.profile.id));
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

  redirect(prospectingHref({ bucket: 'active', list: listId, toast: 'import_complete' }));
}

async function bulkAssignLeads(formData: FormData) {
  'use server';

  const current = await requireProspectingOwner();
  const supabase = await createClient();
  const scope = String(formData.get('scope') ?? 'selected') === 'all_filtered' ? 'all_filtered' : 'selected';
  let leadIds = [...new Set(formData.getAll('lead_id').map(String).filter(Boolean))];
  const salesProfileId = String(formData.get('sales_profile_id') ?? '').trim() || null;

  if (salesProfileId) {
    const { data } = await supabase
      .from('admin_commission_settings')
      .select('profile_id,is_sales_rep')
      .eq('profile_id', salesProfileId)
      .eq('is_sales_rep', true)
      .maybeSingle();
    if (!data) redirect(assignmentRedirectFromForm(formData, 'invalid_rep'));
  }

  if (scope === 'all_filtered') {
    const requestedPriority = String(formData.get('priority') ?? '').trim();
    const requestedStage = String(formData.get('stage') ?? '').trim();
    const filters: LeadFilterState = {
      bucket: normalizeBucket(String(formData.get('bucket') ?? 'active')),
      isOwner: true,
      listId: String(formData.get('list') ?? '').trim(),
      priority: PROSPECTING_PRIORITIES.some((priority) => priority.id === requestedPriority) ? requestedPriority : '',
      q: String(formData.get('q') ?? '').trim(),
      repId: String(formData.get('rep') ?? '').trim(),
      stage: PROSPECTING_STAGES.some((stage) => stage.id === requestedStage) ? requestedStage : '',
      stateKey: normalizeStateFilter(String(formData.get('state') ?? '')),
    };
    const { error, ids } = await fetchFilteredLeadIds(supabase, filters);
    if (error) redirect(assignmentRedirectFromForm(formData, 'bulk_error'));
    leadIds = ids;
  }

  if (!leadIds.length) redirect(assignmentRedirectFromForm(formData, 'bulk_missing'));

  const error = await updateLeadAssignments({
    actorId: current.profile.id,
    leadIds,
    salesProfileId,
    supabase,
  });

  redirect(assignmentRedirectFromForm(formData, error ? 'bulk_error' : 'bulk_saved'));
}

async function markHubspotExported(formData: FormData) {
  'use server';

  const current = await requireProspectingOwner(`${PROSPECTING_ADMIN_PATH}?bucket=hubspot&toast=admin_write_denied`);
  const supabase = await createClient();
  const leadIds = [...new Set(formData.getAll('lead_id').map(String).filter(Boolean))];
  if (!leadIds.length) redirect(`${PROSPECTING_ADMIN_PATH}?bucket=hubspot&toast=bulk_missing`);

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('prospecting_leads')
    .update({
      hubspot_exported_at: now,
      hubspot_exported_by: current.profile.id,
      hubspot_status: 'exported',
      updated_at: now,
      updated_by: current.profile.id,
    })
    .in('id', leadIds);

  if (!error) {
    await supabase
      .from('prospecting_hubspot_queue')
      .update({
        exported_at: now,
        exported_by: current.profile.id,
        status: 'exported',
      })
      .in('lead_id', leadIds);
    await supabase.from('prospecting_activities').insert(leadIds.map((leadId) => ({
      activity_type: 'hubspot_export',
      body: 'Marked exported to HubSpot.',
      created_by: current.profile.id,
      lead_id: leadId,
      result: 'Exported',
    })));
  }

  redirect(`${PROSPECTING_ADMIN_PATH}?bucket=hubspot&toast=${error ? 'hubspot_error' : 'hubspot_exported'}`);
}

type MaintenanceLeadForAction = {
  assigned_profile_id: string | null;
  do_not_contact: boolean | null;
  id: string;
  stage: string | null;
};

async function loadMaintenanceLeadForAction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leadId: string,
) {
  const { data } = await supabase
    .from('prospecting_leads')
    .select('id,assigned_profile_id,do_not_contact,stage')
    .eq('id', leadId)
    .is('archived_at', null)
    .in('stage', MAINTENANCE_PROSPECTING_STAGES)
    .maybeSingle();
  return data as MaintenanceLeadForAction | null;
}

async function archiveMaintenanceLead(formData: FormData) {
  'use server';

  const current = await requireProspectingOwner();
  const supabase = await createClient();
  const leadId = String(formData.get('lead_id') ?? '').trim();
  const lead = await loadMaintenanceLeadForAction(supabase, leadId);
  if (!lead) redirect(assignmentRedirectFromForm(formData, 'maintenance_missing'));

  const now = new Date().toISOString();
  const stage = normalizeStage(lead.stage);
  const { error } = await supabase
    .from('prospecting_leads')
    .update({
      archived_at: now,
      archived_by: current.profile.id,
      archive_reason: `${stageLabel(stage)} maintenance delete`,
      assigned_profile_id: null,
      next_follow_up_at: null,
      updated_at: now,
      updated_by: current.profile.id,
    })
    .eq('id', leadId)
    .is('archived_at', null);

  if (!error) {
    await supabase.from('prospecting_hubspot_queue').delete().eq('lead_id', leadId).eq('status', 'queued');
    await supabase.from('prospecting_activities').insert({
      activity_type: 'enrichment',
      body: `Lead soft archived from ${stageLabel(stage)} review.`,
      created_by: current.profile.id,
      lead_id: leadId,
      next_stage: stage,
      previous_assigned_profile_id: lead.assigned_profile_id,
      previous_stage: stage,
      result: 'Archived',
    });
  }

  redirect(assignmentRedirectFromForm(formData, error ? 'maintenance_error' : 'maintenance_archived'));
}

async function recycleMaintenanceLead(formData: FormData) {
  'use server';

  const current = await requireProspectingOwner();
  const supabase = await createClient();
  const leadId = String(formData.get('lead_id') ?? '').trim();
  const lead = await loadMaintenanceLeadForAction(supabase, leadId);
  if (!lead) redirect(assignmentRedirectFromForm(formData, 'maintenance_missing'));
  if (lead.do_not_contact) redirect(assignmentRedirectFromForm(formData, 'maintenance_dnc'));

  const now = new Date().toISOString();
  const previousStage = normalizeStage(lead.stage);
  const { error } = await supabase
    .from('prospecting_leads')
    .update({
      assigned_profile_id: null,
      hubspot_status: 'not_queued',
      next_follow_up_at: null,
      stage: 'recycle_try_later',
      updated_at: now,
      updated_by: current.profile.id,
    })
    .eq('id', leadId)
    .is('archived_at', null);

  if (!error) {
    await supabase.from('prospecting_hubspot_queue').delete().eq('lead_id', leadId).eq('status', 'queued');
    await supabase.from('prospecting_activities').insert({
      activity_type: 'stage_change',
      body: `Lead recycled from ${stageLabel(previousStage)} review to the unassigned pool.`,
      created_by: current.profile.id,
      lead_id: leadId,
      next_stage: 'recycle_try_later',
      previous_assigned_profile_id: lead.assigned_profile_id,
      previous_stage: previousStage,
      result: 'Recycled',
    });
  }

  redirect(assignmentRedirectFromForm(formData, error ? 'maintenance_error' : 'maintenance_recycled'));
}

function Toasts({ toast }: { toast: string }) {
  const messages: Record<string, { message: string; tone: 'success' | 'error' }> = {
    admin_write_denied: { message: 'Only a superadmin can change lead imports, assignment, or HubSpot export status.', tone: 'error' },
    bulk_error: { message: 'Unable to update those lead assignments.', tone: 'error' },
    bulk_missing: { message: 'Select at least one lead first.', tone: 'error' },
    bulk_saved: { message: 'Lead assignments updated.', tone: 'success' },
    hubspot_error: { message: 'Unable to mark those leads exported.', tone: 'error' },
    hubspot_exported: { message: 'Selected leads were marked exported.', tone: 'success' },
    import_complete: { message: 'CSV import complete. Review the import history for details.', tone: 'success' },
    import_empty: { message: 'That CSV only has headers or blank rows. Add lead rows and upload it again.', tone: 'error' },
    import_error: { message: 'Unable to import that CSV.', tone: 'error' },
    import_missing: { message: 'Choose a CSV file before importing.', tone: 'error' },
    import_no_company: { message: 'No company names were found. Use a company_name or Company Name column.', tone: 'error' },
    import_parse_error: { message: 'The CSV could not be parsed. Check quotes and headers.', tone: 'error' },
    import_too_large: { message: 'That CSV is too large. Use a file under 10 MB.', tone: 'error' },
    import_too_many_rows: { message: 'That CSV has too many rows. Import up to 5,000 leads at a time.', tone: 'error' },
    invalid_rep: { message: 'That user is not marked as an active sales rep.', tone: 'error' },
    maintenance_archived: { message: 'Lead was soft deleted from the maintenance bucket.', tone: 'success' },
    maintenance_dnc: { message: 'Clear Do Not Contact before recycling that lead.', tone: 'error' },
    maintenance_error: { message: 'Unable to update that maintenance lead.', tone: 'error' },
    maintenance_missing: { message: 'That maintenance lead could not be found.', tone: 'error' },
    maintenance_recycled: { message: 'Lead moved to Recycle / Try Later and returned to the unassigned pool.', tone: 'success' },
  };
  const match = messages[toast];
  return match ? <StatusToast message={match.message} tone={match.tone} /> : null;
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="stat-card">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

function LeadStageBadge({ stage }: { stage: string | null | undefined }) {
  const normalized = normalizeStage(stage);
  const classes: Record<ProspectingStage, string> = {
    converted: 'bg-emerald-50 text-emerald-800',
    follow_up: 'bg-amber-50 text-amber-800',
    interested: 'bg-teal-50 text-teal-800',
    lost: 'bg-rose-50 text-rose-800',
    new: 'bg-slate-100 text-slate-700',
    not_a_fit: 'bg-zinc-100 text-zinc-700',
    recycle_try_later: 'bg-sky-50 text-sky-800',
    sample_requested: 'bg-indigo-50 text-indigo-800',
    working: 'bg-blue-50 text-blue-800',
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classes[normalized]}`}>{stageLabel(normalized)}</span>;
}

function MissingBadges({ missing }: { missing: string[] }) {
  if (!missing.length) return <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">Complete enough</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {missing.slice(0, 3).map((item) => (
        <span key={item} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{item}</span>
      ))}
      {missing.length > 3 ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">+{missing.length - 3}</span> : null}
    </div>
  );
}

export default async function ProspectingAdminPage({ searchParams }: { searchParams?: SearchParams }) {
  const current = await requireAdminSectionView('prospecting');
  if (!current.isOwner) redirect('/admin/access-denied?section=prospecting');
  const canEdit = adminCanEdit(current.access, 'prospecting');
  const isOwner = current.isOwner;
  const supabase = await createClient();
  const bucket = normalizeBucket(searchParams?.bucket);
  const requestedListId = stringParam(searchParams?.list);
  const requestedRepId = stringParam(searchParams?.rep);
  const requestedStage = stringParam(searchParams?.stage);
  const requestedPriority = stringParam(searchParams?.priority);
  const selectedStateKey = normalizeStateFilter(searchParams?.state);
  const page = normalizePageNumber(searchParams?.page);
  const pageSize = normalizePageSize(searchParams?.page_size);
  const recyclePage = normalizePageNumber(searchParams?.recycle_page);
  const recyclePageSize = normalizePageSize(searchParams?.recycle_page_size);
  const { from, to } = paginationRange(page, pageSize);
  const { from: recycleFrom, to: recycleTo } = paginationRange(recyclePage, recyclePageSize);
  const q = stringParam(searchParams?.q).trim();
  const toast = stringParam(searchParams?.toast);

  const [salesReps, { data: listsData }] = await Promise.all([
    isOwner ? loadSalesReps(supabase) : Promise.resolve([current.profile as ProfileRow]),
    supabase.from('prospecting_lists').select('id,name,description,source,created_at').order('created_at', { ascending: false }),
  ]);

  const salesRepsRows = salesRepOptionRows(salesReps);
  const selectedRepId = bucket !== 'unassigned' && !isMaintenanceBucket(bucket) && isOwner && salesRepsRows.some((rep) => rep.id === requestedRepId) ? requestedRepId : '';
  const selectedPriority = PROSPECTING_PRIORITIES.some((priority) => priority.id === requestedPriority) ? requestedPriority as ProspectingPriority : '';
  const selectedStage = isMaintenanceBucket(bucket) ? '' : PROSPECTING_STAGES.some((stage) => stage.id === requestedStage) ? requestedStage as ProspectingStage : '';
  const listRows = (listsData ?? []) as ListRow[];
  const selectedListId = listRows.some((list) => list.id === requestedListId) ? requestedListId : '';

  const filters: LeadFilterState = {
    bucket,
    isOwner,
    listId: selectedListId,
    priority: selectedPriority,
    q,
    repId: selectedRepId || (!isOwner ? current.profile.id : ''),
    stage: selectedStage,
    stateKey: selectedStateKey,
  };

  const { data: leadsData, error: leadsError, count: leadCount } = await filteredLeadQuery(supabase, filters, '*', { count: 'exact' })
    .order('next_follow_up_at', { ascending: true })
    .order('updated_at', { ascending: false })
    .range(from, to);

  const leadRows = ((leadsData ?? []) as unknown as LeadRow[]);
  const totalLeads = leadCount ?? leadRows.length;
  const totalPages = totalPageCount(totalLeads, pageSize);
  const displayStart = totalLeads ? from + 1 : 0;
  const displayEnd = Math.min(to + 1, totalLeads);
  const leadIds = leadRows.map((lead) => lead.id);
  const metricFilters: LeadFilterState = {
    ...filters,
    bucket: 'all',
    q: '',
    stage: '',
  };
  const [
    { data: contactsData },
    { data: listLeadData },
    { count: metricTotal },
    { count: metricActive },
    { count: metricUnassigned },
    { count: metricInterested },
    { count: metricSamples },
    { count: metricNotAFit },
    { count: metricLost },
    { count: metricHubspot },
    { count: metricDnc },
    { count: metricFollowUps },
    { data: reportActivitiesData },
  ] = await Promise.all([
    leadIds.length ? supabase.from('prospecting_contacts').select('lead_id,full_name,email,phone').in('lead_id', leadIds) : Promise.resolve({ data: [] }),
    leadIds.length ? supabase.from('prospecting_list_leads').select('lead_id,list_id,prospecting_lists(name)').in('lead_id', leadIds) : Promise.resolve({ data: [] }),
    filteredLeadQuery(supabase, metricFilters, 'id', { count: 'exact', head: true }),
    filteredLeadQuery(supabase, { ...metricFilters, bucket: 'active' }, 'id', { count: 'exact', head: true }),
    filteredLeadQuery(supabase, { ...metricFilters, bucket: 'unassigned', repId: '' }, 'id', { count: 'exact', head: true }),
    filteredLeadQuery(supabase, { ...metricFilters, bucket: 'interested' }, 'id', { count: 'exact', head: true }),
    filteredLeadQuery(supabase, { ...metricFilters, bucket: 'sample_requested' }, 'id', { count: 'exact', head: true }),
    filteredLeadQuery(supabase, { ...metricFilters, bucket: 'not_a_fit_review', repId: '' }, 'id', { count: 'exact', head: true }),
    filteredLeadQuery(supabase, { ...metricFilters, bucket: 'lost_review', repId: '' }, 'id', { count: 'exact', head: true }),
    filteredLeadQuery(supabase, { ...metricFilters, bucket: 'hubspot' }, 'id', { count: 'exact', head: true }),
    filteredLeadQuery(supabase, metricFilters, 'id', { count: 'exact', head: true }).eq('do_not_contact', true),
    filteredLeadQuery(supabase, metricFilters, 'id', { count: 'exact', head: true }).not('next_follow_up_at', 'is', null),
    leadIds.length
      ? supabase
          .from('prospecting_activities')
          .select('lead_id,activity_type,result,created_at,created_by,previous_assigned_profile_id,next_stage')
          .in('lead_id', leadIds)
          .order('created_at', { ascending: false })
          .limit(5000)
      : Promise.resolve({ data: [] }),
  ]);

  const contacts = (contactsData ?? []) as ContactSummary[];
  const contactsByLead = new Map<string, ContactSummary[]>();
  for (const contact of contacts) contactsByLead.set(contact.lead_id, [...(contactsByLead.get(contact.lead_id) ?? []), contact]);

  const listLeadRows = (listLeadData ?? []) as ListLeadRow[];
  const listsByLead = new Map<string, string[]>();
  for (const row of listLeadRows) listsByLead.set(row.lead_id, [...(listsByLead.get(row.lead_id) ?? []), listName(row)]);

  const pageActivities = (reportActivitiesData ?? []) as ActivityReportRow[];
  const maintenanceStatsByLead = new Map<string, { calls: number; emails: number; notes: number; ownerId: string | null; touches: number }>();
  for (const activity of pageActivities) {
    if (!activity.lead_id) continue;
    const currentStats = maintenanceStatsByLead.get(activity.lead_id) ?? { calls: 0, emails: 0, notes: 0, ownerId: null, touches: 0 };
    if (activity.activity_type === 'call') {
      currentStats.calls += 1;
      currentStats.touches += 1;
    }
    if (activity.activity_type === 'email') {
      currentStats.emails += 1;
      currentStats.touches += 1;
    }
    if (activity.activity_type === 'note') {
      currentStats.notes += 1;
      currentStats.touches += 1;
    }
    if (!currentStats.ownerId && isMaintenanceStage(activity.next_stage)) {
      currentStats.ownerId = activity.previous_assigned_profile_id || activity.created_by;
    }
    maintenanceStatsByLead.set(activity.lead_id, currentStats);
  }

  const maintenanceOwnerIds = [...new Set([...maintenanceStatsByLead.values()].map((stats) => stats.ownerId).filter(Boolean))] as string[];
  const assignedProfileIds = [...new Set([...leadRows.map((lead) => lead.assigned_profile_id).filter(Boolean), ...maintenanceOwnerIds])] as string[];
  const { data: assignedProfilesData } = assignedProfileIds.length
    ? await supabase.from('profiles').select('id,email,full_name,is_active').in('id', assignedProfileIds)
    : { data: [] };
  const profileById = new Map(((assignedProfilesData ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));

  const metrics = {
    active: metricActive ?? 0,
    dnc: metricDnc ?? 0,
    followUps: metricFollowUps ?? 0,
    hubspot: metricHubspot ?? 0,
    interested: metricInterested ?? 0,
    lost: metricLost ?? 0,
    notAFit: metricNotAFit ?? 0,
    samples: metricSamples ?? 0,
    total: metricTotal ?? 0,
    unassigned: metricUnassigned ?? 0,
  };
  const reportMetrics = pageActivities.reduce((summary, activity) => {
    const result = String(activity.result ?? '').trim().toLowerCase();
    if (activity.activity_type === 'call') summary.calls += 1;
    if (activity.activity_type === 'email') summary.emails += 1;
    if (['interested', 'reply interested', 'requested pricing'].includes(result)) summary.interested += 1;
    if (['sample requested', 'requested sample'].includes(result)) summary.samples += 1;
    return summary;
  }, { calls: 0, emails: 0, interested: 0, samples: 0 });

  const recycleActivitiesResult = isOwner
    ? await supabase
        .from('prospecting_activities')
        .select(
          'id,lead_id,activity_type,result,body,previous_stage,previous_assigned_profile_id,created_by,created_at,prospecting_leads(id,company_name,phone,city,state,stage,last_result,assigned_profile_id)',
          { count: 'exact' },
        )
        .eq('next_stage', 'recycle_try_later')
        .neq('activity_type', 'assignment')
        .order('created_at', { ascending: false })
        .range(recycleFrom, recycleTo)
    : { data: [], error: null, count: 0 };
  const recycleActivities = ((recycleActivitiesResult.data ?? []) as unknown as RecycleReportActivityRow[]);
  const recycleTotal = recycleActivitiesResult.count ?? recycleActivities.length;
  const recycleTotalPages = totalPageCount(recycleTotal, recyclePageSize);
  const recycleDisplayStart = recycleTotal ? recycleFrom + 1 : 0;
  const recycleDisplayEnd = Math.min(recycleTo + 1, recycleTotal);
  const recycleLeadIds = [...new Set(recycleActivities.map((activity) => activity.lead_id).filter(Boolean))];
  const recycleProfileIds = [...new Set(recycleActivities.flatMap((activity) => [
    activity.created_by,
    activity.previous_assigned_profile_id,
    relatedOne(activity.prospecting_leads)?.assigned_profile_id,
  ]).filter(Boolean))] as string[];
  const [{ data: recycleTouchesData }, { data: recycleProfilesData }] = await Promise.all([
    recycleLeadIds.length
      ? supabase
          .from('prospecting_activities')
          .select('lead_id,activity_type,created_at')
          .in('lead_id', recycleLeadIds)
          .in('activity_type', ['call', 'email', 'note'])
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
    recycleProfileIds.length
      ? supabase.from('profiles').select('id,email,full_name,is_active').in('id', recycleProfileIds)
      : Promise.resolve({ data: [] }),
  ]);
  const recycleProfileById = new Map(((recycleProfilesData ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));
  const recycleTouchesByLead = new Map<string, RecycleTouchRow[]>();
  for (const touch of ((recycleTouchesData ?? []) as RecycleTouchRow[])) {
    recycleTouchesByLead.set(touch.lead_id, [...(recycleTouchesByLead.get(touch.lead_id) ?? []), touch]);
  }
  const recycleReportRows = recycleActivities.map((activity) => {
    const recycledAt = activity.created_at ? Date.parse(activity.created_at) : Number.MAX_SAFE_INTEGER;
    const touchRows = (recycleTouchesByLead.get(activity.lead_id) ?? []).filter((touch) => {
      const touchAt = touch.created_at ? Date.parse(touch.created_at) : 0;
      return Number.isNaN(recycledAt) || Number.isNaN(touchAt) || touchAt <= recycledAt;
    });
    const calls = touchRows.filter((touch) => touch.activity_type === 'call').length;
    const emails = touchRows.filter((touch) => touch.activity_type === 'email').length;
    const notes = touchRows.filter((touch) => touch.activity_type === 'note').length;
    const ownerId = activity.previous_assigned_profile_id || activity.created_by;
    const recycledById = activity.created_by;
    return {
      activity,
      calls,
      emails,
      lead: relatedOne(activity.prospecting_leads),
      notes,
      owner: ownerId ? recycleProfileById.get(ownerId) : null,
      ownerIsFallback: !activity.previous_assigned_profile_id && Boolean(activity.created_by),
      recycledBy: recycledById ? recycleProfileById.get(recycledById) : null,
      touches: touchRows.length,
    };
  });

  const ownerData = isOwner ? await Promise.all([
    supabase
      .from('prospecting_imports')
      .select('id,file_name,status,inserted_count,updated_count,skipped_count,review_count,error_summary,created_at,prospecting_lists(name)')
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('prospecting_duplicate_reviews')
      .select('id,row_number,company_name,phone,reason,created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(8),
  ]) : [];
  const importRows = ((ownerData[0]?.data ?? []) as ImportRow[]);
  const duplicateReviews = ((ownerData[1]?.data ?? []) as DuplicateReviewRow[]);

  return (
    <div className="space-y-6">
      <Toasts toast={toast} />
      {leadsError ? (
        <StatusToast message="Prospecting lead storage is not ready. Apply migration 043_prospecting_lead_workspace.sql." tone="error" />
      ) : null}

      <section className="panel">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <span className="eyebrow">Prospecting Admin</span>
            <h1 className="page-title mt-4">Lead lists, assignment, reporting, and HubSpot handoff</h1>
            <p className="page-subtitle mt-3">
              Add leads, assign reps, review team activity, and manage the HubSpot handoff without cluttering the rep workspace.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
            <Link className="btn-secondary inline-flex" href="/admin/sales/prospecting">Rep Board</Link>
            <Link className="btn-secondary inline-flex" href="/admin/sales/prospecting/template">CSV Template</Link>
            <Link className="btn-secondary inline-flex" href="/admin/sales/prospecting/sample-boxes">Sample Boxes</Link>
            {isOwner ? <Link className="btn-primary inline-flex" href="/admin/sales/prospecting/hubspot-export">Export HubSpot CSV</Link> : null}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active" value={metrics.active.toLocaleString()} detail="New, working, and follow-up leads still in the calling queue." />
        <StatCard label="Unassigned" value={metrics.unassigned.toLocaleString()} detail="Leads that still need a sales rep assigned." />
        <StatCard label="Interested" value={metrics.interested.toLocaleString()} detail="Leads that left the active list for the interested bucket." />
        <StatCard label="Samples" value={metrics.samples.toLocaleString()} detail="Leads ready for sample handling and HubSpot review." />
        <StatCard label="Not a Fit Review" value={metrics.notAFit.toLocaleString()} detail="Owner-only leads waiting for delete or recycle review." />
        <StatCard label="Lost Review" value={metrics.lost.toLocaleString()} detail="Lost leads waiting for owner maintenance." />
        <StatCard label="HubSpot Queue" value={metrics.hubspot.toLocaleString()} detail="Interested or sample leads waiting for export." />
        <StatCard label="Follow-Ups" value={metrics.followUps.toLocaleString()} detail="Leads with a next follow-up date scheduled." />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Calls Made" value={reportMetrics.calls.toLocaleString()} detail="Call activities logged on the visible lead page." />
        <StatCard label="Emails Sent" value={reportMetrics.emails.toLocaleString()} detail="Email activities logged on the visible lead page." />
        <StatCard label="Interested Results" value={reportMetrics.interested.toLocaleString()} detail="Activities where the canned result indicated interest." />
        <StatCard label="Sample Requests" value={reportMetrics.samples.toLocaleString()} detail="Activities where a sample was requested." />
      </section>

      {isOwner ? (
        <section className="card space-y-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recycle Report</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Leads sent to Recycle / Try Later</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                Review who owned each recycled lead and how many touches were logged before it went back to the unassigned pool.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row xl:justify-end">
              <Link
                className="btn-secondary inline-flex"
                href={prospectingHref({
                  bucket: 'all',
                  list: selectedListId,
                  page: 1,
                  pageSize,
                  priority: selectedPriority,
                  q,
                  rep: selectedRepId,
                  state: selectedStateKey,
                  stage: 'recycle_try_later',
                })}
              >
                View Current Recycle Leads
              </Link>
              <form className="flex items-end gap-2" action={PROSPECTING_ADMIN_PATH}>
                <input type="hidden" name="bucket" value={bucket} />
                <input type="hidden" name="list" value={selectedListId} />
                <input type="hidden" name="rep" value={selectedRepId} />
                <input type="hidden" name="priority" value={selectedPriority} />
                <input type="hidden" name="stage" value={selectedStage} />
                <input type="hidden" name="state" value={selectedStateKey} />
                <input type="hidden" name="q" value={q} />
                <input type="hidden" name="page" value={page} />
                <input type="hidden" name="page_size" value={pageSize} />
                <input type="hidden" name="recycle_page" value="1" />
                <label className="text-sm font-semibold text-slate-700">
                  Rows
                  <select className="input mt-2 min-w-24" name="recycle_page_size" defaultValue={recyclePageSize}>
                    {PROSPECTING_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
                <button className="btn-secondary h-11" type="submit">Apply</button>
              </form>
            </div>
          </div>

          {recycleActivitiesResult.error ? (
            <StatusToast message="Recycle reporting is waiting on the latest database migration." tone="error" />
          ) : null}

          <div className="flex flex-col gap-3 rounded-lg bg-white/60 px-3 py-2 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
            <p>
              Showing {recycleDisplayStart.toLocaleString()}-{recycleDisplayEnd.toLocaleString()} of {recycleTotal.toLocaleString()} recycle records
            </p>
            <div className="flex gap-2">
              <Link
                className={`btn-secondary inline-flex ${recyclePage <= 1 ? 'pointer-events-none opacity-50' : ''}`}
                href={prospectingHref({
                  bucket,
                  list: selectedListId,
                  page,
                  pageSize,
                  priority: selectedPriority,
                  q,
                  rep: selectedRepId,
                  recyclePage: Math.max(1, recyclePage - 1),
                  recyclePageSize,
                  stage: selectedStage,
                  state: selectedStateKey,
                })}
              >
                Previous
              </Link>
              <Link
                className={`btn-secondary inline-flex ${recyclePage >= recycleTotalPages ? 'pointer-events-none opacity-50' : ''}`}
                href={prospectingHref({
                  bucket,
                  list: selectedListId,
                  page,
                  pageSize,
                  priority: selectedPriority,
                  q,
                  rep: selectedRepId,
                  recyclePage: Math.min(recycleTotalPages, recyclePage + 1),
                  recyclePageSize,
                  stage: selectedStage,
                  state: selectedStateKey,
                })}
              >
                Next
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] border-separate border-spacing-y-2 text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-3 py-2">Lead</th>
                  <th className="px-3 py-2">Owner Before Recycle</th>
                  <th className="px-3 py-2">Recycled By</th>
                  <th className="px-3 py-2">Touches Before Recycle</th>
                  <th className="px-3 py-2">Stage / Result</th>
                  <th className="px-3 py-2">Recycled</th>
                  <th className="px-3 py-2">Open</th>
                </tr>
              </thead>
              <tbody>
                {recycleReportRows.map((row) => {
                  const lead = row.lead;
                  return (
                    <tr key={row.activity.id} className="bg-white/70">
                      <td className="rounded-l-lg px-3 py-3">
                        <p className="font-semibold text-slate-950">{lead?.company_name || 'Deleted lead'}</p>
                        <p className="mt-1 text-slate-500">{lead?.phone || 'Missing phone'} - {[lead?.city, lead?.state].filter(Boolean).join(', ') || 'Missing city/state'}</p>
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        <p className="font-semibold text-slate-950">{unknownProfileLabel(row.owner)}</p>
                        {row.ownerIsFallback ? <p className="mt-1 text-xs text-amber-700">Best available from recycled-by history</p> : null}
                      </td>
                      <td className="px-3 py-3 text-slate-700">{unknownProfileLabel(row.recycledBy)}</td>
                      <td className="px-3 py-3 text-slate-700">
                        <p className="font-semibold text-slate-950">{row.touches.toLocaleString()} total</p>
                        <p className="mt-1 text-slate-500">{row.calls} calls, {row.emails} emails, {row.notes} notes</p>
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        <p className="font-semibold text-slate-950">{stageLabel(row.activity.previous_stage)} to Recycle / Try Later</p>
                        <p className="mt-1 text-slate-500">{row.activity.result || lead?.last_result || 'No result logged'}</p>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{formatDateTime(row.activity.created_at)}</td>
                      <td className="rounded-r-lg px-3 py-3">
                        {lead ? <Link className="font-semibold text-teal-800" href={leadDetailHref(lead.id, selectedStateKey)}>Open Lead</Link> : <span className="text-slate-400">Unavailable</span>}
                      </td>
                    </tr>
                  );
                })}
                {!recycleReportRows.length ? (
                  <tr>
                    <td colSpan={7} className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500">
                      No leads have been moved into Recycle / Try Later yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {isOwner ? (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)]">
          <form action="/admin/sales/prospecting/import" method="post" encType="multipart/form-data" className="card space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">CSV Import</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Upload a lead list</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Blank values stay blank and appear as missing fields for reps to enrich while they work the lead.
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <label className="text-sm font-semibold text-slate-700">
                New list name
                <input className="input mt-2" name="list_name" placeholder="Detox Centers Q3" />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Or add to existing list
                <select className="input mt-2" name="existing_list_id" defaultValue="">
                  <option value="">Create a new list</option>
                  {listRows.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                CSV file
                <input className="input mt-2" name="lead_csv" type="file" accept=".csv,text/csv" required />
              </label>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Required Headers</p>
              <code className="mt-2 block min-w-[62rem] text-xs text-slate-700">{PROSPECTING_CSV_HEADERS.join(', ')}</code>
            </div>
            <PendingSubmitButton className="btn-primary w-full sm:w-auto" disabled={!canEdit} disabledLabel="No edit access" label="Import Leads" pendingLabel="Importing..." />
          </form>

          <section className="card space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Import History</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Recent uploads</h2>
            </div>
            <div className="space-y-3">
              {importRows.map((row) => (
                <div key={row.id} className="rounded-lg bg-white/70 px-3 py-2 text-sm">
                  <p className="font-semibold text-slate-950">{row.file_name || 'CSV import'}</p>
                  <p className="mt-1 text-slate-500">{importListName(row)} - {formatDateTime(row.created_at)}</p>
                  <p className="mt-1 text-slate-700">
                    {row.inserted_count ?? 0} new, {row.updated_count ?? 0} merged, {row.skipped_count ?? 0} skipped, {row.review_count ?? 0} review
                  </p>
                </div>
              ))}
              {!importRows.length ? <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">No imports yet.</p> : null}
            </div>
          </section>
        </section>
      ) : null}

      <section className="card space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Lead Workspace</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{BUCKETS.find((item) => item.id === bucket)?.label}</h2>
          </div>
          <nav className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            {BUCKETS.map((item) => (
              <Link
                key={item.id}
                className={`rounded-lg border px-3 py-2 text-center text-sm font-semibold ${bucket === item.id ? 'border-teal-200 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white/70 text-slate-700'}`}
                href={adminFilterHref({ ...filters, bucket: item.id, repId: item.id === 'unassigned' || isMaintenanceBucket(item.id) ? '' : filters.repId }, { page: 1, pageSize })}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <form className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_9rem_auto] lg:items-end">
          <input type="hidden" name="bucket" value={bucket} />
          <label className="text-sm font-semibold text-slate-700">
            Search
            <input className="input mt-2" name="q" defaultValue={q} placeholder="Company, phone, city, email" />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Lead list
            <select className="input mt-2" name="list" defaultValue={selectedListId}>
              <option value="">All lists</option>
              {listRows.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
          </label>
          {isOwner && (bucket === 'unassigned' || isMaintenanceBucket(bucket)) ? (
            <label className="text-sm font-semibold text-slate-700">
              Rep
              <input type="hidden" name="rep" value="" />
              <span className="mt-2 flex min-h-11 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
                {bucket === 'unassigned' ? 'Unassigned only' : 'Owner review only'}
              </span>
            </label>
          ) : isOwner ? (
            <label className="text-sm font-semibold text-slate-700">
              Rep
              <select className="input mt-2" name="rep" defaultValue={selectedRepId}>
                <option value="">All reps</option>
                {salesRepsRows.map((rep) => <option key={rep.id} value={rep.id}>{profileLabel(rep)}</option>)}
              </select>
            </label>
          ) : (
              <input type="hidden" name="rep" value="" />
          )}
          <label className="text-sm font-semibold text-slate-700">
            Priority
            <select className="input mt-2" name="priority" defaultValue={selectedPriority}>
              <option value="">All priorities</option>
              {PROSPECTING_PRIORITIES.map((priority) => <option key={priority.id} value={priority.id}>{priority.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            State
            <select className="input mt-2" name="state" defaultValue={selectedStateKey}>
              <option value="">All states</option>
              <option value={MISSING_STATE_FILTER}>Missing state</option>
              {US_STATE_OPTIONS.map((state) => <option key={state.id} value={state.id}>{state.id} - {state.label}</option>)}
            </select>
          </label>
          {isMaintenanceBucket(bucket) ? (
            <label className="text-sm font-semibold text-slate-700">
              Stage
              <input type="hidden" name="stage" value="" />
              <span className="mt-2 flex min-h-11 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
                {stageLabel(maintenanceStageForBucket(bucket))}
              </span>
            </label>
          ) : (
            <label className="text-sm font-semibold text-slate-700">
              Stage
              <select className="input mt-2" name="stage" defaultValue={selectedStage}>
                <option value="">All stages</option>
                {PROSPECTING_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
              </select>
            </label>
          )}
          <label className="text-sm font-semibold text-slate-700">
            Per page
            <select className="input mt-2" name="page_size" defaultValue={pageSize}>
              {PROSPECTING_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <button className="btn-primary w-full lg:w-auto" type="submit">Filter</button>
        </form>

        <div className="flex flex-col gap-3 rounded-lg bg-white/60 px-3 py-2 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
          <p>Showing {displayStart.toLocaleString()}-{displayEnd.toLocaleString()} of {totalLeads.toLocaleString()} leads</p>
          <div className="flex gap-2">
            <Link
              className={`btn-secondary inline-flex ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
              href={adminFilterHref(filters, { page: Math.max(1, page - 1), pageSize })}
            >
              Previous
            </Link>
            <Link
              className={`btn-secondary inline-flex ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}
              href={adminFilterHref(filters, { page: Math.min(totalPages, page + 1), pageSize })}
            >
              Next
            </Link>
          </div>
        </div>

        {bucket === 'hubspot' && isOwner && leadRows.length ? (
          <form action={markHubspotExported} className="rounded-lg border border-teal-100 bg-teal-50/70 p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-sm font-semibold text-teal-900">Select exported leads after adding them to HubSpot.</p>
              <PendingSubmitButton className="btn-primary w-full md:w-auto" label="Mark Exported" pendingLabel="Saving..." />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {leadRows.map((lead) => (
                <label key={lead.id} className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-2 text-sm text-slate-700">
                  <input type="checkbox" name="lead_id" value={lead.id} />
                  <span className="min-w-0 truncate">{lead.company_name}</span>
                </label>
              ))}
            </div>
          </form>
        ) : null}
      </section>

      {leadRows.length && isMaintenanceBucket(bucket) ? (
        <section className="space-y-3">
          {leadRows.map((lead) => {
            const leadContacts = contactsByLead.get(lead.id) ?? [];
            const missing = missingLeadFields(lead, leadContacts);
            const lists = listsByLead.get(lead.id) ?? [];
            const maintenanceStats = maintenanceStatsByLead.get(lead.id) ?? { calls: 0, emails: 0, notes: 0, ownerId: null, touches: 0 };
            const priorOwner = maintenanceStats.ownerId ? profileById.get(maintenanceStats.ownerId) : null;
            return (
              <article key={lead.id} className="card">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <LeadStageBadge stage={lead.stage} />
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">{priorityLabel(lead.priority)}</span>
                      {lead.do_not_contact ? <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800">Do Not Contact</span> : null}
                    </div>
                    <Link href={leadDetailHref(lead.id, selectedStateKey)} className="mt-3 block text-2xl font-semibold tracking-tight text-slate-950 hover:text-teal-800">
                      {lead.company_name}
                    </Link>
                    <div className="mt-2 grid gap-2 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                      <p>{lead.phone || 'Missing phone'}</p>
                      <p>{lead.company_email || 'Missing company email'}</p>
                      <p>{[lead.city, lead.state].filter(Boolean).join(', ') || 'Missing city/state'}</p>
                      <p>Prior owner: {unknownProfileLabel(priorOwner)}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <MissingBadges missing={missing} />
                      {lists.slice(0, 3).map((name) => <span key={name} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{name}</span>)}
                    </div>
                    {lead.notes ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-500">{lead.notes}</p> : null}
                  </div>
                  <div className="grid gap-2 text-sm text-slate-600">
                    <div className="rounded-lg bg-white/70 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Touches</p>
                      <p className="mt-1 font-semibold text-slate-950">{maintenanceStats.touches.toLocaleString()} total</p>
                      <p className="mt-1 text-slate-500">{maintenanceStats.calls} calls, {maintenanceStats.emails} emails, {maintenanceStats.notes} notes</p>
                    </div>
                    <div className="rounded-lg bg-white/70 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Last Result</p>
                      <p className="mt-1 font-semibold text-slate-950">{lead.last_result || 'No activity yet'}</p>
                    </div>
                    <Link className="btn-secondary w-full" href={leadDetailHref(lead.id, selectedStateKey)}>Open Lead</Link>
                    <form action={recycleMaintenanceLead}>
                      <input type="hidden" name="lead_id" value={lead.id} />
                      <input type="hidden" name="bucket" value={bucket} />
                      <input type="hidden" name="list" value={selectedListId} />
                      <input type="hidden" name="rep" value="" />
                      <input type="hidden" name="priority" value={selectedPriority} />
                      <input type="hidden" name="stage" value="" />
                      <input type="hidden" name="state" value={selectedStateKey} />
                      <input type="hidden" name="q" value={q} />
                      <input type="hidden" name="page" value={page} />
                      <input type="hidden" name="page_size" value={pageSize} />
                      <PendingSubmitButton className="btn-primary w-full" disabled={Boolean(lead.do_not_contact)} disabledLabel="Clear Do Not Contact First" label="Recycle Later" pendingLabel="Recycling..." />
                    </form>
                    <form action={archiveMaintenanceLead}>
                      <input type="hidden" name="lead_id" value={lead.id} />
                      <input type="hidden" name="bucket" value={bucket} />
                      <input type="hidden" name="list" value={selectedListId} />
                      <input type="hidden" name="rep" value="" />
                      <input type="hidden" name="priority" value={selectedPriority} />
                      <input type="hidden" name="stage" value="" />
                      <input type="hidden" name="state" value={selectedStateKey} />
                      <input type="hidden" name="q" value={q} />
                      <input type="hidden" name="page" value={page} />
                      <input type="hidden" name="page_size" value={pageSize} />
                      <ConfirmSubmitButton className="w-full rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700" confirmMessage="Soft delete this lead from normal prospecting views?" label="Delete Lead" pendingLabel="Deleting..." />
                    </form>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : leadRows.length ? (
        <form id="prospecting-bulk-assignment" action={bulkAssignLeads} className="space-y-3">
          <input type="hidden" name="bucket" value={bucket} />
          <input type="hidden" name="list" value={selectedListId} />
          <input type="hidden" name="rep" value={selectedRepId} />
          <input type="hidden" name="priority" value={selectedPriority} />
          <input type="hidden" name="stage" value={selectedStage} />
          <input type="hidden" name="state" value={selectedStateKey} />
          <input type="hidden" name="q" value={q} />
          <input type="hidden" name="page" value={page} />
          <input type="hidden" name="page_size" value={pageSize} />

          {isOwner ? (
            <section className="rounded-lg border border-slate-200 bg-white/60 p-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
                <label className="text-sm font-semibold text-slate-700">
                  Assign to
                  <select className="input mt-2" name="sales_profile_id" defaultValue="">
                    <option value="">Unassigned</option>
                    {salesRepsRows.map((rep) => <option key={rep.id} value={rep.id}>{profileLabel(rep)}</option>)}
                  </select>
                </label>
                <fieldset className="grid gap-2 rounded-lg bg-white/70 p-3 text-sm text-slate-700">
                  <label className="flex items-center gap-2">
                    <input className="h-5 w-5 accent-teal-600" type="radio" name="scope" value="selected" defaultChecked />
                    <span>Selected leads on this page</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input className="h-5 w-5 accent-teal-600" type="radio" name="scope" value="all_filtered" />
                    <span>All leads matching current filters</span>
                  </label>
                </fieldset>
                <PendingSubmitButton className="btn-primary w-full md:w-auto" label="Apply Assignment" pendingLabel="Assigning..." />
              </div>
              <div className="mt-3">
                <ProspectingBulkSelectionControls formId="prospecting-bulk-assignment" pageCount={leadRows.length} totalCount={totalLeads} />
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            {leadRows.map((lead) => {
              const leadContacts = contactsByLead.get(lead.id) ?? [];
              const missing = missingLeadFields(lead, leadContacts);
              const lists = listsByLead.get(lead.id) ?? [];
              const assigned = lead.assigned_profile_id ? profileById.get(lead.assigned_profile_id) : null;
              return (
                <article key={lead.id} className="card">
                  <div className="grid gap-4 xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:items-start">
                    {isOwner ? (
                      <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white/80 px-3 py-3 text-sm font-semibold text-slate-700 transition hover:border-teal-200 hover:bg-teal-50/50 xl:w-36">
                        <input className="h-7 w-7 shrink-0 accent-teal-600" data-lead-select="true" type="checkbox" name="lead_id" value={lead.id} />
                        <span>Select</span>
                      </label>
                    ) : null}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <LeadStageBadge stage={lead.stage} />
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">{priorityLabel(lead.priority)}</span>
                        {lead.do_not_contact ? <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800">Do Not Contact</span> : null}
                        {isHubspotQueueStage(lead.stage) ? <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800">HubSpot: {lead.hubspot_status}</span> : null}
                      </div>
                    <Link href={leadDetailHref(lead.id, selectedStateKey)} className="mt-3 block text-2xl font-semibold tracking-tight text-slate-950 hover:text-teal-800">
                        {lead.company_name}
                      </Link>
                      <div className="mt-2 grid gap-2 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                        <p>{lead.phone || 'Missing phone'}</p>
                        <p>{lead.company_email || 'Missing company email'}</p>
                        <p>{[lead.city, lead.state].filter(Boolean).join(', ') || 'Missing city/state'}</p>
                        <p>Rep: {profileLabel(assigned)}</p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <MissingBadges missing={missing} />
                        {lists.slice(0, 3).map((name) => <span key={name} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{name}</span>)}
                      </div>
                      {lead.notes ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-500">{lead.notes}</p> : null}
                    </div>
                    <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3 xl:w-80 xl:grid-cols-1">
                      <div className="rounded-lg bg-white/70 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Next Follow-Up</p>
                        <p className="mt-1 font-semibold text-slate-950">{formatDate(lead.next_follow_up_at)}</p>
                      </div>
                      <div className="rounded-lg bg-white/70 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Last Result</p>
                        <p className="mt-1 font-semibold text-slate-950">{lead.last_result || 'No activity yet'}</p>
                      </div>
                      <Link className="btn-primary w-full" href={leadDetailHref(lead.id, selectedStateKey)}>Open Lead</Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        </form>
      ) : (
        <div className="card border-dashed py-12 text-center">
          <h2 className="text-xl font-semibold text-slate-950">No leads found</h2>
          <p className="mt-2 text-sm text-slate-500">Try another bucket, clear filters, or import a CSV list.</p>
        </div>
      )}

      {isOwner && duplicateReviews.length ? (
        <section className="card space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Duplicate Review</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Company matches with different phone numbers</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-separate border-spacing-y-2 text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {duplicateReviews.map((row) => (
                  <tr key={row.id} className="bg-white/70">
                    <td className="rounded-l-lg px-3 py-2 font-semibold text-slate-950">{row.company_name || 'Missing company'}</td>
                    <td className="px-3 py-2 text-slate-700">{row.phone || 'Missing phone'}</td>
                    <td className="px-3 py-2 text-slate-700">{row.row_number}</td>
                    <td className="px-3 py-2 text-slate-700">{row.reason}</td>
                    <td className="rounded-r-lg px-3 py-2 text-slate-700">{formatDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">HubSpot Export Fields</p>
        <code className="block overflow-x-auto rounded-lg bg-white/70 p-3 text-xs text-slate-700">
          {csvLine(['company_name', 'company_phone', 'company_email', 'address_line_1', 'city', 'state', 'postal_code', 'primary_contact_name', 'primary_contact_email', 'primary_contact_phone', 'assigned_rep', 'stage', 'last_result', 'notes'])}
        </code>
      </section>
    </div>
  );
}
