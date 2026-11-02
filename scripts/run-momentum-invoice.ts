/**
 * Explicit one-off production invoice operator. No execution without one mode.
 * From the repository, after the normal nvm setup:
 *   MOMENTUM_ESBUILD_BIN=/Users/zachfeinstone/.npm/_npx/69f9afb961c37556/node_modules/esbuild/bin/esbuild
 *   "$MOMENTUM_ESBUILD_BIN" scripts/run-momentum-invoice.ts --bundle --platform=node --format=cjs --packages=external --alias:@=. --alias:server-only=./tests/server-only-stub.ts --outfile=/private/tmp/run-momentum-invoice.cjs
 *   NODE_PATH="$PWD/node_modules" node --env-file=.env.local /private/tmp/run-momentum-invoice.cjs --prepare
 *   NODE_PATH="$PWD/node_modules" node --env-file=.env.local /private/tmp/run-momentum-invoice.cjs --send
 * --prepare creates/links the product and invoice, saves its IDs, and downloads a
 * review PDF. It sends no email. --send requires that verified prepared invoice.
 * Both modes reject card/payment activity and keep the customer's defaults intact.
 */
import { writeFile, mkdir } from 'node:fs/promises';

const APPROVED = {
  sku: 'MOMENTUM-CUSTOM-8OZ-20261020',
  centerId: 'f5f284c6-cd7c-4a1b-9e4b-497fe7299837',
  orderId: '973a468e-cbb4-4116-8282-6e9e18a6a410',
  productId: '54af36ea-36fe-40af-85c9-c2b9ff21b53e',
  to: 'momentumrecovery1@bill.com',
  cc: 'zach@sobrew.com',
  siteUrl: 'https://app.sobrew.com',
};

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function exactRecipients(value: { to: string[]; cc: string[] }) {
  requireCondition(value.to.length === 1 && value.to[0].trim().toLowerCase() === APPROVED.to,
    'Invoice To recipient differs from the approved Momentum address.');
  requireCondition(value.cc.length === 1 && value.cc[0].trim().toLowerCase() === APPROVED.cc,
    'Invoice CC differs from the approved Zach audit recipient.');
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (mode === '--help' && !extra.length) {
    console.log('Usage: run-momentum-invoice.cjs --prepare | --send\nPrepare creates a draft invoice and PDF without sending; send emails only the verified prepared invoice.');
    return;
  }
  requireCondition(!extra.length && (mode === '--prepare' || mode === '--send'), 'Supply exactly --prepare or --send.');
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET']) {
    requireCondition(Boolean(process.env[key]), `Missing required environment variable: ${key}`);
  }
  requireCondition(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname === 'ovrzooxvvernqqcotpkv.supabase.co',
    'Supabase project differs from the approved production portal.');
  if (mode === '--send') requireCondition(Boolean(process.env.RESEND_API_KEY), 'Missing RESEND_API_KEY.');
  process.env.NEXT_PUBLIC_SITE_URL = APPROVED.siteUrl;
  process.env.QUICKBOOKS_PRODUCT_ITEM_TYPE = 'NonInventory';
  const qb = await import('@/lib/quickbooks');
  const { getSupabaseAdmin } = await import('@/lib/supabase/admin');
  const supabase = getSupabaseAdmin();

  const connection = await qb.getQuickBooksConnectionStatus();
  requireCondition(connection.connected && connection.environment === 'production', 'QuickBooks must be connected to production.');
  const { data: initialProduct, error: productError } = await supabase.from('products')
    .select('id,name,sku,description,active,quickbooks_item_id,quickbooks_item_type').eq('sku', APPROVED.sku).single();
  requireCondition(!productError && initialProduct?.active && initialProduct.id === APPROVED.productId
    && initialProduct.name === 'Custom 8-ounce bags', 'Approved Momentum product not found or changed.');
  const { data: allocation, error: allocationError } = await supabase.from('customer_stock_allocations')
    .select('id,center_id,product_id,initial_order_id,initial_quantity').eq('product_id', initialProduct.id).single();
  requireCondition(!allocationError && allocation?.center_id === APPROVED.centerId && allocation.initial_quantity === 1000
    && allocation.initial_order_id === APPROVED.orderId,
    'Approved 1,000-bag Momentum allocation is missing or changed.');
  const orderId = allocation.initial_order_id;

  async function checkedOrder() {
    const { data: order, error } = await supabase.from('orders')
      .select('id,center_id,status,archived_at,order_source,subtotal_cents,shipped_at,shipping_cost_cents,processing_fee_cents,donation_cogs_cents,invoice_status,quickbooks_invoice_id,quickbooks_invoice_doc_number,quickbooks_invoice_email_sent_at,quickbooks_invoice_email_to,quickbooks_payment_id,quickbooks_payment_charge_id,quickbooks_payment_status,quickbooks_receipt_email_sent_at,held_stock_sales(invoice_only,tax_exempt,processing_fee_cents,donation_cogs_cents),centers(id,name,billing_email,quickbooks_customer_id),order_items(product_id,qty,unit_price_cents,line_total_cents,cogs_snapshot_at,cogs_total_cents)')
      .eq('id', orderId).single();
    requireCondition(!error && order, 'Unable to verify the approved Momentum order.');
    const center = one(order.centers);
    const held = one(order.held_stock_sales);
    requireCondition(order.center_id === APPROVED.centerId && center?.id === APPROVED.centerId
      && center.name === 'Momentum Recovery' && center.billing_email?.trim().toLowerCase() === APPROVED.to
      && center.quickbooks_customer_id, 'Momentum customer identity, billing address, or QuickBooks mapping changed.');
    requireCondition(order.status === 'Shipped' && order.shipped_at && !order.archived_at && order.order_source === 'portal'
      && Number(order.subtotal_cents) === 690000 && order.shipping_cost_cents == null, 'Order is not the approved $6,900 billed-and-held sale.');
    requireCondition(held?.invoice_only && held.tax_exempt && held.processing_fee_cents === 20631 && held.donation_cogs_cents === 0
      && Number(order.processing_fee_cents) === 20631 && Number(order.donation_cogs_cents) === 0, 'Approved invoice-only, no-tax, processing, or donation override changed.');
    requireCondition(!order.quickbooks_payment_id && !order.quickbooks_payment_charge_id && !order.quickbooks_payment_status
      && !order.quickbooks_receipt_email_sent_at, 'Unexpected payment activity; no invoice action performed.');
    const lines = order.order_items ?? [];
    requireCondition(lines.length === 1 && lines[0].product_id === initialProduct!.id && Number(lines[0].qty) === 1000
      && Number(lines[0].unit_price_cents) === 690 && Number(lines[0].line_total_cents) === 690000
      && lines[0].cogs_snapshot_at && Number(lines[0].cogs_total_cents) === 354631,
    'The order line or reviewed batch costs changed.');
    requireCondition(['not_invoiced', 'invoice_error', 'invoiced'].includes(order.invoice_status), 'Billing is already running or in an unexpected state.');
    return order;
  }

  let order = await checkedOrder();
  exactRecipients(await qb.getQuickBooksInvoiceEmailPreviewForOrder(orderId));

  if (mode === '--prepare') {
    if (!initialProduct.quickbooks_item_id) {
      const mapping = await qb.createMissingQuickBooksProductsFromPortal([initialProduct]);
      requireCondition(mapping.productErrorCount === 0 && mapping.createdCount === 1, 'QuickBooks product mapping failed; review the product sync error.');
    }
    const { data: mappedProduct, error: mappingError } = await supabase.from('products')
      .select('quickbooks_item_id,quickbooks_item_type').eq('id', initialProduct.id).single();
    requireCondition(!mappingError && mappedProduct?.quickbooks_item_id
      && ['NonInventory', 'Service'].includes(mappedProduct.quickbooks_item_type ?? ''), 'A non-inventory QuickBooks product mapping is required.');
    const created = await qb.createQuickBooksInvoiceForOrder(orderId, { prepareEmailRecipients: true, sendQuickBooksEmail: false });
    // Save the remote identity before checking any later email/PDF/audit result.
    const saved = await supabase.from('orders').update({
      quickbooks_invoice_id: created.id,
      quickbooks_invoice_doc_number: created.docNumber,
      quickbooks_invoice_url: created.url,
      quickbooks_invoice_email_to: created.emailRecipients ?? created.emailTo,
    }).eq('id', orderId).select('id').single();
    requireCondition(!saved.error && saved.data, `Invoice ${created.id} was created but its portal identity could not be saved. Stop and reconcile that ID before retrying.`);
    console.log(JSON.stringify({ phase: 'invoice_linked', orderId, invoiceId: created.id, invoiceNumber: created.docNumber, emailSent: Boolean(order.quickbooks_invoice_email_sent_at) }));
    requireCondition(!created.emailError && !created.emailSentAt, created.emailError ? 'Invoice was saved but its email preparation failed; review before sending.' : 'Unexpected invoice delivery during preparation.');
    order = await checkedOrder();
  }

  requireCondition(order.quickbooks_invoice_id, 'Run --prepare before --send.');
  exactRecipients(await qb.getQuickBooksInvoiceEmailRecipientsForOrder(orderId));
  const audit = await qb.getHeldStockInvoiceAuditForOrder(orderId);
  requireCondition(audit.id === order.quickbooks_invoice_id && audit.amountCents === 690000
    && audit.balanceCents === 690000 && audit.taxCents === 0, 'Provider invoice must be unpaid, exactly $6,900, and tax-free.');
  requireCondition(audit.lines.length === 1 && audit.lines[0].quantity === 1000
    && audit.lines[0].unitPriceCents === 690 && audit.lines[0].amountCents === 690000 && audit.lines[0].taxCode === 'NON',
  'Provider invoice quantities, prices, or tax treatment differ from approval.');
  requireCondition(!audit.shipDate && !audit.shipMethod && !audit.tracking && /held at Sobrew for delivery on request/i.test(audit.memo),
    'Provider invoice must describe held stock without a physical shipment.');

  const { snapshotOrderCommissionForShipment } = await import('@/lib/commissions');
  const commission = await snapshotOrderCommissionForShipment({ orderId, shippedAt: order.shipped_at!, shippingCostCents: 0 });
  requireCondition(!commission.error, 'Unable to record the normal commission snapshot. No invoice email was sent.');

  if (mode === '--prepare') {
    const pdf = await qb.getQuickBooksInvoicePdfForOrder(orderId);
    const directory = '/private/tmp/momentum-invoice';
    await mkdir(directory, { recursive: true });
    const pdfPath = `${directory}/${pdf.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await writeFile(pdfPath, pdf.content, { mode: 0o600 });
    console.log(JSON.stringify({ phase: 'prepared', orderId, invoiceId: audit.id, invoiceNumber: audit.docNumber, amountCents: audit.amountCents, taxCents: audit.taxCents, emailSent: Boolean(order.quickbooks_invoice_email_sent_at), pdfPath }));
    return;
  }

  if (!order.quickbooks_invoice_email_sent_at) {
    requireCondition(order.invoice_status !== 'invoiced', 'Invoice is marked invoiced without an email audit. Review before sending.');
    // Last recipient/identity checks precede the existing idempotent mail flow.
    order = await checkedOrder();
    exactRecipients(await qb.getQuickBooksInvoiceEmailRecipientsForOrder(orderId));
    const result = await qb.fulfillShippedOrderBilling(orderId);
    requireCondition(result.status === 'invoiced', 'Invoice delivery did not complete. Review the saved invoice error before retrying; do not charge a card.');
  }
  const delivered = await checkedOrder();
  requireCondition(delivered.quickbooks_invoice_email_sent_at && delivered.invoice_status === 'invoiced', 'Invoice delivery audit is incomplete.');
  const sentTo = (delivered.quickbooks_invoice_email_to ?? '').split(/[,;]/).map(value => value.trim().toLowerCase()).filter(Boolean).sort();
  requireCondition(JSON.stringify(sentTo) === JSON.stringify([APPROVED.to, APPROVED.cc].sort()), 'Saved delivery recipients differ from approval.');
  console.log(JSON.stringify({ phase: 'sent', orderId, invoiceId: delivered.quickbooks_invoice_id, invoiceNumber: delivered.quickbooks_invoice_doc_number,
    emailSentAt: delivered.quickbooks_invoice_email_sent_at, to: APPROVED.to, cc: APPROVED.cc, amountCents: 690000, taxCents: 0, cardCharged: false }));
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: 'stopped', error: error instanceof Error ? error.message : 'Unexpected operator failure; review before retrying.' }));
  process.exitCode = 1;
});
