/**
 * tests/unit/fleet-expiry-grounding.test.ts
 *
 * Unit tests for Automated Expiry Sweep & Vehicle Auto-Grounding Engine.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateDocumentCompliance,
  evaluateVehicleCompliance,
} from '@/lib/fleet/expiry-grounding-engine';

describe('Fleet Expiry Sweep & Auto-Grounding Engine', () => {
  const referenceDate = new Date('2026-09-01T12:00:00Z');

  describe('evaluateDocumentCompliance', () => {
    it('marks a document with >30 days remaining as COMPLIANT', () => {
      const doc = {
        id: 'doc-001',
        docType: 'MULKIYA',
        docNumber: 'M-12345',
        expiryDate: new Date('2026-11-01T12:00:00Z'), // ~61 days
      };

      const result = evaluateDocumentCompliance(doc, referenceDate);

      expect(result.status).toBe('COMPLIANT');
      expect(result.daysRemaining).toBe(61);
      expect(result.groundingRequired).toBe(false);
    });

    it('marks a document with 15 days remaining as EXPIRING_WARNING', () => {
      const doc = {
        id: 'doc-002',
        docType: 'PERMIT',
        docNumber: 'P-9988',
        expiryDate: new Date('2026-09-16T12:00:00Z'), // 15 days
      };

      const result = evaluateDocumentCompliance(doc, referenceDate);

      expect(result.status).toBe('EXPIRING_WARNING');
      expect(result.daysRemaining).toBe(15);
      expect(result.groundingRequired).toBe(false);
    });

    it('marks a document with 4 days remaining as EXPIRING_CRITICAL', () => {
      const doc = {
        id: 'doc-003',
        docType: 'TESTING',
        docNumber: 'TST-55',
        expiryDate: new Date('2026-09-05T12:00:00Z'), // 4 days
      };

      const result = evaluateDocumentCompliance(doc, referenceDate);

      expect(result.status).toBe('EXPIRING_CRITICAL');
      expect(result.daysRemaining).toBe(4);
    });

    it('enforces 0-day grace period on INSURANCE and mandates immediate grounding upon expiry', () => {
      const expiredInsurance = {
        id: 'doc-004',
        docType: 'INSURANCE',
        docNumber: 'INS-7711',
        expiryDate: new Date('2026-08-31T12:00:00Z'), // 1 day expired
      };

      const result = evaluateDocumentCompliance(expiredInsurance, referenceDate);

      expect(result.status).toBe('EXPIRED');
      expect(result.daysRemaining).toBe(-1);
      expect(result.gracePeriodDays).toBe(0);
      expect(result.isPastGracePeriod).toBe(true);
      expect(result.groundingRequired).toBe(true);
      expect(result.reason).toContain('INSURANCE expired 1 days ago');
    });

    it('honors 30-day UAE grace period for MULKIYA without triggering immediate grounding within grace', () => {
      const expiredMulkiyaWithinGrace = {
        id: 'doc-005',
        docType: 'MULKIYA',
        docNumber: 'MULK-8822',
        expiryDate: new Date('2026-08-20T12:00:00Z'), // 12 days expired (< 30 days)
      };

      const result = evaluateDocumentCompliance(expiredMulkiyaWithinGrace, referenceDate, 30);

      expect(result.status).toBe('EXPIRED');
      expect(result.isPastGracePeriod).toBe(false);
      expect(result.groundingRequired).toBe(false);
      expect(result.reason).toContain('within 30-day legal renewal grace period');
    });

    it('mandates grounding for MULKIYA exceeding the 30-day grace period', () => {
      const expiredMulkiyaPastGrace = {
        id: 'doc-006',
        docType: 'MULKIYA',
        docNumber: 'MULK-8822',
        expiryDate: new Date('2026-07-25T12:00:00Z'), // 38 days expired (> 30 days)
      };

      const result = evaluateDocumentCompliance(expiredMulkiyaPastGrace, referenceDate, 30);

      expect(result.status).toBe('EXPIRED');
      expect(result.isPastGracePeriod).toBe(true);
      expect(result.groundingRequired).toBe(true);
      expect(result.reason).toContain('exceeded 30-day grace period');
    });
  });

  describe('evaluateVehicleCompliance', () => {
    const sampleVehicle = {
      id: 'veh-100',
      vehicleCode: 'BUS-01',
      licensePlate: 'DXB-1010',
      make: 'Mercedes-Benz',
      model: 'Sprinter',
      status: 'AVAILABLE',
      isActive: true,
    };

    it('returns COMPLIANT and NO_ACTION when all mandatory documents are active', () => {
      const docs = [
        { id: 'd1', docType: 'INSURANCE', expiryDate: new Date('2026-12-01T12:00:00Z') },
        { id: 'd2', docType: 'MULKIYA', expiryDate: new Date('2026-12-01T12:00:00Z') },
      ];

      const evalResult = evaluateVehicleCompliance(sampleVehicle, docs, referenceDate);

      expect(evalResult.complianceHealth).toBe('COMPLIANT');
      expect(evalResult.actionTaken).toBe('NO_ACTION');
    });

    it('auto-grounds an AVAILABLE vehicle when insurance is expired', () => {
      const docs = [
        { id: 'd1', docType: 'INSURANCE', expiryDate: new Date('2026-08-30T12:00:00Z') }, // Expired 2d ago
        { id: 'd2', docType: 'MULKIYA', expiryDate: new Date('2026-12-01T12:00:00Z') },
      ];

      const evalResult = evaluateVehicleCompliance(sampleVehicle, docs, referenceDate);

      expect(evalResult.complianceHealth).toBe('NON_COMPLIANT');
      expect(evalResult.actionTaken).toBe('GROUNDED');
      expect(evalResult.actionReason).toContain('auto-grounded due to expired mandatory document');
    });

    it('automatically ungrounds a GROUNDED vehicle once renewed documents are verified', () => {
      const groundedVehicle = {
        ...sampleVehicle,
        status: 'GROUNDED',
        isActive: false,
      };

      const renewedDocs = [
        { id: 'd1', docType: 'INSURANCE', expiryDate: new Date('2027-08-30T12:00:00Z') },
        { id: 'd2', docType: 'MULKIYA', expiryDate: new Date('2027-08-30T12:00:00Z') },
      ];

      const evalResult = evaluateVehicleCompliance(groundedVehicle, renewedDocs, referenceDate);

      expect(evalResult.complianceHealth).toBe('COMPLIANT');
      expect(evalResult.actionTaken).toBe('UNGROUNDED');
      expect(evalResult.actionReason).toContain('restored to AVAILABLE');
    });
  });
});
