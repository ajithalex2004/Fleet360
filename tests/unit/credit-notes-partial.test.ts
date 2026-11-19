/**
 * tests/unit/credit-notes-partial.test.ts
 *
 * Verifies POST /api/finance/credit-notes/partial:
 * 1. Locked period -> assertPeriodOpen rejects -> returns 422 BEFORE inserting credit note
 * 2. Valid partial credit note -> SAVEPOINT sp_cn_partial_gl, postOperationalJournalEntry,
 *    RELEASE SAVEPOINT sp_cn_partial_gl, returns 201 with glPosted: true
 * 3. GL failure / null return -> ROLLBACK TO SAVEPOINT sp_cn_partial_gl + RELEASE SAVEPOINT sp_cn_partial_gl
 *    + console.warn (no 25P02 aborted transaction, glPosted: false)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));
import { NextRequest } from 'next/server';

const { state, mockTx, mockAssertPeriodOpen, mockPostOperationalJournalEntry, resetState } = vi.hoisted(() => {
  const state = {
    sqlCalls: [] as Array<{ sql: string; args: unknown[] }>,
    insertedCn: false,
    periodLocked: false,
    glReturnNull: false,
    glThrow: false,
  };

  function resetState() {
    state.sqlCalls = [];
    state.insertedCn = false;
    state.periodLocked = false;
    state.glReturnNull = false;
    state.glThrow = false;
  }

  const mockAssertPeriodOpen = vi.fn(async () => {
    if (state.periodLocked) {
      const err = new Error('Accounting period "2026-11" is LOCKED and cannot accept new postings.') as Error & {
        statusCode?: number;
      };
      err.statusCode = 422;
      throw err;
    }
  });

  const mockPostOperationalJournalEntry = vi.fn(async () => {
    if (state.glThrow) {
      throw new Error('PG error inside journal posting');
    }
    if (state.glReturnNull) {
      return null;
    }
    return { id: 'je-partial-1', number: 'JE-202611-0001', created: true };
  });

  const mockTx = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
      state.sqlCalls.push({ sql, args });
      if (sql.includes('FROM finance_invoices')) {
        return [{ id: 'inv-100', invoice_number: 'INV-2026-100', total_amount: 1050, paid_amount: 0 }];
      }
      if (sql.includes('INSERT INTO finance_credit_notes')) {
        state.insertedCn = true;
        return [
          {
            id: 'cn-partial-1',
            cn_number: 'CN-202611-0001',
            original_invoice_id: 'inv-100',
            total_amount: args[5],
            status: 'APPLIED',
          },
        ];
      }
      return [];
    }),
    $executeRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
      state.sqlCalls.push({ sql, args });
      return 1;
    }),
  };

  return { state, mockTx, mockAssertPeriodOpen, mockPostOperationalJournalEntry, resetState };
});

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
}));
vi.mock('@/lib/finance/document-number', () => ({
  nextDocumentNumber: vi.fn(async () => 'CN-202611-0001'),
}));
vi.mock('@/lib/finance/journal-service', () => ({
  assertPeriodOpen: mockAssertPeriodOpen,
  postOperationalJournalEntry: mockPostOperationalJournalEntry,
}));

import { POST } from '@/app/api/finance/credit-notes/partial/route';

const headers = {
  'content-type': 'application/json',
  'x-tenant-id': '11111111-1111-4111-8111-111111111111',
  'x-user-id': 'fin-user-1',
};

describe('POST /api/finance/credit-notes/partial SAVEPOINT & period controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('rejects locked period with 422 BEFORE inserting into finance_credit_notes', async () => {
    state.periodLocked = true;
    const req = new NextRequest('http://localhost:3000/api/finance/credit-notes/partial', {
      method: 'POST',
      headers,
      body: JSON.stringify({ invoiceId: 'inv-100', amount: 105 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toContain('LOCKED');
    expect(mockAssertPeriodOpen).toHaveBeenCalledTimes(1);
    expect(state.insertedCn).toBe(false);
    expect(mockPostOperationalJournalEntry).not.toHaveBeenCalled();
  });

  it('posts GL inside SAVEPOINT sp_cn_partial_gl and calls RELEASE SAVEPOINT on success (201)', async () => {
    const req = new NextRequest('http://localhost:3000/api/finance/credit-notes/partial', {
      method: 'POST',
      headers,
      body: JSON.stringify({ invoiceId: 'inv-100', amount: 105 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.glPosted).toBe(true);
    expect(json.glEntry).toEqual({ id: 'je-partial-1', number: 'JE-202611-0001', created: true });

    const spOps = state.sqlCalls.map((c) => c.sql).filter((s) => s.includes('SAVEPOINT'));
    expect(spOps).toEqual(['SAVEPOINT sp_cn_partial_gl', 'RELEASE SAVEPOINT sp_cn_partial_gl']);
  });

  it('rolls back to SAVEPOINT sp_cn_partial_gl and releases when postOperationalJournalEntry returns null', async () => {
    state.glReturnNull = true;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const req = new NextRequest('http://localhost:3000/api/finance/credit-notes/partial', {
      method: 'POST',
      headers,
      body: JSON.stringify({ invoiceId: 'inv-100', amount: 105 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.glPosted).toBe(false);
    expect(json.glEntry).toBeNull();

    const spOps = state.sqlCalls.map((c) => c.sql).filter((s) => s.includes('SAVEPOINT'));
    expect(spOps).toEqual([
      'SAVEPOINT sp_cn_partial_gl',
      'ROLLBACK TO SAVEPOINT sp_cn_partial_gl',
      'RELEASE SAVEPOINT sp_cn_partial_gl',
    ]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('rolls back to SAVEPOINT sp_cn_partial_gl and releases when postOperationalJournalEntry throws', async () => {
    state.glThrow = true;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const req = new NextRequest('http://localhost:3000/api/finance/credit-notes/partial', {
      method: 'POST',
      headers,
      body: JSON.stringify({ invoiceId: 'inv-100', amount: 105 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.glPosted).toBe(false);

    const spOps = state.sqlCalls.map((c) => c.sql).filter((s) => s.includes('SAVEPOINT'));
    expect(spOps).toEqual([
      'SAVEPOINT sp_cn_partial_gl',
      'ROLLBACK TO SAVEPOINT sp_cn_partial_gl',
      'RELEASE SAVEPOINT sp_cn_partial_gl',
    ]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
