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
import { resolveCorporateCustomerByEmail } from '@/lib/corporate-customer-identity';

let _ensured = false;

export async function ensureSsoTable(): Promise<void> {
  if (_ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant_sso_configs (
      id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                TEXT         NOT NULL UNIQUE,
      provider                 TEXT         NOT NULL DEFAULT 'oidc',
      issuer                   TEXT         NOT NULL,
      client_id                TEXT         NOT NULL,
      client_secret_encrypted  TEXT         NOT NULL,
      allowed_email_domains    JSONB        NOT NULL DEFAULT '[]'::jsonb,
      default_role_id          TEXT,
      jit_enabled              BOOLEAN      NOT NULL DEFAULT TRUE,
      is_active                BOOLEAN      NOT NULL DEFAULT TRUE,
      created_by_user_id       TEXT,
      created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_tenant_sso_active ON tenant_sso_configs (is_active) WHERE is_active = TRUE`,
  );
  _ensured = true;
}

// ── Secret encryption ────────────────────────────────────────────────────────

/**
 * Derive a 32-byte AES key from the configured secret.
 * Production deployments should set SSO_ENCRYPTION_KEY explicitly.
 */
function getKey(): Buffer {
  const raw =
    process.env.SSO_ENCRYPTION_KEY ??
    process.env.SESSION_SECRET ??
    'xl-mobility-dev-secret-change-in-production';
  return crypto.createHash('sha256').update(raw).digest();
}

/** Returns base64(iv | authTag | ciphertext). */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(stored: string): string {
  const buf = Buffer.from(stored, 'base64');
  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct  = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
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

export interface TenantSsoReadiness {
  status: 'ready' | 'incomplete' | 'inactive';
  issues: string[];
  redirectUri: string;
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
  await ensureSsoTable();
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
  await ensureSsoTable();
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

export function validateSsoConfigReadiness(
  config: Pick<TenantSsoConfig, 'issuer' | 'clientId' | 'clientSecret' | 'allowedEmailDomains' | 'isActive'>,
  appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
): TenantSsoReadiness {
  const issues: string[] = [];
  if (!config.isActive) issues.push('SSO configuration is inactive.');
  if (!/^https:\/\//i.test(config.issuer)) issues.push('Issuer must be an HTTPS URL.');
  if (!config.clientId.trim()) issues.push('Client ID is required.');
  if (!config.clientSecret.trim()) issues.push('Client secret is required.');
  if (!config.allowedEmailDomains.length) issues.push('At least one allowed email domain is required.');
  return {
    status: !config.isActive ? 'inactive' : issues.length ? 'incomplete' : 'ready',
    issues,
    redirectUri: `${appUrl.replace(/\/$/, '')}/api/auth/sso/callback`,
  };
}

/**
 * Returns the redacted public-safe view of a config (for admin list UIs).
 * Never includes the decrypted secret.
 */
export async function getSsoConfigPublic(tenantId: string): Promise<Omit<TenantSsoConfig, 'clientSecret'> & { clientSecretSet: boolean } | null> {
  await ensureSsoTable();
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

export async function discoverSsoByEmail(email: string) {
  const normalizedEmail = email.toLowerCase().trim();
  const domain = normalizedEmail.split('@')[1]?.toLowerCase().trim() ?? '';
  if (!domain || !/.+@.+\..+/.test(normalizedEmail)) {
    return { found: false, reason: 'invalid-email' as const, email: normalizedEmail, domain };
  }
  const cfg = await findSsoConfigByEmail(normalizedEmail);
  if (!cfg) {
    return { found: false, reason: 'not-configured' as const, email: normalizedEmail, domain };
  }
  const readiness = validateSsoConfigReadiness(cfg);
  const customer = await resolveCorporateCustomerByEmail(cfg.tenantId, normalizedEmail).catch(() => null);
  const tenant = await prisma.tenant.findUnique({
    where: { id: cfg.tenantId },
    select: { id: true, name: true, isActive: true },
  }).catch(() => null);
  if (!tenant?.isActive) {
    return { found: true, ready: false, reason: 'tenant-inactive' as const, email: normalizedEmail, domain, tenant, customer, readiness };
  }
  return {
    found: true,
    ready: readiness.status === 'ready',
    reason: readiness.status === 'ready' ? 'ready' as const : 'incomplete' as const,
    email: normalizedEmail,
    domain,
    tenant,
    customer,
    provider: cfg.provider,
    issuer: cfg.issuer,
    readiness,
  };
}
