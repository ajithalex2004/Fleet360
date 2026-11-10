import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Invoices, quotations, job cards and proofs of delivery wait for a person:
// nothing is written until approval, and approval writes the real record
// from the stored extraction plus the reviewer's corrections.
const h = vi.hoisted(() => ({
  vehicleFindFirst: vi.fn(async () => null),
  vehicleUpdate: vi.fn(async () => ({})),
  stored: null as Record<string, unknown> | null,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  writes: [] as Array<{ sql: string; params: unknown[] }>,
  answer: ((): unknown[] => []) as (sql: string, params: unknown[]) => unknown[],
  submitPod: vi.fn(async () => ({ ok: true })),
}));

vi.mock('next/server', async () => await import('next/server.js'));

const tx = {
  $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
    h.queries.push({ sql, params });
    if (/FROM document_intelligence_extractions/.test(sql)) return h.stored ? [h.stored] : [];
    return h.answer(sql, params);
  }),
  $executeRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
    h.writes.push({ sql, params });
    return 1;
  }),
};

vi.mock('@/lib/prisma', () => ({
  prisma: { vehicle: { findFirst: h.vehicleFindFirst, update: h.vehicleUpdate }, driver: { findFirst: vi.fn(async () => null) } },
}));
vi.mock('@/lib/rls', () => ({ withTenantRls: vi.fn((_p: unknown, _t: string, fn: (t: unknown) => unknown) => fn(tx)) }));
vi.mock('@/lib/agents/schema', () => ({ ensureAgentSchema: vi.fn(async () => undefined) }));
vi.mock('@/lib/agents/document-intelligence/pipeline/webhook-dispatcher', () => ({ dispatchDocumentWebhook: vi.fn(async () => []) }));
vi.mock('@/lib/audit', () => ({ logAuditInTx: vi.fn(async () => undefined), logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/finance/payable-number', () => ({ nextPayableNumber: vi.fn(async () => 'AP-202611-00001') }));
vi.mock('@/lib/logistics/drayage-domain', () => ({ submitJobPodEvidence: h.submitPod }));
vi.mock('@/lib/tenant-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tenant-context')>();
  return { ...actual, requireAuthorizedTenant: vi.fn(() => ({ ok: true, tenantId: 'tenant-a', userId: 'u-1', role: 'ADMIN' })) };
});

const { autoPopulateFleet360Record } = await import('@/lib/agents/document-intelligence/auto-populator');
const { POST } = await import('@/app/api/documents/intelligence/apply/route');

const invoice = {
  docCategory: 'TAX_INVOICE',
  suggestedTitle: 'Tax invoice',
  confidence: 'HIGH',
  confidenceScore: 0.9,
  summary: 'Spare parts',
  referenceNumber: 'INV-2026-88129',
  issueDate: '2026-11-01',
  supplier: { name: 'Al Futtaim Spares', trnNumber: '100234567800003' },
  financials: { subtotalAed: 1000, vatAmountAed: 50, totalAmountAed: 1050, currency: 'AED' },
  vehicle: { licensePlate: 'DXB-A-12345' },
};

const approve = (body: Record<string, unknown>) =>
  POST(new NextRequest('http://localhost/api/documents/intelligence/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.stored = null;
  h.queries = [];
  h.writes = [];
  h.answer = () => [];
});

describe('staged documents are never auto-applied', () => {
  it.each(['INVOICE', 'TAX_INVOICE', 'QUOTATION', 'MAINTENANCE_REPORT', 'PROOF_OF_DELIVERY'])('%s waits for review, writes nothing and invents no id', async (cat) => {
    const res = await autoPopulateFleet360Record('tenant-a', { ...invoice, docCategory: cat } as never);
    expect(res.success).toBe(false);
    expect(res.staged).toBe(true);
    expect(res.linkedEntityId).toBeUndefined();
    // An invoice that mentions a plate no longer updates the vehicle.
    expect(h.vehicleFindFirst).not.toHaveBeenCalled();
    expect(h.vehicleUpdate).not.toHaveBeenCalled();
  });
});

describe('approve writes the real record', () => {
  it('approves the stored extraction, not data sent by the browser, and applies only the review fields', async () => {
    h.stored = { id: 'ext-1', file_name: 'inv.pdf', doc_category: 'TAX_INVOICE', extracted_data: invoice, auto_populate_status: 'PENDING_REVIEW' };
    h.answer = (sql) => (/INSERT INTO finance.finance_payables/.test(sql) ? [{ id: 'pay-1' }] : []);
    const res = await approve({
      extractionId: 'ext-1',
      action: 'APPLY',
      extractionData: { ...invoice, financials: { totalAmountAed: 999999 } },
      fields: { vendorName: 'Al-Futtaim Spare Parts LLC', tenantId: 'tenant-b', unknownField: 'x' },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.linkedEntityType).toBe('INVOICE');
    const insert = h.queries.find((q) => /INSERT INTO finance.finance_payables/.test(q.sql))!;
    expect(insert.params).toContain('Al-Futtaim Spare Parts LLC'); // reviewer's correction
    expect(insert.params).toContain(1050); // stored total, not the browser's 999999
    expect(insert.params).not.toContain(999999);
    expect(insert.params[insert.params.length - 1]).toBe('tenant-a');
    expect(h.writes.some((w) => /SET auto_populate_status = 'APPLIED'/.test(w.sql))).toBe(true);
  });

  it('refuses an invoice whose amounts do not add up, and writes nothing', async () => {
    h.stored = { id: 'ext-2', file_name: 'inv.pdf', doc_category: 'INVOICE', extracted_data: invoice, auto_populate_status: 'PENDING_REVIEW' };
    const res = await approve({ extractionId: 'ext-2', action: 'APPLY', fields: { totalAmount: '2000' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not equal the total/);
    expect(h.queries.some((q) => /INSERT INTO/.test(q.sql))).toBe(false);
    expect(h.writes).toHaveLength(0);
  });

  it('cannot approve or reject twice', async () => {
    h.stored = { id: 'ext-3', file_name: 'inv.pdf', doc_category: 'INVOICE', extracted_data: invoice, auto_populate_status: 'APPLIED' };
    expect((await approve({ extractionId: 'ext-3', action: 'APPLY' })).status).toBe(409);
    expect((await approve({ extractionId: 'ext-3', action: 'REJECT' })).status).toBe(409);
    h.stored = null;
    expect((await approve({ extractionId: 'missing', action: 'APPLY' })).status).toBe(404);
  });

  it('a job card becomes a work order on the matched vehicle of this tenant', async () => {
    h.stored = {
      id: 'ext-4', file_name: 'job.pdf', doc_category: 'MAINTENANCE_REPORT', auto_populate_status: 'PENDING_REVIEW',
      extracted_data: { ...invoice, docCategory: 'MAINTENANCE_REPORT', referenceNumber: 'JC-77', summary: 'Brake pads replaced' },
    };
    h.answer = (sql) => {
      if (/FROM vehicles/.test(sql)) return [{ id: '3f1e2d4c-5b6a-4789-8abc-def012345678', label: 'DXB-A-12345' }];
      if (/COUNT\(\*\) AS count FROM fleet_work_orders/.test(sql)) return [{ count: 4 }];
      if (/INSERT INTO fleet_work_orders/.test(sql)) return [{ id: 'wo-1' }];
      return [];
    };
    const res = await approve({ extractionId: 'ext-4', action: 'APPLY' });
    expect(res.status).toBe(200);
    const vehicleQuery = h.queries.find((q) => /FROM vehicles/.test(q.sql))!;
    expect(vehicleQuery.params[0]).toBe('tenant-a');
    const insert = h.queries.find((q) => /INSERT INTO fleet_work_orders/.test(q.sql))!;
    expect(insert.params[0]).toBe('FWO-000005');
    expect(String(insert.params[7])).toContain('[doc-intel:ext-4]');
  });

  it('a proof of delivery is recorded on the one matching drayage job', async () => {
    h.stored = {
      id: 'ext-5', file_name: 'pod.pdf', doc_category: 'PROOF_OF_DELIVERY', auto_populate_status: 'PENDING_REVIEW',
      extracted_data: { ...invoice, docCategory: 'PROOF_OF_DELIVERY', referenceNumber: 'MSCU1234567' },
    };
    h.answer = (sql) => (/FROM logistics_drayage_jobs/.test(sql) ? [{ id: 'job-1', job_code: 'DRY-1', pod_signed_at: null }] : []);
    const noReceiver = await approve({ extractionId: 'ext-5', action: 'APPLY' });
    expect(noReceiver.status).toBe(400);
    expect(h.submitPod).not.toHaveBeenCalled();

    const res = await approve({ extractionId: 'ext-5', action: 'APPLY', fields: { receiverName: 'Bay supervisor' } });
    expect(res.status).toBe(200);
    expect(h.submitPod).toHaveBeenCalledWith(tx, expect.objectContaining({ tenantId: 'tenant-a', jobId: 'job-1', receiverName: 'Bay supervisor' }));
  });

  it('reject writes nothing but the status', async () => {
    h.stored = { id: 'ext-6', file_name: 'inv.pdf', doc_category: 'INVOICE', extracted_data: invoice, auto_populate_status: 'PENDING_REVIEW' };
    const res = await approve({ extractionId: 'ext-6', action: 'REJECT', reason: 'Duplicate' });
    expect(res.status).toBe(200);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].sql).toMatch(/SET auto_populate_status = 'REJECTED'/);
  });
});
