import { prisma } from '@/lib/prisma';

export type CustomerPortalRole = 'CUSTOMER_ADMIN' | 'CUSTOMER_MANAGER' | 'CUSTOMER_VIEWER' | 'CUSTOMER_USER';

export interface CorporateCustomerMatch {
  tenantId: string;
  customerId: string;
  customerName: string;
  domain: string;
  role: CustomerPortalRole;
}

let ensured = false;

export async function ensureCorporateCustomerIdentityTables() {
  if (ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS customer_domains (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tenant_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      is_verified BOOLEAN NOT NULL DEFAULT TRUE,
      verified_at TIMESTAMPTZ,
      verification_method TEXT,
      created_by_user_id TEXT,
      notes TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS customer_domains_domain_key
      ON customer_domains (LOWER(domain))
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_customer_domains_tenant_customer
      ON customer_domains (tenant_id, customer_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS customer_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tenant_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'CUSTOMER_USER',
      source TEXT NOT NULL DEFAULT 'MANUAL',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      invited_by_user_id TEXT,
      last_access_at TIMESTAMPTZ
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS customer_users_tenant_customer_user_key
      ON customer_users (tenant_id, customer_id, user_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_customer_users_user
      ON customer_users (user_id, tenant_id)
  `);
  ensured = true;
}

export function normalizeCustomerDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

export function emailDomain(email: string) {
  return normalizeCustomerDomain(email.split('@')[1] ?? '');
}

export function validCustomerDomain(domain: string) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) && !domain.includes('..');
}

export async function customerBelongsToTenant(customerId: string, tenantId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id
       FROM customers
      WHERE id::text = $1
        AND tenant_id::text = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    customerId,
    tenantId,
  ).catch(() => []);
  return rows.length > 0;
}

export async function listCustomerDomains(tenantId: string, customerId: string) {
  await ensureCorporateCustomerIdentityTables();
  return prisma.$queryRawUnsafe<Array<{
    id: string;
    domain: string;
    is_verified: boolean;
    verified_at: Date | null;
    verification_method: string | null;
    notes: string | null;
  }>>(
    `SELECT id::text, domain, is_verified, verified_at, verification_method, notes
       FROM customer_domains
      WHERE tenant_id = $1 AND customer_id = $2
      ORDER BY domain`,
    tenantId,
    customerId,
  );
}

export async function replaceCustomerDomains(args: {
  tenantId: string;
  customerId: string;
  domains: string[];
  actorUserId?: string | null;
  verificationMethod?: string;
}) {
  await ensureCorporateCustomerIdentityTables();
  const normalized = Array.from(new Set(args.domains.map(normalizeCustomerDomain).filter(validCustomerDomain)));
  const forbidden = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com']);
  const publicDomain = normalized.find(domain => forbidden.has(domain));
  if (publicDomain) {
    throw new Error(`Public email domain cannot be assigned to a corporate customer: ${publicDomain}`);
  }
  if (!(await customerBelongsToTenant(args.customerId, args.tenantId))) {
    throw new Error('Customer not found for tenant');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `DELETE FROM customer_domains WHERE tenant_id = $1 AND customer_id = $2`,
      args.tenantId,
      args.customerId,
    );
    for (const domain of normalized) {
      await tx.$executeRawUnsafe(
        `INSERT INTO customer_domains
           (tenant_id, customer_id, domain, is_verified, verified_at, verification_method, created_by_user_id)
         VALUES ($1, $2, $3, TRUE, NOW(), $4, $5)`,
        args.tenantId,
        args.customerId,
        domain,
        args.verificationMethod ?? 'ADMIN',
        args.actorUserId ?? null,
      );
    }
  });
  return listCustomerDomains(args.tenantId, args.customerId);
}

export async function resolveCorporateCustomerByEmail(tenantId: string, email: string): Promise<CorporateCustomerMatch | null> {
  await ensureCorporateCustomerIdentityTables();
  const domain = emailDomain(email);
  if (!validCustomerDomain(domain)) return null;
  const rows = await prisma.$queryRawUnsafe<Array<{
    customer_id: string;
    customer_name: string;
    domain: string;
  }>>(
    `SELECT cd.customer_id::text AS customer_id, c.name_en AS customer_name, cd.domain
       FROM customer_domains cd
       JOIN customers c ON c.id::text = cd.customer_id
      WHERE cd.tenant_id = $1
        AND LOWER(cd.domain) = LOWER($2)
        AND cd.is_verified = TRUE
        AND c.deleted_at IS NULL
        AND COALESCE(c.status, 'ACTIVE') = 'ACTIVE'
      LIMIT 1`,
    tenantId,
    domain,
  ).catch(() => []);
  const row = rows[0];
  return row ? {
    tenantId,
    customerId: row.customer_id,
    customerName: row.customer_name,
    domain: row.domain,
    role: 'CUSTOMER_USER',
  } : null;
}

export async function ensureCustomerUserLink(args: {
  tenantId: string;
  customerId: string;
  userId: string;
  role?: CustomerPortalRole;
  source?: string;
  invitedByUserId?: string | null;
}) {
  await ensureCorporateCustomerIdentityTables();
  if (!(await customerBelongsToTenant(args.customerId, args.tenantId))) {
    throw new Error('Customer not found for tenant');
  }
  const role = args.role ?? 'CUSTOMER_USER';
  await prisma.$executeRawUnsafe(
    `INSERT INTO customer_users
       (tenant_id, customer_id, user_id, role, source, is_active, invited_by_user_id)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6)
     ON CONFLICT (tenant_id, customer_id, user_id)
     DO UPDATE SET role = EXCLUDED.role, source = EXCLUDED.source, is_active = TRUE, updated_at = NOW()`,
    args.tenantId,
    args.customerId,
    args.userId,
    role,
    args.source ?? 'MANUAL',
    args.invitedByUserId ?? null,
  );
  return { tenantId: args.tenantId, customerId: args.customerId, userId: args.userId, role };
}

export async function customerContextForUser(tenantId: string, userId: string): Promise<CorporateCustomerMatch | null> {
  await ensureCorporateCustomerIdentityTables();
  const rows = await prisma.$queryRawUnsafe<Array<{
    customer_id: string;
    customer_name: string;
    domain: string | null;
    role: CustomerPortalRole;
  }>>(
    `SELECT cu.customer_id::text AS customer_id, c.name_en AS customer_name,
            MIN(cd.domain) AS domain, cu.role
       FROM customer_users cu
       JOIN customers c ON c.id::text = cu.customer_id
       LEFT JOIN customer_domains cd
         ON cd.tenant_id = cu.tenant_id AND cd.customer_id = cu.customer_id AND cd.is_verified = TRUE
      WHERE cu.tenant_id = $1
        AND cu.user_id = $2
        AND cu.is_active = TRUE
        AND c.deleted_at IS NULL
      GROUP BY cu.customer_id, c.name_en, cu.role
      ORDER BY c.name_en
      LIMIT 1`,
    tenantId,
    userId,
  ).catch(() => []);
  const row = rows[0];
  return row ? {
    tenantId,
    customerId: row.customer_id,
    customerName: row.customer_name,
    domain: row.domain ?? '',
    role: row.role,
  } : null;
}
