'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ADMIN_SECTION_LABELS, adminSectionForPath, type AdminPermissionKey } from '@/lib/admin-permission-definitions';

function readOnlyMessage(sectionKey: AdminPermissionKey | null) {
  const sectionName = sectionKey ? ADMIN_SECTION_LABELS[sectionKey] : 'this section';
  return `You have read-only access to ${sectionName}.`;
}

function isMutatingAdminForm(form: HTMLFormElement) {
  if (form.dataset.adminSelfService === 'true') return false;
  const method = (form.getAttribute('method') || form.method || 'get').toLowerCase();
  const action = form.getAttribute('action') || '';
  const hasServerAction = Array.from(form.elements).some((element) => {
    return element instanceof HTMLInputElement && element.name.startsWith('$ACTION_');
  });

  return method === 'post' || hasServerAction || action.startsWith('/api/admin') || action.startsWith('javascript:');
}

function disableSubmitControls(form: HTMLFormElement, message: string) {
  const controls = Array.from(
    form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button[type="submit"], button:not([type]), input[type="submit"]'),
  );
  if (!controls.length) return false;
  if (form.dataset.adminReadonly === 'true') return true;

  form.dataset.adminReadonly = 'true';
  controls.forEach((control) => {
    control.disabled = true;
    control.setAttribute('aria-disabled', 'true');
    control.title = message;
  });
  return true;
}

function disableCreateLinks(message: string) {
  let foundReadOnlyLink = false;
  document.querySelectorAll<HTMLAnchorElement>('main a[href="/admin/users/new"], main a[href="/admin/admins/new"], main a[href="/admin/products/new"]').forEach((link) => {
    foundReadOnlyLink = true;
    if (link.dataset.adminReadonly === 'true') return;
    link.dataset.adminReadonly = 'true';
    link.classList.add('admin-readonly-disabled');
    link.setAttribute('aria-disabled', 'true');
    link.title = message;
    link.addEventListener('click', preventReadOnlyNavigation);
  });
  return foundReadOnlyLink;
}

function preventReadOnlyNavigation(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export function AdminReadOnlyGuard({
  editableSections,
  isOwner,
}: {
  editableSections: Record<string, boolean>;
  isOwner: boolean;
}) {
  const [hasReadOnlySurface, setHasReadOnlySurface] = useState(false);
  const pathname = usePathname();
  const sectionKey = adminSectionForPath(pathname);
  const canEditSection = isOwner || (sectionKey ? Boolean(editableSections[sectionKey]) : true);
  const message = readOnlyMessage(sectionKey);

  useEffect(() => {
    if (canEditSection) {
      setHasReadOnlySurface(false);
      return;
    }

    const applyReadOnlyState = () => {
      let foundReadOnlySurface = false;
      document.querySelectorAll<HTMLFormElement>('main form').forEach((form) => {
        if (isMutatingAdminForm(form)) {
          foundReadOnlySurface = disableSubmitControls(form, message) || foundReadOnlySurface;
        }
      });
      foundReadOnlySurface = disableCreateLinks(message) || foundReadOnlySurface;
      setHasReadOnlySurface(foundReadOnlySurface);
    };

    applyReadOnlyState();
    const main = document.querySelector('main');
    const observer = new MutationObserver(applyReadOnlyState);
    if (main) {
      observer.observe(main, { childList: true, subtree: true });
    }

    return () => {
      observer.disconnect();
      document.querySelectorAll<HTMLAnchorElement>('main a.admin-readonly-disabled').forEach((link) => {
        link.removeEventListener('click', preventReadOnlyNavigation);
      });
    };
  }, [canEditSection, message, pathname]);

  if (canEditSection || !hasReadOnlySurface) return null;

  return (
    <div className="fixed inset-x-3 bottom-4 z-50 mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 shadow-lg shadow-slate-900/10">
      {message}
    </div>
  );
}
