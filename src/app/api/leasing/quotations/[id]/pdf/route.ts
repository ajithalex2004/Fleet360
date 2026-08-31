export const dynamic = 'force-dynamic';

/**
 * GET /api/leasing/quotations/[id]/pdf?lang=en|ar
 *
 * Fetches the quotation + lessee + vehicles, renders a bilingual PDF, and
 * returns it inline. Use ?download=1 to force a save dialog.
 *
 * Tenant scoping: requires x-tenant-id. The quotation is verified to belong
 * to the caller's tenant before the PDF is generated.
 */

import { createElement } from 'react';
import { withTenantRls } from '@/lib/rls';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { renderPdf } from '@/lib/pdf/render';
import { QuotationPdf, type QuotationPdfData } from '@/lib/pdf/templates/quotation';
import type { Lang } from '@/lib/pdf/theme';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const VENDOR_DEFAULT = {
  name: 'Fleet360',
  tagline: 'UAE Smart Transport Management',
  address: 'Dubai, United Arab Emirates',
  phone: '',
  email: 'noreply@fleet360.app',
  trn: '',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {

  const authz = requireAuthorizedTenant(request);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { id } = await params;

      if (!tenantId) {
        return new Response(JSON.stringify({ error: 'Not authenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const langParam = request.nextUrl.searchParams.get('lang');
      const lang: Lang = langParam === 'ar' ? 'ar' : 'en';
      const download = request.nextUrl.searchParams.get('download') === '1';

      try {
        const quotation = await tx.leaseQuotation.findFirst({
          where: { id, tenantId },
          include: {
            lessee: true,
            vehicles: true,
            lineItems: true,
          },
        });

        if (!quotation) {
          return new Response(JSON.stringify({ error: 'Quotation not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const data: QuotationPdfData = {
          quotationNumber: quotation.quotationNumber ?? `Q-${id.slice(0, 8)}`,
          quotationDate: quotation.createdAt ?? new Date(),
          validUntil: quotation.validUntil,

          vendor: VENDOR_DEFAULT,

          lessee: {
            name: quotation.lessee?.name ?? '—',
            type: (quotation.lessee?.type === 'corporate' ? 'corporate' : 'individual'),
            address: quotation.lessee?.address ?? null,
            email: quotation.lessee?.email ?? null,
            phone: quotation.lessee?.phone ?? null,
            tradeLicense: quotation.lessee?.tradeLicense ?? null,
            emiratesId: quotation.lessee?.emiratesId ?? null,
            trn: null,
          },

          vehicles: (quotation.vehicles ?? []).map(v => ({
            vehicleType: v.vehicleType,
            make: v.make,
            model: v.model,
            year: v.year,
            quantity: v.quantity ?? 1,
            monthlyRate: Number(v.monthlyRate ?? 0),
          })),

          lines: (quotation.lineItems ?? []).map(l => ({
            description: l.description,
            amount: Number(l.totalAmount ?? 0),
          })),

          baseRent: Number(quotation.baseMonthlyRate ?? 0),
          insurance: Number(quotation.insuranceCost ?? 0),
          maintenance: Number(quotation.maintenanceCost ?? 0),
          driver: Number(quotation.driverCost ?? 0),
          accessories: Number(quotation.accessoriesCost ?? 0),
          vatPct: 5,
          currency: quotation.currency ?? 'AED',

          leaseType: quotation.leaseType ?? undefined,
          durationMonths: quotation.durationMonths,
          mileageCap: quotation.mileageCap,
          securityDeposit: Number(quotation.securityDeposit ?? 0) || null,
          notes: quotation.notes,
        };

        const buffer = await renderPdf(createElement(QuotationPdf, { data, lang }));

        const filename = `${data.quotationNumber}_${lang}.pdf`;
        return new Response(buffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(buffer.length),
            'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
            'Cache-Control': 'private, no-cache',
          },
        });
        } catch (err) {
        captureException(err, { context: 'leasing.quotation.pdf', tags: { quotationId: id, lang } });
        console.error('[quotation pdf] error:', err);
        return new Response(
          JSON.stringify({ error: 'Failed to generate quotation PDF' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
  });
}

