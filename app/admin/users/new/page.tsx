import { UserWizard } from '@/components/user-wizard';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';

export default async function NewUserWizardPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  await requireAdminSectionView('centers');
  const supabase = await createClient();
  const { data: products } = await supabase.from('products').select('id,name,category').eq('active', true).order('name', { ascending: true });
  const error = typeof searchParams?.error === 'string' ? searchParams.error : '';

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Center Admin</span>
        <h1 className="page-title mt-4">Create center wizard</h1>
        <p className="page-subtitle mt-3">Add the customer’s address, first login, and invoice recipients, choose their order guide, and connect them to QuickBooks.</p>
      </section>
      {error ? (
        <div className="card text-sm text-red-700">
          {error === 'admin_write_denied'
            ? 'You do not have permission to create customers.'
            : error === 'address_required'
              ? 'A complete US street address, city, state, and valid ZIP code are required. No customer or login was created, and no welcome email was sent.'
            : error === 'address_save_failed'
              ? 'The address could not be saved. No login was created or welcome email sent. Please try again.'
            : error === 'missing'
              ? 'Enter a customer name, valid login email, and temporary password of at least 8 characters.'
            : error === 'catalog_invalid'
              ? 'The selected order guide could not be read. Please review the selected products and try again.'
            : error === 'billing_email_invalid'
              ? 'Enter a valid invoice email address separately from the login email. No customer or login was created, and no welcome email was sent.'
            : error === 'billing_cc_invalid'
              ? 'Enter up to 20 valid invoice CC email addresses, separated by commas, semicolons, or new lines. No customer or login was created, and no welcome email was sent.'
            : 'Could not create the center right now. Check the login email and try again.'}
        </div>
      ) : null}
      <UserWizard products={products ?? []} />
    </div>
  );
}
