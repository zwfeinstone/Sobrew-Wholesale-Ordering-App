import { describe, expect, it } from 'vitest';
import {
  accountingTransactionFingerprint,
  buildAccountingPnlTotals,
  buildSuggestedAccountingMatches,
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

  it('can invert amount-only exports where purchases are negative', () => {
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
});

describe('accounting suggested matches', () => {
  it('suggests inventory receipt matches by amount, date, and supplier', () => {
    const suggestions = buildSuggestedAccountingMatches({
      expenses: [],
      receipts: [{
        freight_cents: 500,
        id: 'receipt-1',
        inventory_items: { name: 'Box 14x14x14', sku: 'BOX-14' },
        item_unit_cost_cents: 150,
        other_cost_cents: 0,
        quantity: 50,
        received_at: '2026-07-03T12:00:00.000Z',
        supplier: 'Uline',
      }],
      transaction: {
        accountName: 'Sobrew Visa',
        accountType: 'credit_card',
        amountCents: 8000,
        merchantName: 'Uline',
        originalDescription: 'ULINE SHIP SUPPLIES',
        transactionDate: '2026-07-02',
      },
    });

    expect(suggestions[0]).toMatchObject({
      targetId: 'receipt-1',
      targetType: 'inventory_receipt',
    });
    expect(suggestions[0].confidence).toBeGreaterThanOrEqual(90);
  });
});

describe('accounting P&L totals', () => {
  it('does not count matched inventory purchases as an expense', () => {
    const totals = buildAccountingPnlTotals({
      legacyNonInventoryExpenseCents: 5000,
      orderCogsCents: 60000,
      orderRevenueCents: 150000,
      transactions: [
        {
          accounting_categories: {
            category_type: 'asset',
            id: 'inventory',
            name: 'Inventory Purchase / Asset',
            pnl_section: 'none',
          },
          amount_cents: 8000,
          category_id: 'inventory',
          status: 'matched_inventory',
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

    expect(totals.grossProfitCents).toBe(90000);
    expect(totals.cardOperatingExpenseCents).toBe(2000);
    expect(totals.netIncomeCents).toBe(83000);
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
      "flagType": "inventory_overlap",
      "confidence": 92,
      "reason": "Looks like a card purchase that may already be in receiving.",
      "recommendedAction": "approve_inventory_match",
      "categorySuggestion": "Inventory Purchase / Asset"
    }
  ]
}
\`\`\`
    `);

    expect(parsed.flags).toEqual([
      {
        categorySuggestion: 'Inventory Purchase / Asset',
        confidence: 92,
        flagType: 'inventory_overlap',
        reason: 'Looks like a card purchase that may already be in receiving.',
        recommendedAction: 'approve_inventory_match',
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
