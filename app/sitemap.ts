import type { MetadataRoute } from 'next';

const publicRoutes = ['/', '/login', '/privacy', '/eula'];

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map((route) => ({
    url: `https://app.sobrew.com${route}`,
    lastModified: new Date(),
  }));
}
