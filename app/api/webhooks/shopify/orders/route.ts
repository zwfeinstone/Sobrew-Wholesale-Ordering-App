import { NextResponse } from 'next/server';
import { getShopifyConfig, verifyShopifyWebhook } from '@/lib/shopify';
import { parseShopifyWebhookPayload, receiveShopifyOrder, shopifyOrderIdentity } from '@/lib/shopify-import';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const config = getShopifyConfig();
  if (!config.shopDomain || !config.webhookSecret) return NextResponse.json({ error: 'Shopify webhook is not configured.' }, { status: 503 });
  const rawBody = await request.text();
  if (!verifyShopifyWebhook(rawBody, request.headers.get('x-shopify-hmac-sha256'))) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
  }
  if (request.headers.get('x-shopify-shop-domain')?.toLowerCase() !== config.shopDomain) {
    return NextResponse.json({ error: 'Unexpected Shopify store.' }, { status: 403 });
  }
  const topic = request.headers.get('x-shopify-topic');
  if (topic !== 'orders/paid') return NextResponse.json({ error: 'Subscribe to orders/paid for this endpoint.' }, { status: 400 });
  let payload: unknown;
  try {
    payload = parseShopifyWebhookPayload(rawBody);
    shopifyOrderIdentity(payload);
  } catch {
    return NextResponse.json({ error: 'Invalid Shopify order payload.' }, { status: 400 });
  }
  try {
    const result = await receiveShopifyOrder(payload, config.shopDomain, topic);
    // Content errors stay in the operator inbox. Temporary API/database failures
    // must also request Shopify's automatic redelivery.
    return NextResponse.json({ received: true, status: result.status }, {
      status: result.status === 'error' && result.retryable ? 500 : 200,
    });
  } catch {
    return NextResponse.json({ error: 'Could not save Shopify delivery. Please retry.' }, { status: 500 });
  }
}
