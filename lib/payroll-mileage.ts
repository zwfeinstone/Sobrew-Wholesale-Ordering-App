export type MileageSource = {
  notes: string | null;
  first_order_id?: string | null;
  amount_cents: number | string | null;
};

type MileageDetails = {
  miles: number | null;
  rateCents: number | null;
  status: 'recorded' | 'not_recorded' | 'needs_review';
};

// These bounds prevent malformed legacy notes from appearing as tracked mileage.
const MAX_MILES = 10_000;
const MAX_RATE_CENTS = 1_000;
const MILEAGE_DETAILS = /^\s*mileage(?:\s+reimbursement)?\s*:?\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+miles?\s*(?:at|@)\s*\$\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:per\s+mile|\/\s*mile)\b/i;

export function isMileageReimbursement(row: MileageSource): boolean {
  return !row.first_order_id && /^\s*mileage\b/i.test(row.notes ?? '');
}

export function getMileageDetails(row: MileageSource): MileageDetails {
  const unavailable = (status: 'not_recorded' | 'needs_review'): MileageDetails => ({ miles: null, rateCents: null, status });
  if (!isMileageReimbursement(row)) return unavailable('not_recorded');

  const notes = row.notes ?? '';
  const match = notes.match(MILEAGE_DETAILS);
  if (!match) {
    // A plain legacy label has no distance or rate to infer. Partial numeric
    // details need review instead of silently becoming a zero-mile trip.
    return unavailable(/[\d$@]|\b(?:NaN|Infinity)\b/i.test(notes) ? 'needs_review' : 'not_recorded');
  }

  const miles = Number(match[1]);
  const rawRateCents = Number(match[2]) * 100;
  const rateCents = Math.round(rawRateCents);
  const rawAmount = row.amount_cents;
  const amountCents = typeof rawAmount === 'number'
    ? rawAmount
    : typeof rawAmount === 'string' && /^\d+$/.test(rawAmount.trim())
      ? Number(rawAmount)
      : NaN;

  if (!Number.isFinite(miles) || miles <= 0 || miles > MAX_MILES
    || !Number.isFinite(rawRateCents) || rateCents <= 0 || rateCents > MAX_RATE_CENTS
    || Math.abs(rawRateCents - rateCents) > 1e-8
    || !Number.isSafeInteger(amountCents) || amountCents <= 0
    || Math.round(miles * rateCents) !== amountCents) {
    return unavailable('needs_review');
  }

  return { miles, rateCents, status: 'recorded' };
}
