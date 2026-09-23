'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function PlanningRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" className="btn-secondary" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? 'Refreshing…' : 'Refresh plan'}</button>;
}
