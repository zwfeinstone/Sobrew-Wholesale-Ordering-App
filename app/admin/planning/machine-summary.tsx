import Link from 'next/link';
import type { MachineBagSummary } from '@/lib/machine-bag-summary';

const BAG_TYPES = [
  { value: 'fraction', label: 'Fraction packs' },
  { value: 'filter', label: 'Filter packs' },
  { value: 'sample', label: 'Sample bags' },
] as const;

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const ROAST_ORDER = ['Medium Roast', 'Dark Roast'];

function dateLabel(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function MachineRunSummary({ summary, canRecordProduction = false }: { summary: MachineBagSummary; canRecordProduction?: boolean }) {
  const partial = summary.issues.length > 0;
  const groups = BAG_TYPES.map((bagType) => {
    const rows = summary.rows.filter((row) => row.bagType === bagType.value);
    const rowsByRoast = new Map<string, typeof rows>();
    for (const row of rows) {
      const roastRows = rowsByRoast.get(row.roast) ?? [];
      roastRows.push(row);
      rowsByRoast.set(row.roast, roastRows);
    }
    const roasts = Array.from(rowsByRoast, ([label, roastRows]) => ({
      label,
      rows: roastRows.sort((a, b) => a.sizeOz - b.sizeOz || a.key.localeCompare(b.key)),
      coffeeLb: roastRows.reduce((sum, row) => sum + row.coffeeLb, 0),
    })).sort((a, b) => {
      const order = (label: string) => ROAST_ORDER.includes(label) ? ROAST_ORDER.indexOf(label) : ROAST_ORDER.length;
      return order(a.label) - order(b.label) || a.label.localeCompare(b.label);
    });
    return { ...bagType, rows, roasts, coffeeLb: rows.reduce((sum, row) => sum + row.coffeeLb, 0) };
  });
  const totalCoffeeLb = groups.reduce((sum, group) => sum + group.coffeeLb, 0);

  return <div className="space-y-6">
    <section className="panel" aria-labelledby="machine-summary-heading">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <span className="eyebrow">Next two weeks</span>
          <h2 id="machine-summary-heading" className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Summary of all machine-run bags</h2>
          <p className="mt-2 text-sm font-semibold text-teal-900"><time dateTime={summary.today}>{dateLabel(summary.today)}</time> – <time dateTime={summary.horizonEnd}>{dateLabel(summary.horizonEnd)}</time> · Central Time</p>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-700">Run bags together by type, size, and roast. Quantities cover open orders and recurring needs in this window, after subtracting recorded finished stock.{summary.includeForecast ? ' Two weeks of shipment estimates with medium or high confidence and saved customer stock targets are included; those targets overlap orders so demand is not counted twice.' : ''}</p>
        </div>
        {canRecordProduction ? <Link href="/admin/production" className="btn-secondary shrink-0 self-start">Create boxed inventory</Link> : null}
      </div>
      <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">Use this list to run the bags, then record completed products after boxing. Counts update when finished inventory is recorded. Expand a row to see the products those bags will fill.</p>
      <p className="mt-3 text-sm text-slate-600">Every sample box includes one 6 oz ground Dark Roast bag and one 6 oz ground Medium Roast bag. Coffee to grind is the total weight needed to fill the bags in each run, before any waste allowance.</p>
      {!canRecordProduction ? <p className="mt-3 text-sm text-slate-600">A team member with Production edit access can record boxed inventory from this summary.</p> : null}
    </section>

    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="stat-card border-teal-200 bg-teal-50">
        <dt className="text-sm font-semibold text-teal-900">Total coffee to grind{partial ? ' · partial' : ''}</dt>
        <dd>
          <p className="mt-2 text-4xl font-bold tracking-tight text-teal-950 tabular-nums">{number(totalCoffeeLb)} <span className="text-lg font-semibold">lb</span></p>
          <p className="mt-2 text-sm font-semibold text-teal-900">Across all runs</p>
        </dd>
      </div>
      {groups.map((group) => <div key={group.value} className="stat-card">
        <dt className="text-sm font-semibold text-slate-600">{group.label}{partial ? ' · partial' : ''}</dt>
        <dd>
          <p className="mt-2 text-3xl font-bold text-slate-950 tabular-nums">{number(group.coffeeLb)} <span className="text-lg font-semibold">lb</span></p>
          <p className="mt-2 text-sm font-semibold text-slate-700">Coffee to grind</p>
          <p className="mt-2 text-xs text-slate-600">{group.rows.length} size and roast {group.rows.length === 1 ? 'combination' : 'combinations'}</p>
        </dd>
      </div>)}
    </dl>

    {partial ? <section className="card border-amber-200 bg-amber-50" aria-labelledby="machine-recipe-issues">
      <h3 id="machine-recipe-issues" className="text-lg font-semibold text-amber-950">Some bags could not be counted</h3>
      <p className="mt-2 text-sm leading-relaxed text-amber-950">These products need recipe details before their bags can be included. The totals above and below are partial.</p>
      <ul className="mt-4 space-y-3 text-sm">
        {summary.issues.map((issue) => <li key={`${issue.productId}:${issue.message}`}>
          <Link href={`/admin/products/${encodeURIComponent(issue.productId)}`} className="font-semibold text-amber-950 underline underline-offset-2">{issue.productName}</Link>
          <p className="mt-1 text-amber-950">{issue.message}</p>
        </li>)}
      </ul>
    </section> : null}

    {summary.reviewMessages.length > 0 ? <section className="card border-amber-200" aria-labelledby="machine-planning-reviews">
      <h3 id="machine-planning-reviews" className="text-lg font-semibold text-amber-950">Planning notes to review</h3>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
        {summary.reviewMessages.map((message) => <li key={message}>{message}</li>)}
      </ul>
    </section> : null}

    {summary.rows.length > 0 ? groups.filter((group) => group.rows.length > 0).map((group) => <section key={group.value} className="card" aria-labelledby={`machine-${group.value}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`machine-${group.value}`} className="text-xl font-semibold text-slate-950">{group.label}</h3>
        <p className="text-lg font-bold text-teal-900 tabular-nums">{number(group.coffeeLb)} lb to grind{partial ? ' · partial' : ''}</p>
      </div>
      <div className="mt-5 space-y-6">
        {group.roasts.map((roast, roastIndex) => <section key={roast.label} className="overflow-hidden rounded-xl border border-slate-300" aria-labelledby={`machine-${group.value}-roast-${roastIndex}`}>
          <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 px-4 py-4 sm:px-5 ${roast.label === 'Medium Roast' ? 'bg-amber-50' : roast.label === 'Dark Roast' ? 'bg-slate-100' : 'bg-teal-50'}`}>
            <h4 id={`machine-${group.value}-roast-${roastIndex}`} className="text-xl font-bold text-slate-950">{roast.label}</h4>
            <p className="text-right text-sm font-semibold text-slate-800 tabular-nums">{number(roast.coffeeLb)} lb to grind{partial ? ' · partial' : ''}</p>
          </div>
          <div className="overflow-x-auto px-4 sm:px-5">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">{group.label} · {roast.label} to run by bag size{partial ? '; partial counts' : ''}</caption>
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th scope="col" className="p-3 pl-0">Bag size</th>
                  <th scope="col" className="p-3">Roast and products</th>
                  <th scope="col" className="p-3 text-right">Bags to run</th>
                  <th scope="col" className="p-3 pr-0 text-right">Coffee to grind</th>
                </tr>
              </thead>
              <tbody>
                {roast.rows.map((row) => <tr key={row.key} className="border-b border-slate-100 last:border-0">
                  <th scope="row" className="whitespace-nowrap p-3 pl-0 align-top text-base font-semibold text-slate-950">{number(row.sizeOz)} oz</th>
                  <td className="p-3 align-top">
                    <p className="font-semibold text-slate-950">{row.roast}</p>
                    <details className="mt-2 text-slate-600">
                      <summary className="cursor-pointer text-xs font-medium">Products to box · {row.sources.length}</summary>
                      <ul className="mt-3 space-y-3">
                        {row.sources.map((source) => <li key={source.productId}>
                          <Link href={`/admin/products/${encodeURIComponent(source.productId)}`} className="text-sm font-semibold text-teal-800 underline underline-offset-2">{source.productName}</Link>
                          <p className="mt-1 text-xs leading-relaxed">{number(source.bagCount)} bags for {number(source.unitsToMake)} finished {source.unitsToMake === 1 ? 'unit' : 'units'}</p>
                          {canRecordProduction ? <Link href={`/admin/production?produce_product=${encodeURIComponent(source.productId)}&produce_qty=${source.unitsToMake}`} className="mt-1 inline-block text-xs font-semibold text-teal-800 underline underline-offset-2">Record after boxing</Link> : null}
                        </li>)}
                      </ul>
                    </details>
                  </td>
                  <td className="whitespace-nowrap p-3 text-right align-top text-2xl font-bold tracking-tight text-teal-900 tabular-nums">{number(row.bagCount)}</td>
                  <td className="whitespace-nowrap p-3 pr-0 text-right align-top text-2xl font-bold tracking-tight text-teal-900 tabular-nums">{number(row.coffeeLb)} <span className="text-sm font-semibold">lb</span></td>
                </tr>)}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-teal-200 bg-teal-50 text-teal-950">
                  <th scope="row" colSpan={3} className="p-3 text-base font-bold">{roast.label} total weight{partial ? ' · partial' : ''}</th>
                  <td className="whitespace-nowrap p-3 text-right text-2xl font-bold tracking-tight tabular-nums">{number(roast.coffeeLb)} <span className="text-sm font-semibold">lb</span></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>)}
      </div>
    </section>) : <section className="card border-dashed" aria-labelledby="machine-empty-heading">
      <h3 id="machine-empty-heading" className="text-xl font-semibold text-slate-950">{partial ? 'Bag counts need recipe setup' : 'No machine-run bags needed'}</h3>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">{partial ? 'There is production to plan, but its bag sizes, roasts, or quantities could not be determined. Resolve the product issues above to see the machine run list.' : 'Recorded finished stock covers the planned need for fraction, filter, and sample bags, or there is no demand for them in this window.'}</p>
    </section>}
  </div>;
}
