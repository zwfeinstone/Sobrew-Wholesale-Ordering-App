import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { env } from '@/lib/env';

export function createRouteClient(request: NextRequest, response: NextResponse) {
  return createServerClient(env.supabaseUrl, env.supabaseAnon, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: Record<string, unknown>) {
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: Record<string, unknown>) {
        response.cookies.set({ name, value: '', ...options });
      },
    },
  });
}
