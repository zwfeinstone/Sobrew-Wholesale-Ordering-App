import CheckoutForm from '@/components/checkout-form';
import { requireUser } from '@/lib/auth';
import { cartStorageKeyForUser } from '@/lib/cart';
import { getCenterCartProducts } from '@/lib/center-cart-products';
import { createClient } from '@/lib/supabase/server';

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const { user, profile } = await requireUser();
  const supabase = await createClient();
  const cartStorageKey = cartStorageKeyForUser(user.id);
  const searchToast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const initialToast =
    searchToast === 'invalid_cart' || searchToast === 'checkout_error' || searchToast === 'location_required'
      ? searchToast
      : '';
  const centerId = profile?.center_id ?? user.id;
  const [{ data: locations }, cartProducts] = await Promise.all([
    supabase
      .from('center_locations')
      .select('id,name,address1,address2,city,state,zip')
      .eq('center_id', centerId)
      .eq('is_active', true)
      .order('name', { ascending: true }),
    getCenterCartProducts(supabase, centerId),
  ]);

  return (
    <CheckoutForm
      actionUrl="/portal/checkout/submit"
      cartStorageKey={cartStorageKey}
      initialToast={initialToast}
      locations={locations ?? []}
      products={cartProducts}
    />
  );
}
