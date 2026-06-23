import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import type { AdminContext } from '@/lib/admin-auth';

const SECRET_KEY_PATTERN = /(password|secret|token|apiKey|api_key|authToken|auth_token|clientSecret|client_secret)/i;
const MASKED_SECRET = '********';
let adminChangeHistoryEnsured = false;
let adminChangeHistoryEnsurePromise: Promise<void> | null = null;

export function maskAdminChangeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskAdminChangeValue);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = SECRET_KEY_PATTERN.test(key) && nested ? MASKED_SECRET : maskAdminChangeValue(nested);
  }
  return out;
}

export async function ensureAdminChangeHistoryTable() {
  if (adminChangeHistoryEnsured) return;
  if (adminChangeHistoryEnsurePromise) {
    await adminChangeHistoryEnsurePromise;
    return;
  }
  adminChangeHistoryEnsurePromise = (async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_change_history (
      id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         TEXT,
      entity_type       TEXT        NOT NULL,
      entity_id         TEXT,
      action            TEXT        NOT NULL,
      actor_user_id     TEXT,
      actor_role        TEXT,
      impersonated_by   TEXT,
      source_module     TEXT,
      source_entity_type TEXT,
      source_entity_id  TEXT,
      related_entity_type TEXT,
      related_entity_id TEXT,
      risk_severity     TEXT,
      before_json       JSONB,
      after_json        JSONB,
      summary           TEXT,
      ip_address        TEXT,
      user_agent        TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS actor_user_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS actor_role TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS impersonated_by TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS source_module TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS source_entity_type TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS source_entity_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS related_entity_type TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS related_entity_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS risk_severity TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS before_json JSONB`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS after_json JSONB`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS summary TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS ip_address TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history ADD COLUMN IF NOT EXISTS user_agent TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_admin_change_history_tenant
    ON admin_change_history(tenant_id, created_at DESC)
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_admin_change_history_entity
    ON admin_change_history(entity_type, entity_id, created_at DESC)
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_admin_change_history_source
    ON admin_change_history(source_module, source_entity_type, source_entity_id, created_at DESC)
  `).catch(() => {});
  })();
  try {
    await adminChangeHistoryEnsurePromise;
    adminChangeHistoryEnsured = true;
  } finally {
    adminChangeHistoryEnsurePromise = null;
  }
}

function safeJson(value: unknown) {
  if (value === undefined) return null;
  return JSON.stringify(maskAdminChangeValue(value), (_key, nestedValue) => {
    if (typeof nestedValue === 'bigint') return Number(nestedValue);
    return nestedValue;
  });
}

export async function recordAdminChange(args: {
  req: NextRequest;
  ctx: AdminContext;
  tenantId?: string | null;
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  summary?: string;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  riskSeverity?: 'low' | 'medium' | 'high' | 'critical' | null;
}) {
  const ipAddress =
    args.req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    args.req.headers.get('x-real-ip') ??
    undefined;
  const userAgent = args.req.headers.get('user-agent') ?? undefined;
  const impersonatedBy = args.req.headers.get('x-impersonated-by') ?? undefined;

  await ensureAdminChangeHistoryTable();
  const tenantTypeRows = await prisma.$queryRawUnsafe<Array<{ udt_name: string }>>(
    `SELECT udt_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'admin_change_history'
        AND column_name = 'tenant_id'
      LIMIT 1`,
  ).catch(() => []);
  const tenantValueExpression = tenantTypeRows[0]?.udt_name === 'uuid' ? '$1::uuid' : '$1';
  await prisma.$executeRawUnsafe(
    `INSERT INTO admin_change_history
       (tenant_id, entity_type, entity_id, action, actor_user_id, actor_role,
        impersonated_by, source_module, source_entity_type, source_entity_id,
        related_entity_type, related_entity_id, risk_severity,
        before_json, after_json, summary, ip_address, user_agent)
     VALUES (${tenantValueExpression},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18)`,
    args.tenantId ?? args.ctx.tenantId ?? null,
    args.entityType,
    args.entityId ?? null,
    args.action,
    args.ctx.userId,
    args.ctx.role,
    impersonatedBy ?? null,
    args.sourceModule ?? null,
    args.sourceEntityType ?? null,
    args.sourceEntityId ?? null,
    args.relatedEntityType ?? null,
    args.relatedEntityId ?? null,
    args.riskSeverity ?? null,
    safeJson(args.before),
    safeJson(args.after),
    args.summary ?? null,
    ipAddress ?? null,
    userAgent ?? null,
  );

  await logAudit({
    tenantId: args.tenantId ?? args.ctx.tenantId,
    entityType: args.entityType,
    entityId: args.entityId ?? undefined,
    entityName: args.entityName ?? undefined,
    userId: args.ctx.userId,
    userRole: args.ctx.role,
    action: args.action,
    details: args.summary,
    ipAddress,
    userAgent,
  });
}
