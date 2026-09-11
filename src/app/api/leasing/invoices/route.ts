export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { withAudit } from '@/lib/with-audit';
import { lockSerialSeries } from '@/lib/leasing/serial-lock';

/**
 * Lease invoice list (GET) + issue (POST).
 *
 * Multi-tenant: every operation is scoped by x-tenant-id from the
 * middleware. Layer 2.5 fix that closes TENANT-001 for the invoicing
 * surface. The schema-side tenantId column is set by the migration
 * `20260627000001_add_tenant_id_to_leasing_tables`.
 */
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const lesseeId = searchParams.get('lesseeId');
        const status   = searchParams.get('status');
        const invoices = await tx.leaseInvoice.findMany({
          where: {
            tenantId,
            ...(lesseeId ? { lesseeId } : {}),
            ...(status ? { status } : {}),
          },
          include: { lessee: { select: { name: true } }, lines: true },
          orderBy: { issueDate: 'desc' },
        });
        return NextResponse.json(invoices);
      } catch (e) {
        console.error('GET /api/leasing/invoices error:', e);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
      }
  });
}


export const POST = withAudit(
  async (req: NextRequest) => {
    const authz = requireAuthorizedTenant(req);
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;
    try {
      const raw = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(
        (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>,
      );
      const { lines = [], ...invoiceData } = body as Record<string, any>;

      if (!invoiceData.lesseeId) {
        return NextResponse.json({ error: 'lesseeId is required' }, { status: 400 });
      }

      const roundMoney = (val: number): number => {
        return Math.round((val + Number.EPSILON) * 100) / 100;
      };

      // Validated monetary computation with 2-decimal rounding
      const linesWithTotals = (Array.isArray(lines) ? lines : []).map((l: any) => {
        const quantity = Math.max(1, Number(l.quantity ?? 1));
        const unitAmount = roundMoney(Number(l.unitAmount ?? 0));
        const totalAmount = l.totalAmount != null && l.totalAmount !== ''
          ? roundMoney(Number(l.totalAmount))
          : roundMoney(quantity * unitAmount);
        return {
          ...l,
          quantity,
          unitAmount,
          totalAmount,
          currency: l.currency || invoiceData.currency || 'AED',
        };
      });

      const subTotal = roundMoney(linesWithTotals.reduce((s: number, l: any) => s + l.totalAmount, 0));
      const rawVat = invoiceData.vatPct !== undefined && invoiceData.vatPct !== null && invoiceData.vatPct !== ''
        ? Number(invoiceData.vatPct)
        : 5;
      if (isNaN(rawVat) || rawVat < 0 || rawVat > 100) {
        return NextResponse.json({ error: 'vatPct must be between 0 and 100' }, { status: 400 });
      }
      const vatPct = rawVat;
      const vatAmount = roundMoney(subTotal * (vatPct / 100));
      const totalAmount = roundMoney(subTotal + vatAmount);

      const issueDate = invoiceData.issueDate ? new Date(invoiceData.issueDate) : new Date();
      const dueDate = invoiceData.dueDate ? new Date(invoiceData.dueDate) : issueDate;

      const invoice = await withTenantRls(prisma, tenantId, async (tx) => {
        const lessee = await tx.lessee.findFirst({
          where: { id: invoiceData.lesseeId, tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!lessee) {
          throw Object.assign(new Error('Lessee not found in this tenant'), { status: 404 });
        }

        // Validate contract consistency and state if contractId is provided
        const contractId = invoiceData.contractId || linesWithTotals.find((l: any) => l.contractId)?.contractId;
        if (contractId) {
          const contract = await tx.leaseContract2.findFirst({
            where: { id: contractId, tenantId, deletedAt: null },
            select: { id: true, lesseeId: true, status: true },
          });
          if (!contract) {
            throw Object.assign(new Error('Contract not found in this tenant'), { status: 404 });
          }
          if (contract.lesseeId !== invoiceData.lesseeId) {
            throw Object.assign(new Error('Invoice lessee does not match contract customer'), { status: 400 });
          }
          const cStatus = (contract.status || '').toUpperCase();
          if (!['ACTIVE', 'EXTENDED'].includes(cStatus)) {
            throw Object.assign(
              new Error(`Cannot invoice contract in ${contract.status} status. Contract must be ACTIVE or EXTENDED`),
              { status: 400 }
            );
          }

          // Duplicate-billing protection by period
          if (invoiceData.billingPeriod) {
            const existingBilling = await tx.leaseInvoice.findFirst({
              where: {
                tenantId,
                billingPeriod: String(invoiceData.billingPeriod),
                status: { notIn: ['CANCELLED'] },
                lines: { some: { contractId } },
              },
              select: { id: true, invoiceNo: true },
            });
            if (existingBilling) {
              throw Object.assign(
                new Error(`Invoice ${existingBilling.invoiceNo || existingBilling.id} already exists for contract in billing period ${invoiceData.billingPeriod}`),
                { status: 409 }
              );
            }
          }
        }

        // G13: serial lock for invoice numbers
        await lockSerialSeries(tx, tenantId, 'invoice');
        const count = await tx.leaseInvoice.count({ where: { tenantId } });
        const invoiceNo = `INV-${String(count + 1).padStart(6, '0')}`;

        return tx.leaseInvoice.create({
          data: {
            ...invoiceData,
            tenantId,
            invoiceNo,
            issueDate,
            dueDate,
            subTotal,
            vatPct,
            vatAmount,
            totalAmount,
            status: invoiceData.status || 'DRAFT',
            lines: {
              create: linesWithTotals.map((l: any) => ({
                ...l,
                tenantId,
                contractId: l.contractId || invoiceData.contractId || null,
              })),
            },
          },
          include: { lines: true, lessee: { select: { name: true } } },
        });
      });

      return NextResponse.json(invoice, { status: 201 });
    } catch (e: any) {
      console.error('POST /api/leasing/invoices error:', e);
      const status = e?.status || 500;
      return NextResponse.json({ error: e?.message || 'Failed' }, { status });
    }
  },
  {
    entityType: 'LeaseInvoice',
    action: 'CREATE',
    extractEntity: (body) => ({ id: body?.id, name: body?.invoiceNo }),
    describe: (_req, body) =>
      body?.invoiceNo
        ? `Issued invoice ${body.invoiceNo} for ${body.totalAmount ?? 0} ${body.currency ?? 'AED'} (lessee: ${body.lessee?.name ?? body.lesseeId ?? 'unknown'})`
        : undefined,
  },
);
