import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { FINANCE_ROLES, partnerAuthFailure, requirePartnerContext } from '@/lib/exchange/partner-auth';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { logAuditInTx } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  const auth = await requirePartnerContext(req, { roles: FINANCE_ROLES });
  if (!auth.ok) return partnerAuthFailure(auth);
  const { partnerId, userId } = auth.ctx;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody);
    const awardId = typeof body.awardId === 'string' ? body.awardId.trim() : '';
    const quotationId = typeof body.quotationId === 'string' ? body.quotationId.trim() : '';

    if (!awardId && !quotationId) {
      return NextResponse.json({ error: 'quotationId or awardId is required' }, { status: 400 });
    }

    const award = await withPlatformAdmin(prisma, (tx) =>
      tx.outsourceAward.findFirst({
        where: {
          partnerId,
          ...(awardId ? { id: awardId } : { quoteId: quotationId }),
        },
        select: {
          id: true,
          tenantId: true,
          quoteId: true,
          awardedPrice: true,
          vatAmount: true,
          totalAwarded: true,
          currency: true,
        },
      }),
    );

    if (!award) {
      return NextResponse.json({ error: 'Award not found for your company' }, { status: 404 });
    }

    const rawSubtotal = body.subtotalAmount ?? Number(award.awardedPrice);
    const subtotalNum = Number(rawSubtotal);
    if (!Number.isFinite(subtotalNum) || subtotalNum < 0) {
      return NextResponse.json({ error: 'subtotalAmount must be a non-negative number' }, { status: 400 });
    }

    const subtotalDec = new Prisma.Decimal(subtotalNum.toFixed(2));
    const vatDec = body.vatAmount !== undefined && body.vatAmount !== null
      ? new Prisma.Decimal(Number(body.vatAmount).toFixed(2))
      : subtotalDec.times('0.05').toDecimalPlaces(2);
    if (vatDec.isNaN() || vatDec.lt(0)) {
      return NextResponse.json({ error: 'vatAmount must be a non-negative number' }, { status: 400 });
    }

    const totalDec = subtotalDec.plus(vatDec).toDecimalPlaces(2);
    const invoiceNumber = typeof body.invoiceNumber === 'string' && body.invoiceNumber.trim()
      ? body.invoiceNumber.trim()
      : `EX-${award.id.slice(0, 8).toUpperCase()}`;
    const invoiceDate = body.invoiceDate ? new Date(String(body.invoiceDate)) : new Date();
    if (Number.isNaN(invoiceDate.getTime())) {
      return NextResponse.json({ error: 'Invalid invoiceDate' }, { status: 400 });
    }

    const itemsInput = Array.isArray(body.items) ? body.items : [];
    const normalizedItems: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
      vatAmount: number;
      totalAmount: number;
    }> = [];

    for (let idx = 0; idx < itemsInput.length; idx++) {
      const rawItem = itemsInput[idx];
      if (!rawItem || typeof rawItem !== 'object') {
        return NextResponse.json({ error: `Line item ${idx + 1} is invalid` }, { status: 400 });
      }
      const item = rawItem as Record<string, unknown>;
      const qty = item.quantity !== undefined && item.quantity !== null ? Number(item.quantity) : 1;
      const unitPrice = Number(item.unitPrice ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json({ error: `Line item ${idx + 1} quantity must be greater than 0` }, { status: 400 });
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return NextResponse.json({ error: `Line item ${idx + 1} unitPrice must be a non-negative number` }, { status: 400 });
      }
      const amount = item.amount !== undefined && item.amount !== null ? Number(item.amount) : Number((unitPrice * qty).toFixed(2));
      if (!Number.isFinite(amount) || amount < 0) {
        return NextResponse.json({ error: `Line item ${idx + 1} amount must be a non-negative number` }, { status: 400 });
      }
      const itemVat = item.vatAmount !== undefined && item.vatAmount !== null ? Number(item.vatAmount) : Number((amount * 0.05).toFixed(2));
      if (!Number.isFinite(itemVat) || itemVat < 0) {
        return NextResponse.json({ error: `Line item ${idx + 1} vatAmount must be a non-negative number` }, { status: 400 });
      }
      normalizedItems.push({
        description: String(item.description ?? 'Freight service'),
        quantity: qty,
        unitPrice,
        amount,
        vatAmount: itemVat,
        totalAmount: Number((amount + itemVat).toFixed(2)),
      });
    }

    return await withTenantRls(prisma, award.tenantId, async (tx) => {
      const existing = await tx.partnerInvoice.findFirst({
        where: { awardId: award.id },
        select: { id: true, invoiceNumber: true },
      });
      if (existing) {
        return NextResponse.json(
          { error: `An invoice (${existing.invoiceNumber}) has already been submitted for this award` },
          { status: 409 },
        );
      }

      const duplicateNum = await tx.partnerInvoice.findFirst({
        where: { partnerId, invoiceNumber },
        select: { id: true },
      });
      if (duplicateNum) {
        return NextResponse.json(
          { error: 'Invoice with this number already exists for this partner' },
          { status: 409 },
        );
      }

      const awardedTotal = new Prisma.Decimal(award.totalAwarded.toString());
      const variance = totalDec.minus(awardedTotal).abs();
      const verificationStatus = variance.gt('0.01') ? 'VARIANCE_REVIEW' : 'MATCHED';

      const invoice = await tx.partnerInvoice.create({
        data: {
          partnerId,
          tenantId: award.tenantId,
          awardId: award.id,
          invoiceNumber,
          invoiceDate,
          subtotalAmount: subtotalDec,
          vatAmount: vatDec,
          totalAmount: totalDec,
          currency: award.currency,
          status: 'SUBMITTED',
          verificationStatus,
          ...(normalizedItems.length > 0
            ? {
                items: {
                  create: normalizedItems,
                },
              }
            : {}),
        },
        include: { items: true },
      });

      await logAuditInTx({
        tenantId: award.tenantId,
        entityType: 'PartnerInvoice',
        entityId: invoice.id,
        action: 'CREATE',
        userId,
        details: `Submitted partner invoice ${invoice.invoiceNumber} for award ${award.id}`,
      }, tx);

      return NextResponse.json({
        ok: true,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        partnerId,
        tenantId: award.tenantId,
        awardId: award.id,
        quotationId: quotationId || award.quoteId,
        subtotalAmount: Number(invoice.subtotalAmount),
        vatAmount: Number(invoice.vatAmount),
        totalAmount: Number(invoice.totalAmount),
        status: invoice.status,
        verificationStatus: invoice.verificationStatus,
        submittedAt: invoice.createdAt.toISOString(),
      }, { status: 201 });
    });
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json(
        { error: 'Invoice with this number already exists for this partner' },
        { status: 409 },
      );
    }
    console.error('[exchange/invoices/submit]', e);
    return NextResponse.json({ error: 'Failed to submit invoice' }, { status: 500 });
  }
}
