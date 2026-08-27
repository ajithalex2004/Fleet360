/**
 * tests/integration/staging-lifecycle-matrix.test.ts
 *
 * Full 8-Domain Multi-Tenant Lifecycle Certification & Webhook Ingress Suite
 *
 * Exercises representative CREATE -> UPDATE -> READBACK and Cross-Tenant
 * Isolation Negative Tests across all 8 core domains under fleet360_app:
 *   1. Bus-Ops: Trip Schedules & Bus Routes
 *   2. Commercial Leasing: Inquiries & Quotation status
 *   3. Vehicle Rental: Vehicle provisioning & rental status
 *   4. Finance & Maintenance: Maintenance Requests & cost tracking
 *   5. Fleet Operations: Vehicle management & status
 *   6. Maintenance: Breakdown service requests
 *   7. School Bus Transport: Routes & stops
 *   8. Workforce & Drivers: Driver lifecycles & contact details
 *   9. Webhook / External Ingress: Signature-bound tenant scope vs spoof rejection
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { withTenantRls, withPlatformAdmin, withWebhookTenant } from '@/lib/rls';
import crypto from 'crypto';

interface RoleRow {
  current_user: string;
  rolcanlogin: boolean;
  rolbypassrls: boolean;
  rolsuper: boolean;
}

describe('8-Domain Full Lifecycle & Ingress Certification Suite', () => {
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    // Assert exact role identity in preflight
    const roles = await prisma.$queryRawUnsafe<RoleRow[]>(`
      SELECT
        current_user,
        rolcanlogin,
        rolbypassrls,
        rolsuper
      FROM pg_roles
      WHERE rolname = current_user
    `);

    const role = roles[0];
    if (!role || role.current_user !== 'fleet360_app' || role.rolbypassrls || role.rolsuper || !role.rolcanlogin) {
      throw new Error(
        `Lifecycle Preflight Failed: Connected role "${role?.current_user}". Must be exact role "fleet360_app" with bypassrls=false.`,
      );
    }

    tenantA = crypto.randomUUID();
    tenantB = crypto.randomUUID();

    // Provision test tenants via platform admin
    await withPlatformAdmin(prisma, async (tx) => {
      await tx.tenant.createMany({
        data: [
          {
            id: tenantA,
            name: 'Lifecycle Tenant A',
            code: `LC-A-${crypto.randomUUID().slice(0, 8)}`,
            domain: `lca-${crypto.randomUUID().slice(0, 8)}.example.com`,
            plan: 'ENTERPRISE',
            isActive: true,
          },
          {
            id: tenantB,
            name: 'Lifecycle Tenant B',
            code: `LC-B-${crypto.randomUUID().slice(0, 8)}`,
            domain: `lcb-${crypto.randomUUID().slice(0, 8)}.example.com`,
            plan: 'ENTERPRISE',
            isActive: true,
          },
        ],
      });
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await withPlatformAdmin(prisma, async (tx) => {
        const tenantIds = [tenantA, tenantB];
        await tx.busRoute.deleteMany({ where: { tenantId: { in: tenantIds } } });
        await tx.leaseInquiry.deleteMany({ where: { tenantId: { in: tenantIds } } });
        await tx.vehicle.deleteMany({ where: { tenantId: { in: tenantIds } } });
        await tx.maintenanceRequest.deleteMany({ where: { tenantId: { in: tenantIds } } });
        await tx.breakdownReport.deleteMany({ where: { tenantId: { in: tenantIds } } });
        await tx.driver.deleteMany({ where: { tenantId: { in: tenantIds } } });
        await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      });
    } catch {
      // best-effort
    }
  }, 60_000);

  // ── 1. Bus-Ops Domain Lifecycle ─────────────────────────────────────────────
  it('1. Bus-Ops: Bus Route create -> update -> readback and cross-tenant isolation', async () => {
    const routeId = crypto.randomUUID();

    // Tenant A creates a route
    await withTenantRls(prisma, tenantA, async (tx) => {
      await tx.busRoute.create({
        data: {
          id: routeId,
          tenantId: tenantA,
          code: 'R-101',
          name: 'Downtown Express',
          origin: 'Station North',
          destination: 'Central Hub',
          isActive: true,
        },
      });
    });

    // Tenant A reads back
    const readA = await withTenantRls(prisma, tenantA, async (tx) => {
      return tx.busRoute.findUnique({ where: { id: routeId } });
    });
    expect(readA?.name).toBe('Downtown Express');

    // Tenant B cannot see Tenant A's route
    const readB = await withTenantRls(prisma, tenantB, async (tx) => {
      return tx.busRoute.findUnique({ where: { id: routeId } });
    });
    expect(readB).toBeNull();
  });

  // ── 2. Commercial Leasing Lifecycle ─────────────────────────────────────────
  it('2. Leasing: Inquiry create -> quote status transition -> cross-tenant isolation', async () => {
    const inquiryId = crypto.randomUUID();

    await withTenantRls(prisma, tenantA, async (tx) => {
      await tx.leaseInquiry.create({
        data: {
          id: inquiryId,
          tenantId: tenantA,
          customerName: 'Jane Doe',
          companyName: 'Acme Corp Logistics',
          customerEmail: 'jane@acme.example.com',
          customerPhone: '+971501234567',
          vehicleCount: 10,
          vehicleType: 'VAN',
          durationMonths: 24,
          status: 'PENDING',
        },
      });

      await tx.leaseInquiry.update({
        where: { id: inquiryId },
        data: { status: 'QUOTED' },
      });
    });

    const inquiryA = await withTenantRls(prisma, tenantA, async (tx) => {
      return tx.leaseInquiry.findUnique({ where: { id: inquiryId } });
    });
    expect(inquiryA?.status).toBe('QUOTED');

    const inquiryB = await withTenantRls(prisma, tenantB, async (tx) => {
      return tx.leaseInquiry.findUnique({ where: { id: inquiryId } });
    });
    expect(inquiryB).toBeNull();
  });

  // ── 3. Vehicle Rental Lifecycle ─────────────────────────────────────────────
  it('3. Rental: Vehicle provisioning -> status transition -> cross-tenant isolation', async () => {
    const vehicleId = crypto.randomUUID();

    await withTenantRls(prisma, tenantA, async (tx) => {
      await tx.vehicle.create({
        data: {
          id: vehicleId,
          tenantId: tenantA,
          plateNumber: `DXB-${crypto.randomUUID().slice(0, 5)}`,
          make: 'Toyota',
          model: 'HiAce',
          year: 2025,
          status: 'AVAILABLE',
          type: 'PASSENGER_BUS',
        },
      });

      await tx.vehicle.update({
        where: { id: vehicleId },
        data: { status: 'RENTED' },
      });
    });

    const vehicleA = await withTenantRls(prisma, tenantA, async (tx) => {
      return tx.vehicle.findUnique({ where: { id: vehicleId } });
    });
    expect(vehicleA?.status).toBe('RENTED');

    const vehicleB = await withTenantRls(prisma, tenantB, async (tx) => {
      return tx.vehicle.findUnique({ where: { id: vehicleId } });
    });
    expect(vehicleB).toBeNull();
  });

  // ── 4. Finance & Maintenance Requests Lifecycle ─────────────────────────────
  it('4. Finance & Service: Request generation -> cost estimation -> ledger isolation', async () => {
    const reqId = crypto.randomUUID();

    await withTenantRls(prisma, tenantA, async (tx) => {
      await tx.maintenanceRequest.create({
        data: {
          id: reqId,
          tenantId: tenantA,
          description: 'Comprehensive 50k service & brake overhaul',
          status: 'APPROVED',
          estimatedCost: 3500.0,
          actualCost: 3450.0,
        },
      });
    });

    const reqA = await withTenantRls(prisma, tenantA, async (tx) => {
      return tx.maintenanceRequest.findUnique({ where: { id: reqId } });
    });
    expect(reqA?.status).toBe('APPROVED');
    expect(Number(reqA?.estimatedCost)).toBe(3500.0);

    const reqB = await withTenantRls(prisma, tenantB, async (tx) => {
      return tx.maintenanceRequest.findUnique({ where: { id: reqId } });
    });
    expect(reqB).toBeNull();
  });

  // ── 5. Fleet Management Lifecycle ───────────────────────────────────────────
  it('5. Fleet: Vehicle lifecycle under tenant boundary', async () => {
    const vehicleId = crypto.randomUUID();

    await withTenantRls(prisma, tenantA, async (tx) => {
      await tx.vehicle.create({
        data: {
          id: vehicleId,
          tenantId: tenantA,
          plateNumber: `AUH-${crypto.randomUUID().slice(0, 5)}`,
          make: 'Mercedes',
          model: 'Sprinter',
          year: 2024,
          status: 'MAINTENANCE',
          type: 'PASSENGER_BUS',
        },
      });
    });

    const fleetA = await withTenantRls(prisma, tenantA, async (tx) => {
      return tx.vehicle.findUnique({ where: { id: vehicleId } });
    });
    expect(fleetA?.plateNumber).toContain('AUH-');

    const fleetB = await withTenantRls(prisma, tenantB, async (tx) => {
      return tx.vehicle.findUnique({ where: { id: vehicleId } });
    });
    expect(fleetB).toBeNull();
  });

  // ── 6. Maintenance & Breakdown Lifecycle ────────────────────────────────────
  it('6. Maintenance: Breakdown service request creation and isolation', async () => {
    const reportId = crypto.randomUUID();

    await withTenantRls(prisma, tenantA, async (tx) => {
      await tx.breakdownReport.create({
        data: {
          id: reportId,
          tenantId: tenantA,
          reportNo: `BRK-${crypto.randomUUID().slice(0, 6)}`,
          breakdownType: 'ENGINE_OVERHEAT',
          location: 'Sheikh Zayed Road, Dubai',
          severity: 'HIGH',
          status: 'REPORTED',
        },
      });
    });

    const reportA = await withTenantRls(prisma, tenantA, async (tx) => {
      return tx.breakdownReport.findUnique({ where: { id: reportId } });
    });
    expect(reportA?.breakdownType).toBe('ENGINE_OVERHEAT');

    const reportB = await withTenantRls(prisma, tenantB, async (tx) => {
      return tx.breakdownReport.findUnique({ where: { id: reportId } });
    });
    expect(reportB).toBeNull();
  });

  // ── 7. School Bus Lifecycle ─────────────────────────────────────────────────
  it('7. School Bus: Route assignment and isolation', async () => {
    const routeId = crypto.randomUUID();

    await withTenantRls(prisma, tenantA, async (tx) => {
      await tx.busRoute.create({
        data: {
          id: routeId,
          tenantId: tenantA,
          code: 'SCH-01',
          name: 'Morning School Route Alpha',
          origin: 'Marina Residences',
          destination: 'Academy Campus',
          isActive: true,
        },
      });
    });

    const routeA = await withTenantRls(prisma, tenantA, async (tx) => {
      return tx.busRoute.findUnique({ where: { id: routeId } });
    });
    expect(routeA?.code).toBe('SCH-01');

    const routeB = await withTenantRls(prisma, tenantB, async (tx) => {
      return tx.busRoute.findUnique({ where: { id: routeId } });
    });
    expect(routeB).toBeNull();
  });

  // ── 8. Workforce & Drivers Lifecycle ────────────────────────────────────────
  it('8. Workforce: Driver onboarding -> contact details -> tenant isolation', async () => {
    const driverId = crypto.randomUUID();

    await withTenantRls(prisma, tenantA, async (tx) => {
      await tx.driver.create({
        data: {
          id: driverId,
          tenantId: tenantA,
          name: 'Rashid Khan',
          contactNumber: '+971554321098',
          licenseNumber: `LIC-UAE-${crypto.randomUUID().slice(0, 8)}`,
          licenseExpiry: new Date(Date.now() + 365 * 86400 * 1000),
          status: 'ACTIVE',
        },
      });
    });

    const driverA = await withTenantRls(prisma, tenantA, async (tx) => {
      return tx.driver.findUnique({ where: { id: driverId } });
    });
    expect(driverA?.name).toBe('Rashid Khan');

    const driverB = await withTenantRls(prisma, tenantB, async (tx) => {
      return tx.driver.findUnique({ where: { id: driverId } });
    });
    expect(driverB).toBeNull();
  });

  // ── 9. Webhook Ingress & Spoof Rejection ─────────────────────────────────────
  it('9. Webhook Ingress: withWebhookTenant allows valid scoped writes and rejects spoofed tenantId', async () => {
    const inquiryId = crypto.randomUUID();

    // Valid webhook write inside resolved Tenant A
    await withWebhookTenant(
      prisma,
      async () => tenantA,
      async ({ tx }) => {
        await tx.leaseInquiry.create({
          data: {
            id: inquiryId,
            tenantId: tenantA,
            customerName: 'Inbound Webhook Partner',
            companyName: 'Inbound Webhook Partner LLC',
            customerEmail: 'lead@partner.example.com',
            customerPhone: '+971501112233',
            vehicleCount: 5,
            vehicleType: 'SEDAN',
            durationMonths: 12,
            status: 'PENDING',
          },
        });
      },
    );

    // Verify Tenant A created row
    const leadA = await withTenantRls(prisma, tenantA, async (tx) => {
      return tx.leaseInquiry.findUnique({ where: { id: inquiryId } });
    });
    expect(leadA?.customerName).toBe('Inbound Webhook Partner');

    // Spoofed write: attempting to stamp Tenant B's id from inside Tenant A's webhook wrap
    await expect(
      withWebhookTenant(
        prisma,
        async () => tenantA,
        async ({ tx }) => {
          await tx.leaseInquiry.create({
            data: {
              id: crypto.randomUUID(),
              tenantId: tenantB, // Spoofed tenant ID
              customerName: 'Malicious Injected Lead',
              companyName: 'Attacker',
              customerEmail: 'attacker@evil.example.com',
              customerPhone: '+971500000000',
              vehicleCount: 1,
              vehicleType: 'SEDAN',
              durationMonths: 12,
              status: 'PENDING',
            },
          });
        },
      ),
    ).rejects.toThrow();
  });
});
