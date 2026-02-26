'use client';

import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/lib/env';

export const createClient = () => createBrowserClient(env.supabaseUrl, env.supabaseAnon);
