import Link from 'next/link';
import { ArrowRight, Check, MapPin, PackageCheck, ReceiptText } from 'lucide-react';
import { formatAppDateTime, usd } from '@/lib/utils';

type OrderConfirmationProps = {
  orderId: string;
  createdAt: string | null;
  subtotalCents: number;
  itemCount: number;
  recurringStatus: 'none' | 'created' | 'error';
  shipping: {
    shipping_name: string | null;
    shipping_address1: string | null;
    shipping_address2: string | null;
    shipping_city: string | null;
    shipping_state: string | null;
    shipping_zip: string | null;
  };
};

export default function OrderConfirmation({ orderId, createdAt, subtotalCents, itemCount, recurringStatus, shipping }: OrderConfirmationProps) {
  const addressLines = [
    shipping.shipping_address1,
    shipping.shipping_address2,
    [shipping.shipping_city, [shipping.shipping_state, shipping.shipping_zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  ].filter(Boolean);

  return (
    <section className="order-confirmation" aria-labelledby="order-confirmation-heading">
      <div className="order-confirmation-main">
        <div className="order-confirmation-check" aria-hidden="true"><Check size={34} strokeWidth={2.5} /></div>
        <p className="order-confirmation-kicker">Received by Sobrew</p>
        <h1 id="order-confirmation-heading">Your order is placed.</h1>
        <p className="order-confirmation-message">Thank you! We have your order and will take it from here.</p>
        <p className="order-confirmation-reassurance" role="status">Your order is saved. There’s no need to submit it again.</p>

        <dl className="order-confirmation-receipt">
          <div><dt>Order number</dt><dd>#{orderId.slice(0, 8)}</dd></div>
          <div><dt>Placed on</dt><dd>{formatAppDateTime(createdAt)}</dd></div>
          <div><dt>Order subtotal · {itemCount} item{itemCount === 1 ? '' : 's'}</dt><dd>{usd(subtotalCents)}</dd></div>
        </dl>
      </div>

      <div className="order-confirmation-next">
        <div className="order-confirmation-step">
          <PackageCheck size={21} aria-hidden="true" />
          <div><h2>What happens next</h2><p>Our team will prepare your order. You can follow its progress in Orders.</p></div>
        </div>
        <div className="order-confirmation-step">
          <ReceiptText size={21} aria-hidden="true" />
          <div><h2>Invoicing</h2><p>No payment was collected at checkout. We’ll send an invoice when your order is processed.</p></div>
        </div>
        {addressLines.length ? (
          <div className="order-confirmation-step">
            <MapPin size={21} aria-hidden="true" />
            <div><h2>Delivering to</h2><address>{shipping.shipping_name ? <strong>{shipping.shipping_name}</strong> : null}{addressLines.map((line, index) => <span key={index}>{line}</span>)}</address></div>
          </div>
        ) : null}
      </div>

      {recurringStatus !== 'none' ? (
        <div className={`order-confirmation-recurring${recurringStatus === 'error' ? ' order-confirmation-recurring-warning' : ''}`} role={recurringStatus === 'error' ? 'alert' : undefined}>
          <strong>{recurringStatus === 'created' ? 'Your recurring schedule is set.' : 'Your order is confirmed. The recurring schedule needs attention.'}</strong>
          <p>{recurringStatus === 'created' ? 'Future orders will be created automatically on your selected schedule.' : 'Only the recurring schedule could not be saved. Please do not place this order again.'}</p>
          <Link href="/portal/recurring-orders">{recurringStatus === 'created' ? 'Manage recurring orders' : 'Review recurring orders'} <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
      ) : null}

      <div className="order-confirmation-footer">
        <p>You’re all set. You can safely leave this page.</p>
        <Link className="btn-primary" href="/portal/orders">View my orders <ArrowRight size={17} aria-hidden="true" /></Link>
      </div>
    </section>
  );
}
