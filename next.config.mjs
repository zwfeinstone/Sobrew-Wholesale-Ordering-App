/** @type {import('next').NextConfig} */
const nextConfig = {
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
