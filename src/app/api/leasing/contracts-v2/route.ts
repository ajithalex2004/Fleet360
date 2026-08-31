export const dynamic = 'force-dynamic';

/**
 * Lease contracts v2 list/create — TENANT-001 hardened.
 *
 * - Tenant identity from middleware-injected session headers (not body)
 * - Application where: { tenantId } + withTenantRls (defence in depth)
 * - Ownership fields stripped from untrusted body
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAudit } from '@/lib/with-audit';
import { withTenantRls } from '@/lib/rls';
import {
  requireAuthorizedTenant,
  stripTenantOwnershipFields,
} from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const contracts = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseContract2.findMany({
        where: { tenantId, deletedAt: null },
        include: { vehicles: true, lessee: true },
        orderBy: { createdAt: 'desc' },
      }),
    );

    return NextResponse.json(
      contracts.map((c) => ({
        id: c.id,
        contractNumber: c.contractNumber,
        agreementType: c.agreementType ?? 'INDIVIDUAL',
        lessee:
          (c as { lessee?: { name?: string | null } }).lessee?.name ??
          c.lesseeId ??
          'Unknown',
        leaseType: c.leaseType ?? 'LONG_TERM',
        vehicleCount: Array.isArray(
          (c as { vehicles?: unknown[] }).vehicles,
        )
          ? (c as { vehicles: unknown[] }).vehicles.length
          : 0,
        startDate: c.startDate
          ? new Date(c.startDate).toISOString().split('T')[0]
          : '',
        endDate: c.endDate ? new Date(c.endDate).toISOString().split('T')[0] : '',
        status: c.status ?? 'Draft',
      })),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown';
    console.error('GET /api/leasing/contracts-v2 error:', message);
    return NextResponse.json({ error: 'Failed to load contracts' }, { status: 500 });
  }
}

export const POST = withAudit(async (request: NextRequest) => {
  const authz = requireAuthorizedTenant(request);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const raw = await request.json();
    const body = stripTenantOwnershipFields(
      (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>,
    );

    const lesseeId = body.lesseeId as string | undefined;
    if (!lesseeId) {
      return NextResponse.json({ error: 'lesseeId is required' }, { status: 400 });
    }

    const contractNumber =
      (body.contractNumber as string | undefined) ??
      `LC-${Date.now().toString().slice(-6)}`;

    const contract = await withTenantRls(prisma, tenantId, async (tx) => {
      // Ensure lessee belongs to the same tenant (relational attack defence)
      const lessee = await tx.lessee.findFirst({
        where: { id: lesseeId, tenantId, deletedAt: null },
      });
      if (!lessee) {
        throw Object.assign(new Error('Lessee not found in tenant'), { status: 404 });
      }

      return tx.leaseContract2.create({
        data: {
          tenantId,
          contractNumber,
          agreementType: (body.agreementType as string) ?? 'INDIVIDUAL',
          leaseType: (body.leaseType as string) ?? 'LONG_TERM',
          startDate: body.startDate ? new Date(String(body.startDate)) : new Date(),
          endDate: body.endDate
            ? new Date(String(body.endDate))
            : new Date(Date.now() + 365 * 24 * 3600 * 1000),
          monthlyRate: body.monthlyRate != null ? Number(body.monthlyRate) : 0,
          lesseeId,
          status: 'DRAFT',
          quotationId: (body.quotationId as string) ?? null,
        },
      });
    });

    return NextResponse.json(contract, { status: 201 });
    } catch (e) {
    const status = (e as { status?: number })?.status ?? 500;
    const message = e instanceof Error ? e.message : 'Failed to create contract';
    console.error('POST /api/leasing/contracts-v2 error:', message);
    return NextResponse.json({ error: message }, { status });
  }
});
