import Link from 'next/link';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { loadShopifyAccountingRows, shopifyAccountingPeriod, type ShopifyAccountingRow } from '@/lib/shopify-accounting';
import { createClient } from '@/lib/supabase/server';
import { formatAppDateTime, usd } from '@/lib/utils';

export default async function ShopifyAccountingPage(props: { searchParams?: Promise<{ start?: string; end?: string }> }) {
  const current = await requireAdminSectionView('accounting');
  const params = await props.searchParams;
  let period;
  try {
    period = shopifyAccountingPeriod(params?.start, params?.end);
  } catch (error) {
    return <section className="card"><h1 className="text-xl font-semibold">Shopify reconciliation</h1><p role="alert" className="mt-3 text-rose-700">{error instanceof Error ? error.message : 'Invalid dates.'}</p><Link className="btn-secondary mt-4" href="/admin/accounting/shopify">Reset dates</Link></section>;
  }
  const result = await loadShopifyAccountingRows(await createClient(), period, current.centerScope);
  const rows = result.data;
  const money = (value: number | null) => value == null ? 'Pending / unknown' : usd(value);
  const total = (key: 'merchandiseCents' | 'shippingRevenueCents' | 'salesTaxCents' | 'totalPaidCents') => rows.reduce((sum, row) => sum + (row[key] ?? 0), 0);
  const summary: Array<[string, 'merchandiseCents' | 'shippingRevenueCents' | 'salesTaxCents' | 'totalPaidCents']> = [
    ['Original merchandise revenue', 'merchandiseCents'], ['Original shipping revenue collected', 'shippingRevenueCents'], ['Original sales tax · liability', 'salesTaxCents'], ['Original gross customer payments', 'totalPaidCents'],
  ];
  const columns: Array<[string, keyof Pick<ShopifyAccountingRow, 'merchandiseCents' | 'shippingRevenueCents' | 'salesTaxCents' | 'totalPaidCents' | 'productCogsCents' | 'shippingCostCents' | 'processingCogsCents' | 'donationCogsCents' | 'grossProfitCents'>]> = [
    ['Original merchandise', 'merchandiseCents'], ['Original shipping revenue', 'shippingRevenueCents'], ['Original sales tax liability', 'salesTaxCents'], ['Original customer payment', 'totalPaidCents'], ['Product COGS', 'productCogsCents'], ['Carrier expense', 'shippingCostCents'], ['Processing COGS¹', 'processingCogsCents'], ['Donation COGS', 'donationCogsCents'], ['Gross profit before refunds', 'grossProfitCents'],
  ];
  return <div className="space-y-6">
    <section className="panel space-y-4">
      <Link className="text-sm underline" href={`/admin/accounting?${new URLSearchParams({ start: period.start, end: period.end })}`}>Back to accounting</Link>
      <h1 className="page-title">Shopify reconciliation</h1>
      <p className="page-subtitle">Compare original checkout payments with merchandise, shipping revenue, tax collected, and saved fulfillment costs.</p>
      <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Original checkout amounts only. Refunds, returns, chargebacks and tax remittances are excluded. Gross profit is before refunds; reconcile those adjustments separately before closing the books.</p>
      <form action="/admin/accounting/shopify" className="flex flex-wrap items-end gap-3" aria-label="Shopify reconciliation period">
        <label className="workspace-field">Start date<input className="input" type="date" name="start" defaultValue={period.start} required /></label>
        <label className="workspace-field">End date<input className="input" type="date" name="end" defaultValue={period.end} required /></label>
        <button className="btn-primary" type="submit">Update</button>
        <button className="btn-secondary" type="submit" formAction="/admin/accounting/shopify/export">Download CSV</button>
      </form>
      <p className="text-sm text-slate-600">Uses order dates in America/Chicago, including archived orders. This is an order reconciliation, separate from bank deposits and the accounting P&amp;L. Exporting does not post transactions or create QuickBooks entries.</p>
    </section>
    {result.error ? <section className="card"><p className="text-rose-700" role="alert">Unable to load the complete Shopify reconciliation. Please try again.</p></section> : <>
      <section className="grid gap-4 md:grid-cols-4">{summary.map(([label, key]) => <div className="card" key={key}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold">{usd(total(key))}</p><p className="mt-2 text-xs text-slate-500">Known amounts · {rows.filter((row) => row[key] != null).length} of {rows.length} orders</p></div>)}</section>
      <section className="card space-y-3 text-sm text-slate-600">
        <p>Shipping paid by the customer is revenue; the actual carrier cost is an expense. Sales tax collected is a liability and is excluded from revenue, COGS, and gross profit. Tax remittances and refunds must be reconciled separately.</p>
        <p>¹ Processing COGS is the saved fee estimate, not a verified Shopify payout fee. New shipments estimate 2.99% + $0.30 on the full payment. Historical cost snapshots are preserved. CSV includes the current estimate for comparison.</p>
        <p>Product COGS identifies actual FIFO costs, estimates, or an unknown legacy source. Missing product costs stay blank even if a snapshot was saved. Pending or unknown costs are left blank in the export. Gross profit appears only when checkout totals reconcile and every cost is available; it includes any labeled estimates.</p>
        {rows.some((row) => !row.checkoutReconciles) ? <p className="text-amber-800" role="status">{rows.filter((row) => !row.checkoutReconciles).length} orders have missing or inconsistent checkout totals and need reconciliation.</p> : null}
      </section>
      <section className="card overflow-x-auto">
        <table className="w-full text-sm"><caption className="mb-4 text-left font-semibold">{rows.length} imported Shopify orders · USD</caption><thead><tr><th className="p-3 text-left" scope="col">Order</th>{columns.map(([label, key]) => <th className="p-3 text-right" scope="col" key={key}>{label}</th>)}</tr></thead><tbody>
          {rows.map((row) => <tr className="border-t" key={row.id}><th className="p-3 text-left font-normal" scope="row"><Link className="font-semibold underline" href={`/admin/orders/${row.id}`}>{row.name}</Link><p className="mt-1 text-xs text-slate-500">{formatAppDateTime(row.createdAt)} · {row.status}</p>{!row.checkoutReconciles ? <p className="mt-1 text-xs text-amber-800">Check checkout totals</p> : null}</th>{columns.map(([, key]) => <td className="p-3 text-right" key={key}>{money(row[key])}{key === 'productCogsCents' && row.productCogsCents != null ? <p className="mt-1 text-xs text-slate-500">{row.productCogsBasis}</p> : null}</td>)}</tr>)}
          {!rows.length ? <tr><td className="p-3 text-slate-500" colSpan={columns.length + 1}>No imported Shopify orders in this period.</td></tr> : null}
        </tbody></table>
      </section>
    </>}
  </div>;
}
