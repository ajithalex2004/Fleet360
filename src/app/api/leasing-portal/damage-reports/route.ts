/**
 * GET  /api/leasing-portal/damage-reports — list the lessee's own reports.
 * POST /api/leasing-portal/damage-reports — file a new one against one of
 *      the lessee's own contracts. Also raises a LeaseAlert (CUSTOM type)
 *      so staff see it on the existing Alerts page — no new staff-side
 *      inbox UI needed for this to be genuinely actionable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { createDamageReport, listDamageReportsForLessee } from '@/lib/leasing/damage-reports-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  const reports = await listDamageReportsForLessee(ctx.tenantId, ctx.lesseeId);
  return NextResponse.json(reports);
}

export async function POST(req: NextRequest) {
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const body = await req.json().catch(() => ({})) as {
      contractId?: string;
      vehicleRef?: string;
      severity?: 'MINOR' | 'MODERATE' | 'SEVERE';
      description?: string;
      photoUrls?: string[];
    };

    const contractId = String(body.contractId ?? '');
    const description = String(body.description ?? '').trim();
    if (!contractId || !description) {
      return NextResponse.json({ error: 'contractId and description are required' }, { status: 400 });
    }

    const contract = await prisma.leaseContract2.findFirst({
      where: { id: contractId, tenantId: ctx.tenantId, lesseeId: ctx.lesseeId },
      select: { id: true, contractNumber: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Not your contract' }, { status: 403 });
    }

    const report = await createDamageReport({
      tenantId: ctx.tenantId,
      lesseeId: ctx.lesseeId,
      contractId,
      vehicleRef: body.vehicleRef ?? null,
      severity: body.severity ?? 'MODERATE',
      description,
      photoUrls: Array.isArray(body.photoUrls) ? body.photoUrls.slice(0, 10) : [],
      reportedBy: `lessee-portal:${ctx.userId}`,
    });

    await withTenantRls(prisma, ctx.tenantId, async (tx) =>
      tx.leaseAlert.create({
        data: {
          contractId,
          alertType: 'CUSTOM',
          severity: report.severity === 'SEVERE' ? 'ERROR' : 'WARNING',
          title: `Damage reported on ${contract.contractNumber ?? contractId}`,
          message: `${report.severity} damage reported by the lessee via the self-service portal: ${description.slice(0, 300)}`,
          status: 'OPEN',
          tenantId: ctx.tenantId,
        },
      }),
    );

    return NextResponse.json({ report }, { status: 201 });
  } catch (e) {
    console.error('[leasing-portal/damage-reports]', e);
    return NextResponse.json({ error: 'Failed to submit damage report' }, { status: 500 });
  }
}
