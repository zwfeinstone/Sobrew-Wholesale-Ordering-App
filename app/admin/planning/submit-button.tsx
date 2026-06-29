'use client';

import { useFormStatus } from 'react-dom';

export default function PlanningSubmitButton({ disabled = false }: { disabled?: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button className="btn-primary w-full" disabled={disabled || pending} type="submit" aria-busy={pending}>
      {pending ? 'Adding...' : 'Add Production'}
    </button>
  );
}
