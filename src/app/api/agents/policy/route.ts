export const dynamic = 'force-dynamic';

/**
 * /api/agents/policy
 * ------------------
 * GET: Returns AI governance policy, autonomy limits, and budget thresholds for the tenant.
 * PUT: Updates tenant AI governance policy or resets the circuit breaker.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { policyService, type TenantPolicy } from '@/lib/agents/governance';

// Raising budgets, autonomy or resetting the circuit breaker is an admin
// decision, not something any tenant user may do.
const POLICY_ADMIN_ROLES = new Set(['TENANT_ADMIN', 'SUPER_ADMIN']);
const AUTONOMY_LEVELS = new Set(['L0', 'L1', 'L2', 'L3', 'L4']);

type PolicyUpdates = Partial<Omit<TenantPolicy, 'tenantId'>>;

/** Validate a PUT body into known policy fields; unknown keys (incl. tenantId) are dropped. */
function parsePolicyUpdates(body: unknown): { ok: true; updates: PolicyUpdates } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body must be an object' };
  }
  const b = body as Record<string, unknown>;
  const updates: PolicyUpdates = {};
  for (const key of ['dailyBudgetAed', 'monthlyBudgetAed', 'requireHumanApprovalThresholdAed'] as const) {
    const v = b[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return { ok: false, error: `${key} must be a non-negative number` };
    }
    updates[key] = v;
  }
  if (b.maxAutonomyLevel !== undefined) {
    if (typeof b.maxAutonomyLevel !== 'string' || !AUTONOMY_LEVELS.has(b.maxAutonomyLevel)) {
      return { ok: false, error: 'maxAutonomyLevel must be one of L0-L4' };
    }
    updates.maxAutonomyLevel = b.maxAutonomyLevel as TenantPolicy['maxAutonomyLevel'];
  }
  if (b.disabledAgents !== undefined) {
    if (!Array.isArray(b.disabledAgents) || !b.disabledAgents.every((a) => typeof a === 'string')) {
      return { ok: false, error: 'disabledAgents must be an array of agent ids' };
    }
    updates.disabledAgents = b.disabledAgents as string[];
  }
  if (b.circuitBreakerTriggered !== undefined) {
    if (typeof b.circuitBreakerTriggered !== 'boolean') {
      return { ok: false, error: 'circuitBreakerTriggered must be a boolean' };
    }
    updates.circuitBreakerTriggered = b.circuitBreakerTriggered;
  }
  return { ok: true, updates };
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async () => {
      const policy = await policyService.getTenantPolicy(tenantId);
      return NextResponse.json({ ok: true, data: policy });
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to retrieve tenant policy' },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  if (!authz.role || !POLICY_ADMIN_ROLES.has(authz.role)) {
    return NextResponse.json({ ok: false, error: 'Only a tenant admin can change the AI policy' }, { status: 403 });
  }

  try {
    const parsed = parsePolicyUpdates(await req.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }

    return await withTenantRls(prisma, tenantId, async () => {
      const updatedPolicy = await policyService.updateTenantPolicy(tenantId, parsed.updates);
      return NextResponse.json({
        ok: true,
        message: 'Tenant AI policy updated successfully',
        data: updatedPolicy,
      });
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to update tenant policy' },
      { status: 500 },
    );
  }
}
