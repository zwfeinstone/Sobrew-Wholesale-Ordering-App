'use client';

import { ButtonHTMLAttributes } from 'react';
import { useFormStatus } from 'react-dom';

type PendingSubmitButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> & {
  disabledLabel?: string;
  label: string;
  pendingLabel?: string;
};

export default function PendingSubmitButton({
  className = 'btn-primary',
  disabled = false,
  disabledLabel,
  label,
  pendingLabel,
  ...props
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <button
      {...props}
      className={className}
      disabled={isDisabled}
      type="submit"
    >
      {pending ? pendingLabel ?? label : disabled ? disabledLabel ?? label : label}
    </button>
  );
}
