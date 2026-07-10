import type {
  PortalRecentOrder,
  PortalRecurringSummary,
  PortalRestockProduct,
} from '@/components/portal-restock-workspace';
import { nextRecurringOrderDate } from '@/lib/recurring';
import { usd } from '@/lib/utils';

export type PortalProductRow = {
  product_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  category: string | null;
  current_price_cents: number;
};

export type RecentOrderItemRow = {
  id: string;
  product_id: string;
  product_name_snapshot: string | null;
  qty: number;
  unit_price_cents: number | null;
};

export type RecentOrderRow = {
  id: string;
  subtotal_cents: number;
  created_at: string | null;
  order_items: RecentOrderItemRow[] | null;
};

export type RecurringOrderRow = {
  frequency: string;
  created_at: string | null;
  last_generated_at: string | null;
};

export type PortalRestockData = {
  products: PortalRestockProduct[];
  recentOrder: PortalRecentOrder | null;
  recurringSummary: PortalRecurringSummary;
};

const shortDateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

function formatShortDate(value: string | null | undefined) {
  if (!value) return 'recently';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'recently' : shortDateFormatter.format(date);
}

export function buildPortalRestockData({
  productRows,
  recentOrder,
  recurringOrderRows,
}: {
  productRows: PortalProductRow[];
  recentOrder: RecentOrderRow | null;
  recurringOrderRows: RecurringOrderRow[];
}): PortalRestockData {
  const products: PortalRestockProduct[] = productRows.map((product) => ({
    product_id: product.product_id,
    name: product.name,
    description: product.description,
    image_url: product.image_url,
    category: product.category,
    price_cents: product.current_price_cents,
  }));
  const currentProductMap = new Map(productRows.map((product) => [product.product_id, product]));

  const validOrderItems = (recentOrder?.order_items ?? []).filter(
    (item) => Number.isInteger(item.qty) && item.qty > 0
  );
  const availableItems = validOrderItems.flatMap((item) => {
    const product = currentProductMap.get(item.product_id);
    if (!product) return [];
    return [{
      product_id: item.product_id,
      name: product.name,
      price_cents: product.current_price_cents,
      qty: item.qty,
    }];
  });
  const availableItemCount = availableItems.reduce((sum, item) => sum + item.qty, 0);
  const originalItemCount = validOrderItems.reduce((sum, item) => sum + item.qty, 0);
  const reorderSubtotalCents = availableItems.reduce(
    (sum, item) => sum + item.qty * item.price_cents,
    0
  );
  const historicalSubtotalCents = Math.max(0, Math.trunc(Number(recentOrder?.subtotal_cents) || 0));

  const recentOrderSummary: PortalRecentOrder | null = recentOrder
    ? {
        createdAtLabel: formatShortDate(recentOrder.created_at),
        historicalSubtotalLabel: usd(historicalSubtotalCents),
        itemCount: availableItemCount,
        items: availableItems,
        reorderSubtotalLabel: usd(reorderSubtotalCents),
        reorderTotalChanged: reorderSubtotalCents !== historicalSubtotalCents,
        unavailableItemCount: Math.max(0, originalItemCount - availableItemCount),
      }
    : null;

  const nextDates = recurringOrderRows
    .map((order) => nextRecurringOrderDate(order.frequency, order.last_generated_at ?? order.created_at))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.getTime() - right.getTime());

  return {
    products,
    recentOrder: recentOrderSummary,
    recurringSummary: {
      activeCount: recurringOrderRows.length,
      nextDateLabel: nextDates[0] ? shortDateFormatter.format(nextDates[0]) : null,
    },
  };
}
