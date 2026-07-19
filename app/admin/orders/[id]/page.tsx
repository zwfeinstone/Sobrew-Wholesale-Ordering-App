import { notFound, redirect } from 'next/navigation';
import ConfirmSubmitButton from '@/components/confirm-submit-button';
import { OrderStatusBadge, OrderStatusTimeline } from '@/components/order-status';
import PendingSubmitButton from '@/components/pending-submit-button';
import { ProductBoxUsageFields, type ProductBoxInventoryOption, type ProductBoxRequiredLine } from '@/components/product-box-usage-fields';
import EasyPostPackageFields, { type EasyPostPackageInput } from '@/components/easypost-package-fields';
import ShipOrderSubmitButton from '@/components/ship-order-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { getCenterLoginEmails } from '@/lib/center-logins';
import { snapshotOrderCommissionForShipment } from '@/lib/commissions';
import {
  buyEasyPostShipment,
  createEasyPostShipment,
  easyPostRateCents,
  refundEasyPostLabels,
  sortEasyPostRates,
  type EasyPostAddressInput,
  type EasyPostRate,
} from '@/lib/easypost';
import { sendShippedEmail } from '@/lib/email';
import { env } from '@/lib/env';
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

function isMissingFulfillmentMethodColumn(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return message.includes('fulfillment_method') && (
    message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes('Could not find')
  );
}

type ShippingLabelRow = {
  id: string;
  carrier: string | null;
  currency: string | null;
  easypost_rate_id: string | null;
  easypost_shipment_id: string | null;
  error_message: string | null;
  label_cost_cents: number | string | null;
  label_pdf_url: string | null;
  label_url: string | null;
  package_height_in: number | string;
  package_index: number | string;
  package_length_in: number | string;
  package_weight_oz: number | string;
  package_width_in: number | string;
  rates_json: unknown;
  service: string | null;
  status: string;
  tracking_code: string | null;
};

type ShippingSettingsRow = {
  shipping_origin_address1?: string | null;
  shipping_origin_address2?: string | null;
  shipping_origin_city?: string | null;
  shipping_origin_company?: string | null;
  shipping_origin_country?: string | null;
  shipping_origin_email?: string | null;
  shipping_origin_name?: string | null;
  shipping_origin_phone?: string | null;
  shipping_origin_state?: string | null;
  shipping_origin_zip?: string | null;
};

type EasyPostPackage = {
  height: number;
  length: number;
  weight: number;
  width: number;
};

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function centsToDollarsInput(cents: number) {
  return (Math.max(0, cents) / 100).toFixed(2);
}

function parsePositiveInput(value: FormDataEntryValue | undefined) {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseEasyPostPackages(formData: FormData) {
  const lengths = formData.getAll('package_length');
  const widths = formData.getAll('package_width');
  const heights = formData.getAll('package_height');
  const weights = formData.getAll('package_weight');
  const count = Math.max(lengths.length, widths.length, heights.length, weights.length);
  const packages: EasyPostPackage[] = [];

  for (let index = 0; index < count; index += 1) {
    const lengthInput = cleanText(lengths[index]);
    const widthInput = cleanText(widths[index]);
    const heightInput = cleanText(heights[index]);
    const weightInput = cleanText(weights[index]);
    const anyPresent = Boolean(lengthInput || widthInput || heightInput || weightInput);
    if (!anyPresent) continue;

    const length = parsePositiveInput(lengths[index]);
    const width = parsePositiveInput(widths[index]);
    const height = parsePositiveInput(heights[index]);
    const weight = parsePositiveInput(weights[index]);
    if (!length || !width || !height || !weight) {
      return { error: true, packages: [] as EasyPostPackage[] };
    }
    packages.push({ height, length, weight, width });
  }

  return { error: false, packages };
}

function easyPostOriginFromSettings(settings: ShippingSettingsRow | null | undefined): EasyPostAddressInput | null {
  const name = cleanText(settings?.shipping_origin_name) || cleanText(settings?.shipping_origin_company);
  const street1 = cleanText(settings?.shipping_origin_address1);
  const city = cleanText(settings?.shipping_origin_city);
  const state = cleanText(settings?.shipping_origin_state);
  const zip = cleanText(settings?.shipping_origin_zip);
  if (!name || !street1 || !city || !state || !zip) return null;

  return {
    city,
    company: cleanText(settings?.shipping_origin_company) || null,
    country: cleanText(settings?.shipping_origin_country) || 'US',
    email: cleanText(settings?.shipping_origin_email) || null,
    name,
    phone: cleanText(settings?.shipping_origin_phone) || null,
    state,
    street1,
    street2: cleanText(settings?.shipping_origin_address2) || null,
    zip,
  };
}

function easyPostDestinationFromOrder(order: any): EasyPostAddressInput | null {
  const name = cleanText(order.shipping_name);
  const street1 = cleanText(order.shipping_address1);
  const city = cleanText(order.shipping_city);
  const state = cleanText(order.shipping_state);
  const zip = cleanText(order.shipping_zip);
  if (!name || !street1 || !city || !state || !zip) return null;

  return {
    city,
    country: 'US',
    email: cleanText(order.profiles?.email) || null,
    name,
    state,
    street1,
    street2: cleanText(order.shipping_address2) || null,
    zip,
  };
}

function copyFormValues(source: FormData, target: FormData, name: string) {
  for (const value of source.getAll(name)) {
    target.append(name, value);
  }
}

function ratesFromLabel(label: ShippingLabelRow) {
  const rates = Array.isArray(label.rates_json)
    ? label.rates_json.filter((rate): rate is EasyPostRate => Boolean((rate as EasyPostRate | null)?.id && (rate as EasyPostRate | null)?.rate))
    : [];
  return sortEasyPostRates(rates);
}

function rateSummary(rate: EasyPostRate) {
  const delivery = rate.delivery_days ? `, ${rate.delivery_days} day${rate.delivery_days === 1 ? '' : 's'}` : '';
  return `${rate.carrier ?? 'Carrier'} ${rate.service ?? 'Service'} - ${usd(easyPostRateCents(rate))}${delivery}`;
}

function packageInputsFromLabels(labels: ShippingLabelRow[]): EasyPostPackageInput[] {
  if (!labels.length) return [{}];
  return labels.map((label) => ({
    height: normalizeInventoryNumber(label.package_height_in) || '',
    length: normalizeInventoryNumber(label.package_length_in) || '',
    weight: normalizeInventoryNumber(label.package_weight_oz) || '',
    width: normalizeInventoryNumber(label.package_width_in) || '',
  }));
}

function trackingRowsForEmail(labels: ShippingLabelRow[]) {
  return labels
    .filter((label) => label.status === 'purchased' && label.tracking_code)
    .map((label) => ({
      carrier: label.carrier,
      service: label.service,
      trackingCode: label.tracking_code as string,
    }));
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
  if (!['carrier', 'local_delivery'].includes(fulfillmentMethod)) redirect(`/admin/orders/${id}?toast=fulfillment_required`);
  if (fulfillmentMethod === 'carrier' && shippingCostCents <= 0) redirect(`/admin/orders/${id}?toast=shipping_required`);
  if (fulfillmentMethod === 'local_delivery' && shippingCostCents === 0 && !localDeliveryConfirmed) {
    redirect(`/admin/orders/${id}?toast=local_delivery_confirm_required`);
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id,user_id,center_id,status,archived_at,subtotal_cents,profiles(email)')
    .eq('id', id)
    .single();
  if (!order || order.archived_at) redirect(`/admin/orders/${id}?toast=ship_error`);
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
    const { data: purchasedLabels } = await supabase
      .from('order_shipping_labels')
      .select('carrier,service,status,tracking_code')
      .eq('order_id', id)
      .eq('status', 'purchased');
    await sendShippedEmail(centerEmails.length ? centerEmails : (order as any).profiles.email, items, trackingRowsForEmail((purchasedLabels ?? []) as ShippingLabelRow[]));
  }

  redirect(`/admin/orders/${id}?toast=order_shipped`);
}

async function quoteEasyPostRates(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  await requireAdminWriteAccess(id ? `/admin/orders/${id}?toast=admin_write_denied` : '/admin/orders?toast=admin_write_denied', 'orders');

  if (!env.easypostShippingEnabled || !env.easypostApiKey) redirect(orderToastHref(id, 'easypost_config_required'));

  const parsedPackages = parseEasyPostPackages(formData);
  if (parsedPackages.error || !parsedPackages.packages.length) redirect(`/admin/orders/${id}?toast=easypost_package_required`);

  const supabase = await createClient();
  const [{ data: order }, { data: settings }, { data: purchasedLabels }] = await Promise.all([
    supabase.from('orders').select('id,status,archived_at,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip,profiles(email)').eq('id', id).single(),
    supabase.from('app_settings').select('*').single(),
    supabase.from('order_shipping_labels').select('id').eq('order_id', id).eq('status', 'purchased'),
  ]);
  if (!order || order.archived_at || order.status === 'Shipped') redirect(`/admin/orders/${id}?toast=easypost_rate_error`);
  if ((purchasedLabels ?? []).length) redirect(`/admin/orders/${id}?toast=easypost_labels_exist`);

  const fromAddress = easyPostOriginFromSettings(settings as ShippingSettingsRow | null);
  if (!fromAddress) redirect(`/admin/orders/${id}?toast=easypost_origin_required`);
  const toAddress = easyPostDestinationFromOrder(order);
  if (!toAddress) redirect(`/admin/orders/${id}?toast=easypost_destination_required`);

  await supabase
    .from('order_shipping_labels')
    .delete()
    .eq('order_id', id)
    .in('status', ['quoted', 'error']);

  for (const [index, parcel] of parsedPackages.packages.entries()) {
    const shipmentResult = await createEasyPostShipment({
      fromAddress,
      parcel,
      reference: `Sobrew order ${id} package ${index + 1}`,
      toAddress,
    });
    const rates = sortEasyPostRates(shipmentResult.data?.rates ?? []);
    const insertPayload = {
      easypost_shipment_id: shipmentResult.data?.id ?? null,
      error_message: shipmentResult.error || (!rates.length ? 'No EasyPost rates returned for this package.' : null),
      order_id: id,
      package_height_in: parcel.height,
      package_index: index + 1,
      package_length_in: parcel.length,
      package_weight_oz: parcel.weight,
      package_width_in: parcel.width,
      rates_json: rates,
      raw_response: shipmentResult.data ?? null,
      status: shipmentResult.error || !rates.length ? 'error' : 'quoted',
    };
    const insertResult = await supabase.from('order_shipping_labels').insert(insertPayload);
    if (insertResult.error || shipmentResult.error || !rates.length) {
      redirect(`/admin/orders/${id}?toast=easypost_rate_error`);
    }
  }

  redirect(`/admin/orders/${id}?toast=easypost_rates_ready`);
}

async function buyEasyPostLabelsAndShip(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  await requireAdminWriteAccess(id ? `/admin/orders/${id}?toast=admin_write_denied` : '/admin/orders?toast=admin_write_denied', 'orders');

  if (!env.easypostShippingEnabled || !env.easypostApiKey) redirect(orderToastHref(id, 'easypost_config_required'));

  const supabase = await createClient();
  const { data: order } = await supabase.from('orders').select('id,status,archived_at').eq('id', id).single();
  if (!order || order.archived_at || order.status === 'Shipped') redirect(`/admin/orders/${id}?toast=easypost_purchase_error`);

  const { data: labels } = await supabase
    .from('order_shipping_labels')
    .select('*')
    .eq('order_id', id)
    .in('status', ['quoted', 'error', 'purchased'])
    .order('package_index', { ascending: true });
  const activeLabels = (labels ?? []) as ShippingLabelRow[];
  if (!activeLabels.length) redirect(`/admin/orders/${id}?toast=easypost_rates_required`);

  const labelIds = formData.getAll('easypost_label_id').map((value) => String(value));
  const rateIds = formData.getAll('easypost_rate_id').map((value) => String(value));
  const rateByLabelId = new Map(labelIds.map((labelId, index) => [labelId, rateIds[index] ?? '']));

  for (const label of activeLabels) {
    if (label.status === 'purchased') continue;
    const rateId = rateByLabelId.get(label.id) || label.easypost_rate_id || ratesFromLabel(label)[0]?.id;
    if (!label.easypost_shipment_id || !rateId) {
      await supabase.from('order_shipping_labels').update({
        error_message: 'Choose a rate before buying this label.',
        status: 'error',
        updated_at: new Date().toISOString(),
      }).eq('id', label.id);
      redirect(`/admin/orders/${id}?toast=easypost_purchase_error`);
    }

    const purchaseResult = await buyEasyPostShipment({
      rateId,
      shipmentId: label.easypost_shipment_id,
    });
    if (purchaseResult.error || !purchaseResult.data) {
      await supabase.from('order_shipping_labels').update({
        easypost_rate_id: rateId,
        error_message: purchaseResult.error || 'EasyPost label purchase failed.',
        status: 'error',
        updated_at: new Date().toISOString(),
      }).eq('id', label.id);
      redirect(`/admin/orders/${id}?toast=easypost_purchase_error`);
    }

    const selectedRate = purchaseResult.data.selected_rate ?? ratesFromLabel(label).find((rate) => rate.id === rateId) ?? null;
    const labelCostCents = easyPostRateCents(selectedRate);
    const updateResult = await supabase.from('order_shipping_labels').update({
      carrier: selectedRate?.carrier ?? label.carrier,
      currency: selectedRate?.currency ?? label.currency ?? 'USD',
      easypost_postage_label_id: purchaseResult.data.postage_label?.id ?? null,
      easypost_rate_id: rateId,
      error_message: null,
      label_cost_cents: labelCostCents,
      label_file_type: purchaseResult.data.postage_label?.label_file_type ?? 'PDF',
      label_pdf_url: purchaseResult.data.postage_label?.label_pdf_url ?? purchaseResult.data.postage_label?.label_url ?? null,
      label_url: purchaseResult.data.postage_label?.label_url ?? purchaseResult.data.postage_label?.label_pdf_url ?? null,
      purchased_at: new Date().toISOString(),
      raw_response: purchaseResult.data,
      service: selectedRate?.service ?? label.service,
      status: 'purchased',
      tracking_code: purchaseResult.data.tracking_code ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', label.id);
    if (updateResult.error) {
      console.error('[orders] purchased EasyPost label but failed to update local label row', updateResult.error);
      redirect(`/admin/orders/${id}?toast=easypost_purchase_error`);
    }
  }

  const { data: finalLabels } = await supabase
    .from('order_shipping_labels')
    .select('*')
    .eq('order_id', id)
    .in('status', ['quoted', 'error', 'purchased'])
    .order('package_index', { ascending: true });
  const purchasedLabels = ((finalLabels ?? []) as ShippingLabelRow[]).filter((label) => label.status === 'purchased');
  const unpurchasedLabels = ((finalLabels ?? []) as ShippingLabelRow[]).filter((label) => label.status !== 'purchased');
  if (!purchasedLabels.length || unpurchasedLabels.length) redirect(`/admin/orders/${id}?toast=easypost_purchase_error`);

  const shippingCostCents = purchasedLabels.reduce((sum, label) => sum + Math.round(normalizeInventoryNumber(label.label_cost_cents)), 0);
  if (shippingCostCents <= 0) redirect(`/admin/orders/${id}?toast=easypost_purchase_error`);

  const finalizeFormData = new FormData();
  finalizeFormData.set('id', id);
  finalizeFormData.set('fulfillment_method', 'carrier');
  finalizeFormData.set('shipping_cost', centsToDollarsInput(shippingCostCents));
  finalizeFormData.set('zero_boxes_confirmed', cleanText(formData.get('zero_boxes_confirmed')));
  copyFormValues(formData, finalizeFormData, 'box_inventory_item_id');
  copyFormValues(formData, finalizeFormData, 'box_quantity');

  await shipOrder(finalizeFormData);
}

async function voidEasyPostLabels(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  await requireAdminWriteAccess(id ? `/admin/orders/${id}?toast=admin_write_denied` : '/admin/orders?toast=admin_write_denied', 'orders');

  if (!env.easypostShippingEnabled || !env.easypostApiKey) redirect(orderToastHref(id, 'easypost_config_required'));

  const supabase = await createClient();
  const { data: order } = await supabase.from('orders').select('id,status,archived_at').eq('id', id).single();
  if (!order || order.archived_at || order.status === 'Shipped') redirect(`/admin/orders/${id}?toast=easypost_void_error`);

  const { data: labels } = await supabase
    .from('order_shipping_labels')
    .select('id,carrier,tracking_code,status')
    .eq('order_id', id)
    .eq('status', 'purchased');
  const purchasedLabels = ((labels ?? []) as ShippingLabelRow[]).filter((label) => label.carrier && label.tracking_code);
  if (!purchasedLabels.length) redirect(`/admin/orders/${id}?toast=easypost_void_error`);

  const labelsByCarrier = new Map<string, ShippingLabelRow[]>();
  for (const label of purchasedLabels) {
    const carrier = label.carrier as string;
    labelsByCarrier.set(carrier, [...(labelsByCarrier.get(carrier) ?? []), label]);
  }

  for (const [carrier, carrierLabels] of labelsByCarrier.entries()) {
    const refundResult = await refundEasyPostLabels({
      carrier,
      trackingCodes: carrierLabels.map((label) => label.tracking_code as string),
    });
    if (refundResult.error) {
      redirect(`/admin/orders/${id}?toast=easypost_void_error`);
    }
    await supabase.from('order_shipping_labels').update({
      easypost_refund_id: refundResult.data?.refunds?.[0]?.id ?? null,
      status: 'voided',
      updated_at: new Date().toISOString(),
      voided_at: new Date().toISOString(),
    }).in('id', carrierLabels.map((label) => label.id));
  }

  redirect(`/admin/orders/${id}?toast=easypost_labels_voided`);
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
    labelsResult,
    settingsResult,
  ] = await Promise.all([
    supabase.from('order_items').select('id,qty,product_id,product_name_snapshot,shipping_boxes_used,cogs_product_cents,cogs_shipping_cents,cogs_processing_fee_cents,cogs_donation_cents,cogs_total_cents,cogs_source,cogs_estimated,cogs_snapshot_at,products(name,shipping_box_count_required)').eq('order_id', order.id),
    supabase.from('order_item_shipping_boxes').select('order_item_id,inventory_item_id,quantity,total_cost_cents,cogs_estimated,inventory_items(name,sku)').eq('order_id', order.id),
    supabase.from('inventory_items').select('id,name,sku').eq('item_type', 'material_supply').eq('active', true).or('sku.ilike.BOX-%,name.ilike.%box%').order('name', { ascending: true }),
    supabase.from('order_shipping_labels').select('*').eq('order_id', order.id).order('package_index', { ascending: true }).order('created_at', { ascending: true }),
    supabase.from('app_settings').select('*').single(),
  ]);
  const items = itemsResult.data ?? [];
  const shippingBoxUsages = shippingBoxUsagesResult.error ? [] : (shippingBoxUsagesResult.data ?? []);
  const boxItems = boxItemsResult.error ? [] : (boxItemsResult.data ?? []);
  const shippingLabels = labelsResult.error ? [] : ((labelsResult.data ?? []) as ShippingLabelRow[]);
  const easyPostShippingEnabled = env.easypostShippingEnabled;
  const activeShippingLabels = easyPostShippingEnabled ? shippingLabels.filter((label) => label.status !== 'voided') : [];
  const purchasedShippingLabels = activeShippingLabels.filter((label) => label.status === 'purchased');
  const unpurchasedShippingLabels = activeShippingLabels.filter((label) => label.status !== 'purchased');
  const hasPurchasedEasyPostLabels = purchasedShippingLabels.length > 0;
  const canQuoteEasyPost = Boolean(easyPostShippingEnabled && env.easypostApiKey && easyPostOriginFromSettings(settingsResult.data as ShippingSettingsRow | null));
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
      {toast === 'fulfillment_required' ? <StatusToast message="Choose carrier shipping or local delivery before marking this order shipped." tone="error" /> : null}
      {toast === 'local_delivery_confirm_required' ? <StatusToast message="Confirm this was a local delivery before recording $0.00 shipping." tone="error" /> : null}
      {toast === 'zero_boxes_local_delivery_required' ? <StatusToast message="0 boxes is only allowed when fulfillment method is Local delivery." tone="error" /> : null}
      {toast === 'zero_boxes_confirm_required' ? <StatusToast message="Confirm this local delivery has 0 boxes before marking it shipped." tone="error" /> : null}
      {toast === 'box_count_required' ? <StatusToast message="Product box size and quantity are required unless this is a confirmed local delivery with 0 boxes." tone="error" /> : null}
      {toast === 'box_inventory_required' ? <StatusToast message="Create or receive an active box material before shipping this order." tone="error" /> : null}
      {toast === 'order_shipped' ? <StatusToast message="Order shipped, COGS recorded, and customer email sent." tone="success" /> : null}
      {toast === 'ship_error' ? <StatusToast message="Unable to ship this order." tone="error" /> : null}
      {toast === 'easypost_config_required' ? <StatusToast message="EasyPost labels are not enabled in this environment." tone="error" /> : null}
      {toast === 'easypost_origin_required' ? <StatusToast message="Add the EasyPost ship-from address in Settings before buying labels." tone="error" /> : null}
      {toast === 'easypost_destination_required' ? <StatusToast message="This order is missing a complete shipping destination." tone="error" /> : null}
      {toast === 'easypost_package_required' ? <StatusToast message="Enter length, width, height, and weight for every package." tone="error" /> : null}
      {toast === 'easypost_rate_error' ? <StatusToast message="Unable to get EasyPost rates for one or more packages." tone="error" /> : null}
      {toast === 'easypost_rates_ready' ? <StatusToast message="EasyPost rates are ready. Choose rates and buy labels to ship the order." tone="success" /> : null}
      {toast === 'easypost_rates_required' ? <StatusToast message="Get EasyPost rates before buying labels." tone="error" /> : null}
      {toast === 'easypost_purchase_error' ? <StatusToast message="Unable to buy every EasyPost label. The order is still processing." tone="error" /> : null}
      {toast === 'easypost_labels_exist' ? <StatusToast message="Void the purchased EasyPost labels before quoting a new package set." tone="error" /> : null}
      {toast === 'easypost_labels_voided' ? <StatusToast message="EasyPost labels voided. You can quote new labels now." tone="success" /> : null}
      {toast === 'easypost_void_error' ? <StatusToast message="Unable to void EasyPost labels." tone="error" /> : null}
      {toast === 'archive_success' ? <StatusToast message="Order archived." tone="success" /> : null}
      {toast === 'archive_error' ? <StatusToast message="Unable to archive this order." tone="error" /> : null}
      {toast === 'archive_denied' ? <StatusToast message="Only superadmins can archive orders." tone="error" /> : null}
      {toast === 'delete_error' ? <StatusToast message="Unable to delete this order." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="You do not have permission to edit orders." tone="error" /> : null}
      <section className="panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="eyebrow">Order Detail</span>
          <OrderStatusBadge status={order.status} />
        </div>
        <h1 className="page-title mt-4">Order overview</h1>
        <p className="page-subtitle mt-3">Update fulfillment status, verify shipping details, and review the ordered products below.</p>
        <p className="mt-4 break-words text-sm font-medium text-slate-600">Center {order.centers?.name || 'Unknown center'}</p>
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
        <p className="mt-3 text-lg font-semibold text-slate-950">{order.shipping_name}</p>
        <p className="mt-2 text-sm text-slate-600">{order.shipping_address1}, {order.shipping_city}</p>
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
        {purchasedShippingLabels.length ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm text-slate-600">
            <p className="font-semibold text-slate-950">EasyPost labels</p>
            <div className="mt-3 space-y-3">
              {purchasedShippingLabels.map((label) => (
                <div key={label.id} className="flex flex-col gap-2 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-950">Package {normalizeInventoryNumber(label.package_index)} - {label.carrier || 'Carrier'} {label.service || ''}</p>
                    <p className="mt-1">Tracking: {label.tracking_code || 'Pending'}</p>
                    <p className="mt-1">Cost: {usd(Math.round(normalizeInventoryNumber(label.label_cost_cents)))}</p>
                  </div>
                  {label.label_pdf_url || label.label_url ? (
                    <a className="btn-secondary w-full sm:w-auto" href={label.label_pdf_url || label.label_url || '#'} target="_blank" rel="noreferrer">Print label</a>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
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
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Buy labels and record shipping COGS</h2>
            <p className="mt-2 text-sm text-slate-500">{easyPostShippingEnabled ? 'Use EasyPost for carrier labels, or fall back to manual shipping COGS and local delivery.' : 'Record carrier shipping COGS or local delivery.'}</p>
          </div>

          {easyPostShippingEnabled && !canQuoteEasyPost ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
              <p>Add an EasyPost API key and shipping origin in Settings to quote and buy labels from this page.</p>
              <a className="mt-3 inline-flex font-semibold text-amber-950 underline decoration-amber-300 underline-offset-4" href="/admin/settings">Open Settings</a>
            </div>
          ) : null}

          {easyPostShippingEnabled && !hasPurchasedEasyPostLabels ? (
            <form action={quoteEasyPostRates} className="space-y-4 rounded-2xl border border-slate-200 bg-white/55 p-4">
              <input type="hidden" name="id" value={order.id} />
              <div>
                <p className="font-semibold text-slate-950">EasyPost packages</p>
                <p className="mt-1 text-sm text-slate-500">Add every package for this order. The order will ship only after every package label is purchased.</p>
              </div>
              <EasyPostPackageFields initialPackages={packageInputsFromLabels(activeShippingLabels)} />
              <PendingSubmitButton
                className="btn-primary w-full sm:w-auto"
                disabled={!canQuoteEasyPost}
                disabledLabel="EasyPost setup needed"
                label={activeShippingLabels.length ? 'Requote EasyPost rates' : 'Get EasyPost rates'}
                pendingLabel="Getting rates..."
              />
            </form>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white/55 p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-950">EasyPost labels purchased</p>
              <p className="mt-1">Finish buying any remaining labels, or void the purchased labels before quoting a new package set.</p>
            </div>
          )}

          {easyPostShippingEnabled && activeShippingLabels.length ? (
            <form action={buyEasyPostLabelsAndShip} className="space-y-4 rounded-2xl border border-slate-200 bg-white/55 p-4">
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="fulfillment_method" value="carrier" />
              <input type="hidden" name="zero_boxes_confirmed" value="" />
              <div>
                <p className="font-semibold text-slate-950">EasyPost rates and labels</p>
                <p className="mt-1 text-sm text-slate-500">Choose a rate for each package. All packages must have purchased labels before this order is marked shipped.</p>
              </div>
              <div className="space-y-3">
                {activeShippingLabels.map((label) => {
                  const rates = ratesFromLabel(label);
                  const selectedRateId = label.easypost_rate_id || rates[0]?.id || '';
                  return (
                    <div key={label.id} className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-600">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-slate-950">Package {normalizeInventoryNumber(label.package_index)}</p>
                          <p className="mt-1">
                            {normalizeInventoryNumber(label.package_length_in)} x {normalizeInventoryNumber(label.package_width_in)} x {normalizeInventoryNumber(label.package_height_in)} in, {normalizeInventoryNumber(label.package_weight_oz)} oz
                          </p>
                          {label.error_message ? <p className="mt-1 font-semibold text-rose-700">{label.error_message}</p> : null}
                        </div>
                        <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                          label.status === 'purchased' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : label.status === 'error' ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-100' : 'bg-teal-50 text-teal-700 ring-1 ring-teal-100'
                        }`}>
                          {label.status}
                        </span>
                      </div>
                      {label.status === 'purchased' ? (
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="font-semibold text-slate-950">{label.carrier} {label.service} - {usd(Math.round(normalizeInventoryNumber(label.label_cost_cents)))}</p>
                          {label.label_pdf_url || label.label_url ? <a className="btn-secondary w-full sm:w-auto" href={label.label_pdf_url || label.label_url || '#'} target="_blank" rel="noreferrer">Print label</a> : null}
                        </div>
                      ) : rates.length ? (
                        <label className="mt-3 block space-y-2 font-medium text-slate-700">
                          Rate
                          <input type="hidden" name="easypost_label_id" value={label.id} />
                          <select className="input" name="easypost_rate_id" defaultValue={selectedRateId} required>
                            {rates.map((rate) => (
                              <option key={rate.id} value={rate.id}>{rateSummary(rate)}</option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <p className="mt-3 text-rose-700">No rates available for this package. Requote the package set.</p>
                      )}
                    </div>
                  );
                })}
              </div>
              {productBoxRequiredLines.length ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-slate-950">Product Boxes</p>
                  <ProductBoxUsageFields boxItems={productBoxOptions} recipeBoxCoveredLabels={recipeBoxCoveredLabels} requiredLines={productBoxRequiredLines} />
                </div>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <ShipOrderSubmitButton
                  className="btn-primary w-full sm:w-auto"
                  hasRequiredBoxLines={productBoxRequiredLines.length > 0}
                  label={unpurchasedShippingLabels.length ? 'Buy labels & mark shipped' : 'Finish marking shipped'}
                  pendingLabel="Buying labels..."
                />
              </div>
            </form>
          ) : null}

          {easyPostShippingEnabled && hasPurchasedEasyPostLabels ? (
            <form action={voidEasyPostLabels} className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
              <input type="hidden" name="id" value={order.id} />
              <p className="text-sm font-semibold text-rose-800">Need to start over?</p>
              <p className="mt-1 text-sm text-rose-700">Void the purchased EasyPost labels before quoting a different package set. Only use this while the order is still processing.</p>
              <PendingSubmitButton className="mt-3 w-full rounded-full border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50 sm:w-auto" label="Void purchased labels" pendingLabel="Voiding..." />
            </form>
          ) : null}

          <div className="rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm text-slate-600">
            <p className="font-semibold text-slate-950">Processing fee COGS: {usd(processingFeePreviewCents)}</p>
            <p className="mt-1">Auto-calculated at 2.99% + $0.30 for this order.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm text-slate-600">
            <p className="font-semibold text-slate-950">Donation COGS: {usd(donationCogsPreviewCents)}</p>
            <p className="mt-1">Auto-calculated at 1% of this order subtotal.</p>
          </div>

          <details className="rounded-2xl border border-slate-200 bg-white/55 p-4" open={!canQuoteEasyPost}>
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
