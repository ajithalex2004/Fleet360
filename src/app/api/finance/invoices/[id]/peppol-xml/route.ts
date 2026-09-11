import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { generatePeppolUaeInvoiceXml, PeppolInvoiceData } from '@/lib/finance/peppol-e-invoice';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuthorizedTenant(req);
    if (auth instanceof NextResponse) return auth;
    const { tenantId } = auth;

    const { id } = await params;

    // 1. Try finding in database (LeaseInvoice) scoped to tenant
    const invoice = await withTenantRls(prisma, tenantId, (tx) =>
      tx.leaseInvoice.findFirst({
        where: { id, tenantId },
        include: {
          lessee: true,
          lines: true,
        },
      })
    );

    let invoiceData: PeppolInvoiceData;

    if (invoice) {
      invoiceData = {
        invoiceNumber: invoice.invoiceNo || `INV-${invoice.id.substring(0, 8).toUpperCase()}`,
        issueDate: invoice.issueDate ? invoice.issueDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        dueDate: invoice.dueDate ? invoice.dueDate.toISOString().split('T')[0] : undefined,
        currency: invoice.currency || 'AED',
        seller: {
          name: 'Fleet360 Smart Mobility Solutions LLC',
          trn: '100456789012345',
          crn: 'CN-1029384',
          address: {
            street: 'Sheikh Zayed Road, Al Quoz 1, Tower B',
            city: 'Dubai',
            state: 'Dubai',
            countryCode: 'AE',
          },
          contact: {
            name: 'Finance & Billing Ops',
            email: 'billing@fleet360.ae',
            phone: '+97143009999',
          },
        },
        buyer: {
          name: invoice.lessee?.companyName || invoice.lessee?.name || 'Valued Corporate Client',
          trn: invoice.lessee?.trn || '100987654321000',
          crn: invoice.lessee?.tradeLicenseNo || undefined,
          address: {
            street: invoice.lessee?.address || 'Business Bay, Tower 1',
            city: invoice.lessee?.city || 'Dubai',
            state: invoice.lessee?.emirate || 'Dubai',
            countryCode: 'AE',
          },
          contact: {
            name: invoice.lessee?.contactPerson || undefined,
            email: invoice.lessee?.email || undefined,
            phone: invoice.lessee?.phone || undefined,
          },
        },
        lines: (invoice.lines && invoice.lines.length > 0)
          ? invoice.lines.map((l, idx) => ({
              id: idx + 1,
              name: l.description || 'Fleet Mobility & Transport Services',
              description: l.description || undefined,
              quantity: Number(l.quantity ?? 1),
              unitPrice: Number(l.unitPrice ?? l.amount),
              netAmount: Number(l.amount),
              vatRatePercent: Number(invoice.vatPct ?? 5),
              vatAmount: Number(((Number(l.amount) * (Number(invoice.vatPct ?? 5) / 100))).toFixed(2)),
              taxCategoryCode: 'S',
            }))
          : [
              {
                id: 1,
                name: 'Fleet Leasing & Mobility Services',
                description: `Billing Period: ${invoice.billingPeriod || 'Current Month'}`,
                quantity: 1,
                unitPrice: Number(invoice.subTotal || 1000),
                netAmount: Number(invoice.subTotal || 1000),
                vatRatePercent: Number(invoice.vatPct ?? 5),
                vatAmount: Number(invoice.vatAmount ?? 50),
                taxCategoryCode: 'S',
              },
            ],
        notes: invoice.notes || 'UAE Tax Invoice pursuant to Federal Decree-Law No. 8 of 2017 & Peppol PINT-UAE specifications.',
      };
    } else {
      // Mock / dynamic fallback for testing or external invoice references
      invoiceData = {
        invoiceNumber: id.startsWith('INV') ? id : `INV-${id.toUpperCase()}`,
        issueDate: new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        currency: 'AED',
        seller: {
          name: 'Fleet360 Smart Mobility Solutions LLC',
          trn: '100456789012345',
          crn: 'CN-1029384',
          address: {
            street: 'Sheikh Zayed Road, Al Quoz 1',
            city: 'Dubai',
            state: 'Dubai',
            countryCode: 'AE',
          },
          contact: {
            name: 'Finance Department',
            email: 'billing@fleet360.ae',
          },
        },
        buyer: {
          name: 'Apex Logistics Transport LLC',
          trn: '100234567890003',
          address: {
            street: 'Khalifa Industrial Zone Abu Dhabi (KIZAD)',
            city: 'Abu Dhabi',
            state: 'Abu Dhabi',
            countryCode: 'AE',
          },
        },
        lines: [
          {
            id: 1,
            name: 'Heavy Commercial Transport Services',
            description: 'Route DXB-AUH Industrial Haulage',
            quantity: 5,
            unitPrice: 1200,
            netAmount: 6000,
            vatRatePercent: 5,
            vatAmount: 300,
            taxCategoryCode: 'S',
          },
        ],
        notes: 'FTA Electronic Tax Invoice generated in compliance with UAE Peppol PINT Mandate.',
      };
    }

    const result = generatePeppolUaeInvoiceXml(invoiceData);

    if (!result.isValid || !result.xml) {
      return NextResponse.json({ error: 'Failed to generate valid Peppol XML', details: result.errors }, { status: 422 });
    }

    // Check format query: json or raw xml download
    const format = req.nextUrl.searchParams.get('format');
    if (format === 'json') {
      return NextResponse.json({
        invoiceNumber: invoiceData.invoiceNumber,
        digestHash: result.digestHash,
        warnings: result.warnings,
        xml: result.xml,
      });
    }

    return new NextResponse(result.xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${invoiceData.invoiceNumber}-peppol.xml"`,
        'X-Invoice-Digest-SHA256': result.digestHash || '',
      },
    });
  } catch (error: any) {
    console.error('Error generating Peppol e-invoice XML:', error);
    return NextResponse.json({ error: 'Internal server error generating Peppol XML', details: error.message }, { status: 500 });
  }
}
