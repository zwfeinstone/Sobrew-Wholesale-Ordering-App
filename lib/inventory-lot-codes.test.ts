import { describe, expect, it } from 'vitest';
import { buildInventoryLotCode, receiptNotesWithSupplierReference } from './inventory-lot-codes';

describe('inventory lot codes', () => {
  it('builds readable purchase lot codes by inventory type', () => {
    expect(buildInventoryLotCode({
      item: { id: 'item-1', item_type: 'raw_coffee', name: 'Meeting Coffee Medium', sku: 'RAW-COF-MTC-MED' },
      receivedAt: '2026-07-18',
      source: 'purchase',
      uniqueToken: 'abc123',
    })).toBe('RAW-20260718-COF-MTC-MED-ABC123');

    expect(buildInventoryLotCode({
      item: { id: 'item-2', item_type: 'material_supply', name: 'Bag - 2 lb', sku: 'MAT-BAG-2LB' },
      receivedAt: '2026-07-18',
      source: 'purchase',
      uniqueToken: 'def456',
    })).toBe('MAT-20260718-BAG-2LB-DEF456');
  });

  it('uses adjustment source codes for added-count lots', () => {
    expect(buildInventoryLotCode({
      item: { id: 'item-3', item_type: 'material_supply', name: 'Box - 12 x 12 x 10', sku: 'MAT-BOX-12X12X10' },
      receivedAt: '2026-07-18T15:30:00.000Z',
      source: 'adjustment',
      uniqueToken: 'ad-789',
    })).toBe('ADJ-20260718-BOX-12X12X10-AD-789');
  });

  it('keeps supplier references in notes instead of internal lot codes', () => {
    expect(receiptNotesWithSupplierReference({
      notes: 'Pallet looked good.',
      supplierReference: 'PO-123',
    })).toBe('Supplier reference: PO-123\nPallet looked good.');
  });
});
