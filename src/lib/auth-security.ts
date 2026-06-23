import { prisma } from '@/lib/prisma';

const FAILED_WINDOW_MINUTES = 15;
const LOCKOUT_FAILURES = 5;
const LOCKOUT_MINUTES = 15;

let ensured = false;

export async function ensureAuthSecurityTables() {
  if (ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS auth_login_attempts (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email          TEXT NOT NULL,
      tenant_id      TEXT,
      user_id        TEXT,
      success        BOOLEAN NOT NULL DEFAULT FALSE,
      failure_reason TEXT,
      ip_address     TEXT,
      user_agent     TEXT,
      locked_until   TIMESTAMPTZ,
      occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_email_time
    ON auth_login_attempts(email, occurred_at DESC)
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_tenant_time
    ON auth_login_attempts(tenant_id, occurred_at DESC)
  `).catch(() => {});
  ensured = true;
}

function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

export async function getActiveAccountLockout(email: string, tenantId?: string | null) {
  await ensureAuthSecurityTables();
  const rows = await prisma.$queryRawUnsafe<Array<{ locked_until: string | null }>>(
    `SELECT locked_until::text
       FROM auth_login_attempts
      WHERE email = $1
        AND ($2::text IS NULL OR tenant_id IS NULL OR tenant_id = $2)
        AND locked_until IS NOT NULL
        AND locked_until > NOW()
      ORDER BY locked_until DESC
      LIMIT 1`,
    normalizeEmail(email),
    tenantId ?? null,
  );
  return rows[0]?.locked_until ?? null;
}

export async function recordLoginAttempt(args: {
  email: string;
  tenantId?: string | null;
  userId?: string | null;
  success: boolean;
  failureReason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  await ensureAuthSecurityTables();
  const email = normalizeEmail(args.email);
  let lockedUntil: Date | null = null;

  if (!args.success) {
    const rows = await prisma.$queryRawUnsafe<Array<{ failures: bigint }>>(
      `SELECT COUNT(*) AS failures
         FROM auth_login_attempts
        WHERE email = $1
          AND ($2::text IS NULL OR tenant_id IS NULL OR tenant_id = $2)
          AND success = FALSE
          AND occurred_at >= NOW() - ($3 || ' minutes')::interval`,
      email,
      args.tenantId ?? null,
      FAILED_WINDOW_MINUTES,
    );
    if (Number(rows[0]?.failures ?? 0) + 1 >= LOCKOUT_FAILURES) {
      lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
    }
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO auth_login_attempts
       (email, tenant_id, user_id, success, failure_reason, ip_address, user_agent, locked_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    email,
    args.tenantId ?? null,
    args.userId ?? null,
    args.success,
    args.success ? null : args.failureReason ?? 'LOGIN_FAILED',
    args.ipAddress ?? null,
    args.userAgent ?? null,
    lockedUntil,
  );

  return { lockedUntil: lockedUntil?.toISOString() ?? null };
}

export async function getLoginSecuritySummary(tenantId?: string | null) {
  await ensureAuthSecurityTables();
  const rows = await prisma.$queryRawUnsafe<Array<{
    failed_24h: bigint;
    locked_accounts: bigint;
    recent_failures: Array<{
      email: string;
      tenantId: string | null;
      userId: string | null;
      failureReason: string | null;
      ipAddress: string | null;
      lockedUntil: string | null;
      occurredAt: string;
    }>;
  }>>(
    `WITH scoped AS (
       SELECT *
         FROM auth_login_attempts
        WHERE ($1 = '' OR tenant_id = $1)
     ),
     counts AS (
       SELECT
         COUNT(*) FILTER (WHERE success = FALSE AND occurred_at >= NOW() - INTERVAL '24 hours') AS failed_24h,
         COUNT(DISTINCT email) FILTER (WHERE locked_until > NOW()) AS locked_accounts
       FROM scoped
     )
     SELECT
       counts.failed_24h,
       counts.locked_accounts,
       COALESCE(
         json_agg(
           json_build_object(
             'email', email,
             'tenantId', tenant_id,
             'userId', user_id,
             'failureReason', failure_reason,
             'ipAddress', ip_address,
             'lockedUntil', locked_until::text,
             'occurredAt', occurred_at::text
           )
           ORDER BY occurred_at DESC
         ) FILTER (WHERE success = FALSE),
         '[]'::json
       ) AS recent_failures
     FROM (
       SELECT *
         FROM scoped
        WHERE success = FALSE
        ORDER BY occurred_at DESC
        LIMIT 10
     ) recent
     CROSS JOIN counts
     GROUP BY counts.failed_24h, counts.locked_accounts`,
    tenantId ?? '',
  );
  const row = rows[0];
  return {
    failedLogins24h: Number(row?.failed_24h ?? 0),
    lockedAccounts: Number(row?.locked_accounts ?? 0),
    recentFailures: Array.isArray(row?.recent_failures) ? row.recent_failures : [],
  };
}
