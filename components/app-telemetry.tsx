'use client';

import { usePathname } from 'next/navigation';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

function withoutRecoveryEvents<T extends { url: string }>(event: T): T | null {
  try {
    const url = new URL(event.url);
    if (['/forgot-password', '/reset-password', '/auth/recovery'].includes(url.pathname)
      || url.searchParams.has('token_hash') || url.searchParams.has('code')) return null;
    return event;
  } catch {
    return null;
  }
}

export default function AppTelemetry() {
  const pathname = usePathname();
  // Password recovery URLs can contain one-time credentials. These pages never
  // participate in analytics or performance telemetry.
  if (!pathname || ['/forgot-password', '/reset-password', '/auth/recovery'].includes(pathname)) return null;
  return <><Analytics beforeSend={withoutRecoveryEvents} /><SpeedInsights beforeSend={withoutRecoveryEvents} /></>;
}
