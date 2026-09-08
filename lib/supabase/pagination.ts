export type QueryError = { message: string; code?: string };
export type QueryPage<T> = { data: T[] | null; error: QueryError | null };

/**
 * Read a complete, deterministically ordered query in bounded requests.
 * Callers must order by a unique key (or append one as a tie-breaker).
 * Continue until empty: the server may enforce a smaller page size than requested.
 * Discard partial results on failure so reports cannot mistake them for full data.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<QueryPage<T>>,
  { pageSize = 1000 }: { pageSize?: number } = {},
): Promise<{ data: T[]; error: QueryError | null }> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new RangeError('Page size must be an integer between 1 and 1000.');
  }
  const rows: T[] = [];
  for (;;) {
    try {
      const { data, error } = await fetchPage(rows.length, rows.length + pageSize - 1);
      if (error) return { data: [], error };
      if (!data?.length) return { data: rows, error: null };
      rows.push(...data);
    } catch (error) {
      return { data: [], error: { message: error instanceof Error ? error.message : 'Unable to load all records.' } };
    }
  }
}

/** Keep PostgREST IN filters below URL limits while loading every related row. */
export async function fetchAllByIds<T>(
  ids: readonly string[],
  fetchPage: (ids: string[], from: number, to: number) => PromiseLike<QueryPage<T>>,
): Promise<{ data: T[]; error: QueryError | null }> {
  const uniqueIds = [...new Set(ids)];
  const data: T[] = [];
  for (let start = 0; start < uniqueIds.length; start += 200) {
    const batch = uniqueIds.slice(start, start + 200);
    const result = await fetchAllPages((from, to) => fetchPage(batch, from, to));
    if (result.error) return { data: [], error: result.error };
    data.push(...result.data);
  }
  return { data, error: null };
}
