'use client';

import { useFormStatus } from 'react-dom';

export default function LoginSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="btn-primary w-full"
      disabled={pending}
      type="submit"
      aria-busy={pending}
    >
      {pending ? 'Logging in...' : 'Sign in'}
    </button>
  );
}
