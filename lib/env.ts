const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
] as const;

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`Missing env var ${key}`);
  }
}

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  bootstrapToken: process.env.ADMIN_BOOTSTRAP_TOKEN ?? '',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  resendFrom: process.env.RESEND_FROM_EMAIL ?? 'hello@sobrew.com',
  sobrewAdminEmail: process.env.SOBREW_ADMIN_EMAIL ?? 'hello@sobrew.com',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
};
