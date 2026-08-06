import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/login', '/privacy', '/eula'],
        disallow: ['/admin', '/api', '/portal'],
      },
    ],
    sitemap: 'https://app.sobrew.com/sitemap.xml',
    host: 'https://app.sobrew.com',
  };
}
