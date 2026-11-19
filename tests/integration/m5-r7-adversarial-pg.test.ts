/**
 * Real PostgreSQL 17 Adversarial Integration Test — M5-R7 WP4
 *
 * Exercises live PostgreSQL 17 (`127.0.0.1:5433/fleet360_e2e_test`) under the
 * non-superuser, non-BYPASSRLS runtime role `fleet360_app` with FORCE ROW LEVEL SECURITY:
 *
 *   Suite 1: Cross-tenant SELECT / INSERT / UPDATE / DELETE isolation across all
 *            6 remediated tables + finance.finance_payables
 *   Suite 2: Real RLS enforcement & app.tenant_id GUC switching / escape attempts
 *   Suite 3: Global vs tenant-scoped platform_subscription_invoices uniqueness &
 *            /api/billing/subscriptions(+/[id]) isolation
 *   Suite 4: Financial transaction integrity, failed payable rollback, 5-way
 *            concurrency, SoD, idempotent replay, credit-note non-inflation,
 *            and Balance Sheet / GL / subledger reconciliation
 */
import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));
import { NextRequest } from 'next/server';
import { prisma as basePrisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { runWithRlsScope } from '@/lib/rls-scope';
import { ensureTenantChartOfAccounts } from '@/lib/finance/chart-of-accounts';
import { postOperationalJournalEntry } from '@/lib/finance/journal-service';
import { hasTestDatabase } from '../db-guard';

const hasDb = hasTestDatabase();
const RUN = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;

const tenantA = crypto.randomUUID();
const tenantB = crypto.randomUUID();
const userA = crypto.randomUUID();
const userA2 = crypto.randomUUID(); // distinct checker for Maker-Checker SoD
const userB = crypto.randomUUID();

interface AuthState {
  tenantId: string;
  userId: string;
  role: string;
}

let activeAuth: AuthState = {
  tenantId: tenantA,
  userId: userA,
  role: 'TENANT_ADMIN',
};

function setAuth(next: AuthState) {
  activeAuth = next;
}

vi.mock('@/lib/tenant-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tenant-context')>();
  return {
    ...actual,
    requireAuthorizedTenant: vi.fn(() => ({
      ok: true as const,
      tenantId: activeAuth.tenantId,
      userId: activeAuth.userId,
      role: activeAuth.role,
    })),
  };
});

import { GET as subscriptionsGet } from '@/app/api/billing/subscriptions/route';
import { GET as subscriptionByIdGet } from '@/app/api/billing/subscriptions/[id]/route';
import { POST as autoInvoicePost } from '@/app/api/billing/auto-invoice/route';
import {
  GET as selfBillingGet,
  POST as selfBillingPost,
} from '@/app/api/finance/self-billing/route';
import { POST as journalsPost } from '@/app/api/finance/journals/route';
import { POST as journalPostById } from '@/app/api/finance/journals/[id]/post/route';
import {
  GET as journalEntriesGet,
  POST as journalEntriesPost,
} from '@/app/api/finance/journal-entries/route';
import { PATCH as journalEntryPatch } from '@/app/api/finance/journal-entries/[id]/route';
import {
  GET as creditNotesGet,
  POST as creditNotesPost,
} from '@/app/api/finance/credit-notes/route';
import { PATCH as creditNoteByIdPatch } from '@/app/api/finance/credit-notes/[id]/route';
import { POST as creditNotesPartialPost } from '@/app/api/finance/credit-notes/partial/route';
import { GET as collectionsSummaryGet } from '@/app/api/finance/collections/summary/route';
import { POST as paymentsPost } from '@/app/api/finance/payments/route';
import { GET as balanceSheetGet } from '@/app/api/finance/balance-sheet/route';
import { GET as generalLedgerGet } from '@/app/api/finance/general-ledger/route';
import {
  GET as customersGet,
  POST as customersPost,
} from '@/app/api/customers/route';
import {
  GET as customerByIdGet,
  PATCH as customerByIdPatch,
  DELETE as customerByIdDelete,
} from '@/app/api/customers/[id]/route';

function extractSqlState(err: unknown): string | undefined {
  const e = err as {
    code?: unknown;
    meta?: { code?: unknown; message?: unknown };
    message?: unknown;
  } | null;
  if (typeof e?.meta?.code === 'string') return e.meta.code;
  if (typeof e?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  const msg = String(e?.meta?.message ?? e?.message ?? err ?? '');
  const m = /\b(42501|23505|23502|23503|25P02|42P10)\b/.exec(msg);
  return m?.[1];
}

async function expectSqlState(fn: () => Promise<unknown>, expectedCode: string): Promise<void> {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught, `Expected PostgreSQL SQLSTATE ${expectedCode} but query succeeded`).toBeDefined();
  const actual = extractSqlState(caught);
  expect(actual, `Unexpected error: ${String(caught)}`).toBe(expectedCode);
}

describe.skipIf(!hasDb)('M5-R7 Real PG17 Adversarial Isolation & Financial Integrity', () => {
  const sharedEmailTemplateId = crypto.randomUUID();
  const sharedVehicleTypeId = crypto.randomUUID();
  const createdBillingRunIds: string[] = [];

  beforeAll(async () => {
    // Preflight: verify runtime role is non-superuser, non-BYPASSRLS `fleet360_app`
    const roleRows = await basePrisma.$queryRawUnsafe<
      Array<{
        current_user: string;
        rolcanlogin: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>
    >(
      `SELECT current_user, rolcanlogin, rolsuper, rolbypassrls
         FROM pg_roles
        WHERE rolname = current_user`,
    );
    const role = roleRows[0];
    expect(role?.current_user).toBe('fleet360_app');
    expect(role?.rolcanlogin).toBe(true);
    expect(role?.rolsuper).toBe(false);
    expect(role?.rolbypassrls).toBe(false);

    // Seed tenantA and tenantB under platform admin context
    await withPlatformAdmin(basePrisma, async (tx) => {
      await tx.tenant.createMany({
        data: [
          {
            id: tenantA,
            name: `M5R7 Adversarial Tenant A ${RUN}`,
            code: `R7A-${RUN.slice(-8)}`,
            domain: `r7a-${RUN}.example.com`,
            plan: 'ENTERPRISE',
            isActive: true,
            trn: '100123456789003',
            address: 'Dubai, UAE',
          },
          {
            id: tenantB,
            name: `M5R7 Adversarial Tenant B ${RUN}`,
            code: `R7B-${RUN.slice(-8)}`,
            domain: `r7b-${RUN}.example.com`,
            plan: 'ENTERPRISE',
            isActive: true,
            trn: '100987654321003',
            address: 'Abu Dhabi, UAE',
          },
        ],
      });
    });

    // Seed per-tenant Chart of Accounts for both tenants
    await withTenantRls(basePrisma, tenantA, async (tx) => {
      await ensureTenantChartOfAccounts(tx, tenantA);
    });
    await withTenantRls(basePrisma, tenantB, async (tx) => {
      await ensureTenantChartOfAccounts(tx, tenantB);
    });
  }, 60_000);

  afterAll(async () => {
    if (!hasDb) return;
    await withPlatformAdmin(basePrisma, async (tx) => {
      const scope = [tenantA, tenantB];
      await tx.$executeRawUnsafe(`DELETE FROM customer_interactions WHERE tenant_id = ANY($1::text[])`, scope);
      await tx.$executeRawUnsafe(
        `DELETE FROM customer_documents WHERE customer_id IN (SELECT id FROM customers WHERE tenant_id = ANY($1::text[]))`,
        scope,
      );
      await tx.$executeRawUnsafe(`DELETE FROM lessees WHERE tenant_id = ANY($1::text[])`, scope);
      await tx.$executeRawUnsafe(`DELETE FROM customers WHERE tenant_id = ANY($1::text[])`, scope);

      await tx.$executeRawUnsafe(`DELETE FROM finance_payment_allocations WHERE tenant_id = ANY($1::text[])`, scope);
      await tx.$executeRawUnsafe(`DELETE FROM finance_payments WHERE tenant_id = ANY($1::text[])`, scope);
      await tx.$executeRawUnsafe(`DELETE FROM finance_credit_notes WHERE tenant_id = ANY($1::text[])`, scope);
      await tx.$executeRawUnsafe(`DELETE FROM finance_payables WHERE tenant_id = ANY($1::text[])`, scope);
      await tx.$executeRawUnsafe(`DELETE FROM finance_invoices WHERE tenant_id = ANY($1::text[])`, scope);
      await tx.$executeRawUnsafe(
        `DELETE FROM finance_journal_lines WHERE journal_entry_id IN (SELECT id FROM finance_journal_entries WHERE tenant_id = ANY($1::text[]))`,
        scope,
      );
      await tx.$executeRawUnsafe(`DELETE FROM finance_journal_entries WHERE tenant_id = ANY($1::text[])`, scope);
      await tx.$executeRawUnsafe(`DELETE FROM finance_periods WHERE tenant_id = ANY($1::text[])`, scope);
      await tx.$executeRawUnsafe(`DELETE FROM finance_chart_of_accounts WHERE tenant_id = ANY($1::text[])`, scope);
      await tx.$executeRawUnsafe(`DELETE FROM finance_tax_categories WHERE tenant_id = ANY($1::text[])`, scope);

      await tx.$executeRawUnsafe(`DELETE FROM platform_subscription_invoices WHERE tenant_id = ANY($1::text[])`, scope);
      await tx.$executeRawUnsafe(`DELETE FROM tenant_module_subscriptions WHERE tenant_id = ANY($1::text[])`, scope);
      if (createdBillingRunIds.length > 0) {
        await tx.$executeRawUnsafe(`DELETE FROM billing_runs WHERE id = ANY($1::uuid[])`, createdBillingRunIds);
      }
      await tx.$executeRawUnsafe(
        `DELETE FROM email_templates WHERE tenant_id = ANY($1::text[]) OR id = $2::uuid`,
        scope,
        sharedEmailTemplateId,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM vehicle_types WHERE tenant_id = ANY($1::text[]) OR id = $2::uuid`,
        scope,
        sharedVehicleTypeId,
      );
      await tx.$executeRawUnsafe(`DELETE FROM audit_logs WHERE tenant_id = ANY($1::text[])`, scope);
      await tx.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1::text[])`, scope);
    });

    const leftoverTenants = await withPlatformAdmin(basePrisma, async (tx) =>
      tx.tenant.count({ where: { id: { in: [tenantA, tenantB] } } }),
    );
    expect(leftoverTenants).toBe(0);

    await basePrisma.$disconnect();
  }, 60_000);

  // ============================================================================
  // Suite 1: Cross-Tenant SELECT / INSERT / UPDATE / DELETE Isolation
  // ============================================================================
  describe('Suite 1 — Cross-Tenant DML Isolation Under fleet360_app', () => {
    it('public.platform_subscription_invoices isolates SELECT, UPDATE, DELETE, and rejects cross-tenant INSERT (42501)', async () => {
      const idA = crypto.randomUUID();
      await withTenantRls(basePrisma, tenantA, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.platform_subscription_invoices
             (id, tenant_id, invoice_number, client_name, issue_date, due_date, subtotal, vat_rate, vat_amount, total_amount)
           VALUES ($1::uuid, $2, $3, 'Tenant A Sub', CURRENT_DATE, CURRENT_DATE + 30, 1000, 5, 50, 1050)`,
          idA,
          tenantA,
          `SUB-ISO-${RUN}`,
        );
      });

      const selectB = await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id::text FROM public.platform_subscription_invoices WHERE id = $1::uuid`,
          idA,
        ),
      );
      expect(selectB).toHaveLength(0);

      const updB = await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE public.platform_subscription_invoices SET client_name = 'HIJACKED' WHERE id = $1::uuid`,
          idA,
        ),
      );
      expect(updB).toBe(0);

      const delB = await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$executeRawUnsafe(
          `DELETE FROM public.platform_subscription_invoices WHERE id = $1::uuid`,
          idA,
        ),
      );
      expect(delB).toBe(0);

      await expectSqlState(
        () =>
          withTenantRls(basePrisma, tenantB, (tx) =>
            tx.$executeRawUnsafe(
              `INSERT INTO public.platform_subscription_invoices
                 (id, tenant_id, invoice_number, client_name, issue_date, due_date, subtotal, vat_rate, vat_amount, total_amount)
               VALUES ($1::uuid, $2, $3, 'Spoof', CURRENT_DATE, CURRENT_DATE + 30, 100, 5, 5, 105)`,
              crypto.randomUUID(),
              tenantA,
              `SUB-SPOOF-${RUN}`,
            ),
          ),
        '42501',
      );

      const verifyA = await withPlatformAdmin(basePrisma, (tx) =>
        tx.$queryRawUnsafe<Array<{ client_name: string }>>(
          `SELECT client_name FROM public.platform_subscription_invoices WHERE id = $1::uuid`,
          idA,
        ),
      );
      expect(verifyA).toEqual([{ client_name: 'Tenant A Sub' }]);
    });

    it('finance.finance_payments enforces NOT NULL tenant_id, blocks NULL escape (23502), and isolates cross-tenant DML', async () => {
      const colMeta = await withPlatformAdmin(basePrisma, (tx) =>
        tx.$queryRawUnsafe<Array<{ is_nullable: string }>>(
          `SELECT is_nullable
             FROM information_schema.columns
            WHERE table_schema = 'finance' AND table_name = 'finance_payments' AND column_name = 'tenant_id'`,
        ),
      );
      expect(colMeta[0]?.is_nullable).toBe('NO');

      const payIdA = crypto.randomUUID();
      await withTenantRls(basePrisma, tenantA, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO finance.finance_payments (id, tenant_id, amount, payment_date, payment_method, reference)
           VALUES ($1::uuid, $2, 500, CURRENT_DATE, 'BANK_TRANSFER', $3)`,
          payIdA,
          tenantA,
          `PAY-ISO-${RUN}`,
        );
      });

      const selectB = await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id::text FROM finance.finance_payments WHERE id = $1::uuid`,
          payIdA,
        ),
      );
      expect(selectB).toHaveLength(0);

      const updB = await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE finance.finance_payments SET reference = 'HIJACKED' WHERE id = $1::uuid`,
          payIdA,
        ),
      );
      expect(updB).toBe(0);

      const delB = await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$executeRawUnsafe(
          `DELETE FROM finance.finance_payments WHERE id = $1::uuid`,
          payIdA,
        ),
      );
      expect(delB).toBe(0);

      await expectSqlState(
        () =>
          withTenantRls(basePrisma, tenantB, (tx) =>
            tx.$executeRawUnsafe(
              `INSERT INTO finance.finance_payments (id, tenant_id, amount, payment_date, payment_method, reference)
               VALUES ($1::uuid, $2, 999, CURRENT_DATE, 'CASH', 'SPOOF')`,
              crypto.randomUUID(),
              tenantA,
            ),
          ),
        '42501',
      );

      // NULL escape blocked by NOT NULL constraint even under platform admin or tenant context
      await expectSqlState(
        () =>
          withPlatformAdmin(basePrisma, (tx) =>
            tx.$executeRawUnsafe(
              `INSERT INTO finance.finance_payments (id, tenant_id, amount, payment_date, payment_method, reference)
               VALUES ($1::uuid, NULL, 999, CURRENT_DATE, 'CASH', 'NULL-ESCAPE')`,
              crypto.randomUUID(),
            ),
          ),
        '23502',
      );

      const verifyA = await withPlatformAdmin(basePrisma, (tx) =>
        tx.$queryRawUnsafe<Array<{ reference: string }>>(
          `SELECT reference FROM finance.finance_payments WHERE id = $1::uuid`,
          payIdA,
        ),
      );
      expect(verifyA).toEqual([{ reference: `PAY-ISO-${RUN}` }]);
    });

    it('public.session_revocations isolates tenant-scoped reads, restricts INSERT/UPDATE to platform admin (42501), and denies DELETE', async () => {
      const revTenantAId = `rev-ta-${RUN}`;
      const revGlobalUserId = `rev-gl-${RUN}`;

      await withPlatformAdmin(basePrisma, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.session_revocations (id, user_id, tenant_id, not_before, reason, revoked_by)
           VALUES
             ($1, $2, $3, '2000-01-01T00:00:00Z'::timestamptz, $4, 'platform-test'),
             ($5, $2, NULL, '2000-01-01T00:00:00Z'::timestamptz, $6, 'platform-test')`,
          revTenantAId,
          userA,
          tenantA,
          `M5R7_SR_TENANT_${RUN}`,
          revGlobalUserId,
          `M5R7_SR_GLOBAL_${RUN}`,
        );
      });

      // Cross-tenant SELECT: Tenant B cannot read Tenant A's tenant-scoped revocation,
      // while user-wide (tenant_id IS NULL) revocation remains readable for auth check.
      const selectB = await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM public.session_revocations WHERE id IN ($1, $2)`,
          revTenantAId,
          revGlobalUserId,
        ),
      );
      expect(selectB.map((r) => r.id)).toEqual([revGlobalUserId]);

      // Tenant-context INSERT (even for own tenant_id!) strictly rejected with 42501 via AS RESTRICTIVE policy
      await expectSqlState(
        () =>
          withTenantRls(basePrisma, tenantB, (tx) =>
            tx.$executeRawUnsafe(
              `INSERT INTO public.session_revocations (id, user_id, tenant_id, not_before, reason)
               VALUES ($1, $2, $3, '2000-01-01T00:00:00Z'::timestamptz, 'TENANT_INSERT_ATTEMPT')`,
              `rev-inj-${RUN}`,
              userB,
              tenantB,
            ),
          ),
        '42501',
      );

      // Tenant-context UPDATE rejected / 0 rows affected (AS RESTRICTIVE USING/WITH CHECK)
      let updCount = 0;
      let updCode: string | undefined;
      try {
        updCount = await withTenantRls(basePrisma, tenantA, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE public.session_revocations SET reason = 'TAMPERED' WHERE id = $1`,
            revTenantAId,
          ),
        );
      } catch (err) {
        updCode = extractSqlState(err);
      }
      expect(updCount === 0 || updCode === '42501').toBe(true);

      // DELETE denied (no DELETE grant for fleet360_app -> 42501, and USING (false) policy)
      let delCount = 0;
      let delCode: string | undefined;
      try {
        delCount = await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$executeRawUnsafe(
            `DELETE FROM public.session_revocations WHERE id = $1`,
            revTenantAId,
          ),
        );
      } catch (err) {
        delCode = extractSqlState(err);
      }
      expect(delCode === '42501' || delCount === 0).toBe(true);

      // Verify rows remain untouched
      const verify = await withPlatformAdmin(basePrisma, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string; reason: string }>>(
          `SELECT id, reason FROM public.session_revocations WHERE id IN ($1, $2) ORDER BY id`,
          revTenantAId,
          revGlobalUserId,
        ),
      );
      expect(verify).toHaveLength(2);
      expect(verify.find((r) => r.id === revTenantAId)?.reason).toBe(`M5R7_SR_TENANT_${RUN}`);
    });

    it('finance.finance_tax_categories isolates tenant rows, allows shared NULL SELECT, and blocks tenant NULL writes (42501)', async () => {
      const taxIdA = crypto.randomUUID();
      await withTenantRls(basePrisma, tenantA, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO finance.finance_tax_categories (id, code, name, rate, tenant_id)
           VALUES ($1::uuid, $2, 'Tenant A Tax', 5, $3)`,
          taxIdA,
          `TAXA_${RUN.slice(-6)}`,
          tenantA,
        );
      });

      const selectB = await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id::text FROM finance.finance_tax_categories WHERE id = $1::uuid`,
          taxIdA,
        ),
      );
      expect(selectB).toHaveLength(0);

      // Shared catalog (tenant_id IS NULL) rows ARE readable on SELECT under tenant RLS
      const sharedB = await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string; code: string }>>(
          `SELECT id::text, code FROM finance.finance_tax_categories WHERE tenant_id IS NULL AND code = 'STANDARD'`,
        ),
      );
      expect(sharedB).toHaveLength(1);
      const sharedStandardId = sharedB[0].id;

      // Cross-tenant UPDATE / DELETE on Tenant A row -> 0 rows affected
      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE finance.finance_tax_categories SET name = 'HIJACKED' WHERE id = $1::uuid`,
            taxIdA,
          ),
        ),
      ).toBe(0);
      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$executeRawUnsafe(
            `DELETE FROM finance.finance_tax_categories WHERE id = $1::uuid`,
            taxIdA,
          ),
        ),
      ).toBe(0);

      // Tenant-context UPDATE / DELETE targeting shared tenant_id IS NULL row -> 0 rows affected
      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE finance.finance_tax_categories SET name = 'HIJACKED' WHERE id = $1::uuid`,
            sharedStandardId,
          ),
        ),
      ).toBe(0);
      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$executeRawUnsafe(
            `DELETE FROM finance.finance_tax_categories WHERE id = $1::uuid`,
            sharedStandardId,
          ),
        ),
      ).toBe(0);

      // Cross-tenant INSERT & tenant-context NULL INSERT both reject with 42501
      await expectSqlState(
        () =>
          withTenantRls(basePrisma, tenantB, (tx) =>
            tx.$executeRawUnsafe(
              `INSERT INTO finance.finance_tax_categories (id, code, name, rate, tenant_id)
               VALUES ($1::uuid, $2, 'Spoof', 5, $3)`,
              crypto.randomUUID(),
              `SPOOF_${RUN.slice(-6)}`,
              tenantA,
            ),
          ),
        '42501',
      );
      await expectSqlState(
        () =>
          withTenantRls(basePrisma, tenantB, (tx) =>
            tx.$executeRawUnsafe(
              `INSERT INTO finance.finance_tax_categories (id, code, name, rate, tenant_id)
               VALUES ($1::uuid, $2, 'Shared Inject', 5, NULL)`,
              crypto.randomUUID(),
              `NULL_${RUN.slice(-6)}`,
            ),
          ),
        '42501',
      );

      const verify = await withPlatformAdmin(basePrisma, (tx) =>
        tx.$queryRawUnsafe<Array<{ name: string }>>(
          `SELECT name FROM finance.finance_tax_categories WHERE id = $1::uuid`,
          taxIdA,
        ),
      );
      expect(verify).toEqual([{ name: 'Tenant A Tax' }]);
    });

    it('public.email_templates isolates tenant rows, allows shared NULL SELECT, and blocks tenant NULL writes (42501)', async () => {
      const tplIdA = crypto.randomUUID();
      await withPlatformAdmin(basePrisma, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO public.email_templates (id, tenant_id, template_key, channel, locale, subject, body)
           VALUES ($1::uuid, NULL, $2, 'EMAIL', 'en', 'Shared Subject', 'Shared Body')`,
          sharedEmailTemplateId,
          `tpl_shared_${RUN}`,
        ),
      );
      await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO public.email_templates (id, tenant_id, template_key, channel, locale, subject, body)
           VALUES ($1::uuid, $2, $3, 'EMAIL', 'en', 'Tenant A Subject', 'Tenant A Body')`,
          tplIdA,
          tenantA,
          `tpl_a_${RUN}`,
        ),
      );

      // Cross-tenant SELECT -> 0; shared NULL SELECT -> 1
      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text FROM public.email_templates WHERE id = $1::uuid`,
            tplIdA,
          ),
        ),
      ).toHaveLength(0);
      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text FROM public.email_templates WHERE id = $1::uuid`,
            sharedEmailTemplateId,
          ),
        ),
      ).toHaveLength(1);

      // Cross-tenant and shared-row UPDATE/DELETE -> 0 rows affected
      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE public.email_templates SET subject = 'HIJACKED' WHERE id IN ($1::uuid, $2::uuid)`,
            tplIdA,
            sharedEmailTemplateId,
          ),
        ),
      ).toBe(0);
      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$executeRawUnsafe(
            `DELETE FROM public.email_templates WHERE id IN ($1::uuid, $2::uuid)`,
            tplIdA,
            sharedEmailTemplateId,
          ),
        ),
      ).toBe(0);

      // Cross-tenant INSERT & NULL INSERT -> 42501
      await expectSqlState(
        () =>
          withTenantRls(basePrisma, tenantB, (tx) =>
            tx.$executeRawUnsafe(
              `INSERT INTO public.email_templates (id, tenant_id, template_key, channel, locale, subject, body)
               VALUES ($1::uuid, $2, $3, 'EMAIL', 'en', 'Spoof', 'Body')`,
              crypto.randomUUID(),
              tenantA,
              `tpl_spoof_${RUN}`,
            ),
          ),
        '42501',
      );
      await expectSqlState(
        () =>
          withTenantRls(basePrisma, tenantB, (tx) =>
            tx.$executeRawUnsafe(
              `INSERT INTO public.email_templates (id, tenant_id, template_key, channel, locale, subject, body)
               VALUES ($1::uuid, NULL, $2, 'EMAIL', 'en', 'Null Inject', 'Body')`,
              crypto.randomUUID(),
              `tpl_null_${RUN}`,
            ),
          ),
        '42501',
      );

      const verify = await withPlatformAdmin(basePrisma, (tx) =>
        tx.$queryRawUnsafe<Array<{ subject: string }>>(
          `SELECT subject FROM public.email_templates WHERE id = $1::uuid`,
          tplIdA,
        ),
      );
      expect(verify).toEqual([{ subject: 'Tenant A Subject' }]);
    });

    it('public.vehicle_types isolates tenant rows, allows shared NULL SELECT, and blocks tenant NULL writes (42501)', async () => {
      const vtIdA = crypto.randomUUID();
      await withPlatformAdmin(basePrisma, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO public.vehicle_types (id, code, name, tenant_id)
           VALUES ($1::uuid, $2, 'Shared Sedan', NULL)`,
          sharedVehicleTypeId,
          `VT-SH-${RUN.slice(-6)}`,
        ),
      );
      await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO public.vehicle_types (id, code, name, tenant_id)
           VALUES ($1::uuid, $2, 'Tenant A Truck', $3)`,
          vtIdA,
          `VT-A-${RUN.slice(-6)}`,
          tenantA,
        ),
      );

      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text FROM public.vehicle_types WHERE id = $1::uuid`,
            vtIdA,
          ),
        ),
      ).toHaveLength(0);
      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text FROM public.vehicle_types WHERE id = $1::uuid`,
            sharedVehicleTypeId,
          ),
        ),
      ).toHaveLength(1);

      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE public.vehicle_types SET name = 'HIJACKED' WHERE id IN ($1::uuid, $2::uuid)`,
            vtIdA,
            sharedVehicleTypeId,
          ),
        ),
      ).toBe(0);
      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$executeRawUnsafe(
            `DELETE FROM public.vehicle_types WHERE id IN ($1::uuid, $2::uuid)`,
            vtIdA,
            sharedVehicleTypeId,
          ),
        ),
      ).toBe(0);

      await expectSqlState(
        () =>
          withTenantRls(basePrisma, tenantB, (tx) =>
            tx.$executeRawUnsafe(
              `INSERT INTO public.vehicle_types (id, code, name, tenant_id)
               VALUES ($1::uuid, $2, 'Spoof', $3)`,
              crypto.randomUUID(),
              `VT-SP-${RUN.slice(-6)}`,
              tenantA,
            ),
          ),
        '42501',
      );
      await expectSqlState(
        () =>
          withTenantRls(basePrisma, tenantB, (tx) =>
            tx.$executeRawUnsafe(
              `INSERT INTO public.vehicle_types (id, code, name, tenant_id)
               VALUES ($1::uuid, $2, 'Null Inject', NULL)`,
              crypto.randomUUID(),
              `VT-NL-${RUN.slice(-6)}`,
            ),
          ),
        '42501',
      );

      const verify = await withPlatformAdmin(basePrisma, (tx) =>
        tx.$queryRawUnsafe<Array<{ name: string }>>(
          `SELECT name FROM public.vehicle_types WHERE id = $1::uuid`,
          vtIdA,
        ),
      );
      expect(verify).toEqual([{ name: 'Tenant A Truck' }]);
    });

    it('finance.finance_payables isolates SELECT, UPDATE, DELETE, and rejects cross-tenant INSERT (42501)', async () => {
      const payableIdA = crypto.randomUUID();
      await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO finance.finance_payables
             (id, payable_number, vendor_name, subtotal, vat_amount, total_amount, tenant_id)
           VALUES ($1::uuid, $2, 'Vendor A', 100, 5, 105, $3)`,
          payableIdA,
          `PAYABLE-ISO-${RUN}`,
          tenantA,
        ),
      );

      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text FROM finance.finance_payables WHERE id = $1::uuid`,
            payableIdA,
          ),
        ),
      ).toHaveLength(0);

      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE finance.finance_payables SET vendor_name = 'HIJACKED' WHERE id = $1::uuid`,
            payableIdA,
          ),
        ),
      ).toBe(0);

      expect(
        await withTenantRls(basePrisma, tenantB, (tx) =>
          tx.$executeRawUnsafe(
            `DELETE FROM finance.finance_payables WHERE id = $1::uuid`,
            payableIdA,
          ),
        ),
      ).toBe(0);

      await expectSqlState(
        () =>
          withTenantRls(basePrisma, tenantB, (tx) =>
            tx.$executeRawUnsafe(
              `INSERT INTO finance.finance_payables
                 (id, payable_number, vendor_name, subtotal, vat_amount, total_amount, tenant_id)
               VALUES ($1::uuid, $2, 'Spoof Vendor', 100, 5, 105, $3)`,
              crypto.randomUUID(),
              `PAYABLE-SPOOF-${RUN}`,
              tenantA,
            ),
          ),
        '42501',
      );

      const verify = await withPlatformAdmin(basePrisma, (tx) =>
        tx.$queryRawUnsafe<Array<{ vendor_name: string }>>(
          `SELECT vendor_name FROM finance.finance_payables WHERE id = $1::uuid`,
          payableIdA,
        ),
      );
      expect(verify).toEqual([{ vendor_name: 'Vendor A' }]);
    });
  });

  // ============================================================================
  // Suite 2: Real RLS Enforcement & app.tenant_id GUC Switching / Escapes
  // ============================================================================
  describe('Suite 2 — app.tenant_id Session Variable Switching & Escape Attempts', () => {
    const subInvA = crypto.randomUUID();
    const subInvB = crypto.randomUUID();
    const payA = crypto.randomUUID();
    const apA = crypto.randomUUID();

    beforeAll(async () => {
      await withTenantRls(basePrisma, tenantA, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.platform_subscription_invoices
             (id, tenant_id, invoice_number, client_name, issue_date, due_date, subtotal, vat_rate, vat_amount, total_amount)
           VALUES ($1::uuid, $2, $3, 'GUC Tenant A', CURRENT_DATE, CURRENT_DATE + 30, 500, 5, 25, 525)`,
          subInvA,
          tenantA,
          `SUB-GUC-A-${RUN}`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO finance.finance_payments (id, tenant_id, amount, payment_date, payment_method, reference)
           VALUES ($1::uuid, $2, 250, CURRENT_DATE, 'BANK_TRANSFER', $3)`,
          payA,
          tenantA,
          `PAY-GUC-${RUN}`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO finance.finance_payables (id, payable_number, vendor_name, subtotal, vat_amount, total_amount, tenant_id)
           VALUES ($1::uuid, $2, 'GUC Vendor', 200, 10, 210, $3)`,
          apA,
          `AP-GUC-${RUN}`,
          tenantA,
        );
      });
      await withTenantRls(basePrisma, tenantB, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.platform_subscription_invoices
             (id, tenant_id, invoice_number, client_name, issue_date, due_date, subtotal, vat_rate, vat_amount, total_amount)
           VALUES ($1::uuid, $2, $3, 'GUC Tenant B', CURRENT_DATE, CURRENT_DATE + 30, 600, 5, 30, 630)`,
          subInvB,
          tenantB,
          `SUB-GUC-B-${RUN}`,
        );
      });
    });

    it('switches app.tenant_id inside a single transaction and enforces immediate visibility transition', async () => {
      const result = await basePrisma.$transaction(async (tx) =>
        runWithRlsScope({ tenantId: tenantA, mode: 'tenant', tx }, async () => {
          await tx.$queryRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantA);
          const rowsA = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text FROM public.platform_subscription_invoices WHERE id = $1::uuid`,
            subInvA,
          );

          await tx.$queryRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantB);
          const rowsAfterSwitch = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text FROM public.platform_subscription_invoices WHERE id = $1::uuid`,
            subInvA,
          );
          return { rowsA: rowsA.length, rowsAfterSwitch: rowsAfterSwitch.length };
        }),
      );

      expect(result.rowsA).toBe(1);
      expect(result.rowsAfterSwitch).toBe(0);
    });

    it('returns 0 rows on unset, empty string, NULL, wrong GUC name (app.current_tenant_id), and SQL injection payloads', async () => {
      // 1. Unset GUC (raw basePrisma without wrapper)
      const unsetInvoices = await basePrisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text FROM public.platform_subscription_invoices WHERE id IN ($1::uuid, $2::uuid)`,
        subInvA,
        subInvB,
      );
      const unsetPayments = await basePrisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text FROM finance.finance_payments WHERE id = $1::uuid`,
        payA,
      );
      const unsetPayables = await basePrisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text FROM finance.finance_payables WHERE id = $1::uuid`,
        apA,
      );
      expect(unsetInvoices).toHaveLength(0);
      expect(unsetPayments).toHaveLength(0);
      expect(unsetPayables).toHaveLength(0);

      // 2. Empty string '', NULL, wrong GUC, SQLi inside isolated pinned transactions
      const escapeCases: Array<{
        label: string;
        verifyGuc: (guc: string | null) => void;
        setup: (tx: Parameters<Parameters<typeof basePrisma.$transaction>[0]>[0]) => Promise<unknown>;
      }> = [
        {
          label: 'empty string',
          verifyGuc: (guc) => expect(guc).toBe(''),
          setup: (tx) => tx.$queryRawUnsafe(`SELECT set_config('app.tenant_id', '', true)`),
        },
        {
          label: 'NULL',
          verifyGuc: (guc) => expect(guc === null || guc === '').toBe(true),
          setup: (tx) => tx.$queryRawUnsafe(`SELECT set_config('app.tenant_id', NULL, true)`),
        },
        {
          label: 'wrong GUC app.current_tenant_id',
          verifyGuc: (guc) => expect(guc === null || guc === '').toBe(true),
          setup: (tx) => tx.$queryRawUnsafe(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantA),
        },
        {
          label: 'SQL injection payload',
          verifyGuc: (guc) => expect(guc).toBe(`' OR '1'='1`),
          setup: (tx) => tx.$queryRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, `' OR '1'='1`),
        },
      ];

      for (const c of escapeCases) {
        const counts = await basePrisma.$transaction(async (tx) =>
          runWithRlsScope({ tenantId: 'probe', mode: 'tenant', tx }, async () => {
            await c.setup(tx);
            const [{ guc }] = await tx.$queryRawUnsafe<Array<{ guc: string | null }>>(
              `SELECT current_setting('app.tenant_id', true) AS guc`,
            );
            c.verifyGuc(guc);
            const inv = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT id::text FROM public.platform_subscription_invoices WHERE id IN ($1::uuid, $2::uuid)`,
              subInvA,
              subInvB,
            );
            const pay = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT id::text FROM finance.finance_payments WHERE id = $1::uuid`,
              payA,
            );
            const ap = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT id::text FROM finance.finance_payables WHERE id = $1::uuid`,
              apA,
            );
            return { inv: inv.length, pay: pay.length, ap: ap.length };
          }),
        );
        expect(counts, `Escape case "${c.label}" leaked rows`).toEqual({ inv: 0, pay: 0, ap: 0 });
      }

      // 3. withTenantRls rejects invalid tenantId payloads
      await expect(
        withTenantRls(basePrisma, `' OR '1'='1`, async () => 'nope'),
      ).rejects.toThrow(/invalid tenantId/i);
    });

    it('never leaks app.tenant_id across sequential or 8-way concurrent pooled transactions', async () => {
      const sequence = [tenantA, tenantB, tenantA, tenantB, tenantA, tenantB, tenantA, tenantB];
      const seqResults: Array<{ expected: string; seenIds: string[]; guc: string | null }> = [];
      for (const tid of sequence) {
        const res = await withTenantRls(basePrisma, tid, async (tx) => {
          const [{ guc }] = await tx.$queryRawUnsafe<Array<{ guc: string | null }>>(
            `SELECT current_setting('app.tenant_id', true) AS guc`,
          );
          const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text FROM public.platform_subscription_invoices WHERE id IN ($1::uuid, $2::uuid)`,
            subInvA,
            subInvB,
          );
          return { expected: tid, seenIds: rows.map((r) => r.id), guc };
        });
        seqResults.push(res);
      }

      for (const r of seqResults) {
        expect(r.guc).toBe(r.expected);
        expect(r.seenIds).toEqual([r.expected === tenantA ? subInvA : subInvB]);
      }

      const concurrent = await Promise.all(
        sequence.map((tid, idx) =>
          withTenantRls(basePrisma, tid, async (tx) => {
            await new Promise((resolve) => setTimeout(resolve, (idx % 3) * 15));
            const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT id::text FROM public.platform_subscription_invoices WHERE id IN ($1::uuid, $2::uuid)`,
              subInvA,
              subInvB,
            );
            const [{ guc }] = await tx.$queryRawUnsafe<Array<{ guc: string | null }>>(
              `SELECT current_setting('app.tenant_id', true) AS guc`,
            );
            return { expected: tid, seenIds: rows.map((r) => r.id), guc };
          }),
        ),
      );

      for (const r of concurrent) {
        expect(r.guc).toBe(r.expected);
        expect(r.seenIds).toEqual([r.expected === tenantA ? subInvA : subInvB]);
      }
    });
  });

  // ============================================================================
  // Suite 3: Global vs Tenant-Scoped platform_subscription_invoices Uniqueness
  // ============================================================================
  describe('Suite 3 — Tenant-Scoped platform_subscription_invoices Uniqueness & Subscriptions Routes', () => {
    const sharedInvoiceNumber = `SUB-202611-${RUN.slice(-6)}`;
    const invAId = crypto.randomUUID();
    const invBId = crypto.randomUUID();

    it('allows identical invoice_number across Tenant A and Tenant B, and rejects same-tenant duplicate with 23505', async () => {
      await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO public.platform_subscription_invoices
             (id, tenant_id, invoice_number, client_name, issue_date, due_date, subtotal, vat_rate, vat_amount, total_amount)
           VALUES ($1::uuid, $2, $3, 'Tenant A Co', CURRENT_DATE, CURRENT_DATE + 30, 1000, 5, 50, 1050)`,
          invAId,
          tenantA,
          sharedInvoiceNumber,
        ),
      );

      // Different tenant, SAME invoice_number -> MUST succeed
      await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO public.platform_subscription_invoices
             (id, tenant_id, invoice_number, client_name, issue_date, due_date, subtotal, vat_rate, vat_amount, total_amount)
           VALUES ($1::uuid, $2, $3, 'Tenant B Co', CURRENT_DATE, CURRENT_DATE + 30, 2000, 5, 100, 2100)`,
          invBId,
          tenantB,
          sharedInvoiceNumber,
        ),
      );

      // Same tenant, duplicate invoice_number -> MUST fail with SQLSTATE 23505
      await expectSqlState(
        () =>
          withTenantRls(basePrisma, tenantA, (tx) =>
            tx.$executeRawUnsafe(
              `INSERT INTO public.platform_subscription_invoices
                 (id, tenant_id, invoice_number, client_name, issue_date, due_date, subtotal, vat_rate, vat_amount, total_amount)
               VALUES ($1::uuid, $2, $3, 'Tenant A Dup', CURRENT_DATE, CURRENT_DATE + 30, 1000, 5, 50, 1050)`,
              crypto.randomUUID(),
              tenantA,
              sharedInvoiceNumber,
            ),
          ),
        '23505',
      );
    });

    it('isolates GET /api/billing/subscriptions and GET /api/billing/subscriptions/[id] across tenants and validates UUIDs', async () => {
      await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO public.tenant_module_subscriptions
             (id, tenant_id, module_code, plan_tier, billing_cycle, base_price, start_date, next_billing_date)
           VALUES ($1::uuid, $2, 'LOGISTICS', 'ENTERPRISE', 'MONTHLY', 1000, CURRENT_DATE, CURRENT_DATE + 30)`,
          crypto.randomUUID(),
          tenantA,
        ),
      );
      await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO public.tenant_module_subscriptions
             (id, tenant_id, module_code, plan_tier, billing_cycle, base_price, start_date, next_billing_date)
           VALUES ($1::uuid, $2, 'LEASING', 'PRO', 'MONTHLY', 2000, CURRENT_DATE, CURRENT_DATE + 30)`,
          crypto.randomUUID(),
          tenantB,
        ),
      );

      // Tenant A list
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const resListA = await subscriptionsGet(new NextRequest('http://localhost/api/billing/subscriptions'));
      expect(resListA.status).toBe(200);
      const bodyListA = await resListA.json();
      expect((bodyListA.platformInvoices as Array<{ id: string }>).map((i) => i.id)).toContain(invAId);
      expect((bodyListA.platformInvoices as Array<{ id: string }>).map((i) => i.id)).not.toContain(invBId);

      // Tenant B list
      setAuth({ tenantId: tenantB, userId: userB, role: 'TENANT_ADMIN' });
      const resListB = await subscriptionsGet(new NextRequest('http://localhost/api/billing/subscriptions'));
      expect(resListB.status).toBe(200);
      const bodyListB = await resListB.json();
      expect((bodyListB.platformInvoices as Array<{ id: string }>).map((i) => i.id)).toContain(invBId);
      expect((bodyListB.platformInvoices as Array<{ id: string }>).map((i) => i.id)).not.toContain(invAId);

      // Direct by ID: Tenant A sees invAId (200), Tenant B gets 404 on invAId, and invalid UUID returns 400
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const resOwn = await subscriptionByIdGet(
        new NextRequest(`http://localhost/api/billing/subscriptions/${invAId}`),
        { params: Promise.resolve({ id: invAId }) },
      );
      expect(resOwn.status).toBe(200);

      setAuth({ tenantId: tenantB, userId: userB, role: 'TENANT_ADMIN' });
      const resCross = await subscriptionByIdGet(
        new NextRequest(`http://localhost/api/billing/subscriptions/${invAId}`),
        { params: Promise.resolve({ id: invAId }) },
      );
      expect(resCross.status).toBe(404);

      const resBadUuid = await subscriptionByIdGet(
        new NextRequest('http://localhost/api/billing/subscriptions/not-a-uuid'),
        { params: Promise.resolve({ id: 'not-a-uuid' }) },
      );
      expect(resBadUuid.status).toBe(400);
    });
  });

  // ============================================================================
  // Suite 4: Financial Transaction Integrity, Rollback, Concurrency & GL Reconciliation
  // ============================================================================
  describe('Suite 4 — Financial Transaction Integrity, Rollback, Concurrency & Reconciliation', () => {
    it('self-billing: empty-tenant GET -> 422, happy POST -> 201 + persisted, duplicate/locked POST -> non-200 rollback without 25P02', async () => {
      // Empty tenant GET -> 422
      setAuth({ tenantId: tenantB, userId: userB, role: 'TENANT_ADMIN' });
      const emptyGet = await selfBillingGet(new NextRequest('http://localhost/api/finance/self-billing'));
      expect(emptyGet.status).toBe(422);

      // Locked period on Tenant B -> POST returns 422 and persists 0 rows
      const nowDate = new Date();
      const lockedPeriodId = crypto.randomUUID();
      await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO finance_periods (id, tenant_id, fiscal_year, period_number, period_name, period_from, period_to, status)
           VALUES ($1::uuid, $2, $3, $4, 'Locked Current Period', CURRENT_DATE - 1, CURRENT_DATE + 1, 'LOCKED')`,
          lockedPeriodId,
          tenantB,
          nowDate.getUTCFullYear(),
          nowDate.getUTCMonth() + 1,
        ),
      );
      const lockedSbRes = await selfBillingPost(
        new NextRequest('http://localhost/api/finance/self-billing', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-user-id': userB },
          body: JSON.stringify({
            selfBillNumber: `SB-LOCKED-${RUN}`,
            carrierName: 'Locked Period Carrier',
            carrierTrn: '100987654321003',
            items: [
              {
                tripId: 'TRIP-L1',
                tripNumber: 'TRIP-L1',
                description: 'Locked test',
                serviceDate: nowDate.toISOString().slice(0, 10),
                quantity: 1,
                ratePerUnit: 500,
                vatRatePct: 5,
              },
            ],
          }),
        }),
      );
      expect(lockedSbRes.status).toBe(422);
      const tenantBPayables = await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS count FROM finance.finance_payables WHERE tenant_id = $1`,
          tenantB,
        ),
      );
      expect(Number(tenantBPayables[0]?.count ?? 0)).toBe(0);
      await withPlatformAdmin(basePrisma, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM finance_periods WHERE id = $1::uuid`, lockedPeriodId),
      );

      // Happy path POST as Tenant A
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const sbNum = `SB-M5R7-001-${RUN}`;
      const happyRes = await selfBillingPost(
        new NextRequest('http://localhost/api/finance/self-billing', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-user-id': userA },
          body: JSON.stringify({
            selfBillNumber: sbNum,
            carrierName: 'Al Noor Freight LLC',
            carrierTrn: '100123456789003',
            items: [
              {
                tripId: 'TRIP-1',
                tripNumber: 'TRIP-2026-01',
                description: 'Dubai to Abu Dhabi freight',
                serviceDate: '2026-11-18',
                quantity: 1,
                ratePerUnit: 1000,
                vatRatePct: 5,
              },
            ],
          }),
        }),
      );
      expect(happyRes.status).toBe(201);
      const happyJson = await happyRes.json();
      expect(happyJson.success).toBe(true);
      expect(happyJson.data.selfBillNumber).toBe(sbNum);

      // Persisted in finance.finance_payables and visible via GET (200)
      const getAfterHappy = await selfBillingGet(new NextRequest('http://localhost/api/finance/self-billing'));
      expect(getAfterHappy.status).toBe(200);
      const getAfterJson = await getAfterHappy.json();
      expect(
        (getAfterJson.invoices as Array<{ selfBillNumber: string }>).some(
          (i) => i.selfBillNumber === sbNum,
        ),
      ).toBe(true);

      // Duplicate selfBillNumber -> MUST return 409 (never synthetic 200) and persist 0 extra rows
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const dupRes = await selfBillingPost(
          new NextRequest('http://localhost/api/finance/self-billing', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-user-id': userA },
            body: JSON.stringify({
              selfBillNumber: sbNum,
              carrierName: 'Al Noor Freight LLC',
              carrierTrn: '100123456789003',
              items: [
                {
                  tripId: 'TRIP-2',
                  tripNumber: 'TRIP-2026-02',
                  description: 'Duplicate attempt',
                  serviceDate: '2026-11-18',
                  quantity: 1,
                  ratePerUnit: 500,
                  vatRatePct: 5,
                },
              ],
            }),
          }),
        );
        expect(dupRes.status).toBe(409);

        // Follow-up GET succeeds cleanly without 25P02
        const followUpGet = await selfBillingGet(new NextRequest('http://localhost/api/finance/self-billing'));
        expect(followUpGet.status).toBe(200);
        const errLogs = errSpy.mock.calls.flat().map(String).join('\n');
        expect(errLogs).not.toMatch(/25P02/);
      } finally {
        errSpy.mockRestore();
      }

      const dbCount = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS count FROM finance.finance_payables WHERE tenant_id = $1 AND payable_number = $2`,
          tenantA,
          sbNum,
        ),
      );
      expect(Number(dbCount[0]?.count ?? 0)).toBe(1);
    });

    it('5-way concurrent POST /api/finance/self-billing with identical selfBillNumber: 1x 201, 4x 409, DB count = 1', async () => {
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const raceNo = `SB-M5R7-RACE-${RUN}`;

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let responses: Response[];
      try {
        responses = await Promise.all(
          Array.from({ length: 5 }, (_, idx) =>
            selfBillingPost(
              new NextRequest('http://localhost/api/finance/self-billing', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-user-id': userA },
                body: JSON.stringify({
                  selfBillNumber: raceNo,
                  carrierName: `Race Carrier ${idx}`,
                  carrierTrn: '100123456789003',
                  items: [
                    {
                      tripId: `T-${idx}`,
                      tripNumber: `TRIP-R-${idx}`,
                      description: 'Concurrent self-bill',
                      serviceDate: '2026-11-18',
                      quantity: 1,
                      ratePerUnit: 500,
                      vatRatePct: 5,
                    },
                  ],
                }),
              }),
            ),
          ),
        );
      } finally {
        errSpy.mockRestore();
      }

      const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([201, 409, 409, 409, 409]);

      const countRows = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS count FROM finance.finance_payables WHERE tenant_id = $1 AND payable_number = $2`,
          tenantA,
          raceNo,
        ),
      );
      expect(Number(countRows[0]?.count ?? 0)).toBe(1);
    });

    it('enforces Maker-Checker SoD (403), 5-way concurrent journal post (1x 200, 4x 409), and 5-way concurrent reversal (1x 200, 4x 409)', async () => {
      // Maker userA creates a DRAFT JE
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const today = new Date().toISOString().slice(0, 10);
      const createRes = await journalsPost(
        new NextRequest('http://localhost/api/finance/journals', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            date: today,
            description: `M5R7 Concurrent Post/Rev ${RUN}`,
            lines: [
              { accountCode: '1110', debit: 1000, credit: 0 },
              { accountCode: '4110', debit: 0, credit: 1000 },
            ],
          }),
        }),
      );
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const jeId = String(created.id);

      // Maker userA self-post -> 403 Segregation of Duties
      const selfPostRes = await journalPostById(
        new NextRequest(`http://localhost/api/finance/journals/${jeId}/post`, { method: 'POST' }),
        { params: Promise.resolve({ id: jeId }) },
      );
      expect(selfPostRes.status).toBe(403);

      // Checker userA2 5-way concurrent post -> 1x 200, 4x 409
      setAuth({ tenantId: tenantA, userId: userA2, role: 'TENANT_ADMIN' });
      const postResponses = await Promise.all(
        Array.from({ length: 5 }, () =>
          journalPostById(
            new NextRequest(`http://localhost/api/finance/journals/${jeId}/post`, { method: 'POST' }),
            { params: Promise.resolve({ id: jeId }) },
          ),
        ),
      );
      expect(postResponses.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409, 409, 409, 409]);

      const postAudits = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS count FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2 AND action = 'UPDATE'`,
          tenantA,
          jeId,
        ),
      );
      expect(Number(postAudits[0]?.count ?? 0)).toBe(1);

      // Checker userA2 5-way concurrent reversal -> 1x 200, 4x 409, 1 -REV JE
      const revResponses = await Promise.all(
        Array.from({ length: 5 }, () =>
          journalEntryPatch(
            new NextRequest(`http://localhost/api/finance/journal-entries/${jeId}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json', 'x-user-id': userA2 },
              body: JSON.stringify({ action: 'reverse', reversalDate: today, reversedBy: userA2 }),
            }),
            { params: Promise.resolve({ id: jeId }) },
          ),
        ),
      );
      expect(revResponses.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409, 409, 409, 409]);

      const revRows = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string; je_number: string; status: string }>>(
          `SELECT id::text, je_number, status FROM finance_journal_entries WHERE tenant_id = $1 AND reversed_je_id = $2`,
          tenantA,
          jeId,
        ),
      );
      expect(revRows).toHaveLength(1);
      expect(revRows[0].je_number).toMatch(/-REV$/);
      expect(revRows[0].status).toBe('POSTED');
    });

    it('postOperationalJournalEntry deduplicates sequential and 5-way concurrent replays with identical idempotencyKey', async () => {
      const idemSeq = `M5R7_IDEM_SEQ_${RUN}`;
      const params = {
        tenantId: tenantA,
        narration: `Idempotent seq ${RUN}`,
        reference: `REF-SEQ-${RUN}`,
        sourceType: 'OPERATIONAL_TEST',
        sourceId: crypto.randomUUID(),
        idempotencyKey: idemSeq,
        lines: [
          { code: '1110', name: 'Cash in Hand', description: 'Debit cash', debit: 250, credit: 0 },
          { code: '4400', name: 'Staff Transport Revenue', description: 'Credit rev', debit: 0, credit: 250 },
        ],
      };

      const first = await withTenantRls(basePrisma, tenantA, (tx) =>
        postOperationalJournalEntry(tx, params),
      );
      const second = await withTenantRls(basePrisma, tenantA, (tx) =>
        postOperationalJournalEntry(tx, params),
      );
      expect(first).not.toBeNull();
      expect(first?.created).toBe(true);
      expect(second?.created).toBe(false);
      expect(second?.id).toBe(first?.id);

      // 5-way concurrent replay
      const idemRace = `M5R7_IDEM_RACE_${RUN}`;
      const raceSourceId = crypto.randomUUID();
      const raceResults = await Promise.all(
        Array.from({ length: 5 }, () =>
          withTenantRls(basePrisma, tenantA, (tx) =>
            postOperationalJournalEntry(tx, {
              tenantId: tenantA,
              narration: `Idempotent race ${RUN}`,
              reference: `REF-RACE-${RUN}`,
              sourceType: 'OPERATIONAL_TEST',
              sourceId: raceSourceId,
              idempotencyKey: idemRace,
              lines: [
                { code: '1110', name: 'Cash in Hand', description: 'Debit cash', debit: 300, credit: 0 },
                { code: '4400', name: 'Staff Transport Revenue', description: 'Credit rev', debit: 0, credit: 300 },
              ],
            }),
          ),
        ),
      );

      expect(raceResults.every((r) => r !== null)).toBe(true);
      const uniqueIds = new Set(raceResults.map((r) => r!.id));
      expect(uniqueIds.size).toBe(1);
      expect(raceResults.filter((r) => r!.created).length).toBe(1);
      expect(raceResults.filter((r) => !r!.created).length).toBe(4);

      const jeCount = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS count FROM finance_journal_entries WHERE tenant_id = $1 AND idempotency_key = $2`,
          tenantA,
          idemRace,
        ),
      );
      expect(Number(jeCount[0]?.count ?? 0)).toBe(1);
    });

    it('POST /api/finance/credit-notes/partial rejects over-balance (422), never inflates paid_amount, and keeps GL balanced under concurrency', async () => {
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const invId = crypto.randomUUID();

      await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO finance_invoices
             (id, invoice_number, client_name, subtotal, vat_rate, vat_amount, total_amount, paid_amount, payment_status, module, service_type, issue_date, tenant_id)
           VALUES ($1::uuid, $2, 'CN Partial Client', 100, 5, 5, 105, 0, 'SENT', 'GENERAL', 'GENERAL', CURRENT_DATE, $3)`,
          invId,
          `INV-CNP-${RUN}`,
          tenantA,
        ),
      );

      // Over-balance single request -> 422
      const overRes = await creditNotesPartialPost(
        new NextRequest('http://localhost/api/finance/credit-notes/partial', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ invoiceId: invId, amount: 150 }),
        }),
      );
      expect(overRes.status).toBe(422);

      // Concurrent partial credit notes exhausting remaining balance
      const cnResponses = await Promise.all([
        creditNotesPartialPost(
          new NextRequest('http://localhost/api/finance/credit-notes/partial', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ invoiceId: invId, amount: 52.5 }),
          }),
        ),
        creditNotesPartialPost(
          new NextRequest('http://localhost/api/finance/credit-notes/partial', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ invoiceId: invId, amount: 52.5 }),
          }),
        ),
      ]);

      for (const r of cnResponses) {
        expect(r.status).toBe(201);
        const body = await r.json();
        expect(body.glPosted).toBe(true);
      }

      // paid_amount on invoice must NEVER be inflated by credit notes
      const [invRow] = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ paid_amount: string }>>(
          `SELECT paid_amount::text FROM finance_invoices WHERE id = $1::uuid`,
          invId,
        ),
      );
      expect(Number(invRow?.paid_amount ?? -1)).toBe(0);

      // Every GL journal entry created for these partial credit notes must be balanced
      const glChecks = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ je_id: string; dr: string; cr: string }>>(
          `SELECT je.id::text AS je_id,
                  COALESCE(SUM(jl.debit_amount), 0)::text AS dr,
                  COALESCE(SUM(jl.credit_amount), 0)::text AS cr
             FROM finance_journal_entries je
             JOIN finance_journal_lines jl ON jl.journal_entry_id = je.id
            WHERE je.tenant_id = $1
              AND je.source_type = 'CREDIT_NOTE'
              AND je.source_id IN (SELECT id::text FROM finance_credit_notes WHERE original_invoice_id = $2)
            GROUP BY je.id`,
          tenantA,
          invId,
        ),
      );
      expect(glChecks.length).toBeGreaterThanOrEqual(2);
      for (const g of glChecks) {
        expect(Number(g.dr)).toBeCloseTo(Number(g.cr), 2);
        expect(Number(g.dr)).toBeGreaterThan(0);
      }
    });

    it('POST /api/finance/journal-entries rejects header/missing CoA accounts (422) and persists 0 JE header rows', async () => {
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const narrationHeader = `M5R7 Header Account Rollback ${RUN}`;
      const narrationMissing = `M5R7 Missing Account Rollback ${RUN}`;

      // 1000 is summary header (is_header = true)
      const resHeader = await journalEntriesPost(
        new NextRequest('http://localhost/api/finance/journal-entries', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            narration: narrationHeader,
            lines: [
              { accountCode: '1110', debitAmount: 100, creditAmount: 0 },
              { accountCode: '1000', debitAmount: 0, creditAmount: 100 },
            ],
          }),
        }),
      );
      expect(resHeader.status).toBe(422);

      // 9999 does not exist in CoA
      const resMissing = await journalEntriesPost(
        new NextRequest('http://localhost/api/finance/journal-entries', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            narration: narrationMissing,
            lines: [
              { accountCode: '1110', debitAmount: 100, creditAmount: 0 },
              { accountCode: '9999', debitAmount: 0, creditAmount: 100 },
            ],
          }),
        }),
      );
      expect(resMissing.status).toBe(422);

      const persisted = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id::text FROM finance_journal_entries WHERE tenant_id = $1 AND narration IN ($2, $3)`,
          tenantA,
          narrationHeader,
          narrationMissing,
        ),
      );
      expect(persisted).toHaveLength(0);
    });

    it('GET /api/customers with FK-referenced cli-% customer returns 200, excludes cli-%, and avoids 25P02/23503', async () => {
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const cliCustomerId = `cli-legacy-${RUN}`;
      const validCustomerId = crypto.randomUUID();

      await withTenantRls(basePrisma, tenantA, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.customers (id, tenant_id, customer_type, name_en, customer_code, created_at, updated_at)
           VALUES ($1, $2, 'CORPORATE', 'Legacy CLI Customer', $3, NOW(), NOW())`,
          cliCustomerId,
          tenantA,
          `CLI-${RUN.slice(-6)}`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO public.customer_interactions (id, tenant_id, customer_id, interaction_type, occurred_at)
           VALUES ($1::uuid, $2, $3, 'CALL', NOW())`,
          crypto.randomUUID(),
          tenantA,
          cliCustomerId,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO public.customers (id, tenant_id, customer_type, name_en, customer_code, created_at, updated_at)
           VALUES ($1, $2, 'CORPORATE', $3, $4, NOW(), NOW())`,
          validCustomerId,
          tenantA,
          `Valid Customer ${RUN}`,
          `CORP-${RUN.slice(-6)}`,
        );
      });

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const custGetRes = await customersGet(new NextRequest('http://localhost/api/customers'));
        expect(custGetRes.status).toBe(200);
        const list = (await custGetRes.json()) as Array<{ id: string }>;
        expect(list.some((c) => c.id === validCustomerId)).toBe(true);
        expect(list.some((c) => c.id === cliCustomerId)).toBe(false);

        const errLogs = errSpy.mock.calls.flat().map(String).join('\n');
        expect(errLogs).not.toMatch(/25P02|23503/);
      } finally {
        errSpy.mockRestore();
      }
    });

    it('reconciles Balance Sheet, Trial Balance, and subledger payments, isolates cross-tenant GETs, and rejects malformed dates with 400', async () => {
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const invId = crypto.randomUUID();
      const today = new Date().toISOString().slice(0, 10);

      // Seed AR invoice 1000 + 50 VAT = 1050 and record payment via POST /api/finance/payments
      await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO finance_invoices
             (id, invoice_number, client_name, subtotal, vat_rate, vat_amount, total_amount, paid_amount, payment_status, module, service_type, issue_date, tenant_id)
           VALUES ($1::uuid, $2, 'Recon Client LLC', 1000, 5, 50, 1050, 0, 'SENT', 'GENERAL', 'GENERAL', $3::date, $4)`,
          invId,
          `INV-RECON-${RUN}`,
          today,
          tenantA,
        ),
      );

      const payRes = await paymentsPost(
        new NextRequest('http://localhost/api/finance/payments', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-user-id': userA },
          body: JSON.stringify({
            invoiceId: invId,
            amount: 1050,
            paymentDate: today,
            paymentMethod: 'BANK_TRANSFER',
            reference: `RECON-PAY-${RUN}`,
          }),
        }),
      );
      expect(payRes.status).toBe(201);
      const payJson = await payRes.json();
      expect(payJson.newInvoiceStatus).toBe('PAID');

      const [paidInv] = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ paid_amount: string; payment_status: string }>>(
          `SELECT paid_amount::text, payment_status FROM finance_invoices WHERE id = $1::uuid`,
          invId,
        ),
      );
      expect(Number(paidInv?.paid_amount ?? 0)).toBe(1050);
      expect(paidInv?.payment_status).toBe('PAID');

      // Post balanced operational GL entry matching the invoice + payment
      const glRes = await withTenantRls(basePrisma, tenantA, (tx) =>
        postOperationalJournalEntry(tx, {
          tenantId: tenantA,
          entryDate: today,
          narration: `Invoice & Payment Recon ${RUN}`,
          reference: `INV-RECON-${RUN}`,
          sourceType: 'INVOICE_SETTLEMENT',
          sourceId: invId,
          idempotencyKey: `RECON:${invId}`,
          lines: [
            { code: '1110', name: 'Cash in Hand', description: 'Cash receipt', debit: 1050, credit: 0 },
            { code: '4110', name: 'RAC — Daily Rental', description: 'Revenue', debit: 0, credit: 1000 },
            { code: '2120', name: 'VAT Payable (Output VAT)', description: 'Output VAT', debit: 0, credit: 50 },
          ],
        }),
      );
      expect(glRes?.created).toBe(true);

      // Tenant A Balance Sheet
      const bsResA = await balanceSheetGet(new NextRequest('http://localhost/api/finance/balance-sheet'));
      expect(bsResA.status).toBe(200);
      const bsA = await bsResA.json();
      expect(bsA.source).toBe('GL');
      expect(bsA.summary.isBalanced).toBe(true);
      expect(bsA.summary.difference).toBe(0);
      expect(bsA.assets.totalAssets).toBeCloseTo(bsA.summary.totalLiabEquity, 2);

      // Tenant A Trial Balance & reconciliation with finance_journal_lines
      const tbResA = await generalLedgerGet(
        new NextRequest('http://localhost/api/finance/general-ledger?type=trial_balance'),
      );
      expect(tbResA.status).toBe(200);
      const tbA = await tbResA.json();
      expect(tbA.totals.isBalanced).toBe(true);
      expect(tbA.totals.totalDebit).toBeCloseTo(tbA.totals.totalCredit, 2);

      const [rawGlSum] = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ total_dr: string; total_cr: string }>>(
          `SELECT COALESCE(SUM(jl.debit_amount), 0)::text AS total_dr,
                  COALESCE(SUM(jl.credit_amount), 0)::text AS total_cr
             FROM finance_journal_lines jl
             JOIN finance_journal_entries je ON je.id = jl.journal_entry_id
            WHERE je.tenant_id = $1 AND je.status = 'POSTED' AND je.deleted_at IS NULL`,
          tenantA,
        ),
      );
      expect(tbA.totals.totalDebit).toBeCloseTo(Number(rawGlSum?.total_dr ?? 0), 2);
      expect(tbA.totals.totalCredit).toBeCloseTo(Number(rawGlSum?.total_cr ?? 0), 2);

      // Cross-tenant GETs as Tenant B return 0 of Tenant A's data
      setAuth({ tenantId: tenantB, userId: userB, role: 'TENANT_ADMIN' });
      const bsResB = await balanceSheetGet(new NextRequest('http://localhost/api/finance/balance-sheet'));
      expect(bsResB.status).toBe(200);
      const bsB = await bsResB.json();
      expect(bsB.summary.totalAssets).toBe(0);
      expect(bsB.summary.totalLiabEquity).toBe(0);

      const cnResB = await creditNotesGet(new NextRequest('http://localhost/api/finance/credit-notes'));
      expect(cnResB.status).toBe(200);
      expect((await cnResB.json()).data).toEqual([]);

      const jeResB = await journalEntriesGet(new NextRequest('http://localhost/api/finance/journal-entries'));
      expect(jeResB.status).toBe(200);
      expect((await jeResB.json()).data).toEqual([]);

      const custResB = await customersGet(new NextRequest('http://localhost/api/customers'));
      expect(custResB.status).toBe(200);
      expect(await custResB.json()).toEqual([]);

      // Malformed date params return 400 cleanly
      const badBs = await balanceSheetGet(new NextRequest('http://localhost/api/finance/balance-sheet?asOf=bad'));
      expect(badBs.status).toBe(400);

      const badBsCalendar = await balanceSheetGet(
        new NextRequest('http://localhost/api/finance/balance-sheet?asOf=2026-02-30'),
      );
      expect(badBsCalendar.status).toBe(400);

      const badJeFrom = await journalEntriesGet(
        new NextRequest('http://localhost/api/finance/journal-entries?from=bad'),
      );
      expect(badJeFrom.status).toBe(400);

      const badJeTo = await journalEntriesGet(
        new NextRequest('http://localhost/api/finance/journal-entries?to=2026-13-01'),
      );
      expect(badJeTo.status).toBe(400);
    });

    it('POST /api/customers persists customer & linked lessee (201), PATCH updates updated_at (200), duplicate customerCode returns 409 without 25P02, and enforces cross-tenant RLS isolation', async () => {
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const custCodeA = `M5R7-CA-${RUN.slice(-6)}`;
      const custCodeB = `M5R7-CB-${RUN.slice(-6)}`;

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let createdId = '';
      try {
        // 1. Happy-path POST /api/customers (CORPORATE exercises SAVEPOINT sp_create_lessee too)
        const createRes = await customersPost(
          new NextRequest('http://localhost/api/customers', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              nameEn: `PG17 Verified Customer ${RUN}`,
              customerType: 'CORPORATE',
              customerCode: custCodeA,
              email: `cust-a-${RUN.slice(-6)}@example.com`,
              mobileNumber: '+971500000001',
              creditLimit: 25000,
              creditDays: 30,
              taxApplicable: true,
              tollExempt: false,
            }),
          }),
        );
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as {
          id: string;
          tenant_id: string;
          customer_code: string;
          name_en: string;
          created_at: string;
          updated_at: string;
        };
        expect(created.id).toBeTruthy();
        expect(created.tenant_id).toBe(tenantA);
        expect(created.customer_code).toBe(custCodeA);
        expect(Number.isNaN(Date.parse(created.created_at))).toBe(false);
        expect(Number.isNaN(Date.parse(created.updated_at))).toBe(false);
        createdId = created.id;

        // Linked lessee should have been created without triggering SAVEPOINT fallback
        const lesseeRows = await withTenantRls(basePrisma, tenantA, (tx) =>
          tx.$queryRawUnsafe<Array<{ id: string; customer_id: string }>>(
            `SELECT id, customer_id FROM public.lessees WHERE tenant_id = $1 AND customer_id = $2`,
            tenantA,
            createdId,
          ),
        );
        expect(lesseeRows).toHaveLength(1);
        expect(warnSpy.mock.calls.flat().map(String).join('\n')).not.toMatch(/42804|Could not auto-create lessee/);

        // 2. GET /api/customers as Tenant A includes the created customer
        const listResA = await customersGet(new NextRequest('http://localhost/api/customers'));
        expect(listResA.status).toBe(200);
        const listA = (await listResA.json()) as Array<{ id: string; customerCode: string }>;
        expect(listA.some((c) => c.id === createdId && c.customerCode === custCodeA)).toBe(true);

        // 3. PATCH /api/customers/[id] updates updated_at (timestamptz) cleanly without 42804
        const patchRes = await customerByIdPatch(
          new NextRequest(`http://localhost/api/customers/${createdId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              nameEn: `PG17 Updated Customer ${RUN}`,
              creditLimit: 35000,
            }),
          }),
          { params: Promise.resolve({ id: createdId }) },
        );
        expect(patchRes.status).toBe(200);
        const patched = (await patchRes.json()) as {
          id: string;
          name_en: string;
          credit_limit: string | number;
          updated_at: string;
        };
        expect(patched.name_en).toBe(`PG17 Updated Customer ${RUN}`);
        expect(Number(patched.credit_limit)).toBe(35000);
        expect(Date.parse(patched.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.created_at));

        // 4. Duplicate customerCode -> 409 without 25P02 and persists 0 extra rows
        const dupRes = await customersPost(
          new NextRequest('http://localhost/api/customers', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              nameEn: 'Duplicate Customer Attempt',
              customerType: 'CORPORATE',
              customerCode: custCodeA,
            }),
          }),
        );
        expect(dupRes.status).toBe(409);

        const countRows = await withTenantRls(basePrisma, tenantA, (tx) =>
          tx.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*) AS count FROM public.customers WHERE tenant_id = $1 AND customer_code = $2`,
            tenantA,
            custCodeA,
          ),
        );
        expect(Number(countRows[0]?.count ?? 0)).toBe(1);

        // Follow-up GET succeeds cleanly without 25P02
        const followUpGet = await customersGet(new NextRequest('http://localhost/api/customers'));
        expect(followUpGet.status).toBe(200);
        const errLogs = errSpy.mock.calls.flat().map(String).join('\n');
        expect(errLogs).not.toMatch(/25P02|42804/);
      } finally {
        errSpy.mockRestore();
        warnSpy.mockRestore();
      }

      // 5. Cross-tenant RLS isolation under Tenant B
      setAuth({ tenantId: tenantB, userId: userB, role: 'TENANT_ADMIN' });
      const listResB = await customersGet(new NextRequest('http://localhost/api/customers'));
      expect(listResB.status).toBe(200);
      const listB = (await listResB.json()) as Array<{ id: string }>;
      expect(listB.some((c) => c.id === createdId)).toBe(false);

      const crossGetById = await customerByIdGet(
        new NextRequest(`http://localhost/api/customers/${createdId}`),
        { params: Promise.resolve({ id: createdId }) },
      );
      expect(crossGetById.status).toBe(404);

      const directCrossRows = await withTenantRls(basePrisma, tenantB, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM public.customers WHERE id = $1`,
          createdId,
        ),
      );
      expect(directCrossRows).toHaveLength(0);

      // Tenant B can create & soft-delete its own customer cleanly
      const createResB = await customersPost(
        new NextRequest('http://localhost/api/customers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            nameEn: `PG17 Tenant B Customer ${RUN}`,
            customerType: 'INDIVIDUAL',
            customerCode: custCodeB,
          }),
        }),
      );
      expect(createResB.status).toBe(201);
      const createdB = (await createResB.json()) as { id: string; tenant_id: string };
      expect(createdB.tenant_id).toBe(tenantB);

      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const listAfterB = await customersGet(new NextRequest('http://localhost/api/customers'));
      expect(listAfterB.status).toBe(200);
      expect(((await listAfterB.json()) as Array<{ id: string }>).some((c) => c.id === createdB.id)).toBe(false);

      setAuth({ tenantId: tenantB, userId: userB, role: 'TENANT_ADMIN' });
      const delResB = await customerByIdDelete(
        new NextRequest(`http://localhost/api/customers/${createdB.id}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: createdB.id }) },
      );
      expect(delResB.status).toBe(200);
      const listAfterDelB = await customersGet(new NextRequest('http://localhost/api/customers'));
      expect(listAfterDelB.status).toBe(200);
      expect(((await listAfterDelB.json()) as Array<{ id: string }>).some((c) => c.id === createdB.id)).toBe(false);
    });
  });

  // ============================================================================
  // Suite 5: M5-R7 Iteration 2 PG17 Adversarial Verification
  // ============================================================================
  describe('Suite 5 — Iteration 2 PG17 Customer Index, Auto-Invoice & Credit Note Concurrency', () => {
    it('(a) allows identical customerCode across Tenant A and Tenant B via POST /api/customers (201/201, zero 23505)', async () => {
      const sharedCustCode = `SHARED-${RUN.slice(-8)}`;

      // Tenant A creates customer with sharedCustCode -> 201
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const resA = await customersPost(
        new NextRequest('http://localhost/api/customers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            nameEn: `Cross-Tenant Shared Code A ${RUN}`,
            customerType: 'CORPORATE',
            customerCode: sharedCustCode,
          }),
        }),
      );
      expect(resA.status).toBe(201);
      const custA = (await resA.json()) as { id: string; tenant_id: string; customer_code: string };
      expect(custA.tenant_id).toBe(tenantA);
      expect(custA.customer_code).toBe(sharedCustCode);

      // Tenant B creates customer with identical sharedCustCode -> 201 (zero 23505)
      setAuth({ tenantId: tenantB, userId: userB, role: 'TENANT_ADMIN' });
      const resB = await customersPost(
        new NextRequest('http://localhost/api/customers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            nameEn: `Cross-Tenant Shared Code B ${RUN}`,
            customerType: 'CORPORATE',
            customerCode: sharedCustCode,
          }),
        }),
      );
      expect(resB.status).toBe(201);
      const custB = (await resB.json()) as { id: string; tenant_id: string; customer_code: string };
      expect(custB.tenant_id).toBe(tenantB);
      expect(custB.customer_code).toBe(sharedCustCode);
      expect(custB.id).not.toBe(custA.id);

      // Same-tenant duplicate in Tenant B still returns 409
      const dupB = await customersPost(
        new NextRequest('http://localhost/api/customers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            nameEn: `Cross-Tenant Dup B ${RUN}`,
            customerType: 'CORPORATE',
            customerCode: sharedCustCode,
          }),
        }),
      );
      expect(dupB.status).toBe(409);
    });

    it('(b) POST /api/billing/auto-invoice creates SUB-YYYYMM-0001 across 2 due tenants (COMPLETED) and recovers mid-loop SAVEPOINT failure (FAILED, zero 42883/25P02)', async () => {
      const ym = new Date().toISOString().slice(0, 7).replace('-', '');
      const expectedInvNo = `SUB-${ym}-0001`;
      const subAId = crypto.randomUUID();
      const subBId = crypto.randomUUID();

      // Clear any prior Suite 3 subscriptions and non-numeric SUB-YYYYMM-* invoices on tenantA/tenantB
      await withPlatformAdmin(basePrisma, async (tx) => {
        await tx.$executeRawUnsafe(
          `DELETE FROM public.tenant_module_subscriptions WHERE tenant_id = ANY($1::text[])`,
          [tenantA, tenantB],
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM public.platform_subscription_invoices WHERE tenant_id = ANY($1::text[]) AND invoice_number LIKE $2`,
          [tenantA, tenantB],
          `SUB-${ym}-%`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO public.tenant_module_subscriptions
             (id, tenant_id, module_code, plan_tier, billing_cycle, base_price, currency, start_date, next_billing_date, status)
           VALUES
             ($1::uuid, $2, 'LOGISTICS', 'ENTERPRISE', 'MONTHLY', 1000, 'AED', CURRENT_DATE - 30, CURRENT_DATE, 'ACTIVE'),
             ($3::uuid, $4, 'LEASING', 'PRO', 'MONTHLY', 2000, 'AED', CURRENT_DATE - 30, CURRENT_DATE, 'ACTIVE')`,
          subAId,
          tenantA,
          subBId,
          tenantB,
        );
      });

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        setAuth({ tenantId: tenantA, userId: userA, role: 'SUPER_ADMIN' });
        const runRes = await autoInvoicePost(
          new NextRequest('http://localhost/api/billing/auto-invoice', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-tenant-id': tenantA,
              'x-user-id': userA,
              'x-user-role': 'SUPER_ADMIN',
            },
            body: JSON.stringify({ action: 'run_billing' }),
          }),
        );
        expect(runRes.status).toBe(200);
        const runJson = (await runRes.json()) as {
          success: boolean;
          run_id: string;
          invoices_created: number;
          total_tenants: number;
          errors: Array<{ subscription_id: string; error: string }>;
        };
        createdBillingRunIds.push(runJson.run_id);
        expect(runJson.success).toBe(true);
        expect(runJson.invoices_created).toBe(2);
        expect(runJson.total_tenants).toBe(2);
        expect(runJson.errors).toEqual([]);

        const [runRow1] = await withPlatformAdmin(basePrisma, (tx) =>
          tx.$queryRawUnsafe<Array<{ status: string; invoices_created: number }>>(
            `SELECT status, invoices_created FROM public.billing_runs WHERE id = $1::uuid`,
            runJson.run_id,
          ),
        );
        expect(runRow1?.status).toBe('COMPLETED');
        expect(Number(runRow1?.invoices_created)).toBe(2);

        const invRows = await withPlatformAdmin(basePrisma, (tx) =>
          tx.$queryRawUnsafe<Array<{ tenant_id: string; invoice_number: string }>>(
            `SELECT tenant_id, invoice_number FROM public.platform_subscription_invoices
              WHERE tenant_id = ANY($1::text[]) AND invoice_number = $2
              ORDER BY tenant_id`,
            [tenantA, tenantB],
            expectedInvNo,
          ),
        );
        expect(invRows).toHaveLength(2);

        // Mid-loop SAVEPOINT failure & recovery: poison Tenant A invoice_number format
        await withPlatformAdmin(basePrisma, async (tx) => {
          await tx.$executeRawUnsafe(
            `UPDATE public.tenant_module_subscriptions
                SET next_billing_date = CURRENT_DATE
              WHERE id = ANY($1::uuid[])`,
            [subAId, subBId],
          );
          await tx.$executeRawUnsafe(
            `INSERT INTO public.platform_subscription_invoices
               (id, tenant_id, invoice_number, client_name, issue_date, due_date, subtotal, vat_rate, vat_amount, total_amount)
             VALUES ($1::uuid, $2, $3, 'Poison Invoice', CURRENT_DATE, CURRENT_DATE + 30, 100, 5, 5, 105)`,
            crypto.randomUUID(),
            tenantA,
            `SUB-${ym}-POISON`,
          );
        });

        const failRunRes = await autoInvoicePost(
          new NextRequest('http://localhost/api/billing/auto-invoice', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-tenant-id': tenantA,
              'x-user-id': userA,
              'x-user-role': 'SUPER_ADMIN',
            },
            body: JSON.stringify({ action: 'run_billing' }),
          }),
        );
        expect(failRunRes.status).toBe(200);
        const failRunJson = (await failRunRes.json()) as {
          success: boolean;
          run_id: string;
          invoices_created: number;
          errors: Array<{ subscription_id: string; error: string }>;
        };
        createdBillingRunIds.push(failRunJson.run_id);
        expect(failRunJson.success).toBe(true);
        expect(failRunJson.invoices_created).toBe(1);
        expect(failRunJson.errors).toHaveLength(1);
        expect(failRunJson.errors[0].subscription_id).toBe(subAId);

        const [runRow2] = await withPlatformAdmin(basePrisma, (tx) =>
          tx.$queryRawUnsafe<Array<{ status: string; invoices_created: number }>>(
            `SELECT status, invoices_created FROM public.billing_runs WHERE id = $1::uuid`,
            failRunJson.run_id,
          ),
        );
        expect(runRow2?.status).toBe('FAILED');
        expect(Number(runRow2?.invoices_created)).toBe(1);

        const errLogs = errSpy.mock.calls.flat().map(String).join('\n');
        expect(errLogs).not.toMatch(/42883|25P02/);
      } finally {
        errSpy.mockRestore();
        await withPlatformAdmin(basePrisma, (tx) =>
          tx.$executeRawUnsafe(
            `DELETE FROM public.tenant_module_subscriptions WHERE id = ANY($1::uuid[])`,
            [subAId, subBId],
          ),
        );
      }
    });

    it('(c) PATCH /api/finance/credit-notes/[id] (action: apply) sets PARTIAL/PAID without mutating paid_amount and returns 409 on double-apply', async () => {
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const invId = crypto.randomUUID();
      await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO finance_invoices
             (id, invoice_number, client_name, subtotal, vat_rate, vat_amount, total_amount, paid_amount, payment_status, module, service_type, issue_date, tenant_id)
           VALUES ($1::uuid, $2, 'CN Apply Client', 1000, 5, 50, 1050, 0, 'SENT', 'GENERAL', 'GENERAL', CURRENT_DATE, $3)`,
          invId,
          `INV-CNAPPLY-${RUN}`,
          tenantA,
        ),
      );

      // Create first DRAFT credit note of 500 AED
      const create1 = await creditNotesPost(
        new NextRequest('http://localhost/api/finance/credit-notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            invoiceId: invId,
            amount: 500,
            reason: 'Partial discount credit',
          }),
        }),
      );
      expect(create1.status).toBe(201);
      const cn1 = (await create1.json()) as { id: string; status: string };

      // Apply 500 -> invoice becomes PARTIAL, paid_amount stays 0
      const apply1 = await creditNoteByIdPatch(
        new NextRequest(`http://localhost/api/finance/credit-notes/${cn1.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'apply', invoiceId: invId, appliedAmount: 500 }),
        }),
        { params: Promise.resolve({ id: cn1.id }) },
      );
      expect(apply1.status).toBe(200);
      const applied1 = (await apply1.json()) as { status: string; applied_amount: string };
      expect(applied1.status).toBe('APPLIED');
      expect(Number(applied1.applied_amount)).toBe(500);

      const [invAfter1] = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ payment_status: string; paid_amount: string }>>(
          `SELECT payment_status, paid_amount::text FROM finance_invoices WHERE id = $1::uuid`,
          invId,
        ),
      );
      expect(invAfter1?.payment_status).toBe('PARTIAL');
      expect(Number(invAfter1?.paid_amount ?? -1)).toBe(0);

      // Double-apply on cn1 -> 409 Conflict
      const doubleApply = await creditNoteByIdPatch(
        new NextRequest(`http://localhost/api/finance/credit-notes/${cn1.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'apply', invoiceId: invId, appliedAmount: 500 }),
        }),
        { params: Promise.resolve({ id: cn1.id }) },
      );
      expect(doubleApply.status).toBe(409);

      // Create & apply second credit note of 550 AED -> invoice becomes PAID, paid_amount stays 0
      const create2 = await creditNotesPost(
        new NextRequest('http://localhost/api/finance/credit-notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            invoiceId: invId,
            amount: 550,
            reason: 'Remaining balance credit',
          }),
        }),
      );
      expect(create2.status).toBe(201);
      const cn2 = (await create2.json()) as { id: string };

      const apply2 = await creditNoteByIdPatch(
        new NextRequest(`http://localhost/api/finance/credit-notes/${cn2.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'apply', appliedToInvoiceId: invId, appliedAmount: 550 }),
        }),
        { params: Promise.resolve({ id: cn2.id }) },
      );
      expect(apply2.status).toBe(200);

      const [invAfter2] = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ payment_status: string; paid_amount: string }>>(
          `SELECT payment_status, paid_amount::text FROM finance_invoices WHERE id = $1::uuid`,
          invId,
        ),
      );
      expect(invAfter2?.payment_status).toBe('PAID');
      expect(Number(invAfter2?.paid_amount ?? -1)).toBe(0);
    });

    it('(d) 5-way concurrent POST /api/finance/credit-notes/partial (80 AED each on 105 AED invoice): 1x 201, 4x 422, SUM = 80.00', async () => {
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const invId = crypto.randomUUID();
      await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO finance_invoices
             (id, invoice_number, client_name, subtotal, vat_rate, vat_amount, total_amount, paid_amount, payment_status, module, service_type, issue_date, tenant_id)
           VALUES ($1::uuid, $2, 'Partial Race Client', 100, 5, 5, 105, 0, 'SENT', 'GENERAL', 'GENERAL', CURRENT_DATE, $3)`,
          invId,
          `INV-PRACE-${RUN}`,
          tenantA,
        ),
      );

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          creditNotesPartialPost(
            new NextRequest('http://localhost/api/finance/credit-notes/partial', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ invoiceId: invId, amount: 80 }),
            }),
          ),
        ),
      );

      const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([201, 422, 422, 422, 422]);

      const [sumRow] = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ total: string }>>(
          `SELECT COALESCE(SUM(total_amount), 0)::text AS total
             FROM finance_credit_notes
            WHERE original_invoice_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          invId,
          tenantA,
        ),
      );
      expect(Number(sumRow?.total ?? 0)).toBeCloseTo(80.0, 2);
    });

    it('(e) 3-way concurrent POST /api/finance/credit-notes (80 AED each on 105 AED invoice): 1x 201, 2x 422, SUM = 80.00', async () => {
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const invId = crypto.randomUUID();
      await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO finance_invoices
             (id, invoice_number, client_name, subtotal, vat_rate, vat_amount, total_amount, paid_amount, payment_status, module, service_type, issue_date, tenant_id)
           VALUES ($1::uuid, $2, 'CN Race Client', 100, 5, 5, 105, 0, 'SENT', 'GENERAL', 'GENERAL', CURRENT_DATE, $3)`,
          invId,
          `INV-CNRACE-${RUN}`,
          tenantA,
        ),
      );

      const responses = await Promise.all(
        Array.from({ length: 3 }, () =>
          creditNotesPost(
            new NextRequest('http://localhost/api/finance/credit-notes', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                invoiceId: invId,
                amount: 80,
                reason: 'Concurrent credit note race test',
              }),
            }),
          ),
        ),
      );

      const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([201, 422, 422]);

      const [sumRow] = await withTenantRls(basePrisma, tenantA, (tx) =>
        tx.$queryRawUnsafe<Array<{ total: string }>>(
          `SELECT COALESCE(SUM(total_amount), 0)::text AS total
             FROM finance_credit_notes
            WHERE original_invoice_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          invId,
          tenantA,
        ),
      );
      expect(Number(sumRow?.total ?? 0)).toBeCloseTo(80.0, 2);
    });

    it('(f) GET /api/finance/collections/summary returns 200 on PG17 with accurate applied credit notes and zero 42703/25P02', async () => {
      setAuth({ tenantId: tenantA, userId: userA, role: 'TENANT_ADMIN' });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await collectionsSummaryGet(
          new NextRequest('http://localhost/api/finance/collections/summary'),
        );
        expect(res.status).toBe(200);
        const summary = (await res.json()) as {
          ok: boolean;
          cashCollected: number;
          creditNotesApplied: number;
          totalSettlement: number;
        };
        expect(summary.ok).toBe(true);

        const [expectedRow] = await withTenantRls(basePrisma, tenantA, (tx) =>
          tx.$queryRawUnsafe<Array<{ total_cn: string; total_cash: string }>>(
            `SELECT
               (SELECT COALESCE(SUM(COALESCE(applied_amount, total_amount)), 0)::text
                  FROM finance_credit_notes
                 WHERE tenant_id = $1 AND deleted_at IS NULL AND status = 'APPLIED') AS total_cn,
               (SELECT COALESCE(SUM(paid_amount), 0)::text
                  FROM finance_invoices
                 WHERE tenant_id = $1 AND deleted_at IS NULL) AS total_cash`,
            tenantA,
          ),
        );
        const expectedCn = Number(expectedRow?.total_cn ?? 0);
        const expectedCash = Number(expectedRow?.total_cash ?? 0);
        expect(expectedCn).toBeGreaterThan(0);
        expect(summary.creditNotesApplied).toBeCloseTo(expectedCn, 2);
        expect(summary.cashCollected).toBeCloseTo(expectedCash, 2);
        expect(summary.totalSettlement).toBeCloseTo(expectedCash + expectedCn, 2);

        const errLogs = errSpy.mock.calls.flat().map(String).join('\n');
        expect(errLogs).not.toMatch(/42703|25P02/);
      } finally {
        errSpy.mockRestore();
      }
    });
  });
});
