import { addDays, parseDateInput } from '@/lib/reporting';

export const RECENT_ORDER_GPM_PAGE_SIZE = 25;

export function recentOrderGpmPageOptions(
  startInput: string | string[] | undefined,
  endInput: string | string[] | undefined,
  pageInput: string | string[] | undefined,
) {
  const start = parseDateInput(startInput);
  const end = parseDateInput(endInput);
  const error = (startInput && !start) || (endInput && !end)
    ? 'Enter valid shipment dates.'
    : start && end && end < start ? 'The end date must be on or after the start date.' : undefined;
  const parsed = typeof pageInput === 'string' && /^[1-9]\d*$/.test(pageInput) ? Number(pageInput) : 1;
  return {
    error,
    options: {
      limit: RECENT_ORDER_GPM_PAGE_SIZE,
      page: Number.isSafeInteger(parsed) ? parsed : 1,
      start: start?.toISOString(),
      endExclusive: end ? addDays(end, 1).toISOString() : undefined,
    },
  };
}

type TimedOrder = { id: string; shipped_at?: string | null; created_at?: string | null };

function timestamp(value: string) {
  // Supabase can return microsecond precision; Date.parse truncates to ms.
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? '';
  return Date.parse(value) * 1000 + Number(fraction.padEnd(6, '0').slice(3, 6));
}

export function compareRecentReportOrders(left: TimedOrder, right: TimedOrder) {
  return timestamp(right.shipped_at ?? right.created_at ?? '') - timestamp(left.shipped_at ?? left.created_at ?? '')
    || (right.id > left.id ? 1 : right.id < left.id ? -1 : 0);
}

/** Find how many rows from the left stream belong to the skipped prefix. */
export async function recentOrderMergeOffset<T>(
  offset: number, leftCount: number, rightCount: number,
  leftAt: (index: number) => Promise<T>, rightAt: (index: number) => Promise<T>,
  compare: (left: T, right: T) => number,
) {
  let low = Math.max(0, offset - rightCount);
  let high = Math.min(offset, leftCount);
  // Find the first split where the left stream's next row does not outrank
  // the right stream's last skipped row. No skipped prefixes are downloaded.
  while (low < high) {
    const left = low + Math.floor((high - low) / 2);
    const right = offset - left;
    const [nextLeft, lastRight] = await Promise.all([leftAt(left), rightAt(right - 1)]);
    if (compare(nextLeft, lastRight) < 0) low = left + 1;
    else high = left;
  }
  return low;
}
