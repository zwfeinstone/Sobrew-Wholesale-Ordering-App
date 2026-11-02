type ReceiptCostInput = {
  quantity: string;
  totalItemCost: string;
  freightCost?: string;
  miscellaneousCost?: string;
};

function parseReceiptNumber(value: string, decimalPlaces: number): number | null {
  const text = value.trim();
  if (!new RegExp(`^(?:\\d+(?:\\.\\d{0,${decimalPlaces}})?|\\.\\d{1,${decimalPlaces}})$`).test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Shared by the live preview and server action so saved costs use the entered totals. */
export function calculateReceiptCosts(input: ReceiptCostInput) {
  const quantity = parseReceiptNumber(input.quantity, 4);
  const itemTotal = parseReceiptNumber(input.totalItemCost, 2);
  const freight = parseReceiptNumber(input.freightCost?.trim() || '0', 2);
  const miscellaneous = parseReceiptNumber(input.miscellaneousCost?.trim() || '0', 2);
  if (quantity === null || quantity <= 0 || itemTotal === null || freight === null || miscellaneous === null) return null;

  const itemTotalCostCents = Math.round(itemTotal * 100);
  const freightCents = Math.round(freight * 100);
  const otherCostCents = Math.round(miscellaneous * 100);
  const totalLandedCostCents = itemTotalCostCents + freightCents + otherCostCents;
  const itemUnitCostCents = itemTotalCostCents / quantity;
  const landedUnitCostCents = totalLandedCostCents / quantity;

  // Quantity and stored costs must fit the existing numeric(14, 4) columns.
  if (!Number.isSafeInteger(totalLandedCostCents) ||
      [quantity, freightCents, otherCostCents, itemUnitCostCents, landedUnitCostCents].some((value) => value >= 10_000_000_000)) return null;

  return { quantity, itemTotalCostCents, freightCents, otherCostCents, totalLandedCostCents, itemUnitCostCents, landedUnitCostCents };
}
