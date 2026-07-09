import { track } from '@vercel/analytics/server';

type ServerEvent = 'admin_operational_action_completed' | 'portal_order_submitted' | 'portal_recurring_enabled';

/** Records aggregate checkout outcomes without sending identifying data. */
export function trackServerProductEvent(event: ServerEvent, properties: Record<string, boolean | number | string> = {}) {
  try {
    track(event, properties);
  } catch {
    // Analytics must never prevent a completed order from reaching the customer.
  }
}
