/**
 * SSO config helpers — table schema, secret encryption, lookup by domain.
 *
 * Multi-tenant OIDC: each tenant configures its own IdP (Microsoft Entra,
 * Google Workspace, Okta, Auth0, etc) by issuer URL + client ID + secret.
 * Login flow looks up the config from the user's email domain.
 *
 * Client secrets are encrypted at rest with AES-256-GCM, keyed off
 * SSO_ENCRYPTION_KEY (or falls back to SESSION_SECRET in dev).
 *
 * Lazy-creates the table on first use.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { requireSsoEncryptionSecret } from '@/lib/session-secret';

// ── Secret encryption & lifecycle ───────────────────────────────────────────

/**
 * Derive a 32-byte AES key from the configured secret.
 * Production deployments require SSO_ENCRYPTION_KEY explicitly.
 */
function getKey(customSecret?: string): Buffer {
  const s = customSecret ?? requireSsoEncryptionSecret();
  return crypto.createHash('sha256').update(s).digest();
}

/**
 * Encrypts plaintext with the active key, producing versioned ciphertext: 'v1:<base64>'
 * Payload structure inside base64: IV (12 bytes) | AuthTag (16 bytes) | Ciphertext
 */
export function encryptSecret(plaintext: string, customKey?: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(customKey), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const raw = Buffer.concat([iv, tag, ct]).toString('base64');
  return `v1:${raw}`;
}

/**
 * Decrypts ciphertext (supporting versioned 'v1:' and legacy unversioned 'v0').
 * Falls back to SSO_PREVIOUS_ENCRYPTION_KEY or options.previousKey if active key fails.
 */
export function decryptSecret(stored: string, options?: { activeKey?: string; previousKey?: string }): string {
  if (!stored) throw new Error('Cannot decrypt empty ciphertext');

  const rawBase64 = stored.startsWith('v1:') ? stored.slice(3) : stored;
  const buf = Buffer.from(rawBase64, 'base64');
  if (buf.length < 28) {
    throw new Error('Malformed ciphertext payload (insufficient length for IV + AuthTag).');
  }

  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct  = buf.subarray(28);

  // 1. Try active key
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(options?.activeKey), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // 2. If active key fails, check for an authorized previous key during controlled rotation
    const previousSecret = options?.previousKey || process.env.SSO_PREVIOUS_ENCRYPTION_KEY;
    if (previousSecret) {
      try {
        const fallbackDecipher = crypto.createDecipheriv('aes-256-gcm', getKey(previousSecret), iv);
        fallbackDecipher.setAuthTag(tag);
        return Buffer.concat([fallbackDecipher.update(ct), fallbackDecipher.final()]).toString('utf8');
      } catch {
        // Fall through to throw standard decryption error
      }
    }
    throw new Error('Failed to decrypt SSO client secret: key mismatch or corrupted ciphertext.');
  }
}

/**
 * Migration helper: Re-encrypts existing stored ciphertext under the active key.
 * Safely migrates legacy v0 unversioned or previous-key ciphertext to active v1 ciphertext.
 */
export function reencryptSecret(stored: string, activeKey?: string, previousKey?: string): string {
  const plaintext = decryptSecret(stored, { activeKey, previousKey });
  return encryptSecret(plaintext, activeKey);
}

// ── Config lookup ────────────────────────────────────────────────────────────

export interface TenantSsoConfig {
  id: string;
  tenantId: string;
  provider: 'oidc';
  issuer: string;
  clientId: string;
  /** Decrypted on read — handle carefully. */
  clientSecret: string;
  allowedEmailDomains: string[];
  defaultRoleId: string | null;
  jitEnabled: boolean;
  isActive: boolean;
}

interface SsoRow {
  id: string;
  tenant_id: string;
  provider: string;
  issuer: string;
  client_id: string;
  client_secret_encrypted: string;
  allowed_email_domains: string[];
  default_role_id: string | null;
  jit_enabled: boolean;
  is_active: boolean;
}

function rowToConfig(r: SsoRow): TenantSsoConfig {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    provider: 'oidc',
    issuer: r.issuer,
    clientId: r.client_id,
    clientSecret: decryptSecret(r.client_secret_encrypted),
    allowedEmailDomains: Array.isArray(r.allowed_email_domains) ? r.allowed_email_domains : [],
    defaultRoleId: r.default_role_id,
    jitEnabled: r.jit_enabled,
    isActive: r.is_active,
  };
}

export async function findSsoConfigByTenant(tenantId: string): Promise<TenantSsoConfig | null> {
  const rows = await prisma.$queryRawUnsafe<SsoRow[]>(
    `SELECT id::text, tenant_id, provider, issuer, client_id, client_secret_encrypted,
            allowed_email_domains, default_role_id, jit_enabled, is_active
     FROM tenant_sso_configs
     WHERE tenant_id = $1
     LIMIT 1`,
    tenantId,
  ).catch(() => []);
  return rows[0] ? rowToConfig(rows[0]) : null;
}

/**
 * Look up an active SSO config by an email's domain part.
 * Returns null when no tenant claims the domain — caller falls back to
 * password login.
 */
export async function findSsoConfigByEmail(email: string): Promise<TenantSsoConfig | null> {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return null;
  // JSONB ?| array_text checks if the array contains any of the given keys.
  const rows = await prisma.$queryRawUnsafe<SsoRow[]>(
    `SELECT id::text, tenant_id, provider, issuer, client_id, client_secret_encrypted,
            allowed_email_domains, default_role_id, jit_enabled, is_active
     FROM tenant_sso_configs
     WHERE is_active = TRUE
       AND allowed_email_domains ?| ARRAY[$1]::text[]
     LIMIT 1`,
    domain,
  ).catch(() => []);
  return rows[0] ? rowToConfig(rows[0]) : null;
}

/**
 * Returns the redacted public-safe view of a config (for admin list UIs).
 * Never includes the decrypted secret.
 */
export async function getSsoConfigPublic(tenantId: string): Promise<Omit<TenantSsoConfig, 'clientSecret'> & { clientSecretSet: boolean } | null> {
  const rows = await prisma.$queryRawUnsafe<SsoRow[]>(
    `SELECT id::text, tenant_id, provider, issuer, client_id, client_secret_encrypted,
            allowed_email_domains, default_role_id, jit_enabled, is_active
     FROM tenant_sso_configs
     WHERE tenant_id = $1
     LIMIT 1`,
    tenantId,
  ).catch(() => []);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    tenantId: r.tenant_id,
    provider: 'oidc',
    issuer: r.issuer,
    clientId: r.client_id,
    clientSecretSet: !!r.client_secret_encrypted,
    allowedEmailDomains: Array.isArray(r.allowed_email_domains) ? r.allowed_email_domains : [],
    defaultRoleId: r.default_role_id,
    jitEnabled: r.jit_enabled,
    isActive: r.is_active,
  };
}
