'use client';

import { useFormStatus } from 'react-dom';

export default function LoginSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-70"
      disabled={pending}
      type="submit"
    >
      {pending ? 'Logging in...' : 'Sign in'}
    </button>
  );
}
