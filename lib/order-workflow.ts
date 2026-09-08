export type OrderAddress = {
  shipping_name?: string | null;
  shipping_company?: string | null;
  shipping_address1?: string | null;
  shipping_address2?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_zip?: string | null;
};

export function missingOrderAddressFields(order: OrderAddress): string[] {
  const fields: Array<[string, string | null | undefined]> = [
    ['Recipient', order.shipping_name?.trim() || order.shipping_company], ['Street address', order.shipping_address1],
    ['City', order.shipping_city], ['State', order.shipping_state], ['ZIP', order.shipping_zip],
  ];
  return fields.filter(([, value]) => !value?.trim()).map(([label]) => label);
}

export function orderAddressLabel(order: OrderAddress) {
  return [order.shipping_address1, order.shipping_address2, order.shipping_city, order.shipping_state, order.shipping_zip]
    .map((value) => value?.trim()).filter(Boolean).join(', ');
}

export function nextOrderAction(status: string | null | undefined) {
  return status === 'Shipped' ? 'View order' : 'Review order';
}

export function orderActivityLabel(action: string) {
  const labels: Record<string, string> = {
    received: 'Order received', moved_to_trash: 'Moved to recently deleted', restored: 'Order restored',
    status_updated: 'Status updated', notes_updated: 'Delivery notes updated', delivery_updated: 'Delivery address updated',
    archived: 'Order archived', unarchived: 'Order returned to active orders',
  };
  return labels[action] ?? 'Order updated';
}
