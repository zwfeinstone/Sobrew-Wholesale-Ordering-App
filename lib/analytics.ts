'use client';

import { track } from '@vercel/analytics';

type ProductEventProperties = Record<string, boolean | number | string | undefined>;

export type ProductEvent =
  | 'admin_attention_opened'
  | 'admin_operational_action_completed'
  | 'portal_checkout_started'
  | 'portal_item_added'
  | 'portal_reorder_added';

/** Records privacy-safe product signals only. */
export function trackProductEvent(event: ProductEvent, properties: ProductEventProperties = {}) {
  if (typeof window === 'undefined') return;

  track(event, Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined)));
}
