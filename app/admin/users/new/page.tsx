import { UserWizard } from '@/components/user-wizard';
import { createClient } from '@/lib/supabase/server';

export default async function NewUserWizardPage() {
  const supabase = await createClient();
  const { data: products } = await supabase.from('products').select('id,name').eq('active', true);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Create user wizard</h1>
      <UserWizard products={products ?? []} />
    </div>
  );
}
