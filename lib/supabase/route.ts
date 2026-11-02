import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { env } from '@/lib/env';
import { resilientSupabaseFetch } from '@/lib/supabase/resilient-jwks-fetch';
import { createReportInvalidatingFetch } from '@/lib/supabase/report-cache-fetch';
import type { Database } from './schema';

export function createRouteClient(request: NextRequest, response: NextResponse) {
  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnon, {
    global: { fetch: createReportInvalidatingFetch(resilientSupabaseFetch, env.supabaseUrl) },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });
}
