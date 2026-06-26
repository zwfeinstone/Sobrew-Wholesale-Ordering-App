'use client';

export type SalesAdminBulkCenter = {
  assignedProfileId: string;
  assignedProfileLabel: string;
  id: string;
  isActive: boolean;
  name: string;
};

export type SalesAdminBulkRep = {
  id: string;
  label: string;
};

export function SalesAdminBulkAssignment({
  action,
  assignedRepFilter,
  centers,
  commissionMonth,
  salesRepFilter,
  salesReps,
  search,
  statusFilter,
}: {
  action: (formData: FormData) => void | Promise<void>;
  assignedRepFilter: string;
  centers: SalesAdminBulkCenter[];
  commissionMonth: string;
  salesRepFilter: string;
  salesReps: SalesAdminBulkRep[];
  search: string;
  statusFilter: string;
}) {
  function setAllVisible(checked: boolean) {
    const checkboxes = document.querySelectorAll<HTMLInputElement>('[data-bulk-center-checkbox="true"]');
    checkboxes.forEach((checkbox) => {
      checkbox.checked = checked;
    });
  }

  function updateCount() {
    const count = document.querySelectorAll<HTMLInputElement>('[data-bulk-center-checkbox="true"]:checked').length;
    const counter = document.querySelector<HTMLElement>('[data-bulk-center-count="true"]');
    if (counter) counter.textContent = `${count} selected`;
  }

  return (
    <section className="card space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Bulk center assignment</h2>
          <p className="mt-1 text-sm text-slate-500">Filter centers, select visible rows, then assign or unassign them in one action.</p>
        </div>
        <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700" data-bulk-center-count="true">
          0 selected
        </span>
      </div>

      <form className="grid gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 md:grid-cols-[1fr_12rem_14rem_auto] md:items-end">
        <input name="month" type="hidden" value={commissionMonth} />
        <input name="sales_rep" type="hidden" value={salesRepFilter} />
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Search centers
          <input className="input" name="q" placeholder="Center name" defaultValue={search} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Status
          <select className="input" name="center_status" defaultValue={statusFilter}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Current rep
          <select className="input" name="assigned_rep" defaultValue={assignedRepFilter}>
            <option value="all">All centers</option>
            <option value="unassigned">Unassigned only</option>
            {salesReps.map((rep) => (
              <option key={rep.id} value={rep.id}>{rep.label}</option>
            ))}
          </select>
        </label>
        <button className="btn-secondary w-full md:w-auto" type="submit">Filter</button>
      </form>

      <form action={action} className="space-y-4">
        <input name="month" type="hidden" value={commissionMonth} />
        <input name="sales_rep" type="hidden" value={salesRepFilter} />
        <input name="assigned_rep" type="hidden" value={assignedRepFilter} />
        <input name="center_status" type="hidden" value={statusFilter} />
        <input name="q" type="hidden" value={search} />

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 lg:grid-cols-[12rem_1fr_auto_auto] lg:items-end">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Bulk action
            <select className="input" name="bulk_action" defaultValue="assign">
              <option value="assign">Assign selected</option>
              <option value="unassign">Unassign selected</option>
            </select>
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Sales rep
            <select className="input" name="sales_profile_id" defaultValue="">
              <option value="">Choose sales rep</option>
              {salesReps.map((rep) => (
                <option key={rep.id} value={rep.id}>{rep.label}</option>
              ))}
            </select>
          </label>
          <button
            className="btn-secondary w-full lg:w-auto"
            type="button"
            onClick={() => {
              setAllVisible(true);
              updateCount();
            }}
          >
            Select visible
          </button>
          <button
            className="btn-secondary w-full lg:w-auto"
            type="button"
            onClick={() => {
              setAllVisible(false);
              updateCount();
            }}
          >
            Clear selection
          </button>
        </div>

        {!salesReps.length ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-800">
            Mark at least one admin as a Sales Rep in Payroll before assigning centers.
          </div>
        ) : null}
        {!centers.length ? (
          <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">
            No centers match the selected filters.
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-separate border-spacing-y-2 text-left text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-4 py-2">Select</th>
                <th className="px-4 py-2">Center</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Current sales rep</th>
              </tr>
            </thead>
            <tbody>
              {centers.map((center) => (
                <tr key={center.id} className="bg-white/65">
                  <td className="rounded-l-xl px-4 py-3">
                    <input
                      data-bulk-center-checkbox="true"
                      name="center_id"
                      onChange={updateCount}
                      type="checkbox"
                      value={center.id}
                    />
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-950">{center.name}</td>
                  <td className="px-4 py-3 text-slate-700">{center.isActive ? 'Active' : 'Inactive'}</td>
                  <td className="rounded-r-xl px-4 py-3 text-slate-700">{center.assignedProfileLabel || 'Unassigned'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button className="btn-primary w-full sm:w-auto" disabled={!salesReps.length || !centers.length} type="submit">
          Apply bulk assignment
        </button>
      </form>
    </section>
  );
}
