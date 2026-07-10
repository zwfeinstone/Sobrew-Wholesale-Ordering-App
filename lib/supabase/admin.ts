import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

function createAdminClient() {
  return createClient(env.supabaseUrl, env.serviceRole, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export type SupabaseAdminClient = ReturnType<typeof createAdminClient>;

let adminClient: SupabaseAdminClient | null = null;

/**
 * Lazily creates the service-role client so importing a server module during a
 * build does not initialize an SDK with incomplete runtime configuration.
 */
export function getSupabaseAdmin(): SupabaseAdminClient {
  if (typeof window !== 'undefined') {
    throw new Error('The Supabase service-role client can only be used on the server.');
  }

  if (!adminClient) {
    adminClient = createAdminClient();
  }

  return adminClient;
}

/**
 * Backward-compatible lazy facade for server modules that have not migrated to
 * getSupabaseAdmin yet. Accessing a property initializes the client; importing
 * this module does not.
 */
export const supabaseAdmin = new Proxy({} as SupabaseAdminClient, {
  get(_target, property) {
    const client = getSupabaseAdmin();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
