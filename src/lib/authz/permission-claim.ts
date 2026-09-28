/**
 * The signed session's permission claim: the user's effective permissions,
 * carried in the xl-session token so middleware can make the authorization
 * decision (src/lib/authz/policy.ts) without a database round-trip.
 *
 * A Tenant Admin holds ~200 permission strings; spelled out they would push
 * the cookie past the 4 KB browser limit, so the claim is a bitset over the
 * versioned catalogue ALL_PERMISSIONS, plus any permission outside it
 * (custom rows) spelled out, plus a flag for the platform wildcard.
 *
 * A claim signed against a different catalogue (catalogue version mismatch)
 * decodes to null: the policy treats that like a missing claim, and the
 * session is refreshed at the next sign-in.
 *
 * Edge-runtime safe (no Node APIs): middleware decodes it.
 */
import { ALL_PERMISSIONS } from '@/lib/permissions';

export interface PermissionClaim {
  /** Catalogue version the bitset was built against. */
  v: string;
  /** base64url bitset: bit i set = ALL_PERMISSIONS[i] granted. */
  b: string;
  /** Granted permissions outside the catalogue, as module:action:resource. */
  x?: string[];
  /** The platform wildcard '*:*:*' (platform SUPER_ADMIN). */
  w?: 1;
}

const CATALOGUE: readonly string[] = ALL_PERMISSIONS.map((p) => `${p.module}:${p.action}:${p.resource}`);
const INDEX = new Map(CATALOGUE.map((k, i) => [k, i]));

/** FNV-1a over the catalogue, so reordering or editing it changes the version. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const CATALOGUE_VERSION = fnv1a(CATALOGUE.join('|'));

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function encodePermissionClaim(permissions: readonly string[]): PermissionClaim {
  const bits = new Uint8Array(Math.ceil(CATALOGUE.length / 8));
  const extra = new Set<string>();
  let wildcard = false;
  for (const p of permissions) {
    if (p === '*:*:*') {
      wildcard = true;
      continue;
    }
    const i = INDEX.get(p);
    if (i === undefined) extra.add(p);
    else bits[i >> 3] |= 1 << (i & 7);
  }
  return {
    v: CATALOGUE_VERSION,
    b: toBase64Url(bits),
    ...(extra.size ? { x: [...extra].sort() } : {}),
    ...(wildcard ? { w: 1 as const } : {}),
  };
}

/** The permission strings in `claim`, or null when it is absent, malformed or from another catalogue version. */
export function decodePermissionClaim(claim: unknown): string[] | null {
  if (!claim || typeof claim !== 'object') return null;
  const c = claim as Partial<PermissionClaim>;
  if (c.v !== CATALOGUE_VERSION || typeof c.b !== 'string') return null;
  const bits = fromBase64Url(c.b);
  if (!bits) return null;
  const out: string[] = [];
  CATALOGUE.forEach((key, i) => {
    if ((bits[i >> 3] ?? 0) & (1 << (i & 7))) out.push(key);
  });
  if (Array.isArray(c.x)) for (const p of c.x) if (typeof p === 'string') out.push(p);
  if (c.w === 1) out.push('*:*:*');
  return out;
}
