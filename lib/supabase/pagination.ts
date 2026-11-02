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

/**
 * Keep PostgREST IN filters below URL limits while loading every related row.
 * Independent ID batches overlap, but each batch's pages stay sequential because
 * a server-side cap may be smaller than the requested page size. Callbacks must
 * construct a fresh query per request, rather than mutate a shared query builder.
 */
export async function fetchAllByIds<T>(
  ids: readonly string[],
  fetchPage: (ids: string[], from: number, to: number) => PromiseLike<QueryPage<T>>,
  { concurrency = 3 }: { concurrency?: number } = {},
): Promise<{ data: T[]; error: QueryError | null }> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new RangeError('ID batch concurrency must be an integer between 1 and 4.');
  }
  const uniqueIds = [...new Set(ids)];
  const batches: string[][] = [];
  for (let start = 0; start < uniqueIds.length; start += 200) {
    batches.push(uniqueIds.slice(start, start + 200));
  }
  const results: Awaited<ReturnType<typeof fetchAllPages<T>>>[] = [];
  let nextBatch = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && nextBatch < batches.length) {
      const batchIndex = nextBatch++;
      const result = await fetchAllPages((from, to) => fetchPage(batches[batchIndex], from, to));
      results[batchIndex] = result;
      if (result.error) failed = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  // Wait for already running batches and select errors in input order, so neither
  // returned rows nor the reported error depend on network completion order.
  const error = results.find((result) => result.error)?.error ?? null;
  return error ? { data: [], error } : { data: results.flatMap((result) => result.data), error: null };
}
