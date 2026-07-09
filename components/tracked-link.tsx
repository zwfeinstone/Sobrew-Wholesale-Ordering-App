'use client';

import Link from 'next/link';
import { type ReactNode } from 'react';
import { type ProductEvent, trackProductEvent } from '@/lib/analytics';

export function TrackedLink({
  children,
  className,
  event,
  href,
  properties,
}: {
  children: ReactNode;
  className?: string;
  event: ProductEvent;
  href: string;
  properties?: Record<string, boolean | number | string | undefined>;
}) {
  return (
    <Link className={className} href={href} onClick={() => trackProductEvent(event, properties)}>
      {children}
    </Link>
  );
}
