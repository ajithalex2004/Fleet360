import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

// Only the public marketing pages are crawlable; the signed-in application and
// APIs are not. /_next/ stays open so crawlers can render the pages.
export default function robots(): MetadataRoute.Robots {
  const site = getSiteUrl();
  return {
    rules: [{ userAgent: '*', allow: ['/$', '/operations-review', '/opengraph-image', '/_next/'], disallow: ['/'] }],
    sitemap: new URL('/sitemap.xml', site).toString(),
    host: site.origin,
  };
}
