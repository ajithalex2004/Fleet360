/**
 * Live PostgreSQL (FORCE RLS) + HTTP integration verification for M5-R3 remediation:
 * - WP2: assertPeriodOpen (`period_from`/`period_to`) across traffic-fines/reverse & finance/journals
 * - WP5: Manual journals CoA validation, locked period 422, SoD self-post 403, distinct checker 200
 * - WP7: Real DB-only fleet/availability counts (no synthesized fallback)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { cleanupTenant, cleanupUser, createAuthHeaders, createSessionToken, isServerRunning, makeRequest, seedTestTenantFull, type SeedResult } from '../setup';

let seed: SeedResult | null = null;
const createdFineId = crypto.randomUUID();

beforeAll(async () => {
  const up = await isServerRunning();
  if (!up) {
    throw new Error('Next.js server must be running on :3000');
  }
  seed = await seedTestTenantFull();

  await withTenantRls(prisma, seed.tenant.id, async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO finance_chart_of_accounts (tenant_id, account_code, account_name, account_type, is_header, is_active, normal_balance)
       VALUES ($1, '1110', 'Cash at Bank', 'ASSET', false, true, 'DEBIT'),
              ($1, '4100', 'Rental Revenue', 'REVENUE', false, true, 'CREDIT')
       ON CONFLICT DO NOTHING`,
      seed!.tenant.id,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO finance_periods (tenant_id, fiscal_year, period_number, period_name, period_from, period_to, status)
       VALUES ($1, 2024, 1, '2024-01', '2024-01-01'::date, '2024-01-31'::date, 'LOCKED')`,
      seed!.tenant.id,
    );
    await tx.trafficFine.create({
      data: {
        id: createdFineId,
        tenantId: seed!.tenant.id,
        fineDate: new Date('2026-11-17T00:00:00.000Z'),
        fineAmount: 500,
        adminFee: 50,
        fineRef: 'TF-M5R3-LIVE',
        status: 'PAID',
        isBilledToCustomer: true,
      },
    });
  });
});

afterAll(async () => {
  if (seed) {
    await withTenantRls(prisma, seed.tenant.id, async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM finance_journal_lines WHERE journal_entry_id IN (SELECT id FROM finance_journal_entries WHERE tenant_id = $1)`,
        seed!.tenant.id,
      ).catch(() => {});
      await tx.$executeRawUnsafe(`DELETE FROM finance_journal_entries WHERE tenant_id = $1`, seed!.tenant.id).catch(() => {});
      await tx.$executeRawUnsafe(`DELETE FROM finance_periods WHERE tenant_id = $1`, seed!.tenant.id).catch(() => {});
      await tx.$executeRawUnsafe(`DELETE FROM finance_chart_of_accounts WHERE tenant_id = $1`, seed!.tenant.id).catch(() => {});
      await tx.$executeRawUnsafe(`DELETE FROM traffic_fines WHERE tenant_id = $1`, seed!.tenant.id).catch(() => {});
    }).catch(() => {});
    await cleanupTenant(seed.tenant.id).catch(() => {});
    await cleanupUser(seed.user.id).catch(() => {});
  }
});

describe('M5-R3 Live PostgreSQL + HTTP Integration Verification', () => {
  let journalId = '';

  it('POST /api/finance/journals creates a balanced DRAFT journal against open period and valid CoA', async () => {
    const res = await makeRequest('POST', '/api/finance/journals', {
      date: '2026-11-17',
      description: 'M5-R3 live integration journal',
      lines: [
        { accountCode: '1110', debit: 100, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 100 },
      ],
    }, seed!.headers);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.status).toBe('DRAFT');
    journalId = body.id;
  });

  it('POST /api/finance/journals rejects LOCKED finance_periods date with 422 (no 25P02 abort)', async () => {
    const res = await makeRequest('POST', '/api/finance/journals', {
      date: '2024-01-15',
      description: 'Locked period test',
      lines: [
        { accountCode: '1110', debit: 100, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 100 },
      ],
    }, seed!.headers);
    expect(res.status).toBe(422);
  });

  it('POST /api/finance/journals rejects invalid CoA account code with 422', async () => {
    const res = await makeRequest('POST', '/api/finance/journals', {
      date: '2026-11-17',
      description: 'Invalid CoA test',
      lines: [
        { accountCode: '1110', debit: 100, credit: 0 },
        { accountCode: '9999', debit: 0, credit: 100 },
      ],
    }, seed!.headers);
    expect(res.status).toBe(422);
  });

  it('POST /api/finance/journals/[id]/post rejects self-approval with 403 and allows distinct checker with 200', async () => {
    const selfRes = await makeRequest('POST', `/api/finance/journals/${journalId}/post`, {}, seed!.headers);
    expect(selfRes.status).toBe(403);

    const checkerToken = await createSessionToken(
      'checker-m5r3-distinct',
      seed!.tenant.id,
      seed!.tenant.plan,
      'TENANT_ADMIN',
    );
    const postRes = await makeRequest(
      'POST',
      `/api/finance/journals/${journalId}/post`,
      {},
      createAuthHeaders(checkerToken),
    );
    expect(postRes.status).toBe(200);
    const body = await postRes.json();
    expect(body.status).toBe('POSTED');
  });

  it('POST /api/leasing/traffic-fines/reverse succeeds with 200 and 0%/5% tax split (no 42703/25P02)', async () => {
    const res = await makeRequest('POST', '/api/leasing/traffic-fines/reverse', { rechargeId: createdFineId }, seed!.headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vatAmount).toBe(2.5);
    expect(body.totalAmount).toBe(552.5);
  });

  it('GET /api/fleet/availability returns real 0 counts for empty tenant without synthesized demo stock', async () => {
    const res = await makeRequest('GET', '/api/fleet/availability?serviceType=RENTAL', undefined, seed!.headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    const nonZero = (body.categories || []).filter((c: { availableCount: number }) => c.availableCount > 0);
    expect(nonZero).toHaveLength(0);
  });
});
