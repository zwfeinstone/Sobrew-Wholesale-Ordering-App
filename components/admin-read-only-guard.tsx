'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const READ_ONLY_MESSAGE = 'Read-only admin accounts cannot change admin data.';

function isMutatingAdminForm(form: HTMLFormElement) {
  const method = (form.getAttribute('method') || form.method || 'get').toLowerCase();
  const action = form.getAttribute('action') || '';
  const hasServerAction = Array.from(form.elements).some((element) => {
    return element instanceof HTMLInputElement && element.name.startsWith('$ACTION_');
  });

  return method === 'post' || hasServerAction || action.startsWith('/api/admin') || action.startsWith('javascript:');
}

function disableSubmitControls(form: HTMLFormElement) {
  if (form.dataset.adminReadonly === 'true') return;
  form.dataset.adminReadonly = 'true';
  form
    .querySelectorAll<HTMLButtonElement | HTMLInputElement>('button[type="submit"], button:not([type]), input[type="submit"]')
    .forEach((control) => {
      control.disabled = true;
      control.setAttribute('aria-disabled', 'true');
      control.title = READ_ONLY_MESSAGE;
    });
}

function disableCreateLinks() {
  document.querySelectorAll<HTMLAnchorElement>('main a[href="/admin/users/new"], main a[href="/admin/products/new"]').forEach((link) => {
    if (link.dataset.adminReadonly === 'true') return;
    link.dataset.adminReadonly = 'true';
    link.classList.add('admin-readonly-disabled');
    link.setAttribute('aria-disabled', 'true');
    link.title = READ_ONLY_MESSAGE;
    link.addEventListener('click', preventReadOnlyNavigation);
  });
}

function preventReadOnlyNavigation(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export function AdminReadOnlyGuard({ canWrite }: { canWrite: boolean }) {
  const pathname = usePathname();

  useEffect(() => {
    if (canWrite) return;

    const applyReadOnlyState = () => {
      document.querySelectorAll<HTMLFormElement>('main form').forEach((form) => {
        if (isMutatingAdminForm(form)) disableSubmitControls(form);
      });
      disableCreateLinks();
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
  }, [canWrite, pathname]);

  return null;
}
