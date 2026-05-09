import { createElement } from 'react';
import { NextRequest } from 'next/server';
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
  const { id } = await params;
  const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const download = req.nextUrl.searchParams.get('download') === '1';

  try {
    const r = await prisma.leaseReceipt.findUnique({
      where: { id },
      include: { contract: { include: { lessee: true } } },
    });
    if (!r) return jsonErr('Receipt not found', 404);

    const lessee = r.contract.lessee;
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
      contractRef: r.contract?.contractNumber ?? null,
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
