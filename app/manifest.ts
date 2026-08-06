import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sobrew Coffee Wholesale Ordering Portal',
    short_name: 'Sobrew Coffee',
    description:
      'Online ordering portal for Sobrew specialty coffee customers and wholesale coffee programs.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f6b57',
    categories: ['business', 'food', 'productivity'],
    icons: [
      {
        src: '/sobrew-logo.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/sobrew-logo.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
