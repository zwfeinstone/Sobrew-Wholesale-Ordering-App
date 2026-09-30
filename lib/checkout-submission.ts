import type { CartItem } from '@/lib/cart';

type SubmissionCartItem = Pick<CartItem, 'product_id' | 'qty'>;
type SubmissionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type CheckoutSubmission = {
  version: 1;
  submissionId: string;
  cartFingerprint: string;
  status: 'draft' | 'submitted' | 'completed';
  orderId?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function submissionStorageKey(cartStorageKey: string) {
  return `${cartStorageKey}:checkout-submission`;
}

// Catalog labels and prices can refresh independently of the customer's order intent.
export function checkoutCartFingerprint(items: SubmissionCartItem[]) {
  const quantities = new Map<string, number>();
  for (const item of items) {
    quantities.set(item.product_id, (quantities.get(item.product_id) ?? 0) + item.qty);
  }
  return JSON.stringify([...quantities.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export function readCheckoutSubmission(storage: SubmissionStorage, cartStorageKey: string): CheckoutSubmission | null {
  const serialized = storage.getItem(submissionStorageKey(cartStorageKey));
  if (!serialized) return null;
  let value: Partial<CheckoutSubmission>;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (
    !value || value.version !== 1
    || typeof value.submissionId !== 'string' || !UUID_PATTERN.test(value.submissionId)
    || typeof value.cartFingerprint !== 'string'
    || !['draft', 'submitted', 'completed'].includes(value.status ?? '')
    || (value.status === 'completed' && (typeof value.orderId !== 'string' || !UUID_PATTERN.test(value.orderId)))
  ) return null;
  return value as CheckoutSubmission;
}

function saveCheckoutSubmission(storage: SubmissionStorage, cartStorageKey: string, submission: CheckoutSubmission) {
  storage.setItem(submissionStorageKey(cartStorageKey), JSON.stringify(submission));
  return submission;
}

export function resetCheckoutSubmission(storage: SubmissionStorage, cartStorageKey: string) {
  storage.removeItem(submissionStorageKey(cartStorageKey));
}

export function resolveCheckoutSubmission(
  storage: SubmissionStorage,
  cartStorageKey: string,
  items: SubmissionCartItem[],
  createId: () => string = () => crypto.randomUUID()
): CheckoutSubmission | null {
  if (!items.length) return null;
  const cartFingerprint = checkoutCartFingerprint(items);
  const existing = readCheckoutSubmission(storage, cartStorageKey);
  if (existing?.cartFingerprint === cartFingerprint) return existing;

  return saveCheckoutSubmission(storage, cartStorageKey, {
    version: 1,
    submissionId: createId(),
    cartFingerprint,
    status: 'draft',
  });
}

export function submitCheckoutSubmission(storage: SubmissionStorage, cartStorageKey: string, items: SubmissionCartItem[]) {
  // Read again at submit time: another tab may have prepared or completed this cart.
  const submission = resolveCheckoutSubmission(storage, cartStorageKey, items);
  if (!submission || submission.status === 'completed') return submission;
  return saveCheckoutSubmission(storage, cartStorageKey, { ...submission, status: 'submitted' });
}

export function acknowledgeCheckoutSubmission(
  storage: SubmissionStorage,
  cartStorageKey: string,
  { submissionId, orderId, items }: { submissionId: string | null; orderId: string; items: SubmissionCartItem[] }
) {
  const existing = readCheckoutSubmission(storage, cartStorageKey);
  if (
    !submissionId || !existing || existing.submissionId !== submissionId
    || existing.status === 'completed'
    || existing.cartFingerprint !== checkoutCartFingerprint(items)
  ) return false;

  saveCheckoutSubmission(storage, cartStorageKey, { ...existing, status: 'completed', orderId });
  return true;
}
