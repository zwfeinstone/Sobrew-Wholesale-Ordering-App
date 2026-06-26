import type { AdminPermissionKey } from '@/lib/admin-permission-definitions';

type SupabaseLike = {
  from: (table: string) => any;
};

export async function recordAdminAuditLog({
  action,
  actorProfileId,
  after,
  before,
  sectionKey,
  supabase,
  targetProfileId,
}: {
  action: string;
  actorProfileId?: string | null;
  after?: unknown;
  before?: unknown;
  sectionKey?: AdminPermissionKey | string | null;
  supabase: SupabaseLike;
  targetProfileId?: string | null;
}) {
  await supabase.from('admin_audit_log').insert({
    action,
    actor_profile_id: actorProfileId ?? null,
    after_value: after ?? null,
    before_value: before ?? null,
    section_key: sectionKey ?? null,
    target_profile_id: targetProfileId ?? null,
  });
}
