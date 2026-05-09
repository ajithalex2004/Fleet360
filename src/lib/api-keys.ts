/**
 * Tenant API key helpers — table schema, generation, verification.
 *
 * Key format:    xlk_<48 hex chars>
 *                ^^^ identifies the key as an XL Mobility API key
 *
 * Storage:
 *   - prefix     = first 12 chars after `xlk_` (lookup index, not secret)
 *   - hash       = sha256 of the FULL key (constant-time compared)
 *   - scopes     = JSON array of strings, e.g. ['fleet.read','bookings.write']
 *
 * The plaintext key is returned to the caller exactly once on create. After
 * that, only the prefix (for display) and hash (for verification) remain.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export const API_KEY_PREFIX_TAG = 'xlk_';
export const API_KEY_PREFIX_LEN = 12; // chars stored as the searchable prefix

let _ensured = false;

export async function ensureApiKeyTable(): Promise<void> {
  if (_ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant_api_keys (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       TEXT         NOT NULL,
      name            TEXT         NOT NULL,
      prefix          TEXT         NOT NULL,
      key_hash        TEXT         NOT NULL,
      scopes          JSONB        NOT NULL DEFAULT '[]'::jsonb,
      created_by_user_id TEXT,
      last_used_at    TIMESTAMPTZ,
      last_used_ip    TEXT,
      revoked         BOOLEAN      NOT NULL DEFAULT FALSE,
      revoked_at      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant ON tenant_api_keys (tenant_id)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_prefix ON tenant_api_keys (prefix)`,
  );
  _ensured = true;
}

export interface NewKeyResult {
  /** Full plaintext key — show ONCE to the user, never stored. */
  plaintext: string;
  /** First 12 chars after `xlk_` — safe to display. */
  prefix: string;
  /** sha256 hex of the full plaintext key — what's persisted. */
  hash: string;
}

export function generateApiKey(): NewKeyResult {
  const random    = crypto.randomBytes(24).toString('hex'); // 48 chars
  const plaintext = `${API_KEY_PREFIX_TAG}${random}`;
  const prefix    = random.slice(0, API_KEY_PREFIX_LEN);
  const hash      = crypto.createHash('sha256').update(plaintext).digest('hex');
  return { plaintext, prefix, hash };
}

/** Mask a stored prefix for display: xlk_abcd1234efgh… */
export function maskKey(prefix: string): string {
  return `${API_KEY_PREFIX_TAG}${prefix}…`;
}

/** Hash an incoming key for lookup. */
export function hashApiKey(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

/** Extract the searchable prefix from a plaintext key, or null if malformed. */
export function extractPrefix(plaintext: string): string | null {
  if (!plaintext.startsWith(API_KEY_PREFIX_TAG)) return null;
  const body = plaintext.slice(API_KEY_PREFIX_TAG.length);
  if (body.length < API_KEY_PREFIX_LEN) return null;
  return body.slice(0, API_KEY_PREFIX_LEN);
}

export interface ApiKeyMatch {
  id: string;
  tenantId: string;
  name: string;
  scopes: string[];
}

/**
 * Verify an incoming key. Returns the matched record (without secrets) or null.
 * Does NOT update last_used_at — caller does that fire-and-forget so timing
 * stays constant on the failure path.
 */
export async function verifyApiKey(plaintext: string): Promise<ApiKeyMatch | null> {
  const prefix = extractPrefix(plaintext);
  if (!prefix) return null;
  const hash = hashApiKey(plaintext);

  await ensureApiKeyTable();
  const rows = await prisma.$queryRawUnsafe<{
    id: string; tenant_id: string; name: string; key_hash: string; scopes: string[]; revoked: boolean;
  }[]>(
    `SELECT id::text, tenant_id, name, key_hash, scopes, revoked
     FROM tenant_api_keys
     WHERE prefix = $1
     LIMIT 5`,
    prefix,
  ).catch(() => []);

  for (const r of rows) {
    if (r.revoked) continue;
    if (timingSafeEqHex(r.key_hash, hash)) {
      return {
        id: r.id,
        tenantId: r.tenant_id,
        name: r.name,
        scopes: Array.isArray(r.scopes) ? r.scopes : [],
      };
    }
  }
  return null;
}

/** Fire-and-forget last_used update. Caller does not await. */
export async function touchApiKeyUsage(id: string, ip: string | null): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE tenant_api_keys SET last_used_at = NOW(), last_used_ip = $2 WHERE id = $1::uuid`,
    id, ip,
  ).catch(() => {});
}

function timingSafeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
