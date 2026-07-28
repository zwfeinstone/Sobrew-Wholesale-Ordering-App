type SupabaseLike = {
  from: (table: string) => any;
};

type Related<T> = T | T[] | null | undefined;

type ProductRow = {
  active: boolean | null;
  category: string | null;
  id: string;
  name: string | null;
  product_recipes?: Related<{ id: string | null }>;
  sku: string | null;
};

type ProspectingLeadRow = {
  assigned_profile_id: string | null;
  company_name: string | null;
  id: string;
  stage: string | null;
};

export type ProspectingSampleOrderItemInput = {
  productId: string;
  quantity: number | string;
};

export type ProspectingSampleOrderInput = {
  address1: string;
  address2?: string | null;
  attentionName: string;
  centerName: string;
  city: string;
  items: ProspectingSampleOrderItemInput[];
  leadId?: string | null;
  notes?: string | null;
  state: string;
  zip: string;
};

export type ProspectingSampleOrderError =
  | 'insert_error'
  | 'invalid_items'
  | 'invalid_product'
  | 'lead_error'
  | 'missing_fields'
  | 'unauthorized'
  | null;

export type ProspectingSampleOrderResult = {
  error: ProspectingSampleOrderError;
  orderId?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ORDER_NOTES_LENGTH = 5000;

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function cleanOptionalText(value: unknown) {
  return cleanText(value) || null;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function relatedList<T>(value: Related<T>): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function hasRecipe(product: ProductRow) {
  return relatedList(product.product_recipes).some((recipe) => Boolean(recipe?.id));
}

function normalizeItems(items: ProspectingSampleOrderItemInput[]) {
  const quantityByProductId = new Map<string, number>();
  for (const item of items) {
    const productId = cleanText(item.productId);
    const quantity = positiveInteger(item.quantity);
    if (quantity <= 0) continue;
    if (!UUID_PATTERN.test(productId)) return null;
    quantityByProductId.set(productId, (quantityByProductId.get(productId) ?? 0) + quantity);
  }
  return [...quantityByProductId.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

export function prospectingSampleOrderInputFromFormData(formData: FormData): ProspectingSampleOrderInput {
  const productIds = formData.getAll('product_id').map(String);
  const quantities = formData.getAll('quantity');
  return {
    address1: cleanText(formData.get('address1')),
    address2: cleanOptionalText(formData.get('address2')),
    attentionName: cleanText(formData.get('attention_name')),
    centerName: cleanText(formData.get('center_name')),
    city: cleanText(formData.get('city')),
    items: productIds.map((productId, index) => ({
      productId,
      quantity: Number(quantities[index] ?? 0),
    })),
    leadId: cleanOptionalText(formData.get('lead_id')),
    notes: cleanOptionalText(formData.get('notes')),
    state: cleanText(formData.get('state')).toUpperCase(),
    zip: cleanText(formData.get('zip')),
  };
}

async function cleanupOrder(supabase: SupabaseLike, orderId: string) {
  await supabase.from('orders').delete().eq('id', orderId);
}

export async function createProspectingSampleOrder({
  currentProfileId,
  input,
  isOwner,
  now = new Date(),
  supabase,
}: {
  currentProfileId: string;
  input: ProspectingSampleOrderInput;
  isOwner: boolean;
  now?: Date;
  supabase: SupabaseLike;
}): Promise<ProspectingSampleOrderResult> {
  const centerName = cleanText(input.centerName);
  const attentionName = cleanText(input.attentionName);
  const address1 = cleanText(input.address1);
  const address2 = cleanOptionalText(input.address2);
  const city = cleanText(input.city);
  const state = cleanText(input.state).toUpperCase();
  const zip = cleanText(input.zip);
  const notes = cleanText(input.notes).slice(0, MAX_ORDER_NOTES_LENGTH) || null;
  const leadId = cleanOptionalText(input.leadId);

  if (!centerName || !attentionName || !address1 || !city || !state || !zip) {
    return { error: 'missing_fields' };
  }

  const items = normalizeItems(input.items);
  if (!items?.length) return { error: 'invalid_items' };

  let lead: ProspectingLeadRow | null = null;
  let previousLeadStage: string | null = null;
  if (leadId) {
    if (!UUID_PATTERN.test(leadId)) return { error: 'lead_error' };
    const leadResult = await supabase
      .from('prospecting_leads')
      .select('id,assigned_profile_id,stage,company_name')
      .eq('id', leadId)
      .maybeSingle();
    if (leadResult.error || !leadResult.data?.id) return { error: 'lead_error' };
    lead = leadResult.data as ProspectingLeadRow;
    previousLeadStage = lead.stage;
    if (!isOwner && lead.assigned_profile_id !== currentProfileId) return { error: 'unauthorized' };
  }

  const productIds = items.map((item) => item.productId);
  const productsResult = await supabase
    .from('products')
    .select('id,name,sku,category,active,product_recipes(id)')
    .in('id', productIds);
  if (productsResult.error) return { error: 'invalid_product' };

  const products = (productsResult.data ?? []) as ProductRow[];
  const productById = new Map(products.map((product) => [product.id, product]));
  for (const item of items) {
    const product = productById.get(item.productId);
    if (!product || product.active === false || product.category !== 'sample_boxes' || !hasRecipe(product)) {
      return { error: 'invalid_product' };
    }
  }

  const createdAt = now.toISOString();
  const orderResult = await supabase
    .from('orders')
    .insert({
      center_id: null,
      center_location_id: null,
      created_at: createdAt,
      fulfillment_method: 'carrier',
      notes,
      order_kind: 'prospecting_sample',
      prospecting_lead_id: leadId,
      shipping_address1: address1,
      shipping_address2: address2,
      shipping_city: city,
      shipping_company: centerName,
      shipping_name: attentionName,
      shipping_state: state,
      shipping_zip: zip,
      status: 'New',
      submission_id: crypto.randomUUID(),
      subtotal_cents: 0,
      user_id: currentProfileId,
    })
    .select('id')
    .maybeSingle();

  if (orderResult.error || !orderResult.data?.id) return { error: 'insert_error' };
  const orderId = String(orderResult.data.id);

  const itemResult = await supabase.from('order_items').insert(
    items.map((item) => {
      const product = productById.get(item.productId)!;
      return {
        line_total_cents: 0,
        order_id: orderId,
        product_id: product.id,
        product_name_snapshot: product.name || product.sku || 'Sample box',
        qty: item.quantity,
        unit_price_cents: 0,
      };
    })
  );

  if (itemResult.error) {
    await cleanupOrder(supabase, orderId);
    return { error: 'insert_error' };
  }

  if (leadId && lead) {
    const leadUpdateResult = await supabase
      .from('prospecting_leads')
      .update({
        last_activity_at: createdAt,
        last_result: 'Sample order submitted',
        stage: 'sample_requested',
        updated_at: createdAt,
        updated_by: currentProfileId,
      })
      .eq('id', leadId)
      .select('id')
      .maybeSingle();

    if (leadUpdateResult.error || !leadUpdateResult.data?.id) {
      await cleanupOrder(supabase, orderId);
      return { error: 'lead_error' };
    }

    const activityResult = await supabase.from('prospecting_activities').insert({
      activity_type: 'stage_change',
      body: `Sample order ${orderId} created for ${centerName}.`,
      created_by: currentProfileId,
      lead_id: leadId,
      next_stage: 'sample_requested',
      previous_stage: previousLeadStage,
      result: 'Sample order submitted',
    });

    if (activityResult.error) {
      await cleanupOrder(supabase, orderId);
      return { error: 'lead_error' };
    }
  }

  return { error: null, orderId };
}
