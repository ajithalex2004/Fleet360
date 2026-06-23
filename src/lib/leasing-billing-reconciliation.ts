import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { OperationalContext } from '@/lib/cross-module-governance';
import { leaseContractIdsForTenant, requireLeaseContractInTenant } from '@/lib/leasing-governance';

export type LeaseBillingLineType = 'RENT' | 'FUEL' | 'FINE' | 'OVERAGE' | 'MAINTENANCE' | 'OTHER';

export interface LeaseBillingLine {
  lineType: LeaseBillingLineType;
  description: string;
  amount: number;
  contractId?: string | null;
}

export async function scopedLeaseContractIds(ctx: OperationalContext) {
  return leaseContractIdsForTenant(ctx.tenantId, { activeOnly: true });
}

export async function assertContractBillingScope(contractId: string, ctx: OperationalContext) {
  return requireLeaseContractInTenant(contractId, ctx);
}

export async function preBillingStatementInTenant(statementId: string, ctx: OperationalContext) {
  const statement = await prisma.leasePreBillingStatement.findUnique({ where: { id: statementId } });
  if (!statement) return { error: NextResponse.json({ error: 'Pre-billing statement not found' }, { status: 404 }) };
  const boundary = await assertContractBillingScope(statement.contractId, ctx);
  if (boundary) return { error: boundary };
  return { statement };
}

export async function leaseInvoiceInTenant(invoiceId: string, ctx: OperationalContext) {
  const invoice = await prisma.leaseInvoice.findUnique({
    where: { id: invoiceId },
    include: { lines: true, lessee: true },
  });
  if (!invoice) return { error: NextResponse.json({ error: 'Invoice not found' }, { status: 404 }) };
  const contractIds = Array.from(new Set(invoice.lines.map(line => line.contractId).filter(Boolean))) as string[];
  if (contractIds.length === 0) {
    return { error: NextResponse.json({ error: 'Invoice has no contract scope' }, { status: 409 }) };
  }
  for (const contractId of contractIds) {
    const boundary = await assertContractBillingScope(contractId, ctx);
    if (boundary) return { error: boundary };
  }
  return { invoice };
}

export function preBillingLines(statement: {
  contractId: string;
  baseRent: unknown;
  fuelCharges?: unknown;
  fineCharges?: unknown;
  maintenanceCharges?: unknown;
  overageCharges?: unknown;
  otherCharges?: unknown;
  statementNo?: string | null;
  billingPeriod?: string | null;
}): LeaseBillingLine[] {
  const period = statement.billingPeriod ? ` (${statement.billingPeriod})` : '';
  const source = statement.statementNo ? ` from ${statement.statementNo}` : '';
  const candidates: LeaseBillingLine[] = [
    { lineType: 'RENT', description: `Base rent${period}${source}`, amount: Number(statement.baseRent ?? 0), contractId: statement.contractId },
    { lineType: 'FUEL', description: `Fuel charges${period}${source}`, amount: Number(statement.fuelCharges ?? 0), contractId: statement.contractId },
    { lineType: 'FINE', description: `Traffic fine charges${period}${source}`, amount: Number(statement.fineCharges ?? 0), contractId: statement.contractId },
    { lineType: 'OVERAGE', description: `Mileage overage charges${period}${source}`, amount: Number(statement.overageCharges ?? 0), contractId: statement.contractId },
    { lineType: 'MAINTENANCE', description: `Maintenance charges${period}${source}`, amount: Number(statement.maintenanceCharges ?? 0), contractId: statement.contractId },
    { lineType: 'OTHER', description: `Other charges${period}${source}`, amount: Number(statement.otherCharges ?? 0), contractId: statement.contractId },
  ];
  return candidates.filter(line => line.amount > 0);
}

export async function hasInvoiceForPreBilling(statementNo?: string | null) {
  if (!statementNo) return false;
  const existing = await prisma.leaseInvoice.findFirst({
    where: { notes: { contains: `pre-billing:${statementNo}` } },
    select: { id: true },
  });
  return Boolean(existing);
}
