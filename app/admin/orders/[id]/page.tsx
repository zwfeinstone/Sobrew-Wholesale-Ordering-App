import { notFound, redirect } from 'next/navigation';
import ConfirmSubmitButton from '@/components/confirm-submit-button';
import { OrderStatusBadge, OrderStatusTimeline } from '@/components/order-status';
import PendingSubmitButton from '@/components/pending-submit-button';
import { ProductBoxUsageFields, type ProductBoxInventoryOption, type ProductBoxRequiredLine } from '@/components/product-box-usage-fields';
import ShipOrderSubmitButton from '@/components/ship-order-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { getCenterLoginEmails } from '@/lib/center-logins';
import { snapshotOrderCommissionForShipment } from '@/lib/commissions';
import { sendShippedEmail } from '@/lib/email';
import { centsFromDollars, isWholeCountQuantity, normalizeInventoryNumber, roundWholeCountQuantity } from '@/lib/inventory';
import { snapshotOrderCogsForShipment } from '@/lib/order-cogs';
import { donationCogsCentsForRevenue, processingFeeCentsForRevenue } from '@/lib/order-fees';
import { getOrderItemSummaries } from '@/lib/order-items';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

const ORDER_STATUSES = ['New', 'Processing', 'Shipped'] as const;

type OrderStatus = (typeof ORDER_STATUSES)[number];

function isOrderStatus(value: string): value is OrderStatus {
  return ORDER_STATUSES.includes(value as OrderStatus);
}

function formatOrderTimestamp(value: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function productBoxLabel(item: { name: string | null; sku: string | null }) {
  return item.sku ? `${item.name || 'Box'} (${item.sku})` : item.name || 'Box';
}

function fulfillmentLabel(value: unknown) {
  return value === 'local_delivery' ? 'Local delivery' : 'Carrier shipping';
}

function orderCustomerLabel(order: any) {
  return order.centers?.name || cleanText(order.shipping_company) || cleanText(order.shipping_name) || 'Unknown center';
}

function isMissingFulfillmentMethodColumn(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return message.includes('fulfillment_method') && (
    message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes('Could not find')
  );
}

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function trackingRowsFromFormData(formData: FormData) {
  return formData
    .getAll('tracking_numbers')
    .flatMap((value) => String(value ?? '').split(/[\n,;]+/))
    .map(cleanText)
    .filter(Boolean)
    .map((trackingCode) => ({ carrier: 'UPS', trackingCode }));
}

function orderToastHref(id: string, toast: string) {
  return id ? `/admin/orders/${id}?toast=${toast}` : `/admin/orders?toast=${toast}`;
}

async function updateStatus(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '').trim();
  const status = String(formData.get('status') ?? '').trim();
  await requireAdminWriteAccess(orderToastHref(id, 'admin_write_denied'), 'orders');

  if (!id || !isOrderStatus(status)) {
    console.error('[orders] invalid status update request', { orderId: id, requestedStatus: status });
    redirect(orderToastHref(id, 'status_error'));
  }

  const supabase = await createClient();
  if (status === 'Shipped') {
    redirect(orderToastHref(id, 'ship_on_detail_required'));
  }
  const orderUpdateResult = await supabase.from('orders').update({ status }).eq('id', id).select('id');
  if (orderUpdateResult.error || !orderUpdateResult.data?.length) {
    console.error('[orders] status update failed', {
      code: orderUpdateResult.error?.code,
      details: orderUpdateResult.error?.details,
      message: orderUpdateResult.error?.message,
      orderId: id,
      requestedStatus: status,
    });
  }
  const query = new URLSearchParams({
    toast: orderUpdateResult.error || !orderUpdateResult.data?.length ? 'status_error' : 'status_updated',
  });
  redirect(`/admin/orders/${id}?${query.toString()}`);
}

async function shipOrder(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  await requireAdminWriteAccess(id ? `/admin/orders/${id}?toast=admin_write_denied` : '/admin/orders?toast=admin_write_denied', 'orders');

  const supabase = await createClient();
  const shippingCostInput = String(formData.get('shipping_cost') ?? '').trim();
  if (!id) redirect('/admin/orders?toast=shipping_required');
  if (!shippingCostInput) redirect(`/admin/orders/${id}?toast=shipping_required`);
  let shippingCostCents = 0;
  try {
    shippingCostCents = centsFromDollars(shippingCostInput);
  } catch {
    redirect(`/admin/orders/${id}?toast=shipping_required`);
  }
  const fulfillmentMethod = String(formData.get('fulfillment_method') ?? '');
  const localDeliveryConfirmed = formData.get('local_delivery_zero_confirm') === 'on';
  const zeroBoxesConfirmed = formData.get('zero_boxes_confirmed') === 'on';
  const manualTrackingRows = trackingRowsFromFormData(formData);
  if (!['carrier', 'local_delivery'].includes(fulfillmentMethod)) redirect(`/admin/orders/${id}?toast=fulfillment_required`);
  if (fulfillmentMethod === 'carrier' && shippingCostCents <= 0) redirect(`/admin/orders/${id}?toast=shipping_required`);
  if (fulfillmentMethod === 'local_delivery' && shippingCostCents === 0 && !localDeliveryConfirmed) {
    redirect(`/admin/orders/${id}?toast=local_delivery_confirm_required`);
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id,user_id,center_id,status,archived_at,subtotal_cents,profiles(email,full_name),centers(name)')
    .eq('id', id)
    .single();
  if (!order || order.archived_at) redirect(`/admin/orders/${id}?toast=ship_error`);
  if (fulfillmentMethod === 'carrier' && !manualTrackingRows.length) {
    redirect(`/admin/orders/${id}?toast=tracking_required`);
  }

  const processingFeeCents = processingFeeCentsForRevenue((order as any).subtotal_cents);
  const donationCogsCents = donationCogsCentsForRevenue((order as any).subtotal_cents);

  const { data: orderItems } = await supabase
    .from('order_items')
    .select('id,qty,product_id,product_name_snapshot,products(name,shipping_box_count_required)')
    .eq('order_id', id);

  const requiredOrderItems = (orderItems ?? []).filter((item: any) => relatedOne(item.products)?.shipping_box_count_required);
  if (requiredOrderItems.length) {
    const { data: boxItems, error: boxItemsError } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('item_type', 'material_supply')
      .eq('active', true)
      .or('sku.ilike.BOX-%,name.ilike.%box%');

    if (boxItemsError) redirect(`/admin/orders/${id}?toast=ship_error`);
    const validBoxItemIds = new Set((boxItems ?? []).map((item: any) => String(item.id)));

    const boxItemIds = formData.getAll('box_inventory_item_id').map(String);
    const rawQuantities = formData.getAll('box_quantity').map((value) => String(value ?? '').trim());
    const quantities = rawQuantities.map((value) => Math.max(0, Number.parseFloat(value) || 0));
    const submittedUsageByBoxItem = new Map<string, number>();

    for (let index = 0; index < Math.max(boxItemIds.length, quantities.length); index += 1) {
      const boxItemId = boxItemIds[index];
      const quantityInput = rawQuantities[index] ?? '';
      const quantity = quantities[index] ?? 0;
      const anyFieldPresent = Boolean(boxItemId || quantityInput);
      if (!anyFieldPresent) continue;

      if (quantity <= 0) {
        if (fulfillmentMethod === 'local_delivery') continue;
        redirect(`/admin/orders/${id}?toast=zero_boxes_local_delivery_required`);
      }
      if (!isWholeCountQuantity(quantity)) redirect(`/admin/orders/${id}?toast=box_count_required`);

      if (!validBoxItemIds.size) redirect(`/admin/orders/${id}?toast=box_inventory_required`);
      if (!validBoxItemIds.has(boxItemId)) {
        redirect(`/admin/orders/${id}?toast=box_count_required`);
      }

      submittedUsageByBoxItem.set(boxItemId, (submittedUsageByBoxItem.get(boxItemId) ?? 0) + roundWholeCountQuantity(quantity));
    }

    const totalSubmittedQuantity = [...submittedUsageByBoxItem.values()].reduce((sum, quantity) => sum + quantity, 0);
    const requiredLines = (requiredOrderItems as any[]).map((item) => ({
      id: String(item.id),
      qty: Math.max(0, normalizeInventoryNumber(item.qty)),
    }));
    const totalRequiredQty = requiredLines.reduce((sum, item) => sum + item.qty, 0);
    if (totalRequiredQty <= 0) redirect(`/admin/orders/${id}?toast=box_count_required`);

    if (totalSubmittedQuantity <= 0) {
      if (fulfillmentMethod !== 'local_delivery') redirect(`/admin/orders/${id}?toast=zero_boxes_local_delivery_required`);
      if (!zeroBoxesConfirmed) redirect(`/admin/orders/${id}?toast=zero_boxes_confirm_required`);
    }

    const deleteResult = await supabase
      .from('order_item_shipping_boxes')
      .delete()
      .eq('order_id', id)
      .is('consumed_at', null);
    if (deleteResult.error) redirect(`/admin/orders/${id}?toast=ship_error`);

    const primaryOrderItemId = requiredLines[0]?.id;
    const usageRows = primaryOrderItemId
      ? [...submittedUsageByBoxItem.entries()].map(([boxItemId, quantity]) => ({
        inventory_item_id: boxItemId,
        order_id: id,
        order_item_id: primaryOrderItemId,
        quantity,
      }))
      : [];

    if (usageRows.length) {
      const insertResult = await supabase.from('order_item_shipping_boxes').insert(usageRows);
      if (insertResult.error) redirect(`/admin/orders/${id}?toast=ship_error`);
    }

    for (const line of requiredLines) {
      const boxesUsed = line.id === primaryOrderItemId ? totalSubmittedQuantity : 0;
      const { error: itemError } = await supabase
        .from('order_items')
        .update({ shipping_boxes_used: boxesUsed })
        .eq('id', line.id);
      if (itemError) redirect(`/admin/orders/${id}?toast=ship_error`);
    }
  }

  const cogsResult = await snapshotOrderCogsForShipment({
    donationCogsCents,
    orderId: id,
    processingFeeCents,
    shippingCostCents,
    supabase,
  });

  if (cogsResult.error) {
    redirect(`/admin/orders/${id}?toast=ship_error`);
  }

  const shippedAt = new Date().toISOString();
  const commissionResult = await snapshotOrderCommissionForShipment({
    orderId: id,
    shippedAt,
    shippingCostCents,
  });

  if (commissionResult.error) {
    console.error('[orders] commission snapshot failed', commissionResult.error);
    redirect(`/admin/orders/${id}?toast=ship_error`);
  }

  const orderUpdatePayload: Record<string, unknown> = {
    donation_cogs_cents: donationCogsCents,
    fulfillment_method: fulfillmentMethod,
    processing_fee_cents: processingFeeCents,
    shipping_cost_cents: shippingCostCents,
    shipped_at: shippedAt,
    status: 'Shipped',
  };
  let orderUpdateResult = await supabase
    .from('orders')
    .update(orderUpdatePayload)
    .eq('id', id)
    .select('id');

  if (orderUpdateResult.error && isMissingFulfillmentMethodColumn(orderUpdateResult.error)) {
    const fallbackPayload = { ...orderUpdatePayload };
    delete fallbackPayload.fulfillment_method;
    orderUpdateResult = await supabase
      .from('orders')
      .update(fallbackPayload)
      .eq('id', id)
      .select('id');
  }

  if (orderUpdateResult.error || !orderUpdateResult.data?.length) {
    if (orderUpdateResult.error) console.error('[orders] shipment status update failed', orderUpdateResult.error);
    redirect(`/admin/orders/${id}?toast=ship_error`);
  }

  if (order.status !== 'Shipped') {
    const items = await getOrderItemSummaries(supabase, id);
    const centerEmails = await getCenterLoginEmails(supabase, (order as any).center_id);
    const orderProfile = relatedOne((order as any).profiles);
    const orderCenter = relatedOne((order as any).centers);
    await sendShippedEmail(
      centerEmails.length ? centerEmails : orderProfile?.email,
      items,
      manualTrackingRows,
      {
        customerName: orderCenter?.name ?? orderProfile?.full_name,
        orderId: id,
        shippedAt,
      },
    );
  }

  redirect(`/admin/orders/${id}?toast=order_shipped`);
}

async function archiveOrder(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  const current = await requireAdminSectionEdit('orders', id ? `/admin/orders/${id}?toast=admin_write_denied` : '/admin/orders?toast=admin_write_denied');
  if (!current.isOwner) redirect(id ? `/admin/orders/${id}?toast=archive_denied` : '/admin/orders?toast=archive_denied');

  const supabase = await createClient();
  if (!id) redirect('/admin/orders?toast=archive_error');

  const { data: order } = await supabase.from('orders').select('id,status,archived_at').eq('id', id).single();
  if (!order || order.archived_at || !['Processing', 'Shipped'].includes(order.status)) {
    redirect(`/admin/orders/${id}?toast=archive_error`);
  }

  const archiveResult = await supabase.from('orders').update({ archived_at: new Date().toISOString() }).eq('id', id).is('archived_at', null).select('id');
  redirect(`/admin/orders/${id}?toast=${archiveResult.error || !archiveResult.data?.length ? 'archive_error' : 'archive_success'}`);
}

async function deleteOrder(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  await requireAdminWriteAccess(id ? `/admin/orders/${id}?toast=admin_write_denied` : '/admin/orders?toast=admin_write_denied', 'orders');

  const supabase = await createClient();
  if (!id) redirect('/admin/orders?toast=delete_error');

  const { data: deleteResult, error: deleteError } = await supabase
    .rpc('delete_order_and_restore_inventory', { p_order_id: id })
    .single();

  if (deleteError || !deleteResult) {
    if (deleteError) console.error('[orders] delete with inventory restore failed', deleteError);
    redirect(`/admin/orders/${id}?toast=delete_error`);
  }

  const recurringCount = Number((deleteResult as { recurring_source_count?: unknown }).recurring_source_count ?? 0);
  redirect(`/admin/orders?toast=${recurringCount > 0 ? 'delete_success_with_recurring' : 'delete_success'}`);
}

export default async function AdminOrderDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const current = await requireAdminSectionView('orders');
  const canArchiveOrders = current.isOwner;
  const supabase = await createClient();
  const toast = typeof searchParams.toast === 'string' ? searchParams.toast : '';
  const { data: order } = await supabase.from('orders').select('*,profiles(email,full_name),centers(name)').eq('id', params.id).single();
  if (!order) return notFound();
  const [
    itemsResult,
    shippingBoxUsagesResult,
    boxItemsResult,
  ] = await Promise.all([
    supabase.from('order_items').select('id,qty,product_id,product_name_snapshot,shipping_boxes_used,cogs_product_cents,cogs_shipping_cents,cogs_processing_fee_cents,cogs_donation_cents,cogs_total_cents,cogs_source,cogs_estimated,cogs_snapshot_at,products(name,shipping_box_count_required)').eq('order_id', order.id),
    supabase.from('order_item_shipping_boxes').select('order_item_id,inventory_item_id,quantity,total_cost_cents,cogs_estimated,inventory_items(name,sku)').eq('order_id', order.id),
    supabase.from('inventory_items').select('id,name,sku').eq('item_type', 'material_supply').eq('active', true).or('sku.ilike.BOX-%,name.ilike.%box%').order('name', { ascending: true }),
  ]);
  const items = itemsResult.data ?? [];
  const shippingBoxUsages = shippingBoxUsagesResult.error ? [] : (shippingBoxUsagesResult.data ?? []);
  const boxItems = boxItemsResult.error ? [] : (boxItemsResult.data ?? []);
  const { count: recurringCount } = await supabase
    .from('recurring_orders')
    .select('id', { count: 'exact', head: true })
    .eq('source_order_id', order.id);
  const orderNotes = typeof order.notes === 'string' ? order.notes.trim() : '';
  const requiredBoxItems = (items ?? []).filter((item: any) => relatedOne(item.products)?.shipping_box_count_required);
  const productBoxRequiredLines: ProductBoxRequiredLine[] = requiredBoxItems.map((item: any) => {
    const product = relatedOne(item.products);
    return {
      id: item.id,
      label: `${product?.name || item.product_name_snapshot || 'Unknown product'} x ${item.qty}`,
    };
  });
  const nonRequiredBoxRecipeProductIds = [
    ...new Set(
      (items as any[])
        .filter((item) => item.product_id && !relatedOne(item.products)?.shipping_box_count_required)
        .map((item) => String(item.product_id))
    ),
  ];
  const { data: nonRequiredBoxRecipes } = productBoxRequiredLines.length && nonRequiredBoxRecipeProductIds.length
    ? await supabase
        .from('product_recipes')
        .select('product_id,product_recipe_components(component_role,inventory_items(sku))')
        .in('product_id', nonRequiredBoxRecipeProductIds)
    : { data: [] };
  const recipeBoxProductIds = new Set(
    ((nonRequiredBoxRecipes ?? []) as any[])
      .filter((recipe) => (recipe.product_recipe_components ?? []).some((component: any) => {
        const componentItem = relatedOne(component.inventory_items);
        return component.component_role === 'box' || Boolean(componentItem?.sku?.startsWith('BOX-'));
      }))
      .map((recipe) => String(recipe.product_id))
  );
  const recipeBoxCoveredLabels = [
    ...new Set(
      (items as any[])
        .filter((item) => item.product_id && recipeBoxProductIds.has(String(item.product_id)))
        .map((item) => {
          const product = relatedOne(item.products);
          return `${product?.name || item.product_name_snapshot || 'Unknown product'} x ${item.qty}`;
        })
    ),
  ];
  const productBoxOptions: ProductBoxInventoryOption[] = (boxItems as any[]).map((item) => ({
    id: item.id,
    label: productBoxLabel(item),
  }));
  const processingFeePreviewCents = processingFeeCentsForRevenue(order.subtotal_cents);
  const donationCogsPreviewCents = donationCogsCentsForRevenue(order.subtotal_cents);
  const fulfillmentMethod = order.fulfillment_method === 'local_delivery' ? 'local_delivery' : 'carrier';
  const shippingBoxSummaryByItem = new Map<string, { label: string; quantity: number }>();
  for (const usage of shippingBoxUsages as any[]) {
    const boxItem = relatedOne(usage.inventory_items);
    const label = productBoxLabel(boxItem ?? { name: null, sku: null });
    const key = String(usage.inventory_item_id ?? label);
    const current = shippingBoxSummaryByItem.get(key) ?? { label, quantity: 0 };
    current.quantity += Math.max(0, normalizeInventoryNumber(usage.quantity));
    shippingBoxSummaryByItem.set(key, current);
  }
  const shippingBoxSummary = [...shippingBoxSummaryByItem.values()].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-6">
      {toast === 'status_updated' ? <StatusToast message="Order status updated." tone="success" /> : null}
      {toast === 'status_error' ? <StatusToast message="Order status update failed." tone="error" /> : null}
      {toast === 'ship_on_detail_required' ? <StatusToast message="Use the shipping form to enter shipping cost before marking this order shipped." tone="error" /> : null}
      {toast === 'shipping_required' ? <StatusToast message="Carrier shipping requires a shipping cost greater than $0.00." tone="error" /> : null}
      {toast === 'tracking_required' ? <StatusToast message="Carrier shipping requires at least one tracking number." tone="error" /> : null}
      {toast === 'fulfillment_required' ? <StatusToast message="Choose carrier shipping or local delivery before marking this order shipped." tone="error" /> : null}
      {toast === 'local_delivery_confirm_required' ? <StatusToast message="Confirm this was a local delivery before recording $0.00 shipping." tone="error" /> : null}
      {toast === 'zero_boxes_local_delivery_required' ? <StatusToast message="0 boxes is only allowed when fulfillment method is Local delivery." tone="error" /> : null}
      {toast === 'zero_boxes_confirm_required' ? <StatusToast message="Confirm this local delivery has 0 boxes before marking it shipped." tone="error" /> : null}
      {toast === 'box_count_required' ? <StatusToast message="Product box size and quantity are required unless this is a confirmed local delivery with 0 boxes." tone="error" /> : null}
      {toast === 'box_inventory_required' ? <StatusToast message="Create or receive an active box material before shipping this order." tone="error" /> : null}
      {toast === 'order_shipped' ? <StatusToast message="Order shipped, COGS recorded, and customer email sent." tone="success" /> : null}
      {toast === 'ship_error' ? <StatusToast message="Unable to ship this order." tone="error" /> : null}
      {toast === 'archive_success' ? <StatusToast message="Order archived." tone="success" /> : null}
      {toast === 'archive_error' ? <StatusToast message="Unable to archive this order." tone="error" /> : null}
      {toast === 'archive_denied' ? <StatusToast message="Only superadmins can archive orders." tone="error" /> : null}
      {toast === 'delete_error' ? <StatusToast message="Unable to delete this order." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="You do not have permission to edit orders." tone="error" /> : null}
      {toast === 'sample_order_created' ? <StatusToast message="Sample order created for production." tone="success" /> : null}
      <section className="panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="eyebrow">Order Detail</span>
          <OrderStatusBadge status={order.status} />
        </div>
        <h1 className="page-title mt-4">Order overview</h1>
        <p className="page-subtitle mt-3">Update fulfillment status, verify shipping details, and review the ordered products below.</p>
        <p className="mt-4 break-words text-sm font-medium text-slate-600">Center {orderCustomerLabel(order)}</p>
        <p className="mt-1 break-all text-sm font-medium text-slate-600">Submitted by {order.profiles?.email || 'Unknown login'}</p>
        <p className="mt-4 text-sm font-medium text-slate-600">Placed {formatOrderTimestamp(order.created_at)}</p>
        {order.archived_at ? <p className="mt-2 text-sm font-medium text-slate-600">Archived {formatOrderTimestamp(order.archived_at)}</p> : null}
        <div className="mt-6">
          <OrderStatusTimeline status={order.status} />
        </div>
      </section>
      {order.archived_at ? (
        <div className="card text-sm text-slate-600">This order is archived and no longer appears in the active orders list.</div>
      ) : null}
      <div className="sticky-action-bar flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {order.status !== 'Shipped' ? (
          <form action={updateStatus} className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
            <input type="hidden" name="id" value={order.id} />
            <select className="input" name="status" defaultValue={order.status}>
              <option>New</option><option>Processing</option>
            </select>
            <PendingSubmitButton className="btn-primary w-full md:w-auto" label="Update status" pendingLabel="Updating..." />
          </form>
        ) : (
          <div className="text-sm font-semibold text-slate-700">This order was shipped {formatOrderTimestamp(order.shipped_at)}.</div>
        )}
        <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:flex-wrap md:justify-end">
          {canArchiveOrders && !order.archived_at && ['Processing', 'Shipped'].includes(order.status) ? (
            <form action={archiveOrder} className="w-full md:w-auto">
              <input type="hidden" name="id" value={order.id} />
              <PendingSubmitButton className="btn-secondary w-full md:w-auto" label="Archive order" pendingLabel="Archiving..." />
            </form>
          ) : null}
          <form action={deleteOrder} className="w-full md:w-auto">
            <input type="hidden" name="id" value={order.id} />
            <ConfirmSubmitButton
              className="w-full rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70 md:w-auto"
              confirmMessage={
                (recurringCount ?? 0) > 0
                  ? 'Delete this order permanently? This will restore shipped inventory deductions and also delete the recurring schedule created from it. This action cannot be undone.'
                  : 'Delete this order permanently? If it was shipped, inventory deductions will be restored. This action cannot be undone.'
              }
              label="Delete order"
              pendingLabel="Deleting..."
            />
          </form>
        </div>
      </div>
      <div className="card">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Shipping</p>
        <p className="mt-3 text-lg font-semibold text-slate-950">{cleanText(order.shipping_company) || order.shipping_name}</p>
        {cleanText(order.shipping_company) ? <p className="mt-1 text-sm font-semibold text-slate-700">Attn: {order.shipping_name}</p> : null}
        <p className="mt-2 text-sm text-slate-600">
          {[order.shipping_address1, order.shipping_address2].filter(Boolean).join(', ')}, {order.shipping_city}, {order.shipping_state} {order.shipping_zip}
        </p>
        <p className="mt-3 text-sm font-semibold text-slate-950">Fulfillment: {fulfillmentLabel(fulfillmentMethod)}</p>
        {order.shipping_cost_cents !== null && order.shipping_cost_cents !== undefined ? (
          <p className="mt-2 text-sm font-semibold text-slate-950">Shipping COGS: {usd(Math.round(normalizeInventoryNumber(order.shipping_cost_cents)))}</p>
        ) : null}
        {order.processing_fee_cents !== null && order.processing_fee_cents !== undefined ? (
          <p className="mt-2 text-sm font-semibold text-slate-950">Processing fee COGS: {usd(Math.round(normalizeInventoryNumber(order.processing_fee_cents)))}</p>
        ) : null}
        {order.donation_cogs_cents !== null && order.donation_cogs_cents !== undefined && normalizeInventoryNumber(order.donation_cogs_cents) > 0 ? (
          <p className="mt-2 text-sm font-semibold text-slate-950">Donation COGS: {usd(Math.round(normalizeInventoryNumber(order.donation_cogs_cents)))}</p>
        ) : null}
        {shippingBoxSummary.length ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm text-slate-600">
            <p className="font-semibold text-slate-950">Product Boxes</p>
            <p className="mt-1">
              {shippingBoxSummary.map((usage) => `${normalizeInventoryNumber(usage.quantity)} x ${usage.label}`).join(', ')}
            </p>
          </div>
        ) : null}
      </div>
      {!order.archived_at && order.status !== 'Shipped' ? (
        <section className="card space-y-5">
          <div>
            <span className="eyebrow">Ship Order</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Record shipping COGS</h2>
            <p className="mt-2 text-sm text-slate-500">Record carrier shipping COGS or local delivery.</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm text-slate-600">
            <p className="font-semibold text-slate-950">Processing fee COGS: {usd(processingFeePreviewCents)}</p>
            <p className="mt-1">Auto-calculated at 2.99% + $0.30 for this order.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm text-slate-600">
            <p className="font-semibold text-slate-950">Donation COGS: {usd(donationCogsPreviewCents)}</p>
            <p className="mt-1">Auto-calculated at 1% of this order subtotal.</p>
          </div>

          <details className="rounded-2xl border border-slate-200 bg-white/55 p-4" open>
            <summary className="cursor-pointer font-semibold text-slate-950">Manual shipping or local delivery</summary>
            <form action={shipOrder} className="mt-4 space-y-4">
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="zero_boxes_confirmed" value="" />
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold text-slate-950">Fulfillment method</legend>
                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm text-slate-700">
                  <input className="mt-1" name="fulfillment_method" type="radio" value="carrier" defaultChecked required />
                  <span>
                    <span className="block font-semibold text-slate-950">Carrier shipping</span>
                    <span className="mt-1 block text-slate-500">Use this when there is a carrier/shipping charge to record manually.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm text-slate-700">
                  <input className="mt-1" name="fulfillment_method" type="radio" value="local_delivery" required />
                  <span>
                    <span className="block font-semibold text-slate-950">Local delivery</span>
                    <span className="mt-1 block text-slate-500">Use this only for local drop-offs or pickups where carrier shipping may be $0.</span>
                  </span>
                </label>
              </fieldset>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Shipping cost
                <input className="input" name="shipping_cost" min="0" step="0.01" type="number" required placeholder="0.00" />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Tracking numbers <span className="text-rose-700">(required for carrier shipping)</span>
                <textarea
                  className="input min-h-28"
                  name="tracking_numbers"
                  placeholder="Enter one tracking number per line"
                />
                <span className="block text-xs font-normal text-slate-500">Separate multiple tracking numbers with new lines or commas. Local delivery can stay blank.</span>
              </label>
              <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
                <input className="mt-1" name="local_delivery_zero_confirm" type="checkbox" />
                <span>
                  <span className="block font-semibold">Confirm $0 local delivery</span>
                  <span className="mt-1 block">Check this only when the fulfillment method is local delivery and there is no carrier shipping cost.</span>
                </span>
              </label>
              {productBoxRequiredLines.length ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-slate-950">Product Boxes</p>
                  <ProductBoxUsageFields boxItems={productBoxOptions} recipeBoxCoveredLabels={recipeBoxCoveredLabels} requiredLines={productBoxRequiredLines} />
                </div>
              ) : null}
              <ShipOrderSubmitButton
                className="btn-primary w-full sm:w-auto"
                hasRequiredBoxLines={productBoxRequiredLines.length > 0}
                label="Mark shipped manually"
                pendingLabel="Shipping..."
              />
            </form>
          </details>
        </section>
      ) : null}
      {orderNotes ? (
        <div className="card">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Special note</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{orderNotes}</p>
        </div>
      ) : null}
      <div className="card space-y-3">
        {items?.map((i: any) => (
          <div key={i.id} className="flex flex-col gap-2 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="break-words">{relatedOne(i.products)?.name || i.product_name_snapshot || 'Unknown product'} x {i.qty}</span>
              {i.cogs_snapshot_at ? (
                <p className="mt-1 text-xs text-slate-500">
                  COGS {usd(Math.round(normalizeInventoryNumber(i.cogs_total_cents)))} ({i.cogs_estimated ? 'estimated' : 'actual'}{i.cogs_source ? `, ${String(i.cogs_source).replaceAll('_', ' ')}` : ''})
                </p>
              ) : null}
            </div>
            <div className="text-sm font-medium text-slate-600 sm:text-right">
              {i.cogs_shipping_cents !== null && i.cogs_shipping_cents !== undefined ? (
                <p>Shipping COGS: {usd(Math.round(normalizeInventoryNumber(i.cogs_shipping_cents)))}</p>
              ) : null}
              {i.cogs_processing_fee_cents !== null && i.cogs_processing_fee_cents !== undefined && normalizeInventoryNumber(i.cogs_processing_fee_cents) > 0 ? (
                <p>Processing fee COGS: {usd(Math.round(normalizeInventoryNumber(i.cogs_processing_fee_cents)))}</p>
              ) : null}
              {i.cogs_donation_cents !== null && i.cogs_donation_cents !== undefined && normalizeInventoryNumber(i.cogs_donation_cents) > 0 ? (
                <p>Donation COGS: {usd(Math.round(normalizeInventoryNumber(i.cogs_donation_cents)))}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
