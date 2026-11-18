import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { assertPeriodOpen, postOperationalJournalEntry } from '@/lib/finance/journal-service';
import { lockSerialSeries } from '@/lib/leasing/serial-lock';
import { postLeaseInvoiceToGl } from '@/lib/leasing/leasing-gl-posting';
import { logAuditInTx } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(
      (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>,
    );

    const fineId = typeof body.fineId === 'string' ? body.fineId.trim() : '';
    if (!fineId) {
      return NextResponse.json({ error: 'fineId is required' }, { status: 400 });
    }

    if (body.fineAmount !== undefined) {
      const parsedFine = Number(body.fineAmount);
      if (!Number.isFinite(parsedFine) || parsedFine < 0) {
        return NextResponse.json({ error: 'fineAmount and adminFee must be non-negative numbers' }, { status: 400 });
      }
    }
    if (body.adminFee !== undefined) {
      const parsedFee = Number(body.adminFee);
      if (!Number.isFinite(parsedFee) || parsedFee < 0) {
        return NextResponse.json({ error: 'fineAmount and adminFee must be non-negative numbers' }, { status: 400 });
      }
    }

    // UAE FTA VATP006 / VATP040: Statutory fines are strictly 0% VAT (Out of Scope)
    if (body.fineTaxRateOverride !== undefined && Number(body.fineTaxRateOverride) !== 0) {
      return NextResponse.json(
        { error: 'Statutory traffic fine VAT rate cannot be overridden from 0% (FTA VATP006/VATP040)' },
        { status: 422 },
      );
    }

    const vatRate = 0.05;

    return await withTenantRls(prisma, tenantId, async (tx) => {
      // 1. Check LeaseTrafficFine first
      const leaseFine = await tx.leaseTrafficFine.findFirst({
        where: {
          tenantId,
          OR: [{ id: fineId }, { fineNo: fineId }],
        },
        include: {
          contract: { select: { id: true, lesseeId: true, currency: true } },
        },
      });

      if (leaseFine) {
        if (
          leaseFine.billingStatus === 'INVOICED' ||
          leaseFine.billingStatus === 'PAID' ||
          leaseFine.billingStatus === 'PROCESSING'
        ) {
          return NextResponse.json({ error: 'Traffic fine has already been recharged' }, { status: 409 });
        }

        const fineAmount = Number(
          Number(body.fineAmount ?? leaseFine.finalAmount ?? leaseFine.fineAmount ?? 0).toFixed(2),
        );
        const adminFee = Number(Number(body.adminFee ?? 0).toFixed(2));
        if (!Number.isFinite(fineAmount) || !Number.isFinite(adminFee) || fineAmount < 0 || adminFee < 0) {
          return NextResponse.json({ error: 'fineAmount and adminFee must be non-negative numbers' }, { status: 400 });
        }
        if (fineAmount + adminFee <= 0) {
          return NextResponse.json({ error: 'Recharge total must be greater than zero' }, { status: 400 });
        }

        // Acquire row-level lock and atomically claim PENDING -> PROCESSING before creating invoice/GL
        await tx.$executeRaw`SELECT id FROM lease_traffic_fines WHERE id = ${leaseFine.id} AND tenant_id = ${tenantId} FOR UPDATE;`;

        const claimResult = await tx.leaseTrafficFine.updateMany({
          where: {
            id: leaseFine.id,
            tenantId,
            OR: [
              { billingStatus: 'PENDING' },
              { billingStatus: null },
            ],
          },
          data: {
            billingStatus: 'PROCESSING',
          },
        });
        if (claimResult.count !== 1) {
          return NextResponse.json(
            { error: 'Fine has already been invoiced or is currently being processed' },
            { status: 409 },
          );
        }

        await assertPeriodOpen(tx, tenantId, new Date());

        const vatAmount = Number((adminFee * vatRate).toFixed(2));
        const subTotal = Number((fineAmount + adminFee).toFixed(2));
        const totalAmount = Number((subTotal + vatAmount).toFixed(2));
        const currency = leaseFine.currency ?? leaseFine.contract?.currency ?? 'AED';
        const lesseeId = leaseFine.lesseeId ?? leaseFine.contract?.lesseeId ?? null;

        let invoiceId: string | null = null;
        let invoiceNo: string | null = null;
        let glEntry: { id: string; number: string; created: boolean } | null = null;

        if (lesseeId) {
          await lockSerialSeries(tx, tenantId, 'invoice');
          const count = await tx.leaseInvoice.count({ where: { tenantId } });
          invoiceNo = `INV-${String(count + 1).padStart(6, '0')}`;
          const issueDate = new Date();
          const dueDate = new Date(issueDate.getTime() + 30 * 86400000);

          const linesData: Array<{
            tenantId: string;
            contractId: string | null;
            vehicleRef: string | null;
            description: string;
            lineType: string;
            quantity: number;
            unitAmount: number;
            totalAmount: number;
            currency: string;
          }> = [];

          if (fineAmount > 0) {
            linesData.push({
              tenantId,
              contractId: leaseFine.contractId ?? null,
              vehicleRef: leaseFine.vehicleId ?? null,
              description: `${leaseFine.violationType} statutory fine ${leaseFine.fineNo ?? leaseFine.id.slice(0, 8)} (0% VAT FTA VATP006/040)`,
              lineType: 'STATUTORY_FINE',
              quantity: 1,
              unitAmount: fineAmount,
              totalAmount: fineAmount,
              currency,
            });
          }
          if (adminFee > 0) {
            linesData.push({
              tenantId,
              contractId: leaseFine.contractId ?? null,
              vehicleRef: leaseFine.vehicleId ?? null,
              description: `Fine administrative handling surcharge (${leaseFine.fineNo ?? leaseFine.id.slice(0, 8)})`,
              lineType: 'ADMIN_FEE',
              quantity: 1,
              unitAmount: adminFee,
              totalAmount: adminFee,
              currency,
            });
          }

          const invoice = await tx.leaseInvoice.create({
            data: {
              invoiceNo,
              lesseeId,
              billingPeriod: `Traffic fine recharge — ${issueDate.toISOString().slice(0, 10)}`,
              issueDate,
              dueDate,
              subTotal,
              vatPct: adminFee > 0 ? 5 : 0,
              vatAmount,
              totalAmount,
              currency,
              status: 'SENT',
              notes: `Traffic fine recharge for ${leaseFine.fineNo ?? leaseFine.id}`,
              tenantId,
              lines: { create: linesData },
            },
          });
          invoiceId = invoice.id;

          glEntry = await postLeaseInvoiceToGl(tx as any, {
            invoiceId: invoice.id,
            tenantId,
            preparedBy: authz.userId ?? 'system',
          });
          if (!glEntry) {
            throw new Error('Failed to post lease fine invoice to General Ledger');
          }
        } else {
          const glLines: Array<{ code: string; name: string; description: string; debit: number; credit: number }> = [
            {
              code: '1132',
              name: 'Accounts Receivable — Corporate Leasing',
              description: `AR for lease traffic fine recharge ${leaseFine.fineNo ?? leaseFine.id}`,
              debit: totalAmount,
              credit: 0,
            },
          ];
          if (fineAmount > 0) {
            glLines.push({
              code: '2160',
              name: 'Traffic Fines & Tolls Clearing',
              description: `Statutory traffic fine recharge (0% VAT) for ${leaseFine.fineNo ?? leaseFine.id}`,
              debit: 0,
              credit: fineAmount,
            });
          }
          if (adminFee > 0) {
            glLines.push({
              code: '4140',
              name: 'Fine & Violation Admin Surcharges',
              description: `Fine admin surcharge (5% VAT) for ${leaseFine.fineNo ?? leaseFine.id}`,
              debit: 0,
              credit: adminFee,
            });
          }
          if (vatAmount > 0) {
            glLines.push({
              code: '2120',
              name: 'VAT Output Tax Payable',
              description: `5% Output VAT on fine admin fee for ${leaseFine.fineNo ?? leaseFine.id}`,
              debit: 0,
              credit: vatAmount,
            });
          }

          glEntry = await postOperationalJournalEntry(tx as any, {
            tenantId,
            entryDate: new Date().toISOString().slice(0, 10),
            narration: `Lease Traffic Fine Recharge ${leaseFine.fineNo ?? leaseFine.id}`,
            reference: `${leaseFine.fineNo ?? leaseFine.id}-RCH`,
            sourceType: 'TRAFFIC_FINE_RECHARGE',
            sourceId: leaseFine.id,
            currency,
            preparedBy: authz.userId ?? 'system',
            idempotencyKey: `LEASE_TRAFFIC_FINE_RECHARGE:${leaseFine.id}`,
            lines: glLines,
          });
          if (!glEntry) {
            throw new Error('Failed to post lease fine recharge GL entry');
          }
        }

        await tx.leaseTrafficFine.update({
          where: { id: leaseFine.id },
          data: {
            billingStatus: 'INVOICED',
            paymentRef: invoiceNo ?? glEntry.number,
          },
        });

        await logAuditInTx({
          tenantId,
          entityType: 'LeaseTrafficFine',
          entityId: leaseFine.id,
          action: 'UPDATE',
          userId: authz.userId ?? undefined,
          userRole: authz.role ?? undefined,
          details: `Recharged lease traffic fine ${leaseFine.fineNo ?? leaseFine.id}: fine=${fineAmount}, fee=${adminFee}, vat=${vatAmount}, total=${totalAmount}`,
        }, tx);

        return NextResponse.json({
          ok: true,
          rechargeId: invoiceId ?? glEntry.id,
          fineId: leaseFine.id,
          recordType: 'LeaseTrafficFine',
          invoiceId,
          invoiceNo,
          journalEntryId: glEntry.id,
          journalEntryNumber: glEntry.number,
          fineAmount,
          adminFee,
          statutoryTaxCategory: 'O',
          statutoryVatRate: 0,
          adminTaxCategory: 'S',
          adminVatRate: vatRate,
          vatAmount,
          totalAmount,
        }, { status: 201 });
      }

      // 2. Check TrafficFine (Fleet / Rental fine record)
      const fine = await tx.trafficFine.findFirst({
        where: {
          tenantId,
          OR: [{ id: fineId }, { fineRef: fineId }],
        },
      });

      if (!fine) {
        return NextResponse.json({ error: 'Traffic fine not found' }, { status: 404 });
      }

      if (fine.isBilledToCustomer || fine.status === 'RECHARGED' || fine.status === 'PROCESSING') {
        return NextResponse.json({ error: 'Traffic fine has already been recharged' }, { status: 409 });
      }

      const fineAmount = Number(Number(body.fineAmount ?? fine.fineAmount ?? 0).toFixed(2));
      const adminFee = Number(Number(body.adminFee ?? fine.adminFee ?? 0).toFixed(2));
      if (!Number.isFinite(fineAmount) || !Number.isFinite(adminFee) || fineAmount < 0 || adminFee < 0) {
        return NextResponse.json({ error: 'fineAmount and adminFee must be non-negative numbers' }, { status: 400 });
      }
      if (fineAmount + adminFee <= 0) {
        return NextResponse.json({ error: 'Recharge total must be greater than zero' }, { status: 400 });
      }

      // Acquire row-level lock and atomically claim fine -> PROCESSING before GL posting
      await tx.$executeRaw`SELECT id FROM traffic_fines WHERE id = ${fine.id} AND tenant_id = ${tenantId} FOR UPDATE;`;

      const claimResult = await tx.trafficFine.updateMany({
        where: {
          id: fine.id,
          tenantId,
          isBilledToCustomer: false,
          OR: [
            { status: { notIn: ['RECHARGED', 'PROCESSING'] } },
            { status: null },
          ],
        },
        data: {
          status: 'PROCESSING',
        },
      });
      if (claimResult.count !== 1) {
        return NextResponse.json(
          { error: 'Fine has already been recharged or is currently being processed' },
          { status: 409 },
        );
      }

      await assertPeriodOpen(tx, tenantId, new Date());

      const vatAmount = Number((adminFee * vatRate).toFixed(2));
      const totalAmount = Number((fineAmount + adminFee + vatAmount).toFixed(2));

      const glLines: Array<{ code: string; name: string; description: string; debit: number; credit: number }> = [
        {
          code: '1132',
          name: 'Accounts Receivable — Corporate Leasing',
          description: `AR for traffic fine recharge ${fine.fineRef ?? fine.id}`,
          debit: totalAmount,
          credit: 0,
        },
      ];
      if (fineAmount > 0) {
        glLines.push({
          code: '2160',
          name: 'Traffic Fines & Tolls Clearing',
          description: `Statutory traffic fine recharge (0% VAT FTA VATP006/040) for ${fine.fineRef ?? fine.id}`,
          debit: 0,
          credit: fineAmount,
        });
      }
      if (adminFee > 0) {
        glLines.push({
          code: '4140',
          name: 'Fine & Violation Admin Surcharges',
          description: `Fine admin surcharge (5% VAT) for ${fine.fineRef ?? fine.id}`,
          debit: 0,
          credit: adminFee,
        });
      }
      if (vatAmount > 0) {
        glLines.push({
          code: '2120',
          name: 'VAT Output Tax Payable',
          description: `5% Output VAT on fine admin fee for ${fine.fineRef ?? fine.id}`,
          debit: 0,
          credit: vatAmount,
        });
      }

      const glEntry = await postOperationalJournalEntry(tx as any, {
        tenantId,
        entryDate: new Date().toISOString().slice(0, 10),
        narration: `Traffic Fine Recharge ${fine.fineRef ?? fine.id}`,
        reference: `${fine.fineRef ?? fine.id}-RCH`,
        sourceType: 'TRAFFIC_FINE_RECHARGE',
        sourceId: fine.id,
        currency: 'AED',
        preparedBy: authz.userId ?? 'system',
        idempotencyKey: `TRAFFIC_FINE_RECHARGE:${fine.id}`,
        lines: glLines,
      });
      if (!glEntry) {
        throw new Error('Failed to post traffic fine recharge GL entry');
      }

      await tx.trafficFine.update({
        where: { id: fine.id },
        data: {
          status: 'RECHARGED',
          isBilledToCustomer: true,
          billedInvoiceId: glEntry.id,
        },
      });

      await logAuditInTx({
        tenantId,
        entityType: 'TrafficFine',
        entityId: fine.id,
        action: 'UPDATE',
        userId: authz.userId ?? undefined,
        userRole: authz.role ?? undefined,
        details: `Recharged traffic fine ${fine.fineRef ?? fine.id}: fine=${fineAmount}, fee=${adminFee}, vat=${vatAmount}, total=${totalAmount}`,
      }, tx);

      return NextResponse.json({
        ok: true,
        rechargeId: glEntry.id,
        fineId: fine.id,
        recordType: 'TrafficFine',
        journalEntryId: glEntry.id,
        journalEntryNumber: glEntry.number,
        fineAmount,
        adminFee,
        statutoryTaxCategory: 'O',
        statutoryVatRate: 0,
        adminTaxCategory: 'S',
        adminVatRate: vatRate,
        vatAmount,
        totalAmount,
      }, { status: 201 });
    });
  } catch (e: unknown) {
    const errObj = e as { statusCode?: number; message?: string };
    if (errObj?.statusCode === 422) {
      return NextResponse.json({ error: errObj.message || 'Accounting period is locked' }, { status: 422 });
    }
    console.error('[traffic-fines/recharge]', e);
    return NextResponse.json({ error: 'Failed to process fine recharge' }, { status: 500 });
  }
}
