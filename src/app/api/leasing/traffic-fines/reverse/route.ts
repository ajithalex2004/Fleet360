import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { assertPeriodOpen, postOperationalJournalEntry } from '@/lib/finance/journal-service';
import { postLeaseInvoiceReversalToGl } from '@/lib/leasing/leasing-gl-posting';
import { logAuditInTx } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody);
    const rechargeId = String(body.rechargeId ?? body.fineId ?? body.invoiceId ?? '').trim();
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Fine recharge reversal';
    const reopenForBilling = Boolean(body.reopenForBilling);

    if (!rechargeId) {
      return NextResponse.json({ error: 'rechargeId is required' }, { status: 400 });
    }

    return await withTenantRls(prisma, tenantId, async (tx) => {
      // 1. Check LeaseInvoice (consolidated lease invoice containing fine lines)
      const invoice = await tx.leaseInvoice.findFirst({
        where: {
          tenantId,
          OR: [{ id: rechargeId }, { invoiceNo: rechargeId }],
        },
        include: { lines: true },
      });

      if (invoice) {
        if (invoice.status === 'CANCELLED') {
          return NextResponse.json({ error: 'Lease invoice has already been reversed' }, { status: 409 });
        }

        await assertPeriodOpen(tx, tenantId, new Date());

        const glEntry = await postLeaseInvoiceReversalToGl(tx as any, {
          invoiceId: invoice.id,
          tenantId,
          preparedBy: authz.userId ?? 'system',
          reason,
        });
        if (Number(invoice.totalAmount) > 0 && !glEntry) {
          throw new Error('Failed to post lease invoice GL reversal');
        }

        await tx.leaseInvoice.update({
          where: { id: invoice.id },
          data: {
            status: 'CANCELLED',
            notes: invoice.notes ? `${invoice.notes}\nReversed: ${reason}` : `Reversed: ${reason}`,
          },
        });

        if (invoice.invoiceNo) {
          await tx.leaseTrafficFine.updateMany({
            where: { tenantId, paymentRef: invoice.invoiceNo, billingStatus: 'INVOICED' },
            data: {
              billingStatus: reopenForBilling ? 'PENDING' : 'ABSORBED',
              paymentRef: null,
            },
          });
        }

        let fineAmount = 0;
        let adminFee = 0;
        for (const line of invoice.lines ?? []) {
          const amt = Number(line.totalAmount ?? 0);
          const upperType = String(line.lineType || '').trim().toUpperCase();
          const upperDesc = String(line.description || '').toLowerCase();
          if (upperType === 'STATUTORY_FINE' || upperType === 'FINE' || upperDesc.includes('statutory fine')) {
            fineAmount += amt;
          } else if (upperType === 'ADMIN_FEE' || upperDesc.includes('admin surcharge') || upperDesc.includes('admin fee')) {
            adminFee += amt;
          }
        }
        const vatAmount = Number(invoice.vatAmount ?? 0);
        const totalAmount = Number(invoice.totalAmount ?? 0);

        await logAuditInTx({
          tenantId,
          entityType: 'LeaseInvoice',
          entityId: invoice.id,
          action: 'UPDATE',
          userId: authz.userId ?? undefined,
          userRole: authz.role ?? undefined,
          details: `Reversed lease invoice ${invoice.invoiceNo ?? invoice.id}: ${reason}`,
        }, tx);

        return NextResponse.json({
          ok: true,
          reversalId: glEntry?.id ?? invoice.id,
          rechargeId,
          recordType: 'LeaseInvoice',
          status: 'REVERSED',
          fineAmount: Number(fineAmount.toFixed(2)),
          adminFee: Number(adminFee.toFixed(2)),
          statutoryTaxCategory: 'O',
          statutoryVatRate: 0,
          adminTaxCategory: 'S',
          adminVatRate: 0.05,
          vatAmount: Number(vatAmount.toFixed(2)),
          totalAmount: Number(totalAmount.toFixed(2)),
          journalEntryId: glEntry?.id ?? null,
          journalEntryNumber: glEntry?.number ?? null,
          reversedAt: new Date().toISOString(),
        }, { status: 200 });
      }

      // 2. Check TrafficFine
      const fine = await tx.trafficFine.findFirst({
        where: {
          tenantId,
          OR: [{ id: rechargeId }, { fineRef: rechargeId }],
        },
      });

      if (fine) {
        if (fine.status === 'WAIVED') {
          return NextResponse.json({ error: 'Traffic fine recharge has already been reversed' }, { status: 409 });
        }

        const existingReversal = await tx.financeJournalEntry.findFirst({
          where: {
            tenantId,
            sourceType: 'TRAFFIC_FINE_REVERSAL',
            sourceId: fine.id,
            status: { not: 'REVERSED' },
          },
          select: { id: true },
        });
        if (existingReversal) {
          return NextResponse.json({ error: 'Traffic fine recharge has already been reversed' }, { status: 409 });
        }

        const finePrincipal = Number(Number(fine.fineAmount ?? 0).toFixed(2));
        const adminFee = Number(Number(fine.adminFee ?? 0).toFixed(2));
        const vatAmount = Number((adminFee * 0.05).toFixed(2));
        const totalAmount = Number((finePrincipal + adminFee + vatAmount).toFixed(2));

        await assertPeriodOpen(tx, tenantId, new Date());

        let glEntry: { id: string; number: string; created: boolean } | null = null;
        if (totalAmount > 0) {
          const lines: Array<{ code: string; name: string; description: string; debit: number; credit: number }> = [];
          if (finePrincipal > 0) {
            lines.push({
              code: '2160',
              name: 'Traffic Fines & Tolls Clearing',
              description: `Reversal of statutory fine (0% VAT) for fine ${fine.fineRef ?? fine.id}`,
              debit: finePrincipal,
              credit: 0,
            });
          }
          if (adminFee > 0) {
            lines.push({
              code: '4140',
              name: 'Fine & Violation Admin Surcharges',
              description: `Reversal of fine admin fee (5% VAT) for fine ${fine.fineRef ?? fine.id}`,
              debit: adminFee,
              credit: 0,
            });
          }
          if (vatAmount > 0) {
            lines.push({
              code: '2120',
              name: 'VAT Output Tax Payable',
              description: `Reversal of 5% VAT on admin fee for fine ${fine.fineRef ?? fine.id}`,
              debit: vatAmount,
              credit: 0,
            });
          }
          lines.push({
            code: '1132',
            name: 'Accounts Receivable — Corporate Leasing',
            description: `AR credit for reversed traffic fine ${fine.fineRef ?? fine.id}`,
            debit: 0,
            credit: totalAmount,
          });

          glEntry = await postOperationalJournalEntry(tx as any, {
            tenantId,
            entryDate: new Date().toISOString().slice(0, 10),
            narration: `Traffic Fine Recharge Reversal ${fine.fineRef ?? fine.id} — ${reason}`,
            reference: `${fine.fineRef ?? fine.id}-REV`,
            sourceType: 'TRAFFIC_FINE_REVERSAL',
            sourceId: fine.id,
            currency: 'AED',
            preparedBy: authz.userId ?? 'system',
            idempotencyKey: `TRAFFIC_FINE_REVERSAL:${fine.id}`,
            lines,
          });
          if (!glEntry) {
            throw new Error('Failed to post traffic fine reversal GL entry');
          }
        }

        await tx.trafficFine.update({
          where: { id: fine.id },
          data: {
            status: 'WAIVED',
            isBilledToCustomer: false,
          },
        });

        await logAuditInTx({
          tenantId,
          entityType: 'TrafficFine',
          entityId: fine.id,
          action: 'UPDATE',
          userId: authz.userId ?? undefined,
          userRole: authz.role ?? undefined,
          details: `Reversed traffic fine ${fine.fineRef ?? fine.id}: ${reason}`,
        }, tx);

        return NextResponse.json({
          ok: true,
          reversalId: glEntry?.id ?? fine.id,
          rechargeId,
          recordType: 'TrafficFine',
          status: 'REVERSED',
          fineAmount: finePrincipal,
          adminFee,
          statutoryTaxCategory: 'O',
          statutoryVatRate: 0,
          adminTaxCategory: 'S',
          adminVatRate: 0.05,
          vatAmount,
          totalAmount,
          journalEntryId: glEntry?.id ?? null,
          journalEntryNumber: glEntry?.number ?? null,
          reversedAt: new Date().toISOString(),
        }, { status: 200 });
      }

      // 3. Check LeaseTrafficFine
      const leaseFine = await tx.leaseTrafficFine.findFirst({
        where: {
          tenantId,
          OR: [{ id: rechargeId }, { fineNo: rechargeId }],
        },
      });

      if (leaseFine) {
        if (leaseFine.billingStatus === 'ABSORBED') {
          return NextResponse.json({ error: 'Lease traffic fine has already been reversed' }, { status: 409 });
        }

        const finePrincipal = Number(Number(leaseFine.finalAmount ?? leaseFine.fineAmount ?? 0).toFixed(2));
        const adminFee = Number(Number(body.adminFee ?? 0).toFixed(2));
        if (!Number.isFinite(adminFee) || adminFee < 0) {
          return NextResponse.json({ error: 'adminFee must be a non-negative number' }, { status: 400 });
        }
        const vatAmount = Number((adminFee * 0.05).toFixed(2));
        const totalAmount = Number((finePrincipal + adminFee + vatAmount).toFixed(2));

        await assertPeriodOpen(tx, tenantId, new Date());

        let glEntry: { id: string; number: string; created: boolean } | null = null;
        if (totalAmount > 0) {
          const lines: Array<{ code: string; name: string; description: string; debit: number; credit: number }> = [];
          if (finePrincipal > 0) {
            lines.push({
              code: '2160',
              name: 'Traffic Fines & Tolls Clearing',
              description: `Reversal of statutory fine (0% VAT) for lease fine ${leaseFine.fineNo ?? leaseFine.id}`,
              debit: finePrincipal,
              credit: 0,
            });
          }
          if (adminFee > 0) {
            lines.push({
              code: '4140',
              name: 'Fine & Violation Admin Surcharges',
              description: `Reversal of fine admin fee (5% VAT) for lease fine ${leaseFine.fineNo ?? leaseFine.id}`,
              debit: adminFee,
              credit: 0,
            });
          }
          if (vatAmount > 0) {
            lines.push({
              code: '2120',
              name: 'VAT Output Tax Payable',
              description: `Reversal of 5% VAT on admin fee for lease fine ${leaseFine.fineNo ?? leaseFine.id}`,
              debit: vatAmount,
              credit: 0,
            });
          }
          lines.push({
            code: '1132',
            name: 'Accounts Receivable — Corporate Leasing',
            description: `AR credit for reversed lease traffic fine ${leaseFine.fineNo ?? leaseFine.id}`,
            debit: 0,
            credit: totalAmount,
          });

          glEntry = await postOperationalJournalEntry(tx as any, {
            tenantId,
            entryDate: new Date().toISOString().slice(0, 10),
            narration: `Lease Traffic Fine Reversal ${leaseFine.fineNo ?? leaseFine.id} — ${reason}`,
            reference: `${leaseFine.fineNo ?? leaseFine.id}-REV`,
            sourceType: 'TRAFFIC_FINE_REVERSAL',
            sourceId: leaseFine.id,
            currency: leaseFine.currency ?? 'AED',
            preparedBy: authz.userId ?? 'system',
            idempotencyKey: `LEASE_TRAFFIC_FINE_REVERSAL:${leaseFine.id}`,
            lines,
          });
          if (!glEntry) {
            throw new Error('Failed to post lease traffic fine reversal GL entry');
          }
        }

        await tx.leaseTrafficFine.update({
          where: { id: leaseFine.id },
          data: {
            billingStatus: reopenForBilling ? 'PENDING' : 'ABSORBED',
            paymentRef: null,
            notes: leaseFine.notes ? `${leaseFine.notes}\nReversed: ${reason}` : `Reversed: ${reason}`,
          },
        });

        await logAuditInTx({
          tenantId,
          entityType: 'LeaseTrafficFine',
          entityId: leaseFine.id,
          action: 'UPDATE',
          userId: authz.userId ?? undefined,
          userRole: authz.role ?? undefined,
          details: `Reversed lease traffic fine ${leaseFine.fineNo ?? leaseFine.id}: ${reason}`,
        }, tx);

        return NextResponse.json({
          ok: true,
          reversalId: glEntry?.id ?? leaseFine.id,
          rechargeId,
          recordType: 'LeaseTrafficFine',
          status: 'REVERSED',
          fineAmount: finePrincipal,
          adminFee,
          statutoryTaxCategory: 'O',
          statutoryVatRate: 0,
          adminTaxCategory: 'S',
          adminVatRate: 0.05,
          vatAmount,
          totalAmount,
          journalEntryId: glEntry?.id ?? null,
          journalEntryNumber: glEntry?.number ?? null,
          reversedAt: new Date().toISOString(),
        }, { status: 200 });
      }

      return NextResponse.json({ error: 'Fine recharge or invoice not found' }, { status: 404 });
    });
  } catch (e: unknown) {
    const errObj = e as { statusCode?: number; message?: string };
    if (errObj?.statusCode === 422) {
      return NextResponse.json({ error: errObj.message || 'Period is locked' }, { status: 422 });
    }
    console.error('[traffic-fines/reverse]', e);
    return NextResponse.json({ error: 'Failed to reverse fine recharge' }, { status: 500 });
  }
}
