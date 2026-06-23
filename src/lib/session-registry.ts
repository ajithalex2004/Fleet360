import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';

let ensured = false;

export async function ensureSessionRegistryTable() {
  if (ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      tenant_id       TEXT NOT NULL,
      role_code       TEXT,
      plan_code       TEXT,
      impersonated_by TEXT,
      ip_address      TEXT,
      user_agent      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at      TIMESTAMPTZ NOT NULL,
      revoked_at      TIMESTAMPTZ,
      revoked_by      TEXT,
      revoke_reason   TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, revoked_at, last_seen_at DESC)`).catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_tenant ON auth_sessions(tenant_id, revoked_at, last_seen_at DESC)`).catch(() => {});
  ensured = true;
}

export function newSessionId() {
  return randomUUID();
}

export async function registerSession(args: {
  id: string;
  userId: string;
  tenantId: string;
  role: string;
  plan: string;
  expiresAt: Date;
  impersonatedBy?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  await ensureSessionRegistryTable();
  await prisma.$executeRawUnsafe(
    `INSERT INTO auth_sessions
       (id, user_id, tenant_id, role_code, plan_code, impersonated_by, ip_address, user_agent, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = NOW()`,
    args.id,
    args.userId,
    args.tenantId,
    args.role,
    args.plan,
    args.impersonatedBy ?? null,
    args.ipAddress ?? null,
    args.userAgent ?? null,
    args.expiresAt,
  );
}

export async function isSessionRevoked(sessionId?: string | null) {
  if (!sessionId) return false;
  await ensureSessionRegistryTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ revoked: boolean }>>(
    `SELECT (revoked_at IS NOT NULL OR expires_at < NOW()) AS revoked
       FROM auth_sessions
      WHERE id = $1
      LIMIT 1`,
    sessionId,
  ).catch(() => []);
  return rows[0]?.revoked === true;
}

export async function touchSession(sessionId?: string | null, ipAddress?: string | null, userAgent?: string | null) {
  if (!sessionId) return;
  await ensureSessionRegistryTable();
  await prisma.$executeRawUnsafe(
    `UPDATE auth_sessions
        SET last_seen_at = NOW(),
            ip_address = COALESCE($2, ip_address),
            user_agent = COALESCE($3, user_agent)
      WHERE id = $1 AND revoked_at IS NULL`,
    sessionId,
    ipAddress ?? null,
    userAgent ?? null,
  ).catch(() => {});
}

export async function revokeSession(sessionId: string, revokedBy: string, reason?: string | null) {
  await ensureSessionRegistryTable();
  await prisma.$executeRawUnsafe(
    `UPDATE auth_sessions
        SET revoked_at = COALESCE(revoked_at, NOW()),
            revoked_by = $2,
            revoke_reason = $3
      WHERE id = $1`,
    sessionId,
    revokedBy,
    reason ?? null,
  );
}

