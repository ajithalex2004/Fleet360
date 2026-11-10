export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { runAsTenant } from '@/lib/rls-scope';
import { PartnerInvoiceService } from '@/lib/exchange/partner-invoice-service';
import { DisputeService } from '@/lib/exchange/dispute-service';
import {
  awardTenantForPartner,
  FINANCE_ROLES,
  partnerAuthFailure,
  requirePartnerContext,
} from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET  /api/exchange/invoices — the signed-in partner's invoices (and settlement
 *      statements when ?includeStatements=1 is provided)
 * POST /api/exchange/invoices — submit an invoice for one of its awards or raise
 *      a commercial dispute (action: 'RAISE_DISPUTE')
 *
 * The partner comes from the caller's partner_users membership. (It used to
 * come from ?partnerId= / the body; without one GET listed every partner's
 * invoices across all buyers.)
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req);
  if (!auth.ok) return partnerAuthFailure(auth);

  const includeStatements = req.nextUrl.searchParams.get('includeStatements') === '1';

  // Invoices sit in the buyers' tenants: platform context, limited to the
  // verified partner's own.
  const invoices = await withPlatformAdmin(prisma, (tx) =>
    tx.partnerInvoice.findMany({
      where: { partnerId: auth.ctx.partnerId },
      include: {
        items: true,
        disputes: true,
        award: {
          include: { request: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );

  if (includeStatements) {
    const statements = await withPlatformAdmin(prisma, (tx) =>
      tx.partnerSettlementStatement.findMany({
        where: { partnerId: auth.ctx.partnerId },
        include: {
          invoices: true,
          deductions: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return NextResponse.json({ invoices, statements });
  }

  return NextResponse.json({ invoices });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { roles: FINANCE_ROLES });
  if (!auth.ok) return partnerAuthFailure(auth);
  const { partnerId } = auth.ctx;

  try {
    const body = await req.json().catch(() => ({}));

    if (body.action === 'RAISE_DISPUTE') {
      const invoiceId = typeof body.invoiceId === 'string' ? body.invoiceId.trim() : '';
      const disputedAmount = Number(body.disputedAmount);
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

      if (!invoiceId || !Number.isFinite(disputedAmount) || disputedAmount <= 0 || !reason) {
        return NextResponse.json(
          { error: 'invoiceId, a positive disputedAmount, and reason are required' },
          { status: 400 }
        );
      }

      const inv = await withPlatformAdmin(prisma, (tx) =>
        tx.partnerInvoice.findFirst({
          where: { id: invoiceId, partnerId },
          select: { id: true, tenantId: true },
        }),
      );
      if (!inv) {
        return NextResponse.json({ error: 'Invoice not found for your company' }, { status: 404 });
      }

      const dispute = await runAsTenant(inv.tenantId, () =>
        DisputeService.raiseDispute({
          tenantId: inv.tenantId,
          partnerId,
          invoiceId: inv.id,
          invoiceItemId: typeof body.invoiceItemId === 'string' ? body.invoiceItemId : undefined,
          disputedAmount,
          reason,
          raisedByUserId: req.headers.get('x-user-id') || partnerId,
        }),
      );

      return NextResponse.json({ ok: true, dispute });
    }

    const { awardId, invoiceNumber, invoiceDate, subtotalAmount, vatAmount, items } = body;

    if (!awardId || !invoiceNumber || subtotalAmount == null) {
      return NextResponse.json({ error: 'Missing required invoice fields' }, { status: 400 });
    }

    const tenantId = await awardTenantForPartner(partnerId, String(awardId));
    if (!tenantId) return NextResponse.json({ error: 'Award not found for your company' }, { status: 404 });

    // The award and the invoice belong to the buyer's tenant (runAsTenant:
    // the service uses the global client).
    const invoice = await runAsTenant(tenantId, () =>
      PartnerInvoiceService.submitInvoice({
        partnerId,
        awardId: String(awardId),
        invoiceNumber,
        invoiceDate: invoiceDate || new Date(),
        subtotalAmount: Number(subtotalAmount),
        vatAmount: vatAmount != null ? Number(vatAmount) : undefined,
        ...(Array.isArray(items) && items.length > 0 ? { items } : {}),
      }),
    );

    return NextResponse.json({ ok: true, invoice });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to submit invoice' }, { status: 500 });
  }
}
