// Edge-safe (no Node APIs): imported by middleware.
/**
 * The storage key of a stored-file URL (/uploads/{key} or /api/files/{key}),
 * or null for any other path. Validation of the key itself happens in the
 * /api/files handler.
 */
export function storedFileKey(pathname: string): string | null {
  for (const prefix of ['/uploads/', '/api/files/']) {
    if (pathname.startsWith(prefix)) return pathname.slice(prefix.length);
  }
  return null;
}
