/**
 * POST /api/leasing-portal/renewals/[id]/sign
 *
 * Lessee-facing e-signature acceptance of a proposed renewal. Records a
 * sealed signature record (see esignature-store.ts), then accepts the
 * renewal via the same shared logic the staff PATCH route uses — which
 * creates the follow-on contract (G7). One signature per renewal
 * (enforced by a unique index); re-signing an already-signed renewal is
 * a 409, not a silent no-op, so the lessee gets clear feedback.
 *
 * Body: { signerName: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { createSignature } from '@/lib/leasing/esignature-store';
import { acceptRenewal } from '@/lib/leasing/renewal-acceptance';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    // A bare prisma call here never sets app.tenant_id, so RLS on
    // lease_renewals silently returned no row for a renewal that
    // genuinely belongs to this lessee -- e-signing 404'd on every real
    // renewal. Same bug found across every other leasing-portal route
    // that used a bare `prisma.X` call instead of withTenantRls.
    const renewal = await withTenantRls(prisma, ctx.tenantId, (tx) =>
      tx.leaseRenewal.findFirst({
        where: { id: params.id, tenantId: ctx.tenantId, originalContract: { lesseeId: ctx.lesseeId } },
      }),
    );
    if (!renewal) {
      return NextResponse.json({ error: 'Renewal not found' }, { status: 404 });
    }
    if (renewal.status === 'ACCEPTED' || renewal.status === 'REJECTED') {
      return NextResponse.json({ error: `Renewal is already ${renewal.status.toLowerCase()}` }, { status: 409 });
    }

    const body = await req.json().catch(() => ({})) as { signerName?: string };
    const signerName = String(body.signerName ?? '').trim();
    if (!signerName) {
      return NextResponse.json({ error: 'signerName is required' }, { status: 400 });
    }

    const acceptedText =
      `I, ${signerName}, accept the renewal terms: monthly rate ` +
      `${Number(renewal.proposedMonthlyRate ?? 0)} ${'AED'} from ${renewal.proposedStartDate.toISOString().slice(0, 10)} ` +
      `to ${renewal.proposedEndDate.toISOString().slice(0, 10)}.`;

    const signature = await createSignature({
      tenantId: ctx.tenantId,
      lesseeId: ctx.lesseeId,
      entityType: 'RENEWAL',
      entityId: renewal.id,
      signerName,
      signerEmail: ctx.user.email,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
      acceptedText,
    });
    if (!signature) {
      return NextResponse.json({ error: 'This renewal has already been signed' }, { status: 409 });
    }

    const result = await acceptRenewal({ tenantId: ctx.tenantId, renewalId: renewal.id });
    if (!result) {
      return NextResponse.json({ error: 'Original contract not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, signature, ...result });
  } catch (e) {
    console.error('[leasing-portal/renewals/sign]', e);
    return NextResponse.json({ error: 'Failed to sign renewal' }, { status: 500 });
  }
}
