import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { env } from '@/lib/env';

export async function createClient() {
  const cookieStore = cookies();
  const setCookie = (name: string, value: string, options: Record<string, unknown>) => {
    try {
      cookieStore.set({ name, value, ...options });
    } catch {
      // Server Components can read cookies but cannot modify them. Middleware and
      // Route Handlers are responsible for persisting Supabase auth cookie updates.
    }
  };

  return createServerClient(env.supabaseUrl, env.supabaseAnon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: Record<string, unknown>) {
        setCookie(name, value, options);
      },
      remove(name: string, options: Record<string, unknown>) {
        setCookie(name, '', options);
      }
    }
  });
}
