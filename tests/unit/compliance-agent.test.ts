import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateFleetComplianceRisk,
} from '@/lib/agents/compliance/fleet-risk';
import {
  evaluateDriverReadiness,
} from '@/lib/agents/compliance/driver-readiness';
import {
  validateFtaInvoice,
} from '@/lib/agents/compliance/fta-tax';
import {
  complianceAgent,
} from '@/lib/agents/compliance/agent';
import { benchmarkRunner } from '@/lib/agents/eval/benchmark-runner';
import { COMPLIANCE_GROUND_TRUTH_DATASETS } from '@/lib/agents/eval/datasets';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn().mockImplementation((prisma, tenantId, fn) => fn(prisma)),
}));

vi.mock('@/lib/agents/schema', () => ({
  ensureAgentSchema: vi.fn().mockResolvedValue(undefined),
}));

describe('Compliance Agent Suite (Fleet, Driver Readiness, Fatigue & FTA Tax)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Fleet Compliance Risk & Health Engine', () => {
    it('evaluates fleet documents and calculates accurate compliance score and horizon breakdown', () => {
      const now = new Date('2026-09-06T12:00:00Z');
      const docs = [
        {
          id: 'doc-1',
          entityId: 'v-101',
          entityType: 'VEHICLE' as const,
          entityCode: 'BUS-14',
          documentType: 'MULKIYA_REGISTRATION',
          expiryDate: '2026-09-04T00:00:00Z', // Expired 2 days ago -> CRITICAL
        },
        {
          id: 'doc-2',
          entityId: 'v-102',
          entityType: 'VEHICLE' as const,
          entityCode: 'VAN-22',
          documentType: 'TECHNICAL_INSPECTION_FAHAS',
          expiryDate: '2026-09-10T00:00:00Z', // In 4 days -> URGENT
        },
        {
          id: 'doc-3',
          entityId: 'v-103',
          entityType: 'VEHICLE' as const,
          entityCode: 'COACH-50',
          documentType: 'MOTOR_INSURANCE',
          expiryDate: '2026-09-25T00:00:00Z', // In 19 days -> UPCOMING
        },
        {
          id: 'doc-4',
          entityId: 'v-104',
          entityType: 'VEHICLE' as const,
          entityCode: 'BUS-30',
          documentType: 'MULKIYA_REGISTRATION',
          expiryDate: '2027-03-01T00:00:00Z', // In 6 months -> COMPLIANT
        },
      ];

      const riskView = evaluateFleetComplianceRisk(docs, now);

      expect(riskView.criticalCount).toBe(1);
      expect(riskView.urgentCount).toBe(1);
      expect(riskView.upcomingCount).toBe(1);
      expect(riskView.dueIn30DaysCount).toBe(3);
      expect(riskView.fleetComplianceScore).toBeLessThan(100);
      expect(riskView.criticalItems[0].code).toBe('BUS-14');
      expect(riskView.criticalItems[0].status).toBe('EXPIRED');
      expect(riskView.recommendedActions.length).toBeGreaterThanOrEqual(2);
      expect(riskView.recommendedActions.some((a) => a.actionType === 'GROUND_VEHICLE')).toBe(true);
      expect(riskView.recommendedActions.some((a) => a.actionType === 'BOOK_INSPECTION')).toBe(true);
    });
  });

  describe('Driver Compliance & Readiness Gatekeeper', () => {
    it('permits assignment when driver credentials, HOS, and category authorization are valid', () => {
      const result = evaluateDriverReadiness({
        driverId: 'drv-201',
        driverName: 'Ahmed Tariq',
        vehicleCategoryRequired: 'COACH_50',
        licenseExpiry: '2027-11-01T00:00:00Z',
        emiratesIdExpiry: '2027-08-01T00:00:00Z',
        rtaCardExpiry: '2027-05-01T00:00:00Z',
        licenseClasses: ['HEAVY_BUS'],
        authorizedCategories: ['COACH_50', 'COASTER_30'],
        dailyDutyMinutesUsed: 260, // 4h 20m used -> 5h 40m remaining
        continuousDrivingMinutesUsed: 135, // 2h 15m
        blackPoints: 4,
        rosterStatus: 'ON_DUTY',
        estimatedDurationMin: 60,
      });

      expect(result.isEligible).toBe(true);
      expect(result.status).toBe('ELIGIBLE');
      expect(result.readinessScore).toBe(100);
      expect(result.shiftRemainingFormatted).toBe('5h 40m');
      expect(result.restCompliance).toBe('PASS');
      expect(result.disqualificationReasons.length).toBe(0);
    });

    it('blocks assignment when UAE Driving License or Emirates ID is expired', () => {
      const result = evaluateDriverReadiness({
        driverId: 'drv-202',
        driverName: 'Saeed Al Zaabi',
        vehicleCategoryRequired: 'SEDAN',
        licenseExpiry: '2026-08-01T00:00:00Z', // Expired
        emiratesIdExpiry: '2027-08-01T00:00:00Z',
        rosterStatus: 'ON_DUTY',
      });

      expect(result.isEligible).toBe(false);
      expect(result.status).toBe('BLOCKED');
      expect(result.credentialsValid).toBe(false);
      expect(result.disqualificationReasons.some((r) => r.includes('License expired'))).toBe(true);
    });

    it('blocks assignment when driver lacks Heavy Bus license authorization for bus jobs', () => {
      const result = evaluateDriverReadiness({
        driverId: 'drv-203',
        driverName: 'John Doe',
        vehicleCategoryRequired: 'COACH_50',
        licenseExpiry: '2027-08-01T00:00:00Z',
        licenseClasses: ['LIGHT'], // Only light vehicle license!
        rosterStatus: 'ON_DUTY',
      });

      expect(result.isEligible).toBe(false);
      expect(result.vehicleCategoryAuthorized).toBe(false);
      expect(result.disqualificationReasons.some((r) => r.includes('Heavy Bus license required'))).toBe(true);
    });
  });

  describe('Driver Fatigue & Regulatory Guardrails (UAE MoHRE / RTA)', () => {
    it('blocks assignment when continuous driving reaches 4.5h without 45m mandatory rest', () => {
      const result = evaluateDriverReadiness({
        driverId: 'drv-204',
        driverName: 'Fatigued Driver',
        licenseExpiry: '2027-08-01T00:00:00Z',
        dailyDutyMinutesUsed: 300,
        continuousDrivingMinutesUsed: 275, // 4h 35m continuous! (Limit is 270m / 4.5h)
        rosterStatus: 'ON_DUTY',
        estimatedDurationMin: 30,
      });

      expect(result.isEligible).toBe(false);
      expect(result.restCompliance).toBe('VIOLATION');
      expect(result.disqualificationReasons.some((r) => r.includes('Continuous Driving Violation'))).toBe(true);
    });

    it('blocks assignment when projected trip duration exceeds MoHRE 10h daily duty limit', () => {
      const result = evaluateDriverReadiness({
        driverId: 'drv-205',
        driverName: 'Overworked Driver',
        licenseExpiry: '2027-08-01T00:00:00Z',
        dailyDutyMinutesUsed: 560, // 9h 20m used
        estimatedDurationMin: 60, // + 1h = 10h 20m > 600m max
        rosterStatus: 'ON_DUTY',
      });

      expect(result.isEligible).toBe(false);
      expect(result.disqualificationReasons.some((r) => r.includes('Daily Duty Limit Exceeded'))).toBe(true);
    });

    it('flags high black points warning when points are >= 18 and suspends at 24', () => {
      const warningRes = evaluateDriverReadiness({
        driverId: 'drv-206',
        driverName: 'Warning Driver',
        licenseExpiry: '2027-08-01T00:00:00Z',
        blackPoints: 18,
        rosterStatus: 'ON_DUTY',
      });

      expect(warningRes.isEligible).toBe(true);
      expect(warningRes.status).toBe('WARNING');
      expect(warningRes.blackPointsRisk).toBe('WARNING_THRESHOLD');
      expect(warningRes.warnings.some((w) => w.includes('High Black Points Warning'))).toBe(true);

      const suspendRes = evaluateDriverReadiness({
        driverId: 'drv-207',
        driverName: 'Suspended Driver',
        licenseExpiry: '2027-08-01T00:00:00Z',
        blackPoints: 24,
        rosterStatus: 'ON_DUTY',
      });

      expect(suspendRes.isEligible).toBe(false);
      expect(suspendRes.status).toBe('BLOCKED');
      expect(suspendRes.blackPointsRisk).toBe('CRITICAL_SUSPENSION');
    });
  });

  describe('Finance, Salik & FTA Tax Compliance Validator', () => {
    it('validates compliant 15-digit FTA TRN and accurate 5% VAT mathematical calculation', () => {
      const audit = validateFtaInvoice({
        invoiceId: 'inv-101',
        invoiceNumber: 'INV-2026-001',
        vendorName: 'Al Futtaim Auto LLC',
        vendorTrn: '100234567800003',
        invoiceDate: '2026-09-01T00:00:00Z',
        subtotal: 1000.0,
        vatAmount: 50.0,
        totalAmount: 1050.0,
      });

      expect(audit.isValid).toBe(true);
      expect(audit.trnValid).toBe(true);
      expect(audit.vatMathCorrect).toBe(true);
      expect(audit.vatDiscrepancyAed).toBe(0);
      expect(audit.financialRiskAed).toBe(0);
    });

    it('flags non-compliant invoice with invalid TRN and mismatched VAT amount', () => {
      const audit = validateFtaInvoice({
        invoiceId: 'inv-102',
        invoiceNumber: 'INV-2026-002',
        vendorName: 'Suspicious Garage',
        vendorTrn: '888999123', // Invalid: doesn't start with 100, not 15 digits
        invoiceDate: '2026-09-01T00:00:00Z',
        subtotal: 2000.0,
        vatAmount: 250.0, // Expected 100 AED, billed 250 AED
        totalAmount: 2250.0,
      });

      expect(audit.isValid).toBe(false);
      expect(audit.trnValid).toBe(false);
      expect(audit.vatMathCorrect).toBe(false);
      expect(audit.vatDiscrepancyAed).toBe(150.0);
      expect(audit.financialRiskAed).toBeGreaterThan(0);
    });

    it('flags unmapped Salik toll tag without linked vehicle plate', () => {
      const audit = validateFtaInvoice({
        invoiceId: 'inv-103',
        invoiceNumber: 'INV-2026-003',
        vendorName: 'Salik Operations',
        vendorTrn: '100987654300003',
        invoiceDate: '2026-09-01T00:00:00Z',
        subtotal: 100.0,
        vatAmount: 5.0,
        totalAmount: 105.0,
        salikTagNumber: 'TAG-UNMAPPED-99', // Missing vehicle plate!
      });

      expect(audit.isValid).toBe(false);
      expect(audit.salikTagMatched).toBe(false);
      expect(audit.complianceFlags.some((f) => f.includes('Unlinked Toll Transaction'))).toBe(true);
    });
  });

  describe('ComplianceAgent Ingestion & Policy Integration', () => {
    it('runs compliance agent scan and emits policy action proposals', async () => {
      const result = await complianceAgent.run({
        agent_id: 'compliance',
        tenant_id: 'tenant-uae-ops',
        event_type: 'compliance.sweep_scheduled',
        payload: {
          documents: COMPLIANCE_GROUND_TRUTH_DATASETS.fleetDocuments,
          driverReadinessRequest: COMPLIANCE_GROUND_TRUTH_DATASETS.driverReady,
          invoiceValidationRequest: COMPLIANCE_GROUND_TRUTH_DATASETS.ftaInvoiceValid,
        },
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.agentId).toBe('compliance');
      expect(result.actionsCreated).toBeGreaterThan(0);
      expect(result.telemetry?.modelProvider).toBe('local_solver');
      expect(result.telemetry?.estimatedSavingsAed).toBeGreaterThan(0);
    });
  });

  describe('Compliance AI Quality Benchmark Evaluation', () => {
    it('passes ground-truth benchmark suite with >= 95% decision quality score and 0% FPR', async () => {
      const benchmarkResult = await benchmarkRunner.runComplianceBenchmark();

      expect(benchmarkResult.passed).toBe(true);
      expect(benchmarkResult.agentId).toBe('compliance');
      expect(benchmarkResult.metrics.precision).toBe(1.0);
      expect(benchmarkResult.metrics.recall).toBe(1.0);
      expect(benchmarkResult.metrics.falsePositiveRate).toBe(0.0);
      expect(benchmarkResult.metrics.decisionQualityScore).toBeGreaterThanOrEqual(0.95);
      expect(benchmarkResult.financialExposureDetectedAed).toBeGreaterThan(0);
    });
  });
});
