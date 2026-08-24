/**
 * GET /api/leasing/contracts-v2/[id]/pdf?lang=en|ar
 *
 * Tenant scoping: requires x-tenant-id. The contract must belong to the
 * caller's tenant before the PDF is generated.
 */

import { createElement } from 'react';
import { withTenantRls } from '@/lib/rls';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { renderPdf } from '@/lib/pdf/render';
import { ContractPdf, type ContractPdfData } from '@/lib/pdf/templates/contract';
import type { Lang } from '@/lib/pdf/theme';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const VENDOR = {
  name: 'Fleet360',
  tagline: 'UAE Smart Transport Management',
  address: 'Dubai, United Arab Emirates',
  email: 'contracts@fleet360.app',
  trn: '',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { id } = await params;
      if (!tenantId) {
        return jsonErr('Not authenticated', 401);
      }
      const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
      const download = req.nextUrl.searchParams.get('download') === '1';

      try {
        const c = await tx.leaseContract2.findFirst({
          where: { id, tenantId },
          include: { vehicles: true, lessee: true },
        });
        if (!c) return jsonErr('Contract not found', 404);

        const data: ContractPdfData = {
          contractNumber: c.contractNumber ?? `LC-${id.slice(0, 8)}`,
          agreementType: c.agreementType,
          leaseType: c.leaseType,
          startDate: c.startDate,
          endDate: c.endDate,
          durationMonths: Math.ceil((c.endDate.getTime() - c.startDate.getTime()) / (30.44 * 86400000)),
          monthlyRate: Number(c.monthlyRate),
          totalContractValue: c.totalContractValue ? Number(c.totalContractValue) : null,
          mileageCap: c.mileageCap,
          mileageOverageRate: c.mileageOverageRate ? Number(c.mileageOverageRate) : null,
          securityDeposit: c.securityDeposit ? Number(c.securityDeposit) : null,
          currency: c.currency ?? 'AED',
          insuranceIncluded: c.insuranceIncluded ?? false,
          maintenanceIncluded: c.maintenanceIncluded ?? false,
          driverIncluded: c.driverIncluded ?? false,
          vendor: VENDOR,
          lessee: c.lessee
            ? {
                name: c.lessee.name,
                type: c.lessee.type === 'corporate' ? 'corporate' : 'individual',
                address: c.lessee.address,
                email: c.lessee.email,
                phone: c.lessee.phone,
                tradeLicense: c.lessee.tradeLicense,
                emiratesId: c.lessee.emiratesId,
                trn: null,
              }
            : { name: '—', type: 'individual' },
          vehicles: (c.vehicles ?? []).map((v) => ({
            vehicleType: v.vehicleType,
            make: v.make,
            model: v.model,
            year: v.year,
            licensePlate: v.licensePlate,
            vin: v.vin,
            monthlyRate: v.monthlyRate ? Number(v.monthlyRate) : null,
          })),
          notes: c.notes,
        };

        const buffer = await renderPdf(createElement(ContractPdf, { data, lang }));
        return pdfResponse(buffer, `${data.contractNumber}_${lang}.pdf`, download);
      } catch (err) {
        captureException(err, { context: 'leasing.contract.pdf', tags: { contractId: id, lang } });
        return jsonErr('Failed to generate contract PDF', 500);
      }
  });
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
