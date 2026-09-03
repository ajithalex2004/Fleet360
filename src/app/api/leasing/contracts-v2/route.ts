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
import { sendEmail } from '@/services/email/emailService';
import { captureException } from '@/lib/sentry';

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
        include: { vehicles: true, lessee: true, openingBranch: true },
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
        // These three were previously omitted from this hand-mapped
        // response, even though the list UI reads them directly
        // (c.monthlyRate / c.branch) — every contract showed "0 AED" and
        // "-" for branch regardless of its real stored value.
        monthlyRate: c.monthlyRate != null ? Number(c.monthlyRate) : 0,
        currency: c.currency ?? 'AED',
        branch:
          (c as { openingBranch?: { name?: string | null } }).openingBranch
            ?.name ?? null,
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

    const { contract, lesseeContact } = await withTenantRls(prisma, tenantId, async (tx) => {
      // Ensure lessee belongs to the same tenant (relational attack defence)
      const lessee = await tx.lessee.findFirst({
        where: { id: lesseeId, tenantId, deletedAt: null },
      });
      if (!lessee) {
        throw Object.assign(new Error('Lessee not found in tenant'), { status: 404 });
      }

      const contract = await tx.leaseContract2.create({
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

      return { contract, lesseeContact: { email: lessee.email, name: lessee.name } };
    });

    // Best-effort — a lessee who doesn't hear about a new contract has no
    // way to know it's waiting for them in the portal, since nothing else
    // pushes to them. Must not fail contract creation if the send fails.
    if (lesseeContact?.email) {
      try {
        await sendEmail({
          to: [{ email: lesseeContact.email, name: lesseeContact.name }],
          subject: `New lease contract ready for your review — ${contract.contractNumber ?? contract.id.slice(0, 8)}`,
          htmlBody: `<p>Dear ${lesseeContact.name},</p>
            <p>A new lease contract has been prepared for you: <strong>${contract.contractNumber ?? contract.id.slice(0, 8)}</strong>,
            ${(body.monthlyRate != null ? Number(body.monthlyRate) : 0)} ${'AED'}/month.</p>
            <p>Please log in to the lessee portal to review the terms and sign.</p>
            <p>Best regards,<br/>Fleet360</p>`,
        });
      } catch (emailErr) {
        captureException(emailErr, { context: 'leasing.contracts-v2.create.email', tags: { contractId: contract.id } });
      }
    }

    return NextResponse.json(contract, { status: 201 });
    } catch (e) {
    const status = (e as { status?: number })?.status ?? 500;
    const message = e instanceof Error ? e.message : 'Failed to create contract';
    console.error('POST /api/leasing/contracts-v2 error:', message);
    return NextResponse.json({ error: message }, { status });
  }
}, {
  entityType: 'LeaseContract2',
  action: 'CREATE',
  extractEntity: (body: { id?: string; contractNumber?: string }) => ({ id: body?.id, name: body?.contractNumber }),
  describe: (_req, body: { contractNumber?: string; id?: string }) => `Created lease contract ${body?.contractNumber ?? body?.id ?? ''}`,
});
