'use client';

import { useFormStatus } from 'react-dom';

export default function CheckoutSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="btn-primary w-full sm:w-auto disabled:cursor-not-allowed disabled:opacity-70"
      disabled={pending}
      type="submit"
    >
      {pending ? 'Placing order...' : 'Place order'}
    </button>
  );
}
