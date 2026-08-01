import { describe, expect, it } from 'vitest';
import {
  accountingTransactionFingerprint,
  accountingTransactionFingerprintForOccurrence,
  buildAccountingPnlTotals,
  parseAiAccountingReviewResponse,
  parseAccountingCsv,
} from '@/lib/accounting';

describe('accounting csv import', () => {
  it('parses common transaction exports', () => {
    const rows = parseAccountingCsv({
      accountName: 'Sobrew Visa',
      accountType: 'credit_card',
      content: [
        'Date,Description,Amount,Merchant',
        '2026-07-12,"Uline boxes",125.25,Uline',
        '07/14/2026,"Stripe payout",-450.00,Stripe',
      ].join('\n'),
    });

    expect(rows).toEqual([
      {
        accountName: 'Sobrew Visa',
        accountType: 'credit_card',
        amountCents: 12525,
        merchantName: 'Uline',
        originalDescription: 'Uline boxes',
        transactionDate: '2026-07-12',
      },
      {
        accountName: 'Sobrew Visa',
        accountType: 'credit_card',
        amountCents: -45000,
        merchantName: 'Stripe',
        originalDescription: 'Stripe payout',
        transactionDate: '2026-07-14',
      },
    ]);
  });

  it('supports debit and credit columns as outflow minus inflow', () => {
    const rows = parseAccountingCsv({
      accountType: 'bank',
      content: [
        'Posted Date,Name,Debit,Credit',
        '7/1/2026,Box purchase,82.50,',
        '7/2/2026,Refund,,10.00',
      ].join('\n'),
    });

    expect(rows.map((row) => row.amountCents)).toEqual([8250, -1000]);
  });

  it('auto-detects amount-only exports where purchases are negative', () => {
    const rows = parseAccountingCsv({
      accountType: 'credit_card',
      content: [
        'Date,Description,Amount',
        '7/1/2026,Box purchase,-82.50',
        '7/2/2026,Refund,10.00',
      ].join('\n'),
    });

    expect(rows.map((row) => row.amountCents)).toEqual([8250, -1000]);
  });

  it('parses likely expense categories from upload templates', () => {
    const rows = parseAccountingCsv({
      accountType: 'credit_card',
      content: [
        'Date,Description,Amount,Likely Expense Category',
        '7/1/2026,Software subscription,39.00,Software & Subscriptions',
        '7/2/2026,Permit renewal,22.50,"Taxes, Licenses & Permits"',
      ].join('\n'),
    });

    expect(rows.map((row) => row.categoryName)).toEqual([
      'Software & Subscriptions',
      'Taxes, Licenses & Permits',
    ]);
  });

  it('can still explicitly invert amount-only exports where purchases are negative', () => {
    const rows = parseAccountingCsv({
      accountType: 'credit_card',
      amountSign: 'money_out_negative',
      content: [
        'Date,Description,Amount',
        '7/1/2026,Box purchase,-82.50',
        '7/2/2026,Refund,10.00',
      ].join('\n'),
    });

    expect(rows.map((row) => row.amountCents)).toEqual([8250, -1000]);
  });
});

describe('accounting duplicate fingerprints', () => {
  it('normalizes whitespace and description case', () => {
    const first = accountingTransactionFingerprint({
      accountName: 'Sobrew Visa',
      amountCents: 8250,
      originalDescription: 'Uline   BOX purchase',
      transactionDate: '2026-07-01',
    });
    const second = accountingTransactionFingerprint({
      accountName: 'sobrew visa',
      amountCents: 8250,
      originalDescription: 'uline box purchase',
      transactionDate: '2026-07-01',
    });

    expect(first).toBe(second);
  });

  it('distinguishes repeated identical transactions in the same upload', () => {
    const baseFingerprint = accountingTransactionFingerprint({
      accountName: 'Business Amex',
      amountCents: 772,
      originalDescription: 'BT*PIRATE SHIP * POSJACKSON WY',
      transactionDate: '2026-04-07',
    });

    expect(accountingTransactionFingerprintForOccurrence(baseFingerprint, 1)).toBe(baseFingerprint);
    expect(accountingTransactionFingerprintForOccurrence(baseFingerprint, 2)).not.toBe(baseFingerprint);
    expect(accountingTransactionFingerprintForOccurrence(baseFingerprint, 2)).toBe(
      accountingTransactionFingerprintForOccurrence(baseFingerprint, 2),
    );
  });
});

describe('accounting P&L totals', () => {
  it('does not count excluded rows in the standalone P&L', () => {
    const totals = buildAccountingPnlTotals({
      transactions: [
        {
          accounting_categories: {
            category_type: 'revenue',
            id: 'sales',
            name: 'Sales Revenue',
            pnl_section: 'revenue',
          },
          amount_cents: -150000,
          category_id: 'sales',
          status: 'categorized',
          transaction_date: '2026-07-01',
        },
        {
          accounting_categories: {
            category_type: 'asset',
            id: 'transfer',
            name: 'Transfer / Credit Card Payment',
            pnl_section: 'none',
          },
          amount_cents: 8000,
          category_id: 'transfer',
          status: 'excluded',
          transaction_date: '2026-07-02',
        },
        {
          accounting_categories: {
            category_type: 'operating_expense',
            id: 'software',
            name: 'Software',
            pnl_section: 'operating_expenses',
          },
          amount_cents: 2000,
          category_id: 'software',
          status: 'categorized',
          transaction_date: '2026-07-05',
        },
      ],
    });

    expect(totals.grossProfitCents).toBe(150000);
    expect(totals.cardOperatingExpenseCents).toBe(2000);
    expect(totals.netIncomeCents).toBe(148000);
  });

  it('counts uploaded payroll owner-pay rows as operating expense', () => {
    const totals = buildAccountingPnlTotals({
      transactions: [
        {
          accounting_categories: {
            category_type: 'revenue',
            id: 'sales',
            name: 'Sales Revenue',
            pnl_section: 'revenue',
          },
          amount_cents: -150000,
          category_id: 'sales',
          status: 'categorized',
          transaction_date: '2026-07-01',
        },
        {
          accounting_categories: {
            category_type: 'operating_expense',
            id: 'payroll',
            name: 'Payroll & Owner Pay',
            pnl_section: 'operating_expenses',
          },
          amount_cents: 30000,
          category_id: 'payroll',
          status: 'categorized',
          transaction_date: '2026-07-18',
        },
      ],
    });

    expect(totals.cardOperatingExpenseCents).toBe(30000);
    expect(totals.netIncomeCents).toBe(120000);
  });

  it('counts uploaded sales revenue rows as standalone accounting revenue', () => {
    const totals = buildAccountingPnlTotals({
      transactions: [
        {
          accounting_categories: {
            category_type: 'revenue',
            id: 'sales',
            name: 'Sales Revenue',
            pnl_section: 'revenue',
          },
          amount_cents: -150000,
          category_id: 'sales',
          status: 'categorized',
          transaction_date: '2026-07-18',
        },
      ],
    });

    expect(totals.revenueCents).toBe(150000);
    expect(totals.otherIncomeCents).toBe(0);
    expect(totals.netIncomeCents).toBe(150000);
  });

  it('nets credits against uploaded expense categories', () => {
    const totals = buildAccountingPnlTotals({
      transactions: [
        {
          accounting_categories: {
            category_type: 'operating_expense',
            id: 'auto',
            name: 'Fuel & Auto',
            pnl_section: 'operating_expenses',
          },
          amount_cents: 34474,
          category_id: 'auto',
          status: 'categorized',
          transaction_date: '2026-07-03',
        },
        {
          accounting_categories: {
            category_type: 'operating_expense',
            id: 'auto',
            name: 'Fuel & Auto',
            pnl_section: 'operating_expenses',
          },
          amount_cents: -8618,
          category_id: 'auto',
          status: 'categorized',
          transaction_date: '2026-07-16',
        },
      ],
    });

    expect(totals.cardOperatingExpenseCents).toBe(25856);
    expect(totals.netIncomeCents).toBe(-25856);
  });
});

describe('AI accounting review parsing', () => {
  it('extracts flags from a fenced JSON response', () => {
    const parsed = parseAiAccountingReviewResponse(`
\`\`\`json
{
  "flags": [
    {
      "transactionId": "txn-1",
      "flagType": "possible_transfer",
      "confidence": 92,
      "reason": "Looks like a credit card payment.",
      "recommendedAction": "exclude",
      "categorySuggestion": "Transfer / Credit Card Payment"
    }
  ]
}
\`\`\`
    `);

    expect(parsed.flags).toEqual([
      {
        categorySuggestion: 'Transfer / Credit Card Payment',
        confidence: 92,
        flagType: 'possible_transfer',
        reason: 'Looks like a credit card payment.',
        recommendedAction: 'exclude',
        transactionId: 'txn-1',
      },
    ]);
  });

  it('normalizes unknown flag values to safe review defaults', () => {
    const parsed = parseAiAccountingReviewResponse(JSON.stringify({
      flags: [{
        confidence: 500,
        flagType: 'surprise',
        reason: 'Needs eyes.',
        recommendedAction: 'do_magic',
        transactionId: 'txn-2',
      }],
    }));

    expect(parsed.flags[0]).toMatchObject({
      confidence: 100,
      flagType: 'other',
      recommendedAction: 'review',
    });
  });
});
