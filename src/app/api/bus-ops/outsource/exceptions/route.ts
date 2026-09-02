export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ExceptionService } from '@/lib/exchange/exception-service';

export const runtime = 'nodejs';

/**
 * GET /api/bus-ops/outsource/exceptions?awardId=...
 * POST /api/bus-ops/outsource/exceptions
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const { searchParams } = new URL(req.url);
  const awardId = searchParams.get('awardId');

  return withTenantRls(prisma, tenantId, async () => {
    const where = awardId ? { tenantId, awardId } : { tenantId };
    const exceptions = await prisma.outsourceException.findMany({
      where,
      include: {
        partner: true,
        award: { include: { request: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ exceptions });
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId } = authz;

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const rawBody = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(rawBody);
      const { action } = body;

      if (action === 'RAISE_AND_RESOLVE' || action === 'RAISE_EXCEPTION') {
        const { partnerId, awardId, assignmentId, type, severity, description, replacementResource } = body;

        const raised = await ExceptionService.raiseException({
          tenantId,
          partnerId,
          awardId,
          assignmentId,
          type,
          severity,
          description,
          raisedBy: userId || 'DISPATCH_OPERATOR',
        });

        let resolved = null;
        if (action === 'RAISE_AND_RESOLVE') {
          resolved = await ExceptionService.resolveException({
            exceptionId: raised.id,
            tenantId,
            resolutionNotes: `Auto-resolved with resource substitution: ${replacementResource ? replacementResource.vehiclePlate : 'Direct resolution'}`,
            resolvedBy: userId || 'DISPATCH_OPERATOR',
            replacementResource,
          });
        }

        return NextResponse.json({ ok: true, exception: resolved?.exception || raised, replacement: resolved?.replacement });
      }

      if (action === 'RESOLVE') {
        const { exceptionId, resolutionNotes, replacementResource } = body;
        const res = await ExceptionService.resolveException({
          exceptionId,
          tenantId,
          resolutionNotes,
          resolvedBy: userId || 'DISPATCH_OPERATOR',
          replacementResource,
        });

        return NextResponse.json({ ok: true, ...res });
      }

      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to process exception' }, { status: 500 });
    }
  });
}
