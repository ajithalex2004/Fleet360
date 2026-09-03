/**
 * POST /api/leasing-portal/contracts/[id]/sign
 *
 * Lessee-facing e-signature acceptance of the primary lease contract itself
 * (as opposed to renewals/[id]/sign, which signs a renewal offer). Records a
 * sealed signature record (see esignature-store.ts) with entityType
 * 'CONTRACT', then — if the contract hasn't already been activated by staff
 * — moves it to ACTIVE. One signature per contract (enforced by the same
 * unique index the renewal flow relies on); re-signing an already-signed
 * contract is a 409, not a silent no-op.
 *
 * Staff can still activate a contract directly via PATCH
 * /api/leasing/contracts-v2/[id] (e.g. a wet-ink contract scanned in as a
 * document) — this route adds a lessee-initiated path, it does not replace
 * that one.
 *
 * Body: { signerName: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { createSignature } from '@/lib/leasing/esignature-store';

const TERMINAL_STATUSES = new Set(['TERMINATED', 'CLOSED']);
const ACTIVATABLE_STATUSES = new Set(['DRAFT', 'PENDING_APPROVAL', 'APPROVED']);

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    // A bare prisma call here never sets app.tenant_id, so RLS on
    // lease_contracts_v2 silently returns no row for a contract that
    // genuinely belongs to this lessee — same bug found across every other
    // leasing-portal route that used a bare `prisma.X` call instead of
    // withTenantRls.
    const contract = await withTenantRls(prisma, ctx.tenantId, (tx) =>
      tx.leaseContract2.findFirst({
        where: { id: params.id, tenantId: ctx.tenantId, lesseeId: ctx.lesseeId, deletedAt: null },
        include: { vehicles: true },
      }),
    );
    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }
    if (contract.status && TERMINAL_STATUSES.has(contract.status)) {
      return NextResponse.json({ error: `Contract is ${contract.status.toLowerCase()} and can no longer be signed` }, { status: 409 });
    }

    const body = await req.json().catch(() => ({})) as { signerName?: string };
    const signerName = String(body.signerName ?? '').trim();
    if (!signerName) {
      return NextResponse.json({ error: 'signerName is required' }, { status: 400 });
    }

    const vehicleSummary = contract.vehicles.length > 0
      ? contract.vehicles.map(v => `${v.vehicleType}${v.make ? ` ${v.make}` : ''}${v.model ? ` ${v.model}` : ''}`).join(', ')
      : 'no vehicles listed';
    const acceptedText =
      `I, ${signerName}, accept lease contract ${contract.contractNumber ?? contract.id}: ` +
      `${Number(contract.monthlyRate ?? 0)} ${contract.currency ?? 'AED'}/month from ` +
      `${contract.startDate.toISOString().slice(0, 10)} to ${contract.endDate.toISOString().slice(0, 10)} — ${vehicleSummary}.`;

    const signature = await createSignature({
      tenantId: ctx.tenantId,
      lesseeId: ctx.lesseeId,
      entityType: 'CONTRACT',
      entityId: contract.id,
      signerName,
      signerEmail: ctx.user.email,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
      acceptedText,
    });
    if (!signature) {
      return NextResponse.json({ error: 'This contract has already been signed' }, { status: 409 });
    }

    const shouldActivate = !!contract.status && ACTIVATABLE_STATUSES.has(contract.status);
    const updated = shouldActivate
      ? await withTenantRls(prisma, ctx.tenantId, (tx) =>
          tx.leaseContract2.update({ where: { id: contract.id }, data: { status: 'ACTIVE' } }),
        )
      : contract;

    return NextResponse.json({ ok: true, signature, contract: updated });
  } catch (e) {
    console.error('[leasing-portal/contracts/sign]', e);
    return NextResponse.json({ error: 'Failed to sign contract' }, { status: 500 });
  }
}
