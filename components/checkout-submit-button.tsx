'use client';

import { useFormStatus } from 'react-dom';

type CheckoutSubmitButtonProps = {
  disabled?: boolean;
  disabledLabel?: string;
  pending?: boolean;
};

export default function CheckoutSubmitButton({ disabled = false, disabledLabel = 'Add items to checkout', pending: pendingOverride }: CheckoutSubmitButtonProps) {
  const { pending } = useFormStatus();
  const isPending = pendingOverride ?? pending;
  const isDisabled = disabled || isPending;

  return (
    <button
      className="btn-primary w-full sm:w-auto"
      disabled={isDisabled}
      type="submit"
      aria-busy={isPending}
    >
      {isPending ? 'Placing order...' : disabled ? disabledLabel : 'Place order'}
    </button>
  );
}
