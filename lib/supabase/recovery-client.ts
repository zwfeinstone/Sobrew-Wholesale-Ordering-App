import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { createAuthDeadline } from './auth-deadline';
import { resilientSupabaseFetch } from './resilient-jwks-fetch';
import type { Database } from './schema';

export const RECOVERY_AUTH_TIMEOUT_MS = 8_000;

type RecoveryCookieAdapter = {
  getAll(): { name: string; value: string }[];
  setAll(values: { name: string; value: string; options: CookieOptions }[]): void;
};

/** Bound the complete operation and abort its network requests on timeout. */
export async function withRecoveryClient<T>(
  operation: (client: SupabaseClient<Database>) => Promise<T>,
  cookieAdapter?: RecoveryCookieAdapter,
): Promise<T> {
  let adapter = cookieAdapter;
  if (!adapter) {
    const cookieStore = await cookies();
    adapter = {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components can only read cookies. Actions and the callback
          // persist the recovery session before the form is rendered.
        }
      },
    };
  }

  const deadline = createAuthDeadline(RECOVERY_AUTH_TIMEOUT_MS, resilientSupabaseFetch, {
    normalizeTransientStatuses: false,
  });
  let active = true;
  try {
    const client = createServerClient<Database>(env.supabaseUrl, env.supabaseAnon, {
      global: { fetch: deadline.fetch },
      cookies: {
        getAll: () => active ? adapter.getAll() : [],
        setAll(values) {
          // SDK error cleanup can finish after an aborted request. It must not
          // overwrite a verifier restored by the action, or revive a session.
          if (active) adapter.setAll(values);
        },
      },
    });
    return await deadline.run(operation(client));
  } finally {
    active = false;
    deadline.dispose({ abortPending: true });
  }
}
