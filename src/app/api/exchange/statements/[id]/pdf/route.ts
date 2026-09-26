export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { PdfDocumentService } from '@/lib/exchange/pdf-service';
import { canSeePartnerRecord } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

const isoDate = (d: Date | null | undefined) => (d ? new Date(d).toISOString().split('T')[0] : '');

/**
 * GET /api/exchange/statements/[id]/pdf
 * Stream official UAE FTA Tax Invoice PDF for a settlement statement
 *
 * For the statement's partner (its members) and its buying tenant (that
 * tenant's staff) only. An unknown statement is a 404: this used to render a
 * complete tax invoice from made-up placeholder values for any id, for anyone
 * signed in.
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

    // The statement may belong to another tenant than the caller's (a partner
    // user's): load it in platform context, then decide access below.
    // PartnerSettlementStatement has no `tenant` relation (only a raw
    // tenantId column), so the tenant name needs its own lookup.
    const loaded = await withPlatformAdmin(prisma, async (tx) => {
      const statement = await tx.partnerSettlementStatement.findUnique({
        where: { id: statementId },
        include: { partner: true, invoices: true, deductions: true },
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

    const pdfBytes = PdfDocumentService.generateTaxInvoicePdf({
      statementNumber: statement.statementNumber,
      periodStart: isoDate(statement.periodStart),
      periodEnd: isoDate(statement.periodEnd),
      issueDate: isoDate(new Date()),
      tenantName: tenant?.name ?? '',
      tenantTrn: statement.tenantTrn ?? '',
      partnerName: statement.partner.legalName,
      partnerTrn: statement.partnerTrn ?? statement.partner.taxRegistrationNumber ?? '',
      items: statement.invoices.map((inv) => ({
        tripNumber: inv.invoiceNumber,
        date: isoDate(inv.invoiceDate),
        description: 'Passenger / Freight Outsource Transport Service',
        amountAed: Number(inv.subtotalAmount),
        vatAed: Number(inv.vatAmount),
        totalAed: Number(inv.totalAmount),
      })),
      deductions: statement.deductions.map((d) => ({
        type: d.type,
        reason: d.description,
        amountAed: Number(d.amount),
      })),
      grossAmountAed: Number(statement.grossAmount),
      vatAmountAed: Number(statement.vatAmount),
      totalDeductionsAed: Number(statement.totalDeductions),
      netPayableAed: Number(statement.netPayable),
    });

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="tax-invoice-${statement.statementNumber}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}
