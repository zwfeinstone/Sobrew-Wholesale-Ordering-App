import { describe, expect, it } from 'vitest';
import {
  buildAiBusinessOverviewPrompt,
  buildBusinessHealthSnapshot,
  extractOpenAiResponseText,
  type BuildBusinessHealthSnapshotInput,
} from './ai-business-overview';

function baseInput(overrides: Partial<BuildBusinessHealthSnapshotInput> = {}): BuildBusinessHealthSnapshotInput {
  return {
    asOfDate: new Date(2026, 6, 10),
    centers: [
      { created_at: '2026-01-01T00:00:00.000Z', id: 'center-1', is_active: true, name: 'Downtown Cafe' },
    ],
    currentDate: new Date(2026, 6, 11),
    inventoryItems: [],
    inventoryLots: [],
    nonInventoryExpenses: [],
    orderItems: [
      {
        cogs_donation_cents: 100,
        cogs_fixed_cents: 250,
        cogs_labor_cents: 900,
        cogs_material_cents: 2200,
        cogs_processing_fee_cents: 329,
        cogs_product_cents: 3350,
        cogs_shipping_cents: 1000,
        cogs_total_cents: 4779,
        cogs_unit_cents: 2389.5,
        id: 'item-1',
        line_total_cents: 10000,
        order_id: 'order-1',
        product_id: 'product-1',
        product_name_snapshot: 'Medium Roast Ground',
        qty: 2,
        unit_price_cents: 5000,
      },
    ],
    orders: [
      {
        center_id: 'center-1',
        created_at: '2026-07-10T15:00:00.000Z',
        donation_cogs_cents: 100,
        id: 'order-1',
        processing_fee_cents: 329,
        shipped_at: '2026-07-10T18:00:00.000Z',
        shipping_cost_cents: 1000,
        status: 'Shipped',
        subtotal_cents: 10000,
      },
    ],
    products: [
      { active: true, category: 'coffee', id: 'product-1', name: 'Medium Roast Ground', sku: 'MED-GRD' },
    ],
    productionRunInputs: [],
    productionRuns: [],
    prospectingAggregate: null,
    reorderSettings: [],
    shortageMovements: [],
    ...overrides,
  };
}

describe('buildBusinessHealthSnapshot', () => {
  it('builds month-to-date, trailing 8-week, and prior equal ranges from the selected as-of date', () => {
    const snapshot = buildBusinessHealthSnapshot(baseInput());

    expect(snapshot.as_of_date).toBe('2026-07-10');
    expect(snapshot.period.month_to_date).toEqual({
      days: 10,
      end_exclusive: '2026-07-11',
      start: '2026-07-01',
    });
    expect(snapshot.period.trailing_8_weeks).toEqual({
      days: 56,
      end_exclusive: '2026-07-11',
      start: '2026-05-16',
    });
    expect(snapshot.period.prior_equal_range).toEqual({
      days: 10,
      end_exclusive: '2026-07-01',
      start: '2026-06-21',
    });
  });

  it('records missing-data notes instead of inventing unavailable metrics', () => {
    const snapshot = buildBusinessHealthSnapshot(baseInput());

    expect(snapshot.prospecting_and_pipeline).toBeNull();
    expect(snapshot.missing_data).toEqual(expect.arrayContaining([
      expect.stringContaining('Prospecting/pipeline data was unavailable'),
      expect.stringContaining('Inventory item details were unavailable'),
      expect.stringContaining('Production run rows were unavailable'),
    ]));
  });

  it('flags historical inventory as estimated/current-state-derived for past as-of dates', () => {
    const snapshot = buildBusinessHealthSnapshot(baseInput({
      asOfDate: new Date(2026, 5, 30),
      currentDate: new Date(2026, 6, 11),
    }));

    expect(snapshot.missing_data).toEqual(expect.arrayContaining([
      expect.stringContaining('Historical inventory is estimated/current-state-derived'),
    ]));
  });
});

describe('buildAiBusinessOverviewPrompt', () => {
  it('includes the requested report structure and structured business snapshot without secrets', () => {
    const snapshot = buildBusinessHealthSnapshot(baseInput());
    const prompt = buildAiBusinessOverviewPrompt(snapshot);
    const promptText = prompt.input.map((message) => message.content.map((part) => part.text).join('\n')).join('\n');

    expect(promptText).toContain('Executive Diagnosis');
    expect(promptText).toContain('Final Perspective');
    expect(promptText).toContain('"as_of_date": "2026-07-10"');
    expect(promptText).not.toContain('OPENAI_API_KEY');
    expect(promptText).not.toContain('sk-proj');
  });

  it('extracts output text from Responses API payloads', () => {
    expect(extractOpenAiResponseText({ output_text: 'Plain text' })).toBe('Plain text');
    expect(extractOpenAiResponseText({
      output: [
        { content: [{ text: 'First' }, { text: 'Second' }] },
      ],
    })).toBe('First\nSecond');
  });
});
