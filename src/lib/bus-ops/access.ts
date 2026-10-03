/** Authoritative Bus Ops policy. Report/off modes never bypass this service boundary. */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { getVerifiedRequestSession } from '@/lib/tenant-session';
import { resolveSessionPermissions } from '@/lib/authz/session-permissions';
import { busOpsCapability } from '@/lib/authz/bus-ops-routes';
import { hasPermission } from '@/lib/permissions';
import { resolveModuleKey } from '@/lib/modules';
import { verifyStepUp } from '@/lib/auth/step-up-token';
import { STEP_UP_COOKIE, STEP_UP_REQUIRED_BODY } from '@/lib/auth/step-up-policy';

export interface BusOpsAccess {
  tenantId: string; userId: string; permissions: string[]; employeeId: string | null;
}
type Result = { access: BusOpsAccess; refusal: null } | { access: null; refusal: NextResponse };
const contexts = new WeakMap<NextRequest, Promise<Result>>();
const deny = (status: number, error: string): Result => ({ access: null, refusal: NextResponse.json({ error }, { status }) });
export function busOpsAccessFor(req: NextRequest): Promise<Result> {
  const existing = contexts.get(req);
  if (existing) return existing;
  const pending = load(req);
  contexts.set(req, pending);
  return pending;
}
async function load(req: NextRequest): Promise<Result> {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) return deny(auth.status, auth.error);
  const session = await getVerifiedRequestSession(req);
  if (!session || session.userId !== auth.userId || (session.tenantId !== auth.tenantId && session.role !== 'SUPER_ADMIN')) return deny(401, 'Valid session required');
  try {
    const loaded = await withPlatformAdmin(prisma, async tx => {
      const tenant = await tx.tenant.findUnique({ where: { id: auth.tenantId }, include: { modules: true } });
      const user = await tx.user.findUnique({ where: { id: session.userId }, select: { isActive: true, employeeId: true } });
      const revoked = await tx.$queryRawUnsafe<Array<{ revoked: boolean }>>(
        `SELECT EXISTS (SELECT 1 FROM session_revocations WHERE not_before > $3::timestamptz
         AND ((user_id = $1 AND tenant_id IS NULL) OR (tenant_id = $2 AND user_id IS NULL)
           OR (user_id = $1 AND tenant_id = $2))) AS revoked`,
        session.userId, auth.tenantId, new Date(session.issuedAt));
      const permissions = await resolveSessionPermissions(tx as never, session.userId, auth.tenantId);
      return { tenant, user, revoked: revoked[0]?.revoked !== false, permissions };
    });
    if (!loaded.tenant || loaded.tenant.isActive !== true || !loaded.user?.isActive || loaded.revoked) return deny(403, 'Tenant or membership is unavailable');
    if (!loaded.tenant.modules.some(m => m.isEnabled === true && resolveModuleKey(m.module) === 'bus-ops')) return deny(403, 'Bus Ops is disabled for this tenant');
    const capability = busOpsCapability(req.nextUrl.pathname, req.method);
    if (!capability || capability.action === 'external') return deny(403, 'Unmapped Bus Ops action');
    if (loaded.tenant.plan === 'TRIAL' && capability.action !== 'view') return deny(403, 'Trial tenant is read-only');
    if (!hasPermission(loaded.permissions, 'bus-ops', capability.action, capability.resource)) return deny(403, 'Missing Bus Ops permission');
    if (capability.resource === 'device-credentials' && !await verifyStepUp(req.cookies.get(STEP_UP_COOKIE)?.value, session)) {
      return { access: null, refusal: NextResponse.json(STEP_UP_REQUIRED_BODY, { status: 403 }) };
    }
    return { access: { tenantId: auth.tenantId, userId: session.userId, permissions: loaded.permissions, employeeId: loaded.user.employeeId }, refusal: null };
  } catch (error) {
    console.error('[bus-ops policy] authoritative check failed', error instanceof Error ? error.name : 'unknown');
    return deny(503, 'Bus Ops authorization is temporarily unavailable');
  }
}
export async function requireBusOpsRequest(req: NextRequest): Promise<NextResponse | null> {
  return (await busOpsAccessFor(req)).refusal;
}
/** Caller may target someone else only through an explicit delegated capability. */
export async function ownsBusOpsEmployee(req: NextRequest, employeeId: string | null): Promise<boolean> {
  const { access } = await busOpsAccessFor(req);
  return Boolean(access && ((access.employeeId && access.employeeId === employeeId)
    || hasPermission(access.permissions, 'bus-ops', 'edit', 'passengers')));
}
