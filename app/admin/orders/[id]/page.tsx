import type { TablesUpdate } from '@/lib/supabase/database.types';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { OrderStatusBadge } from '@/components/order-status';
import { OrderNotes } from '@/components/order-notes';
import { OrderTrashDialog } from '@/components/order-trash-dialog';
import OrderFulfillmentForm from '@/components/order-fulfillment-form';
import PrintOrderButton from '@/components/print-order-button';
import PendingSubmitButton from '@/components/pending-submit-button';
import { ProductBoxUsageFields, type ProductBoxInventoryOption, type ProductBoxRequiredLine } from '@/components/product-box-usage-fields';
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
import { missingOrderAddressFields, orderAddressLabel, orderActivityLabel } from '@/lib/order-workflow';
import { shipmentTrackingLinesFromFormData } from '@/lib/shipment-tracking';
import { createClient } from '@/lib/supabase/server';
import { formatAppDateTime, usd } from '@/lib/utils';

const ORDER_STATUSES = ['New', 'Processing', 'Shipped'] as const;

type OrderStatus = (typeof ORDER_STATUSES)[number];

function isOrderStatus(value: string): value is OrderStatus {
  return ORDER_STATUSES.includes(value as OrderStatus);
}

function formatOrderTimestamp(value: string | null) {
  return formatAppDateTime(value);
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function productBoxLabel(item: { name: string | null; sku: string | null }) {
  return item.sku ? `${item.name || 'Box'} (${item.sku})` : item.name || 'Box';
}

function isBoxSku(value: string | null | undefined) {
  const sku = String(value ?? '').toUpperCase();
  return sku.startsWith('BOX-') || sku.startsWith('MAT-BOX-');
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
  const orderUpdateResult = await supabase.from('orders').update({ status }).eq('id', id).neq('status', 'Shipped').is('archived_at', null).select('id');
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
  const manualTrackingRows = shipmentTrackingLinesFromFormData(formData);
  if (!['carrier', 'local_delivery'].includes(fulfillmentMethod)) redirect(`/admin/orders/${id}?toast=fulfillment_required`);
  if (fulfillmentMethod === 'carrier' && shippingCostCents <= 0) redirect(`/admin/orders/${id}?toast=shipping_required`);
  if (fulfillmentMethod === 'local_delivery' && shippingCostCents === 0 && !localDeliveryConfirmed) {
    redirect(`/admin/orders/${id}?toast=local_delivery_confirm_required`);
  }

  const { data: order } = await supabase
    .from('orders')
    .select('*,profiles(email,full_name),centers(name)')
    .eq('id', id)
    .single();
  if (!order || order.archived_at) redirect(`/admin/orders/${id}?toast=ship_error`);
  if (order.status === 'Shipped') redirect(`/admin/orders/${id}?toast=order_shipped`);
  if (fulfillmentMethod === 'carrier' && missingOrderAddressFields(order).length) redirect(`/admin/orders/${id}?toast=address_required`);
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
      .or('sku.ilike.BOX-%,sku.ilike.MAT-BOX-%,name.ilike.%box%');

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

  const orderUpdatePayload: TablesUpdate<'orders'> = {
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
    .neq('status', 'Shipped')
    .select('id');

  if (orderUpdateResult.error && isMissingFulfillmentMethodColumn(orderUpdateResult.error)) {
    const fallbackPayload = { ...orderUpdatePayload };
    delete fallbackPayload.fulfillment_method;
    orderUpdateResult = await supabase
      .from('orders')
      .update(fallbackPayload)
      .eq('id', id)
      .neq('status', 'Shipped')
      .select('id');
  }

  if (orderUpdateResult.error) {
    if (orderUpdateResult.error) console.error('[orders] shipment status update failed', orderUpdateResult.error);
    redirect(`/admin/orders/${id}?toast=ship_error`);
  }

  const claimedShipment = Boolean(orderUpdateResult.data?.length);
  if (claimedShipment) {
    const items = await getOrderItemSummaries(supabase, id);
    const centerEmails = await getCenterLoginEmails(supabase, (order as any).center_id);
    const orderProfile = relatedOne((order as any).profiles);
    const orderCenter = relatedOne((order as any).centers);
    const emailResult = await sendShippedEmail(
      centerEmails.length ? centerEmails : orderProfile?.email,
      items,
      manualTrackingRows,
      {
        customerName: orderCenter?.name ?? orderProfile?.full_name,
        orderId: id,
        shippedAt,
        notes: order.notes,
      },
    );
    if (!emailResult.ok) redirect(`/admin/orders/${id}?toast=order_shipped_email_failed`);
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
  if (!order || order.archived_at || (order.status !== 'Processing' && order.status !== 'Shipped')) {
    redirect(`/admin/orders/${id}?toast=archive_error`);
  }

  const archiveResult = await supabase.from('orders').update({ archived_at: new Date().toISOString() }).eq('id', id).is('archived_at', null).select('id');
  redirect(`/admin/orders/${id}?toast=${archiveResult.error || !archiveResult.data?.length ? 'archive_error' : 'archive_success'}`);
}

async function saveDelivery(formData: FormData) {
  'use server';
  const id = cleanText(formData.get('id'));
  await requireAdminWriteAccess(orderToastHref(id, 'admin_write_denied'), 'orders');
  const supabase = await createClient();
  const { data: order } = await supabase.from('orders').select('id,status,archived_at,center_id').eq('id', id).single();
  if (!order || order.status === 'Shipped' || order.archived_at) redirect(orderToastHref(id, 'delivery_error'));
  const update: TablesUpdate<'orders'> = {};
  const locationId = cleanText(formData.get('location_id'));
  if (locationId) {
    const { data: location } = await supabase.from('center_locations').select('*').eq('id', locationId).eq('center_id', order.center_id!).eq('is_active', true).single();
    if (!location) redirect(orderToastHref(id, 'delivery_error'));
    Object.assign(update, { center_location_id: location.id, shipping_address1: location.address1, shipping_address2: location.address2, shipping_city: location.city, shipping_state: location.state, shipping_zip: location.zip });
  } else {
    for (const field of ['shipping_name','shipping_company','shipping_address1','shipping_address2','shipping_city','shipping_state','shipping_zip'] as const) update[field] = cleanText(formData.get(field)) || null;
  }
  const result = await supabase.from('orders').update(update).eq('id', id).neq('status','Shipped').is('archived_at',null).select('id');
  redirect(orderToastHref(id, result.error || !result.data?.length ? 'delivery_error' : 'delivery_updated'));
}

async function saveNotes(formData: FormData) {
  'use server';
  const id = cleanText(formData.get('id'));
  await requireAdminWriteAccess(orderToastHref(id, 'admin_write_denied'), 'orders');
  const notes = cleanText(formData.get('notes'));
  if (notes.length > 10000) redirect(orderToastHref(id, 'notes_error'));
  const supabase = await createClient();
  const result = await supabase.from('orders').update({ notes }).eq('id', id).select('id');
  redirect(orderToastHref(id, result.error || !result.data?.length ? 'notes_error' : 'notes_updated'));
}

export default async function AdminOrderDetail(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
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
    supabase.from('order_items').select('id,qty,unit_price_cents,line_total_cents,product_id,product_name_snapshot,shipping_boxes_used,cogs_product_cents,cogs_shipping_cents,cogs_processing_fee_cents,cogs_donation_cents,cogs_total_cents,cogs_source,cogs_estimated,cogs_snapshot_at,products(name,shipping_box_count_required)').eq('order_id', order.id),
    supabase.from('order_item_shipping_boxes').select('order_item_id,inventory_item_id,quantity,total_cost_cents,cogs_estimated,inventory_items(name,sku)').eq('order_id', order.id),
    supabase.from('inventory_items').select('id,name,sku').eq('item_type', 'material_supply').eq('active', true).or('sku.ilike.BOX-%,sku.ilike.MAT-BOX-%,name.ilike.%box%').order('name', { ascending: true }),
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
        return component.component_role === 'box' || isBoxSku(componentItem?.sku);
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

  const [{ data: locations }, activityResult] = await Promise.all([
    order.center_id ? supabase.from('center_locations').select('*').eq('center_id', order.center_id).eq('is_active', true).order('name') : Promise.resolve({ data: [] }),
    supabase.from('order_activity').select('*').eq('order_id', order.id).order('created_at', { ascending: false }).limit(50),
  ]);
  const missingAddress = missingOrderAddressFields(order);
  const canEdit = current.isOwner || current.access.orders.canEdit;
  const editableDelivery = canEdit && order.status !== 'Shipped' && !order.archived_at;
  const additionalToasts: Record<string, [string, 'success' | 'error']> = {
    order_restored: ['Order restored. Linked recurring schedules remain paused.', 'success'],
    address_required: ['Complete the delivery address before carrier shipping.', 'error'],
    delivery_updated: ['Delivery address updated.', 'success'], delivery_error: ['Delivery address was not saved. Check the location and order status.', 'error'],
    notes_updated: ['Delivery notes saved.', 'success'], notes_error: ['Delivery notes were not saved.', 'error'],
    order_shipped_email_failed: ['Order shipped, but the customer email failed. Do not ship it again; contact the customer directly.', 'error'],
  };

  return <div className="order-detail-workspace space-y-6">

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

    {additionalToasts[toast] ? <StatusToast message={additionalToasts[toast][0]} tone={additionalToasts[toast][1]} /> : null}
    <header className="workspace-heading">
      <div><Link className="text-sm text-slate-500" href="/admin/orders">Orders / {order.id.slice(0,8)}</Link><h1 className="page-title mt-2">{orderCustomerLabel(order)}</h1><p className="mt-2 text-sm text-slate-500">{formatOrderTimestamp(order.created_at)} {order.order_kind === 'prospecting_sample' ? ' · Sample order' : ''}</p></div>
      <div className="workspace-heading-actions"><OrderStatusBadge status={order.status} /><PrintOrderButton /></div>
    </header>
    <OrderNotes notes={orderNotes} />
    {order.order_kind !== 'prospecting_sample' && items.some(item => item.unit_price_cents === 0) ? <p className="workspace-notice warning">This standard order includes $0 items. Verify that complimentary pricing is intentional before fulfillment.</p> : null}
    {order.archived_at ? <p className="workspace-notice">Archived {formatOrderTimestamp(order.archived_at)}</p> : null}
    <div className="order-detail-columns">
      <div className="min-w-0 space-y-6">
        <section className="order-detail-section">
          <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-semibold">Products</h2><span className="text-sm text-slate-500">{items.length} items</span></div>
          <div className="overflow-x-auto"><table className="order-items-table w-full text-sm"><thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>
            {items.map((item: any) => <tr key={item.id}><td>{item.product_name_snapshot || relatedOne(item.products)?.name || 'Unknown product'}{item.cogs_snapshot_at ? <p className="mt-1 text-xs text-slate-500">COGS {usd(Math.round(normalizeInventoryNumber(item.cogs_total_cents)))} ({item.cogs_estimated ? 'estimated' : 'actual'})</p> : null}</td><td>{item.qty}</td><td>{usd(item.unit_price_cents)}</td><td>{usd(item.line_total_cents)}</td></tr>)}
          </tbody><tfoot><tr><th colSpan={3}>Order subtotal</th><td>{usd(order.subtotal_cents)}</td></tr></tfoot></table></div>
        </section>
        <section id="delivery-address" className="order-detail-section">
          <h2 className="text-lg font-semibold">Delivery address</h2>
          <p className="mt-3 font-medium">{order.shipping_company || order.shipping_name || 'Recipient missing'}</p>
          {order.shipping_company && order.shipping_name ? <p className="text-sm">{order.shipping_name}</p> : null}
          <p className="mt-1 text-sm text-slate-600">{orderAddressLabel(order) || 'No delivery address on this order'}</p>
          {missingAddress.length ? <p className="workspace-notice warning mt-3">Missing: {missingAddress.join(', ')}</p> : null}
          {editableDelivery ? <details className="mt-4" open={missingAddress.length > 0}><summary className="cursor-pointer text-sm font-semibold">Edit address</summary>
            {locations?.length ? <form action={saveDelivery} className="flex flex-wrap items-end gap-3 mt-4"><input type="hidden" name="id" value={order.id} /><label className="workspace-field flex-1">Saved location<select className="input" name="location_id" required defaultValue=""><option value="" disabled>Select location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name} - {location.address1}</option>)}</select></label><PendingSubmitButton className="btn-secondary" label="Use location" pendingLabel="Saving..." /></form> : null}
            <form action={saveDelivery} className="delivery-grid mt-4"><input type="hidden" name="id" value={order.id} />
              {([['shipping_name','Recipient'],['shipping_company','Company'],['shipping_address1','Street address'],['shipping_address2','Apartment / suite'],['shipping_city','City'],['shipping_state','State'],['shipping_zip','ZIP']] as const).map(([field,label]) => <label key={field} className="workspace-field">{label}<input className="input" name={field} defaultValue={order[field] || ''} /></label>)}
              <div><PendingSubmitButton className="btn-secondary" label="Save address" pendingLabel="Saving..." /></div>
            </form>
          </details> : null}
        </section>
        <section className="order-detail-section">
          <h2 className="text-lg font-semibold">Delivery notes</h2>
          {canEdit ? <form action={saveNotes} className="space-y-3 mt-3"><input type="hidden" name="id" value={order.id} /><label className="sr-only" htmlFor="delivery-notes">Delivery notes</label><textarea className="input" id="delivery-notes" name="notes" rows={3} maxLength={10000} defaultValue={order.notes || ''} /><PendingSubmitButton className="btn-secondary" label="Save notes" pendingLabel="Saving..." /></form> : !orderNotes ? <p className="mt-2 text-sm text-slate-500">No delivery notes</p> : null}
        </section>
        <section className="order-detail-section print-hidden"><h2 className="text-lg font-semibold mb-4">Activity</h2>
          {activityResult.error ? <p className="workspace-notice warning">Activity is unavailable.</p> : !activityResult.data?.length ? <p className="text-sm text-slate-500">Order placed {formatOrderTimestamp(order.created_at)}. Earlier changes were not recorded.</p> : activityResult.data.map(event => <details key={event.id} className="order-activity-row"><summary className="cursor-pointer"><strong>{orderActivityLabel(event.action)}</strong><span>{event.actor_name || 'System'} · {formatOrderTimestamp(event.created_at)}</span></summary>{event.action === 'notes_updated' ? <div className="mt-3 text-sm"><p className="text-slate-500">Previous notes</p><p className="whitespace-pre-wrap">{String((event.before_value as Record<string, unknown>)?.notes || 'None')}</p></div> : null}</details>)}
        </section>
      </div>
      <aside className="order-fulfillment-panel">
        <h2 className="text-lg font-semibold mb-4">Fulfillment</h2>
        <p className="text-sm text-slate-500 mb-4 break-all">{order.profiles?.email || 'No customer login'}</p>
        {editableDelivery ? <>
          <form action={updateStatus} className="flex gap-2 mb-5"><input type="hidden" name="id" value={order.id} /><label className="sr-only" htmlFor="order-status">Order status</label><select id="order-status" className="input" name="status" defaultValue={order.status || 'New'}><option>New</option><option>Processing</option></select><PendingSubmitButton className="btn-secondary" label="Update" pendingLabel="Saving..." /></form>
          <div className="fulfillment-fees mb-5"><p>Processing fee <strong>{usd(processingFeePreviewCents)}</strong></p><p>Donation <strong>{usd(donationCogsPreviewCents)}</strong></p></div>
          <OrderFulfillmentForm action={shipOrder} orderId={order.id} missingAddress={missingAddress} hasRequiredBoxLines={productBoxRequiredLines.length > 0}>
            {productBoxRequiredLines.length ? <div><h3 className="text-sm font-semibold mb-3">Product boxes</h3><ProductBoxUsageFields boxItems={productBoxOptions} recipeBoxCoveredLabels={recipeBoxCoveredLabels} requiredLines={productBoxRequiredLines} /></div> : null}
          </OrderFulfillmentForm>
        </> : <div className="space-y-3 text-sm"><p>{fulfillmentLabel(fulfillmentMethod)}</p>{order.shipped_at ? <p>Shipped {formatOrderTimestamp(order.shipped_at)}</p> : null}<p>Shipping COGS: {usd(Math.round(normalizeInventoryNumber(order.shipping_cost_cents)))}</p><p>Processing COGS: {usd(Math.round(normalizeInventoryNumber(order.processing_fee_cents)))}</p><p>Donation COGS: {usd(Math.round(normalizeInventoryNumber(order.donation_cogs_cents)))}</p>{shippingBoxSummary.map(usage => <p key={usage.label}>{usage.quantity} x {usage.label}</p>)}</div>}
        <div className="mt-6 pt-4 border-t space-y-3 print-hidden">
          {canArchiveOrders && !order.archived_at && ['Processing','Shipped'].includes(order.status || '') ? <form action={archiveOrder}><input type="hidden" name="id" value={order.id} /><PendingSubmitButton className="btn-secondary w-full" label="Archive order" pendingLabel="Archiving..." /></form> : null}
          {canEdit ? <OrderTrashDialog orderId={order.id} customerName={orderCustomerLabel(order)} hasRecurring={(recurringCount ?? 0) > 0} className="btn-secondary w-full" /> : null}
        </div>
      </aside>
    </div>
  </div>;
}
