'use client';

import { MouseEvent } from 'react';
import { useFormStatus } from 'react-dom';

type ShipOrderSubmitButtonProps = {
  className?: string;
  hasRequiredBoxLines: boolean;
  label?: string;
  pendingLabel?: string;
};

function setZeroBoxesConfirmed(form: HTMLFormElement, confirmed: boolean) {
  const field = form.elements.namedItem('zero_boxes_confirmed');
  if (field instanceof HTMLInputElement) {
    field.value = confirmed ? 'on' : '';
    return;
  }

  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'zero_boxes_confirmed';
  input.value = confirmed ? 'on' : '';
  form.appendChild(input);
}

function totalBoxQuantity(formData: FormData) {
  return formData.getAll('box_quantity').reduce((sum, value) => {
    const parsed = Number.parseFloat(String(value ?? '').trim());
    return sum + (Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
  }, 0);
}

function hasManualTrackingField(form: HTMLFormElement) {
  return Boolean(form.elements.namedItem('tracking_numbers'));
}

function parseTrackingNumbers(formData: FormData) {
  return formData
    .getAll('tracking_numbers')
    .flatMap((value) => String(value ?? '').split(/[\n,;]+/))
    .map((value) => value.trim())
    .filter(Boolean);
}

export default function ShipOrderSubmitButton({
  className = 'btn-primary',
  hasRequiredBoxLines,
  label = 'Mark shipped',
  pendingLabel = 'Shipping...',
}: ShipOrderSubmitButtonProps) {
  const { pending } = useFormStatus();

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (pending || !hasRequiredBoxLines) return;

    const form = event.currentTarget.form;
    if (!form) return;

    setZeroBoxesConfirmed(form, false);
    const formData = new FormData(form);
    const fulfillmentMethod = String(formData.get('fulfillment_method') ?? '');
    if (fulfillmentMethod === 'carrier' && hasManualTrackingField(form) && !parseTrackingNumbers(formData).length) {
      event.preventDefault();
      window.alert('Enter at least one tracking number before marking a carrier-shipped order shipped.');
      return;
    }

    const boxesUsed = totalBoxQuantity(formData);
    if (boxesUsed > 0) return;

    if (fulfillmentMethod !== 'local_delivery') {
      event.preventDefault();
      window.alert('0 boxes is only allowed when Local delivery is selected.');
      return;
    }

    if (!window.confirm('Are you sure this order has 0 boxes?')) {
      event.preventDefault();
      return;
    }

    setZeroBoxesConfirmed(form, true);
  };

  return (
    <button
      className={className}
      disabled={pending}
      type="submit"
      onClick={handleClick}
      aria-busy={pending}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
