import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import LegacySampleOrderPage from './legacy-page';
import { isProspectingWorkspaceEnabled } from '@/lib/prospecting-rollout';
import ProspectingSampleOrderForm, { type SampleOrderFields, type SampleOrderFormState } from '@/components/prospecting-sample-order-form';
import { adminCanEdit, requireAdminSectionEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { createProspectingSampleOrder, prospectingSampleOrderInputFromFormData } from '@/lib/prospecting-sample-orders';
import { hasSampleRequestContact } from '@/lib/prospecting-sample-contact';
import { prospectingLeadPath, prospectingOriginPath, prospectingQueueContextFromParams, prospectingQueueHiddenFields } from '@/lib/prospecting';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

type SearchParams = Record<string, string | string[] | undefined>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanId = (value: unknown) => typeof value === 'string' && UUID_PATTERN.test(value) ? value : '';

async function submitSampleOrder(_previous: SampleOrderFormState, formData: FormData): Promise<SampleOrderFormState> {
  'use server';
  const current = await requireAdminSectionEdit('prospecting');
  if (!isProspectingWorkspaceEnabled()) return { code: 'setup_required', error: 'The prospecting workspace changed while this form was open. Reload before submitting.' };
  const input = prospectingSampleOrderInputFromFormData(formData);
  const queue = prospectingQueueContextFromParams(formData);
  try {
    const result = await createProspectingSampleOrder({ currentProfileId: current.profile.id, input, isOwner: current.isOwner, supabase: getSupabaseAdmin() });
    if (result.error || !result.orderId) return { code: result.error ?? 'save_error', error: result.message ?? ({ invalid_items: 'Choose at least one sample box with a whole-number quantity.', invalid_product: 'A selected sample box is unavailable.', lead_error: 'That linked lead is unavailable.' }[result.error as string] || 'The sample order could not be created. Your draft has been kept.') };
    return { orderId: result.orderId, successHref: prospectingOriginPath(queue) };
  } catch {
    return { code: 'connection_error', error: 'The response was interrupted. Retry this same submission to check whether the order was created.' };
  }
}

export default async function ProspectingSampleOrderPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  if (!isProspectingWorkspaceEnabled()) return LegacySampleOrderPage({ searchParams });
  const params = await searchParams;
  const current = await requireAdminSectionView('prospecting');
  const canEdit = current.isOwner || adminCanEdit(current.access, 'prospecting');
  const queue = prospectingQueueContextFromParams(params);
  const requestedLead = typeof params?.lead === 'string' ? params.lead : '';
  const requestedRequest = typeof params?.request === 'string' ? params.request : '';
  const leadId = cleanId(requestedLead);
  const requestId = cleanId(requestedRequest);
  if (requestId && current.isOwner) {
    if (!queue.origin) queue.origin = 'samples';
    if (!queue.returnTo) queue.returnTo = '/admin/sales/prospecting/admin?tab=requests';
  }
  const backHref = prospectingOriginPath(queue);
  const supabase = await createClient();
  let query = leadId ? supabase.from('prospecting_leads').select('id,company_name,assigned_profile_id,stage,updated_at,address_line_1,address_line_2,city,state,postal_code,archived_at').eq('id', leadId).is('archived_at', null) : null;
  if (query && !current.isOwner) query = query.eq('assigned_profile_id', current.profile.id).neq('stage', 'sample_requested');
  const [leadResult, productsResult, requestResult] = await Promise.all([
    query ? query.maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from('products').select('id,name,sku,product_recipes(id)').eq('active', true).eq('category', 'sample_boxes').order('name'),
    requestId && current.isOwner ? getSupabaseAdmin().from('prospecting_sample_requests').select('*').eq('id', requestId).eq('lead_id', leadId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const lead = leadResult.data;
  const request = requestResult.data;
  const invalidLinked = Boolean(requestedLead && (!leadId || !lead || leadResult.error));
  const invalidRequest = Boolean(requestedRequest && (!requestId || !current.isOwner || !request || requestResult.error || request.closed_at || request.status === 'order_created'));
  if (invalidLinked || invalidRequest) return <div className="space-y-5"><h1 className="page-title">Sample request unavailable</h1><div className="card space-y-3" role="alert"><p>{request?.order_id ? 'This request already has an order.' : 'This linked lead or request could not be loaded. Reload the request or return to your queue.'}</p><div className="flex gap-3"><Link className="btn-secondary" href={backHref}>Back to prospecting</Link>{request?.order_id ? <Link className="btn-primary" href={`/admin/orders/${request.order_id}`}>View order</Link> : null}</div></div></div>;
  if (lead && !request && lead.stage !== 'sample_requested') {
    const href = prospectingLeadPath(lead.id, queue, { includePageSize: true });
    redirect(`${href}${href.includes('?') ? '&' : '?'}sample=1`);
  }
  const contactsResult = lead ? await supabase.from('prospecting_contacts').select('id,full_name,email,is_primary').eq('lead_id', lead.id).order('is_primary', { ascending: false }).order('created_at') : { data: [], error: null };
  if (contactsResult.error) return <div className="card space-y-3" role="alert"><h1 className="text-xl font-semibold">Contacts unavailable</h1><p>The sample contact could not be loaded. Reload before ordering.</p><Link className="btn-secondary" href={backHref}>Back to prospecting</Link></div>;
  const contacts = (contactsResult.data ?? []).map(contact => ({ ...contact, eligible: hasSampleRequestContact([contact]) }));
  const contact = contacts.find(item => item.id === request?.contact_id && item.eligible) ?? contacts.find(item => item.eligible);
  const details = request?.details && typeof request.details === 'object' && !Array.isArray(request.details) ? request.details : {};
  const detail = (name: string, fallback = '') => typeof details[name] === 'string' ? String(details[name]) : fallback;
  const values: SampleOrderFields = {
    center_name: detail('centerName', lead?.company_name ?? ''), attention_name: detail('attentionName', contact?.full_name ?? ''),
    address1: detail('address1', lead?.address_line_1 ?? ''), address2: detail('address2', lead?.address_line_2 ?? ''),
    city: detail('city', lead?.city ?? ''), state: detail('state', lead?.state ?? ''), zip: detail('zip', lead?.postal_code ?? ''),
    notes: detail('notes'), contact_id: contact?.id ?? '',
  };
  const products = (productsResult.data ?? []).filter(product => Array.isArray(product.product_recipes) ? product.product_recipes.length > 0 : Boolean(product.product_recipes)).map(product => ({ id: product.id, label: product.sku ? `${product.name || 'Sample box'} (${product.sku})` : product.name || 'Sample box' }));
  const initialQuantities: Record<string, number> = {};
  if (Array.isArray(details.items)) for (const item of details.items) {
    if (item && typeof item === 'object' && !Array.isArray(item) && typeof item.productId === 'string') initialQuantities[item.productId] = Number(item.quantity) || 0;
  }
  return <div className="mx-auto max-w-4xl space-y-6">
    <section className="panel"><Link className="text-sm font-semibold text-teal-800 underline" href={backHref}>{request ? 'Back to sample requests' : 'Back to prospecting'}</Link><h1 className="page-title mt-4">{request ? 'Fulfill sample request' : 'Create sample order'}</h1><p className="page-subtitle mt-2">{lead ? `Samples for ${lead.company_name}. Review the contact, delivery address, and boxes before sending to production.` : 'Create a standalone sample shipment. Choose the quantities to include.'}</p>{request?.status === 'legacy_review' ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This older request needs review before another shipment is created.{request.order_id ? <> <Link className="font-semibold underline" href={`/admin/orders/${request.order_id}`}>Review its existing order</Link>.</> : null}</p> : null}</section>
    {productsResult.error ? <div className="rounded-lg bg-rose-50 p-4 text-rose-900" role="alert">Sample boxes could not be loaded. Reload before submitting.</div> : null}
    <ProspectingSampleOrderForm key={`${current.profile.id}:${lead?.id ?? "standalone"}:${request?.id ?? "none"}`} action={submitSampleOrder} initialValues={values} submissionId={randomUUID()} initialQuantities={initialQuantities} actorId={current.profile.id} contacts={contacts} products={products} canEdit={canEdit} productsUnavailable={Boolean(productsResult.error)} linked={Boolean(lead)} editLeadHref={lead ? prospectingLeadPath(lead.id, queue, { includePageSize: true }) : undefined} backHref={backHref} hiddenFields={[
      { name: 'lead_id', value: lead?.id ?? '' }, { name: 'request_id', value: request?.id ?? '' },
      { name: 'expected_updated_at', value: lead?.updated_at ?? '' }, ...prospectingQueueHiddenFields(queue),
    ]} />
  </div>;
}
