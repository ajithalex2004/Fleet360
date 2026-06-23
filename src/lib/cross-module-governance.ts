import { NextRequest, NextResponse } from 'next/server';
import { assertCanWrite, type AppModule } from '@/lib/access-control';
import { recordAdminChange } from '@/lib/admin-change-history';
import { moduleAccessPermissionKeys } from '@/lib/module-access-presets';
import { hasPermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { AdminContext } from '@/lib/admin-auth';

export type OperationalModule =
  | 'fleet'
  | 'rac'
  | 'leasing'
  | 'bus_ops'
  | 'drivers'
  | 'maintenance'
  | 'finance'
  | 'service_tickets'
  | 'reports';

export type MutationAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE' | 'IMPORT' | 'EXPORT';

export interface OperationalContext {
  tenantId: string;
  userId: string;
  role: string;
  plan: string;
  module: OperationalModule;
  isSuperAdmin: boolean;
}

interface PermissionCheck {
  module: string;
  action: string;
  resource?: string;
}

const MODULE_ALIASES: Record<string, OperationalModule> = {
  fleet: 'fleet',
  vehicles: 'fleet',
  driver: 'drivers',
  drivers: 'drivers',
  'driver-mgmt': 'drivers',
  maintenance: 'maintenance',
  rac: 'rac',
  rental: 'rac',
  'rent-a-car': 'rac',
  leasing: 'leasing',
  bus_ops: 'bus_ops',
  'bus-ops': 'bus_ops',
  'school-bus': 'bus_ops',
  staff: 'bus_ops',
  'staff-transport': 'bus_ops',
  finance: 'finance',
  billing: 'finance',
  'service-ticket': 'service_tickets',
  'service-tickets': 'service_tickets',
  service_tickets: 'service_tickets',
  reports: 'reports',
};

const ACCESS_MODULE: Record<OperationalModule, AppModule> = {
  fleet: 'fleet',
  drivers: 'fleet',
  maintenance: 'fleet',
  rac: 'rac',
  leasing: 'leasing',
  bus_ops: 'school-bus',
  finance: 'finance',
  service_tickets: 'admin',
  reports: 'admin',
};

export const STATUS_TRANSITIONS: Record<string, Record<string, string[]>> = {
  rentalBooking: {
    PENDING: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
  },
  serviceTicket: {
    Open: ['In Progress', 'Awaiting Approval', 'Resolved', 'Closed', 'Cancelled'],
    'Awaiting Approval': ['Open', 'In Progress', 'Cancelled'],
    'In Progress': ['Resolved', 'Closed', 'Cancelled'],
    Resolved: ['Closed', 'In Progress'],
    Closed: [],
    Cancelled: [],
  },
  financeInvoice: {
    DRAFT: ['SENT', 'VOID'],
    SENT: ['PAID', 'PARTIAL', 'OVERDUE', 'VOID'],
    PARTIAL: ['PAID', 'OVERDUE', 'VOID'],
    OVERDUE: ['PAID', 'PARTIAL', 'VOID'],
    PAID: ['VOID'],
    VOID: [],
  },
  vehicle: {
    AVAILABLE: ['RESERVED', 'RENTED', 'LEASED', 'IN_MAINTENANCE', 'INACTIVE'],
    RESERVED: ['AVAILABLE', 'RENTED', 'LEASED', 'IN_MAINTENANCE'],
    RENTED: ['AVAILABLE', 'IN_MAINTENANCE'],
    LEASED: ['AVAILABLE', 'IN_MAINTENANCE'],
    IN_MAINTENANCE: ['AVAILABLE', 'INACTIVE'],
    INACTIVE: ['AVAILABLE'],
  },
  driver: {
    ACTIVE: ['INACTIVE', 'SUSPENDED'],
    INACTIVE: ['ACTIVE', 'SUSPENDED'],
    SUSPENDED: ['ACTIVE', 'INACTIVE'],
  },
  maintenanceRequest: {
    Open: ['In Progress', 'Awaiting Approval', 'Completed', 'Cancelled'],
    'Awaiting Approval': ['Open', 'In Progress', 'Cancelled'],
    'In Progress': ['Completed', 'Cancelled'],
    Completed: [],
    Cancelled: [],
  },
  leaseContract: {
    DRAFT: ['PENDING_APPROVAL', 'APPROVED', 'CANCELLED'],
    Draft: ['PENDING_APPROVAL', 'APPROVED', 'CANCELLED'],
    PENDING_APPROVAL: ['APPROVED', 'CANCELLED'],
    APPROVED: ['ACTIVE', 'TERMINATED'],
    ACTIVE: ['EXTENDED', 'SUSPENDED', 'TERMINATED', 'CLOSED'],
    EXTENDED: ['SUSPENDED', 'TERMINATED', 'CLOSED'],
    SUSPENDED: ['ACTIVE', 'TERMINATED'],
    TERMINATED: [],
    CLOSED: [],
    CANCELLED: [],
  },
  busTrip: {
    SCHEDULED: ['DEPARTED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'],
    DEPARTED: ['IN_TRANSIT', 'COMPLETED', 'CANCELLED'],
    IN_TRANSIT: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
  },
  tripPassenger: {
    CONFIRMED: ['BOARDED', 'ABSENT', 'NO_SHOW', 'WAITLISTED'],
    WAITLISTED: ['CONFIRMED', 'ABSENT', 'NO_SHOW'],
    BOARDED: ['ABSENT', 'NO_SHOW'],
    ABSENT: [],
    NO_SHOW: [],
  },
  transportRequest: {
    PENDING: ['APPROVED', 'REJECTED'],
    APPROVED: ['FULFILLED', 'REJECTED'],
    REJECTED: [],
    FULFILLED: [],
  },
  tripIncident: {
    OPEN: ['INVESTIGATING', 'RESOLVED', 'CLOSED'],
    INVESTIGATING: ['RESOLVED', 'CLOSED'],
    RESOLVED: ['CLOSED', 'INVESTIGATING'],
    CLOSED: [],
  },
};

export function canonicalModuleKey(value: string): OperationalModule | null {
  return MODULE_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function requireOperationalContext(
  req: NextRequest,
  module: OperationalModule,
  options: { write?: boolean; requestedTenantId?: string | null } = {},
): OperationalContext | NextResponse {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? 'TENANT_ADMIN';
  const plan = req.headers.get('x-tenant-plan') ?? 'TRIAL';
  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Unauthorized', message: 'Valid session required' }, { status: 401 });
  }

  if (options.requestedTenantId && options.requestedTenantId !== tenantId && role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
  }

  if (options.write) {
    const guard = assertCanWrite(req, ACCESS_MODULE[module]);
    if (guard) return guard;
  }

  return {
    tenantId: options.requestedTenantId && role === 'SUPER_ADMIN' ? options.requestedTenantId : tenantId,
    userId,
    role,
    plan,
    module,
    isSuperAdmin: role === 'SUPER_ADMIN',
  };
}

export async function listOperationalPermissionKeys(ctx: OperationalContext): Promise<string[]> {
  if (ctx.isSuperAdmin) return ['*:*:*'];

  const userTenant = await prisma.userTenant.findUnique({
    where: { userId_tenantId: { userId: ctx.userId, tenantId: ctx.tenantId } },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      user: { select: { moduleAccess: true } },
    },
  });

  if (!userTenant?.isActive) return [];

  const rolePermissions = userTenant.role.permissions.map(rp =>
    `${rp.permission.module}:${rp.permission.action}:${rp.permission.resource ?? '*'}`
  );

  return [
    ...new Set([
      ...rolePermissions,
      ...moduleAccessPermissionKeys(userTenant.user.moduleAccess),
      ...(userTenant.role.code === 'SUPER_ADMIN' ? ['*:*:*'] : []),
    ]),
  ];
}

export async function requireOperationalPermission(
  ctx: OperationalContext,
  checks: PermissionCheck[],
  options: { message?: string } = {},
): Promise<NextResponse | null> {
  if (ctx.isSuperAdmin) return null;
  if (ctx.role === 'TENANT_ADMIN') return null;
  const permissionKeys = await listOperationalPermissionKeys(ctx);
  const allowed = checks.some(check =>
    hasPermission(permissionKeys, check.module, check.action, check.resource ?? '*')
  );

  if (allowed) return null;

  return NextResponse.json({
    error: 'Forbidden',
    message: options.message ?? 'Missing permission for this billing action',
    requiredPermissions: checks.map(check => `${check.module}:${check.action}:${check.resource ?? '*'}`),
  }, { status: 403 });
}

export function assertStatusTransition(entity: keyof typeof STATUS_TRANSITIONS, fromStatus: string | null | undefined, toStatus: string | null | undefined) {
  if (!toStatus || !fromStatus || fromStatus === toStatus) return null;
  const allowed = STATUS_TRANSITIONS[entity]?.[fromStatus];
  if (!allowed) return null;
  if (allowed.includes(toStatus)) return null;
  return NextResponse.json({
    error: 'Invalid status transition',
    from: fromStatus,
    to: toStatus,
    allowed,
  }, { status: 409 });
}

function assertSafeIdentifier(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
}

export async function ensureOperationalTenantColumn(table: string, tenantColumnType = 'TEXT') {
  assertSafeIdentifier(table);
  if (!['TEXT', 'UUID'].includes(tenantColumnType)) {
    throw new Error(`Unsupported tenant column type: ${tenantColumnType}`);
  }
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS tenant_id ${tenantColumnType}`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant_id ON "${table}"(tenant_id)`);
}

export async function tenantScopedIds(table: string, tenantId: string, options: { activeOnly?: boolean } = {}) {
  assertSafeIdentifier(table);
  const deletedClause = options.activeOnly ? 'AND (deleted_at IS NULL)' : '';
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id FROM "${table}" WHERE tenant_id::text = $1 ${deletedClause}`,
    tenantId,
  );
  return rows.map(row => row.id);
}

export async function attachTenantToEntity(table: string, entityId: string, tenantId: string) {
  assertSafeIdentifier(table);
  await ensureOperationalTenantColumn(table);
  const typeRows = await prisma.$queryRawUnsafe<Array<{ data_type: string; udt_name: string }>>(
    `SELECT data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = 'tenant_id'
      LIMIT 1`,
    table,
  );
  const tenantValueExpression = typeRows[0]?.udt_name === 'uuid' ? '$1::uuid' : '$1';
  await prisma.$executeRawUnsafe(
    `UPDATE "${table}" SET tenant_id = ${tenantValueExpression} WHERE id::text = $2`,
    tenantId,
    entityId,
  );
}

export async function entityBelongsToTenant(table: string, entityId: string, tenantId: string, options: { activeOnly?: boolean } = {}) {
  assertSafeIdentifier(table);
  await ensureOperationalTenantColumn(table);
  const deletedClause = options.activeOnly ? 'AND (deleted_at IS NULL)' : '';
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id FROM "${table}" WHERE id::text = $1 AND tenant_id::text = $2 ${deletedClause} LIMIT 1`,
    entityId,
    tenantId,
  );
  return rows.length > 0;
}

export async function recordOperationalChange(args: {
  req: NextRequest;
  ctx: OperationalContext;
  entityType: string;
  entityId?: string | null;
  action: MutationAction;
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
  const adminCtx: AdminContext = {
    userId: args.ctx.userId,
    tenantId: args.ctx.tenantId,
    role: args.ctx.role,
    isSuperAdmin: args.ctx.isSuperAdmin,
    isTenantAdmin: args.ctx.role === 'TENANT_ADMIN',
  };
  await recordAdminChange({
    req: args.req,
    ctx: adminCtx,
    tenantId: args.ctx.tenantId,
    entityType: args.entityType,
    entityId: args.entityId ?? null,
    action: args.action,
    before: args.before,
    after: args.after,
    summary: args.summary ?? `${args.action} ${args.entityType} via ${args.ctx.module}`,
    sourceModule: args.sourceModule ?? args.ctx.module.toUpperCase(),
    sourceEntityType: args.sourceEntityType ?? null,
    sourceEntityId: args.sourceEntityId ?? null,
    relatedEntityType: args.relatedEntityType ?? null,
    relatedEntityId: args.relatedEntityId ?? null,
    riskSeverity: args.riskSeverity ?? null,
  }).catch(err => {
    console.warn('[cross-module-governance] audit write failed:', err);
  });
}
