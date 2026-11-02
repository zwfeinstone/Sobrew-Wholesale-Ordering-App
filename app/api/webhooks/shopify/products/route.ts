import { NextResponse } from 'next/server';
import { getShopifyConfig, verifyShopifyWebhook } from '@/lib/shopify';
import { parseShopifyWebhookPayload } from '@/lib/shopify-import';
import { receiveShopifyProduct, shopifyProductIdentity } from '@/lib/shopify-product-webhooks';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
  if (topic !== 'products/create' && topic !== 'products/update') {
    return NextResponse.json({ error: 'Subscribe to products/create and products/update for this endpoint.' }, { status: 400 });
  }
  const webhookId = request.headers.get('x-shopify-webhook-id') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(webhookId)) {
    return NextResponse.json({ error: 'Missing or invalid Shopify delivery ID.' }, { status: 400 });
  }
  let payload: unknown;
  try {
    payload = parseShopifyWebhookPayload(rawBody);
    shopifyProductIdentity(payload);
  } catch {
    return NextResponse.json({ error: 'Invalid Shopify product payload.' }, { status: 400 });
  }
  try {
    const result = await receiveShopifyProduct(payload, topic, webhookId);
    // Failures are durable for operator recovery and also request Shopify's
    // automatic retries, so a temporary API/database outage needs no intervention.
    return NextResponse.json({ received: true, status: result.status }, { status: result.status === 'imported' ? 200 : 500 });
  } catch {
    return NextResponse.json({ error: 'Could not save Shopify product delivery. Please retry.' }, { status: 500 });
  }
}
