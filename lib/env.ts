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
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  cronSecret: process.env.CRON_SECRET ?? '',
  hubspotAccessToken: process.env.HUBSPOT_ACCESS_TOKEN ?? '',
  hubspotDealPipeline: process.env.HUBSPOT_DEAL_PIPELINE ?? 'default',
  hubspotPortalId: process.env.HUBSPOT_PORTAL_ID ?? '',
  hubspotSampleRequestedDealStage: process.env.HUBSPOT_SAMPLE_REQUESTED_DEAL_STAGE ?? 'appointmentscheduled',
  quickBooksClientId: process.env.QUICKBOOKS_CLIENT_ID ?? '',
  quickBooksClientSecret: process.env.QUICKBOOKS_CLIENT_SECRET ?? '',
  quickBooksDefaultItemId: process.env.QUICKBOOKS_DEFAULT_ITEM_ID ?? '',
  quickBooksDefaultItemName: process.env.QUICKBOOKS_DEFAULT_ITEM_NAME ?? '',
  quickBooksEnvironment: process.env.QUICKBOOKS_ENVIRONMENT ?? 'sandbox',
  quickBooksMinorVersion: process.env.QUICKBOOKS_MINOR_VERSION ?? '75',
  quickBooksRedirectUri: process.env.QUICKBOOKS_REDIRECT_URI ?? '',
};
