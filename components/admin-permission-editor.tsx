'use client';

import { useMemo, useState } from 'react';
import {
  ADMIN_PERMISSION_GROUPS,
  ADMIN_ROLE_PRESETS,
  ADMIN_SECTION_LABELS,
  ADMIN_PERMISSION_KEYS,
  canViewAdminSection,
  normalizeAccessMap,
  ownerAccessMap,
  type AdminAccessMap,
  type AdminPermissionKey,
} from '@/lib/admin-permission-definitions';

function cloneAccess(access: AdminAccessMap, allowManageAdmins: boolean) {
  const normalized = normalizeAccessMap(
    ADMIN_PERMISSION_KEYS.reduce<Partial<Record<AdminPermissionKey, { canEdit: boolean; canView: boolean }>>>((copy, key) => {
      copy[key] = { ...access[key] };
      return copy;
    }, {})
  );
  if (!allowManageAdmins) {
    normalized.manage_admins = { canEdit: false, canView: false };
    normalized.sales_admin = { canEdit: false, canView: false };
    normalized.payroll = { canEdit: false, canView: false };
    normalized.commission = { ...normalized.commission, canEdit: false };
    normalized.time_clock = { ...normalized.time_clock, canEdit: false };
    normalized.week_hours = { ...normalized.week_hours, canEdit: false };
  }
  return normalized;
}

function visibleLabels(access: AdminAccessMap) {
  return ADMIN_PERMISSION_KEYS
    .filter((key) => key !== 'reports' && key !== 'manage_admins' && canViewAdminSection(access, key))
    .map((key) => ADMIN_SECTION_LABELS[key]);
}

export function AdminPermissionEditor({
  allowManageAdmins = false,
  disabled = false,
  initialAccess,
  initialSuperadmin = false,
  showSuperadminToggle = false,
  superadminDisabled = false,
}: {
  allowManageAdmins?: boolean;
  disabled?: boolean;
  initialAccess: AdminAccessMap;
  initialSuperadmin?: boolean;
  showSuperadminToggle?: boolean;
  superadminDisabled?: boolean;
}) {
  const [isSuperadmin, setIsSuperadmin] = useState(initialSuperadmin);
  const [access, setAccess] = useState(() => cloneAccess(initialSuperadmin ? ownerAccessMap() : initialAccess, allowManageAdmins && initialSuperadmin));
  const displayedAccess = useMemo(() => (isSuperadmin ? ownerAccessMap() : access), [access, isSuperadmin]);
  const controlsDisabled = disabled || isSuperadmin;
  const allowRestrictedPermissions = allowManageAdmins && isSuperadmin;
  const visible = useMemo(() => visibleLabels(displayedAccess), [displayedAccess]);

  function setSuperadmin(checked: boolean) {
    setIsSuperadmin(checked);
    if (checked) {
      setAccess(cloneAccess(ownerAccessMap(), true));
    } else {
      setAccess((current) => cloneAccess(current, false));
    }
  }

  function setPermission(key: AdminPermissionKey, field: 'canEdit' | 'canView', checked: boolean) {
    if (isSuperadmin) return;
    setAccess((current) => {
      if (key === 'manage_admins' && !allowRestrictedPermissions) return current;
      if ((key === 'sales_admin' || key === 'payroll') && !allowRestrictedPermissions) return current;
      if (key === 'commission' && field === 'canEdit' && !allowRestrictedPermissions) return current;
      if (key === 'time_clock' && field === 'canEdit' && !allowRestrictedPermissions) return current;
      if (key === 'week_hours' && field === 'canEdit') return current;
      const next = cloneAccess(current, allowRestrictedPermissions);
      if (field === 'canEdit') {
        next[key] = { canEdit: checked, canView: checked || next[key].canView };
      } else {
        next[key] = { canEdit: checked ? next[key].canEdit : false, canView: checked };
      }
      return normalizeAccessMap(next);
    });
  }

  function applyPreset(presetKey: string) {
    const preset = ADMIN_ROLE_PRESETS.find((role) => role.key === presetKey);
    if (!preset) return;
    if (preset.key === 'owner' && showSuperadminToggle) {
      setSuperadmin(true);
      return;
    }
    setIsSuperadmin(false);
    setAccess(cloneAccess(preset.permissions, false));
  }

  return (
    <div className="space-y-5">
      {showSuperadminToggle ? (
        <label className="flex items-start gap-3 rounded-2xl border border-teal-100 bg-teal-50/70 px-4 py-3 text-sm text-teal-950">
          <input
            checked={isSuperadmin}
            disabled={disabled || superadminDisabled}
            name="is_superadmin"
            onChange={(event) => setSuperadmin(event.target.checked)}
            type="checkbox"
          />
          {superadminDisabled && isSuperadmin ? <input name="is_superadmin" type="hidden" value="on" /> : null}
          <span>
            <span className="block font-semibold">Superadmin full access</span>
            <span className="mt-1 block leading-5 text-teal-800">Can see and edit every admin screen, manage admin accounts, payroll, permissions, and sales assignments.</span>
          </span>
        </label>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ADMIN_ROLE_PRESETS.map((preset) => (
          <button
            key={preset.key}
            className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-left transition-all duration-200 hover:border-teal-200 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => applyPreset(preset.key)}
            type="button"
          >
            <span className="block font-semibold text-slate-950">{preset.label}</span>
            <span className="mt-1 block text-sm leading-5 text-slate-500">{preset.description}</span>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-teal-100 bg-teal-50/60 p-4 text-sm text-teal-900">
        <p className="font-semibold">Permission preview</p>
        <p className="mt-1 leading-6">
          {visible.length ? `This admin will see: ${visible.join(', ')}.` : 'This admin will not see any admin tabs yet.'}
        </p>
      </div>

      <div className="space-y-5">
        {ADMIN_PERMISSION_GROUPS.map((group) => (
          <div key={group.label} className="space-y-3">
            <h3 className="border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{group.label}</h3>
            <div className="space-y-2">
              {group.keys.map((key) => (
                <div key={key} className="grid gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4 sm:grid-cols-[minmax(0,1fr)_7rem_7rem] sm:items-center">
                  <div>
                    <p className="font-semibold text-slate-950">{ADMIN_SECTION_LABELS[key]}</p>
                    {key === 'reports_profitability' ? <p className="mt-1 text-xs text-slate-500">Controls margin, COGS, profitability, production, and inventory value report screens.</p> : null}
                    {key === 'reports_sales' ? <p className="mt-1 text-xs text-slate-500">Controls sales and customer reporting without margin visibility.</p> : null}
                    {key === 'marketing' ? <p className="mt-1 text-xs text-slate-500">Weekly marketing recaps. View can read the team history, edit can save and manage recaps.</p> : null}
                    {key === 'manage_admins' ? <p className="mt-1 text-xs text-slate-500">Superadmin-only admin creation, permissions, and audit access.</p> : null}
                    {key === 'time_clock' ? <p className="mt-1 text-xs text-slate-500">View lets admins clock their own time. Edit is superadmin-only for payroll review.</p> : null}
                    {key === 'week_hours' ? <p className="mt-1 text-xs text-slate-500">View-only self-service page for employees to see their own week, month, and YTD hours.</p> : null}
                    {key === 'sales_admin' ? <p className="mt-1 text-xs text-slate-500">Superadmin-only center assignment and sales team commission totals.</p> : null}
                    {key === 'commission' ? <p className="mt-1 text-xs text-slate-500">View lets sales admins see their own monthly commission statements.</p> : null}
                    {key === 'payroll' ? <p className="mt-1 text-xs text-slate-500">Superadmin-only payroll setup, rates, and commission percentages.</p> : null}
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      checked={displayedAccess[key].canView}
                      disabled={controlsDisabled || ((key === 'manage_admins' || key === 'sales_admin' || key === 'payroll') && !allowRestrictedPermissions)}
                      name={`view_${key}`}
                      onChange={(event) => setPermission(key, 'canView', event.target.checked)}
                      type="checkbox"
                    />
                    View
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      checked={displayedAccess[key].canEdit}
                      disabled={controlsDisabled || key === 'week_hours' || ((key === 'manage_admins' || key === 'sales_admin' || key === 'payroll' || key === 'commission' || key === 'time_clock') && !allowRestrictedPermissions)}
                      name={`edit_${key}`}
                      onChange={(event) => setPermission(key, 'canEdit', event.target.checked)}
                      type="checkbox"
                    />
                    Edit
                  </label>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
