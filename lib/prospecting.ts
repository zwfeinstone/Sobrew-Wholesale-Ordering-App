export const PROSPECTING_STAGES = [
  { id: 'new', label: 'New' },
  { id: 'working', label: 'Working' },
  { id: 'follow_up', label: 'Follow-up Needed' },
  { id: 'recycle_try_later', label: 'Recycle / Try Later' },
  { id: 'interested', label: 'Interested' },
  { id: 'sample_requested', label: 'Sample Requested' },
  { id: 'not_a_fit', label: 'Not a Fit' },
  { id: 'lost', label: 'Lost' },
  { id: 'converted', label: 'Converted' },
] as const;

export type ProspectingStage = (typeof PROSPECTING_STAGES)[number]['id'];

export const ACTIVE_PROSPECTING_STAGES: ProspectingStage[] = ['new', 'working', 'follow_up', 'recycle_try_later'];
export const HUBSPOT_QUEUE_STAGES: ProspectingStage[] = ['interested', 'sample_requested'];
export const REP_PIPELINE_STAGES: ProspectingStage[] = [...ACTIVE_PROSPECTING_STAGES, 'interested'];
export const MAINTENANCE_PROSPECTING_STAGES: ProspectingStage[] = ['not_a_fit', 'lost'];

export const PROSPECTING_PRIORITIES = [
  { id: 'low', label: 'Low' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'High' },
] as const;

export type ProspectingPriority = (typeof PROSPECTING_PRIORITIES)[number]['id'];

export const PROSPECTING_PAGE_SIZES = [25, 50] as const;
export const DEFAULT_PROSPECTING_PAGE_SIZE = 50;
export const PROSPECTING_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const PROSPECTING_IMPORT_MAX_ROWS = 5000;
export const MISSING_STATE_FILTER = 'missing';

export const REP_PROSPECTING_TABS = [
  { id: 'list', label: 'List' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'tasks', label: 'Tasks' },
] as const;

export type RepProspectingTab = (typeof REP_PROSPECTING_TABS)[number]['id'];

export type ProspectingQueueContext = {
  listId: string;
  page: number;
  pageSize: typeof PROSPECTING_PAGE_SIZES[number];
  priority: '' | ProspectingPriority;
  q: string;
  repId: string;
  stage: '' | ProspectingStage;
  state: '' | ProspectingStateFilter;
  tab: RepProspectingTab;
};

export const US_STATE_OPTIONS = [
  { id: 'AL', label: 'Alabama' },
  { id: 'AK', label: 'Alaska' },
  { id: 'AZ', label: 'Arizona' },
  { id: 'AR', label: 'Arkansas' },
  { id: 'CA', label: 'California' },
  { id: 'CO', label: 'Colorado' },
  { id: 'CT', label: 'Connecticut' },
  { id: 'DE', label: 'Delaware' },
  { id: 'FL', label: 'Florida' },
  { id: 'GA', label: 'Georgia' },
  { id: 'HI', label: 'Hawaii' },
  { id: 'ID', label: 'Idaho' },
  { id: 'IL', label: 'Illinois' },
  { id: 'IN', label: 'Indiana' },
  { id: 'IA', label: 'Iowa' },
  { id: 'KS', label: 'Kansas' },
  { id: 'KY', label: 'Kentucky' },
  { id: 'LA', label: 'Louisiana' },
  { id: 'ME', label: 'Maine' },
  { id: 'MD', label: 'Maryland' },
  { id: 'MA', label: 'Massachusetts' },
  { id: 'MI', label: 'Michigan' },
  { id: 'MN', label: 'Minnesota' },
  { id: 'MS', label: 'Mississippi' },
  { id: 'MO', label: 'Missouri' },
  { id: 'MT', label: 'Montana' },
  { id: 'NE', label: 'Nebraska' },
  { id: 'NV', label: 'Nevada' },
  { id: 'NH', label: 'New Hampshire' },
  { id: 'NJ', label: 'New Jersey' },
  { id: 'NM', label: 'New Mexico' },
  { id: 'NY', label: 'New York' },
  { id: 'NC', label: 'North Carolina' },
  { id: 'ND', label: 'North Dakota' },
  { id: 'OH', label: 'Ohio' },
  { id: 'OK', label: 'Oklahoma' },
  { id: 'OR', label: 'Oregon' },
  { id: 'PA', label: 'Pennsylvania' },
  { id: 'RI', label: 'Rhode Island' },
  { id: 'SC', label: 'South Carolina' },
  { id: 'SD', label: 'South Dakota' },
  { id: 'TN', label: 'Tennessee' },
  { id: 'TX', label: 'Texas' },
  { id: 'UT', label: 'Utah' },
  { id: 'VT', label: 'Vermont' },
  { id: 'VA', label: 'Virginia' },
  { id: 'WA', label: 'Washington' },
  { id: 'WV', label: 'West Virginia' },
  { id: 'WI', label: 'Wisconsin' },
  { id: 'WY', label: 'Wyoming' },
  { id: 'DC', label: 'District of Columbia' },
] as const;

export type ProspectingStateCode = (typeof US_STATE_OPTIONS)[number]['id'];
export type ProspectingStateFilter = typeof MISSING_STATE_FILTER | ProspectingStateCode;

const US_STATE_IDS = new Set(US_STATE_OPTIONS.map((state) => state.id));

export const CALL_RESULTS = [
  'No answer',
  'Left voicemail',
  'Wrong number',
  'Reached gatekeeper',
  'Reached decision maker',
  'Call back later',
  'Requested info',
  'Interested',
  'Sample requested',
  'Not interested',
  'Do not contact',
] as const;

export const EMAIL_RESULTS = [
  'Intro sent',
  'Follow-up sent',
  'Bounced',
  'Out of office',
  'Reply interested',
  'Requested pricing',
  'Requested sample',
  'Not interested',
  'Unsubscribed',
] as const;

export const PROSPECTING_ACTIVITY_TYPES = [
  { id: 'call', label: 'Call' },
  { id: 'email', label: 'Email' },
  { id: 'note', label: 'Note' },
] as const;

export type ProspectingActivityType = (typeof PROSPECTING_ACTIVITY_TYPES)[number]['id'];

const CSV_HEADER_ALIASES: Record<string, string> = {
  address: 'address_line_1',
  address_1: 'address_line_1',
  address_line1: 'address_line_1',
  address_line_1: 'address_line_1',
  address_line2: 'address_line_2',
  address_line_2: 'address_line_2',
  assigned_rep: 'assigned_rep_email',
  business_name: 'company_name',
  company: 'company_name',
  company_email_address: 'company_email',
  company_phone_number: 'company_phone',
  contact_1_email: 'key_contact_1_email',
  contact_1_name: 'key_contact_1_name',
  contact_1_phone: 'key_contact_1_phone',
  contact_1_title: 'key_contact_1_title',
  contact_2_email: 'key_contact_2_email',
  contact_2_name: 'key_contact_2_name',
  contact_2_phone: 'key_contact_2_phone',
  contact_2_title: 'key_contact_2_title',
  contact_email: 'key_contact_1_email',
  contact_name: 'key_contact_1_name',
  contact_phone: 'key_contact_1_phone',
  contact_title: 'key_contact_1_title',
  email: 'company_email',
  facility_name: 'company_name',
  key_contact_email: 'key_contact_1_email',
  key_contact_name: 'key_contact_1_name',
  key_contact_phone: 'key_contact_1_phone',
  key_contact_title: 'key_contact_1_title',
  main_phone: 'company_phone',
  organization_name: 'company_name',
  phone: 'company_phone',
  phone_number: 'company_phone',
  primary_contact: 'key_contact_1_name',
  primary_contact_email: 'key_contact_1_email',
  primary_contact_name: 'key_contact_1_name',
  primary_contact_phone: 'key_contact_1_phone',
  primary_contact_title: 'key_contact_1_title',
  rep_email: 'assigned_rep_email',
  street_address: 'address_line_1',
  telephone: 'company_phone',
  web_site: 'company_website',
  website: 'company_website',
  zip: 'postal_code',
  zip_code: 'postal_code',
} as const;

export const PROSPECTING_CSV_HEADERS = [
  'list_name',
  'assigned_rep_email',
  'company_name',
  'company_phone',
  'address_line_1',
  'address_line_2',
  'city',
  'state',
  'postal_code',
  'country',
  'company_website',
  'company_email',
  'key_contact_1_name',
  'key_contact_1_title',
  'key_contact_1_email',
  'key_contact_1_phone',
  'key_contact_2_name',
  'key_contact_2_title',
  'key_contact_2_email',
  'key_contact_2_phone',
  'notes',
] as const;

export const PROSPECTING_CSV_TEMPLATE = [
  PROSPECTING_CSV_HEADERS.join(','),
  [
    'Detox Centers Q3',
    'jane@sobrew.com',
    'Blue River Recovery',
    '555-212-4100',
    '100 Main St',
    '',
    'Austin',
    'TX',
    '78701',
    'US',
    'https://blueriver.example',
    'info@blueriver.example',
    'Maya Patel',
    'Director',
    'maya@blueriver.example',
    '555-212-4101',
    '',
    '',
    '',
    '',
    'Warm intro from conference',
  ].map(csvCell).join(','),
  [
    'Detox Centers Q3',
    'jane@sobrew.com',
    'North Star Center',
    '',
    '',
    '',
    'Chicago',
    'IL',
    '60601',
    'US',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'Needs phone and contact enrichment',
  ].map(csvCell).join(','),
].join('\n');

export function normalizeTextKey(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const US_STATE_NAME_TO_ID = new Map<string, ProspectingStateCode>(
  US_STATE_OPTIONS.flatMap((state) => [
    [normalizeTextKey(state.label), state.id],
    [normalizeTextKey(state.id), state.id],
  ]),
);

US_STATE_NAME_TO_ID.set('washington dc', 'DC');
US_STATE_NAME_TO_ID.set('dc', 'DC');

export function normalizeStateKey(value: string | null | undefined): ProspectingStateCode | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const compact = text.replace(/[^a-z]/gi, '').toUpperCase();
  if (US_STATE_IDS.has(compact as ProspectingStateCode)) return compact as ProspectingStateCode;
  return US_STATE_NAME_TO_ID.get(normalizeTextKey(text)) ?? null;
}

export function normalizeStateFilter(value: string | string[] | null | undefined): '' | ProspectingStateFilter {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (text.toLowerCase() === MISSING_STATE_FILTER) return MISSING_STATE_FILTER;
  return normalizeStateKey(text) ?? '';
}

export function normalizePhoneKey(value: string | null | undefined) {
  return String(value ?? '').replace(/\D/g, '');
}

export function cleanText(value: FormDataEntryValue | string | null | undefined) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function stringValue(value: unknown) {
  return String(value ?? '').trim();
}

export function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function normalizePageNumber(value: string | string[] | undefined) {
  const text = typeof value === 'string' ? value : '';
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function normalizePageSize(value: string | string[] | undefined) {
  const text = typeof value === 'string' ? value : '';
  const parsed = Number.parseInt(text, 10);
  return PROSPECTING_PAGE_SIZES.includes(parsed as typeof PROSPECTING_PAGE_SIZES[number])
    ? parsed as typeof PROSPECTING_PAGE_SIZES[number]
    : DEFAULT_PROSPECTING_PAGE_SIZE;
}

type ProspectingQueueParamSource =
  | FormData
  | URLSearchParams
  | Record<string, FormDataEntryValue | string | string[] | null | undefined>
  | null
  | undefined;

function queueParam(source: ProspectingQueueParamSource, key: string) {
  if (!source) return '';
  if (source instanceof URLSearchParams) return String(source.get(key) ?? '').trim();
  if (typeof FormData !== 'undefined' && source instanceof FormData) return String(source.get(key) ?? '').trim();
  const value = (source as Record<string, FormDataEntryValue | string | string[] | null | undefined>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeProspectingTab(value: string | string[] | null | undefined): RepProspectingTab {
  const text = typeof value === 'string' ? value : '';
  return REP_PROSPECTING_TABS.some((tab) => tab.id === text) ? text as RepProspectingTab : 'list';
}

export function normalizeProspectingListId(value: string | string[] | null | undefined) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : '';
}

export function normalizeProspectingProfileId(value: string | string[] | null | undefined) {
  return normalizeProspectingListId(value);
}

export function prospectingQueueContextFromParams(source: ProspectingQueueParamSource): ProspectingQueueContext {
  const tab = normalizeProspectingTab(queueParam(source, 'queue_tab') || queueParam(source, 'tab'));
  const requestedPriority = queueParam(source, 'queue_priority') || queueParam(source, 'priority');
  const requestedStage = queueParam(source, 'queue_stage') || queueParam(source, 'stage');
  const priority = PROSPECTING_PRIORITIES.some((item) => item.id === requestedPriority)
    ? requestedPriority as ProspectingPriority
    : '';
  const normalizedStage = PROSPECTING_STAGES.some((stage) => stage.id === requestedStage)
    ? requestedStage as ProspectingStage
    : '';

  return {
    listId: normalizeProspectingListId(queueParam(source, 'queue_list') || queueParam(source, 'list') || queueParam(source, 'list_id')),
    page: normalizePageNumber(queueParam(source, 'queue_page') || queueParam(source, 'page')),
    pageSize: normalizePageSize(queueParam(source, 'queue_page_size') || queueParam(source, 'page_size')),
    priority,
    q: queueParam(source, 'queue_q') || queueParam(source, 'q'),
    repId: normalizeProspectingProfileId(queueParam(source, 'queue_rep_id') || queueParam(source, 'rep')),
    stage: tab === 'pipeline' && normalizedStage && REP_PIPELINE_STAGES.includes(normalizedStage) ? normalizedStage : '',
    state: normalizeStateFilter(queueParam(source, 'queue_state') || queueParam(source, 'state') || queueParam(source, 'state_filter')),
    tab,
  };
}

export function prospectingQueueQueryString(
  context: ProspectingQueueContext,
  options: { includePageSize?: boolean; page?: number | string; toast?: string } = {},
) {
  const query = new URLSearchParams();
  if (context.tab !== 'list') query.set('tab', context.tab);
  if (context.q) query.set('q', context.q);
  if (context.priority) query.set('priority', context.priority);
  if (context.tab === 'pipeline' && context.stage) query.set('stage', context.stage);
  if (context.state) query.set('state', context.state);
  if (context.listId) query.set('list', context.listId);
  if (context.repId) query.set('rep', context.repId);
  if (options.includePageSize || context.pageSize !== DEFAULT_PROSPECTING_PAGE_SIZE) query.set('page_size', String(context.pageSize));
  const page = options.page ?? context.page;
  if (options.page || Number(page) > 1) query.set('page', String(page));
  if (options.toast) query.set('toast', options.toast);
  return query.toString();
}

export function prospectingPath(
  context: ProspectingQueueContext,
  options: { includePageSize?: boolean; page?: number | string; toast?: string } = {},
) {
  const qs = prospectingQueueQueryString(context, options);
  return `/admin/sales/prospecting${qs ? `?${qs}` : ''}`;
}

export function prospectingLeadPath(
  leadId: string,
  context: ProspectingQueueContext,
  options: { includePageSize?: boolean; toast?: string } = {},
) {
  const qs = prospectingQueueQueryString(context, { includePageSize: options.includePageSize, toast: options.toast });
  return `/admin/sales/prospecting/${leadId}${qs ? `?${qs}` : ''}`;
}

export function prospectingQueueHiddenFields(context: ProspectingQueueContext) {
  return [
    { name: 'queue_tab', value: context.tab },
    { name: 'queue_q', value: context.q },
    { name: 'queue_priority', value: context.priority },
    { name: 'queue_stage', value: context.stage },
    { name: 'queue_state', value: context.state },
    { name: 'queue_page', value: String(context.page) },
    { name: 'queue_page_size', value: String(context.pageSize) },
    { name: 'queue_list', value: context.listId },
    { name: 'queue_rep_id', value: context.repId },
  ];
}

export function prospectingQueueStageFilter(context: ProspectingQueueContext): ProspectingStage[] {
  if (context.stage) return [context.stage];
  return context.tab === 'list' ? ACTIVE_PROSPECTING_STAGES : REP_PIPELINE_STAGES;
}

export function prospectingQueueRequiresFollowUp(context: ProspectingQueueContext) {
  return context.tab === 'tasks';
}

export function prospectingQueueOrderFields(context: ProspectingQueueContext) {
  if (context.tab === 'tasks') {
    return [
      { column: 'next_follow_up_at', ascending: true },
      { column: 'last_activity_at', ascending: true },
      { column: 'created_at', ascending: true },
      { column: 'id', ascending: true },
    ];
  }
  if (context.tab === 'pipeline') {
    return [
      { column: 'stage', ascending: true },
      { column: 'updated_at', ascending: false },
      { column: 'created_at', ascending: true },
      { column: 'id', ascending: true },
    ];
  }
  return [
    { column: 'last_activity_at', ascending: true },
    { column: 'created_at', ascending: true },
    { column: 'id', ascending: true },
  ];
}

export function paginationRange(page: number, pageSize: number) {
  const from = Math.max(0, (page - 1) * pageSize);
  return { from, to: from + pageSize - 1 };
}

export function totalPageCount(total: number | null | undefined, pageSize: number) {
  return Math.max(1, Math.ceil((total ?? 0) / pageSize));
}

export function postgrestIlikePattern(value: string) {
  return `%${value.trim().replace(/[,%]/g, ' ')}%`;
}

function normalizeCsvHeader(header: string) {
  const key = header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return CSV_HEADER_ALIASES[key] ?? key;
}

export function stageLabel(stage: string | null | undefined) {
  return PROSPECTING_STAGES.find((item) => item.id === stage)?.label ?? 'New';
}

export function priorityLabel(priority: string | null | undefined) {
  return PROSPECTING_PRIORITIES.find((item) => item.id === priority)?.label ?? 'Normal';
}

export function normalizeStage(value: string | null | undefined): ProspectingStage {
  return PROSPECTING_STAGES.some((stage) => stage.id === value) ? value as ProspectingStage : 'new';
}

export function normalizePriority(value: string | null | undefined): ProspectingPriority {
  return PROSPECTING_PRIORITIES.some((priority) => priority.id === value) ? value as ProspectingPriority : 'normal';
}

export function stageFromResult(result: string | null | undefined): ProspectingStage | null {
  const normalized = String(result ?? '').trim().toLowerCase();
  if (['interested', 'reply interested', 'requested pricing'].includes(normalized)) return 'interested';
  if (['sample requested', 'requested sample'].includes(normalized)) return 'sample_requested';
  if (['not interested', 'wrong number', 'bounced', 'unsubscribed', 'do not contact'].includes(normalized)) return 'not_a_fit';
  if (['call back later', 'requested info', 'follow-up sent', 'intro sent', 'out of office', 'left voicemail'].includes(normalized)) return 'follow_up';
  if (['reached decision maker', 'reached gatekeeper'].includes(normalized)) return 'working';
  return null;
}

export function resolveActivityStage({
  currentStage,
  explicitStage,
  result,
}: {
  currentStage: string | null | undefined;
  explicitStage?: string | null;
  result?: string | null;
}): ProspectingStage {
  const normalizedResult = String(result ?? '').trim().toLowerCase();
  if (['do not contact', 'unsubscribed', 'wrong number', 'bounced'].includes(normalizedResult)) return 'not_a_fit';
  const requestedStage = String(explicitStage ?? '').trim();
  return requestedStage ? normalizeStage(requestedStage) : normalizeStage(currentStage);
}

export function prospectingContactPayloadsFromCsv(row: Record<string, string>, leadId: string, createdBy: string) {
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

export function isHubspotQueueStage(stage: string | null | undefined) {
  return HUBSPOT_QUEUE_STAGES.includes(normalizeStage(stage));
}

export function isMaintenanceStage(stage: string | null | undefined) {
  return MAINTENANCE_PROSPECTING_STAGES.includes(normalizeStage(stage));
}

export function activeBucketForStage(stage: string | null | undefined) {
  const normalized = normalizeStage(stage);
  if (normalized === 'interested') return 'interested';
  if (normalized === 'sample_requested') return 'sample_requested';
  if (ACTIVE_PROSPECTING_STAGES.includes(normalized)) return 'active';
  return 'closed';
}

export function missingLeadFields(lead: {
  address_line_1?: string | null;
  city?: string | null;
  company_email?: string | null;
  phone?: string | null;
  postal_code?: string | null;
  state?: string | null;
}, contacts: Array<{ email?: string | null; full_name?: string | null; phone?: string | null }> = []) {
  const missing: string[] = [];
  if (!lead.phone) missing.push('Missing phone');
  if (!lead.address_line_1 || !lead.city || !lead.state || !lead.postal_code) missing.push('Missing address');
  if (!lead.company_email) missing.push('Missing company email');
  if (!contacts.some((contact) => contact.full_name || contact.email || contact.phone)) missing.push('Missing key contact');
  if (!contacts.some((contact) => contact.email)) missing.push('Missing contact email');
  return missing;
}

export type ParsedCsv = {
  errors: string[];
  rows: Array<Record<string, string>>;
};

export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  const errors: string[] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(current);
      current = '';
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      continue;
    }

    current += char;
  }

  if (inQuotes) errors.push('CSV has an unclosed quoted field.');
  row.push(current);
  if (row.some((cell) => cell.trim())) rows.push(row);

  if (!rows.length) return { rows: [], errors: errors.length ? errors : ['CSV file is empty.'] };

  const headers = rows[0].map(normalizeCsvHeader);
  const parsedRows = rows.slice(1).map((cells) => {
    const parsed: Record<string, string> = {};
    headers.forEach((header, index) => {
      parsed[header] = String(cells[index] ?? '').trim();
    });
    return parsed;
  });

  return { rows: parsedRows, errors };
}

export function csvCell(value: unknown) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvLine(values: unknown[]) {
  return values.map(csvCell).join(',');
}

export function formatDate(value: string | null | undefined) {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return 'No activity';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No activity';
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
