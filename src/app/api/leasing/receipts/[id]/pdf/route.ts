/**
 * GET /api/leasing/receipts/[id]/pdf?lang=en|ar&download=0|1
 *
 * Tenant scoping: requires x-tenant-id. The receipt (verified directly on
 * its tenantId) and its associated contract + lessee (verified via the
 * contract's tenantId) must all belong to the caller's tenant.
 *
 * Note: the Prisma `LeaseReceipt` model has no `contract` relation field
 * (only the contractId foreign key). We do a separate lookup for the
 * contract + lessee so we can render the receipt header.
 */

import { createElement } from 'react';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { renderPdf } from '@/lib/pdf/render';
import { ReceiptPdf, type ReceiptPdfData } from '@/lib/pdf/templates/receipt';
import type { Lang } from '@/lib/pdf/theme';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const VENDOR = {
  name: 'Fleet360',
  tagline: 'UAE Smart Transport Management',
  address: 'Dubai, United Arab Emirates',
  email: 'finance@fleet360.app',
  trn: '',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const { id } = await params;
  if (!tenantId) {
    return jsonErr('Not authenticated', 401);
  }
  const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const download = req.nextUrl.searchParams.get('download') === '1';

  try {
    const r = await prisma.leaseReceipt.findFirst({ where: { id, tenantId } });
    if (!r) return jsonErr('Receipt not found', 404);

    // Look up contract + lessee separately since LeaseReceipt has no
    // `contract` relation in the Prisma schema.
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: r.contractId, tenantId },
      select: { contractNumber: true, lesseeId: true },
    });

    const lessee = contract
      ? await prisma.lessee.findFirst({
          where: { id: contract.lesseeId, tenantId },
        })
      : null;

    const data: ReceiptPdfData = {
      receiptNumber: r.receiptNumber ?? `RCP-${id.slice(0, 8)}`,
      receivedDate: r.receivedDate,
      amount: Number(r.amount),
      currency: r.currency ?? 'AED',
      paymentType: r.paymentType,
      paymentMethod: r.paymentMethod ?? null,
      chequeNo: r.chequeNo,
      bankRef: r.bankRef,
      receivedBy: r.receivedBy,
      vendor: VENDOR,
      lessee: lessee
        ? {
            name: lessee.name,
            type: lessee.type === 'corporate' ? 'corporate' : 'individual',
            tradeLicense: lessee.tradeLicense,
            emiratesId: lessee.emiratesId,
            email: lessee.email,
            phone: lessee.phone,
          }
        : { name: '—', type: 'individual' },
      contractRef: contract?.contractNumber ?? null,
      notes: r.notes,
    };

    const buffer = await renderPdf(createElement(ReceiptPdf, { data, lang }));
    return pdfResponse(buffer, `${data.receiptNumber}_${lang}.pdf`, download);
  } catch (err) {
    captureException(err, { context: 'leasing.receipt.pdf', tags: { receiptId: id, lang } });
    return jsonErr('Failed to generate receipt PDF', 500);
  }
}

function jsonErr(error: string, status: number) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
function pdfResponse(buffer: Buffer, filename: string, download: boolean) {
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}
