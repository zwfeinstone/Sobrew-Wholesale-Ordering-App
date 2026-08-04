import { describe, expect, it } from 'vitest';
import {
  buildQuickBooksReceivablesSummary,
  buildQuickBooksCustomerMatches,
  buildQuickBooksCustomerPayloadFromCenter,
  buildQuickBooksInvoiceEmailRecipients,
  buildQuickBooksInvoicePayload,
  buildQuickBooksInvoicePaymentPayload,
  buildQuickBooksSavedPaymentChargePayload,
  normalizeCustomerMatchText,
  normalizeQuickBooksInvoiceReceivable,
  normalizeQuickBooksSavedPaymentMethodType,
  quickBooksDuplicateDocNumberError,
  quickBooksSavedPaymentMethodLabel,
  scoreQuickBooksCustomerMatch,
} from '@/lib/quickbooks';

describe('quickbooks duplicate invoice numbers', () => {
  it('extracts the duplicate document number without treating the existing QuickBooks invoice as the portal invoice', () => {
    const error = new Error(
      'Duplicate Document Number Error: You must specify a different number. DocNumber=SO-1277 is assigned to TxnType=Invoice with TxnId=1184 (QuickBooks request abc)'
    );

    expect(quickBooksDuplicateDocNumberError(error, 'SO-1277')).toEqual({
      docNumber: 'SO-1277',
      txnId: '1184',
    });
  });

  it('ignores duplicate document errors for a different assigned portal number', () => {
    const error = new Error('Duplicate Document Number Error: DocNumber=SO-1278 is assigned to TxnType=Invoice with TxnId=1185');

    expect(quickBooksDuplicateDocNumberError(error, 'SO-1279')).toBeNull();
  });
});

describe('quickbooks invoice payload', () => {
  it('maps Sobrew order lines into QuickBooks invoice lines', () => {
    const payload = buildQuickBooksInvoicePayload(
      {
        centers: { name: 'Lakeview Recovery' },
        created_at: '2026-08-01T15:00:00.000Z',
        id: 'order-12345678',
        notes: 'Deliver to front desk.',
        order_items: [
          {
            line_total_cents: 7200,
            product_name_snapshot: 'Cold Brew Case',
            products: { name: 'Cold Brew Case', quickbooks_item_id: '9', quickbooks_item_name: 'Cold Brew Case', sku: 'CB-CASE' },
            qty: 3,
            unit_price_cents: 2400,
          },
        ],
        profiles: { email: 'buyer@example.com', full_name: 'Buyer Name' },
        shipping_address1: '123 Main St',
        shipping_address2: null,
        shipping_city: 'Chicago',
        shipping_company: null,
        shipping_name: 'Lakeview Recovery',
        shipping_state: 'IL',
        shipping_zip: '60601',
      },
      { name: 'Lakeview Recovery', value: '42' },
      { docNumber: 'SO-1272', invoiceDate: new Date('2026-08-01T16:00:00.000Z') }
    );

    expect(payload.CustomerRef).toEqual({ name: 'Lakeview Recovery', value: '42' });
    expect(payload.DocNumber).toBe('SO-1272');
    expect(payload.ShipDate).toBe('2026-08-01');
    expect(payload.ShipMethodRef).toEqual({ value: 'UPS' });
    expect(payload.TrackingNum).toBe('See shipped order email');
    expect(payload.BillEmail).toEqual({ Address: 'buyer@example.com' });
    expect(payload.BillEmailCc).toBeUndefined();
    expect(payload.Line).toEqual([
      {
        Amount: 72,
        Description: 'Cold Brew Case (CB-CASE)',
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { name: 'Cold Brew Case', value: '9' },
          Qty: 3,
          TaxCodeRef: { value: 'NON' },
          UnitPrice: 24,
        },
      },
    ]);
    expect(payload.PrivateNote).toContain('Sobrew order order-12345678');
    expect(payload.PrivateNote).toContain('Deliver to front desk.');
  });

  it('marks invoice lines taxable for for-profit customers in sales tax states', () => {
    const payload = buildQuickBooksInvoicePayload(
      {
        centers: { name: 'Memphis Cafe', customer_tax_status: 'for_profit' },
        created_at: '2026-08-01T15:00:00.000Z',
        id: 'order-taxable',
        notes: null,
        order_items: [
          {
            line_total_cents: 2400,
            product_name_snapshot: 'Cold Brew Case',
            products: { name: 'Cold Brew Case', quickbooks_item_id: '9', quickbooks_item_name: 'Cold Brew Case', sku: 'CB-CASE' },
            qty: 1,
            unit_price_cents: 2400,
          },
        ],
        profiles: { email: 'buyer@example.com', full_name: 'Buyer Name' },
        shipping_address1: '289 Aurora Circle',
        shipping_address2: null,
        shipping_city: 'Memphis',
        shipping_company: null,
        shipping_name: 'Memphis Cafe',
        shipping_state: 'TN',
        shipping_zip: '38111',
      },
      { name: 'Memphis Cafe', value: '42' },
      { taxableStates: ['TN', 'GA'] }
    );

    expect(payload.Line[0].SalesItemLineDetail.TaxCodeRef).toEqual({ value: 'TAX' });
  });

  it('uses QuickBooks customer primary and cc recipients on invoices', () => {
    const order = {
      centers: { billing_email: 'portal@example.com', name: 'Lakeview Recovery' },
      created_at: '2026-08-01T15:00:00.000Z',
      id: 'order-qbo-email',
      notes: null,
      order_items: [
        {
          line_total_cents: 2400,
          product_name_snapshot: 'Cold Brew Case',
          products: { name: 'Cold Brew Case', quickbooks_item_id: '9', quickbooks_item_name: 'Cold Brew Case', sku: 'CB-CASE' },
          qty: 1,
          unit_price_cents: 2400,
        },
      ],
      profiles: { email: 'profile@example.com', full_name: 'Buyer Name' },
      shipping_address1: '123 Main St',
      shipping_address2: null,
      shipping_city: 'Chicago',
      shipping_company: null,
      shipping_name: 'Lakeview Recovery',
      shipping_state: 'IL',
      shipping_zip: '60601',
    };
    const recipients = buildQuickBooksInvoiceEmailRecipients(order, {
      BillEmailCc: { Address: 'ap@example.com, owner@example.com' },
      PrimaryEmailAddr: { Address: 'primary@example.com' },
    });

    const payload = buildQuickBooksInvoicePayload(order, { name: 'Lakeview Recovery', value: '42' }, { emailRecipients: recipients });

    expect(recipients).toEqual({
      all: ['primary@example.com', 'ap@example.com', 'owner@example.com'],
      cc: ['ap@example.com', 'owner@example.com'],
      display: 'primary@example.com, ap@example.com, owner@example.com',
      to: ['primary@example.com'],
    });
    expect(payload.BillEmail).toEqual({ Address: 'primary@example.com' });
    expect(payload.BillEmailCc).toEqual({ Address: 'ap@example.com, owner@example.com' });
  });

  it('treats extra QuickBooks primary email addresses as cc recipients', () => {
    const recipients = buildQuickBooksInvoiceEmailRecipients(
      {
        centers: { billing_email: 'portal@example.com', name: 'Lakeview Recovery' },
        created_at: '2026-08-01T15:00:00.000Z',
        id: 'order-qbo-multiple-emails',
        notes: null,
        order_items: [],
        profiles: { email: 'profile@example.com', full_name: 'Buyer Name' },
        shipping_address1: '123 Main St',
        shipping_address2: null,
        shipping_city: 'Chicago',
        shipping_company: null,
        shipping_name: 'Lakeview Recovery',
        shipping_state: 'IL',
        shipping_zip: '60601',
      },
      {
        PrimaryEmailAddr: { Address: 'primary@example.com, ap@example.com; owner@example.com' },
      }
    );

    expect(recipients.to).toEqual(['primary@example.com']);
    expect(recipients.cc).toEqual(['ap@example.com', 'owner@example.com']);
    expect(recipients.display).toBe('primary@example.com, ap@example.com, owner@example.com');
  });

  it('uses mapped product item refs on invoice lines', () => {
    const payload = buildQuickBooksInvoicePayload(
      {
        centers: { name: 'Mapped Center' },
        created_at: '2026-08-01T15:00:00.000Z',
        id: 'order-mapped-products',
        notes: null,
        order_items: [
          {
            line_total_cents: 3600,
            product_name_snapshot: 'Sweet Tea Case',
            products: {
              name: 'Sweet Tea Case',
              quickbooks_item_id: '73',
              quickbooks_item_name: 'Sweet Tea Case',
              sku: 'TEA-SWEET',
            },
            qty: 2,
            unit_price_cents: 1800,
          },
        ],
        profiles: { email: 'buyer@example.com', full_name: 'Buyer Name' },
        shipping_address1: '123 Main St',
        shipping_address2: null,
        shipping_city: 'Chicago',
        shipping_company: null,
        shipping_name: 'Mapped Center',
        shipping_state: 'IL',
        shipping_zip: '60601',
      },
      { name: 'Mapped Center', value: '42' }
    );

    expect(payload.Line[0].SalesItemLineDetail.ItemRef).toEqual({
      name: 'Sweet Tea Case',
      value: '73',
    });
  });

  it('keeps invoice lines non-taxable for exempt customers in sales tax states', () => {
    const payload = buildQuickBooksInvoicePayload(
      {
        centers: { name: 'Memphis Recovery Nonprofit', customer_tax_status: 'tax_exempt' },
        created_at: '2026-08-01T15:00:00.000Z',
        id: 'order-exempt',
        notes: null,
        order_items: [
          {
            line_total_cents: 2400,
            product_name_snapshot: 'Cold Brew Case',
            products: { name: 'Cold Brew Case', quickbooks_item_id: '9', quickbooks_item_name: 'Cold Brew Case', sku: 'CB-CASE' },
            qty: 1,
            unit_price_cents: 2400,
          },
        ],
        profiles: { email: 'buyer@example.com', full_name: 'Buyer Name' },
        shipping_address1: '289 Aurora Circle',
        shipping_address2: null,
        shipping_city: 'Memphis',
        shipping_company: null,
        shipping_name: 'Memphis Recovery Nonprofit',
        shipping_state: 'TN',
        shipping_zip: '38111',
      },
      { name: 'Memphis Recovery Nonprofit', value: '42' },
      { taxableStates: ['TN'] }
    );

    expect(payload.Line[0].SalesItemLineDetail.TaxCodeRef).toEqual({ value: 'NON' });
  });

  it('rejects invoice lines without mapped QuickBooks product IDs', () => {
    expect(() => buildQuickBooksInvoicePayload(
      {
        centers: { name: 'Unmapped Center' },
        created_at: '2026-08-01T15:00:00.000Z',
        id: 'order-unmapped-products',
        notes: null,
        order_items: [
          {
            line_total_cents: 2400,
            product_name_snapshot: 'Cold Brew Case',
            products: { name: 'Cold Brew Case', sku: 'CB-CASE' },
            qty: 1,
            unit_price_cents: 2400,
          },
        ],
        profiles: { email: 'buyer@example.com', full_name: 'Buyer Name' },
        shipping_address1: '289 Aurora Circle',
        shipping_address2: null,
        shipping_city: 'Memphis',
        shipping_company: null,
        shipping_name: 'Unmapped Center',
        shipping_state: 'TN',
        shipping_zip: '38111',
      },
      { name: 'Unmapped Center', value: '42' }
    )).toThrow('Map Cold Brew Case to QuickBooks before invoicing.');
  });
});

describe('quickbooks saved payment payloads', () => {
  it('normalizes supported saved payment method type names', () => {
    expect(normalizeQuickBooksSavedPaymentMethodType('credit card')).toBe('card');
    expect(normalizeQuickBooksSavedPaymentMethodType('checking')).toBe('bank_account');
    expect(normalizeQuickBooksSavedPaymentMethodType('ACH')).toBe('bank_account');
    expect(normalizeQuickBooksSavedPaymentMethodType('e-check')).toBe('echeck');
    expect(normalizeQuickBooksSavedPaymentMethodType('cash')).toBeNull();
  });

  it('builds readable saved payment labels without exposing full payment details', () => {
    expect(quickBooksSavedPaymentMethodLabel({
      quickbooks_payment_method_brand: 'Visa',
      quickbooks_payment_method_last4: '1111',
      quickbooks_payment_method_type: 'card',
    })).toBe('Visa ending 1111');

    expect(quickBooksSavedPaymentMethodLabel({
      quickbooks_payment_method_last4: '6789',
      quickbooks_payment_method_type: 'bank_account',
    })).toBe('Saved bank account ending 6789');
  });

  it('builds a saved card charge payload', () => {
    expect(buildQuickBooksSavedPaymentChargePayload(
      { id: 'card-123', label: 'Visa ending 1111', type: 'card' },
      3625,
      'Sobrew invoice SO-1272'
    )).toEqual({
      path: '/charges',
      payload: {
        amount: '36.25',
        capture: true,
        cardOnFile: 'card-123',
        context: {
          isEcommerce: true,
          mobile: false,
        },
        currency: 'USD',
        description: 'Sobrew invoice SO-1272',
      },
    });
  });

  it('builds a saved ACH/eCheck payment payload', () => {
    expect(buildQuickBooksSavedPaymentChargePayload(
      { id: 'bank-123', label: 'Checking ending 6789', type: 'bank_account' },
      8000,
      'Sobrew invoice SO-1273'
    )).toEqual({
      path: '/echecks',
      payload: {
        amount: '80.00',
        bankAccountOnFile: 'bank-123',
        context: {
          deviceInfo: {
            id: 'sobrew-portal',
            type: 'server',
          },
          isEcommerce: true,
          mobile: false,
        },
        description: 'Sobrew invoice SO-1273',
        paymentMode: 'WEB',
      },
    });
  });

  it('builds a QuickBooks payment linked to the invoice', () => {
    const payload = buildQuickBooksInvoicePaymentPayload({
      amountCents: 11600,
      chargeId: 'charge-123',
      chargeStatus: 'CAPTURED',
      customerRef: { name: 'Lakeview Recovery', value: '42' },
      invoiceId: 'invoice-123',
      invoiceNumber: 'SO-1272',
      paymentMethodLabel: 'Visa ending 1111',
    });

    expect(payload).toMatchObject({
      CustomerRef: { name: 'Lakeview Recovery', value: '42' },
      Line: [
        {
          Amount: 116,
          LinkedTxn: [
            {
              TxnId: 'invoice-123',
              TxnType: 'Invoice',
            },
          ],
        },
      ],
      PaymentRefNum: 'charge-123',
      TotalAmt: 116,
    });
    expect(payload.PrivateNote).toContain('QuickBooks Payments status CAPTURED');
    expect(payload.PrivateNote).toContain('Visa ending 1111');
  });
});

describe('quickbooks invoice receivables', () => {
  const today = '2026-08-02';

  it('marks invoices with no balance as paid', () => {
    const invoice = normalizeQuickBooksInvoiceReceivable({
      Balance: 0,
      CustomerRef: { name: 'Valley Behavioral Health' },
      DocNumber: 'SO-1164',
      DueDate: '2026-07-11',
      Id: '1164',
      TotalAmt: 160,
      TxnDate: '2026-06-11',
    }, today);

    expect(invoice).toMatchObject({
      amountCents: 16000,
      balanceCents: 0,
      customerName: 'Valley Behavioral Health',
      paidAmountCents: 16000,
      status: 'paid',
      statusLabel: 'Paid',
      timing: 'paid',
      timingDays: null,
    });
  });

  it('marks unpaid invoices overdue by day count', () => {
    const invoice = normalizeQuickBooksInvoiceReceivable({
      Balance: 160,
      DocNumber: 'SO-1164',
      DueDate: '2026-07-11',
      Id: '1164',
      TotalAmt: 160,
      TxnDate: '2026-06-11',
    }, today);

    expect(invoice).toMatchObject({
      balanceCents: 16000,
      status: 'unpaid',
      statusLabel: 'Overdue 22 days',
      timing: 'overdue',
      timingDays: 22,
    });
  });

  it('marks unpaid invoices due today or in the future', () => {
    expect(normalizeQuickBooksInvoiceReceivable({
      Balance: 80,
      DueDate: today,
      Id: 'today',
      TotalAmt: 80,
    }, today)).toMatchObject({
      statusLabel: 'Due today',
      timing: 'due_today',
      timingDays: 0,
    });

    expect(normalizeQuickBooksInvoiceReceivable({
      Balance: 411.1,
      DueDate: '2026-08-09',
      Id: 'future',
      TotalAmt: 411.1,
    }, today)).toMatchObject({
      balanceCents: 41110,
      statusLabel: 'Due in 7 days',
      timing: 'not_due_yet',
      timingDays: 7,
    });
  });

  it('keeps unpaid invoices without a due date in the not-due summary bucket', () => {
    const invoice = normalizeQuickBooksInvoiceReceivable({
      Balance: 287.44,
      Id: 'missing-due-date',
      TotalAmt: 287.44,
    }, today);

    expect(invoice).toMatchObject({
      status: 'unpaid',
      statusLabel: 'Unpaid',
      timing: 'unknown',
      timingDays: null,
    });
  });

  it('builds QuickBooks-style paid and unpaid totals', () => {
    const invoices = [
      normalizeQuickBooksInvoiceReceivable({ Balance: 160, DueDate: '2026-07-11', Id: 'overdue', TotalAmt: 160 }, today),
      normalizeQuickBooksInvoiceReceivable({ Balance: 411.1, DueDate: '2026-08-09', Id: 'future', TotalAmt: 411.1 }, today),
      normalizeQuickBooksInvoiceReceivable({ Balance: 0, DueDate: '2026-07-01', Id: 'paid', TotalAmt: 80 }, today),
      normalizeQuickBooksInvoiceReceivable({ Balance: 25, Id: 'unknown', TotalAmt: 25 }, today),
    ].filter((invoice): invoice is NonNullable<typeof invoice> => Boolean(invoice));

    expect(buildQuickBooksReceivablesSummary(invoices)).toEqual({
      notDueYetCents: 43610,
      overdueCents: 16000,
      paidCents: 8000,
      unpaidCents: 59610,
    });
  });
});

describe('quickbooks customer matching', () => {
  const customer = {
    active: true,
    billAddress: {
      city: 'Nashville',
      line1: '100 Commerce St',
      line2: null,
      postalCode: '37201',
      state: 'TN',
    },
    companyName: 'Bluebird Behavioral Health LLC',
    displayName: 'Bluebird Behavioral Health LLC',
    email: 'billing@bluebird.example',
    fullyQualifiedName: 'Bluebird Behavioral Health LLC',
    id: '123',
    phone: '615-555-1234',
    syncToken: '0',
  };

  it('normalizes common legal suffixes and DBA noise', () => {
    expect(normalizeCustomerMatchText('The Bluebird Recovery, LLC DBA')).toBe('bluebird recovery');
  });

  it('scores DBA-to-legal-name customer matches without changing the portal name', () => {
    const result = scoreQuickBooksCustomerMatch(
      {
        billing_zip: '37201',
        id: 'center-1',
        is_active: true,
        name: 'Bluebird Recovery',
      },
      customer
    );

    expect(result.score).toBeGreaterThanOrEqual(45);
    expect(result.reasons).toContain('ZIP match');
  });

  it('returns an existing linked QuickBooks customer first', () => {
    const [match] = buildQuickBooksCustomerMatches(
      [
        {
          id: 'center-linked',
          is_active: true,
          name: 'Different Portal DBA',
          quickbooks_customer_id: '123',
        },
      ],
      [customer]
    );

    expect(match.customer?.id).toBe('123');
    expect(match.score).toBe(100);
  });

  it('builds a QuickBooks customer from portal billing fields', () => {
    const payload = buildQuickBooksCustomerPayloadFromCenter({
      billing_address1: '900 Invoice Way',
      billing_address2: 'Suite 2',
      billing_city: 'Nashville',
      billing_email: 'billing@center.example',
      billing_phone: '615-555-0101',
      billing_state: 'TN',
      billing_zip: '37203',
      id: 'center-1',
      is_active: true,
      legal_name: 'Center Legal LLC',
      name: 'Center DBA',
    });

    expect(payload.DisplayName).toBe('Center DBA');
    expect(payload.CompanyName).toBe('Center Legal LLC');
    expect(payload.PrimaryEmailAddr).toEqual({ Address: 'billing@center.example' });
    expect(payload.PrimaryPhone).toEqual({ FreeFormNumber: '615-555-0101' });
    expect(payload.BillAddr).toEqual({
      City: 'Nashville',
      CountrySubDivisionCode: 'TN',
      Line1: '900 Invoice Way',
      Line2: 'Suite 2',
      PostalCode: '37203',
    });
  });

  it('falls back to the first active portal delivery location when billing address is empty', () => {
    const payload = buildQuickBooksCustomerPayloadFromCenter({
      center_locations: [
        {
          address1: '100 Delivery Rd',
          address2: null,
          city: 'Memphis',
          is_active: true,
          name: 'Main location',
          state: 'TN',
          zip: '38103',
        },
      ],
      id: 'center-2',
      is_active: true,
      name: 'Delivery Center',
    });

    expect(payload.BillAddr).toEqual({
      City: 'Memphis',
      CountrySubDivisionCode: 'TN',
      Line1: '100 Delivery Rd',
      Line2: undefined,
      PostalCode: '38103',
    });
  });
});
