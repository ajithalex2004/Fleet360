import { createElement } from 'react';
import { NextRequest } from 'next/server';
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

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const download = req.nextUrl.searchParams.get('download') === '1';

  try {
    const contract = await prisma.leaseContract2.findUnique({
      where: { id },
      include: { vehicles: true },
    });
    if (!contract) return jsonErr('Contract not found', 404);

    const lessee = await prisma.lessee.findUnique({ where: { id: contract.lesseeId } }).catch(() => null);
    const data: ContractPdfData = {
      contractNumber: contract.contractNumber ?? `LC-${id.slice(0, 8)}`,
      agreementType: contract.agreementType,
      leaseType: contract.leaseType,
      startDate: contract.startDate,
      endDate: contract.endDate,
      durationMonths: Math.ceil((contract.endDate.getTime() - contract.startDate.getTime()) / (30.44 * 86400000)),
      monthlyRate: Number(contract.monthlyRate),
      totalContractValue: contract.totalContractValue ? Number(contract.totalContractValue) : null,
      mileageCap: contract.mileageCap,
      mileageOverageRate: contract.mileageOverageRate ? Number(contract.mileageOverageRate) : null,
      securityDeposit: contract.securityDeposit ? Number(contract.securityDeposit) : null,
      currency: contract.currency ?? 'AED',
      insuranceIncluded: contract.insuranceIncluded ?? false,
      maintenanceIncluded: contract.maintenanceIncluded ?? false,
      driverIncluded: contract.driverIncluded ?? false,
      vendor: VENDOR,
      lessee: lessee
        ? {
            name: lessee.name,
            type: lessee.type === 'corporate' ? 'corporate' : 'individual',
            address: lessee.address,
            email: lessee.email,
            phone: lessee.phone,
            tradeLicense: lessee.tradeLicense,
            emiratesId: lessee.emiratesId,
            trn: null,
          }
        : { name: contract.lesseeId, type: 'individual' },
      vehicles: contract.vehicles.map(vehicle => ({
        vehicleType: vehicle.vehicleType,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        licensePlate: vehicle.licensePlate,
        vin: vehicle.vin,
        monthlyRate: vehicle.monthlyRate ? Number(vehicle.monthlyRate) : null,
      })),
      notes: contract.notes,
    };

    const buffer = await renderPdf(createElement(ContractPdf, { data, lang }));
    return pdfResponse(buffer, `${data.contractNumber}_${lang}.pdf`, download);
  } catch (err) {
    captureException(err, { context: 'leasing.contract.pdf', tags: { contractId: id, lang } });
    return jsonErr('Failed to generate contract PDF', 500);
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
