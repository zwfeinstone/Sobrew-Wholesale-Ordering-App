'use client';

import { useFormStatus } from 'react-dom';

type CheckoutSubmitButtonProps = {
  pending?: boolean;
};

export default function CheckoutSubmitButton({ pending: pendingOverride }: CheckoutSubmitButtonProps) {
  const { pending } = useFormStatus();
  const isPending = pendingOverride ?? pending;

  return (
    <button
      className="btn-primary w-full sm:w-auto disabled:cursor-not-allowed disabled:opacity-70"
      disabled={isPending}
      type="submit"
    >
      {isPending ? 'Placing order...' : 'Place order'}
    </button>
  );
}
