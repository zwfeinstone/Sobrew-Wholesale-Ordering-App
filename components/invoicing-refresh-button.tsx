'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export default function InvoicingRefreshButton({
  label,
  pendingLabel = 'Refreshing...',
}: {
  label: string;
  pendingLabel?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      aria-busy={isPending}
      className="btn-secondary shrink-0 text-center"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
      type="button"
    >
      {isPending ? pendingLabel : label}
    </button>
  );
}
