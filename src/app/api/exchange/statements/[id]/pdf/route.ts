export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { PdfDocumentService } from '@/lib/exchange/pdf-service';
import {
  canSeePartnerRecord,
  exchangeNotProvisionedResponse,
  isExchangeNotProvisioned,
} from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

const isoDate = (d: Date | null | undefined) => (d ? new Date(d).toISOString().split('T')[0] : '');

/**
 * GET /api/exchange/statements/[id]/pdf
 * Stream official UAE FTA Tax Invoice PDF for a settlement statement
 *
 * For the statement's partner (its members) and its buying tenant (that
 * tenant's staff) only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!authz.userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  try {
    const { id: statementId } = await params;

    const loaded = await withPlatformAdmin(prisma, async (tx) => {
      const statement = await tx.partnerSettlementStatement.findUnique({
        where: { id: statementId },
        include: {
          partner: true,
          invoices: {
            include: {
              award: { include: { request: true } },
            },
          },
          deductions: true,
        },
      });
      const tenant = statement
        ? await tx.tenant.findUnique({ where: { id: statement.tenantId }, select: { name: true } })
        : null;
      return { statement, tenant };
    });
    const { statement, tenant } = loaded;

    if (!statement || !(await canSeePartnerRecord({ userId: authz.userId, tenantId: authz.tenantId }, statement))) {
      return NextResponse.json({ error: 'Statement not found' }, { status: 404 });
    }

    let agencyCount = 0;
    let principalCount = 0;
    let totalPlatformFeeAed = 0;

    const items = statement.invoices.map((inv) => {
      const snap = (inv.award?.commercialSnapshot || {}) as Record<string, unknown>;
      const model = typeof snap.commercialModel === 'string' ? snap.commercialModel : 'AGENCY';
      if (model === 'PRINCIPAL') principalCount += 1;
      else agencyCount += 1;
      if (typeof snap.platformFeeAmount === 'number') {
        totalPlatformFeeAed += snap.platformFeeAmount;
      }
      const rateSnap = (snap.rateCardSnapshot || {}) as Record<string, unknown>;
      const rateCardHash = typeof rateSnap.snapshotHash === 'string' ? rateSnap.snapshotHash : undefined;
      const domain = inv.award?.request?.domain || 'PASSENGER_TRANSPORT';

      return {
        tripNumber: inv.invoiceNumber,
        date: isoDate(inv.invoiceDate),
        description: `${domain} Outsource Service (${inv.award?.request?.requestNumber || 'RFQ'})`,
        amountAed: Number(inv.subtotalAmount),
        vatAed: Number(inv.vatAmount),
        totalAed: Number(inv.totalAmount),
        verificationStatus: inv.verificationStatus || 'MATCHED',
        commercialModel: model,
        rateCardHash,
      };
    });

    const pdfBytes = PdfDocumentService.generateTaxInvoicePdf({
      statementNumber: statement.statementNumber,
      periodStart: isoDate(statement.periodStart),
      periodEnd: isoDate(statement.periodEnd),
      issueDate: isoDate(new Date()),
      tenantName: tenant?.name ?? '',
      tenantTrn: statement.tenantTrn ?? '',
      partnerName: statement.partner.legalName,
      partnerTrn: statement.partnerTrn ?? statement.partner.taxRegistrationNumber ?? '',
      items,
      deductions: statement.deductions.map((d) => ({
        type: d.type,
        reason: d.description,
        amountAed: Number(d.amount),
      })),
      grossAmountAed: Number(statement.grossAmount),
      vatAmountAed: Number(statement.vatAmount),
      totalDeductionsAed: Number(statement.totalDeductions),
      netPayableAed: Number(statement.netPayable),
      commercialModelSummary: {
        agencyCount,
        principalCount,
        totalPlatformFeeAed: Math.round(totalPlatformFeeAed * 100) / 100,
      },
    });

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="tax-invoice-${statement.statementNumber}.pdf"`,
      },
    });
  } catch (err) {
    if (isExchangeNotProvisioned(err)) return exchangeNotProvisionedResponse();
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}
