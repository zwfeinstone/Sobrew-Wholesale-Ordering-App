import type { SupabaseClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';

const LAST_SEEN_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const MAX_SCHEDULED_USERS = 2_000;
const scheduledAtByUserId = new Map<string, number>();

type AuthenticatedRpcClient = Pick<SupabaseClient, 'rpc'>;

export async function recordUserLastSeen(supabase: AuthenticatedRpcClient, userId: string) {
  const { error } = await supabase.rpc('touch_profile_last_seen');

  if (error) {
    console.error('[last-seen] failed to update user activity', { userId, message: error.message });
    return false;
  }

  return true;
}

/**
 * Starts the throttled activity update without holding up a render, action, or
 * checkout response. The process-local guard avoids scheduling the same user
 * repeatedly while the database RPC provides the durable cross-instance guard.
 *
 * profiles.last_seen_at is canonical; the authenticated RPC derives auth.uid()
 * server-side and performs the durable five-minute database throttle.
 */
export function scheduleUserLastSeen(supabase: AuthenticatedRpcClient, userId: string, now = new Date()) {
  const lastScheduledAt = scheduledAtByUserId.get(userId) ?? 0;
  if (now.getTime() - lastScheduledAt < LAST_SEEN_UPDATE_INTERVAL_MS) return;

  if (scheduledAtByUserId.size >= MAX_SCHEDULED_USERS) {
    const oldestUserId = scheduledAtByUserId.keys().next().value;
    if (oldestUserId) scheduledAtByUserId.delete(oldestUserId);
  }
  scheduledAtByUserId.set(userId, now.getTime());

  const activityUpdate = recordUserLastSeen(supabase, userId)
    .then((updated) => {
      if (!updated) scheduledAtByUserId.delete(userId);
    })
    .catch((error) => {
      scheduledAtByUserId.delete(userId);
      console.error('[last-seen] unexpected activity update failure', {
        userId,
        message: error instanceof Error ? error.message : String(error),
      });
    });

  waitUntil(activityUpdate);
}
