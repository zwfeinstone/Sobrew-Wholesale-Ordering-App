'use client';

import { MouseEvent } from 'react';
import { useFormStatus } from 'react-dom';

type ConfirmSubmitButtonProps = {
  className: string;
  confirmMessage: string;
  label: string;
  pendingLabel?: string;
};

export default function ConfirmSubmitButton({
  className,
  confirmMessage,
  label,
  pendingLabel,
}: ConfirmSubmitButtonProps) {
  const { pending } = useFormStatus();

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (pending) return;
    if (!window.confirm(confirmMessage)) {
      event.preventDefault();
    }
  };

  return (
    <button
      className={className}
      disabled={pending}
      type="submit"
      onClick={handleClick}
    >
      {pending ? pendingLabel ?? label : label}
    </button>
  );
}
