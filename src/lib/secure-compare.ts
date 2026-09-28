/**
 * Constant-time comparison for shared secrets (scheduler, webhook and setup
 * secrets). A plain `===` stops at the first differing character, so its
 * timing reveals how much of a guess was right.
 *
 * Edge-runtime safe (no Node APIs): middleware uses it too. An empty or
 * missing value on either side never matches, so an unset secret can't be
 * satisfied by an empty credential.
 */
export function secretsEqual(supplied: string | null | undefined, expected: string | null | undefined): boolean {
  if (!supplied || !expected) return false;
  const a = new TextEncoder().encode(supplied);
  const b = new TextEncoder().encode(expected);
  // Always walk the expected secret's full length; a length mismatch still
  // costs the same time and then fails.
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i % (a.length || 1)] ?? 0) ^ b[i];
  return diff === 0;
}

/**
 * The token of an `Authorization: Bearer <token>` header. A bare value with
 * no scheme is also returned, as schedulers configured before this helper
 * may send one; any other scheme (e.g. Basic) gives null.
 */
export function bearerToken(headers: Headers): string | null {
  const value = headers.get('authorization')?.trim();
  if (!value) return null;
  const m = /^Bearer\s+(.+)$/i.exec(value);
  if (m) return m[1];
  return /\s/.test(value) ? null : value;
}
