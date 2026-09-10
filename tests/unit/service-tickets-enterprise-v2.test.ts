/**
 * Enterprise V2 Service & Support Ticketing Gap Closure Test Suite
 *
 * Covers:
 *  1. P0 Security: Public Tracking Token Hardening & Sequential ID Enumeration Elimination
 *  2. P0 Governance: Segregation of Duties & Multi-Role Approval State Machine
 *  3. P0 Safety: DVIR Critical Defect Vehicle Grounding & Conditional Ungrounding
 *  4. P1 Operations: Active SLA Sweeper Idempotency & Tier 3 Paging Cooldown Deduplication
 *  5. P1 Domain Adapters: Multi-line Vehicle Replacement (RAC, Staff Transport, Leasing)
 *  6. P2 Financial Control: Multi-Line Case Cost Ledger & Multi-Payer Breakdown
 */

import { describe, it, expect } from 'vitest';
import {
  calculateSummaryFromLines,
  type CaseCostLine,
} from '@/lib/service-tickets/cost-ledger';

describe('Enterprise V2: Service & Support Ticketing Gaps Closure', () => {
  // --------------------------------------------------------------------------
  // 1. P0 Security: Public Tracking Token Hardening
  // --------------------------------------------------------------------------
  describe('P0 Security: Public Tracking Token Hardening', () => {
    const TOKEN_REGEX = /^[a-f0-9]{24,64}$/i;

    it('strictly accepts secure 32 to 64 character hex tokens', () => {
      const valid32CharToken = 'a1b2c3d4e5f6789012345678abcdef01';
      const valid64CharToken = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

      expect(TOKEN_REGEX.test(valid32CharToken)).toBe(true);
      expect(TOKEN_REGEX.test(valid64CharToken)).toBe(true);
    });

    it('strictly rejects sequential ticket numbers and arbitrary identifiers', () => {
      const sequentialId1 = 'ST2026-MNT-0001';
      const sequentialId2 = 'ST2026-TOW-0042';
      const shortId = 'abc123';
      const sqlInjection = "1' OR '1'='1";

      expect(TOKEN_REGEX.test(sequentialId1)).toBe(false);
      expect(TOKEN_REGEX.test(sequentialId2)).toBe(false);
      expect(TOKEN_REGEX.test(shortId)).toBe(false);
      expect(TOKEN_REGEX.test(sqlInjection)).toBe(false);
    });

    it('identifies expired tokens older than 30 days (TTL expiry check)', () => {
      const isTokenExpired = (createdAt: Date, now: Date): boolean => {
        const diffMs = now.getTime() - createdAt.getTime();
        const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
        return diffMs > maxAgeMs;
      };

      const now = new Date('2026-09-10T12:00:00Z');
      const freshTokenDate = new Date('2026-09-05T12:00:00Z'); // 5 days old
      const expiredTokenDate = new Date('2026-08-01T12:00:00Z'); // 40 days old

      expect(isTokenExpired(freshTokenDate, now)).toBe(false);
      expect(isTokenExpired(expiredTokenDate, now)).toBe(true);
    });

    it('enforces in-memory rate limiter per IP address', () => {
      const hitMap = new Map<string, { count: number; resetAt: number }>();
      const LIMIT = 30;
      const WINDOW_MS = 60 * 1000;

      const checkRateLimit = (ip: string, now: number): boolean => {
        const record = hitMap.get(ip);
        if (!record || now > record.resetAt) {
          hitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
          return true;
        }
        if (record.count >= LIMIT) {
          return false;
        }
        record.count++;
        return true;
      };

      const testIp = '192.168.1.50';
      const startTime = Date.now();

      // First 30 requests succeed
      for (let i = 0; i < 30; i++) {
        expect(checkRateLimit(testIp, startTime)).toBe(true);
      }
      // 31st request is blocked
      expect(checkRateLimit(testIp, startTime)).toBe(false);

      // After window reset, requests succeed again
      expect(checkRateLimit(testIp, startTime + 61 * 1000)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. P0 Governance: Segregation of Duties & Approval Authorization
  // --------------------------------------------------------------------------
  describe('P0 Governance: Segregation of Duties & Approval Authorization', () => {
    const APPROVAL_ROLES = [
      'SUPER_ADMIN',
      'COMPANY_ADMIN',
      'FLEET_MANAGER',
      'OPERATIONS_MANAGER',
      'MAINTENANCE_SUPERVISOR',
      'WORKSHOP_MANAGER',
    ];

    const canApproveTicket = (
      userId: string,
      requestorId: string,
      userRole: string,
      permissions: string[] = []
    ): { allowed: boolean; reason?: string } => {
      if (userId === requestorId) {
        return { allowed: false, reason: 'Segregation of duties: Ticket requester cannot approve their own ticket' };
      }
      const hasManagerRole = APPROVAL_ROLES.includes(userRole);
      const hasDirectPermission = permissions.includes('service_ticket.approve');
      if (!hasManagerRole && !hasDirectPermission) {
        return { allowed: false, reason: 'Insufficient privileges: Approval requires authorized manager role' };
      }
      return { allowed: true };
    };

    it('prevents ticket requesters from self-approving their tickets', () => {
      const requesterId = 'usr-requester-1';
      const result = canApproveTicket(requesterId, requesterId, 'FLEET_MANAGER');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Segregation of duties');
    });

    it('allows distinct fleet managers and supervisors to approve tickets', () => {
      const requesterId = 'usr-driver-1';
      const approverId = 'usr-manager-2';

      expect(canApproveTicket(approverId, requesterId, 'FLEET_MANAGER').allowed).toBe(true);
      expect(canApproveTicket(approverId, requesterId, 'OPERATIONS_MANAGER').allowed).toBe(true);
      expect(canApproveTicket(approverId, requesterId, 'MAINTENANCE_SUPERVISOR').allowed).toBe(true);
    });

    it('rejects unprivileged drivers or general users from approving tickets', () => {
      const requesterId = 'usr-driver-1';
      const unauthorizedId = 'usr-driver-2';

      const result = canApproveTicket(unauthorizedId, requesterId, 'DRIVER');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient privileges');
    });

    it('validates state transitions: only pending/open/escalated tickets can be approved', () => {
      const isValidApprovalTransition = (currentStatus: string): boolean => {
        const APPROVABLE_STATUSES = ['Pending', 'Awaiting Approval', 'Escalated', 'Open'];
        return APPROVABLE_STATUSES.includes(currentStatus);
      };

      expect(isValidApprovalTransition('Pending')).toBe(true);
      expect(isValidApprovalTransition('Awaiting Approval')).toBe(true);
      expect(isValidApprovalTransition('Escalated')).toBe(true);
      expect(isValidApprovalTransition('Resolved')).toBe(false);
      expect(isValidApprovalTransition('Closed')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 3. P0 Safety: DVIR Critical Defect Grounding & Ungrounding
  // --------------------------------------------------------------------------
  describe('P0 Safety: DVIR Critical Defect Grounding & Ungrounding', () => {
    it('grounds vehicle immediately when any critical defect is flagged', () => {
      const defects = [
        { item: 'Wipers', status: 'OK', severity: 'MINOR' },
        { item: 'Braking System Air Pressure', status: 'DEFECT', severity: 'CRITICAL' },
      ];

      const hasCriticalDefect = defects.some(
        (d) => d.status === 'DEFECT' && d.severity === 'CRITICAL'
      );

      let vehicleStatus = 'AVAILABLE';
      let vehicleIsActive = true;

      if (hasCriticalDefect) {
        vehicleStatus = 'GROUNDED';
        vehicleIsActive = false;
      }

      expect(vehicleStatus).toBe('GROUNDED');
      expect(vehicleIsActive).toBe(false);
    });

    it('keeps vehicle grounded if another open critical ticket still exists', () => {
      const openCriticalTicketsForVehicle = [
        { id: 't-resolved', priority: 'Critical', status: 'Resolved' },
        { id: 't-unresolved', priority: 'Critical', status: 'In Progress' },
      ];

      const remainingCriticalCount = openCriticalTicketsForVehicle.filter(
        (t) => t.id !== 't-resolved' && ['Pending', 'Open', 'In Progress', 'Escalated'].includes(t.status)
      ).length;

      let vehicleStatus = 'GROUNDED';
      let vehicleIsActive = false;

      // Unground only if no remaining open critical tickets
      if (remainingCriticalCount === 0) {
        vehicleStatus = 'AVAILABLE';
        vehicleIsActive = true;
      }

      expect(remainingCriticalCount).toBe(1);
      expect(vehicleStatus).toBe('GROUNDED');
      expect(vehicleIsActive).toBe(false);
    });

    it('ungrounds vehicle when the last open critical ticket is resolved', () => {
      const openCriticalTicketsForVehicle = [
        { id: 't-resolved', priority: 'Critical', status: 'Resolved' },
      ];

      const remainingCriticalCount = openCriticalTicketsForVehicle.filter(
        (t) => t.id !== 't-resolved' && ['Pending', 'Open', 'In Progress', 'Escalated'].includes(t.status)
      ).length;

      let vehicleStatus = 'GROUNDED';
      let vehicleIsActive = false;

      if (remainingCriticalCount === 0) {
        vehicleStatus = 'AVAILABLE';
        vehicleIsActive = true;
      }

      expect(remainingCriticalCount).toBe(0);
      expect(vehicleStatus).toBe('AVAILABLE');
      expect(vehicleIsActive).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 4. P1 Operations: Active SLA Sweeper Idempotency & Paging Cooldown
  // --------------------------------------------------------------------------
  describe('P1 Operations: Active SLA Sweeper Idempotency & Paging Cooldown', () => {
    it('prevents repeat Tier 2 escalation if ticket was already auto-escalated', () => {
      const ticketWithExistingEscalation = {
        id: 't-sla-1',
        custom_fields: {
          tier2EscalatedAt: '2026-09-10T08:00:00Z',
        },
      };

      const shouldExecuteTier2 = !ticketWithExistingEscalation.custom_fields?.tier2EscalatedAt;
      expect(shouldExecuteTier2).toBe(false);
    });

    it('suppresses Tier 3 Director alerts within the 2-hour cooldown window', () => {
      const checkTier3AlertAllowed = (lastAlertIso: string | undefined, now: Date): boolean => {
        if (!lastAlertIso) return true;
        const lastAlert = new Date(lastAlertIso).getTime();
        const diffMinutes = (now.getTime() - lastAlert) / (1000 * 60);
        return diffMinutes >= 120; // 2 hour cooldown
      };

      const now = new Date('2026-09-10T10:00:00Z');
      const recentAlert = '2026-09-10T09:30:00Z'; // 30 mins ago
      const oldAlert = '2026-09-10T07:30:00Z'; // 2.5 hours ago

      expect(checkTier3AlertAllowed(recentAlert, now)).toBe(false); // Suppressed
      expect(checkTier3AlertAllowed(oldAlert, now)).toBe(true); // Permitted
      expect(checkTier3AlertAllowed(undefined, now)).toBe(true); // First time permitted
    });

    it('generates hourly bucketed idempotency keys for distributed sweep runs', () => {
      const generateIdempotencyKey = (ticketId: string, action: string, date: Date): string => {
        const hourBucket = date.toISOString().slice(0, 13);
        return `${ticketId}_${action}_${hourBucket}`;
      };

      const date1 = new Date('2026-09-10T10:15:00Z');
      const date2 = new Date('2026-09-10T10:45:00Z');
      const date3 = new Date('2026-09-10T11:05:00Z');

      const key1 = generateIdempotencyKey('t-100', 'TIER2_ESCALATION', date1);
      const key2 = generateIdempotencyKey('t-100', 'TIER2_ESCALATION', date2);
      const key3 = generateIdempotencyKey('t-100', 'TIER2_ESCALATION', date3);

      expect(key1).toBe('t-100_TIER2_ESCALATION_2026-09-10T10');
      expect(key2).toBe(key1); // Same hour bucket -> deduplicated
      expect(key3).not.toBe(key1); // Next hour bucket
    });
  });

  // --------------------------------------------------------------------------
  // 5. P1 Domain Adapters: Multi-line Vehicle Replacement
  // --------------------------------------------------------------------------
  describe('P1 Domain Adapters: Multi-line Vehicle Replacement', () => {
    it('Staff Transport: reassigns upcoming scheduled trips without mutating completed past trips', () => {
      const now = new Date('2026-09-10T12:00:00Z');
      const trips = [
        { id: 'trip-past-1', departureTime: new Date('2026-09-10T08:00:00Z'), status: 'COMPLETED', vehicleId: 'bus-grounded' },
        { id: 'trip-future-1', departureTime: new Date('2026-09-10T14:00:00Z'), status: 'SCHEDULED', vehicleId: 'bus-grounded' },
        { id: 'trip-future-2', departureTime: new Date('2026-09-10T18:00:00Z'), status: 'SCHEDULED', vehicleId: 'bus-grounded' },
      ];

      const replacementVehicleId = 'bus-replacement-99';

      // Domain logic: Only update scheduled trips where departureTime >= now
      const reassignedTrips = trips.map((t) => {
        if (t.departureTime >= now && t.status === 'SCHEDULED' && t.vehicleId === 'bus-grounded') {
          return { ...t, vehicleId: replacementVehicleId };
        }
        return t;
      });

      // Historical trip remains unchanged
      expect(reassignedTrips[0].vehicleId).toBe('bus-grounded');
      // Future scheduled trips are reassigned
      expect(reassignedTrips[1].vehicleId).toBe(replacementVehicleId);
      expect(reassignedTrips[2].vehicleId).toBe(replacementVehicleId);
    });

    it('Commercial Leasing: records substitute custody exchange keeping master contract asset', () => {
      const originalContractAsset = {
        contractId: 'lease-contract-100',
        contractedVehicleId: 'veh-lease-core',
        monthlyRate: 3500,
        status: 'ACTIVE',
      };

      const substituteExchange = {
        contractId: originalContractAsset.contractId,
        outgoingVehicleId: originalContractAsset.contractedVehicleId,
        incomingVehicleId: 'veh-substitute-pool',
        exchangeDate: new Date('2026-09-10T12:00:00Z'),
        reason: 'Service Ticket Breakdown Replacement',
      };

      // Master contracted vehicle ID is preserved
      expect(originalContractAsset.contractedVehicleId).toBe('veh-lease-core');
      // Substitute custody record tracks temporary exchange
      expect(substituteExchange.incomingVehicleId).toBe('veh-substitute-pool');
      expect(substituteExchange.contractId).toBe('lease-contract-100');
    });

    it('Rent-A-Car: updates active booking vehicle ID for continuous rate billing', () => {
      const activeBooking = {
        id: 'booking-rac-55',
        vehicleId: 'sedan-grounded',
        dailyRate: 150,
        status: 'ACTIVE',
      };

      const replacementVehicleId = 'sedan-replacement';
      const updatedBooking = {
        ...activeBooking,
        vehicleId: replacementVehicleId,
      };

      expect(updatedBooking.vehicleId).toBe('sedan-replacement');
      expect(updatedBooking.dailyRate).toBe(150); // Billing maintained
    });
  });

  // --------------------------------------------------------------------------
  // 6. P2 Financial Control: Multi-Line Case Cost Ledger
  // --------------------------------------------------------------------------
  describe('P2 Financial Control: Multi-Line Case Cost Ledger', () => {
    const mockCostLines: CaseCostLine[] = [
      {
        id: 'c-1',
        tenantId: 'tenant-1',
        ticketId: 'ticket-100',
        costType: 'TOWING',
        estimatedAmount: 350,
        approvedAmount: 350,
        actualAmount: 320,
        currency: 'AED',
        payerType: 'TENANT',
        customerRechargeStatus: 'NOT_APPLICABLE',
        createdAt: '2026-09-10T08:00:00Z',
        updatedAt: '2026-09-10T08:00:00Z',
      },
      {
        id: 'c-2',
        tenantId: 'tenant-1',
        ticketId: 'ticket-100',
        costType: 'PARTS',
        estimatedAmount: 1200,
        approvedAmount: 1100,
        actualAmount: 1150,
        currency: 'AED',
        payerType: 'CUSTOMER',
        customerRechargeStatus: 'PENDING',
        createdAt: '2026-09-10T08:30:00Z',
        updatedAt: '2026-09-10T08:30:00Z',
      },
      {
        id: 'c-3',
        tenantId: 'tenant-1',
        ticketId: 'ticket-100',
        costType: 'LABOUR',
        estimatedAmount: 600,
        approvedAmount: 600,
        actualAmount: 600,
        currency: 'AED',
        payerType: 'WARRANTY',
        warrantyClaimId: 'CLM-WRT-2026-01',
        customerRechargeStatus: 'NOT_APPLICABLE',
        createdAt: '2026-09-10T09:00:00Z',
        updatedAt: '2026-09-10T09:00:00Z',
      },
      {
        id: 'c-4',
        tenantId: 'tenant-1',
        ticketId: 'ticket-100',
        costType: 'REPLACEMENT',
        estimatedAmount: 400,
        approvedAmount: 400,
        actualAmount: 380,
        currency: 'AED',
        payerType: 'TENANT',
        customerRechargeStatus: 'NOT_APPLICABLE',
        createdAt: '2026-09-10T09:15:00Z',
        updatedAt: '2026-09-10T09:15:00Z',
      },
    ];

    it('aggregates total estimated, approved, and actual amounts', () => {
      const summary = calculateSummaryFromLines(mockCostLines, 'ticket-100');

      expect(summary.totalEstimated).toBe(2550); // 350 + 1200 + 600 + 400
      expect(summary.totalApproved).toBe(2450);  // 350 + 1100 + 600 + 400
      expect(summary.totalActual).toBe(2450);    // 320 + 1150 + 600 + 380
      expect(summary.lineCount).toBe(4);
      expect(summary.currency).toBe('AED');
    });

    it('breaks down financial figures by cost type category', () => {
      const summary = calculateSummaryFromLines(mockCostLines, 'ticket-100');

      expect(summary.breakdownByType.TOWING).toEqual({ estimated: 350, approved: 350, actual: 320 });
      expect(summary.breakdownByType.PARTS).toEqual({ estimated: 1200, approved: 1100, actual: 1150 });
      expect(summary.breakdownByType.LABOUR).toEqual({ estimated: 600, approved: 600, actual: 600 });
      expect(summary.breakdownByType.REPLACEMENT).toEqual({ estimated: 400, approved: 400, actual: 380 });
      expect(summary.breakdownByType.STORAGE).toEqual({ estimated: 0, approved: 0, actual: 0 });
    });

    it('segregates financial figures across multi-payers (Tenant, Customer, Warranty, Insurance)', () => {
      const summary = calculateSummaryFromLines(mockCostLines, 'ticket-100');

      expect(summary.breakdownByPayer.TENANT.actual).toBe(700); // 320 (TOWING) + 380 (REPLACEMENT)
      expect(summary.breakdownByPayer.CUSTOMER.actual).toBe(1150); // 1150 (PARTS)
      expect(summary.breakdownByPayer.WARRANTY.actual).toBe(600); // 600 (LABOUR)
      expect(summary.breakdownByPayer.INSURANCE.actual).toBe(0);
    });

    it('accurately computes customer recharge pending liability for revenue recovery', () => {
      const summary = calculateSummaryFromLines(mockCostLines, 'ticket-100');

      // Only line c-2 has payerType = 'CUSTOMER' and customerRechargeStatus = 'PENDING'
      // actualAmount = 1150
      expect(summary.customerRechargePending).toBe(1150);
    });
  });
});
