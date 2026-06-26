import Link from 'next/link';
import { ADMIN_SECTION_LABELS, type AdminPermissionKey } from '@/lib/admin-permission-definitions';
import { getCurrentAdminAccess } from '@/lib/admin-permissions';

function sectionLabel(value: string | string[] | undefined) {
  const sectionKey = typeof value === 'string' ? value : '';
  return sectionKey in ADMIN_SECTION_LABELS
    ? ADMIN_SECTION_LABELS[sectionKey as AdminPermissionKey]
    : 'this admin section';
}

export default async function AdminAccessDeniedPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const current = await getCurrentAdminAccess();
  const label = sectionLabel(searchParams?.section);

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Access denied</span>
        <h1 className="page-title mt-4">You do not have access to {label}.</h1>
        <p className="page-subtitle mt-3">Only tabs and screens granted by Zach are available in this admin account.</p>
      </section>
      <section className="card flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <p>Go to the first admin section available for this login.</p>
        <Link className="btn-primary w-full sm:w-auto" href={current.firstAllowedHref}>
          Open Allowed Section
        </Link>
      </section>
    </div>
  );
}
