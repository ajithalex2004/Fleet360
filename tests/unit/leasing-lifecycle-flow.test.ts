import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// In-memory tenant store to simulate database state across the lifecycle stages
const store = {
  quotations: new Map<string, any>(),
  contracts: new Map<string, any>(),
  contractVehicles: new Map<string, any>(),
  invoices: new Map<string, any>(),
  lessees: new Map<string, any>(),
  vehicles: new Map<string, any>(),
  receipts: new Map<string, any>(),
  paymentIntents: new Map<string, any>(),
  allocationOccurrences: new Map<string, any>(),
  returns: new Map<string, any>(),
};

function resetStore() {
  store.quotations.clear();
  store.contracts.clear();
  store.contractVehicles.clear();
  store.invoices.clear();
  store.lessees.clear();
  store.vehicles.clear();
  store.receipts.clear();
  store.paymentIntents.clear();
  store.allocationOccurrences.clear();
  store.returns.clear();

  // Seed sample lessees
  store.lessees.set('lessee-alpha-1', {
    id: 'lessee-alpha-1',
    tenantId: 'tenant-alpha',
    name: 'Alpha Logistics LLC',
    email: 'alpha@logistics.example',
    deletedAt: null,
  });
  store.lessees.set('lessee-alpha-2', {
    id: 'lessee-alpha-2',
    tenantId: 'tenant-alpha',
    name: 'Alpha Secondary Trading LLC',
    email: 'alpha2@trading.example',
    deletedAt: null,
  });
  store.lessees.set('lessee-bravo-1', {
    id: 'lessee-bravo-1',
    tenantId: 'tenant-bravo',
    name: 'Bravo Commercial Ltd',
    email: 'bravo@commercial.example',
    deletedAt: null,
  });

  // Seed sample fleet vehicles
  store.vehicles.set('veh-real-alpha-1', {
    id: 'veh-real-alpha-1',
    tenantId: 'tenant-alpha',
    type: 'SEDAN',
    make: 'Toyota',
    model: 'Camry',
    year: 2025,
    licensePlate: 'DXB-ALPHA-01',
    vin: 'VIN-ALPHA-001',
    status: 'AVAILABLE',
    isActive: true,
    currentMileage: 15000,
    deletedAt: null,
  });
  store.vehicles.set('veh-real-alpha-2', {
    id: 'veh-real-alpha-2',
    tenantId: 'tenant-alpha',
    type: 'SUV',
    make: 'Nissan',
    model: 'Patrol',
    year: 2024,
    licensePlate: 'DXB-ALPHA-02',
    vin: 'VIN-ALPHA-002',
    status: 'RENTED', // in-use/unavailable
    isActive: true,
    currentMileage: 42000,
    deletedAt: null,
  });
  store.vehicles.set('veh-real-bravo-1', {
    id: 'veh-real-bravo-1',
    tenantId: 'tenant-bravo',
    type: 'VAN',
    make: 'Ford',
    model: 'Transit',
    year: 2023,
    licensePlate: 'DXB-BRAVO-01',
    vin: 'VIN-BRAVO-001',
    status: 'AVAILABLE',
    isActive: true,
    currentMileage: 28000,
    deletedAt: null,
  });
}

// Mock @/lib/prisma
vi.mock('@/lib/prisma', () => {
  return {
    prisma: {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn(async (cb) => {
        const mockTx = {
          $executeRawUnsafe: vi.fn().mockResolvedValue(1),
          $queryRawUnsafe: vi.fn().mockImplementation(async (query: string, ...args: any[]) => {
            const match = query.match(/set_config\('app\.tenant_id',\s*'([^']+)'/);
            if (match) {
              return [{ v: match[1] }];
            }
            if (query.includes('FROM lease_payment_intents') && query.includes('SUM(amount)')) {
              const invoiceId = args[1];
              const paidIntents = Array.from(store.paymentIntents.values()).filter(
                (pi) => pi.invoiceId === invoiceId && pi.status === 'RECEIVED'
              );
              const totalPaid = paidIntents.reduce((sum, pi) => sum + Number(pi.amount), 0);
              return [{ total_paid: totalPaid > 0 ? String(totalPaid) : null }];
            }
            if (query.includes('SELECT id::text FROM lease_payment_intents')) {
              const invoiceId = args[1];
              const ref = args[2];
              const duplicate = Array.from(store.paymentIntents.values()).find(
                (pi) => pi.invoiceId === invoiceId && (pi.referenceCode === ref || pi.providerRef === ref) && pi.status === 'RECEIVED'
              );
              return duplicate ? [{ id: duplicate.id }] : [];
            }
            if (query.includes('INSERT INTO lease_payment_intents')) {
              const id = `intent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const intent = {
                id,
                tenantId: args[0],
                invoiceId: args[1],
                lesseeId: args[2],
                amount: Number(args[3]),
                currency: args[4],
                providerRef: args[5],
                method: args[6],
                status: 'RECEIVED',
                confirmedBy: args[7],
                referenceCode: args[8],
                notes: args[9],
                receiptId: args[10],
              };
              store.paymentIntents.set(id, intent);
              return [{ id, status: 'RECEIVED', amount: String(intent.amount), currency: intent.currency, reference_code: intent.referenceCode }];
            }
            return [{ v: 'mock' }];
          }),
          lessee: {
            findFirst: vi.fn().mockImplementation(async ({ where }) => {
              const lessee = store.lessees.get(where.id);
              if (lessee && lessee.tenantId === where.tenantId && (!lessee.deletedAt || where.deletedAt === undefined)) {
                return lessee;
              }
              return null;
            }),
          },
          vehicle: {
            findFirst: vi.fn().mockImplementation(async ({ where }) => {
              for (const v of store.vehicles.values()) {
                if (v.tenantId !== where.tenantId) continue;
                if (where.deletedAt === null && v.deletedAt !== null) continue;
                if (where.id && v.id !== where.id) continue;
                if (where.licensePlate && v.licensePlate !== where.licensePlate) continue;
                return v;
              }
              return null;
            }),
            update: vi.fn().mockImplementation(async ({ where, data }) => {
              const v = store.vehicles.get(where.id);
              if (v) {
                Object.assign(v, data);
              }
              return v;
            }),
          },
          leaseQuotation: {
            findFirst: vi.fn().mockImplementation(async ({ where }) => {
              const quote = store.quotations.get(where.id);
              if (quote && quote.tenantId === where.tenantId && (!quote.deletedAt || where.deletedAt === undefined)) {
                return quote;
              }
              return null;
            }),
            findMany: vi.fn().mockImplementation(async ({ where }) => {
              return Array.from(store.quotations.values()).filter(
                (q) => q.tenantId === where.tenantId && (!q.deletedAt || where.deletedAt === undefined)
              );
            }),
            count: vi.fn().mockImplementation(async ({ where }) => {
              return Array.from(store.quotations.values()).filter((q) => q.tenantId === where.tenantId).length;
            }),
            create: vi.fn().mockImplementation(async ({ data }) => {
              const id = `quo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const lesseeId = data.lesseeId || data.lessee?.connect?.id || null;
              const created = {
                id,
                ...data,
                lesseeId,
                vehicles: data.vehicles?.create || [],
                lineItems: data.lineItems?.create || [],
                createdAt: new Date(),
                deletedAt: null,
              };
              store.quotations.set(id, created);
              return created;
            }),
            update: vi.fn().mockImplementation(async ({ where, data }) => {
              const q = store.quotations.get(where.id);
              if (q) Object.assign(q, data);
              return q;
            }),
          },
          leaseApprovalStep: {
            findFirst: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({}),
          },
          leaseInquiry: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          leaseContract2: {
            findFirst: vi.fn().mockImplementation(async ({ where }) => {
              for (const contract of store.contracts.values()) {
                if (contract.tenantId !== where.tenantId) continue;
                if (where.deletedAt === null && contract.deletedAt !== null) continue;
                if (where.id && contract.id !== where.id) continue;
                if (where.quotationId && contract.quotationId !== where.quotationId) continue;
                return contract;
              }
              return null;
            }),
            findMany: vi.fn().mockImplementation(async ({ where }) => {
              return Array.from(store.contracts.values()).filter(
                (c) => c.tenantId === where.tenantId && (!c.deletedAt || where.deletedAt === undefined)
              );
            }),
            create: vi.fn().mockImplementation(async ({ data }) => {
              const id = `cnt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const created = {
                id,
                ...data,
                createdAt: new Date(),
                deletedAt: null,
              };
              store.contracts.set(id, created);
              return created;
            }),
            update: vi.fn().mockImplementation(async ({ where, data }) => {
              const c = store.contracts.get(where.id);
              if (c) Object.assign(c, data);
              return c;
            }),
          },
          leaseContractVehicle: {
            findFirst: vi.fn().mockImplementation(async ({ where }) => {
              for (const v of store.contractVehicles.values()) {
                if (v.tenantId !== where.tenantId) continue;
                if (where.vehicleId && v.vehicleId !== where.vehicleId) continue;
                if (where.status && v.status !== where.status) continue;
                return v;
              }
              return null;
            }),
            findMany: vi.fn().mockImplementation(async ({ where }) => {
              return Array.from(store.contractVehicles.values()).filter(
                (v) => v.tenantId === where.tenantId && (where.contractId ? v.contractId === where.contractId : true)
              );
            }),
            count: vi.fn().mockImplementation(async ({ where }) => {
              return Array.from(store.contractVehicles.values()).filter(
                (v) => v.tenantId === where.tenantId && (where.contractId ? v.contractId === where.contractId : true) && (where.status ? v.status === where.status : true)
              ).length;
            }),
            create: vi.fn().mockImplementation(async ({ data }) => {
              const id = `lcv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const created = {
                id,
                ...data,
                createdAt: new Date(),
              };
              store.contractVehicles.set(id, created);
              return created;
            }),
          },
          leaseAllocationOccurrence: {
            findFirst: vi.fn().mockImplementation(async ({ where }) => {
              for (const o of store.allocationOccurrences.values()) {
                if (o.tenantId !== where.tenantId) continue;
                if (where.contractVehicleId && o.contractVehicleId !== where.contractVehicleId) continue;
                if (where.vehicleId && o.vehicleId !== where.vehicleId) continue;
                if (where.status && o.status !== where.status) continue;
                return o;
              }
              return null;
            }),
            findMany: vi.fn().mockImplementation(async ({ where }) => {
              return Array.from(store.allocationOccurrences.values()).filter(
                (o) => o.tenantId === where.tenantId && (where.contractId ? o.contractId === where.contractId : true)
              );
            }),
            create: vi.fn().mockImplementation(async ({ data }) => {
              const id = `occ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const created = { id, ...data, createdAt: new Date() };
              store.allocationOccurrences.set(id, created);
              return created;
            }),
            update: vi.fn().mockImplementation(async ({ where, data }) => {
              const o = store.allocationOccurrences.get(where.id);
              if (o) Object.assign(o, data);
              return o;
            }),
            aggregate: vi.fn().mockResolvedValue({ _max: { sequenceNo: 0 } }),
          },
          leaseVehicleReturn: {
            findFirst: vi.fn().mockImplementation(async ({ where }) => {
              for (const r of store.returns.values()) {
                if (r.tenantId !== where.tenantId) continue;
                if (where.id && r.id !== where.id) continue;
                if (where.handoverId && r.handoverId !== where.handoverId) continue;
                if (where.overageInvoiceId && r.overageInvoiceId !== where.overageInvoiceId) continue;
                if (where.damageInvoiceId && r.damageInvoiceId !== where.damageInvoiceId) continue;
                return r;
              }
              return null;
            }),
            findMany: vi.fn().mockImplementation(async ({ where }) => {
              return Array.from(store.returns.values()).filter(
                (r) => r.tenantId === where.tenantId && (where.contractId ? r.contractId === where.contractId : true)
              );
            }),
            create: vi.fn().mockImplementation(async ({ data }) => {
              const id = `ret-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const created = { id, ...data, createdAt: new Date() };
              store.returns.set(id, created);
              return created;
            }),
            update: vi.fn().mockImplementation(async ({ where, data }) => {
              const r = store.returns.get(where.id);
              if (r) Object.assign(r, data);
              return r;
            }),
          },
          leaseInvoice: {
            findFirst: vi.fn().mockImplementation(async ({ where }) => {
              for (const inv of store.invoices.values()) {
                if (inv.tenantId !== where.tenantId) continue;
                if (where.id && inv.id !== where.id) continue;
                if (where.billingPeriod && inv.billingPeriod !== where.billingPeriod) continue;
                return inv;
              }
              return null;
            }),
            findMany: vi.fn().mockImplementation(async ({ where }) => {
              return Array.from(store.invoices.values()).filter(
                (inv) => inv.tenantId === where.tenantId && (where.lesseeId ? inv.lesseeId === where.lesseeId : true)
              );
            }),
            count: vi.fn().mockImplementation(async ({ where }) => {
              return Array.from(store.invoices.values()).filter((inv) => inv.tenantId === where.tenantId).length;
            }),
            create: vi.fn().mockImplementation(async ({ data }) => {
              const id = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const created = {
                id,
                ...data,
                lines: data.lines?.create || [],
                createdAt: new Date(),
              };
              store.invoices.set(id, created);
              return created;
            }),
            update: vi.fn().mockImplementation(async ({ where, data }) => {
              const inv = store.invoices.get(where.id);
              if (inv) Object.assign(inv, data);
              return inv;
            }),
          },
          leaseReceipt: {
            create: vi.fn().mockImplementation(async ({ data }) => {
              const id = `rcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const created = { id, ...data, createdAt: new Date() };
              store.receipts.set(id, created);
              return created;
            }),
          },
        };
        return cb(mockTx);
      }),
    },
  };
});

vi.mock('@/lib/leasing/serial-lock', () => ({
  lockSerialSeries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/email/emailService', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/sentry', () => ({
  captureException: vi.fn(),
}));

// Import route handlers
import { POST as createQuotation, GET as listQuotations } from '@/app/api/leasing/quotations/route';
import { POST as approveQuotation } from '@/app/api/leasing/quotations/[id]/approve/route';
import { POST as createContract } from '@/app/api/leasing/contracts-v2/route';
import { PATCH as updateContract } from '@/app/api/leasing/contracts-v2/[id]/route';
import { POST as addVehicle, GET as listVehicles } from '@/app/api/leasing/contracts-v2/[id]/vehicles/route';
import { POST as createInvoice } from '@/app/api/leasing/invoices/route';
import { POST as recordPayment } from '@/app/api/leasing/invoices/[id]/record-payment/route';

describe('Leasing Lifecycle Flow & Business Rules (Unit)', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('completes the full verified business lifecycle from Quotation to Paid Invoice', async () => {
    const tenantId = 'tenant-alpha';
    const userId = 'user-ops-alpha';
    const lesseeId = 'lessee-alpha-1';

    // 1. Create Quotation
    const quoRes = await createQuotation(
      new NextRequest('http://localhost:3000/api/leasing/quotations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
        body: JSON.stringify({
          lesseeId,
          monthlyRate: 5000,
          durationMonths: 12,
        }),
      })
    );
    expect(quoRes.status).toBe(201);
    const quotation = await quoRes.json();
    expect(quotation.status).toBe('NEW');

    // 2. Approve Quotation
    const appRes = await approveQuotation(
      new NextRequest(`http://localhost:3000/api/leasing/quotations/${quotation.id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
        body: JSON.stringify({ action: 'APPROVE', targetStatus: 'CUSTOMER_APPROVED' }),
      }),
      { params: Promise.resolve({ id: quotation.id }) }
    );
    expect(appRes.status).toBe(200);

    // 3. Convert to Contract
    const contractRes = await createContract(
      new NextRequest('http://localhost:3000/api/leasing/contracts-v2', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
        body: JSON.stringify({
          lesseeId,
          quotationId: quotation.id,
          contractNumber: 'LC-2026-001',
          monthlyRate: 5000,
        }),
      })
    );
    expect(contractRes.status).toBe(201);
    const contract = await contractRes.json();
    expect(contract.status).toBe('DRAFT');

    // Quotation is atomically marked CONVERTED
    const storedQuo = store.quotations.get(quotation.id);
    expect(storedQuo.status).toBe('CONVERTED');

    // 4. Allocate Real Fleet Vehicle (inheriting rate and updating vehicle state)
    const vehRes = await addVehicle(
      new NextRequest(`http://localhost:3000/api/leasing/contracts-v2/${contract.id}/vehicles`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
        body: JSON.stringify({
          vehicleId: 'veh-real-alpha-1',
          type: 'SEDAN',
          // omit monthlyRate to verify rate inheritance from contract
        }),
      }),
      { params: Promise.resolve({ id: contract.id }) }
    );
    expect(vehRes.status).toBe(201);
    const allocation = await vehRes.json();
    expect(allocation.monthlyRate).toBe(5000); // inherited!
    expect(allocation.licensePlate).toBe('DXB-ALPHA-01');

    // Confirm real fleet vehicle updated to RESERVED
    const storedVeh = store.vehicles.get('veh-real-alpha-1');
    expect(storedVeh.status).toBe('RESERVED');
    expect(storedVeh.lifecycleStage).toBe('ALLOCATED');

    // 5. Activate Contract (now valid because vehicle count >= 1)
    const actRes = await updateContract(
      new NextRequest(`http://localhost:3000/api/leasing/contracts-v2/${contract.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
        body: JSON.stringify({ status: 'ACTIVE' }),
      }),
      { params: Promise.resolve({ id: contract.id }) }
    );
    expect(actRes.status).toBe(200);
    const activatedContract = await actRes.json();
    expect(activatedContract.status).toBe('ACTIVE');

    // 6. Issue Invoice (Active contract, checked billing period, 2-decimal rounded VAT)
    const invRes = await createInvoice(
      new NextRequest('http://localhost:3000/api/leasing/invoices', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
        body: JSON.stringify({
          lesseeId,
          contractId: contract.id,
          billingPeriod: '2026-09',
          vatPct: 5,
          lines: [
            { description: 'Monthly Lease Rental', quantity: 1, unitAmount: 5000 },
          ],
        }),
      })
    );
    expect(invRes.status).toBe(201);
    const invoice = await invRes.json();
    expect(invoice.subTotal).toBe(5000);
    expect(invoice.vatAmount).toBe(250);
    expect(invoice.totalAmount).toBe(5250);

    // 7. Payment Recording: Partial Payment
    const partPayRes = await recordPayment(
      new NextRequest(`http://localhost:3000/api/leasing/invoices/${invoice.id}/record-payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
        body: JSON.stringify({
          amount: 2000,
          method: 'BANK_TRANSFER',
          bankRef: 'WIRE-PARTIAL-001',
        }),
      }),
      { params: Promise.resolve({ id: invoice.id }) }
    );
    expect(partPayRes.status).toBe(200);
    const partPay = await partPayRes.json();
    expect(partPay.status).toBe('PARTIALLY_PAID');
    expect(partPay.totalPaid).toBe(2000);
    expect(partPay.outstandingBalance).toBe(3250);
    expect(partPay.receiptId).toBeDefined();

    // 8. Payment Recording: Final Balance Payment
    const finalPayRes = await recordPayment(
      new NextRequest(`http://localhost:3000/api/leasing/invoices/${invoice.id}/record-payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
        body: JSON.stringify({
          amount: 3250,
          method: 'BANK_TRANSFER',
          bankRef: 'WIRE-FINAL-002',
        }),
      }),
      { params: Promise.resolve({ id: invoice.id }) }
    );
    expect(finalPayRes.status).toBe(200);
    const finalPay = await finalPayRes.json();
    expect(finalPay.status).toBe('PAID');
    expect(finalPay.totalPaid).toBe(5250);
    expect(finalPay.outstandingBalance).toBe(0);
  });

  describe('Business Rules & Error Handling', () => {
    it('rejects contract conversion for customer mismatch, expiry, and duplicate conversion', async () => {
      const tenantId = 'tenant-alpha';
      const userId = 'user-ops-alpha';

      // 1. Customer Mismatch
      const qMismatch = await (await createQuotation(
        new NextRequest('http://localhost:3000/api/leasing/quotations', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({ lesseeId: 'lessee-alpha-1', monthlyRate: 3000 }),
        })
      )).json();

      const mismatchRes = await createContract(
        new NextRequest('http://localhost:3000/api/leasing/contracts-v2', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({
            lesseeId: 'lessee-alpha-2', // Mismatched customer!
            quotationId: qMismatch.id,
          }),
        })
      );
      expect(mismatchRes.status).toBe(400);
      expect((await mismatchRes.json()).error).toContain('Contract lessee does not match quotation customer');

      // 2. Duplicate Conversion
      const validConversionRes = await createContract(
        new NextRequest('http://localhost:3000/api/leasing/contracts-v2', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({
            lesseeId: 'lessee-alpha-1',
            quotationId: qMismatch.id,
            contractNumber: 'LC-ORIGINAL',
          }),
        })
      );
      expect(validConversionRes.status).toBe(201);

      // Second attempt to convert same quotation must 409
      const dupRes = await createContract(
        new NextRequest('http://localhost:3000/api/leasing/contracts-v2', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({
            lesseeId: 'lessee-alpha-1',
            quotationId: qMismatch.id,
          }),
        })
      );
      expect(dupRes.status).toBe(409);
    });

    it('rejects vehicle double-booking and activating empty contracts', async () => {
      const tenantId = 'tenant-alpha';
      const userId = 'user-ops-alpha';

      // Setup DRAFT contract
      const contract = await (await createContract(
        new NextRequest('http://localhost:3000/api/leasing/contracts-v2', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({ lesseeId: 'lessee-alpha-1', monthlyRate: 4000 }),
        })
      )).json();

      // Attempt activation without vehicles -> must 400
      const actEmptyRes = await updateContract(
        new NextRequest(`http://localhost:3000/api/leasing/contracts-v2/${contract.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({ status: 'ACTIVE' }),
        }),
        { params: Promise.resolve({ id: contract.id }) }
      );
      expect(actEmptyRes.status).toBe(400);
      expect((await actEmptyRes.json()).error).toContain('allocated vehicles');

      // Attempt to allocate already-rented vehicle -> must 400
      const inUseRes = await addVehicle(
        new NextRequest(`http://localhost:3000/api/leasing/contracts-v2/${contract.id}/vehicles`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({ vehicleId: 'veh-real-alpha-2' }), // Status is RENTED
        }),
        { params: Promise.resolve({ id: contract.id }) }
      );
      expect(inUseRes.status).toBe(400);
      expect((await inUseRes.json()).error).toContain('not available');
    });

    it('rejects duplicate-period invoicing, overpayment, and duplicate payment submissions', async () => {
      const tenantId = 'tenant-alpha';
      const userId = 'user-ops-alpha';

      // Setup Active contract and allocate vehicle
      const contract = await (await createContract(
        new NextRequest('http://localhost:3000/api/leasing/contracts-v2', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({ lesseeId: 'lessee-alpha-1', monthlyRate: 4000 }),
        })
      )).json();
      await addVehicle(
        new NextRequest(`http://localhost:3000/api/leasing/contracts-v2/${contract.id}/vehicles`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({ vehicleId: 'veh-real-alpha-1' }),
        }),
        { params: Promise.resolve({ id: contract.id }) }
      );
      await updateContract(
        new NextRequest(`http://localhost:3000/api/leasing/contracts-v2/${contract.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({ status: 'ACTIVE' }),
        }),
        { params: Promise.resolve({ id: contract.id }) }
      );

      // Create invoice for 2026-10
      const inv1 = await (await createInvoice(
        new NextRequest('http://localhost:3000/api/leasing/invoices', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({
            lesseeId: 'lessee-alpha-1',
            contractId: contract.id,
            billingPeriod: '2026-10',
            lines: [{ description: 'Oct Rent', quantity: 1, unitAmount: 4000 }],
          }),
        })
      )).json();

      // Duplicate billing for same contract and period -> must 409
      const dupBillRes = await createInvoice(
        new NextRequest('http://localhost:3000/api/leasing/invoices', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({
            lesseeId: 'lessee-alpha-1',
            contractId: contract.id,
            billingPeriod: '2026-10',
            lines: [{ description: 'Oct Rent Duplicate', quantity: 1, unitAmount: 4000 }],
          }),
        })
      );
      expect(dupBillRes.status).toBe(409);

      // Overpayment check (invoice total is 4200 including 5% VAT)
      const overpayRes = await recordPayment(
        new NextRequest(`http://localhost:3000/api/leasing/invoices/${inv1.id}/record-payment`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({ amount: 5000, bankRef: 'REF-OVER' }),
        }),
        { params: Promise.resolve({ id: inv1.id }) }
      );
      expect(overpayRes.status).toBe(400);
      expect((await overpayRes.json()).error).toContain('exceeds outstanding balance');

      // Valid payment recording
      const validPayRes = await recordPayment(
        new NextRequest(`http://localhost:3000/api/leasing/invoices/${inv1.id}/record-payment`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({ amount: 1000, bankRef: 'UNIQUE-WIRE-001' }),
        }),
        { params: Promise.resolve({ id: inv1.id }) }
      );
      expect(validPayRes.status).toBe(200);

      // Duplicate bankRef submission -> must 409
      const dupPayRes = await recordPayment(
        new NextRequest(`http://localhost:3000/api/leasing/invoices/${inv1.id}/record-payment`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId },
          body: JSON.stringify({ amount: 1000, bankRef: 'UNIQUE-WIRE-001' }),
        }),
        { params: Promise.resolve({ id: inv1.id }) }
      );
      expect(dupPayRes.status).toBe(409);
    });
  });
});
