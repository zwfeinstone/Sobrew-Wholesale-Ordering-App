'use server';

import { redirect } from 'next/navigation';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { requireCenterAccess } from '@/lib/admin-center-scope';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function resetCenterLoginPassword(formData: FormData) {
  const centerId = String(formData.get('center_id') ?? '');
  const memberId = String(formData.get('member_id') ?? '');
  const deniedHref = centerId ? `/admin/users/${centerId}?error=admin_write_denied` : '/admin/users';
  const current = await requireAdminWriteAccess(deniedHref, 'centers');
  if (!centerId || !memberId) redirect('/admin/users');
  await requireCenterAccess(centerId, deniedHref);

  const password = String(formData.get('password') ?? '');
  const confirmation = String(formData.get('confirm_password') ?? '');
  if (password.length < 8) redirect(`/admin/users/${centerId}?error=login_password_invalid`);
  if (password !== confirmation) redirect(`/admin/users/${centerId}?error=login_password_mismatch`);

  const profile = await supabaseAdmin.from('profiles').select('id')
    .eq('id', memberId).eq('center_id', centerId).eq('is_admin', false).maybeSingle();
  if (profile.error || !profile.data) redirect(`/admin/users/${centerId}?error=login_save_failed`);

  // Keep resets separate from profile saves. Never record password values.
  let resetFailed = false;
  try {
    const result = await supabaseAdmin.auth.admin.updateUserById(memberId, { password });
    resetFailed = Boolean(result.error);
  } catch {
    resetFailed = true;
  }
  if (resetFailed) redirect(`/admin/users/${centerId}?error=login_password_failed`);

  let auditFailed = false;
  try {
    const audit = await supabaseAdmin.from('admin_audit_log').insert({
      action: 'customer_password_reset',
      actor_profile_id: current.profile.id,
      target_profile_id: memberId,
      section_key: 'centers',
      after_value: { center_id: centerId, passwordReset: true, source: 'customer_login_reset' },
    });
    auditFailed = Boolean(audit.error);
  } catch {
    auditFailed = true;
  }
  if (auditFailed) {
    console.error('Customer password reset audit failed', { actorProfileId: current.profile.id, targetProfileId: memberId, centerId });
  }
  redirect(`/admin/users/${centerId}?success=login_password_reset${auditFailed ? '&warning=password_audit_failed' : ''}`);
}
