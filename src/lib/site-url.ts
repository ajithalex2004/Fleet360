/** Public origin of the marketing site, for canonical URLs, sitemaps and OG tags. */
export function getSiteUrl(): URL {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
  } catch {
    return new URL('http://localhost:3000');
  }
}
