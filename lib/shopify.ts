import 'server-only';

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { parseShipmentTrackingNumbers } from '@/lib/shipment-tracking';

// Pin the schema used by these queries; do not silently follow Shopify's latest API.
const SHOPIFY_API_VERSION = '2026-10';
const SYNC_LEASE_MS = 5 * 60 * 1000;

export function getShopifyConfig() {
  const domain = (process.env.SHOPIFY_SHOP_DOMAIN ?? '').trim().toLowerCase();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET ?? '').trim();
  return {
    shopDomain: /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) ? domain : '',
    accessToken: (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? '').trim(),
    clientId: (process.env.SHOPIFY_CLIENT_ID ?? '').trim(),
    clientSecret,
    webhookSecret: (process.env.SHOPIFY_WEBHOOK_SECRET ?? '').trim() || clientSecret,
    apiVersion: SHOPIFY_API_VERSION,
  };
}

export function hasShopifyConfiguration() {
  const config = getShopifyConfig();
  return Boolean(config.shopDomain && (config.accessToken || (config.clientId && config.clientSecret)));
}

let tokenCache: { key: string; token: string; expiresAt: number } | null = null;
let tokenRequest: { key: string; promise: Promise<string> } | null = null;

async function shopifyAccessToken(config: ReturnType<typeof getShopifyConfig>): Promise<string> {
  if (!config.clientId || !config.clientSecret) return config.accessToken;
  const key = createHash('sha256').update(JSON.stringify([config.shopDomain, config.clientId, config.clientSecret])).digest('hex');
  if (tokenCache?.key === key && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  if (tokenRequest?.key === key) return tokenRequest.promise;
  const promise = (async () => {
    let response: Response;
    try {
      response = await fetch(`https://${config.shopDomain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret }),
        cache: 'no-store', signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error('Shopify authentication did not respond. Retry the sync.');
    }
    if (!response.ok) throw new Error(`Shopify authentication failed (HTTP ${response.status}). Check the app credentials and install the app on this store.`);
    const result = await response.json() as { access_token?: string; expires_in?: number };
    if (!result.access_token || !Number.isFinite(result.expires_in) || Number(result.expires_in) <= 0) throw new Error('Shopify authentication returned an invalid token response.');
    tokenCache = { key, token: result.access_token, expiresAt: Date.now() + Number(result.expires_in) * 1000 };
    return result.access_token;
  })();
  tokenRequest = { key, promise };
  try { return await promise; }
  finally { if (tokenRequest?.promise === promise) tokenRequest = null; }
}

export function verifyShopifyWebhook(rawBody: string, signature: string | null): boolean {
  const { webhookSecret } = getShopifyConfig();
  if (!webhookSecret || !signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest();
  const supplied = Buffer.from(signature, 'base64');
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}

type ImportedLine = { line_item_id: string; quantity: number; product_id?: string };
type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean } };
type RemoteLine = { id: string; currentQuantity: number; unfulfilledQuantity: number; requiresShipping: boolean };
type RemoteFulfillment = { id: string; status: string; trackingInfo: Array<{ number: string | null }> };
type RemoteFulfillmentOrder = {
  id: string;
  status: string;
  supportedActions: Array<{ action: string }>;
};
type RemoteOrder = {
  id: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  shippingAddress: {
    name: string | null; company: string | null; address1: string | null; address2: string | null;
    city: string | null; provinceCode: string | null; province: string | null; zip: string | null; countryCodeV2: string | null;
  } | null;
  lineItems: Connection<RemoteLine>;
  fulfillmentOrders: Connection<RemoteFulfillmentOrder>;
  fulfillments: RemoteFulfillment[];
};
type FulfillmentLines = Connection<{ id: string; remainingQuantity: number; lineItem: { id: string } }>;
type FulfillmentInputLine = { fulfillmentOrderId: string; fulfillmentOrderLineItems: Array<{ id: string; quantity: number }> };
type MutationResult = { fulfillment: { id: string; status: string } | null; userErrors: Array<{ message: string }> };
type ShopifyOrderRow = {
  id: string;
  status: string;
  archived_at: string | null;
  order_source: string;
  fulfillment_method: string | null;
  shipping_cost_cents: number;
  shipping_tracking_numbers: string[];
  shipping_name: string | null;
  shipping_company: string | null;
  shipping_address1: string | null;
  shipping_address2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
  shipping_country: string | null;
  shopify_shop_domain: string | null;
  shopify_order_id: string | null;
  shopify_line_items: unknown;
  shopify_fulfillment_id: string | null;
  shopify_sync_status: 'pending' | 'syncing' | 'synced' | 'error' | null;
  shopify_sync_started_at: string | null;
  shopify_sync_token: string | null;
  order_items: Array<{ product_id: string | null; qty: number }>;
};

const ORDER_QUERY = `query PortalShopifyOrder($id: ID!) {
  order(id: $id) {
    id cancelledAt displayFinancialStatus
    shippingAddress { name company address1 address2 city provinceCode province zip countryCodeV2 }
    lineItems(first: 100) { nodes { id currentQuantity unfulfilledQuantity requiresShipping } pageInfo { hasNextPage } }
    fulfillmentOrders(first: 100) {
      nodes { id status supportedActions { action } }
      pageInfo { hasNextPage }
    }
    fulfillments { id status trackingInfo { number } }
  }
}`;

export async function shopifyGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const config = getShopifyConfig();
  if (!hasShopifyConfiguration()) throw new Error('Shopify connection is not configured. Add the shop domain and app credentials or an Admin API access token.');
  const accessToken = await shopifyAccessToken(config);
  // Catalog reads can briefly exhaust Shopify's cost bucket. Retry only explicit
  // queries: a mutation's uncertain response must go through its recovery path.
  const readOnly = /^\s*query\b/.test(query);
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        body: JSON.stringify({ query, variables }),
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error('Shopify did not respond. Retry the Shopify sync; the portal will check for an existing fulfillment first.');
    }
    if (!response.ok) {
      if (response.status === 401) tokenCache = null;
      if (readOnly && response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get('Retry-After')) * 1000;
        await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(250, retryAfter || 1000 * (attempt + 1)))));
        continue;
      }
      throw new Error(`Shopify request failed (HTTP ${response.status}). Check the connection and retry the Shopify sync.`);
    }
    const result = await response.json() as {
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
      extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable: number; restoreRate: number } } };
    };
    if (result.errors?.length) {
      if (readOnly && attempt < 2 && result.errors.every((error) => error.extensions?.code === 'THROTTLED')) {
        const cost = result.extensions?.cost;
        const available = cost?.throttleStatus;
        const delay = available && available.restoreRate > 0 && typeof cost?.requestedQueryCost === 'number'
          ? (cost.requestedQueryCost - available.currentlyAvailable) / available.restoreRate * 1000 + 100
          : 1000 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(250, delay))));
        continue;
      }
      throw new Error(`Shopify: ${result.errors.map((error) => error.message).join('; ').slice(0, 800)}`);
    }
    if (!result.data) throw new Error('Shopify returned an empty response. Retry the Shopify sync.');
    return result.data;
  }
}

const SHOPIFY_REQUIRED_SCOPES = [
  'read_orders', 'read_products', 'read_merchant_managed_fulfillment_orders', 'write_merchant_managed_fulfillment_orders',
] as const;

export async function getShopifyConnection() {
  const data = await shopifyGraphQL<{
    shop: { name: string; myshopifyDomain: string };
    currentAppInstallation: { accessScopes: Array<{ handle: string }> } | null;
  }>(`query PortalShopifyConnection {
    shop { name myshopifyDomain }
    currentAppInstallation { accessScopes { handle } }
  }`);
  if (!data.currentAppInstallation) throw new Error('Install the Shopify app on this store before connecting.');
  const scopes = data.currentAppInstallation.accessScopes.map((scope) => scope.handle);
  // Shopify write scopes also grant the corresponding read access.
  const missingScopes = SHOPIFY_REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope)
    && !(scope.startsWith('read_') && scopes.includes(scope.replace(/^read_/, 'write_'))));
  return { shopDomain: data.shop.myshopifyDomain, shopName: data.shop.name, scopes, missingScopes };
}

function shopifyWebhookBaseUrl(value: string) {
  const invalid = () => new Error('Set NEXT_PUBLIC_SITE_URL to the public HTTPS portal URL before registering Shopify webhooks.');
  let candidate: URL;
  let configured: URL;
  try {
    candidate = new URL(value);
    configured = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? '');
  } catch { throw invalid(); }
  const host = candidate.hostname.replace(/^\[|\]$/g, '');
  if (candidate.protocol !== 'https:' || configured.protocol !== 'https:' || candidate.origin !== configured.origin
    || candidate.username || candidate.password || candidate.port || candidate.search || candidate.hash || candidate.pathname !== '/'
    || configured.username || configured.password || configured.search || configured.hash || configured.pathname !== '/'
    || isIP(host) || !host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local')) throw invalid();
  return candidate.origin;
}

type ShopifyWebhookSubscription = { id: string; topic: string; uri: string; format: string; filter: string | null; includeFields: string[] };
const SHOPIFY_WEBHOOKS = [
  { topic: 'ORDERS_PAID', path: '/api/webhooks/shopify/orders' },
  { topic: 'PRODUCTS_CREATE', path: '/api/webhooks/shopify/products' },
  { topic: 'PRODUCTS_UPDATE', path: '/api/webhooks/shopify/products' },
] as const;

async function listShopifyWebhooks() {
  const subscriptions: ShopifyWebhookSubscription[] = [];
  let after: string | null = null;
  do {
    const data: { webhookSubscriptions: { nodes: ShopifyWebhookSubscription[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await shopifyGraphQL(`query PortalShopifyWebhooks($after: String, $topics: [WebhookSubscriptionTopic!]) {
      webhookSubscriptions(first: 100, after: $after, topics: $topics) {
        nodes { id topic uri format filter includeFields }
        pageInfo { hasNextPage endCursor }
      }
    }`, { after, topics: SHOPIFY_WEBHOOKS.map((entry) => entry.topic) });
    subscriptions.push(...data.webhookSubscriptions.nodes);
    const page = data.webhookSubscriptions.pageInfo;
    if (!page.hasNextPage) break;
    if (!page.endCursor || page.endCursor === after) throw new Error('Shopify webhook pagination could not be completed. Retry setup.');
    after = page.endCursor;
  } while (after);
  return subscriptions;
}

export async function registerShopifyWebhooks(baseUrl: string) {
  const origin = shopifyWebhookBaseUrl(baseUrl);
  const config = getShopifyConfig();
  if (!config.webhookSecret) throw new Error('Configure the Shopify app client secret or webhook secret before registering webhooks.');
  if (config.clientSecret && config.webhookSecret !== config.clientSecret) {
    throw new Error('Automatic Shopify webhooks use the app client secret. Remove SHOPIFY_WEBHOOK_SECRET or set it to the same value as SHOPIFY_CLIENT_SECRET before registering webhooks.');
  }
  const connection = await getShopifyConnection();
  if (connection.missingScopes.length) throw new Error(`Add these Shopify app permissions and reinstall the app: ${connection.missingScopes.join(', ')}.`);
  const subscriptions = await listShopifyWebhooks();
  let registered = 0;
  let existing = 0;
  let updated = 0;
  for (const entry of SHOPIFY_WEBHOOKS) {
    const uri = `${origin}${entry.path}`;
    const match = subscriptions.find((subscription) => subscription.topic === entry.topic && subscription.uri === uri);
    if (match && match.format === 'JSON' && !match.filter && !match.includeFields.length) { existing++; continue; }
    const input = { uri, format: 'JSON', filter: null, includeFields: null };
    if (match) {
      const data = await shopifyGraphQL<{ webhookSubscriptionUpdate: { webhookSubscription: { id: string } | null; userErrors: Array<{ message: string }> } }>(`mutation PortalShopifyWebhookUpdate($id: ID!, $subscription: WebhookSubscriptionInput!) {
        webhookSubscriptionUpdate(id: $id, webhookSubscription: $subscription) { webhookSubscription { id } userErrors { message } }
      }`, { id: match.id, subscription: input });
      const result = data.webhookSubscriptionUpdate;
      if (result.userErrors.length || !result.webhookSubscription) throw new Error(`Shopify webhook setup failed for ${entry.topic}: ${result.userErrors.map((error) => error.message).join('; ') || 'No subscription returned'}`);
      updated++;
    } else {
      const data = await shopifyGraphQL<{ webhookSubscriptionCreate: { webhookSubscription: { id: string } | null; userErrors: Array<{ message: string }> } }>(`mutation PortalShopifyWebhookCreate($topic: WebhookSubscriptionTopic!, $subscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $subscription) { webhookSubscription { id } userErrors { message } }
      }`, { topic: entry.topic, subscription: input });
      const result = data.webhookSubscriptionCreate;
      if (result.userErrors.length || !result.webhookSubscription) throw new Error(`Shopify webhook setup failed for ${entry.topic}: ${result.userErrors.map((error) => error.message).join('; ') || 'No subscription returned'}`);
      registered++;
    }
  }
  return { registered, existing, updated };
}

function importedLines(value: unknown): ImportedLine[] {
  if (!Array.isArray(value) || !value.length) throw new Error('Shopify order is missing its imported line item snapshot.');
  const seen = new Set<string>();
  return value.map((line: unknown) => {
    const item = line as Partial<ImportedLine> | null;
    if (!item || typeof item.line_item_id !== 'string' || !/^gid:\/\/shopify\/LineItem\/\d+$/.test(item.line_item_id)
      || !Number.isSafeInteger(item.quantity) || Number(item.quantity) <= 0 || seen.has(item.line_item_id)) {
      throw new Error('Shopify order has an invalid imported line item snapshot.');
    }
    seen.add(item.line_item_id);
    if (typeof item.product_id !== 'string' || !item.product_id) throw new Error('Shopify order is missing its imported product mapping.');
    return { line_item_id: item.line_item_id, quantity: Number(item.quantity), product_id: item.product_id };
  });
}

function matchesQuantities(expected: ImportedLine[], actual: Array<{ line_item_id: string; quantity: number }>) {
  const quantities = new Map<string, number>();
  for (const line of actual) quantities.set(line.line_item_id, (quantities.get(line.line_item_id) ?? 0) + line.quantity);
  return quantities.size === expected.length && expected.every((line) => quantities.get(line.line_item_id) === line.quantity);
}

async function loadOrder(orderId: string): Promise<ShopifyOrderRow> {
  const { data, error } = await getSupabaseAdmin().from('orders').select(
    'id,status,archived_at,order_source,fulfillment_method,shipping_cost_cents,shipping_tracking_numbers,shipping_name,shipping_company,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip,shipping_country,shopify_shop_domain,shopify_order_id,shopify_line_items,shopify_fulfillment_id,shopify_sync_status,shopify_sync_started_at,shopify_sync_token,order_items(product_id,qty)',
  ).eq('id', orderId).single();
  if (error || !data) throw new Error('Could not load the Shopify order.');
  return data as unknown as ShopifyOrderRow;
}

async function loadValidatedRemoteOrder(local: ShopifyOrderRow) {
  if (local.order_source !== 'shopify') throw new Error('This order was not imported from Shopify.');
  if (local.archived_at && local.status !== 'Shipped') throw new Error('Archived Shopify orders cannot be shipped.');
  if (local.shopify_shop_domain !== getShopifyConfig().shopDomain) throw new Error('This order belongs to a different Shopify store than the configured connection.');
  if (!local.shopify_order_id || !/^gid:\/\/shopify\/Order\/\d+$/.test(local.shopify_order_id)) throw new Error('The Shopify order ID is missing or invalid.');
  const expected = importedLines(local.shopify_line_items);
  const expectedProducts = new Map<string, number>();
  for (const line of expected) expectedProducts.set(line.product_id!, (expectedProducts.get(line.product_id!) ?? 0) + line.quantity);
  if (!matchesQuantities([...expectedProducts].map(([line_item_id, quantity]) => ({ line_item_id, quantity })),
    local.order_items.map((item) => ({ line_item_id: item.product_id ?? '', quantity: item.qty })))) {
    throw new Error('Portal products or quantities differ from the imported Shopify order. Reconcile them before shipping.');
  }
  const { order } = await shopifyGraphQL<{ order: RemoteOrder | null }>(ORDER_QUERY, { id: local.shopify_order_id });
  if (!order || order.id !== local.shopify_order_id) throw new Error('Shopify order was not found. Check the order and Shopify app access.');
  if (order.cancelledAt) throw new Error('This order has been canceled in Shopify. Do not ship it.');
  if (order.displayFinancialStatus !== 'PAID') throw new Error('This order is no longer fully paid in Shopify. Review payment or refunds before shipping.');
  const address = order.shippingAddress;
  const normalized = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const localAddress = [local.shipping_name, local.shipping_company, local.shipping_address1, local.shipping_address2,
    local.shipping_city, local.shipping_state, local.shipping_zip, local.shipping_country].map(normalized);
  const remoteAddress = address ? [address.name, address.company, address.address1, address.address2,
    address.city, address.provinceCode || address.province, address.zip, address.countryCodeV2].map(normalized) : [];
  if (!address || JSON.stringify(localAddress) !== JSON.stringify(remoteAddress)) {
    throw new Error('Shipping address differs between the portal and Shopify. Update the portal delivery address to match Shopify before shipping or syncing.');
  }
  if (order.lineItems.pageInfo.hasNextPage || order.fulfillmentOrders.pageInfo.hasNextPage) {
    throw new Error('This Shopify order exceeds the supported 100-line or 100-fulfillment-order limit. Review it in Shopify.');
  }
  if (order.lineItems.nodes.some((line) => !line.requiresShipping)
    || !matchesQuantities(expected, order.lineItems.nodes.map((line) => ({ line_item_id: line.id, quantity: line.currentQuantity })))) {
    throw new Error('Shopify line items or quantities changed after import. Reconcile the portal order before shipping.');
  }
  return { order, expected };
}

async function fulfillmentPlan(order: RemoteOrder, expected: ImportedLine[]): Promise<FulfillmentInputLine[]> {
  if (order.fulfillments.some((fulfillment) => !['CANCELLED', 'ERROR', 'FAILURE'].includes(fulfillment.status))
    || !matchesQuantities(expected, order.lineItems.nodes.map((line) => ({ line_item_id: line.id, quantity: line.unfulfilledQuantity })))) {
    throw new Error('This Shopify order is already fulfilled or partially fulfilled. Review it in Shopify before shipping.');
  }
  const candidates = order.fulfillmentOrders.nodes.filter((entry) => !['CLOSED', 'CANCELLED'].includes(entry.status));
  if (!candidates.length) throw new Error('Shopify has no available fulfillment orders yet. Wait for order routing, then retry.');
  if (candidates.some((entry) => !['OPEN', 'IN_PROGRESS'].includes(entry.status) || !entry.supportedActions.some((action) => action.action === 'CREATE_FULFILLMENT'))) {
    throw new Error('Shopify fulfillment is on hold or cannot be fulfilled by this app. Resolve the hold or app access in Shopify.');
  }
  // A single fulfillment order already belongs to one location. Reading the
  // Location object adds a separate Shopify scope and is only needed when
  // combining multiple fulfillment orders into one shipment.
  const verifyLocations = candidates.length > 1;
  const locations = new Set<string>();
  const result: FulfillmentInputLine[] = [];
  const available: ImportedLine[] = [];
  for (const entry of candidates) {
    const { fulfillmentOrder } = await shopifyGraphQL<{ fulfillmentOrder: {
      assignedLocation?: { location: { id: string } | null };
      lineItems: FulfillmentLines;
    } | null }>(`query PortalFulfillmentOrderLines($id: ID!) {
      fulfillmentOrder(id: $id) {
        ${verifyLocations ? 'assignedLocation { location { id } }' : ''}
        lineItems(first: 100) { nodes { id remainingQuantity lineItem { id } } pageInfo { hasNextPage } }
      }
    }`, { id: entry.id });
    if (!fulfillmentOrder || fulfillmentOrder.lineItems.pageInfo.hasNextPage) throw new Error('Shopify fulfillment lines could not be fully verified. Review the order in Shopify.');
    if (verifyLocations) {
      const locationId = fulfillmentOrder.assignedLocation?.location?.id;
      if (!locationId) throw new Error('Shopify shipping locations could not be verified. Review the fulfillment locations in Shopify before shipping.');
      locations.add(locationId);
      if (locations.size !== 1) throw new Error('This Shopify order is split across locations. Assign it to one shipping location in Shopify before shipping.');
    }
    const lines = fulfillmentOrder.lineItems.nodes.filter((line) => line.remainingQuantity > 0);
    for (const line of lines) available.push({ line_item_id: line.lineItem.id, quantity: line.remainingQuantity });
    if (lines.length) result.push({
      fulfillmentOrderId: entry.id,
      fulfillmentOrderLineItems: lines.map((line) => ({ id: line.id, quantity: line.remainingQuantity })),
    });
  }
  if (!matchesQuantities(expected, available)) throw new Error('Shopify fulfillment quantities differ from the imported order. Reconcile them before shipping.');
  return result;
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : 'Shopify sync failed. Retry the sync.').slice(0, 1000);
}

export async function validateShopifyOrderForShipment(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const local = await loadOrder(orderId);
    const { order, expected } = await loadValidatedRemoteOrder(local);
    await fulfillmentPlan(order, expected);
    const { error } = await getSupabaseAdmin().from('orders').update({ shopify_sync_status: 'pending', shopify_sync_error: null }).eq('id', orderId).eq('order_source', 'shopify').neq('status', 'Shipped');
    if (error) throw new Error('Could not save Shopify validation. Try again before shipping.');
    return { ok: true };
  } catch (error) {
    const message = errorMessage(error);
    await getSupabaseAdmin().from('orders').update({ shopify_sync_status: 'error', shopify_sync_error: message }).eq('id', orderId).eq('order_source', 'shopify').neq('status', 'Shipped');
    return { ok: false, error: message };
  }
}

async function verifiedExistingFulfillment(order: RemoteOrder, expected: ImportedLine[], local: ShopifyOrderRow, numbers: string[]) {
  const active = order.fulfillments.filter((fulfillment) => !['CANCELLED', 'ERROR', 'FAILURE'].includes(fulfillment.status));
  if (!active.length && !local.shopify_fulfillment_id) return null;
  if (active.length !== 1 || active[0].status !== 'SUCCESS'
    || (local.shopify_fulfillment_id && active[0].id !== local.shopify_fulfillment_id)) {
    throw new Error('Shopify has a different, canceled, or partial fulfillment. Review it before retrying the sync.');
  }
  const fulfillment = active[0];
  const { node } = await shopifyGraphQL<{ node: { fulfillmentLineItems: Connection<{ quantity: number; lineItem: { id: string } }> } | null }>(`query PortalFulfilledLines($id: ID!) {
    node(id: $id) { ... on Fulfillment { fulfillmentLineItems(first: 100) { nodes { quantity lineItem { id } } pageInfo { hasNextPage } } } }
  }`, { id: fulfillment.id });
  if (!node || node.fulfillmentLineItems.pageInfo.hasNextPage
    || !matchesQuantities(expected, node.fulfillmentLineItems.nodes.map((line) => ({ line_item_id: line.lineItem.id, quantity: line.quantity })))) {
    throw new Error('Existing Shopify fulfillment does not contain exactly the imported order items. Review it in Shopify.');
  }
  const actualNumbers = parseShipmentTrackingNumbers(fulfillment.trackingInfo.map((entry) => entry.number)).map((number) => number.toUpperCase()).sort();
  if (local.fulfillment_method === 'local_delivery' && actualNumbers.length) {
    throw new Error('Shopify already has carrier tracking for this local delivery. Review the fulfillment before retrying.');
  }
  const sameTracking = JSON.stringify(actualNumbers) === JSON.stringify(numbers.map((number) => number.toUpperCase()).sort());
  // A known ID can receive corrected tracking. An unknown ID is only adopted if
  // both items and tracking match, recovering a successful but interrupted create.
  if (!local.shopify_fulfillment_id && !sameTracking) throw new Error('This order was fulfilled separately in Shopify with different tracking. Review it before retrying.');
  return { id: fulfillment.id, sameTracking };
}

export type ShopifySyncResult = { status: 'synced' | 'error' | 'busy'; error?: string };

export async function syncShopifyFulfillment(orderId: string): Promise<ShopifySyncResult> {
  let token: string | null = null;
  try {
    const local = await loadOrder(orderId);
    if (local.order_source !== 'shopify' || local.status !== 'Shipped') throw new Error('Only shipped Shopify orders can sync fulfillment.');
    const startedAt = new Date().toISOString();
    if (local.shopify_sync_status === 'syncing' && local.shopify_sync_started_at
      && Date.now() - Date.parse(local.shopify_sync_started_at) < SYNC_LEASE_MS) return { status: 'busy' };
    const attemptToken = randomUUID();
    let claim = getSupabaseAdmin().from('orders').update({
      shopify_sync_status: 'syncing', shopify_sync_started_at: startedAt, shopify_sync_token: attemptToken, shopify_sync_error: null,
    }).eq('id', orderId).eq('order_source', 'shopify').eq('status', 'Shipped');
    claim = local.shopify_sync_status === null ? claim.is('shopify_sync_status', null) : claim.eq('shopify_sync_status', local.shopify_sync_status);
    claim = local.shopify_sync_token === null ? claim.is('shopify_sync_token', null) : claim.eq('shopify_sync_token', local.shopify_sync_token);
    const claimed = await claim.select('id').maybeSingle();
    if (claimed.error) throw new Error('Could not claim the Shopify sync. Try again.');
    if (!claimed.data) return { status: 'busy' };
    token = attemptToken;
    const numbers = parseShipmentTrackingNumbers(local.shipping_tracking_numbers);
    const localDelivery = local.fulfillment_method === 'local_delivery';
    if (localDelivery && (!Number.isSafeInteger(local.shipping_cost_cents) || local.shipping_cost_cents < 0 || numbers.length)) {
      throw new Error('Local delivery requires a saved shipping cost of $0 or more and no carrier tracking.');
    }
    if (!localDelivery && (!numbers.length || !Number.isSafeInteger(local.shipping_cost_cents) || local.shipping_cost_cents <= 0)) {
      throw new Error('Save a shipping price and tracking number before syncing this order to Shopify.');
    }
    const { order, expected } = await loadValidatedRemoteOrder(local);
    const existing = await verifiedExistingFulfillment(order, expected, local, numbers);
    let fulfillmentId = existing?.id;
    if (!existing) {
      const lineItemsByFulfillmentOrder = await fulfillmentPlan(order, expected);
      const data = await shopifyGraphQL<{ fulfillmentCreate: MutationResult }>(`mutation PortalFulfillmentCreate($fulfillment: FulfillmentInput!) {
        fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { message } }
      }`, { fulfillment: {
        lineItemsByFulfillmentOrder,
        ...(localDelivery ? {} : { trackingInfo: { company: 'UPS', numbers } }),
        notifyCustomer: true,
      } });
      const result = data.fulfillmentCreate;
      if (result.userErrors.length) throw new Error(`Shopify: ${result.userErrors.map((error) => error.message).join('; ')}`);
      if (!result.fulfillment || result.fulfillment.status !== 'SUCCESS') throw new Error('Shopify did not confirm fulfillment. Retry the sync to check its status.');
      fulfillmentId = result.fulfillment.id;
    } else if (!existing.sameTracking) {
      const data = await shopifyGraphQL<{ fulfillmentTrackingInfoUpdate: MutationResult }>(`mutation PortalFulfillmentTrackingUpdate($id: ID!, $tracking: FulfillmentTrackingInput!) {
        fulfillmentTrackingInfoUpdate(fulfillmentId: $id, trackingInfoInput: $tracking, notifyCustomer: true) { fulfillment { id status } userErrors { message } }
      }`, { id: existing.id, tracking: { company: 'UPS', numbers } });
      const result = data.fulfillmentTrackingInfoUpdate;
      if (result.userErrors.length) throw new Error(`Shopify: ${result.userErrors.map((error) => error.message).join('; ')}`);
      if (result.fulfillment?.id !== existing.id || result.fulfillment.status !== 'SUCCESS') throw new Error('Shopify did not confirm the tracking update. Retry the sync.');
    }
    const saved = await getSupabaseAdmin().from('orders').update({
      shopify_fulfillment_id: fulfillmentId,
      shopify_sync_status: 'synced', shopify_sync_error: null, shopify_synced_at: new Date().toISOString(),
      shopify_sync_token: null, shopify_sync_started_at: null,
    }).eq('id', orderId).eq('shopify_sync_token', token).select('id').maybeSingle();
    if (saved.error || !saved.data) throw new Error('Shopify fulfillment was sent, but its confirmation could not be saved. Retry the sync; do not ship the order again.');
    return { status: 'synced' };
  } catch (error) {
    const message = errorMessage(error);
    if (token) await getSupabaseAdmin().from('orders').update({
      shopify_sync_status: 'error', shopify_sync_error: message, shopify_sync_token: null, shopify_sync_started_at: null,
    }).eq('id', orderId).eq('shopify_sync_token', token);
    return { status: 'error', error: message };
  }
}
