import { UserWizard } from '@/components/user-wizard';
import { createClient } from '@/lib/supabase/server';

export default async function NewUserWizardPage() {
  const supabase = await createClient();
  const { data: products } = await supabase.from('products').select('id,name').eq('active', true);

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Customer Admin</span>
        <h1 className="page-title mt-4">Create user wizard</h1>
        <p className="page-subtitle mt-3">Set up a new customer account, assign products, and lock in pricing in a single guided flow.</p>
      </section>
      <UserWizard products={products ?? []} />
    </div>
  );
}
