import CheckoutForm from '@/components/checkout-form';
import { requireUser } from '@/lib/auth';
import { cartStorageKeyForUser } from '@/lib/cart';

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const { user } = await requireUser();
  const cartStorageKey = cartStorageKeyForUser(user.id);
  const searchToast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const initialToast =
    searchToast === 'invalid_cart' || searchToast === 'checkout_error'
      ? searchToast
      : '';

  return <CheckoutForm actionUrl="/portal/checkout/submit" cartStorageKey={cartStorageKey} initialToast={initialToast} />;
}
