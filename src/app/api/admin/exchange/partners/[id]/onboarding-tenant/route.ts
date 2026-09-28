export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { notProvisionedAware } from '@/lib/exchange/partner-auth';
import { findActiveTenant, setOnboardingTenant } from '@/lib/exchange/partner-onboarding';
import { withAuditedAction } from '@/lib/audited-action';

export const runtime = 'nodejs';

/**
 * PUT /api/admin/exchange/partners/:id/onboarding-tenant   { onboardedByTenantId }
 *
 * Sets the tenant that onboarded the partner. New partner users are invited
 * into this tenant (see src/lib/exchange/partner-onboarding.ts), and the
 * partner joins the tenant's network. Users already invited or linked keep
 * their tenant membership. Platform administrators only (ADMIN_ROUTE_POLICY).
 */
async function handlePUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: partnerId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!isSuperAdmin(req.headers)) return NextResponse.json({ error: 'Platform administrators only' }, { status: 403 });

  const body = stripTenantOwnershipFields(await req.json().catch(() => ({}))) as Record<string, unknown>;
  const tenantId = typeof body.onboardedByTenantId === 'string' ? body.onboardedByTenantId.trim() : '';
  if (!tenantId) return NextResponse.json({ error: 'onboardedByTenantId is required' }, { status: 400 });

  const run = await notProvisionedAware(() => withPlatformAdmin(prisma, async (tx) => {
    const partner = await tx.transportPartner.findFirst({
      where: { id: partnerId, deletedAt: null },
      select: { id: true, legalName: true },
    });
    if (!partner) return { status: 404 as const, error: 'Transport partner not found' };
    const tenant = await findActiveTenant(tx, tenantId);
    if (!tenant) return { status: 400 as const, error: 'Tenant not found or inactive' };
    await setOnboardingTenant(tx, partner.id, tenant.id);
    return { status: 200 as const, partner, tenant };
  }));
  if ('response' in run) return run.response;
  const result = run.value;
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await logAudit({
    entityType: 'TransportPartner',
    entityId: result.partner.id,
    action: 'UPDATE',
    details: `Onboarding tenant of ${result.partner.legalName} set to ${result.tenant.name}`,
    userId: req.headers.get('x-user-id') ?? undefined,
  });

  return NextResponse.json({ onboardedByTenantId: result.tenant.id, onboardedByTenantName: result.tenant.name });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
