/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return ['/forgot-password', '/reset-password', '/auth/recovery'].map((source) => ({
      source,
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ],
    }));
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  images: {
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ovrzooxvvernqqcotpkv.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  }
};
export default nextConfig;
