import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { AdminContext } from '@/lib/admin-auth';
import { ensureAdminApprovalTables, markAdminApprovalExecuted } from '@/lib/admin-approvals';
import { recordAdminChange } from '@/lib/admin-change-history';
import { preBillingLines } from '@/lib/leasing-billing-reconciliation';
import {
  assertFleetVehicleAssignable,
  buildLeaseVehicleDataFromFleet,
  loadFleetVehicleForLease,
  markFleetVehicleLeaseStatus,
  statusForLeaseAssignment,
} from '@/lib/leasing-vehicle-lifecycle';

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

interface ApprovalRequestRow {
  id: string;
  tenant_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: string | null;
  payload_json: unknown;
  status: ApprovalStatus;
  requested_by: string;
  execution_status: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function afterPayload(row: ApprovalRequestRow): Record<string, unknown> {
  const payload = asRecord(row.payload_json);
  return asRecord(payload.after);
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback = '') {
  return value === undefined || value === null ? fallback : String(value);
}

function dateValue(value: unknown, fallback = new Date()) {
  if (!value) return fallback;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function uniqueStatementIds(value: unknown, fallback?: unknown) {
  const ids = Array.isArray(value) ? value : fallback ? [fallback] : [];
  return [...new Set(ids.map(id => String(id ?? '').trim()).filter(Boolean))];
}

function sameValue(values: Array<string | null | undefined>) {
  const present = values.map(value => value ?? '').filter(Boolean);
  return present.length <= 1 || present.every(value => value === present[0]);
}

function preBillingRef(statement: { statementNo?: string | null; id: string }) {
  return statement.statementNo ?? statement.id;
}

async function findExistingInvoiceForPreBillingRefs(refs: string[]) {
  if (refs.length === 0) return null;
  return prisma.leaseInvoice.findFirst({
    where: {
      OR: refs.map(ref => ({ notes: { contains: `pre-billing:${ref}` } })),
    },
    select: { id: true, invoiceNo: true, notes: true },
  });
}

async function loadApprovalRequest(id: string) {
  await ensureAdminApprovalTables();
  const rows = await prisma.$queryRawUnsafe<ApprovalRequestRow[]>(
    `SELECT id::text, tenant_id, action, target_type, target_id, summary, payload_json,
            status, requested_by, execution_status
       FROM admin_approval_requests
      WHERE id = $1::uuid
      LIMIT 1`,
    id,
  ).catch(() => []);
  return rows[0] ?? null;
}

function assertExecutable(row: ApprovalRequestRow, ctx: AdminContext) {
  if (row.status !== 'APPROVED') {
    return NextResponse.json({ error: 'Approval is not approved' }, { status: 409 });
  }
  if (row.execution_status === 'EXECUTED') {
    return NextResponse.json({ error: 'Approval already executed' }, { status: 409 });
  }
  if (row.tenant_id && !ctx.isSuperAdmin && row.tenant_id !== ctx.tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!row.action.startsWith('leasing.')) {
    return NextResponse.json({ error: 'Only Leasing approvals can be executed by this endpoint' }, { status: 400 });
  }
  return null;
}

async function createPreBillingFromAggregate(row: ApprovalRequestRow) {
  const after = afterPayload(row);
  const periodFrom = dateValue(after.periodFrom);
  const periodTo = dateValue(after.periodTo);
  const billingPeriod = periodFrom.toISOString().slice(0, 7);
  const duplicate = await prisma.leasePreBillingStatement.findFirst({
    where: {
      contractId: stringValue(after.contractId, row.target_id ?? ''),
      billingPeriod,
      status: { not: 'CANCELLED' },
    },
    select: { id: true, statementNo: true },
  });
  if (duplicate) return { entityType: 'LeasePreBillingStatement', entityId: duplicate.id, result: { duplicate, skipped: true } };

  const count = await prisma.leasePreBillingStatement.count();
  const statementNo = `PBS-${String(count + 1).padStart(5, '0')}`;
  const statement = await prisma.leasePreBillingStatement.create({
    data: {
      statementNo,
      contractId: stringValue(after.contractId, row.target_id ?? ''),
      lesseeId: stringValue(after.lesseeId),
      billingPeriod,
      dueDate: new Date(periodTo.getTime() + 30 * 86400000),
      baseRent: numberValue(after.baseRent),
      fuelCharges: numberValue(after.fuelCharges),
      fineCharges: numberValue(after.fineCharges),
      maintenanceCharges: numberValue(after.maintenanceCharges),
      overageCharges: numberValue(after.overageCharges),
      otherCharges: numberValue(after.otherCharges),
      vatAmount: numberValue(after.vatAmount),
      totalAmount: numberValue(after.totalAmount),
      currency: stringValue(after.currency, 'AED'),
      status: 'DRAFT',
    },
  });
  return { entityType: 'LeasePreBillingStatement', entityId: statement.id, result: statement };
}

async function createManualPreBilling(row: ApprovalRequestRow) {
  const after = afterPayload(row);
  const contractId = stringValue(after.contractId, row.target_id ?? '');
  const billingPeriod = stringValue(after.billingPeriod);
  const contract = await prisma.leaseContract2.findUnique({ where: { id: contractId }, select: { lesseeId: true, currency: true } });
  const duplicate = await prisma.leasePreBillingStatement.findFirst({
    where: { contractId, billingPeriod, status: { not: 'CANCELLED' } },
    select: { id: true, statementNo: true },
  });
  if (duplicate) return { entityType: 'LeasePreBillingStatement', entityId: duplicate.id, result: { duplicate, skipped: true } };

  const count = await prisma.leasePreBillingStatement.count();
  const statementNo = `PBS-${String(count + 1).padStart(5, '0')}`;
  const subtotal = ['baseRent', 'fuelCharges', 'fineCharges', 'maintenanceCharges', 'overageCharges', 'otherCharges']
    .reduce((sum, key) => sum + numberValue(after[key]), 0);
  const statement = await prisma.leasePreBillingStatement.create({
    data: {
      statementNo,
      contractId,
      lesseeId: stringValue(after.lesseeId, contract?.lesseeId ?? ''),
      billingPeriod,
      dueDate: dateValue(after.dueDate),
      baseRent: numberValue(after.baseRent),
      fuelCharges: numberValue(after.fuelCharges),
      fineCharges: numberValue(after.fineCharges),
      maintenanceCharges: numberValue(after.maintenanceCharges),
      overageCharges: numberValue(after.overageCharges),
      otherCharges: numberValue(after.otherCharges),
      vatAmount: subtotal * 0.05,
      totalAmount: subtotal * 1.05,
      currency: stringValue(after.currency, contract?.currency ?? 'AED'),
      status: stringValue(after.status, 'DRAFT'),
    },
  });
  return { entityType: 'LeasePreBillingStatement', entityId: statement.id, result: statement };
}

async function updatePreBillingStatus(row: ApprovalRequestRow) {
  const after = afterPayload(row);
  const id = row.target_id ?? '';
  const before = await prisma.leasePreBillingStatement.findUnique({ where: { id } });
  const status = stringValue(after.status, before?.status ?? 'DRAFT');
  const statement = await prisma.leasePreBillingStatement.update({
    where: { id },
    data: {
      status,
      ...(status === 'SENT' ? { sentAt: new Date() } : {}),
      ...(status === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
    },
  });
  return { entityType: 'LeasePreBillingStatement', entityId: statement.id, result: { before, after: statement } };
}

async function createLeaseInvoice(row: ApprovalRequestRow) {
  const after = afterPayload(row);
  const statementIds = uniqueStatementIds(after.preBillingStatementIds, after.preBillingStatementId);
  let invoiceData = { ...after };
  let lines = Array.isArray(after.lines) ? after.lines.map(asRecord) : [];
  let preBillingNote = '';

  if (statementIds.length > 0) {
    const statements = await prisma.leasePreBillingStatement.findMany({ where: { id: { in: statementIds } } });
    if (statements.length !== statementIds.length) throw new Error('One or more pre-billing statements were not found');
    const invalid = statements.find(statement => statement.status !== 'CONFIRMED');
    if (invalid) throw new Error(`Pre-billing statement ${invalid.statementNo ?? invalid.id} must be CONFIRMED before invoicing`);
    if (!sameValue(statements.map(statement => statement.lesseeId))) {
      throw new Error('Combined invoices can only include statements for one lessee/customer');
    }
    if (!sameValue(statements.map(statement => statement.billingPeriod))) {
      throw new Error('Combined invoices can only include one billing period');
    }
    if (!sameValue(statements.map(statement => statement.currency ?? 'AED'))) {
      throw new Error('Combined invoices can only include one currency');
    }

    const refs = statements.map(preBillingRef);
    const existing = await findExistingInvoiceForPreBillingRefs(refs);
    if (existing) return { entityType: 'LeaseInvoice', entityId: existing.id, result: { duplicate: existing, skipped: true } };

    lines = statements.flatMap(statement => preBillingLines(statement).map(line => ({
      contractId: line.contractId,
      description: line.description,
      lineType: line.lineType,
      quantity: 1,
      unitAmount: line.amount,
      totalAmount: line.amount,
      currency: statement.currency ?? 'AED',
    })));
    const first = statements[0];
    invoiceData = {
      ...invoiceData,
      lesseeId: first.lesseeId,
      billingPeriod: first.billingPeriod,
      currency: first.currency ?? 'AED',
      dueDate: invoiceData.dueDate ?? statements
        .map(statement => statement.dueDate)
        .sort((a, b) => b.getTime() - a.getTime())[0],
    };
    preBillingNote = refs.map(ref => `pre-billing:${ref}`).join('\n');
  }

  const count = await prisma.leaseInvoice.count();
  const invoiceNo = `INV-${String(count + 1).padStart(6, '0')}`;
  const subTotal = lines.reduce((sum, line) => sum + numberValue(line.totalAmount), 0);
  const vatPct = numberValue(invoiceData.vatPct, 5);
  const vatAmount = subTotal * (vatPct / 100);
  const invoice = await prisma.leaseInvoice.create({
    data: {
      lesseeId: stringValue(invoiceData.lesseeId),
      billingPeriod: invoiceData.billingPeriod ? String(invoiceData.billingPeriod) : null,
      invoiceNo,
      subTotal,
      vatPct,
      vatAmount,
      totalAmount: subTotal + vatAmount,
      currency: stringValue(invoiceData.currency, 'AED'),
      status: stringValue(invoiceData.status, 'DRAFT'),
      issueDate: dateValue(invoiceData.issueDate),
      dueDate: dateValue(invoiceData.dueDate, new Date(Date.now() + 30 * 86400000)),
      notes: [invoiceData.notes ? String(invoiceData.notes) : '', preBillingNote].filter(Boolean).join('\n') || null,
      lines: {
        create: lines.map(line => ({
          contractId: line.contractId ? String(line.contractId) : null,
          vehicleRef: line.vehicleRef ? String(line.vehicleRef) : null,
          description: stringValue(line.description, 'Leasing charge'),
          lineType: stringValue(line.lineType, 'OTHER'),
          quantity: numberValue(line.quantity, 1),
          unitAmount: numberValue(line.unitAmount),
          totalAmount: numberValue(line.totalAmount, numberValue(line.quantity, 1) * numberValue(line.unitAmount)),
          currency: stringValue(line.currency, stringValue(invoiceData.currency, 'AED')),
        })),
      },
    },
    include: { lines: true },
  });
  if (statementIds.length > 0) {
    await prisma.leasePreBillingStatement.updateMany({
      where: { id: { in: statementIds } },
      data: { status: 'FINALIZED', confirmedAt: new Date() },
    }).catch(() => {});
  }
  return { entityType: 'LeaseInvoice', entityId: invoice.id, result: invoice };
}

async function updateLeaseInvoiceStatus(row: ApprovalRequestRow) {
  const after = afterPayload(row);
  const id = row.target_id ?? stringValue(after.id);
  const before = await prisma.leaseInvoice.findUnique({ where: { id }, include: { lines: true, lessee: true } });
  if (!before) throw new Error('Lease invoice not found');
  const status = stringValue(after.status, before.status ?? 'DRAFT');
  const invoice = await prisma.leaseInvoice.update({
    where: { id },
    data: {
      status,
      ...(status === 'SENT' ? { sentAt: new Date() } : {}),
      ...(status === 'PAID' ? { paidAt: new Date() } : {}),
      updatedAt: new Date(),
    },
    include: { lines: true, lessee: true },
  });
  return { entityType: 'LeaseInvoice', entityId: invoice.id, result: { before, after: invoice } };
}

async function updateLeaseContractStatus(row: ApprovalRequestRow) {
  const after = afterPayload(row);
  const id = row.target_id ?? '';
  const before = await prisma.leaseContract2.findUnique({ where: { id } });
  const contract = await prisma.leaseContract2.update({
    where: { id },
    data: { status: stringValue(after.status, before?.status ?? 'ACTIVE'), updatedAt: new Date() },
  });
  return { entityType: 'LeaseContract', entityId: contract.id, result: { before, after: contract } };
}

async function terminateLeaseContract(row: ApprovalRequestRow) {
  const id = row.target_id ?? '';
  const before = await prisma.leaseContract2.findUnique({ where: { id } });
  const contract = await prisma.leaseContract2.update({
    where: { id },
    data: { status: 'TERMINATED', deletedAt: new Date(), updatedAt: new Date() },
  });
  return { entityType: 'LeaseContract', entityId: contract.id, result: { before, after: contract } };
}

async function createVehicleExchange(row: ApprovalRequestRow) {
  const after = afterPayload(row);
  const contractId = row.target_id ?? stringValue(after.contractId);
  const tenantId = row.tenant_id ?? '';
  const contract = await prisma.leaseContract2.findUnique({
    where: { id: contractId },
    select: { id: true, status: true },
  });
  if (!contract) throw new Error('Lease contract not found');

  const incomingVehicleId = stringValue(after.incomingVehicleId);
  const incomingVehicle = incomingVehicleId ? await loadFleetVehicleForLease(incomingVehicleId, tenantId) : null;
  if (incomingVehicleId && !incomingVehicle) throw new Error('Incoming Fleet vehicle not found');
  if (incomingVehicle) {
    const assignmentError = assertFleetVehicleAssignable(incomingVehicle);
    if (assignmentError) throw new Error(assignmentError);
  }

  const exchange = await prisma.leaseVehicleExchange.create({
    data: {
      contractId,
      outgoingVehicleId: after.outgoingVehicleId ? String(after.outgoingVehicleId) : null,
      incomingVehicleId: after.incomingVehicleId ? String(after.incomingVehicleId) : null,
      exchangeDate: dateValue(after.exchangeDate),
      reason: after.reason ? String(after.reason) : null,
      approvedBy: after.approvedBy ? String(after.approvedBy) : null,
      outgoingMileage: after.outgoingMileage ? numberValue(after.outgoingMileage) : null,
      incomingMileage: after.incomingMileage ? numberValue(after.incomingMileage) : null,
      notes: after.notes ? String(after.notes) : null,
    },
  });

  if (after.outgoingVehicleId) {
    await prisma.leaseContractVehicle.updateMany({
      where: { contractId, vehicleId: String(after.outgoingVehicleId) },
      data: { status: 'EXCHANGED' },
    });
    await markFleetVehicleLeaseStatus(String(after.outgoingVehicleId), 'AVAILABLE', {
      mileage: after.outgoingMileage ? numberValue(after.outgoingMileage) : undefined,
    });
  }

  let replacement = null;
  if (incomingVehicle) {
    const monthlyRate = after.monthlyRate === undefined ? undefined : numberValue(after.monthlyRate);
    replacement = await prisma.leaseContractVehicle.create({
      data: buildLeaseVehicleDataFromFleet(incomingVehicle, contractId, monthlyRate),
    });
    await markFleetVehicleLeaseStatus(incomingVehicle.id, statusForLeaseAssignment(contract.status));
  }

  return { entityType: 'LeaseVehicleExchange', entityId: exchange.id, result: { exchange, replacement } };
}

async function createCrossBranchVehicleAssignment(row: ApprovalRequestRow) {
  const after = afterPayload(row);
  const contractId = row.target_id ?? stringValue(after.contractId);
  const vehicleId = stringValue(after.vehicleId);
  const tenantId = row.tenant_id ?? '';
  if (!contractId || !vehicleId || !tenantId) throw new Error('Missing contract, vehicle, or tenant for assignment');

  const contract = await prisma.leaseContract2.findUnique({
    where: { id: contractId },
    select: { id: true, status: true },
  });
  if (!contract) throw new Error('Lease contract not found');

  const existingAssignment = await prisma.leaseContractVehicle.findFirst({
    where: {
      vehicleId,
      status: { in: ['ACTIVE', 'ASSIGNED'] },
      contract: { status: { in: ['DRAFT', 'ACTIVE', 'PENDING', 'SUSPENDED'] }, deletedAt: null },
    },
    select: { id: true, contractId: true },
  });
  if (existingAssignment) {
    return {
      entityType: 'LeaseContractVehicle',
      entityId: existingAssignment.id,
      result: { duplicate: existingAssignment, skipped: true },
    };
  }

  const fleetVehicle = await loadFleetVehicleForLease(vehicleId, tenantId);
  const assignmentError = assertFleetVehicleAssignable(fleetVehicle);
  if (assignmentError || !fleetVehicle) throw new Error(assignmentError ?? 'Vehicle is not assignable');
  const monthlyRate = after.monthlyRate === undefined ? undefined : numberValue(after.monthlyRate);

  const assignment = await prisma.leaseContractVehicle.create({
    data: buildLeaseVehicleDataFromFleet(fleetVehicle, contractId, monthlyRate),
  });
  await markFleetVehicleLeaseStatus(vehicleId, statusForLeaseAssignment(contract.status));

  return { entityType: 'LeaseContractVehicle', entityId: assignment.id, result: assignment };
}

export async function executeLeasingApproval(req: NextRequest, ctx: AdminContext, approvalId: string) {
  const row = await loadApprovalRequest(approvalId);
  if (!row) return NextResponse.json({ error: 'Approval request not found' }, { status: 404 });
  const guard = assertExecutable(row, ctx);
  if (guard) return guard;

  const before = row;
  let execution: { entityType: string; entityId: string; result: unknown };
  switch (row.action) {
    case 'leasing.prebilling.commit':
      execution = await createPreBillingFromAggregate(row);
      break;
    case 'leasing.prebilling.create':
      execution = await createManualPreBilling(row);
      break;
    case 'leasing.prebilling.status_change':
      execution = await updatePreBillingStatus(row);
      break;
    case 'leasing.invoice.create':
      execution = await createLeaseInvoice(row);
      break;
    case 'leasing.invoice.status_change':
      execution = await updateLeaseInvoiceStatus(row);
      break;
    case 'leasing.contract.status_change':
      execution = await updateLeaseContractStatus(row);
      break;
    case 'leasing.contract.terminate':
      execution = await terminateLeaseContract(row);
      break;
    case 'leasing.vehicle_exchange.create':
      execution = await createVehicleExchange(row);
      break;
    case 'leasing.vehicle_assignment.cross_branch':
      execution = await createCrossBranchVehicleAssignment(row);
      break;
    default:
      return NextResponse.json({ error: `Unsupported Leasing approval action: ${row.action}` }, { status: 400 });
  }

  await markAdminApprovalExecuted(req, ctx, approvalId, {
    action: row.action,
    entityType: execution.entityType,
    entityId: execution.entityId,
    result: execution.result,
    executedFrom: 'admin-approvals-queue',
  });
  await recordAdminChange({
    req,
    ctx,
    tenantId: row.tenant_id ?? ctx.tenantId,
    entityType: execution.entityType,
    entityId: execution.entityId,
    action: 'EXECUTE_APPROVED_LEASING_ACTION',
    before,
    after: execution.result,
    summary: `Executed approved Leasing action ${row.action}: ${row.summary ?? approvalId}`,
  });

  return NextResponse.json({
    ok: true,
    approvalId,
    action: row.action,
    entityType: execution.entityType,
    entityId: execution.entityId,
    result: execution.result,
  });
}
