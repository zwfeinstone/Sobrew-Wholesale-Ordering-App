'use client';

import { useState, type ReactNode } from 'react';
import ShipOrderSubmitButton from '@/components/ship-order-submit-button';

export default function OrderFulfillmentForm({ action, orderId, hasRequiredBoxLines, children }: {
  action: (data: FormData) => Promise<void>; orderId: string;
  hasRequiredBoxLines: boolean; children: ReactNode;
}) {
  const [method, setMethod] = useState('carrier');
  const carrier = method === 'carrier';
  return <form action={action} className="fulfillment-form space-y-4">
    <input name="id" type="hidden" value={orderId} />
    <input name="zero_boxes_confirmed" type="hidden" value="" />
    <fieldset className="fulfillment-segmented"><legend className="sr-only">Fulfillment method</legend>
      <label><input name="fulfillment_method" type="radio" value="carrier" checked={carrier} onChange={() => setMethod('carrier')} /> Carrier shipping</label>
      <label><input name="fulfillment_method" type="radio" value="local_delivery" checked={!carrier} onChange={() => setMethod('local_delivery')} /> Local delivery / pickup</label>
    </fieldset>
    <label className="block text-sm font-medium">Shipping cost ($)<input className="input mt-2" name="shipping_cost" type="number" min={carrier ? '0.01' : '0'} step="0.01" required /></label>
    {carrier ? <label className="block text-sm font-medium">Tracking numbers<textarea className="input mt-2" name="tracking_numbers" required rows={3} /></label> : <label className="flex gap-2 text-sm"><input name="local_delivery_zero_confirm" type="checkbox" /> Confirm $0 shipping for local delivery or pickup</label>}
    {children}
    <div className="fulfillment-submit"><ShipOrderSubmitButton className="btn-primary w-full" hasRequiredBoxLines={hasRequiredBoxLines} label="Mark shipped" /></div>
  </form>;
}
