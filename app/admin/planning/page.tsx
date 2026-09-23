import Link from 'next/link';
import StatusToast from '@/components/status-toast';
import PendingSubmitButton from '@/components/pending-submit-button';
import { adminCanEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { buildProductionPlan } from '@/lib/production-planning';
import { loadProductionPlanningData } from '@/lib/production-planning-data';
import { planningView, planningViewHref } from '@/lib/production-planning-view';
import { createClient } from '@/lib/supabase/server';
import { updateCenterParLevel } from './actions';
import PlanningRefreshButton from './refresh-button';
import ProductionPlanningWorkspace from './workspace';

const TOASTS: Record<string, { message: string; tone: 'success' | 'error' }> = {
  production_recorded: { message: 'Completed production recorded. Inventory and the production plan are updated.', tone: 'success' },
  production_error: { message: 'Production was not recorded. Refresh the plan and check the recipe and materials.', tone: 'error' },
  recipe_error: { message: 'Production was not recorded. Check the product recipe and its materials.', tone: 'error' },
  insufficient_inventory: { message: 'Production was not recorded because a recipe material is short. Refresh the plan to see current stock.', tone: 'error' },
  unit_error: { message: 'Production was not recorded. A recipe material has missing or incompatible units.', tone: 'error' },
  invalid_quantity: { message: 'Enter a whole number greater than zero for the quantity actually made.', tone: 'error' },
  par_saved: { message: 'Stock target saved and the production plan updated.', tone: 'success' },
  par_error: { message: 'Stock target was not saved. Select a customer and product and use nonnegative whole quantities.', tone: 'error' },
  admin_write_denied: { message: 'You need edit access to Planning to record production or change stock targets.', tone: 'error' },
};

export default async function PlanningPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams ?? {};
  const access = await requireAdminSectionView('planning');
  const canEdit = adminCanEdit(access.access, 'planning');
  const view = planningView(params);
  const returnTo = planningViewHref(view);
  const now = new Date();
  const result = await loadProductionPlanningData(await createClient(), now);
  const toast = typeof params.toast === 'string' ? TOASTS[params.toast] : undefined;

  return <div className="space-y-6">
    {toast ? <StatusToast {...toast} /> : null}
    <section className="panel">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="eyebrow">Your production compass</span>
          <h1 className="page-title mt-3">What to make next</h1>
          <p className="page-subtitle mt-3 max-w-3xl">Work through customer needs first. Prepare recurring products two business days before their scheduled order, then consider replenishment.</p>
        </div>
        <div className="shrink-0 space-y-2 sm:text-right">
          <PlanningRefreshButton />
          {!result.error ? <p className="text-xs text-slate-600">Updated at <time dateTime={now.toISOString()}>{now.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time> CT</p> : null}
        </div>
      </div>
      {!canEdit ? <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">View only. A team member with Planning edit access can record completed production and change stock targets.</p> : null}
    </section>
    {result.error ? <section className="card border-rose-200" role="alert">
      <h2 className="text-xl font-semibold text-rose-950">Unable to load a complete production plan</h2>
      <p className="mt-2 text-sm text-slate-700">Recommendations are unavailable until all order, schedule, recipe, and inventory data can be loaded. Refresh to try again.</p>
      <details className="mt-3 text-sm text-slate-600"><summary className="cursor-pointer font-medium">What failed</summary><p className="mt-2">{result.error.message}</p></details>
    </section> : <>
      <ProductionPlanningWorkspace data={result.data} plan={buildProductionPlan(result.data.input)} view={view} canEdit={canEdit} returnTo={returnTo} />
      <details className="card">
        <summary className="cursor-pointer text-lg font-semibold text-slate-950">Customer stock targets</summary>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">Targets overlap customer demand. A target of 10 units with orders for 8 means 10 total units before those orders go out, leaving 2 afterward. Planning uses the larger of the combined par and minimum targets.</p>
        {result.data.parLevels.filter((par) => par.center_active).length ? <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm"><thead><tr className="border-b border-slate-200 text-slate-600"><th className="p-2">Customer</th><th className="p-2">Product</th><th className="p-2">Par</th><th className="p-2">Minimum</th></tr></thead><tbody>
            {result.data.parLevels.filter((par) => par.center_active).map((par) => <tr key={`${par.center_id}:${par.product_id}`} className="border-b border-slate-100"><td className="p-2">{par.customer_name}</td><td className="p-2">{result.data.input.products.find((product) => product.id === par.product_id)?.name ?? 'Unknown product'}</td><td className="p-2">{par.par_qty}</td><td className="p-2">{par.minimum_qty}</td></tr>)}
          </tbody></table>
        </div> : <p className="mt-3 text-sm text-slate-600">No active customer stock targets.</p>}
        {canEdit ? <form action={updateCenterParLevel} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input type="hidden" name="return_to" value={returnTo} />
          <label className="space-y-1 text-sm font-medium"><span>Customer</span><select className="input" name="center_id" required defaultValue=""><option value="" disabled>Select customer</option>{result.data.centers.map((center) => <option key={center.id} value={center.id}>{center.name || 'Unnamed customer'}</option>)}</select></label>
          <label className="space-y-1 text-sm font-medium"><span>Product</span><select className="input" name="product_id" required defaultValue=""><option value="" disabled>Select product</option>{result.data.input.products.filter((product) => product.active !== false).map((product) => <option key={product.id} value={product.id}>{product.name || 'Unnamed product'}</option>)}</select></label>
          <label className="space-y-1 text-sm font-medium"><span>Par target (units)</span><input className="input" name="par_qty" min="0" step="1" type="number" required defaultValue="0" /></label>
          <label className="space-y-1 text-sm font-medium"><span>Minimum target (units)</span><input className="input" name="minimum_qty" min="0" step="1" type="number" required defaultValue="0" /></label>
          <label className="space-y-1 text-sm font-medium md:col-span-2"><span>Notes</span><textarea className="input" name="notes" rows={2} /></label>
          <div className="self-end"><PendingSubmitButton className="btn-secondary" label="Save stock target" pendingLabel="Saving…" /></div>
        </form> : null}
      </details>
      <p className="text-xs leading-relaxed text-slate-500">All dates use Central Time. Preparation counts Monday–Friday, without holiday adjustments. Scheduled dates are order dates; delivery promises are not recorded here. <Link href="/admin/production" className="font-medium underline">View recorded production runs</Link></p>
    </>}
  </div>;
}
