import Link from 'next/link';
import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { adminCanEdit, requireAdminSectionEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import {
  createProspectingSampleOrder,
  prospectingSampleOrderInputFromFormData,
} from '@/lib/prospecting-sample-orders';
import {
  MISSING_STATE_FILTER,
  US_STATE_OPTIONS,
  postgrestIlikePattern,
  prospectingLeadPath,
  prospectingPath,
  prospectingQueueContextFromParams,
  prospectingQueueHiddenFields,
  prospectingQueueOrderFields,
  prospectingQueueQueryString,
  prospectingQueueRequiresFollowUp,
  prospectingQueueSkipsTouchedToday,
  prospectingQueueStageFilter,
  type ProspectingQueueContext,
} from '@/lib/prospecting';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { formatCentralDateInput, parseCentralDateInput } from '@/lib/time-clock';

type SearchParams = Record<string, string | string[] | undefined>;
type Related<T> = T | T[] | null | undefined;

type LeadRow = {
  address_line_1: string | null;
  address_line_2: string | null;
  assigned_profile_id: string | null;
  city: string | null;
  company_name: string;
  id: string;
  postal_code: string | null;
  state: string | null;
};

type ContactRow = {
  full_name: string | null;
  is_primary: boolean | null;
};

type ProductRow = {
  id: string;
  name: string | null;
  product_recipes?: Related<{ id: string | null }>;
  sku: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sampleOrderHref({
  leadId,
  nextRecordId,
  previousRecordId,
  queueContext,
  toast,
}: {
  leadId?: string | null;
  nextRecordId?: string;
  previousRecordId?: string;
  queueContext?: ProspectingQueueContext;
  toast?: string;
}) {
  const params = new URLSearchParams(queueContext ? prospectingQueueQueryString(queueContext, { includePageSize: true }) : undefined);
  if (leadId) params.set('lead', leadId);
  if (nextRecordId) params.set('next_record_id', nextRecordId);
  if (previousRecordId) params.set('previous_record_id', previousRecordId);
  if (toast) params.set('toast', toast);
  const query = params.toString();
  return `/admin/sales/prospecting/sample-order${query ? `?${query}` : ''}`;
}

function cleanRecordId(value: FormDataEntryValue | string | string[] | null | undefined) {
  const text = typeof value === 'string' ? value.trim() : '';
  return UUID_PATTERN.test(text) ? text : '';
}

function QueueContextFields({ context }: { context: ProspectingQueueContext }) {
  return (
    <>
      {prospectingQueueHiddenFields(context).map((field) => (
        <input key={field.name} type="hidden" name={field.name} value={field.value} />
      ))}
    </>
  );
}

async function sampleOrderCompletionHref({
  currentProfileId,
  isOwner,
  nextRecordId,
  previousRecordId,
  queueContext,
}: {
  currentProfileId: string;
  isOwner: boolean;
  nextRecordId: string;
  previousRecordId: string;
  queueContext: ProspectingQueueContext;
}) {
  const candidateIds = [nextRecordId, previousRecordId].filter(Boolean);
  if (!candidateIds.length) return prospectingPath(queueContext, { includePageSize: true, toast: 'sample_order_created' });

  const supabase = getSupabaseAdmin();
  const today = formatCentralDateInput(new Date());
  const todayStart = parseCentralDateInput(today) ?? new Date();
  const selectColumns = queueContext.listId ? 'id,prospecting_list_leads!inner(list_id)' : 'id';
  let query = supabase
    .from('prospecting_leads')
    .select(selectColumns)
    .in('id', candidateIds)
    .is('archived_at', null);

  if (isOwner) {
    if (queueContext.repId) query = query.eq('assigned_profile_id', queueContext.repId);
  } else {
    query = query.eq('assigned_profile_id', currentProfileId);
  }
  query = query.in('stage', prospectingQueueStageFilter(queueContext));
  if (prospectingQueueRequiresFollowUp(queueContext)) query = query.not('next_follow_up_at', 'is', null).lte('next_follow_up_at', today);
  if (prospectingQueueSkipsTouchedToday(queueContext)) query = query.or(`last_activity_at.is.null,last_activity_at.lt.${todayStart.toISOString()}`);
  if (queueContext.priority) query = query.eq('priority', queueContext.priority);
  if (queueContext.state === MISSING_STATE_FILTER) query = query.is('state_key', null);
  else if (queueContext.state) query = query.eq('state_key', queueContext.state);
  if (queueContext.listId) query = query.eq('prospecting_list_leads.list_id', queueContext.listId);
  if (queueContext.q) {
    const search = postgrestIlikePattern(queueContext.q);
    query = query.or([
      `company_name.ilike.${search}`,
      `phone.ilike.${search}`,
      `company_email.ilike.${search}`,
      `city.ilike.${search}`,
      `state.ilike.${search}`,
      `last_result.ilike.${search}`,
    ].join(','));
  }
  for (const order of prospectingQueueOrderFields(queueContext)) {
    query = query.order(order.column, { ascending: order.ascending });
  }

  const { data } = await query;
  const validIds = new Set(((data ?? []) as unknown as Array<{ id: string | null }>).map((row) => row.id).filter(Boolean));
  const destinationId = candidateIds.find((id) => validIds.has(id));
  return destinationId
    ? prospectingLeadPath(destinationId, queueContext, { includePageSize: true, toast: 'sample_order_created' })
    : prospectingPath(queueContext, { includePageSize: true, toast: 'sample_order_created' });
}

function productLabel(product: ProductRow) {
  return product.sku ? `${product.name || 'Sample box'} (${product.sku})` : product.name || 'Sample box';
}

function relatedList<T>(value: Related<T>): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function hasRecipe(product: ProductRow) {
  return relatedList(product.product_recipes).some((recipe) => Boolean(recipe?.id));
}

function toastMessage(toast: string) {
  const messages: Record<string, { message: string; tone: 'error' | 'success' }> = {
    admin_write_denied: { message: 'You do not have permission to order samples.', tone: 'error' },
    insert_error: { message: 'Unable to create the sample order.', tone: 'error' },
    invalid_items: { message: 'Choose at least one sample box quantity.', tone: 'error' },
    invalid_product: { message: 'Choose only active sample boxes with saved recipes.', tone: 'error' },
    lead_error: { message: 'Unable to update the linked prospecting lead.', tone: 'error' },
    missing_fields: { message: 'Enter the center, attention name, and full shipping address.', tone: 'error' },
    sample_requested: { message: 'Sample request saved. Choose the sample box quantity to create the production order.', tone: 'success' },
    unauthorized: { message: 'That lead is not assigned to you.', tone: 'error' },
  };
  return messages[toast];
}

async function submitSampleOrder(formData: FormData) {
  'use server';

  const leadId = String(formData.get('lead_id') ?? '').trim();
  const queueContext = prospectingQueueContextFromParams(formData);
  const nextRecordId = cleanRecordId(formData.get('next_record_id'));
  const previousRecordId = cleanRecordId(formData.get('previous_record_id'));
  const current = await requireAdminSectionEdit('prospecting', sampleOrderHref({ leadId, toast: 'admin_write_denied' }));
  const supabase = getSupabaseAdmin();
  const result = await createProspectingSampleOrder({
    currentProfileId: current.profile.id,
    input: prospectingSampleOrderInputFromFormData(formData),
    isOwner: current.isOwner,
    supabase,
  });

  if (result.error || !result.orderId) {
    redirect(sampleOrderHref({ leadId, nextRecordId, previousRecordId, queueContext, toast: result.error ?? 'insert_error' }));
  }

  if (leadId) {
    redirect(await sampleOrderCompletionHref({
      currentProfileId: current.profile.id,
      isOwner: current.isOwner,
      nextRecordId,
      previousRecordId,
      queueContext,
    }));
  }

  redirect(`/admin/orders/${result.orderId}?toast=sample_order_created`);
}

export default async function ProspectingSampleOrderPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const current = await requireAdminSectionView('prospecting');
  const canEdit = current.isOwner || adminCanEdit(current.access, 'prospecting');
  const supabase = await createClient();
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const queueContext = prospectingQueueContextFromParams(searchParams);
  const requestedLeadId = typeof searchParams?.lead === 'string' && UUID_PATTERN.test(searchParams.lead)
    ? searchParams.lead
    : '';
  const nextRecordId = cleanRecordId(searchParams?.next_record_id);
  const previousRecordId = cleanRecordId(searchParams?.previous_record_id);

  let leadQuery = requestedLeadId
    ? supabase
        .from('prospecting_leads')
        .select('id,assigned_profile_id,company_name,address_line_1,address_line_2,city,state,postal_code')
        .eq('id', requestedLeadId)
    : null;
  if (leadQuery && !current.isOwner) leadQuery = leadQuery.eq('assigned_profile_id', current.profile.id);

  const [leadResult, productsResult] = await Promise.all([
    leadQuery ? leadQuery.maybeSingle() : { data: null, error: null },
    supabase
      .from('products')
      .select('id,name,sku,product_recipes(id)')
      .eq('active', true)
      .eq('category', 'sample_boxes')
      .order('name', { ascending: true }),
  ]);

  const lead = leadResult.data as LeadRow | null;
  const contactsResult = lead?.id
    ? await supabase
        .from('prospecting_contacts')
        .select('full_name,is_primary')
        .eq('lead_id', lead.id)
    : { data: [] as ContactRow[] };
  const contacts = (contactsResult.data ?? []) as ContactRow[];
  const primaryContact = contacts.find((contact) => contact.is_primary) ?? contacts[0] ?? null;
  const products = ((productsResult.data ?? []) as ProductRow[]).filter(hasRecipe);
  const message = toastMessage(toast);

  return (
    <div className="space-y-6">
      {message ? <StatusToast message={message.message} tone={message.tone} /> : null}
      {requestedLeadId && !lead ? <StatusToast message="That lead could not be loaded for sample ordering." tone="error" /> : null}
      {productsResult.error ? <StatusToast message="Sample box products could not be loaded." tone="error" /> : null}

      <section className="panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="eyebrow">Prospecting</span>
            <h1 className="page-title mt-4">Order sample</h1>
            <p className="page-subtitle mt-3">
              {lead ? 'Review the lead details, choose sample boxes, and send the order to production.' : 'Enter the shipment details, choose sample boxes, and send a standalone order to production.'}
            </p>
          </div>
          <Link className="btn-secondary w-full sm:w-auto" href={prospectingPath(queueContext, { includePageSize: true })}>Back to Prospecting</Link>
        </div>
      </section>

      <form action={submitSampleOrder} className="card space-y-5">
        <input type="hidden" name="lead_id" value={lead?.id ?? ''} />
        <QueueContextFields context={queueContext} />
        <input type="hidden" name="next_record_id" value={nextRecordId} />
        <input type="hidden" name="previous_record_id" value={previousRecordId} />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            Center name
            <input className="input mt-2" name="center_name" defaultValue={lead?.company_name ?? ''} required disabled={!canEdit} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Attention name
            <input className="input mt-2" name="attention_name" defaultValue={primaryContact?.full_name ?? ''} required disabled={!canEdit} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Address 1
            <input className="input mt-2" name="address1" defaultValue={lead?.address_line_1 ?? ''} required disabled={!canEdit} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Address 2
            <input className="input mt-2" name="address2" defaultValue={lead?.address_line_2 ?? ''} disabled={!canEdit} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            City
            <input className="input mt-2" name="city" defaultValue={lead?.city ?? ''} required disabled={!canEdit} />
          </label>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <label className="text-sm font-semibold text-slate-700">
              State
              <select className="input mt-2" name="state" defaultValue={lead?.state ?? ''} required disabled={!canEdit}>
                <option value="">Select state</option>
                {US_STATE_OPTIONS.map((state) => <option key={state.id} value={state.id}>{state.id} - {state.label}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              ZIP
              <input className="input mt-2" name="zip" defaultValue={lead?.postal_code ?? ''} required disabled={!canEdit} />
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
          <p className="text-sm font-semibold text-slate-950">Sample box products</p>
          {!products.length ? (
            <p className="mt-3 text-sm text-slate-600">No active Sample Boxes products with saved recipes are available yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {products.map((product) => (
                <div key={product.id} className="grid gap-3 rounded-xl border border-slate-200 bg-white/70 p-3 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-center">
                  <div>
                    <p className="font-semibold text-slate-950">{productLabel(product)}</p>
                    <p className="mt-1 text-sm text-slate-500">Free sample order line</p>
                  </div>
                  <label className="text-sm font-semibold text-slate-700">
                    Qty
                    <input type="hidden" name="product_id" value={product.id} />
                    <input className="input mt-2" name="quantity" type="number" min="0" step="1" defaultValue={lead ? '0' : '1'} disabled={!canEdit} />
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="text-sm font-semibold text-slate-700">
          Special notes
          <textarea className="input mt-2 min-h-28" name="notes" placeholder="Delivery details, preferences, or context for production" disabled={!canEdit} />
        </label>

        <PendingSubmitButton
          className="btn-primary w-full sm:w-auto"
          data-press-lock-key="prospecting-sample-order"
          disabled={!canEdit || !products.length}
          disabledLabel={!canEdit ? 'Read-only access' : 'No sample boxes available'}
          label="Submit sample order"
          pendingLabel="Submitting..."
        />
      </form>
    </div>
  );
}
