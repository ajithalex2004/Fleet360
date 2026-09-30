import { NextRequest, NextResponse } from 'next/server';
import { triggerWorkflow } from '@/lib/workflow-db';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { loadModuleAccess } from '@/lib/authz/module-access';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const access = await loadModuleAccess(req.headers, tenantId);

  try {
    // tenantId comes from the session only: it used to be read from the body
    // here, shadowing the session's, so a caller could name another tenant.
    const body = stripTenantOwnershipFields(await req.json());
    const {
      // Phase 2 canonical keying — preferred for new callers. The engine
      // resolves these via the service-type / scope chain.
      serviceTypeId, scopeId,
      // Legacy keying — still accepted. Engine falls back to (module,
      // procedure) lookup when serviceTypeId isn't supplied or doesn't
      // resolve to an active workflow.
      module, procedure,
      referenceType, referenceId, referenceNumber,
      contextData,
    } = body;

    // Starting a module's workflow (e.g. a leasing quotation's approval) needs
    // create permission in that module; the matrix lets this route through
    // for any member ('workflow/trigger' in policy-matrix.ts). Without a
    // module only tenant administrators may start one, as before.
    const role = req.headers.get('x-user-role') ?? '';
    const isTenantAdmin = role === 'TENANT_ADMIN' || role === 'SUPER_ADMIN';
    const workflowModule = typeof module === 'string' && module ? module.toLowerCase().replace(/_/g, '-') : null;
    if (workflowModule || !isTenantAdmin) {
      const denied = access([workflowModule ?? 'workflow'], 'create', '/api/workflow/trigger');
      if (denied) return denied;
    }

    // The initiator is the signed-in user, not whatever the page sends.
    const userId = req.headers.get('x-user-id');
    const initiator = userId
      ? await withPlatformAdmin(prisma, (tx) => tx.user.findUnique({
          where: { id: userId }, select: { email: true, firstName: true, lastName: true },
        }))
      : null;
    const initiatedByEmail = initiator?.email ?? 'system';
    const initiatedByName = [initiator?.firstName, initiator?.lastName].filter(Boolean).join(' ') || undefined;

    if (!referenceId) {
      return NextResponse.json({ error: 'referenceId is required' }, { status: 400 });
    }
    // At least one of the two keying paths must be supplied.
    if (!(serviceTypeId && tenantId) && !(module && procedure)) {
      return NextResponse.json(
        { error: 'Either (serviceTypeId + tenantId) or (module + procedure) is required to resolve a workflow.' },
        { status: 400 },
      );
    }

    const result = await triggerWorkflow({
      serviceTypeId, tenantId, scopeId,
      module, procedure,
      referenceType: referenceType ?? module ?? 'UNKNOWN',
      referenceId, referenceNumber: referenceNumber ?? referenceId,
      initiatedByEmail,
      initiatedByName,
      contextData,
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    console.error('POST /api/workflow/trigger error:', errorMessage(e, 'Failed to trigger workflow'));
    return NextResponse.json({ error: errorMessage(e, 'Failed to trigger workflow') }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
