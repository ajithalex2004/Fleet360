/**
 * Live PostgreSQL 17 Integration Suite — RAC Remediation (Phases 1–4)
 *
 * Executes against real PostgreSQL (`fleet360_e2e_test` as non-superuser `fleet360_app`)
 * to prove database-level enforcement of:
 *   1. Non-superuser runtime session (`rolsuper = false`, `rolbypassrls = false`) & `FORCE ROW LEVEL SECURITY`
 *      on all 9 RAC tables (`rac_portal_users`, `rac_card_preauths`, `pricing_rules`, `salik_accounts`,
 *      `rental_channel_configs`, `rental_additional_drivers`, `rental_regulatory_reports`,
 *      `rental_cross_border_permits`, `rental_immobilizer_commands`).
 *   2. Cross-tenant SELECT invisibility, 0-row UPDATE/DELETE, 0-row un-scoped raw query, and
 *      `WITH CHECK` INSERT rejection (`42501`) across Tenant A vs Tenant B.
 *   3. Per-tenant composite UNIQUE indexes (`(tenant_id, invoice_no)`, `(tenant_id, booking_ref)`,
 *      `(tenant_id, branch_code)`, `(tenant_id, code)`, `(tenant_id, event_code)`) allowing identical
 *      codes across tenants while blocking intra-tenant duplicates (`23505`).
 *   4. Walk-in counter Rental Agreement (`booking_id IS NULL`) + live `queueUaeRegulatoryReportInTx`
 *      persisting a `SANDBOX_ACKNOWLEDGED` manifest row in `rental_regulatory_reports`.
 *   5. Seeded RAC General Ledger CoA template accounts `2160` & `4140` in `finance.finance_coa_template`.
 */

import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma as basePrisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { queueUaeRegulatoryReportInTx } from '@/lib/rental/uae-regulatory-reporting';

const hasDb =
  Boolean(process.env.DATABASE_URL) &&
  !String(process.env.DATABASE_URL).includes('invalid.localhost');

const RAC_FORCE_RLS_TABLES = [
  'rac_portal_users',
  'rac_card_preauths',
  'pricing_rules',
  'salik_accounts',
  'rental_channel_configs',
  'rental_additional_drivers',
  'rental_regulatory_reports',
  'rental_cross_border_permits',
  'rental_immobilizer_commands',
] as const;

describe.skipIf(!hasDb)('RAC Live PostgreSQL — FORCE RLS, Per-Tenant Uniques & Walk-In Lifecycle', () => {
  const runSuffix = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();

  let customerA = '';
  let customerB = '';
  let vehicleA = '';
  let walkInAgreementA = '';
  let walkInAgreementB = '';

  const idsA: Record<string, string> = {};
  const idsB: Record<string, string> = {};

  beforeAll(async () => {
    await withPlatformAdmin(basePrisma, async (tx) => {
      await tx.tenant.createMany({
        data: [
          {
            id: tenantA,
            name: `RAC Live PG Tenant A ${runSuffix}`,
            code: `RAC-PGA-${runSuffix.slice(-10)}`,
            domain: `rac-pga-${runSuffix}.example.com`,
            plan: 'ENTERPRISE',
            isActive: true,
          },
          {
            id: tenantB,
            name: `RAC Live PG Tenant B ${runSuffix}`,
            code: `RAC-PGB-${runSuffix.slice(-10)}`,
            domain: `rac-pgb-${runSuffix}.example.com`,
            plan: 'ENTERPRISE',
            isActive: true,
          },
        ],
      });
    });

    // Seed Tenant A data strictly through `withTenantRls(tenantA)`
    await withTenantRls(basePrisma, tenantA, async (tx) => {
      const cA = await tx.rentalCustomer.create({
        data: {
          tenantId: tenantA,
          fullName: 'Omar Al Falasi',
          customerType: 'INDIVIDUAL',
          nationality: 'United Arab Emirates',
          emiratesId: '784-1990-1234567-1',
          drivingLicenseNo: `DXB-LIC-A-${runSuffix.slice(-6)}`,
          licenseExpiry: new Date('2029-12-31T00:00:00Z'),
          phone: '+971501112233',
          email: `omar-${runSuffix}@tenant-a.ae`,
        },
      });
      customerA = cA.id;

      vehicleA = crypto.randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO vehicles (id, tenant_id, make, model, plate_number, status)
         VALUES ($1, $2, 'Toyota', 'Land Cruiser', $3, 'AVAILABLE')`,
        vehicleA,
        tenantA,
        `DXB-A-${runSuffix.slice(-5)}`,
      );

      walkInAgreementA = crypto.randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO rental_agreements (
           id, tenant_id, booking_id, agreement_no, customer_id, customer_name,
           vehicle_id, start_date, end_date, pickup_location_code, dropoff_location_code, status
         ) VALUES ($1, $2, NULL, $3, $4, 'Omar Al Falasi', $5, NOW(), NOW() + INTERVAL '4 days', 'DXB-T3', 'DXB-T3', 'ACTIVE')`,
        walkInAgreementA,
        tenantA,
        `AGR-SHARED-001`,
        customerA,
        vehicleA,
      );

      // Seed 1 row in each of the 9 RAC tables for Tenant A
      const portalRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO rac_portal_users (tenant_id, customer_id, email, full_name, role)
         VALUES ($1, $2, $3, 'Portal A User', 'RAC_B2B_ADMIN')
         RETURNING id::text AS id`,
        tenantA,
        customerA,
        `portal-shared-${runSuffix}@corp.ae`,
      );
      idsA.rac_portal_users = portalRows[0].id;

      const preauthRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO rac_card_preauths (tenant_id, customer_id, agreement_id, amount, currency, provider, authorization_code, status)
         VALUES ($1, $2, $3, 2500, 'AED', 'sandbox', 'AUTH-TENA01', 'AUTHORIZED')
         RETURNING id::text AS id`,
        tenantA,
        customerA,
        walkInAgreementA,
      );
      idsA.rac_card_preauths = preauthRows[0].id;

      idsA.pricing_rules = crypto.randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO pricing_rules (id, tenant_id, vehicle_category, base_daily_rate)
         VALUES ($1, $2, 'SUV', 420)`,
        idsA.pricing_rules,
        tenantA,
      );

      idsA.salik_accounts = crypto.randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO salik_accounts (id, tenant_id, tag_number)
         VALUES ($1, $2, $3)`,
        idsA.salik_accounts,
        tenantA,
        `SALIK-A-${runSuffix.slice(-6)}`,
      );

      const chRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO rental_channel_configs (tenant_id, channel_key, webhook_secret, is_active)
         VALUES ($1, 'BOOKING_COM', 'whsec_tenant_a_secret', true)
         RETURNING id::text AS id`,
        tenantA,
      );
      idsA.rental_channel_configs = chRows[0].id;

      const drvRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO rental_additional_drivers (tenant_id, agreement_id, full_name, driving_license_no, license_expiry, daily_fee, total_fee)
         VALUES ($1, $2, 'Saeed Al Maktoum', 'DXB-ADD-A1', '2029-06-30T00:00:00Z', 35, 140)
         RETURNING id::text AS id`,
        tenantA,
        walkInAgreementA,
      );
      idsA.rental_additional_drivers = drvRows[0].id;

      const reportRecord = await queueUaeRegulatoryReportInTx(tx, {
        tenantId: tenantA,
        agreementId: walkInAgreementA,
        eventType: 'HANDOVER',
        submittedBy: 'counter-agent-a',
      });
      expect(reportRecord).not.toBeNull();
      idsA.rental_regulatory_reports = reportRecord!.id;

      const permitRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO rental_cross_border_permits (
           tenant_id, permit_no, agreement_id, customer_id, vehicle_id,
           destination_country, departure_date, return_date, orange_card_fee, permit_fee, total_fee
         ) VALUES ($1, $2, $3, $4, $5, 'OMN', NOW(), NOW() + INTERVAL '3 days', 150, 200, 350)
         RETURNING id::text AS id`,
        tenantA,
        `NOC-OMN-${runSuffix.slice(-6)}`,
        walkInAgreementA,
        customerA,
        vehicleA,
      );
      idsA.rental_cross_border_permits = permitRows[0].id;

      const immRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO rental_immobilizer_commands (
           tenant_id, agreement_id, vehicle_id, action, status, reason, safety_interlock_passed, requested_by
         ) VALUES ($1, $2, $3, 'IMMOBILIZE', 'EXECUTED', 'Non-return breach test', true, 'ops-mgr-a')
         RETURNING id::text AS id`,
        tenantA,
        walkInAgreementA,
        vehicleA,
      );
      idsA.rental_immobilizer_commands = immRows[0].id;
    });

    // Seed Tenant B baseline customer & walk-in agreement via `withTenantRls(tenantB)`
    await withTenantRls(basePrisma, tenantB, async (tx) => {
      const cB = await tx.rentalCustomer.create({
        data: {
          tenantId: tenantB,
          fullName: 'Layla Al Nahyan',
          customerType: 'INDIVIDUAL',
          nationality: 'United Arab Emirates',
          emiratesId: '784-1992-7654321-2',
          drivingLicenseNo: `AUH-LIC-B-${runSuffix.slice(-6)}`,
          licenseExpiry: new Date('2030-05-15T00:00:00Z'),
          phone: '+971529998877',
          email: `layla-${runSuffix}@tenant-b.ae`,
        },
      });
      customerB = cB.id;

      walkInAgreementB = crypto.randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO rental_agreements (
           id, tenant_id, booking_id, agreement_no, customer_id, customer_name,
           start_date, end_date, pickup_location_code, dropoff_location_code, status
         ) VALUES ($1, $2, NULL, $3, $4, 'Layla Al Nahyan', NOW(), NOW() + INTERVAL '2 days', 'AUH-T1', 'AUH-T1', 'ACTIVE')`,
        walkInAgreementB,
        tenantB,
        `AGR-SHARED-001`,
        customerB,
      );

      const portalRowsB = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO rac_portal_users (tenant_id, customer_id, email, full_name, role)
         VALUES ($1, $2, $3, 'Portal B User', 'RAC_B2B_USER')
         RETURNING id::text AS id`,
        tenantB,
        customerB,
        `portal-shared-${runSuffix}@corp.ae`,
      );
      idsB.rac_portal_users = portalRowsB[0].id;
    });
  });

  afterAll(async () => {
    await withPlatformAdmin(basePrisma, async (tx) => {
      for (const tId of [tenantA, tenantB]) {
        await tx.$executeRawUnsafe(`DELETE FROM rental_immobilizer_commands WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM rental_cross_border_permits WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM rental_regulatory_reports WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM rental_additional_drivers WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM rental_channel_configs WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM salik_accounts WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM pricing_rules WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM rac_card_preauths WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM rac_portal_users WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM rental_invoices WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM rental_agreements WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM rental_bookings WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM rental_branches WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM rental_ancillaries WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM rate_events WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM vehicles WHERE tenant_id = $1`, tId);
        await tx.$executeRawUnsafe(`DELETE FROM rental_customers WHERE tenant_id = $1`, tId);
      }
      await tx.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    });
  });

  it('connects as a non-superuser role without BYPASSRLS and enforces FORCE RLS on all 9 RAC tables', async () => {
    const roleRows = await basePrisma.$queryRawUnsafe<
      Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
    >(
      `SELECT current_user, r.rolsuper, r.rolbypassrls
         FROM pg_roles r
        WHERE r.rolname = current_user`,
    );
    expect(roleRows).toHaveLength(1);
    expect(roleRows[0].rolsuper).toBe(false);
    expect(roleRows[0].rolbypassrls).toBe(false);

    const rlsRows = await basePrisma.$queryRawUnsafe<
      Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >(
      `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1::text[])`,
      [...RAC_FORCE_RLS_TABLES],
    );
    expect(rlsRows).toHaveLength(RAC_FORCE_RLS_TABLES.length);
    for (const row of rlsRows) {
      expect(row.relrowsecurity, `${row.relname} relrowsecurity`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} relforcerowsecurity`).toBe(true);
    }
  });

  it('enforces strict cross-tenant SELECT invisibility & 0-row raw query across all 9 RAC tables', async () => {
    // 1. Without `withTenantRls`, non-superuser `basePrisma` sees 0 rows in every table
    for (const table of RAC_FORCE_RLS_TABLES) {
      const unscoped = await basePrisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
        `SELECT COUNT(*)::bigint AS cnt FROM "${table}" WHERE id::text = $1`,
        idsA[table],
      );
      expect(Number(unscoped[0]?.cnt ?? 0), `unscoped SELECT on ${table}`).toBe(0);
    }

    // 2. Tenant B sees 0 of Tenant A's rows across all 9 tables, and cannot DELETE Tenant A's rows
    await withTenantRls(basePrisma, tenantB, async (tx) => {
      for (const table of RAC_FORCE_RLS_TABLES) {
        const crossRead = await tx.$queryRawUnsafe<Array<{ cnt: bigint }>>(
          `SELECT COUNT(*)::bigint AS cnt FROM "${table}" WHERE id::text = $1`,
          idsA[table],
        );
        expect(Number(crossRead[0]?.cnt ?? 0), `Tenant B reading Tenant A ${table}`).toBe(0);

        const crossDeleteCount = await tx.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE id::text = $1`,
          idsA[table],
        );
        expect(crossDeleteCount, `Tenant B deleting Tenant A ${table}`).toBe(0);
      }
    });

    // 3. Tenant A still sees 100% of its own rows intact
    await withTenantRls(basePrisma, tenantA, async (tx) => {
      for (const table of RAC_FORCE_RLS_TABLES) {
        const ownRead = await tx.$queryRawUnsafe<Array<{ cnt: bigint }>>(
          `SELECT COUNT(*)::bigint AS cnt FROM "${table}" WHERE id::text = $1`,
          idsA[table],
        );
        expect(Number(ownRead[0]?.cnt ?? 0), `Tenant A reading own ${table}`).toBe(1);
      }
    });
  });

  it('rejects cross-tenant INSERT spoofing via RLS WITH CHECK (42501) on RAC tables', async () => {
    await expect(
      withTenantRls(basePrisma, tenantA, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO pricing_rules (id, tenant_id, vehicle_category, base_daily_rate)
           VALUES ($1, $2, 'ECONOMY', 120)`,
          crypto.randomUUID(),
          tenantB, // Spoofing Tenant B inside Tenant A's RLS session!
        );
      }),
    ).rejects.toThrow(/row-level security policy/i);

    await expect(
      withTenantRls(basePrisma, tenantA, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO rental_regulatory_reports (tenant_id, agreement_id, authority, event_type, status)
           VALUES ($1, $2, 'RTA_TARRASHUD', 'HANDOVER', 'QUEUED')`,
          tenantB,
          walkInAgreementB,
        );
      }),
    ).rejects.toThrow(/row-level security policy/i);
  });

  it('allows identical business codes across Tenant A and Tenant B while blocking intra-tenant duplicates', async () => {
    const sharedInvoiceNo = `RINV-2026-${runSuffix.slice(-6)}`;
    const sharedBookingRef = `BK-2026-${runSuffix.slice(-6)}`;
    const sharedBranchCode = `DXB-T3-${runSuffix.slice(-4)}`;
    const sharedAncillaryCode = `CHILD_SEAT_${runSuffix.slice(-4)}`;
    const sharedEventCode = `GITEX_${runSuffix.slice(-4)}`;

    const insertSharedSet = async (tenantId: string, custId: string, agrId: string) => {
      await withTenantRls(basePrisma, tenantId, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO rental_invoices (
             id, tenant_id, invoice_no, agreement_id, customer_id, invoice_date, due_date, subtotal, total_amount
           ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '7 days', 1000, 1050)`,
          crypto.randomUUID(),
          tenantId,
          sharedInvoiceNo,
          agrId,
          custId,
        );

        await tx.$executeRawUnsafe(
          `INSERT INTO rental_bookings (
             id, tenant_id, booking_ref, customer_id, pickup_date, dropoff_date
           ) VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '3 days')`,
          crypto.randomUUID(),
          tenantId,
          sharedBookingRef,
          custId,
        );

        await tx.$executeRawUnsafe(
          `INSERT INTO rental_branches (tenant_id, branch_code, branch_name, emirate)
           VALUES ($1, $2, 'Dubai Airport T3', 'Dubai')`,
          tenantId,
          sharedBranchCode,
        );

        await tx.$executeRawUnsafe(
          `INSERT INTO rental_ancillaries (tenant_id, code, name_en, pricing_type, unit_price)
           VALUES ($1, $2, 'Child Safety Seat', 'PER_DAY', 35)`,
          tenantId,
          sharedAncillaryCode,
        );

        await tx.$executeRawUnsafe(
          `INSERT INTO rate_events (tenant_id, event_code, name, date_from, date_to, multiplier)
           VALUES ($1, $2, 'GITEX Peak Week', NOW(), NOW() + INTERVAL '5 days', 1.25)`,
          tenantId,
          sharedEventCode,
        );
      });
    };

    // Both Tenant A and Tenant B succeed with identical codes!
    await insertSharedSet(tenantA, customerA, walkInAgreementA);
    await insertSharedSet(tenantB, customerB, walkInAgreementB);

    // Intra-tenant duplicate inside Tenant A is rejected by composite unique index
    await expect(
      withTenantRls(basePrisma, tenantA, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO rental_invoices (
             id, tenant_id, invoice_no, agreement_id, customer_id, invoice_date, due_date, subtotal, total_amount
           ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '7 days', 500, 525)`,
          crypto.randomUUID(),
          tenantA,
          sharedInvoiceNo,
          walkInAgreementA,
          customerA,
        );
      }),
    ).rejects.toThrow(/23505|unique constraint|duplicate key/i);
  });

  it('persists walk-in agreements (booking_id IS NULL), regulatory manifests, and RAC CoA template accounts 2160 & 4140', async () => {
    await withTenantRls(basePrisma, tenantA, async (tx) => {
      const agr = await tx.rentalAgreement.findFirst({
        where: { id: walkInAgreementA, tenantId: tenantA },
      });
      expect(agr).not.toBeNull();
      expect(agr!.bookingId).toBeNull();

      const regRows = await tx.$queryRawUnsafe<
        Array<{ authority: string; event_type: string; status: string; external_ref: string | null }>
      >(
        `SELECT authority, event_type, status, external_ref
           FROM rental_regulatory_reports
          WHERE id::text = $1 AND tenant_id = $2`,
        idsA.rental_regulatory_reports,
        tenantA,
      );
      expect(regRows).toHaveLength(1);
      expect(regRows[0].authority).toBe('RTA_TARRASHUD');
      expect(regRows[0].event_type).toBe('HANDOVER');
      expect(regRows[0].status).toBe('SANDBOX_ACKNOWLEDGED');
      expect(regRows[0].external_ref).toMatch(/^TRD-SBX-/);
    });

    const coaRows = await basePrisma.$queryRawUnsafe<
      Array<{ account_code: string; account_name: string; account_type: string; normal_balance: string }>
    >(
      `SELECT account_code, account_name, account_type, normal_balance
         FROM finance.finance_coa_template
        WHERE account_code IN ('2160', '4140')
        ORDER BY account_code`,
    );
    expect(coaRows).toHaveLength(2);
    expect(coaRows[0]).toMatchObject({
      account_code: '2160',
      account_type: 'LIABILITY',
      normal_balance: 'CREDIT',
    });
    expect(coaRows[1]).toMatchObject({
      account_code: '4140',
      account_type: 'INCOME',
      normal_balance: 'CREDIT',
    });
  });
});
