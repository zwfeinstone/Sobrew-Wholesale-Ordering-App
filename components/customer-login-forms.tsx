import PendingSubmitButton from '@/components/pending-submit-button';

type CustomerLoginFormsProps = {
  centerId: string;
  member: { id: string; email: string | null; full_name: string | null; is_active: boolean | null };
  saveAction: (formData: FormData) => Promise<void>;
  resetAction: (formData: FormData) => Promise<void>;
  removeAction: (formData: FormData) => Promise<void>;
};

export default function CustomerLoginForms({ centerId, member, saveAction, resetAction, removeAction }: CustomerLoginFormsProps) {
  return <>
    <form action={saveAction} className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center" aria-label={`Edit login for ${member.email}`}>
      <input type="hidden" name="center_id" value={centerId} />
      <input type="hidden" name="member_id" value={member.id} />
      <input className="input" name="full_name" defaultValue={member.full_name ?? ''} aria-label="Login name" placeholder="Login name" />
      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-medium text-slate-700">
        <input type="checkbox" name="is_active" defaultChecked={member.is_active === true} />
        Active
      </label>
      <PendingSubmitButton className="btn-primary w-full md:w-auto" label="Save Login" pendingLabel="Saving..." />
    </form>
    <details className="rounded-2xl border border-slate-200 p-4">
      <summary className="cursor-pointer font-medium text-slate-950">Reset password</summary>
      <p className="mt-3 text-sm text-slate-600">Set a new password for {member.email}. Their previous password will stop working.</p>
      <form action={resetAction} className="mt-3 grid gap-3 md:grid-cols-2" aria-label={`Reset password for ${member.email}`}>
        <input type="hidden" name="center_id" value={centerId} />
        <input type="hidden" name="member_id" value={member.id} />
        <label className="space-y-2 text-sm font-medium text-slate-700">
          New password
          <input className="input" name="password" type="password" minLength={8} required autoComplete="new-password" />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Confirm new password
          <input className="input" name="confirm_password" type="password" minLength={8} required autoComplete="new-password" />
        </label>
        <PendingSubmitButton className="btn-primary w-full md:w-auto md:justify-self-start" label="Reset Password" pendingLabel="Resetting..." />
      </form>
    </details>
    <form action={removeAction} className="w-full md:w-auto">
      <input type="hidden" name="center_id" value={centerId} />
      <input type="hidden" name="member_id" value={member.id} />
      <PendingSubmitButton className="btn-secondary w-full md:w-auto" label="Remove Login" pendingLabel="Removing..." />
    </form>
  </>;
}
