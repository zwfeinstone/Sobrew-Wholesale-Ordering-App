'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

type ProspectingRecordNavLinkProps = {
  children: ReactNode;
  className?: string;
  formId: string;
  href: string;
  targetLabel: string;
  targetRecordId: string;
};

const IGNORED_FORM_FIELDS = new Set(['save_redirect_record_id']);

function formSnapshot(form: HTMLFormElement) {
  const entries: Array<[string, string]> = [];
  const formData = new FormData(form);
  formData.forEach((value, key) => {
    if (IGNORED_FORM_FIELDS.has(key)) return;
    entries.push([
      key,
      value instanceof File ? `${value.name}:${value.size}:${value.lastModified}` : String(value),
    ]);
  });
  entries.sort(([keyA, valueA], [keyB, valueB]) => keyA.localeCompare(keyB) || valueA.localeCompare(valueB));
  return JSON.stringify(entries);
}

function setHiddenFormValue(form: HTMLFormElement, name: string, value: string) {
  const existing = form.elements.namedItem(name);
  const input = existing instanceof HTMLInputElement ? existing : document.createElement('input');
  input.type = 'hidden';
  input.name = name;
  input.value = value;
  if (!input.parentElement) form.appendChild(input);
}

export default function ProspectingRecordNavLink({
  children,
  className,
  formId,
  href,
  targetLabel,
  targetRecordId,
}: ProspectingRecordNavLinkProps) {
  const initialSnapshot = useRef<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return undefined;

    initialSnapshot.current = formSnapshot(form);
    const handleSubmit = () => setIsSubmitting(true);
    form.addEventListener('submit', handleSubmit);

    return () => {
      form.removeEventListener('submit', handleSubmit);
    };
  }, [formId]);

  function hasUnsavedChanges() {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement) || initialSnapshot.current === null) return false;
    return formSnapshot(form) !== initialSnapshot.current;
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const latestDirtyState = hasUnsavedChanges();
    if (!latestDirtyState) return;
    event.preventDefault();
    setDialogOpen(true);
  }

  function continueWithoutSaving() {
    window.location.assign(href);
  }

  function saveAndContinue() {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) {
      window.location.assign(href);
      return;
    }
    if (!form.reportValidity()) return;
    setHiddenFormValue(form, 'save_redirect_record_id', targetRecordId);
    setIsSubmitting(true);
    form.requestSubmit();
  }

  return (
    <>
      <Link className={className} href={href} onClick={handleClick}>{children}</Link>
      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <div aria-modal="true" className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-2xl" role="dialog">
            <h2 className="text-lg font-semibold text-slate-950">Unsaved changes</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Save your changes before moving to {targetLabel}?
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <button className="btn-secondary justify-center" disabled={isSubmitting} onClick={() => setDialogOpen(false)} type="button">
                Stay Here
              </button>
              <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700" disabled={isSubmitting} onClick={continueWithoutSaving} type="button">
                Do Not Save
              </button>
              <button className="btn-primary justify-center" disabled={isSubmitting} onClick={saveAndContinue} type="button">
                {isSubmitting ? 'Saving...' : 'Save and Go'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
