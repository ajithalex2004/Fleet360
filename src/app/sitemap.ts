import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

export default function sitemap(): MetadataRoute.Sitemap {
  const site = getSiteUrl();
  const now = new Date();
  return [
    { url: new URL('/', site).toString(), lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: new URL('/operations-review', site).toString(), lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
  ];
}
