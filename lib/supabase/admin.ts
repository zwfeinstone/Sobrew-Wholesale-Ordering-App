import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

export const supabaseAdmin = createClient(env.supabaseUrl, env.serviceRole, {
  auth: { persistSession: false }
});
