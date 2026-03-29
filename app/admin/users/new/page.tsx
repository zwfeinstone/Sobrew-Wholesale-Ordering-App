import { UserWizard } from '@/components/user-wizard';
import { createClient } from '@/lib/supabase/server';

export default async function NewUserWizardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const { data: products } = await supabase.from('products').select('id,name').eq('active', true);
  const error = typeof searchParams?.error === 'string' ? searchParams.error : '';

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Center Admin</span>
        <h1 className="page-title mt-4">Create center wizard</h1>
        <p className="page-subtitle mt-3">Set up a new center, create its first login, and assign shared products and pricing in one guided flow.</p>
      </section>
      {error ? <div className="card text-sm text-red-700">Could not create the center right now. Check the login email and try again.</div> : null}
      <UserWizard products={products ?? []} />
    </div>
  );
}
