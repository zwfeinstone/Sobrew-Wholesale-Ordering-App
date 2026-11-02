import 'server-only';

import { getShopifyConfig, shopifyGraphQL } from '@/lib/shopify';
import { receiveShopifyOrder } from '@/lib/shopify-import';

export type ShopifyOrderBackfillResult = {
  name: string;
  status: 'imported' | 'ignored' | 'error';
  orderId?: string;
  error?: string;
};

type Money = { shopMoney: { amount: string; currencyCode: string } };
type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  email: string | null;
  note: string | null;
  test: boolean;
  cancelledAt: string | null;
  currencyCode: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  currentSubtotalPriceSet: Money;
  shippingAddress: {
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    provinceCode: string | null;
    zip: string | null;
    countryCodeV2: string | null;
  } | null;
  lineItems: {
    pageInfo: { hasNextPage: boolean };
    nodes: Array<{
      id: string;
      name: string;
      title: string;
      sku: string | null;
      quantity: number;
      currentQuantity: number;
      unfulfilledQuantity: number;
      requiresShipping: boolean;
      variant: { id: string } | null;
      product: { id: string } | null;
      originalUnitPriceSet: Money;
      discountAllocations: Array<{ allocatedAmountSet: Money }>;
    }>;
  };
};

// API 2026-10: discountAllocations includes order-level allocations. The line's
// totalDiscountSet excludes them, so it cannot reconstruct the webhook subtotal.
const NAMED_ORDER_QUERY = `query PortalNamedOrderImport($query: String!) {
  orders(first: 2, query: $query) {
    pageInfo { hasNextPage }
    nodes {
      id name createdAt email note test cancelledAt currencyCode
      displayFinancialStatus displayFulfillmentStatus
      currentSubtotalPriceSet { shopMoney { amount currencyCode } }
      shippingAddress { name firstName lastName company address1 address2 city province provinceCode zip countryCodeV2 }
      lineItems(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          id name title sku quantity currentQuantity unfulfilledQuantity requiresShipping
          variant { id } product { id }
          originalUnitPriceSet { shopMoney { amount currencyCode } }
          discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
        }
      }
    }
  }
}`;

function requestedNames(input: string): string[] {
  if (typeof input !== 'string' || input.length > 2000) throw new Error('Enter up to 10 Shopify order numbers, such as #1160.');
  const names = input.trim().split(/[\s,]+/).filter(Boolean);
  if (!names.length || names.some(name => !/^#[0-9]{1,30}$/.test(name))) {
    throw new Error('Use complete Shopify order numbers such as #1160, separated by commas or spaces.');
  }
  const uniqueNames = [...new Set(names)];
  if (uniqueNames.length > 10) throw new Error('Import at most 10 Shopify orders at a time.');
  return uniqueNames;
}

function usdAmount(money: Money, label: string): string {
  if (money?.shopMoney?.currencyCode !== 'USD') throw new Error(`${label} must be in USD.`);
  const amount = money.shopMoney.amount;
  if (typeof amount !== 'string' || !/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error(`${label} has an invalid USD amount.`);
  return amount;
}

function webhookPayload(order: ShopifyOrder) {
  // An unpaid snapshot must never occupy the immutable orders/paid inbox: its
  // later real paid webhook needs to save the new, eligible order snapshot.
  if (order.displayFinancialStatus !== 'PAID') throw new Error('Only fully paid orders can be imported.');
  if (order.test !== false) throw new Error('Test orders or orders with an unknown test status cannot be imported.');
  if (order.cancelledAt) throw new Error('Cancelled orders cannot be imported.');
  if (order.currencyCode !== 'USD') throw new Error('Only USD orders are supported. Review this order in Shopify.');
  if (!order.lineItems || order.lineItems.pageInfo?.hasNextPage !== false || order.lineItems.nodes.length > 100) {
    throw new Error('Orders with more than 100 line items need manual review.');
  }
  if (order.displayFulfillmentStatus !== 'UNFULFILLED') {
    throw new Error('Only wholly unfulfilled orders can be imported. Review this order in Shopify.');
  }
  const address = order.shippingAddress;
  return {
    admin_graphql_api_id: order.id,
    name: order.name,
    created_at: order.createdAt,
    email: order.email,
    note: order.note,
    test: order.test,
    cancelled_at: order.cancelledAt,
    currency: order.currencyCode,
    financial_status: order.displayFinancialStatus.toLowerCase(),
    fulfillment_status: null,
    current_subtotal_price: usdAmount(order.currentSubtotalPriceSet, 'Order subtotal'),
    shipping_address: address ? {
      name: address.name, first_name: address.firstName, last_name: address.lastName,
      company: address.company, address1: address.address1, address2: address.address2,
      city: address.city, province: address.province, province_code: address.provinceCode,
      zip: address.zip, country_code: address.countryCodeV2,
    } : null,
    line_items: order.lineItems.nodes.map(line => {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0 || line.currentQuantity !== line.quantity
        || line.unfulfilledQuantity !== line.quantity) {
        throw new Error('Edited, refunded, or partially fulfilled Shopify items need manual review.');
      }
      return {
        admin_graphql_api_id: line.id,
        name: line.name,
        title: line.title,
        sku: line.sku,
        variant_id: line.variant?.id ?? null,
        product_id: line.product?.id ?? null,
        quantity: line.quantity,
        current_quantity: line.currentQuantity,
        fulfillable_quantity: line.unfulfilledQuantity,
        requires_shipping: line.requiresShipping,
        fulfillment_status: null,
        price: usdAmount(line.originalUnitPriceSet, 'Item price'),
        discount_allocations: line.discountAllocations.map(allocation => ({
          amount: usdAmount(allocation.allocatedAmountSet, 'Item discount'),
        })),
      };
    }),
  };
}

/** Call only after authorizing Orders edit access. Reads only the exact requested orders. */
export async function importShopifyOrdersByNames(input: string): Promise<ShopifyOrderBackfillResult[]> {
  // Validate the entire request before making any API call or importing any order.
  const names = requestedNames(input);
  const shopDomain = getShopifyConfig().shopDomain;
  if (!shopDomain) throw new Error('The Shopify store is not configured.');
  const results: ShopifyOrderBackfillResult[] = [];
  for (const name of names) {
    try {
      const data = await shopifyGraphQL<{ orders: { nodes: ShopifyOrder[]; pageInfo: { hasNextPage: boolean } } }>(
        NAMED_ORDER_QUERY, { query: `name:"${name}"` }
      );
      if (!data.orders || data.orders.pageInfo?.hasNextPage !== false) {
        throw new Error('Shopify returned an incomplete or ambiguous order search. No order was imported.');
      }
      const exactMatches = data.orders.nodes.filter(order => order.name === name);
      if (exactMatches.length !== 1) {
        throw new Error(exactMatches.length ? 'Multiple Shopify orders match this exact name. No order was imported.' : 'This exact order was not found or is outside the app’s permitted order history.');
      }
      // Manual imports use the existing durable orders/paid inbox and its atomic
      // deduplication, eligibility, catalog mapping, and prepaid billing protections.
      const result = await receiveShopifyOrder(webhookPayload(exactMatches[0]), shopDomain, 'orders/paid');
      results.push({ name, status: result.status, orderId: result.orderId, error: result.error });
    } catch (error) {
      results.push({ name, status: 'error', error: error instanceof Error ? error.message.slice(0, 500) : 'Shopify import failed. Retry this order.' });
    }
  }
  return results;
}
