import { NextRequest, NextResponse } from 'next/server';
import { generateSelfBilledTaxInvoice } from '@/lib/finance/self-billing';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finance/self-billing
 * Generates an Article 59(9) Self-Billed Tax Invoice for a transporter / owner-driver
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const supplier = body.supplier || {
      supplierName: 'Al Baraka Commercial Transporters LLC',
      supplierTrn: '100554433221100',
      address: 'Industrial Area 13',
      city: 'Sharjah',
      emirate: 'Sharjah',
      contactPhone: '+971 50 123 4567',
    };

    const items = Array.isArray(body.items) && body.items.length > 0
      ? body.items
      : [
          {
            tripNumber: 'TRIP-2026-8810',
            description: 'Staff Bus Route 14: Deira to Dubai Silicon Oasis (Round Trip)',
            serviceDate: new Date().toISOString().split('T')[0],
            quantity: 22,
            ratePerUnit: 350,
            vatRatePct: 5,
          },
          {
            tripNumber: 'TRIP-2026-8811',
            description: 'Dedicated Ad-hoc Overtime Shuttle — Al Quoz Depot',
            serviceDate: new Date().toISOString().split('T')[0],
            quantity: 4,
            ratePerUnit: 420,
            vatRatePct: 5,
          },
        ];

    const selfBillNumber = body.selfBillNumber || `SB-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

    const invoice = generateSelfBilledTaxInvoice({
      selfBillNumber,
      supplier,
      items,
      settlementPeriod: body.settlementPeriod,
      beneficiaryIban: body.beneficiaryIban || 'AE290330000000012345678',
      paymentDueDate: body.paymentDueDate,
    });

    return NextResponse.json({
      success: true,
      selfBilledTaxInvoice: invoice,
      complianceStandard: 'UAE_VAT_EXECUTIVE_REG_ART_59_9',
    });
  } catch (err: any) {
    console.error('Error in self-billing generation API:', err);
    return NextResponse.json({ error: 'Failed to generate self-billed invoice', details: err.message }, { status: 500 });
  }
}

/**
 * GET /api/finance/self-billing
 * Lists demo or recently issued self-billing records
 */
export async function GET() {
  const sample = generateSelfBilledTaxInvoice({
    selfBillNumber: `SB-${new Date().getFullYear()}-00912`,
    supplier: {
      supplierName: 'Gulf Star Transport LLC',
      supplierTrn: '100887766554433',
      address: 'Al Quoz Industrial 3',
      city: 'Dubai',
      emirate: 'Dubai',
      contactPhone: '+971 4 333 8888',
    },
    items: [
      {
        tripNumber: 'TRIP-2026-9041',
        description: 'Airport Shuttle Passenger Transit (Terminal 3 to DWC)',
        serviceDate: '2026-08-15',
        quantity: 15,
        ratePerUnit: 480,
      },
    ],
  });

  return NextResponse.json({
    success: true,
    totalRecords: 1,
    invoices: [sample],
  });
}
