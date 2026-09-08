type Row = Record<string, unknown>;

export type SupabaseRead = {
  table: string;
  columns: string;
  from: number;
  to: number;
  filters: Array<{ operator: string; column: string; value: unknown }>;
  orders: Array<{ column: string; ascending?: boolean }>;
  head: boolean;
};

/** A read-only PostgREST stub that enforces row caps and records executed queries. */
export function supabaseReadStub({
  tables = {},
  maxRows = 1000,
  fail,
}: {
  tables?: Record<string, Row[]>;
  maxRows?: number;
  fail?: (read: SupabaseRead) => string | undefined;
} = {}) {
  const reads: SupabaseRead[] = [];
  const client = {
    from(table: string) {
      const read: SupabaseRead = { table, columns: '*', from: 0, to: Infinity, filters: [], orders: [], head: false };
      let single = false;
      const filter = (operator: string, column: string, value: unknown) => {
        read.filters.push({ operator, column, value });
        return query;
      };
      const query = {
        select(columns: string, options?: { head?: boolean }) {
          read.columns = columns;
          read.head = options?.head ?? false;
          return query;
        },
        eq: (column: string, value: unknown) => filter('eq', column, value),
        gte: (column: string, value: unknown) => filter('gte', column, value),
        gt: (column: string, value: unknown) => filter('gt', column, value),
        lt: (column: string, value: unknown) => filter('lt', column, value),
        lte: (column: string, value: unknown) => filter('lte', column, value),
        in: (column: string, value: unknown) => filter('in', column, value),
        not: (column: string, operator: string, value: unknown) => filter(`not.${operator}`, column, value),
        or: (value: string) => filter('or', '', value),
        order(column: string, options?: { ascending?: boolean }) {
          read.orders.push({ column, ascending: options?.ascending });
          return query;
        },
        range(from: number, to: number) {
          read.from = from;
          read.to = to;
          return query;
        },
        limit(limit: number) {
          read.to = read.from + limit - 1;
          return query;
        },
        maybeSingle() {
          single = true;
          return query;
        },
        then(resolve: (result: { data: Row[] | Row | null; error: { message: string } | null; count: number }) => unknown) {
          const executed = { ...read, orders: [...read.orders], filters: [...read.filters] };
          reads.push(executed);
          const message = fail?.(executed);
          const rows = tables[table] ?? [];
          const page = rows.slice(read.from, Math.min(read.to + 1, read.from + maxRows));
          return Promise.resolve({
            data: message || read.head ? null : single ? page[0] ?? null : page,
            error: message ? { message } : null,
            count: rows.length,
          }).then(resolve);
        },
      };
      return query;
    },
  };
  return { client, reads };
}
