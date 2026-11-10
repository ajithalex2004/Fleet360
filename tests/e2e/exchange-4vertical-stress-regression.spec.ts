/**
 * tests/e2e/exchange-4vertical-stress-regression.spec.ts
 *
 * Fleet360 Private Partner Exchange Network
 * Multi-Vertical End-to-End Lifecycle, Concurrency Stress & Governance Regression Suite
 *
 * Exercises live HTTP routes, PostgreSQL RLS isolation, 3-stage compliance gates,
 * concurrency race conditions, automated SLA failover, 3-way financial match,
 * vector PDF streaming, and Chromium UI surfaces across ALL 4 operational verticals:
 *   1. PASSENGER_TRANSPORT (Bus & Staff Shuttle — TripSchedule <-> BusOpsOutsourcingAdapter)
 *   2. LIMOUSINE           (VIP Executive Chauffeur — Booking <-> LimousineOutsourcingAdapter)
 *   3. FREIGHT             (Logistics Load Board — Shipment/FreightRfq <-> FreightRfqCanonicalBridge)
 *   4. RECOVERY            (Roadside Breakdown — BreakdownReport <-> RecoveryOutsourcingAdapter)
 */

import { test, expect } from '@playwright/test';
import { createHash } from 'crypto';
import {
  isServerAvailable,
  createE2ETenant,
  cleanupE2ETenant,
  saveAuthState,
  loginWithStoredState,
  skipIfOffline,
  type E2EContext,
  type StorageState,
} from './helpers';
import { hashPassword } from '../test-utils';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

function cookieHeaderFromState(state: StorageState | null): string {
  if (!state) return '';
  return state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function apiJson<T = any>(
  path: string,
  opts: {
    method?: string;
    cookie?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; ok: boolean; data: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, ok: res.ok, data };
}

test.describe.serial(
  'Fleet360 Exchange: 4-Vertical Lifecycle, Concurrency Stress & Governance Regression Suite',
  () => {
    let serverUp = false;

    // Isolated multi-actor E2E tenants & sessions
    let buyerCtx: E2EContext | null = null;
    let superAdminUserId: string | null = null;
    let superAdminEmail = '';
    let superAdminPassword = '';

    let partnerACtx: E2EContext | null = null;
    let partnerBCtx: E2EContext | null = null;

    let buyerAuth: StorageState | null = null;
    let superAdminAuth: StorageState | null = null;
    let partnerAAuth: StorageState | null = null;
    let partnerBAuth: StorageState | null = null;

    let buyerCookie = '';
    let superAdminCookie = '';
    let partnerACookie = '';
    let partnerBCookie = '';

    // Partner Master & Fleet/Driver IDs
    let partnerAId = '';
    let partnerBId = '';

    let partnerACoachVehicleId = '';
    let partnerALimoVehicleId = '';
    let partnerAFreightVehicleId = '';
    let partnerARecoveryVehicleId = '';
    let partnerAExpiredVehicleId = '';

    let partnerABusDriverId = '';
    let partnerALimoDriverId = '';
    let partnerAFreightDriverId = '';
    let partnerARecoveryDriverId = '';
    let partnerATrapDriverId = '';

    let partnerBCoachVehicleId = '';
    let partnerBBusDriverId = '';

    // Native domain source IDs seeded in Buyer Tenant
    let nativeBusRouteId = '';
    let nativeBusTripId = '';
    let nativeLimoBookingId = '';
    let nativeBreakdownId = '';
    let nativeFreightShipmentId = '';
    let nativeFreightRfqId = '';

    // Cross-phase transaction artifacts
    let busRequestId = '';
    let busPartnerAQuoteId = '';
    let busAwardId = '';
    let busAssignmentId = '';
    let busDriverToken = '';
    let busInvoiceId = '';

    let limoRequestId = '';
    let limoAwardId = '';
    let limoAssignmentId = '';
    let limoDriverToken = '';
    let limoInvoiceId = '';

    let freightRequestId = '';
    let freightAwardId = '';
    let freightAssignmentId = '';
    let freightDriverToken = '';
    let freightInvoiceId = '';

    let recoveryRequestId = '';
    let recoveryAwardId = '';
    let recoveryAssignmentId = '';
    let recoveryDriverToken = '';
    let recoveryDisputedInvoiceId = '';
    let recoveryDisputeId = '';

    let settlementStatementId = '';
    let activePreviewToken = '';

    test.beforeAll(async ({ browser }) => {
      serverUp = await isServerAvailable();
      if (!serverUp) return;

      buyerCtx = await createE2ETenant('ExchBuyer');
      partnerACtx = await createE2ETenant('ExchPartnerA');
      partnerBCtx = await createE2ETenant('ExchPartnerB');

      const { PrismaClient, PartnerServiceDomain } = await import('@prisma/client');
      const prisma = new PrismaClient();
      const crypto = await import('crypto');

      try {
        const uid = crypto.randomUUID().slice(0, 6).toUpperCase();
        const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

        // Ensure Platform Kill Switch starts OFF in case an earlier crashed run left it ON
        await prisma.integrationConfig
          .deleteMany({ where: { type: 'EXCHANGE_PLATFORM_KILL_SWITCH' } })
          .catch(() => {});

        // Provision a Platform SUPER_ADMIN user bound to buyerCtx.tenantId for Kill Switch governance check
        let superRole = await prisma.role.findFirst({
          where: { tenantId: null, code: 'SUPER_ADMIN' },
        });
        if (!superRole) {
          superRole = await prisma.role.create({
            data: {
              id: crypto.randomUUID(),
              tenantId: null,
              name: 'Super Admin',
              code: 'SUPER_ADMIN',
              isSystem: true,
            },
          });
        }
        superAdminUserId = crypto.randomUUID();
        superAdminEmail = `e2e-exch-super-${uid.toLowerCase()}@test.example.com`;
        superAdminPassword = `SuperExch${uid}!`;
        await prisma.user.create({
          data: {
            id: superAdminUserId,
            email: superAdminEmail,
            username: `e2e-exch-super-${uid.toLowerCase()}`,
            firstName: 'Platform',
            lastName: 'Governor',
            isActive: true,
            updatedAt: new Date(),
          },
        });
        await prisma.$executeRawUnsafe(
          `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
          hashPassword(superAdminPassword),
          superAdminUserId,
        );
        await prisma.userTenant.create({
          data: {
            id: crypto.randomUUID(),
            userId: superAdminUserId,
            tenantId: buyerCtx.tenantId,
            roleId: superRole.id,
            isActive: true,
          },
        });

        // ── Seed Partner A (PREFERRED Tier-1 Multi-Vertical Carrier) ────────────
        partnerAId = crypto.randomUUID();
        await prisma.transportPartner.create({
          data: {
            id: partnerAId,
            legalName: `Al Maha Multi-Vertical Transport ${uid} LLC`,
            tradeName: `Al Maha Mobility ${uid}`,
            partnerCode: `PTNA-${uid}`,
            country: 'AE',
            city: 'Dubai',
            emirate: 'DUBAI',
            tradeLicenseNumber: `DED-${uid}-01`,
            taxRegistrationNumber: `1004455${uid.replace(/[^0-9]/g, '8').padEnd(8, '3').slice(0, 8)}`,
            primaryContactName: 'Tariq Al Mansoori',
            primaryContactEmail: partnerACtx.email,
            primaryContactPhone: '+971501112233',
            onboardingStatus: 'APPROVED',
            operationalStatus: 'ACTIVE',
            marketplaceStatus: 'APPROVED',
            approvedAt: new Date(),
            onboardedByTenantId: partnerACtx.tenantId,
          },
        });

        await prisma.partnerUser.create({
          data: {
            id: crypto.randomUUID(),
            partnerId: partnerAId,
            userId: partnerACtx.userId,
            role: 'PARTNER_ADMIN',
          },
        });

        await prisma.partnerCapability.createMany({
          data: [
            { partnerId: partnerAId, domain: PartnerServiceDomain.PASSENGER_TRANSPORT, serviceType: 'STAFF_BUS', isApproved: true },
            { partnerId: partnerAId, domain: PartnerServiceDomain.LIMOUSINE, serviceType: 'VIP_CHAUFFEUR', isApproved: true },
            { partnerId: partnerAId, domain: PartnerServiceDomain.FREIGHT, serviceType: 'REEFER_COLD', isApproved: true },
            { partnerId: partnerAId, domain: PartnerServiceDomain.RECOVERY, serviceType: 'FLATBED_RECOVERY', isApproved: true },
          ],
        });

        await prisma.partnerServiceArea.createMany({
          data: [
            { partnerId: partnerAId, emirate: 'Dubai', zones: ['JAFZA', 'DXB Airport', 'Dubai Internet City', 'Al Quoz'] },
            { partnerId: partnerAId, emirate: 'Abu Dhabi', zones: ['ADGM', 'Mussafah', 'KIZAD'] },
          ],
        });

        await prisma.partnerComplianceDoc.createMany({
          data: [
            {
              partnerId: partnerAId,
              docType: 'TRADE_LICENSE',
              docNumber: `TL-A-${uid}`,
              fileUrl: 'https://storage.fleet360.local/e2e/tl-a.pdf',
              expiryDate: nextYear,
              status: 'VALID',
            },
            {
              partnerId: partnerAId,
              docType: 'COMMERCIAL_INSURANCE',
              docNumber: `INS-A-${uid}`,
              fileUrl: 'https://storage.fleet360.local/e2e/ins-a.pdf',
              expiryDate: nextYear,
              status: 'VALID',
            },
            {
              partnerId: partnerAId,
              docType: 'TAX_CERTIFICATE',
              docNumber: `TRN-A-${uid}`,
              fileUrl: 'https://storage.fleet360.local/e2e/trn-a.pdf',
              expiryDate: nextYear,
              status: 'VALID',
            },
            {
              partnerId: partnerAId,
              docType: 'RTA_PERMIT',
              docNumber: `RTA-A-${uid}`,
              fileUrl: 'https://storage.fleet360.local/e2e/rta-a.pdf',
              expiryDate: nextYear,
              status: 'VALID',
            },
          ],
        });

        await prisma.tenantPartnerRelationship.create({
          data: {
            tenantId: buyerCtx.tenantId,
            partnerId: partnerAId,
            status: 'PREFERRED',
            paymentTerms: 'Net 30',
            commercialNotes: 'Preferred Tier-1 4-vertical partner',
          },
        });

        // Partner A Vehicles (4 compliant + 1 expired Mulkiya for Stage-2 gate test)
        partnerACoachVehicleId = crypto.randomUUID();
        partnerALimoVehicleId = crypto.randomUUID();
        partnerAFreightVehicleId = crypto.randomUUID();
        partnerARecoveryVehicleId = crypto.randomUUID();
        partnerAExpiredVehicleId = crypto.randomUUID();

        await prisma.partnerVehicle.createMany({
          data: [
            {
              id: partnerACoachVehicleId,
              partnerId: partnerAId,
              licensePlate: `DXB-BUS-${uid}`,
              plateEmirate: 'Dubai',
              vehicleType: '50-Seat Coach',
              seatingCapacity: 50,
              make: 'Mercedes-Benz',
              model: 'Tourismo',
              year: 2025,
              mulkiyaExpiry: nextYear,
              isActive: true,
            },
            {
              id: partnerALimoVehicleId,
              partnerId: partnerAId,
              licensePlate: `DXB-VIP-${uid}`,
              plateEmirate: 'Dubai',
              vehicleType: 'LUXURY_SEDAN',
              seatingCapacity: 3,
              make: 'Mercedes-Benz',
              model: 'S500 Maybach',
              year: 2026,
              mulkiyaExpiry: nextYear,
              isActive: true,
            },
            {
              id: partnerAFreightVehicleId,
              partnerId: partnerAId,
              licensePlate: `DXB-RFR-${uid}`,
              plateEmirate: 'Dubai',
              vehicleType: 'REEFER_COLD',
              seatingCapacity: 2,
              make: 'Volvo',
              model: 'FH16 Reefer',
              year: 2025,
              mulkiyaExpiry: nextYear,
              isActive: true,
            },
            {
              id: partnerARecoveryVehicleId,
              partnerId: partnerAId,
              licensePlate: `DXB-TOW-${uid}`,
              plateEmirate: 'Dubai',
              vehicleType: 'FLATBED',
              seatingCapacity: 2,
              make: 'Isuzu',
              model: 'NPR Flatbed Winch',
              year: 2025,
              mulkiyaExpiry: nextYear,
              isActive: true,
            },
            {
              id: partnerAExpiredVehicleId,
              partnerId: partnerAId,
              licensePlate: `DXB-EXP-${uid}`,
              plateEmirate: 'Dubai',
              vehicleType: '50-Seat Coach',
              seatingCapacity: 50,
              make: 'Yutong',
              model: 'ZK6122H9',
              year: 2020,
              mulkiyaExpiry: yesterday,
              isActive: true,
            },
          ],
        });

        // Partner A Drivers (4 vertical specialists + 1 trap driver for Stage-3 mid-flight expiry)
        partnerABusDriverId = crypto.randomUUID();
        partnerALimoDriverId = crypto.randomUUID();
        partnerAFreightDriverId = crypto.randomUUID();
        partnerARecoveryDriverId = crypto.randomUUID();
        partnerATrapDriverId = crypto.randomUUID();

        await prisma.partnerDriver.createMany({
          data: [
            {
              id: partnerABusDriverId,
              partnerId: partnerAId,
              fullName: 'Rashid Al Nuaimi',
              mobileNumber: '+971502001001',
              licenseNumber: `LIC-BUS-${uid}`,
              licenseExpiry: nextYear,
              permitType: 'RTA Bus Driver Permit',
              permitExpiry: nextYear,
              isActive: true,
            },
            {
              id: partnerALimoDriverId,
              partnerId: partnerAId,
              fullName: 'Karim Elmasri',
              mobileNumber: '+971502001002',
              licenseNumber: `LIC-VIP-${uid}`,
              licenseExpiry: nextYear,
              permitType: 'RTA Chauffeur Limousine Permit',
              permitExpiry: nextYear,
              isActive: true,
            },
            {
              id: partnerAFreightDriverId,
              partnerId: partnerAId,
              fullName: 'Imran Siddiqui',
              mobileNumber: '+971502001003',
              licenseNumber: `LIC-FRT-${uid}`,
              licenseExpiry: nextYear,
              permitType: 'Heavy Truck & Port Pass',
              permitExpiry: nextYear,
              isActive: true,
            },
            {
              id: partnerARecoveryDriverId,
              partnerId: partnerAId,
              fullName: 'Saeed Al Kaabi',
              mobileNumber: '+971502001004',
              licenseNumber: `LIC-TOW-${uid}`,
              licenseExpiry: nextYear,
              permitType: 'RTA Recovery Operator Permit',
              permitExpiry: nextYear,
              isActive: true,
            },
            {
              id: partnerATrapDriverId,
              partnerId: partnerAId,
              fullName: 'Nasser Al Darmaki',
              mobileNumber: '+971502001005',
              licenseNumber: `LIC-TRP-${uid}`,
              licenseExpiry: nextYear,
              permitType: 'RTA Bus Driver Permit',
              permitExpiry: nextYear,
              isActive: true,
            },
          ],
        });

        // ── Seed Partner B (APPROVED Non-Preferred / Standby Runner-Up Carrier) ──
        partnerBId = crypto.randomUUID();
        await prisma.transportPartner.create({
          data: {
            id: partnerBId,
            legalName: `Oryx Standby Fleet Services ${uid} LLC`,
            tradeName: `Oryx Fleet ${uid}`,
            partnerCode: `PTNB-${uid}`,
            country: 'AE',
            city: 'Abu Dhabi',
            emirate: 'ABU_DHABI',
            tradeLicenseNumber: `ADDED-${uid}-02`,
            taxRegistrationNumber: `1007788${uid.replace(/[^0-9]/g, '6').padEnd(8, '3').slice(0, 8)}`,
            primaryContactName: 'Faisal Al Dhaheri',
            primaryContactEmail: partnerBCtx.email,
            primaryContactPhone: '+971504445566',
            onboardingStatus: 'APPROVED',
            operationalStatus: 'ACTIVE',
            marketplaceStatus: 'APPROVED',
            approvedAt: new Date(),
            onboardedByTenantId: partnerBCtx.tenantId,
          },
        });

        await prisma.partnerUser.create({
          data: {
            id: crypto.randomUUID(),
            partnerId: partnerBId,
            userId: partnerBCtx.userId,
            role: 'PARTNER_ADMIN',
          },
        });

        await prisma.partnerCapability.createMany({
          data: [
            { partnerId: partnerBId, domain: PartnerServiceDomain.PASSENGER_TRANSPORT, serviceType: 'STAFF_BUS', isApproved: true },
            { partnerId: partnerBId, domain: PartnerServiceDomain.LIMOUSINE, serviceType: 'VIP_CHAUFFEUR', isApproved: true },
            { partnerId: partnerBId, domain: PartnerServiceDomain.FREIGHT, serviceType: 'BOX_TRUCK', isApproved: true },
            { partnerId: partnerBId, domain: PartnerServiceDomain.RECOVERY, serviceType: 'FLATBED_RECOVERY', isApproved: true },
          ],
        });

        await prisma.partnerComplianceDoc.createMany({
          data: [
            {
              partnerId: partnerBId,
              docType: 'TRADE_LICENSE',
              docNumber: `TL-B-${uid}`,
              fileUrl: 'https://storage.fleet360.local/e2e/tl-b.pdf',
              expiryDate: nextYear,
              status: 'VALID',
            },
            {
              partnerId: partnerBId,
              docType: 'COMMERCIAL_INSURANCE',
              docNumber: `INS-B-${uid}`,
              fileUrl: 'https://storage.fleet360.local/e2e/ins-b.pdf',
              expiryDate: nextYear,
              status: 'VALID',
            },
          ],
        });

        await prisma.tenantPartnerRelationship.create({
          data: {
            tenantId: buyerCtx.tenantId,
            partnerId: partnerBId,
            status: 'APPROVED', // Non-preferred -> subject to Preferred Exclusive Lead Window
            paymentTerms: 'Net 30',
          },
        });

        partnerBCoachVehicleId = crypto.randomUUID();
        partnerBBusDriverId = crypto.randomUUID();
        await prisma.partnerVehicle.create({
          data: {
            id: partnerBCoachVehicleId,
            partnerId: partnerBId,
            licensePlate: `AUH-STB-${uid}`,
            plateEmirate: 'Abu Dhabi',
            vehicleType: '50-Seat Coach',
            seatingCapacity: 50,
            make: 'MAN',
            model: 'Lion Coach',
            year: 2025,
            mulkiyaExpiry: nextYear,
            isActive: true,
          },
        });
        await prisma.partnerDriver.create({
          data: {
            id: partnerBBusDriverId,
            partnerId: partnerBId,
            fullName: 'Hamdan Al Mazrouei',
            mobileNumber: '+971506007001',
            licenseNumber: `LIC-B-${uid}`,
            licenseExpiry: nextYear,
            permitType: 'ITC Passenger Permit',
            permitExpiry: nextYear,
            isActive: true,
          },
        });

        // ── Seed Native Domain Source Entities in Buyer Tenant ──────────────────
        // 1. BusOps: BusRoute + TripSchedule
        nativeBusRouteId = crypto.randomUUID();
        nativeBusTripId = crypto.randomUUID();
        await prisma.busRoute.create({
          data: {
            id: nativeBusRouteId,
            tenantId: buyerCtx.tenantId,
            name: `E2E Intercity Staff Shuttle ${uid}`,
            code: `RT-EX-${uid}`,
            origin: 'Dubai Internet City Metro Hub',
            destination: 'Abu Dhabi ADGM Al Maryah Island',
            routeType: 'STAFF',
            capacity: 50,
          },
        });

        const busDeparture = new Date(tomorrow);
        busDeparture.setUTCHours(7, 30, 0, 0);
        await prisma.tripSchedule.create({
          data: {
            id: nativeBusTripId,
            tenantId: buyerCtx.tenantId,
            tripNumber: `TRP-EX-${uid}`,
            routeId: nativeBusRouteId,
            departureTime: busDeparture,
            capacity: 50,
            confirmedCount: 49,
            status: 'SCHEDULED',
          },
        });

        // 2. Limousine: Executive VIP Booking
        nativeLimoBookingId = crypto.randomUUID();
        await prisma.booking.create({
          data: {
            id: nativeLimoBookingId,
            tenantId: buyerCtx.tenantId,
            bookingRef: `VIP-EX-${uid}`,
            serviceType: 'EXECUTIVE',
            requestorName: 'H.E. Dr. Sultan Delegation Office',
            requestorEmail: `vip-${uid.toLowerCase()}@test.example.com`,
            startDate: tomorrow,
            vehicleCategory: 'LUXURY_SEDAN',
            status: 'PENDING',
            notes: JSON.stringify({
              pickupLocation: 'Dubai International Airport (DXB) Terminal 3 VIP Majlis',
              dropoffLocation: 'Emirates Palace Mandarin Oriental, Abu Dhabi',
              pickupTime: '19:30',
              passengers: 2,
              luggageCount: 3,
              flightNumber: 'EK 002',
              meetAndGreet: true,
              luxuryClass: 'LUXURY_SEDAN',
            }),
          },
        });

        // 3. Roadside Recovery: BreakdownReport
        nativeBreakdownId = crypto.randomUUID();
        await prisma.breakdownReport.create({
          data: {
            id: nativeBreakdownId,
            tenantId: buyerCtx.tenantId,
            reportNo: `BRK-EX-${uid}`,
            breakdownType: 'TRANSMISSION',
            location: 'Sheikh Mohammed Bin Zayed Road (E311) Exit 47, Dubai',
            driverNotes: 'Steering & transmission locked on highway shoulder; flatbed winch required.',
            severity: 'CRITICAL',
            status: 'REPORTED',
          },
        });
      } finally {
        await prisma.$disconnect();
      }

      // Authenticate all 4 actors once via real /login UI
      buyerAuth = await saveAuthState(browser, buyerCtx.email, buyerCtx.password);
      superAdminAuth = await saveAuthState(browser, superAdminEmail, superAdminPassword);
      partnerAAuth = await saveAuthState(browser, partnerACtx.email, partnerACtx.password);
      partnerBAuth = await saveAuthState(browser, partnerBCtx.email, partnerBCtx.password);

      buyerCookie = cookieHeaderFromState(buyerAuth);
      superAdminCookie = cookieHeaderFromState(superAdminAuth);
      partnerACookie = cookieHeaderFromState(partnerAAuth);
      partnerBCookie = cookieHeaderFromState(partnerBAuth);
    });

    test.afterAll(async () => {
      if (!buyerCtx) return;
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      try {
        // Ensure Kill Switch is left OFF
        await prisma.integrationConfig
          .deleteMany({
            where: {
              OR: [
                { type: 'EXCHANGE_PLATFORM_KILL_SWITCH' },
                { type: `EXCHANGE_POLICY_${buyerCtx.tenantId}` },
                ...(partnerAId ? [{ type: `EXCHANGE_CONSENT_${partnerAId}` }] : []),
                ...(partnerBId ? [{ type: `EXCHANGE_CONSENT_${partnerBId}` }] : []),
              ],
            },
          })
          .catch(() => {});

        // Delete Exchange transactional graph in strict FK order (Restrict relations first)
        await prisma.outsourceDispute.deleteMany({ where: { tenantId: buyerCtx.tenantId } }).catch(() => {});
        await prisma.partnerSettlementStatement.deleteMany({ where: { tenantId: buyerCtx.tenantId } }).catch(() => {});
        await prisma.partnerInvoice.deleteMany({ where: { tenantId: buyerCtx.tenantId } }).catch(() => {});
        await prisma.outsourceException.deleteMany({ where: { tenantId: buyerCtx.tenantId } }).catch(() => {});
        await prisma.partnerAssignment
          .deleteMany({ where: { award: { tenantId: buyerCtx.tenantId } } })
          .catch(() => {});
        await prisma.outsourceAward.deleteMany({ where: { tenantId: buyerCtx.tenantId } }).catch(() => {});
        await prisma.partnerQuote
          .deleteMany({ where: { request: { tenantId: buyerCtx.tenantId } } })
          .catch(() => {});
        await prisma.outsourceRequest.deleteMany({ where: { tenantId: buyerCtx.tenantId } }).catch(() => {});
        await prisma.partnerRateCard.deleteMany({ where: { tenantId: buyerCtx.tenantId } }).catch(() => {});

        // Delete native domain fixtures
        await prisma.$executeRawUnsafe(
          `DELETE FROM logistics_freight_rfqs WHERE tenant_id = $1`,
          buyerCtx.tenantId,
        ).catch(() => {});
        await prisma.$executeRawUnsafe(
          `DELETE FROM logistics_tracking_events WHERE tenant_id = $1`,
          buyerCtx.tenantId,
        ).catch(() => {});
        await prisma.$executeRawUnsafe(
          `DELETE FROM logistics_cargo_lines WHERE tenant_id = $1`,
          buyerCtx.tenantId,
        ).catch(() => {});
        await prisma.$executeRawUnsafe(
          `DELETE FROM logistics_shipment_orders WHERE tenant_id = $1`,
          buyerCtx.tenantId,
        ).catch(() => {});
        await prisma.financePayable.deleteMany({ where: { tenantId: buyerCtx.tenantId } }).catch(() => {});

        await prisma.tripSchedule.deleteMany({ where: { tenantId: buyerCtx.tenantId } }).catch(() => {});
        await prisma.busRoute.deleteMany({ where: { tenantId: buyerCtx.tenantId } }).catch(() => {});
        await prisma.booking.deleteMany({ where: { tenantId: buyerCtx.tenantId } }).catch(() => {});
        await prisma.breakdownReport.deleteMany({ where: { tenantId: buyerCtx.tenantId } }).catch(() => {});

        if (partnerAId) {
          await prisma.transportPartner.delete({ where: { id: partnerAId } }).catch(() => {});
        }
        if (partnerBId) {
          await prisma.transportPartner.delete({ where: { id: partnerBId } }).catch(() => {});
        }
        if (superAdminUserId) {
          await prisma.userTenant.deleteMany({ where: { userId: superAdminUserId } }).catch(() => {});
          await prisma.user.delete({ where: { id: superAdminUserId } }).catch(() => {});
        }
      } finally {
        await prisma.$disconnect();
      }

      await cleanupE2ETenant(buyerCtx);
      await cleanupE2ETenant(partnerACtx);
      await cleanupE2ETenant(partnerBCtx);
    });

    test.beforeEach(async ({}, testInfo) => {
      skipIfOffline(serverUp, testInfo);
    });

    // =========================================================================
    // PHASE 1: Network Governance, Preferred Exclusive Window, Consent & Kill Switch
    // =========================================================================

    test('Phase 1.1: Buyer configures PREFERRED 45m Exclusive Window & Fuel-Indexed Rate Card (SHA-256)', async () => {
      const policyRes = await apiJson('/api/exchange/scorecard', {
        cookie: buyerCookie,
        body: {
          action: 'UPDATE_NETWORK_POLICY',
          networkMode: 'PREFERRED',
          preferredExclusiveWindowMinutes: 45,
          allowAutoAwardPreferred: false,
        },
      });
      expect(policyRes.status).toBe(200);
      expect(policyRes.data.ok).toBe(true);
      expect(policyRes.data.networkPolicy.accessMode).toBe('PREFERRED');
      expect(policyRes.data.networkPolicy.preferredExclusiveWindowMinutes).toBe(45);

      const rateRes = await apiJson('/api/exchange/scorecard', {
        cookie: buyerCookie,
        body: {
          action: 'CREATE_RATE_CARD',
          partnerId: partnerAId,
          title: 'Intercity 50-Seat Coach Contract Rate (Fuel Indexed)',
          domain: 'PASSENGER_TRANSPORT',
          vehicleType: '50-Seat Coach',
          originZone: 'Dubai',
          destinationZone: 'Abu Dhabi',
          rateAmount: 1500,
          currency: 'AED',
          unitType: 'PER_TRIP',
          freeWaitingMinutes: 30,
          waitingFeePerHour: 120,
          cancellationFeePct: 25,
          tollTreatment: 'ACTUAL',
          fuelSurchargePct: 8,
        },
      });
      expect(rateRes.status).toBe(200);
      expect(rateRes.data.ok).toBe(true);
      expect(rateRes.data.rateCard.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
      expect(rateRes.data.rateCard.ancillaryCharges.fuelSurchargePct).toBe(8);
    });

    test('Phase 1.2: ARCH-3 Preferred Exclusive Window holds non-preferred Partner B while Partner A sees sanitized Stage-1 feed', async () => {
      const tomorrowIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const createRes = await apiJson('/api/bus-ops/outsource', {
        cookie: buyerCookie,
        body: {
          action: 'CREATE_REQUEST',
          tripId: nativeBusTripId,
          domain: 'PASSENGER_TRANSPORT',
          serviceDate: tomorrowIso,
          pickupTime: '07:30',
          pickupLocation: 'Dubai Internet City Building 12 VIP Gate',
          dropoffLocation: 'Abu Dhabi ADGM Tower 3 South Podium',
          requiredCapacity: 50,
          vehicleTypeRequired: '50-Seat Coach',
          publishToMarketplace: true,
        },
      });
      expect(createRes.status).toBe(200);
      expect(createRes.data.ok).toBe(true);
      busRequestId = createRes.data.request.id;
      expect(busRequestId).toBeTruthy();

      // Partner A (PREFERRED) sees the opportunity in /api/exchange/marketplace WITHOUT buyer tenantId leak
      const feedARes = await apiJson('/api/exchange/marketplace', { cookie: partnerACookie });
      expect(feedARes.status).toBe(200);
      const oppForA = (feedARes.data.opportunities || []).find(
        (o: any) => o.outsourceRequestId === busRequestId,
      );
      expect(oppForA).toBeDefined();
      expect(oppForA.tenantId).toBeUndefined(); // ARCH-3: buyer identity never leaked!

      // Partner B (APPROVED, non-preferred) MUST NOT see the opportunity during the 45m exclusive window
      const feedBRes = await apiJson('/api/exchange/marketplace', { cookie: partnerBCookie });
      expect(feedBRes.status).toBe(200);
      const oppForB = (feedBRes.data.opportunities || []).find(
        (o: any) => o.outsourceRequestId === busRequestId,
      );
      expect(oppForB).toBeUndefined();

      // Direct quote attempt by Partner B during exclusive window MUST fail 403
      const earlyQuoteB = await apiJson('/api/exchange/jobs/quotes', {
        cookie: partnerBCookie,
        body: {
          requestId: busRequestId,
          amount: 1450,
          currency: 'AED',
          notes: 'Attempted quote during preferred exclusive window',
        },
      });
      expect(earlyQuoteB.status).toBe(403);
      expect(String(earlyQuoteB.data.error)).toMatch(/exclusive|preferred|not open/i);
    });

    test('Phase 1.3: Releasing Exclusive Window admits Partner B; FUNC-4 Consortium Consent & FUNC-3 Structured Decline work', async () => {
      // Release exclusive window (0m) so Partner B can participate in Phase 2 concurrency stress
      const policyRes = await apiJson('/api/exchange/scorecard', {
        cookie: buyerCookie,
        body: {
          action: 'UPDATE_NETWORK_POLICY',
          networkMode: 'PREFERRED',
          preferredExclusiveWindowMinutes: 0,
        },
      });
      expect(policyRes.status).toBe(200);

      const feedBRes = await apiJson('/api/exchange/marketplace', { cookie: partnerBCookie });
      expect(feedBRes.status).toBe(200);
      const oppForB = (feedBRes.data.opportunities || []).find(
        (o: any) => o.outsourceRequestId === busRequestId,
      );
      expect(oppForB).toBeDefined();
      expect(oppForB.tenantId).toBeUndefined();

      // FUNC-4: Partner B toggles Consortium Qualification Discovery Consent ON
      const consentRes = await apiJson('/api/exchange/partner/profile', {
        method: 'PUT',
        cookie: partnerBCookie,
        body: {
          consentOnly: true,
          consortiumSharingConsent: {
            consortiumId: 'UAE_ENTERPRISE_FLEET_CONSORTIUM',
            allowQualificationDiscovery: true,
          },
        },
      });
      expect(consentRes.status).toBe(200);
      expect(consentRes.data.ok).toBe(true);
      expect(consentRes.data.consent.allowQualificationDiscovery).toBe(true);

      // FUNC-3: Direct invite RFQ where Partner B formally declines with OutsourceDeclineReason.NO_CAPACITY
      const declineTargetReq = await apiJson('/api/bus-ops/outsource', {
        cookie: buyerCookie,
        body: {
          action: 'CREATE_REQUEST',
          domain: 'PASSENGER_TRANSPORT',
          serviceDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          pickupTime: '06:00',
          pickupLocation: 'Sharjah Industrial Area 10',
          dropoffLocation: 'Jebel Ali Gate 4',
          requiredCapacity: 50,
          invitedPartnerIds: [partnerBId],
        },
      });
      expect(declineTargetReq.status).toBe(200);

      const declineRes = await apiJson('/api/exchange/jobs/quotes', {
        cookie: partnerBCookie,
        body: {
          action: 'DECLINE',
          requestId: declineTargetReq.data.request.id,
          declineReason: 'NO_VEHICLE',
          declineNotes: 'All 50-seat coaches committed to Abu Dhabi shift shuttle.',
        },
      });
      expect(declineRes.status).toBe(200);
      expect(declineRes.data.ok).toBe(true);
      expect(declineRes.data.declined.status).toBe('DECLINED');
      expect(declineRes.data.declined.declineReason).toBe('NO_VEHICLE');
    });

    test('Phase 1.4: ARCH-1 Platform Emergency Kill Switch persists in PostgreSQL & fails closed on marketplace quoting', async () => {
      const activateRes = await apiJson('/api/admin/exchange/partners', {
        cookie: superAdminCookie,
        body: {
          action: 'SET_KILL_SWITCH',
          active: true,
          reason: 'E2E Governance Stress Drill — Emergency Exchange Freeze',
        },
      });
      expect(activateRes.status).toBe(200);
      expect(activateRes.data.killSwitch.active).toBe(true);

      // Verify state persisted in GET ?includeKillSwitch=1
      const checkAdmin = await apiJson('/api/admin/exchange/partners?includeKillSwitch=1', {
        cookie: superAdminCookie,
      });
      expect(checkAdmin.status).toBe(200);
      expect(checkAdmin.data.killSwitch.active).toBe(true);

      // Verify Partner A quote attempt immediately fails closed (403)
      const blockedQuote = await apiJson('/api/exchange/jobs/quotes', {
        cookie: partnerACookie,
        body: {
          requestId: busRequestId,
          amount: 1500,
          currency: 'AED',
        },
      });
      expect(blockedQuote.status).toBe(403);
      expect(String(blockedQuote.data.error)).toMatch(/suspended|governance/i);

      // Deactivate Kill Switch to resume operations
      const deactivateRes = await apiJson('/api/admin/exchange/partners', {
        cookie: superAdminCookie,
        body: {
          action: 'SET_KILL_SWITCH',
          active: false,
          reason: 'E2E Governance Stress Drill Completed',
        },
      });
      expect(deactivateRes.status).toBe(200);
      expect(deactivateRes.data.killSwitch.active).toBe(false);
    });

    // =========================================================================
    // PHASE 2: Concurrency & Race-Condition Stress Gate (Quote Storm + Award Race)
    // =========================================================================

    test('Phase 2.1: Concurrent Quote & Revision Storm (10 parallel submissions across Partner A & Partner B)', async () => {
      const partnerAAmounts = [1620, 1580, 1550, 1520, 1500];
      const partnerBAmounts = [1700, 1680, 1650, 1630, 1600];

      // Fire 10 concurrent quote requests in parallel across both partners
      const stormPromises = [
        ...partnerAAmounts.map((amt, idx) =>
          apiJson('/api/exchange/jobs/quotes', {
            cookie: partnerACookie,
            body: {
              requestId: busRequestId,
              amount: amt,
              currency: 'AED',
              proposedVehicleId: partnerACoachVehicleId,
              proposedDriverId: partnerABusDriverId,
              notes: `Partner A concurrent quote burst #${idx + 1}`,
            },
          }),
        ),
        ...partnerBAmounts.map((amt, idx) =>
          apiJson('/api/exchange/jobs/quotes', {
            cookie: partnerBCookie,
            body: {
              requestId: busRequestId,
              amount: amt,
              currency: 'AED',
              proposedVehicleId: partnerBCoachVehicleId,
              proposedDriverId: partnerBBusDriverId,
              notes: `Partner B concurrent quote burst #${idx + 1}`,
            },
          }),
        ),
      ];

      const results = await Promise.all(stormPromises);
      // Zero 500 unhandled crashes under concurrent write burst
      for (const r of results) {
        expect(r.status).toBe(200);
        expect(r.data.ok).toBe(true);
      }

      // Submit one deterministic final revision for Partner A (AED 1,500) and Partner B (AED 1,600)
      const finalA = await apiJson('/api/exchange/jobs/quotes', {
        cookie: partnerACookie,
        body: {
          requestId: busRequestId,
          amount: 1500,
          currency: 'AED',
          proposedVehicleId: partnerACoachVehicleId,
          proposedDriverId: partnerABusDriverId,
          notes: 'Final deterministic Partner A Bus Quote (AED 1,500 + 5% VAT)',
        },
      });
      expect(finalA.status).toBe(200);
      expect(finalA.data.quote.revisionNo).toBeGreaterThanOrEqual(2);
      busPartnerAQuoteId = finalA.data.quote.id;

      const finalB = await apiJson('/api/exchange/jobs/quotes', {
        cookie: partnerBCookie,
        body: {
          requestId: busRequestId,
          amount: 1600,
          currency: 'AED',
          proposedVehicleId: partnerBCoachVehicleId,
          proposedDriverId: partnerBBusDriverId,
          notes: 'Final deterministic Partner B Standby Quote (AED 1,600 + 5% VAT)',
        },
      });
      expect(finalB.status).toBe(200);
      expect(finalB.data.quote.revisionNo).toBeGreaterThanOrEqual(2);
    });

    test('Phase 2.2: Concurrent Award Race & Idempotency (6 parallel award attempts -> exactly 1 OutsourceAward + frozen SHA-256 snapshot)', async () => {
      // Load quotes as Buyer to get Partner B's active quoteId as well
      const marketView = await apiJson(`/api/bus-ops/outsource?tripId=${nativeBusTripId}`, {
        cookie: buyerCookie,
      });
      expect(marketView.status).toBe(200);
      const submittedQuotes = (marketView.data.outsourceRequest?.quotes || []).filter(
        (q: any) => q.status === 'SUBMITTED',
      );
      const partnerBActiveQuote = submittedQuotes.find((q: any) => q.partnerId === partnerBId);
      expect(partnerBActiveQuote).toBeDefined();

      // Fire 4 concurrent award requests for Partner A's quote (with 8% fuel surcharge indexation)
      // AND 2 competing award requests for Partner B's quote simultaneously!
      const awardRace = await Promise.all([
        ...[1, 2, 3, 4].map(() =>
          apiJson('/api/bus-ops/outsource', {
            cookie: buyerCookie,
            body: {
              action: 'AWARD_QUOTE',
              requestId: busRequestId,
              quoteId: busPartnerAQuoteId,
              tripId: nativeBusTripId,
              commercialModel: 'AGENCY',
              platformFeePct: 3,
              ancillaryCharges: {
                freeWaitingMinutes: 30,
                waitingFeePerHour: 120,
                cancellationFeePct: 25,
                tollTreatment: 'ACTUAL',
                fuelSurchargePct: 8,
              },
            },
          }),
        ),
        ...[1, 2].map(() =>
          apiJson('/api/bus-ops/outsource', {
            cookie: buyerCookie,
            body: {
              action: 'AWARD_QUOTE',
              requestId: busRequestId,
              quoteId: partnerBActiveQuote.id,
              tripId: nativeBusTripId,
            },
          }),
        ),
      ]);

      // Every response must be either 200 (winner / idempotent retry) or 409 (conflict loser) — NEVER 500!
      for (const r of awardRace) {
        expect([200, 409]).toContain(r.status);
      }
      const winners = awardRace.filter((r) => r.status === 200 && r.data.award?.id);
      expect(winners.length).toBeGreaterThanOrEqual(1);

      // Verify in PostgreSQL that EXACTLY ONE OutsourceAward exists for busRequestId
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      try {
        const awardsInDb = await prisma.outsourceAward.findMany({
          where: { requestId: busRequestId },
        });
        expect(awardsInDb).toHaveLength(1);
        busAwardId = awardsInDb[0].id;

        // If Partner B won the microsecond race, normalize to Partner A so Phase 3/4/6 run deterministically on Partner A
        if (awardsInDb[0].partnerId !== partnerAId) {
          await prisma.outsourceAward.delete({ where: { id: awardsInDb[0].id } });
          await prisma.partnerQuote.update({
            where: { id: busPartnerAQuoteId },
            data: { status: 'SUBMITTED' },
          });
          await prisma.outsourceRequest.update({
            where: { id: busRequestId },
            data: { status: 'QUOTED' },
          });
          const deterministicAward = await apiJson('/api/bus-ops/outsource', {
            cookie: buyerCookie,
            body: {
              action: 'AWARD_QUOTE',
              requestId: busRequestId,
              quoteId: busPartnerAQuoteId,
              tripId: nativeBusTripId,
              commercialModel: 'AGENCY',
              platformFeePct: 3,
              ancillaryCharges: {
                freeWaitingMinutes: 30,
                waitingFeePerHour: 120,
                cancellationFeePct: 25,
                tollTreatment: 'ACTUAL',
                fuelSurchargePct: 8,
              },
            },
          });
          expect(deterministicAward.status).toBe(200);
          busAwardId = deterministicAward.data.award.id;
        }

        const verifiedAward = await prisma.outsourceAward.findUniqueOrThrow({
          where: { id: busAwardId },
        });
        const snap = verifiedAward.commercialSnapshot as Record<string, any>;
        expect(snap.rateCardSnapshot?.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
        expect(snap.rateCardSnapshot?.ancillaryCharges?.fuelSurchargePct).toBe(8);

        // Native TripSchedule synchronized by BusOpsOutsourcingAdapter without violating TRIP_TRANSITIONS
        const syncedTrip = await prisma.tripSchedule.findUnique({ where: { id: nativeBusTripId } });
        expect(syncedTrip?.status).toBe('SCHEDULED');
        expect(String(syncedTrip?.notes || '')).toContain('[Exchange Awarded]');
      } finally {
        await prisma.$disconnect();
      }
    });

    // =========================================================================
    // PHASE 3: 3-Stage Synchronous Compliance Auto-Gating (Stage 2 & Stage 3)
    // =========================================================================

    test('Phase 3.1: Stage-2 Assignment Gate blocks expired Mulkiya vehicle & issues SHA-256 hashed token for compliant Coach', async () => {
      // 1. Attempt to assign vehicle with expired Mulkiya -> MUST fail (422)
      const blockedAssign = await apiJson('/api/exchange/jobs/assign', {
        cookie: partnerACookie,
        body: {
          awardId: busAwardId,
          vehicleId: partnerAExpiredVehicleId,
          vehiclePlate: 'DXB-EXP-COACH',
          driverId: partnerABusDriverId,
          driverName: 'Rashid Al Nuaimi',
          driverPhone: '+971502001001',
        },
      });
      expect(blockedAssign.ok).toBe(false);
      expect(blockedAssign.status).toBe(422);
      expect(String(blockedAssign.data.error)).toMatch(/Mulkiya.*expired/i);

      // 2. Assign compliant 50-Seat Coach & RTA-permitted Bus Driver -> MUST succeed (200)
      const validAssign = await apiJson('/api/exchange/jobs/assign', {
        cookie: partnerACookie,
        body: {
          awardId: busAwardId,
          vehicleId: partnerACoachVehicleId,
          vehiclePlate: 'DXB-BUS-5001',
          driverId: partnerABusDriverId,
          driverName: 'Rashid Al Nuaimi',
          driverPhone: '+971502001001',
        },
      });
      expect(validAssign.status).toBe(200);
      expect(validAssign.data.ok).toBe(true);
      expect(validAssign.data.rawToken).toMatch(/^[a-f0-9]{64}$/);

      busAssignmentId = validAssign.data.assignment.id;
      busDriverToken = validAssign.data.rawToken;
      activePreviewToken = busDriverToken;

      // Verify zero plaintext token in DB — stored hash matches SHA-256(rawToken)
      const expectedHash = createHash('sha256').update(busDriverToken).digest('hex');
      expect(validAssign.data.assignment.driverTokenHash).toBe(expectedHash);
    });

    test('Phase 3.2: Stage-3 Pre-Dispatch Gate blocks mid-flight expired driver permit & auto-revokes magic token', async () => {
      // Create a dedicated direct-contract award and assign partnerATrapDriverId while valid
      const trapAwardRes = await apiJson('/api/bus-ops/outsource', {
        cookie: buyerCookie,
        body: {
          action: 'CONTRACT_DIRECT_AWARD',
          domain: 'PASSENGER_TRANSPORT',
          partnerId: partnerAId,
          serviceDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          pickupTime: '09:00',
          pickupLocation: 'Dubai Silicon Oasis HQ',
          dropoffLocation: 'Expo City Dubai Mobility Pavilion',
          requiredCapacity: 30,
          agreedPrice: 950,
        },
      });
      expect(trapAwardRes.status).toBe(200);
      const trapAwardId = trapAwardRes.data.award.id;

      const trapAssignRes = await apiJson('/api/exchange/jobs/assign', {
        cookie: partnerACookie,
        body: {
          awardId: trapAwardId,
          vehicleId: partnerACoachVehicleId,
          vehiclePlate: 'DXB-TRAP-01',
          driverId: partnerATrapDriverId,
          driverName: 'Nasser Al Darmaki',
          driverPhone: '+971502001005',
        },
      });
      expect(trapAssignRes.status).toBe(200);
      const trapToken = trapAssignRes.data.rawToken as string;

      // Simulate driver's RTA permit expiring AFTER Stage-2 assignment but BEFORE Stage-3 dispatch
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      try {
        await prisma.partnerDriver.update({
          where: { id: partnerATrapDriverId },
          data: { permitExpiry: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        });
      } finally {
        await prisma.$disconnect();
      }

      // Driver clicks REACHED on magic link -> Stage-3 PreDispatchComplianceGuard MUST block & revoke token!
      const blockedMilestone = await apiJson(`/api/public/partner-driver/${trapToken}`, {
        body: { action: 'REACHED' },
      });
      expect(blockedMilestone.status).toBe(400);
      expect(String(blockedMilestone.data.error)).toMatch(/Pre-dispatch compliance check failed.*permit expired/i);

      // Subsequent GET on the revoked magic link MUST return 404 (revoked)
      const afterRevokeGet = await apiJson(`/api/public/partner-driver/${trapToken}`);
      expect(afterRevokeGet.status).toBe(404);
      expect(String(afterRevokeGet.data.error)).toMatch(/revoked/i);
    });

    // =========================================================================
    // PHASE 4: Full 4-Vertical End-to-End Execution Lifecycles
    // =========================================================================

    test('Phase 4.1 [Vertical 1 — PASSENGER_TRANSPORT / Bus]: Driver executes REACHED -> STARTED -> COMPLETED + Headcount ePOD & syncs TripSchedule', async () => {
      // Out-of-order STARTED before REACHED must be rejected by strict state machine
      const prematureStart = await apiJson(`/api/public/partner-driver/${busDriverToken}`, {
        body: { action: 'STARTED' },
      });
      expect(prematureStart.status).toBe(400);

      // 1. REACHED
      const reachedRes = await apiJson(`/api/public/partner-driver/${busDriverToken}`, {
        body: { action: 'REACHED' },
      });
      expect(reachedRes.status).toBe(200);
      expect(reachedRes.data.assignment.reachedAt).toBeTruthy();

      // 2. STARTED -> TripSchedule transitions to IN_PROGRESS
      const startedRes = await apiJson(`/api/public/partner-driver/${busDriverToken}`, {
        body: { action: 'STARTED' },
      });
      expect(startedRes.status).toBe(200);

      // 3. COMPLETED + Bus Headcount ePOD (49/50 passengers) -> TripSchedule transitions to COMPLETED
      const completedRes = await apiJson(`/api/public/partner-driver/${busDriverToken}`, {
        body: {
          action: 'COMPLETED',
          passengerCount: 49,
          signedByName: 'Maha Al Suwaidi (Site Transport Coordinator)',
          signatureUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          completionNotes: 'On-time shuttle arrival at ADGM South Podium',
        },
      });
      expect(completedRes.status).toBe(200);

      // Post-completion mutation must fail 409 (immutable completed trip)
      const duplicateComplete = await apiJson(`/api/public/partner-driver/${busDriverToken}`, {
        body: { action: 'COMPLETED', passengerCount: 49 },
      });
      expect(duplicateComplete.status).toBe(409);

      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      try {
        const syncedTrip = await prisma.tripSchedule.findUnique({ where: { id: nativeBusTripId } });
        expect(syncedTrip?.status).toBe('COMPLETED');
      } finally {
        await prisma.$disconnect();
      }
    });

    test('Phase 4.2 [Vertical 2 — LIMOUSINE / VIP Chauffeur]: Outsource EXECUTIVE Booking -> Quote -> PRINCIPAL Award -> Chauffeur VIP ePOD -> Booking COMPLETED', async () => {
      const tomorrowIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // 1. Buyer outsources VIP Executive Booking (FUNC-1 flow)
      const createLimo = await apiJson('/api/bus-ops/outsource', {
        cookie: buyerCookie,
        body: {
          action: 'CREATE_REQUEST',
          bookingId: nativeLimoBookingId,
          domain: 'LIMOUSINE',
          serviceDate: tomorrowIso,
          pickupTime: '19:30',
          pickupLocation: 'Dubai International Airport (DXB) Terminal 3 VIP Majlis',
          dropoffLocation: 'Emirates Palace Mandarin Oriental, Abu Dhabi',
          requiredCapacity: 2,
          vehicleTypeRequired: 'LUXURY_SEDAN',
          invitedPartnerIds: [partnerAId],
          publishToMarketplace: true,
        },
      });
      expect(createLimo.status).toBe(200);
      limoRequestId = createLimo.data.request.id;
      expect(createLimo.data.request.domain).toBe('LIMOUSINE');

      // 2. Partner A quotes AED 1,200 + VAT
      const quoteLimo = await apiJson('/api/exchange/jobs/quotes', {
        cookie: partnerACookie,
        body: {
          requestId: limoRequestId,
          amount: 1200,
          currency: 'AED',
          proposedVehicleId: partnerALimoVehicleId,
          proposedDriverId: partnerALimoDriverId,
          notes: 'Mercedes-Maybach S500 with VIP Majlis tarmac meet & greet',
        },
      });
      expect(quoteLimo.status).toBe(200);

      // 3. Buyer awards under IFRS 15 PRINCIPAL model (buyerAgreedPrice: 1,450 vs partner 1,200)
      const awardLimo = await apiJson('/api/bus-ops/outsource', {
        cookie: buyerCookie,
        body: {
          action: 'AWARD_QUOTE',
          requestId: limoRequestId,
          quoteId: quoteLimo.data.quote.id,
          commercialModel: 'PRINCIPAL',
          buyerAgreedPrice: 1450,
          ifrs15Indicators: {
            hasPrimaryFulfilmentResponsibility: true,
            hasCapacityOrSubstitutionRisk: true,
            hasPricingDiscretion: true,
            approvedByFinancePolicyVersion: 'IFRS15-UAE-2026.1',
          },
        },
      });
      expect(awardLimo.status).toBe(200);
      limoAwardId = awardLimo.data.award.id;

      // 4. Partner A assigns Maybach & Chauffeur
      const assignLimo = await apiJson('/api/exchange/jobs/assign', {
        cookie: partnerACookie,
        body: {
          awardId: limoAwardId,
          vehicleId: partnerALimoVehicleId,
          vehiclePlate: 'DXB-VIP-01',
          driverId: partnerALimoDriverId,
          driverName: 'Karim Elmasri',
          driverPhone: '+971502001002',
        },
      });
      expect(assignLimo.status).toBe(200);
      limoAssignmentId = assignLimo.data.assignment.id;
      limoDriverToken = assignLimo.data.rawToken;

      // 5. Chauffeur executes REACHED -> STARTED -> COMPLETED with VIP Guest Confirmation ePOD
      expect((await apiJson(`/api/public/partner-driver/${limoDriverToken}`, { body: { action: 'REACHED' } })).status).toBe(200);
      expect((await apiJson(`/api/public/partner-driver/${limoDriverToken}`, { body: { action: 'STARTED' } })).status).toBe(200);
      const completeLimo = await apiJson(`/api/public/partner-driver/${limoDriverToken}`, {
        body: {
          action: 'COMPLETED',
          passengerCount: 2,
          signedByName: 'Protocol Officer Ahmed Al Zaabi',
          signatureUrl: 'data:image/png;base64,VIP_SIG_HASH',
          completionNotes: 'VIP delegation delivered smoothly to Emirates Palace',
          podMetadata: {
            vipGuestConfirmed: true,
            actualWaitingMinutes: 15,
            tollGateCount: 2,
          },
        },
      });
      expect(completeLimo.status).toBe(200);

      // Verify native Booking transitioned to COMPLETED
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      try {
        const syncedBooking = await prisma.booking.findUnique({ where: { id: nativeLimoBookingId } });
        expect(syncedBooking?.status).toBe('COMPLETED');
      } finally {
        await prisma.$disconnect();
      }
    });

    test('Phase 4.3 [Vertical 3 — FREIGHT / Load Board + Canonical Bridge ARCH-4]: Shipment -> Freight RFQ -> Canonical PartnerQuote Projected into Load Board -> Seal/Weight ePOD -> Shipment CLOSED', async () => {
      const tomorrowIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // 1. Buyer creates a cold-chain Freight Shipment via /api/logistics/shipments
      const createShip = await apiJson('/api/logistics/shipments', {
        cookie: buyerCookie,
        body: {
          cargoOwnerName: 'Gulf Pharma Cold-Chain Distribution',
          shipmentType: 'FTL',
          bookingMode: 'SPOT',
          marketplaceStatus: 'PRIVATE',
          status: 'PENDING',
          priority: 'HIGH',
          originName: 'Jebel Ali Free Zone (JAFZA) Cold Hub',
          originAddress: 'JAFZA South Plot S402, Dubai',
          destinationName: 'KIZAD Pharma Logistics Park',
          destinationAddress: 'KEZAD Zone A, Abu Dhabi',
          pickupWindowFrom: tomorrowIso,
          requestedVehicleType: 'REEFER_COLD',
          totalWeightKg: 4500,
          totalVolumeCbm: 24,
          currency: 'AED',
          cargoLines: [
            { description: 'Vaccines & Biologics (+4C)', quantity: 10, weightKg: 4500, volumeCbm: 24 },
          ],
        },
      });
      expect([200, 201]).toContain(createShip.status);
      nativeFreightShipmentId = createShip.data.id || createShip.data.data?.id;
      expect(nativeFreightShipmentId).toBeTruthy();

      // 2. Buyer posts Freight Load to Marketplace via /api/logistics/rfqs -> triggers FreightRfqCanonicalBridge!
      const createRfq = await apiJson('/api/logistics/rfqs', {
        cookie: buyerCookie,
        body: {
          shipmentOrderId: nativeFreightShipmentId,
          inviteScope: 'ALL_ACTIVE_CARRIERS',
          bidDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      expect(createRfq.status).toBe(201);
      nativeFreightRfqId = createRfq.data.id;
      expect(nativeFreightRfqId).toBeTruthy();

      // 3. Verify FreightRfqCanonicalBridge automatically created canonical FREIGHT OutsourceRequest
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      try {
        const bridgedReq = await prisma.outsourceRequest.findFirst({
          where: {
            tenantId: buyerCtx!.tenantId,
            domain: 'FREIGHT',
            sourceReferenceId: nativeFreightShipmentId,
          },
          include: { opportunity: true },
        });
        expect(bridgedReq).not.toBeNull();
        freightRequestId = bridgedReq!.id;
      } finally {
        await prisma.$disconnect();
      }

      // 4. Partner A discovers canonical FREIGHT opportunity & submits PartnerQuote via /api/exchange/jobs/quotes
      const quoteFreight = await apiJson('/api/exchange/jobs/quotes', {
        cookie: partnerACookie,
        body: {
          requestId: freightRequestId,
          amount: 2400,
          currency: 'AED',
          proposedVehicleId: partnerAFreightVehicleId,
          proposedDriverId: partnerAFreightDriverId,
          notes: 'GDP-certified Volvo FH16 Reefer (+4C continuous data logger)',
        },
      });
      expect(quoteFreight.status).toBe(200);

      // 5. ARCH-4 Verification: Buyer fetches /api/logistics/rfqs/[id]/bids and sees canonical PartnerQuote projected seamlessly!
      const loadBoardBids = await apiJson(`/api/logistics/rfqs/${nativeFreightRfqId}/bids`, {
        cookie: buyerCookie,
      });
      expect(loadBoardBids.status).toBe(200);
      const projectedBid = (loadBoardBids.data.data || []).find(
        (b: any) => b.canonicalQuoteId === quoteFreight.data.quote.id,
      );
      expect(projectedBid).toBeDefined();
      expect(projectedBid.amount).toBe(2400);
      expect(String(projectedBid.bidNo)).toMatch(/^EXQ-/);

      // 6. Buyer awards canonical Freight quote, Partner A assigns Reefer Truck & Driver, Driver completes with Seal & Weight ePOD
      const awardFreight = await apiJson('/api/bus-ops/outsource', {
        cookie: buyerCookie,
        body: {
          action: 'AWARD_QUOTE',
          requestId: freightRequestId,
          quoteId: quoteFreight.data.quote.id,
        },
      });
      expect(awardFreight.status).toBe(200);
      freightAwardId = awardFreight.data.award.id;

      const assignFreight = await apiJson('/api/exchange/jobs/assign', {
        cookie: partnerACookie,
        body: {
          awardId: freightAwardId,
          vehicleId: partnerAFreightVehicleId,
          vehiclePlate: 'DXB-RFR-01',
          driverId: partnerAFreightDriverId,
          driverName: 'Imran Siddiqui',
          driverPhone: '+971502001003',
        },
      });
      expect(assignFreight.status).toBe(200);
      freightAssignmentId = assignFreight.data.assignment.id;
      freightDriverToken = assignFreight.data.rawToken;

      expect((await apiJson(`/api/public/partner-driver/${freightDriverToken}`, { body: { action: 'REACHED' } })).status).toBe(200);
      expect((await apiJson(`/api/public/partner-driver/${freightDriverToken}`, { body: { action: 'STARTED' } })).status).toBe(200);
      const completeFreight = await apiJson(`/api/public/partner-driver/${freightDriverToken}`, {
        body: {
          action: 'COMPLETED',
          passengerCount: 10, // 10 pharma pallets matching requiredCapacity
          signedByName: 'Receiving Cold-Store Pharmacist',
          signatureUrl: 'data:image/png;base64,FREIGHT_SIG_HASH',
          completionNotes: 'Seal intact, reefer maintained +3.8C throughout transit',
          podMetadata: {
            sealIntact: true,
            deliveredWeightKg: 4500,
            temperatureCelsius: 3.8,
          },
        },
      });
      expect(completeFreight.status).toBe(200);

      // Verify native logistics_shipment_orders transitioned to CLOSED via FreightOutsourcingAdapter
      const prismaVerify = new PrismaClient();
      try {
        const rows = await prismaVerify.$queryRawUnsafe<
          Array<{ status: string; assigned_carrier_id: string | null; assignment_type: string | null }>
        >(
          `SELECT status, assigned_carrier_id, metadata->>'assignmentType' AS assignment_type FROM logistics_shipment_orders WHERE id = $1 LIMIT 1`,
          nativeFreightShipmentId,
        );
        expect(rows[0]?.assigned_carrier_id).toBe(partnerAId);
        expect(rows[0]?.assignment_type).toBe('PARTNER_CARRIER');
        expect(rows[0]?.status).toBe('CLOSED');
      } finally {
        await prismaVerify.$disconnect();
      }
    });

    test('Phase 4.4 [Vertical 4 — RECOVERY / Roadside Breakdown]: Outsource BreakdownReport -> Quote -> Award -> 4-Corner Tow Photo ePOD -> BreakdownReport RECOVERY_COMPLETED', async () => {
      const tomorrowIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const createRec = await apiJson('/api/bus-ops/outsource', {
        cookie: buyerCookie,
        body: {
          action: 'CREATE_REQUEST',
          breakdownId: nativeBreakdownId,
          domain: 'RECOVERY',
          serviceDate: tomorrowIso,
          pickupTime: '08:15',
          pickupLocation: 'Sheikh Mohammed Bin Zayed Road (E311) Exit 47, Dubai',
          dropoffLocation: 'Al Quoz Auto Central Workshop 12',
          requiredCapacity: 1,
          vehicleTypeRequired: 'FLATBED',
          invitedPartnerIds: [partnerAId],
          publishToMarketplace: true,
        },
      });
      expect(createRec.status).toBe(200);
      recoveryRequestId = createRec.data.request.id;
      expect(createRec.data.request.domain).toBe('RECOVERY');

      const quoteRec = await apiJson('/api/exchange/jobs/quotes', {
        cookie: partnerACookie,
        body: {
          requestId: recoveryRequestId,
          amount: 650,
          currency: 'AED',
          proposedVehicleId: partnerARecoveryVehicleId,
          proposedDriverId: partnerARecoveryDriverId,
          notes: 'Hydraulic flatbed with winch — 20m highway response ETA',
        },
      });
      expect(quoteRec.status).toBe(200);

      const awardRec = await apiJson('/api/bus-ops/outsource', {
        cookie: buyerCookie,
        body: {
          action: 'AWARD_QUOTE',
          requestId: recoveryRequestId,
          quoteId: quoteRec.data.quote.id,
        },
      });
      expect(awardRec.status).toBe(200);
      recoveryAwardId = awardRec.data.award.id;

      const assignRec = await apiJson('/api/exchange/jobs/assign', {
        cookie: partnerACookie,
        body: {
          awardId: recoveryAwardId,
          vehicleId: partnerARecoveryVehicleId,
          vehiclePlate: 'DXB-TOW-01',
          driverId: partnerARecoveryDriverId,
          driverName: 'Saeed Al Kaabi',
          driverPhone: '+971502001004',
        },
      });
      expect(assignRec.status).toBe(200);
      recoveryAssignmentId = assignRec.data.assignment.id;
      recoveryDriverToken = assignRec.data.rawToken;

      expect((await apiJson(`/api/public/partner-driver/${recoveryDriverToken}`, { body: { action: 'REACHED' } })).status).toBe(200);
      expect((await apiJson(`/api/public/partner-driver/${recoveryDriverToken}`, { body: { action: 'STARTED' } })).status).toBe(200);
      const completeRec = await apiJson(`/api/public/partner-driver/${recoveryDriverToken}`, {
        body: {
          action: 'COMPLETED',
          passengerCount: 1,
          signedByName: 'Workshop Foreman Bilal Khan',
          signatureUrl: 'data:image/png;base64,RECOVERY_SIG_HASH',
          photoUrl: 'https://storage.fleet360.local/e2e/4corner-hookup.jpg',
          completionNotes: 'Vehicle winched safely onto flatbed and delivered to Al Quoz Bay 4',
          podMetadata: {
            hookupPhotoVerified: true,
            towDestinationWorkshop: 'Al Quoz Auto Central Workshop 12',
          },
        },
      });
      expect(completeRec.status).toBe(200);

      // Verify native BreakdownReport transitioned to RECOVERY_COMPLETED
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      try {
        const syncedBreakdown = await prisma.breakdownReport.findUnique({ where: { id: nativeBreakdownId } });
        expect(syncedBreakdown?.status).toBe('RECOVERY_COMPLETED');
        expect(syncedBreakdown?.recoveryCompletedAt).not.toBeNull();
      } finally {
        await prisma.$disconnect();
      }
    });

    // =========================================================================
    // PHASE 5: Automated SLA Sweeper (ARCH-2), T-30m Warning & Standby Failover
    // =========================================================================

    test('Phase 5.1: ARCH-2 Expired Opportunity Sweeper transitions past-deadline RFQs to EXPIRED & Buyer Re-Broadcasts (+24h)', async () => {
      // Create an opportunity whose bidding deadline already elapsed 5 minutes ago
      const expiredClosesAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const createExpired = await apiJson('/api/bus-ops/outsource', {
        cookie: buyerCookie,
        body: {
          action: 'CREATE_REQUEST',
          domain: 'PASSENGER_TRANSPORT',
          serviceDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          pickupTime: '14:00',
          pickupLocation: 'Dubai Marina Mall',
          dropoffLocation: 'Al Maktoum International Airport (DWC)',
          requiredCapacity: 30,
          closesAt: expiredClosesAt,
          publishToMarketplace: true,
        },
      });
      expect(createExpired.status).toBe(200);
      const expiredReqId = createExpired.data.request.id;

      // Run SLA Sweeper
      const sweepRes = await apiJson('/api/exchange/scorecard', {
        cookie: buyerCookie,
        body: { action: 'RUN_SLA_SWEEPER', graceMinutes: 30, autoTriggerFailover: false },
      });
      expect(sweepRes.status).toBe(200);
      expect(sweepRes.data.sweeper.expiredOpportunities.sweptCount).toBeGreaterThanOrEqual(1);

      // Buyer clicks Re-Broadcast / Extend (+24h)
      const rebroadcastRes = await apiJson('/api/bus-ops/outsource', {
        cookie: buyerCookie,
        body: {
          action: 'EXTEND_OR_REBROADCAST_RFQ',
          requestId: expiredReqId,
          extensionHours: 24,
        },
      });
      expect(rebroadcastRes.status).toBe(200);
      expect(rebroadcastRes.data.opportunity.status).toBe('OPEN');
    });

    test('Phase 5.2: Proactive T-30m Pickup SLA Warning & Governed Standby Waterfall Failover (Partner A defaults -> Partner B promoted)', async () => {
      // Schedule pickup 15 minutes from now (inside T-30m warning window!)
      const soon = new Date(Date.now() + 15 * 60 * 1000);
      const pickupUtcHhMm = `${String(soon.getUTCHours()).padStart(2, '0')}:${String(soon.getUTCMinutes()).padStart(2, '0')}`;

      const createFailoverReq = await apiJson('/api/bus-ops/outsource', {
        cookie: buyerCookie,
        body: {
          action: 'CREATE_REQUEST',
          domain: 'PASSENGER_TRANSPORT',
          serviceDate: soon.toISOString(),
          pickupTime: pickupUtcHhMm,
          pickupLocation: 'DIFC Gate Village',
          dropoffLocation: 'DXB Terminal 1',
          requiredCapacity: 50,
          invitedPartnerIds: [partnerAId, partnerBId],
          publishToMarketplace: true,
        },
      });
      expect(createFailoverReq.status).toBe(200);
      const failoverReqId = createFailoverReq.data.request.id;

      // Both Partner A (AED 1,100) and Partner B (AED 1,250 standby runner-up) quote
      const qA = await apiJson('/api/exchange/jobs/quotes', {
        cookie: partnerACookie,
        body: { requestId: failoverReqId, amount: 1100, currency: 'AED' },
      });
      const qB = await apiJson('/api/exchange/jobs/quotes', {
        cookie: partnerBCookie,
        body: { requestId: failoverReqId, amount: 1250, currency: 'AED' },
      });
      expect(qA.status).toBe(200);
      expect(qB.status).toBe(200);

      // Buyer awards Partner A & Partner A assigns vehicle/driver (leaving reachedAt = null)
      const awA = await apiJson('/api/bus-ops/outsource', {
        cookie: buyerCookie,
        body: { action: 'AWARD_QUOTE', requestId: failoverReqId, quoteId: qA.data.quote.id },
      });
      expect(awA.status).toBe(200);
      const failoverAwardId = awA.data.award.id;

      const asgA = await apiJson('/api/exchange/jobs/assign', {
        cookie: partnerACookie,
        body: {
          awardId: failoverAwardId,
          vehicleId: partnerACoachVehicleId,
          vehiclePlate: 'DXB-FAIL-01',
          driverId: partnerABusDriverId,
          driverName: 'Rashid Al Nuaimi',
          driverPhone: '+971502001001',
        },
      });
      expect(asgA.status).toBe(200);
      const defaultingToken = asgA.data.rawToken as string;

      // 1. Run SLA Sweeper -> detects T-30m pickup SLA warning on failoverAwardId!
      const warnSweep = await apiJson('/api/exchange/scorecard', {
        cookie: buyerCookie,
        body: { action: 'RUN_SLA_SWEEPER', graceMinutes: 30, autoTriggerFailover: false },
      });
      expect(warnSweep.status).toBe(200);
      expect(warnSweep.data.sweeper.overdueNoShows.proactiveWarningAwardIds).toContain(failoverAwardId);

      // 2. Trigger Governed Failover Re-Sourcing -> revokes Partner A's token & promotes Partner B's runner-up quote!
      const failoverRes = await apiJson('/api/exchange/scorecard', {
        cookie: buyerCookie,
        body: {
          action: 'TRIGGER_FAILOVER',
          awardId: failoverAwardId,
          reason: 'Partner A coach mechanical breakdown en route; promoting compliant standby runner-up.',
        },
      });
      expect(failoverRes.status).toBe(200);
      expect(failoverRes.data.failover.outcome).toBe('PROMOTED_STANDBY_RUNNER_UP');
      expect(failoverRes.data.failover.previousPartnerId).toBe(partnerAId);
      expect(failoverRes.data.failover.promotedPartnerId).toBe(partnerBId);
      expect(failoverRes.data.failover.defaultingPartnerPenaltyAmount).toBe(275); // 25% of AED 1,100

      // Defaulting Partner A's driver link MUST now be revoked (404)
      const checkRevoked = await apiJson(`/api/public/partner-driver/${defaultingToken}`);
      expect(checkRevoked.status).toBe(404);

      // Standby Partner B can now assign its compliant Abu Dhabi coach to the promoted award (used for Phase 7 UI preview!)
      const asgB = await apiJson('/api/exchange/jobs/assign', {
        cookie: partnerBCookie,
        body: {
          awardId: failoverAwardId,
          vehicleId: partnerBCoachVehicleId,
          vehiclePlate: 'AUH-STB-99',
          driverId: partnerBBusDriverId,
          driverName: 'Hamdan Al Mazrouei',
          driverPhone: '+971506007001',
        },
      });
      expect(asgB.status).toBe(200);
      activePreviewToken = asgB.data.rawToken;
    });

    // =========================================================================
    // PHASE 6: 3-Way Match, Fuel Surcharge Indexation, Non-Blocking Disputes & PDFs
    // =========================================================================

    test('Phase 6.1: Clean Multi-Vertical Invoices + FUNC-5 Fuel Surcharge Indexation pass 3-Way Match & Approve into Finance AP', async () => {
      const todayIso = new Date().toISOString().slice(0, 10);

      // 1. Bus Invoice: Base AED 1,500 + contracted 8% Fuel Surcharge (AED 120 + AED 6 VAT = AED 126) -> Subtotal 1,620, VAT 81
      const invBus = await apiJson('/api/exchange/invoices', {
        cookie: partnerACookie,
        body: {
          awardId: busAwardId,
          invoiceNumber: `INV-BUS-${Date.now().toString().slice(-6)}`,
          invoiceDate: todayIso,
          subtotalAmount: 1620,
          vatAmount: 81,
          items: [
            {
              description: 'Intercity 50-Seat Coach Base Charter',
              quantity: 1,
              unitPrice: 1500,
              amount: 1500,
              vatAmount: 75,
              totalAmount: 1575,
            },
            {
              description: 'UAE MoE Monthly Fuel Surcharge Indexation (8%)',
              varianceReason: 'OTHER',
              quantity: 1,
              unitPrice: 120,
              amount: 120,
              vatAmount: 6,
              totalAmount: 126,
            },
          ],
        },
      });
      expect(invBus.status).toBe(200);
      busInvoiceId = invBus.data.invoice.id;

      const matchBus = await apiJson('/api/bus-ops/outsource/settlements', {
        cookie: buyerCookie,
        body: { action: 'RECONCILE_INVOICE', invoiceId: busInvoiceId },
      });
      expect(matchBus.status).toBe(200);
      expect(matchBus.data.reconciliation.snapshotIntegrityVerified).toBe(true);
      expect(matchBus.data.reconciliation.matchStatus).toBe('MATCHED');
      expect(matchBus.data.reconciliation.suggestedDeductions).toHaveLength(0);

      // 2. Limousine Invoice (exact match: AED 1,200 + AED 60 VAT)
      const invLimo = await apiJson('/api/exchange/invoices', {
        cookie: partnerACookie,
        body: {
          awardId: limoAwardId,
          invoiceNumber: `INV-VIP-${Date.now().toString().slice(-6)}`,
          invoiceDate: todayIso,
          subtotalAmount: 1200,
          vatAmount: 60,
        },
      });
      expect(invLimo.status).toBe(200);
      limoInvoiceId = invLimo.data.invoice.id;

      const matchLimo = await apiJson('/api/bus-ops/outsource/settlements', {
        cookie: buyerCookie,
        body: { action: 'RECONCILE_INVOICE', invoiceId: limoInvoiceId },
      });
      expect(matchLimo.status).toBe(200);
      expect(matchLimo.data.reconciliation.matchStatus).toBe('MATCHED');

      // 3. Freight Invoice (exact match: AED 2,400 + AED 120 VAT)
      const invFreight = await apiJson('/api/exchange/invoices', {
        cookie: partnerACookie,
        body: {
          awardId: freightAwardId,
          invoiceNumber: `INV-FRT-${Date.now().toString().slice(-6)}`,
          invoiceDate: todayIso,
          subtotalAmount: 2400,
          vatAmount: 120,
        },
      });
      expect(invFreight.status).toBe(200);
      freightInvoiceId = invFreight.data.invoice.id;

      const matchFreight = await apiJson('/api/bus-ops/outsource/settlements', {
        cookie: buyerCookie,
        body: { action: 'RECONCILE_INVOICE', invoiceId: freightInvoiceId },
      });
      expect(matchFreight.status).toBe(200);
      expect(matchFreight.data.reconciliation.matchStatus).toBe('MATCHED');

      // Buyer Finance approves all 3 clean multi-vertical invoices
      for (const id of [busInvoiceId, limoInvoiceId, freightInvoiceId]) {
        const appRes = await apiJson('/api/bus-ops/outsource', {
          cookie: buyerCookie,
          body: { action: 'APPROVE_INVOICE', invoiceId: id },
        });
        expect(appRes.status).toBe(200);
        expect(appRes.data.invoice.status).toBe('APPROVED');
      }
    });

    test('Phase 6.2: Over-billed Recovery Invoice triggers 3-Way Match VARIANCE_DETECTED & Non-Blocking Dispute Isolation', async () => {
      const todayIso = new Date().toISOString().slice(0, 10);

      // Recovery award was AED 650 + 32.50 VAT = 682.50, but Partner bills AED 450 unauthorized waiting fee!
      const invRec = await apiJson('/api/exchange/invoices', {
        cookie: partnerACookie,
        body: {
          awardId: recoveryAwardId,
          invoiceNumber: `INV-REC-${Date.now().toString().slice(-6)}`,
          invoiceDate: todayIso,
          subtotalAmount: 1100,
          vatAmount: 55,
          items: [
            {
              description: 'Flatbed Highway Recovery Base Tow',
              quantity: 1,
              unitPrice: 650,
              amount: 650,
              vatAmount: 32.5,
              totalAmount: 682.5,
            },
            {
              description: 'Uncontracted 4.5h Highway Waiting Surcharge',
              varianceReason: 'WAITING_TIME',
              quantity: 1,
              unitPrice: 450,
              amount: 450,
              vatAmount: 22.5,
              totalAmount: 472.5,
            },
          ],
        },
      });
      expect(invRec.status).toBe(200);
      recoveryDisputedInvoiceId = invRec.data.invoice.id;

      // 3-Way Match MUST flag VARIANCE_DETECTED because GPS timestamps show <1m actual wait (<30m free allowance)
      const matchRec = await apiJson('/api/bus-ops/outsource/settlements', {
        cookie: buyerCookie,
        body: { action: 'RECONCILE_INVOICE', invoiceId: recoveryDisputedInvoiceId },
      });
      expect(matchRec.status).toBe(200);
      expect(matchRec.data.reconciliation.matchStatus).toBe('VARIANCE_DETECTED');
      expect(matchRec.data.reconciliation.suggestedDeductions.length).toBeGreaterThan(0);

      // Buyer raises a formal OutsourceDispute isolating ONLY the Recovery invoice
      const raiseDisp = await apiJson('/api/bus-ops/outsource/disputes', {
        cookie: buyerCookie,
        body: {
          action: 'RAISE_DISPUTE',
          partnerId: partnerAId,
          invoiceId: recoveryDisputedInvoiceId,
          disputedAmount: 472.5,
          reason: 'GPS telemetry confirms immediate hookup (<1m wait vs 30m free contract allowance).',
        },
      });
      expect(raiseDisp.status).toBe(200);
      expect(raiseDisp.data.ok).toBe(true);
      recoveryDisputeId = raiseDisp.data.dispute.id;
    });

    test('Phase 6.3: Consolidated Settlement Statement groups clean Bus/Limo/Freight invoices WITHOUT blocking on disputed Recovery invoice', async () => {
      const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const periodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const genStmt = await apiJson('/api/bus-ops/outsource/settlements', {
        cookie: buyerCookie,
        body: {
          action: 'GENERATE_STATEMENT',
          partnerId: partnerAId,
          periodStart,
          periodEnd,
        },
      });
      expect(genStmt.status).toBe(200);
      expect(genStmt.data.ok).toBe(true);
      expect(genStmt.data.invoicesCount).toBe(3); // Bus + Limo + Freight consolidated; Recovery dispute isolated!
      settlementStatementId = genStmt.data.statement.id;

      // Approve consolidated Settlement Statement
      const approveStmt = await apiJson('/api/bus-ops/outsource/settlements', {
        cookie: buyerCookie,
        body: { action: 'APPROVE_STATEMENT', statementId: settlementStatementId },
      });
      expect(approveStmt.status).toBe(200);
      expect(approveStmt.data.statement.status).toBe('APPROVED');

      // Resolve the isolated Recovery dispute with a credit note adjustment
      const resolveDisp = await apiJson('/api/bus-ops/outsource/disputes', {
        cookie: buyerCookie,
        body: {
          action: 'RESOLVE_DISPUTE',
          disputeId: recoveryDisputeId,
          resolution: 'CREDIT_NOTE_ISSUED',
          resolvedAmount: 0,
          creditNoteRef: 'CN-ALMAHA-2026-001',
          resolutionNotes: 'Partner issued credit note waiving unverified waiting charge.',
        },
      });
      expect(resolveDisp.status).toBe(200);
    });

    test('Phase 6.4: Vector PDF Streaming (Multi-Vertical ePODs + UAE FTA Tax Statement) & 4-Vertical Executive Analytics', async () => {
      // Verify ePOD Receipt PDFs stream valid `%PDF-1.` bytes across all 4 completed verticals!
      for (const assignmentId of [busAssignmentId, limoAssignmentId, freightAssignmentId, recoveryAssignmentId]) {
        const podPdfRes = await fetch(`${BASE_URL}/api/exchange/pod/${assignmentId}/pdf`, {
          headers: { Cookie: partnerACookie },
        });
        expect(podPdfRes.status).toBe(200);
        expect(podPdfRes.headers.get('content-type')).toContain('application/pdf');
        const bytes = Buffer.from(await podPdfRes.arrayBuffer());
        expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      }

      // Verify UAE FTA Tax Invoice / Settlement Statement PDF streams valid `%PDF-1.` bytes
      const stmtPdfRes = await fetch(`${BASE_URL}/api/exchange/statements/${settlementStatementId}/pdf`, {
        headers: { Cookie: buyerCookie },
      });
      expect(stmtPdfRes.status).toBe(200);
      expect(stmtPdfRes.headers.get('content-type')).toContain('application/pdf');
      const stmtBytes = Buffer.from(await stmtPdfRes.arrayBuffer());
      expect(stmtBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');

      // Recalculate Partner A 5-KPI Trust Scorecard & verify Executive Spend/3-Way Analytics across all 4 domains
      const recalc = await apiJson('/api/exchange/scorecard', {
        cookie: buyerCookie,
        body: { partnerId: partnerAId },
      });
      expect(recalc.status).toBe(200);

      const dirRes = await apiJson('/api/exchange/partner/profile?mode=directory', {
        cookie: buyerCookie,
      });
      expect(dirRes.status).toBe(200);
      const breakdown = dirRes.data.executiveAnalytics?.verticalBreakdown || [];
      for (const dom of ['PASSENGER_TRANSPORT', 'LIMOUSINE', 'FREIGHT', 'RECOVERY']) {
        const entry = breakdown.find((b: any) => b.domain === dom);
        expect(entry).toBeDefined();
        expect(entry.awardCount).toBeGreaterThanOrEqual(1);
        expect(entry.awardedSpendAed).toBeGreaterThan(0);
      }
      expect(dirRes.data.executiveAnalytics.commercialLedger.agencyAwardCount).toBeGreaterThanOrEqual(3);
      expect(dirRes.data.executiveAnalytics.commercialLedger.principalAwardCount).toBeGreaterThanOrEqual(1);
    });

    // =========================================================================
    // PHASE 7: Live Chromium UI Regression Across Buyer, Partner & Driver Portals
    // =========================================================================

    test('Phase 7.1: Buyer UI Surfaces (/outsourcing/partners, /bus-ops/marketplace, /booking-portal, /logistics/marketplace) render live 4-vertical data cleanly', async ({ page }) => {
      await loginWithStoredState(page, buyerAuth!, buyerCtx!);

      const buyerRoutes = [
        '/outsourcing/partners',
        '/bus-ops/marketplace',
        '/booking-portal',
        '/logistics/marketplace',
      ];

      for (const route of buyerRoutes) {
        const resp = await page.goto(route, { waitUntil: 'domcontentloaded' });
        expect(resp?.status() ?? 200).toBeLessThan(500);
        await expect(page.locator('body')).toBeVisible();
        const visibleText = await page.locator('body').innerText();
        expect(visibleText).not.toContain('Application error: a client-side exception has occurred');
      }

      // Verify /outsourcing/partners displays Partner A & Executive Governance tabs
      await page.goto('/outsourcing/partners', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('body')).toContainText(/Partner|Rate|Scorecard/i, { timeout: 15000 });
    });

    test('Phase 7.2: Partner Portal UI Surfaces (/exchange/dashboard, /marketplace, /jobs, /invoices, /statements, /compliance, /profile) render live lifecycle records', async ({ page }) => {
      await loginWithStoredState(page, partnerAAuth!, partnerACtx!);

      const partnerRoutes = [
        '/exchange/dashboard',
        '/exchange/marketplace',
        '/exchange/jobs',
        '/exchange/invoices',
        '/exchange/statements',
        '/exchange/compliance',
        '/exchange/profile',
      ];

      for (const route of partnerRoutes) {
        const resp = await page.goto(route, { waitUntil: 'domcontentloaded' });
        expect(resp?.status() ?? 200).toBeLessThan(500);
        await expect(page.locator('body')).toBeVisible();
        const visibleText = await page.locator('body').innerText();
        expect(visibleText).not.toContain('Application error: a client-side exception has occurred');
      }

      // Verify /exchange/jobs shows completed jobs / ePOD or milestone UI
      await page.goto('/exchange/jobs', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('body')).toContainText(/Jobs|Award|Completed|Requests/i, { timeout: 15000 });
    });

    test('Phase 7.3: External Partner Driver Zero-Login Mobile Screen (/track/partner-trip/[token]) renders live trip & milestone controls', async ({ browser }) => {
      const driverContext = await browser.newContext();
      const driverPage = await driverContext.newPage();
      try {
        const resp = await driverPage.goto(`/track/partner-trip/${activePreviewToken}`, {
          waitUntil: 'domcontentloaded',
        });
        expect(resp?.status() ?? 200).toBeLessThan(500);
        await expect(driverPage.locator('body')).toContainText(/DIFC Gate Village|DXB Terminal 1|Bus & Coach/i, {
          timeout: 15000,
        });
      } finally {
        await driverContext.close();
      }
    });
  },
);
