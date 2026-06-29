import Link from 'next/link';
import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import { getSalesScopedCenterIdsForAdmin, scopeCentersForAdmin } from '@/lib/admin-center-scope';
import { adminCanEdit, requireAdminSectionEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import {
  formatInventoryQuantity,
  normalizeInventoryNumber,
  type InventoryUnit,
} from '@/lib/inventory';
import { recordSampleBoxRun, type SampleBoxAddOn } from '@/lib/sample-boxes';
import { createClient } from '@/lib/supabase/server';
import { toCents, usd } from '@/lib/utils';

const ADD_ON_ROWS = 4;
const INVENTORY_UNITS: InventoryUnit[] = ['lb', 'oz', 'each', 'case'];

type Related<T> = T | T[] | null | undefined;

type CenterRow = {
  id: string;
  name: string | null;
  is_active: boolean | null;
};

type ProfileRow = {
  email: string | null;
  full_name: string | null;
  id: string;
  is_active: boolean | null;
};

type InventoryItemRow = {
  active: boolean | null;
  base_unit: InventoryUnit;
  id: string;
  item_type: string;
  name: string | null;
  product_id: string | null;
  sku: string | null;
};

type ProductRow = {
  active: boolean | null;
  id: string;
  name: string | null;
  sku: string | null;
};

type TemplateItemRow = {
  id: string;
  inventory_item_id: string | null;
  inventory_items?: Related<InventoryItemRow>;
  item_kind: 'inventory_item' | 'product';
  label: string | null;
  product_id: string | null;
  products?: Related<ProductRow>;
  quantity: number | string;
  sort_order: number | null;
  unit: InventoryUnit;
};

type TemplateRow = {
  active: boolean | null;
  fixed_misc_cents: number | string | null;
  fixed_shipping_cents: number | string | null;
  id: string;
  key: string | null;
  name: string;
  notes: string | null;
  sample_box_template_items?: TemplateItemRow[] | null;
};

type RunItemRow = {
  cogs_estimated: boolean | null;
  id: string;
  inventory_items?: Related<{ name: string | null; sku: string | null }>;
  item_kind: 'inventory_item' | 'product';
  label: string | null;
  product_id: string | null;
  products?: Related<{ name: string | null; sku: string | null }>;
  quantity: number | string;
  total_cost_cents: number | string | null;
  unit: InventoryUnit;
  unit_cost_cents: number | string | null;
};

type RunRow = {
  center_id: string | null;
  centers?: Related<{ name: string | null }>;
  cogs_estimated: boolean | null;
  created_at: string | null;
  fixed_misc_cents: number | string | null;
  fixed_shipping_cents: number | string | null;
  id: string;
  inventory_cogs_cents: number | string | null;
  notes: string | null;
  product_cogs_cents: number | string | null;
  prospect_name: string | null;
  quantity_boxes: number | string;
  sales_profile?: Related<ProfileRow>;
  sales_profile_id: string | null;
  sample_box_run_items?: RunItemRow[] | null;
  sent_at: string | null;
  total_cogs_cents: number | string | null;
};

function relatedOne<T>(value: Related<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function sampleBoxesHref(toast?: string, templateId?: string) {
  const params = new URLSearchParams();
  if (toast) params.set('toast', toast);
  if (templateId) params.set('template', templateId);
  const query = params.toString();
  return `/admin/sales/prospecting/sample-boxes${query ? `?${query}` : ''}`;
}

function adminLabel(admin: ProfileRow | null | undefined) {
  return admin?.full_name || admin?.email || 'Unknown admin';
}

function itemLabel(item: InventoryItemRow | null | undefined) {
  if (!item) return 'Missing inventory item';
  return item.sku ? `${item.name || 'Inventory item'} (${item.sku})` : item.name || 'Inventory item';
}

function productLabel(product: ProductRow | null | undefined) {
  if (!product) return 'Missing product';
  return product.sku ? `${product.name || 'Product'} (${product.sku})` : product.name || 'Product';
}

function runItemName(item: RunItemRow) {
  if (item.label) return item.label;
  if (item.item_kind === 'product') return productLabel(relatedOne(item.products) as ProductRow | null);
  return itemLabel(relatedOne(item.inventory_items) as InventoryItemRow | null);
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parsePositiveNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSortOrder(value: FormDataEntryValue | null) {
  const parsed = Number.parseInt(String(value ?? '0'), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseUnit(value: FormDataEntryValue | null): InventoryUnit {
  const raw = String(value ?? 'each');
  return INVENTORY_UNITS.includes(raw as InventoryUnit) ? raw as InventoryUnit : 'each';
}

function parseMoneyCents(value: FormDataEntryValue | null) {
  return toCents(String(value ?? '0'));
}

function dollarsInput(value: unknown) {
  const cents = normalizeInventoryNumber(value);
  return cents ? String(Number((cents / 100).toFixed(2))) : '0';
}

function toastMessage(toast: string) {
  const messages: Record<string, { tone: string; text: string }> = {
    add_item_error: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'Unable to add that template item.' },
    admin_write_denied: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'You do not have permission to change sample boxes.' },
    delete_item_error: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'Unable to remove that template item.' },
    invalid_money: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'Enter valid fixed cost amounts.' },
    invalid_quantity: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'Enter valid quantities greater than zero.' },
    item_added: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'Template item added.' },
    item_deleted: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'Template item removed.' },
    item_updated: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'Template item updated.' },
    record_config_error: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'The sample box template needs valid items before it can be recorded.' },
    record_inventory_error: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'Unable to consume inventory for that sample box.' },
    record_saved: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'Sample box recorded and COGS snapshotted.' },
    record_stock_error: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'There is not enough raw coffee or material stock for that sample box.' },
    schema_error: { tone: 'border-amber-200 bg-amber-50 text-amber-800', text: 'Apply migration 034_sample_box_cogs.sql to enable sample boxes.' },
    template_saved: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'Sample box template saved.' },
    template_save_error: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'Unable to save the sample box template.' },
  };
  return messages[toast];
}

async function requireTemplateOwner(templateId?: string) {
  const current = await requireAdminSectionEdit('prospecting', sampleBoxesHref('admin_write_denied', templateId));
  if (!current.isOwner) redirect(sampleBoxesHref('admin_write_denied', templateId));
  return current;
}

async function updateTemplateSettings(formData: FormData) {
  'use server';

  const templateId = String(formData.get('template_id') ?? '').trim();
  const current = await requireTemplateOwner(templateId);
  const supabase = await createClient();

  let fixedShippingCents = 0;
  let fixedMiscCents = 0;
  try {
    fixedShippingCents = parseMoneyCents(formData.get('fixed_shipping_dollars'));
    fixedMiscCents = parseMoneyCents(formData.get('fixed_misc_dollars'));
  } catch {
    redirect(sampleBoxesHref('invalid_money', templateId));
  }

  const { error } = await supabase
    .from('sample_box_templates')
    .update({
      fixed_misc_cents: fixedMiscCents,
      fixed_shipping_cents: fixedShippingCents,
      name: String(formData.get('name') ?? '').trim() || 'Sample Box',
      notes: String(formData.get('notes') ?? '').trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
    })
    .eq('id', templateId);

  redirect(sampleBoxesHref(error ? 'template_save_error' : 'template_saved', templateId));
}

async function addTemplateItem(formData: FormData) {
  'use server';

  const templateId = String(formData.get('template_id') ?? '').trim();
  await requireTemplateOwner(templateId);
  const supabase = await createClient();
  const itemKind = String(formData.get('item_kind') ?? '') === 'product' ? 'product' : 'inventory_item';
  const quantity = parsePositiveNumber(formData.get('quantity'));
  if (quantity <= 0) redirect(sampleBoxesHref('invalid_quantity', templateId));

  const payload = {
    item_kind: itemKind,
    label: String(formData.get('label') ?? '').trim() || null,
    quantity,
    sort_order: parseSortOrder(formData.get('sort_order')),
    template_id: templateId,
    unit: parseUnit(formData.get('unit')),
    ...(itemKind === 'product'
      ? { inventory_item_id: null, product_id: String(formData.get('product_id') ?? '').trim() || null }
      : { inventory_item_id: String(formData.get('inventory_item_id') ?? '').trim() || null, product_id: null }),
  };

  if ((itemKind === 'product' && !payload.product_id) || (itemKind === 'inventory_item' && !payload.inventory_item_id)) {
    redirect(sampleBoxesHref('add_item_error', templateId));
  }

  const { error } = await supabase.from('sample_box_template_items').insert(payload);
  redirect(sampleBoxesHref(error ? 'add_item_error' : 'item_added', templateId));
}

async function updateTemplateItem(formData: FormData) {
  'use server';

  const templateId = String(formData.get('template_id') ?? '').trim();
  const itemId = String(formData.get('item_id') ?? '').trim();
  await requireTemplateOwner(templateId);
  const supabase = await createClient();
  const quantity = parsePositiveNumber(formData.get('quantity'));
  if (!itemId || quantity <= 0) redirect(sampleBoxesHref('invalid_quantity', templateId));

  const { error } = await supabase
    .from('sample_box_template_items')
    .update({
      label: String(formData.get('label') ?? '').trim() || null,
      quantity,
      sort_order: parseSortOrder(formData.get('sort_order')),
      unit: parseUnit(formData.get('unit')),
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('template_id', templateId);

  redirect(sampleBoxesHref(error ? 'template_save_error' : 'item_updated', templateId));
}

async function deleteTemplateItem(formData: FormData) {
  'use server';

  const templateId = String(formData.get('template_id') ?? '').trim();
  const itemId = String(formData.get('item_id') ?? '').trim();
  await requireTemplateOwner(templateId);
  const supabase = await createClient();
  const { error } = await supabase
    .from('sample_box_template_items')
    .delete()
    .eq('id', itemId)
    .eq('template_id', templateId);

  redirect(sampleBoxesHref(error ? 'delete_item_error' : 'item_deleted', templateId));
}

async function recordSampleBox(formData: FormData) {
  'use server';

  const current = await requireAdminSectionEdit('prospecting', sampleBoxesHref('admin_write_denied'));
  const supabase = await createClient();
  const templateId = String(formData.get('template_id') ?? '').trim();
  const quantityBoxes = parsePositiveNumber(formData.get('quantity_boxes'), 1);
  if (quantityBoxes <= 0) redirect(sampleBoxesHref('invalid_quantity', templateId));

  const centerId = String(formData.get('center_id') ?? '').trim() || null;
  if (!current.isOwner && centerId) {
    const centerScope = await getSalesScopedCenterIdsForAdmin({ current, supabase });
    if (centerScope !== null && !centerScope.includes(centerId)) {
      redirect(sampleBoxesHref('admin_write_denied', templateId));
    }
  }

  const selectedSalesProfileId = String(formData.get('sales_profile_id') ?? '').trim();
  const salesProfileId = current.isOwner && selectedSalesProfileId ? selectedSalesProfileId : current.profile.id;
  const addOns: SampleBoxAddOn[] = [];
  for (let index = 0; index < ADD_ON_ROWS; index += 1) {
    const productId = String(formData.get(`add_on_product_id_${index}`) ?? '').trim();
    const quantity = parsePositiveNumber(formData.get(`add_on_quantity_${index}`));
    if (productId && quantity > 0) addOns.push({ productId, quantity });
  }

  const sentAtDate = String(formData.get('sent_at') ?? '').trim();
  const sentAt = /^\d{4}-\d{2}-\d{2}$/.test(sentAtDate) ? `${sentAtDate}T12:00:00` : null;
  const result = await recordSampleBoxRun({
    addOns,
    centerId,
    createdBy: current.profile.id,
    notes: String(formData.get('notes') ?? '').trim() || null,
    prospectName: String(formData.get('prospect_name') ?? '').trim() || null,
    quantityBoxes,
    salesProfileId,
    sentAt,
    supabase,
    templateId,
  });

  const toast =
    result.error === null
      ? 'record_saved'
      : result.error === 'insufficient_inventory'
        ? 'record_stock_error'
        : result.error === 'schema_error'
          ? 'schema_error'
          : result.error === 'inventory_error'
            ? 'record_inventory_error'
            : 'record_config_error';

  redirect(sampleBoxesHref(toast, templateId));
}

function StatTile({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="stat-card">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

function SectionHeading({ eyebrow, subtitle, title }: { eyebrow: string; subtitle: string; title: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">{subtitle}</p>
    </div>
  );
}

function DateInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default async function SampleBoxesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const current = await requireAdminSectionView('prospecting');
  const canEdit = current.isOwner || adminCanEdit(current.access, 'prospecting');
  const supabase = await createClient();
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const requestedTemplateId = typeof searchParams?.template === 'string' ? searchParams.template : '';
  const centerScope = await getSalesScopedCenterIdsForAdmin({ current, supabase });

  const [
    templatesResult,
    inventoryItemsResult,
    productsResult,
    centersResult,
    salesRepSettingsResult,
  ] = await Promise.all([
    supabase
      .from('sample_box_templates')
      .select('id,key,name,fixed_shipping_cents,fixed_misc_cents,active,notes,sample_box_template_items(id,item_kind,inventory_item_id,product_id,quantity,unit,label,sort_order,inventory_items(id,name,sku,item_type,base_unit,product_id,active),products(id,name,sku,active))')
      .order('created_at', { ascending: true }),
    supabase.from('inventory_items').select('id,name,sku,item_type,base_unit,product_id,active').eq('active', true).order('name', { ascending: true }),
    supabase.from('products').select('id,name,sku,active').eq('active', true).order('name', { ascending: true }),
    scopeCentersForAdmin(
      supabase.from('centers').select('id,name,is_active').order('name', { ascending: true }),
      centerScope
    ),
    current.isOwner
      ? supabase.from('admin_commission_settings').select('profile_id').eq('is_sales_rep', true)
      : { data: [], error: null },
  ]);

  if (templatesResult.error) {
    return (
      <div className="space-y-6">
        <section className="panel">
          <span className="eyebrow">Sample Boxes</span>
          <h1 className="page-title mt-4">Sample box COGS</h1>
          <p className="page-subtitle mt-3">Apply migration `034_sample_box_cogs.sql` to enable this screen.</p>
        </section>
        <section className="card rounded-2xl border-amber-200 bg-amber-50 text-sm font-semibold text-amber-800">
          The sample box schema is not available yet.
        </section>
      </div>
    );
  }

  const templates = (templatesResult.data ?? []) as TemplateRow[];
  const activeTemplate = templates.find((template) => template.id === requestedTemplateId) ?? templates[0] ?? null;
  const templateItems = [...(activeTemplate?.sample_box_template_items ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const inventoryItems = (inventoryItemsResult.data ?? []) as InventoryItemRow[];
  const products = (productsResult.data ?? []) as ProductRow[];
  const centers = ((centersResult.data ?? []) as CenterRow[]).filter((center) => center.is_active !== false);
  const salesRepIds = current.isOwner
    ? [...new Set([current.profile.id, ...((salesRepSettingsResult.data ?? []) as Array<{ profile_id: string | null }>).map((row) => row.profile_id).filter(Boolean)])] as string[]
    : [];
  const salesRepsResult = current.isOwner && salesRepIds.length
    ? await supabase.from('profiles').select('id,email,full_name,is_active').in('id', salesRepIds).eq('is_admin', true)
    : { data: [], error: null };
  const salesReps = ((salesRepsResult.data ?? []) as ProfileRow[]).sort((a, b) => adminLabel(a).localeCompare(adminLabel(b)));

  let runsQuery = supabase
    .from('sample_box_runs')
    .select('id,template_id,center_id,prospect_name,sales_profile_id,quantity_boxes,fixed_shipping_cents,fixed_misc_cents,inventory_cogs_cents,product_cogs_cents,total_cogs_cents,cogs_estimated,sent_at,notes,created_at,centers(name),sales_profile:profiles!sample_box_runs_sales_profile_id_fkey(id,email,full_name,is_active),sample_box_run_items(id,item_kind,inventory_item_id,product_id,label,quantity,unit,unit_cost_cents,total_cost_cents,cogs_estimated,inventory_items(name,sku),products(name,sku))')
    .order('sent_at', { ascending: false })
    .limit(50);
  if (!current.isOwner) runsQuery = runsQuery.eq('sales_profile_id', current.profile.id);
  const runsResult = await runsQuery;
  const recentRuns = runsResult.error ? [] : ((runsResult.data ?? []) as RunRow[]);
  const totalBoxes = recentRuns.reduce((sum, run) => sum + normalizeInventoryNumber(run.quantity_boxes), 0);
  const totalCogs = recentRuns.reduce((sum, run) => sum + normalizeInventoryNumber(run.total_cogs_cents), 0);
  const inventoryCogs = recentRuns.reduce((sum, run) => sum + normalizeInventoryNumber(run.inventory_cogs_cents), 0);
  const productCogs = recentRuns.reduce((sum, run) => sum + normalizeInventoryNumber(run.product_cogs_cents), 0);
  const fixedCogs = recentRuns.reduce((sum, run) => sum + normalizeInventoryNumber(run.fixed_shipping_cents) + normalizeInventoryNumber(run.fixed_misc_cents), 0);
  const message = toastMessage(toast);

  return (
    <div className="space-y-6">
      {message ? <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${message.tone}`}>{message.text}</div> : null}

      <section className="panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="eyebrow">Prospecting Samples</span>
            <h1 className="page-title mt-4">Sample box COGS</h1>
            <p className="page-subtitle mt-3">
              Record sample boxes as prospecting expense, consume the coffee, box, and included products, and keep the COGS snapshot separate from order margin.
            </p>
          </div>
          <Link className="btn-secondary w-full sm:w-auto" href="/admin/sales/prospecting">Back to Prospecting</Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Recent Sample COGS" value={usd(Math.round(totalCogs))} detail={`${formatInventoryQuantity(totalBoxes, 'each')} sample box${totalBoxes === 1 ? '' : 'es'} in recent history.`} />
        <StatTile label="Coffee & Materials" value={usd(Math.round(inventoryCogs))} detail="Raw coffee and material inventory consumed FIFO." />
        <StatTile label="Finished Products" value={usd(Math.round(productCogs))} detail="Included products and one-off product add-ons." />
        <StatTile label="Fixed Costs" value={usd(Math.round(fixedCogs))} detail="Sample shipping and miscellaneous costs." />
      </section>

      {!activeTemplate ? (
        <section className="card text-sm text-slate-600">
          No sample box template exists yet. Apply migration `034_sample_box_cogs.sql`.
        </section>
      ) : null}

      {activeTemplate ? (
        <section className="card space-y-5">
          <SectionHeading
            eyebrow="Record"
            title="Send a sample box"
            subtitle="This consumes inventory and snapshots the sample COGS at the time it is recorded."
          />
          <form action={recordSampleBox} className="space-y-4">
            <input type="hidden" name="template_id" value={activeTemplate.id} />
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">
                Sent date
                <input className="input mt-2" name="sent_at" type="date" defaultValue={DateInputValue()} required disabled={!canEdit} />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Quantity of sample boxes
                <input className="input mt-2" name="quantity_boxes" type="number" min="1" step="1" defaultValue="1" required disabled={!canEdit} />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Center
                <select className="input mt-2" name="center_id" defaultValue="" disabled={!canEdit}>
                  <option value="">No center selected</option>
                  {centers.map((center) => (
                    <option key={center.id} value={center.id}>{center.name || 'Unnamed center'}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Prospect name
                <input className="input mt-2" name="prospect_name" placeholder="Optional prospect or contact" disabled={!canEdit} />
              </label>
              {current.isOwner ? (
                <label className="text-sm font-semibold text-slate-700">
                  Sales rep
                  <select className="input mt-2" name="sales_profile_id" defaultValue={current.profile.id} disabled={!canEdit}>
                    {salesReps.map((rep) => (
                      <option key={rep.id} value={rep.id}>{adminLabel(rep)}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="text-sm font-semibold text-slate-700">
                Notes
                <input className="input mt-2" name="notes" placeholder="Optional notes" disabled={!canEdit} />
              </label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
              <p className="text-sm font-semibold text-slate-950">{activeTemplate.name}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {templateItems.map((item) => {
                  const inventoryItem = relatedOne(item.inventory_items);
                  const product = relatedOne(item.products);
                  return (
                    <div key={item.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                      <p className="font-semibold text-slate-800">{item.label || (item.item_kind === 'product' ? productLabel(product) : itemLabel(inventoryItem))}</p>
                      <p className="mt-1 text-slate-500">{formatInventoryQuantity(item.quantity, item.unit)}</p>
                    </div>
                  );
                })}
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <p className="font-semibold text-slate-800">Fixed shipping</p>
                  <p className="mt-1 text-slate-500">{usd(Math.round(normalizeInventoryNumber(activeTemplate.fixed_shipping_cents)))}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <p className="font-semibold text-slate-800">Miscellaneous</p>
                  <p className="mt-1 text-slate-500">{usd(Math.round(normalizeInventoryNumber(activeTemplate.fixed_misc_cents)))}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">Special occasion add-ons</p>
                <p className="mt-1 text-sm text-slate-500">Choose finished products only when you add extras such as K-cups.</p>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {Array.from({ length: ADD_ON_ROWS }, (_, index) => (
                  <div key={index} className="grid gap-2 rounded-2xl border border-slate-200 bg-white/60 p-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                    <label className="text-sm font-semibold text-slate-700">
                      Product
                      <select className="input mt-2" name={`add_on_product_id_${index}`} defaultValue="" disabled={!canEdit}>
                        <option value="">No add-on</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>{productLabel(product)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Qty each
                      <input className="input mt-2" name={`add_on_quantity_${index}`} type="number" min="0" step="1" defaultValue="0" disabled={!canEdit} />
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <PendingSubmitButton
              className="btn-primary w-full sm:w-auto"
              data-press-lock-key="record-sample-box"
              disabled={!canEdit}
              label="Record sample box"
              pendingLabel="Recording..."
            />
            {!canEdit ? <p className="text-sm font-semibold text-slate-500">You have read-only access to Prospecting.</p> : null}
          </form>
        </section>
      ) : null}

      {activeTemplate && current.isOwner ? (
        <section className="card space-y-5">
          <SectionHeading
            eyebrow="Template"
            title="Default sample box setup"
            subtitle="Superadmins can edit the fixed costs and the default inventory/product lines used whenever a sample box is recorded."
          />
          <form action={updateTemplateSettings} className="grid gap-3 lg:grid-cols-2">
            <input type="hidden" name="template_id" value={activeTemplate.id} />
            <label className="text-sm font-semibold text-slate-700">
              Template name
              <input className="input mt-2" name="name" defaultValue={activeTemplate.name} required />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Fixed shipping
              <input className="input mt-2" name="fixed_shipping_dollars" type="number" min="0" step="0.01" defaultValue={dollarsInput(activeTemplate.fixed_shipping_cents)} required />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Miscellaneous
              <input className="input mt-2" name="fixed_misc_dollars" type="number" min="0" step="0.01" defaultValue={dollarsInput(activeTemplate.fixed_misc_cents)} required />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Notes
              <input className="input mt-2" name="notes" defaultValue={activeTemplate.notes ?? ''} />
            </label>
            <div className="lg:col-span-2">
              <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save template costs" pendingLabel="Saving..." />
            </div>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] border-separate border-spacing-y-2 text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-4 py-2">Line</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2 text-right">Quantity</th>
                  <th className="px-4 py-2">Unit</th>
                  <th className="px-4 py-2 text-right">Sort</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {templateItems.map((item) => {
                  const inventoryItem = relatedOne(item.inventory_items);
                  const product = relatedOne(item.products);
                  return (
                    <tr key={item.id} className="bg-white/65">
                      <td className="rounded-l-xl px-4 py-3">
                        <form id={`update-template-item-${item.id}`} action={updateTemplateItem} className="grid gap-2">
                          <input type="hidden" name="template_id" value={activeTemplate.id} />
                          <input type="hidden" name="item_id" value={item.id} />
                          <p className="font-semibold text-slate-950">{item.item_kind === 'product' ? productLabel(product) : itemLabel(inventoryItem)}</p>
                          <input className="input" name="label" defaultValue={item.label ?? ''} placeholder="Display label" />
                        </form>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{item.item_kind === 'product' ? 'Finished product' : 'Inventory item'}</td>
                      <td className="px-4 py-3 text-right">
                        <input form={`update-template-item-${item.id}`} className="input ml-auto w-28" name="quantity" type="number" min="0.0001" step="0.0001" defaultValue={normalizeInventoryNumber(item.quantity)} />
                      </td>
                      <td className="px-4 py-3">
                        <select form={`update-template-item-${item.id}`} className="input w-28" name="unit" defaultValue={item.unit}>
                          {INVENTORY_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input form={`update-template-item-${item.id}`} className="input ml-auto w-24" name="sort_order" type="number" step="1" defaultValue={item.sort_order ?? 0} />
                      </td>
                      <td className="rounded-r-xl px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button form={`update-template-item-${item.id}`} className="btn-secondary" data-press-lock-key={`update-template-item-${item.id}`} type="submit">Update</button>
                          <form action={deleteTemplateItem}>
                            <input type="hidden" name="template_id" value={activeTemplate.id} />
                            <input type="hidden" name="item_id" value={item.id} />
                            <PendingSubmitButton
                              className="rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                              label="Remove"
                              pendingLabel="Removing..."
                            />
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <form action={addTemplateItem} className="rounded-2xl border border-slate-200 bg-white/60 p-4">
            <input type="hidden" name="template_id" value={activeTemplate.id} />
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">
                Item type
                <select className="input mt-2" name="item_kind" defaultValue="inventory_item">
                  <option value="inventory_item">Inventory item</option>
                  <option value="product">Finished product</option>
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Label
                <input className="input mt-2" name="label" placeholder="Optional display label" />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Inventory item
                <select className="input mt-2" name="inventory_item_id" defaultValue="">
                  <option value="">Choose inventory item</option>
                  {inventoryItems.map((item) => (
                    <option key={item.id} value={item.id}>{itemLabel(item)}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Finished product
                <select className="input mt-2" name="product_id" defaultValue="">
                  <option value="">Choose product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{productLabel(product)}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Quantity
                <input className="input mt-2" name="quantity" type="number" min="0.0001" step="0.0001" required />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Unit
                <select className="input mt-2" name="unit" defaultValue="each">
                  {INVENTORY_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Sort order
                <input className="input mt-2" name="sort_order" type="number" step="1" defaultValue="100" />
              </label>
            </div>
            <PendingSubmitButton className="btn-primary mt-4 w-full sm:w-auto" label="Add template item" pendingLabel="Adding..." />
          </form>
        </section>
      ) : null}

      <section className="card space-y-5">
        <SectionHeading
          eyebrow="History"
          title="Recent sample boxes"
          subtitle="These COGS snapshots stay fixed even when inventory costs change later."
        />
        <div className="space-y-3">
          {recentRuns.map((run) => {
            const center = relatedOne(run.centers);
            const salesProfile = relatedOne(run.sales_profile);
            return (
              <details key={run.id} className="rounded-2xl border border-slate-200 bg-white/65 p-4">
                <summary className="cursor-pointer">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div>
                      <p className="font-semibold text-slate-950">{center?.name || run.prospect_name || 'Sample box'}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {formatDate(run.sent_at)} - {formatInventoryQuantity(run.quantity_boxes, 'each')} box{normalizeInventoryNumber(run.quantity_boxes) === 1 ? '' : 'es'} - {adminLabel(salesProfile)}
                      </p>
                    </div>
                    <div className="text-left lg:text-right">
                      <p className="font-semibold text-slate-950">{usd(Math.round(normalizeInventoryNumber(run.total_cogs_cents)))}</p>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{run.cogs_estimated ? 'Estimated COGS' : 'Actual FIFO COGS'}</p>
                    </div>
                  </div>
                </summary>
                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_18rem]">
                  <div className="space-y-2">
                    {(run.sample_box_run_items ?? []).map((item) => (
                      <div key={item.id} className="grid gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
                        <div>
                          <p className="font-semibold text-slate-800">{runItemName(item)}</p>
                          <p className="mt-1 text-slate-500">{formatInventoryQuantity(item.quantity, item.unit)} at {usd(Math.round(normalizeInventoryNumber(item.unit_cost_cents)))} / {item.unit}</p>
                        </div>
                        <p className="font-semibold text-slate-950">{usd(Math.round(normalizeInventoryNumber(item.total_cost_cents)))}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 text-sm">
                    <p className="font-semibold text-slate-950">COGS split</p>
                    <div className="mt-3 space-y-2 text-slate-600">
                      <p>Inventory: {usd(Math.round(normalizeInventoryNumber(run.inventory_cogs_cents)))}</p>
                      <p>Products: {usd(Math.round(normalizeInventoryNumber(run.product_cogs_cents)))}</p>
                      <p>Shipping: {usd(Math.round(normalizeInventoryNumber(run.fixed_shipping_cents)))}</p>
                      <p>Misc: {usd(Math.round(normalizeInventoryNumber(run.fixed_misc_cents)))}</p>
                    </div>
                    {run.notes ? <p className="mt-3 border-t border-slate-200 pt-3 text-slate-500">{run.notes}</p> : null}
                  </div>
                </div>
              </details>
            );
          })}
          {!recentRuns.length ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 px-4 py-8 text-center text-sm text-slate-500">
              No sample boxes have been recorded yet.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
