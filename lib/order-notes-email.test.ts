import { describe, expect, it } from 'vitest';
import { buildCustomerOrderEmailContent, buildShippedEmailContent, buildShippedEmailText } from './email';
describe('delivery notes in email', () => {
  const notes = 'Call first\nUse <receiving> & side door';
  it('preserves notes and escapes HTML in confirmations', () => {
    const result = buildCustomerOrderEmailContent({ customerEmail:'test@example.com', customerName:'Test', orderId:'test', shipping:{}, items:[], subtotalCents:0, notes });
    expect(result.text).toContain(notes);
    expect(result.html).toContain('Use &lt;receiving&gt; &amp; side door');
  });
  it('preserves notes in both shipment formats', () => {
    expect(buildShippedEmailText([],[],{notes})).toContain(notes);
    expect(buildShippedEmailContent([],[],{notes})).toContain('Use &lt;receiving&gt; &amp; side door');
    expect(buildShippedEmailContent([],[],{})).not.toContain('Delivery instructions');
  });
});
