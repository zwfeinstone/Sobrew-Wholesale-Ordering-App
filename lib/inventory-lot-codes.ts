import { randomUUID } from 'node:crypto';

type InventoryLotCodeItem = {
  id?: string | null;
  item_type?: string | null;
  name?: string | null;
  sku?: string | null;
};

type InventoryLotSource = 'adjustment' | 'purchase';

function compactToken(value: unknown, fallback: string, maxLength: number) {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  const trimmed = normalized.slice(0, maxLength).replace(/-+$/g, '');
  return trimmed || fallback;
}

function dateStamp(value: unknown) {
  const raw = String(value ?? '').trim();
  const dateInput = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateInput) return `${dateInput[1]}${dateInput[2]}${dateInput[3]}`;

  const parsed = new Date(raw || Date.now());
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function sourcePrefix(item: InventoryLotCodeItem, source: InventoryLotSource) {
  if (source === 'adjustment') return 'ADJ';
  if (item.item_type === 'raw_coffee') return 'RAW';
  if (item.item_type === 'material_supply' || item.item_type === 'supply') return 'MAT';
  return 'INV';
}

function itemToken(item: InventoryLotCodeItem) {
  const fallback = item.id ? compactToken(item.id, 'ITEM', 8) : 'ITEM';
  return compactToken(item.sku || item.name, fallback, 18).replace(/^(RAW|MAT|FIN|SUP|INV)-/, '') || fallback;
}

export function buildInventoryLotCode({
  item,
  receivedAt,
  source,
  uniqueToken,
}: {
  item: InventoryLotCodeItem;
  receivedAt: string;
  source: InventoryLotSource;
  uniqueToken?: string;
}) {
  const suffix = compactToken(uniqueToken ?? randomUUID(), 'LOT', 6);
  return `${sourcePrefix(item, source)}-${dateStamp(receivedAt)}-${itemToken(item)}-${suffix}`;
}

export function receiptNotesWithSupplierReference({
  notes,
  supplierReference,
}: {
  notes?: string | null;
  supplierReference?: string | null;
}) {
  return [
    supplierReference?.trim() ? `Supplier reference: ${supplierReference.trim()}` : '',
    notes?.trim() ?? '',
  ].filter(Boolean).join('\n') || null;
}
