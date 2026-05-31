import { supabaseAdmin } from '@/lib/supabase/admin';

const LAST_SEEN_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

type AuthUserForLastSeen = {
  id: string;
  app_metadata?: Record<string, unknown> | null;
};

export function lastSeenAtFromAppMetadata(user: AuthUserForLastSeen | null | undefined) {
  const value = user?.app_metadata?.last_seen_at;
  return typeof value === 'string' ? value : null;
}

function shouldUpdateLastSeen(previousValue: string | null, now: Date) {
  if (!previousValue) return true;

  const previous = new Date(previousValue);
  if (Number.isNaN(previous.getTime())) return true;

  return now.getTime() - previous.getTime() >= LAST_SEEN_UPDATE_INTERVAL_MS;
}

export async function recordUserLastSeen(user: AuthUserForLastSeen, now = new Date()) {
  const previousValue = lastSeenAtFromAppMetadata(user);
  if (!shouldUpdateLastSeen(previousValue, now)) return;

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...(user.app_metadata ?? {}),
      last_seen_at: now.toISOString(),
    },
  });

  if (error) {
    console.error('[last-seen] failed to update user activity', { userId: user.id, message: error.message });
  }
}
