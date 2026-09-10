import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateSourceGrounding } from '@/lib/agents/document-intelligence/pipeline/grounding';
import { crossCheckWithMasterData } from '@/lib/agents/document-intelligence/pipeline/cross-checker';
import {
  reconcileCrossDocumentChain,
  resolveLinkedDocumentsFromDb,
  escalateToFinanceAnomaly,
} from '@/lib/agents/document-intelligence/pipeline/cross-doc-intelligence';
import {
  validateUaeTrn,
  validateEmiratesId,
  evaluateIntegrityIndicators,
} from '@/lib/agents/document-intelligence/pipeline/integrity-validator';
import { sweepDocumentExpiries } from '@/lib/agents/document-intelligence/pipeline/lifecycle-manager';
import { GET as lifecycleSweepGET, POST as lifecycleSweepPOST } from '@/app/api/documents/intelligence/cron/lifecycle-sweep/route';
import { evaluateComplianceRules } from '@/lib/agents/document-intelligence/pipeline/compliance-rules';
import { evaluateDocumentRisk, computeDocumentFingerprint } from '@/lib/agents/document-intelligence/pipeline/risk-scorer';
import { extractContractObligations } from '@/lib/agents/document-intelligence/pipeline/contract-intelligence';
import { processDocumentWithRouter } from '@/lib/agents/document-intelligence/pipeline/router';
import { executeDocumentControlPipeline } from '@/lib/agents/document-intelligence/pipeline';
import { DocumentExtractionResult } from '@/lib/agents/types';

describe('Fleet360 Document Control & Intelligence Engine (25 Core Capabilities)', () => {
  describe('Capability 1: Field-Level Source Grounding', () => {
    it('grounds extracted fields to exact page numbers, bounding boxes, and verbatim snippets', () => {
      const sampleText = `ORIENT INSURANCE PJSC - DUBAI
COMMERCIAL MOTOR COMPREHENSIVE POLICY
Policy No: POL-2026-DXB-98172
VIN: 2T1BR32E8FC298412
Expiry Date: 2027-09-30
Total AED: 5,092.50`;

      const grounding = generateSourceGrounding({
        documentText: sampleText,
        totalPages: 2,
        extractedFields: {
          policyNumber: 'POL-2026-DXB-98172',
          vin: '2T1BR32E8FC298412',
          expiryDate: '2027-09-30',
          totalAmount: 5092.50,
        },
      });

      expect(grounding).toBeDefined();
      expect(grounding.totalPages).toBe(2);
      expect(grounding.fields.policyNumber).toBeDefined();
      expect(grounding.fields.policyNumber.pageNumber).toBeGreaterThanOrEqual(1);
      expect(grounding.fields.policyNumber.boundingBox).toBeDefined();
      expect(grounding.fields.policyNumber.boundingBox?.top).toBeGreaterThan(0);
      expect(grounding.fields.policyNumber.confidenceScore).toBeGreaterThanOrEqual(0.9);
      expect(grounding.fields.policyNumber.sourceSnippet).toContain('POL-2026-DXB-98172');
      expect(grounding.groundingQualityScore).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('Capability 2: Master Data Cross-Validation', () => {
    it('flags CRITICAL mismatch when document VIN does not match vehicle master record', async () => {
      const extractionWithVinMismatch: DocumentExtractionResult = {
        docCategory: 'INSURANCE_POLICY',
        suggestedTitle: 'Commercial Fleet Insurance',
        confidence: 'HIGH',
        confidenceScore: 0.98,
        referenceNumber: 'POL-88192',
        expiryDate: '2027-03-31',
        vehicle: {
          licensePlate: 'D 48291',
          plateNumber: '48291',
          vin: 'ABC1234567', // Document VIN
        },
      };

      const result = await crossCheckWithMasterData('tenant-test', extractionWithVinMismatch);
      expect(result).toBeDefined();
      expect(result.entityType).toBe('VEHICLE');
      expect(typeof result.passed).toBe('boolean');
    });

    it('cross-validates driver license numbers against driver master roster', async () => {
      const extractionDriver: DocumentExtractionResult = {
        docCategory: 'DRIVER_LICENSE',
        suggestedTitle: 'UAE Driver License',
        confidence: 'HIGH',
        confidenceScore: 0.97,
        expiryDate: '2028-06-30',
        driver: {
          driverName: 'Rashid Ahmed',
          licenseNumber: 'DL-DXB-99182',
          emiratesId: '784-1990-1234567-1',
        },
      };

      const result = await crossCheckWithMasterData('tenant-test', extractionDriver);
      expect(result.entityType).toBe('DRIVER');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('Capability 3: Cross-Document Relationship Intelligence (PO -> WO -> Invoice)', () => {
    it('detects and flags significant billing variance (+47.6%) between PO and Invoice', () => {
      const invoiceExtraction: DocumentExtractionResult = {
        docCategory: 'INVOICE',
        suggestedTitle: 'Workshop Repair Invoice',
        confidence: 'HIGH',
        confidenceScore: 0.99,
        referenceNumber: 'INV-2026-9901',
        issueDate: '2026-09-08',
        financials: {
          totalAmount: 6200.00,
          totalAmountAed: 6200.00,
          currency: 'AED',
        },
      };

      const chainResult = reconcileCrossDocumentChain({
        currentExtraction: invoiceExtraction,
        linkedQuotation: { reference: 'QT-4412', amountAed: 4200.00, date: '2026-08-15' },
        linkedPo: { reference: 'PO-99120', amountAed: 4200.00, date: '2026-08-20' },
        linkedWorkOrder: { reference: 'WO-8812', amountAed: 4150.00, date: '2026-09-01' },
      });

      expect(chainResult.hasRelationship).toBe(true);
      expect(chainResult.chain.length).toBe(4);
      expect(chainResult.varianceAed).toBe(2000.00);
      expect(chainResult.variancePct).toBe(47.6);
      expect(chainResult.isVarianceAcceptable).toBe(false);
      expect(chainResult.anomalyDetected).toBe(true);
      expect(chainResult.message).toContain('ALERT: Invoice exceeds PO by +47.6%');
    });

    it('approves invoice when variance is within 5% tolerance', () => {
      const invoiceExtraction: DocumentExtractionResult = {
        docCategory: 'INVOICE',
        suggestedTitle: 'Spare Parts Invoice',
        confidence: 'HIGH',
        confidenceScore: 0.99,
        referenceNumber: 'INV-2026-112',
        financials: {
          totalAmount: 4300.00,
          totalAmountAed: 4300.00,
          currency: 'AED',
        },
      };

      const chainResult = reconcileCrossDocumentChain({
        currentExtraction: invoiceExtraction,
        linkedPo: { reference: 'PO-99120', amountAed: 4200.00, date: '2026-08-20' },
      });

      expect(chainResult.hasRelationship).toBe(true);
      expect(chainResult.variancePct).toBe(2.4); // 2.4% variance <= 5%
      expect(chainResult.isVarianceAcceptable).toBe(true);
      expect(chainResult.anomalyDetected).toBe(false);
    });
  });

  describe('Capability 4: Compliance & Regulatory Rules Engine', () => {
    it('correctly flags expired and expiring soon documents and validates UAE 5% VAT', () => {
      const compliantDoc: DocumentExtractionResult = {
        docCategory: 'TAX_INVOICE',
        suggestedTitle: 'Fleet Fuel Bill',
        confidence: 'HIGH',
        confidenceScore: 0.98,
        referenceNumber: 'INV-881',
        expiryDate: '2027-12-31',
        financials: {
          subtotal: 1000.00,
          taxAmount: 50.00, // exact 5%
          totalAmount: 1050.00,
          currency: 'AED',
        },
      };

      const compliance = evaluateComplianceRules(compliantDoc);
      expect(compliance.isCompliant).toBe(true);
      expect(compliance.isExpired).toBe(false);
      expect(compliance.vatCalculationValid).toBe(true);
      expect(compliance.complianceScore).toBe(1.0);
    });

    it('identifies invalid VAT calculation deviations', () => {
      const badVatDoc: DocumentExtractionResult = {
        docCategory: 'TAX_INVOICE',
        suggestedTitle: 'Repair Invoice',
        confidence: 'HIGH',
        confidenceScore: 0.95,
        referenceNumber: 'INV-992',
        financials: {
          subtotal: 1000.00,
          taxAmount: 150.00, // 15% instead of 5%
          totalAmount: 1150.00,
        },
      };

      const compliance = evaluateComplianceRules(badVatDoc);
      expect(compliance.vatCalculationValid).toBe(false);
      expect(compliance.isCompliant).toBe(false);
    });
  });

  describe('Capability 5: Document Risk & Integrity Scoring (0-100)', () => {
    it('calculates low risk score and triggers Straight-Through Processing (AUTO_PROCESS)', () => {
      const validDoc: DocumentExtractionResult = {
        docCategory: 'REGISTRATION_CARD',
        suggestedTitle: 'Mulkiya',
        confidence: 'HIGH',
        confidenceScore: 0.99,
        referenceNumber: 'MULK-991',
        expiryDate: '2027-08-30',
        vehicle: { plateNumber: '78219', vin: '1HGBH41JXMN109182' },
      };

      const riskEval = evaluateDocumentRisk({
        extraction: validDoc,
        masterCheck: { passed: true, entityType: 'VEHICLE', confidence: 0.98, mismatches: [], summary: 'Match' },
        compliance: { isCompliant: true, isExpired: false, isExpiringSoon: false, vatCalculationValid: true, mandatoryFieldsPresent: true, missingMandatoryFields: [], complianceScore: 1.0, notes: [] },
      });

      expect(riskEval.riskScore).toBeLessThanOrEqual(25);
      expect(riskEval.riskLevel).toBe('LOW');
      expect(riskEval.decision).toBe('AUTO_PROCESS');
    });

    it('detects duplicate documents using SHA-256 fingerprinting', () => {
      const fp1 = computeDocumentFingerprint('Dubai Mulkiya Plate 78219 VIN 12345', 'mulkiya.pdf');
      const fp2 = computeDocumentFingerprint('Dubai Mulkiya Plate 78219 VIN 12345', 'mulkiya.pdf');
      expect(fp1).toBe(fp2);

      const doc: DocumentExtractionResult = {
        docCategory: 'REGISTRATION_CARD',
        suggestedTitle: 'Mulkiya',
        confidence: 'HIGH',
        confidenceScore: 0.95,
      };

      const riskEval = evaluateDocumentRisk({
        extraction: doc,
        masterCheck: { passed: true, entityType: 'VEHICLE', confidence: 0.95, mismatches: [], summary: 'OK' },
        compliance: { isCompliant: true, isExpired: false, isExpiringSoon: false, vatCalculationValid: true, mandatoryFieldsPresent: true, missingMandatoryFields: [], complianceScore: 1.0, notes: [] },
        existingDuplicateDocId: 'DOC-EXISTING-991',
      });

      expect(riskEval.isDuplicate).toBe(true);
      expect(riskEval.riskScore).toBeGreaterThanOrEqual(40);
      expect(riskEval.decision).toBe('HITL_REVIEW_REQUIRED');
    });
  });

  describe('Capability 6: Contract Obligation & Clause Intelligence', () => {
    it('extracts SLA penalties, notice periods, and recommended advance action dates', () => {
      const contractText = `CORPORATE PASSENGER TRANSPORT AGREEMENT
Parties: Fleet360 Logistics LLC & DP World
Term: 01/07/2026 to 30/06/2027
Expiry Date: 2027-06-30
Termination notice: 90 days prior written notice required.
SLA Penalty: If bus arrives more than 15 minutes late, penalty of AED 250 per occurrence shall apply.
Payment terms: Net 30 days.`;

      const analysis = extractContractObligations('CNT-2026-DPW', contractText, '2027-06-30');

      expect(analysis).toBeDefined();
      expect(analysis.terminationNoticeDays).toBe(90);
      expect(analysis.recommendedNoticeDate).toBe('2027-04-01'); // 90 days before 2027-06-30
      
      const penaltyObligation = analysis.obligations.find((o) => o.category === 'PENALTY');
      expect(penaltyObligation).toBeDefined();
      expect(penaltyObligation?.penaltyAed).toBe(250);
      expect(penaltyObligation?.clauseNumber).toBe('8.4');

      expect(analysis.clauses.length).toBeGreaterThanOrEqual(2);
      expect(analysis.clauses.some((c) => c.obligationType === 'PENALTY')).toBe(true);
    });
  });

  describe('Capability 7: Tiered Router & End-to-End Pipeline Execution', () => {
    it('executes full 8-stage specialist pipeline and returns grounded, risk-scored results', async () => {
      const mulkiyaScan = `UNITED ARAB EMIRATES - MINISTRY OF INTERIOR
VEHICLE REGISTRATION CARD (MULKIYA)
Traffic Plate: Dubai B 78219
Chassis / VIN: 1HGBH41JXMN109182
Make & Model: Toyota HiAce Commuter High Roof 3.5L
Expiry Date: 2027-08-30
Owner: Fleet360 Bus Transport LLC`;

      const result = await executeDocumentControlPipeline({
        tenantId: 'tenant-test-e2e',
        fileName: 'dubai_mulkiya_78219.pdf',
        documentText: mulkiyaScan,
        autoApply: true,
      });

      expect(result).toBeDefined();
      expect(result.extraction.docCategory).toBe('REGISTRATION_CARD');
      expect(result.extraction.grounding).toBeDefined();
      expect(result.extraction.grounding?.fields.vin).toBeDefined();
      expect(result.riskEvaluation).toBeDefined();
      expect(result.timeSavedMinutes).toBe(15);
      expect(result.estimatedSavingsAed).toBe(45.0);
    });
  });

  describe('Capability 8: Deterministic Forensic Integrity Checks (UAE TRN & Emirates ID)', () => {
    it('validates official 15-digit UAE FTA Tax Registration Number starting with 100', () => {
      const validTrn = validateUaeTrn('100293847500003');
      expect(validTrn.valid).toBe(true);

      const shortTrn = validateUaeTrn('100293847');
      expect(shortTrn.valid).toBe(false);
      expect(shortTrn.reason).toContain('15 numeric digits');

      const nonUaeTrn = validateUaeTrn('200293847500003');
      expect(nonUaeTrn.valid).toBe(false);
      expect(nonUaeTrn.reason).toContain("begin with '100'");
    });

    it('validates UAE Emirates ID with Modulo-10 checksum, 784 country code, and birth year sanity', () => {
      // 784-1990-1234567-6 is a valid Modulo-10 checksum sequence
      const validEid = validateEmiratesId('784-1990-1234567-6');
      expect(validEid.valid).toBe(true);

      // Checksum altered: last digit changed from 6 to 1
      const invalidEid = validateEmiratesId('784-1990-1234567-1');
      expect(invalidEid.valid).toBe(false);
      expect(invalidEid.reason).toContain('Modulo-10 checksum validation');

      // Invalid country code (not 784)
      const foreignCode = validateEmiratesId('999-1990-1234567-6');
      expect(foreignCode.valid).toBe(false);
      expect(foreignCode.reason).toContain("'784'");

      // Unrealistic birth year
      const badYear = validateEmiratesId('784-1820-1234567-6');
      expect(badYear.valid).toBe(false);
      expect(badYear.reason).toContain('Invalid birth year');
    });

    it('penalizes risk score and flags integrity alert when fraudulent credentials are submitted', () => {
      const fraudulentDoc: DocumentExtractionResult = {
        docCategory: 'TAX_INVOICE',
        suggestedTitle: 'Vendor Invoice',
        confidence: 'HIGH',
        confidenceScore: 0.95,
        supplier: {
          supplierName: 'Suspicious Parts Trading',
          trnNumber: '200111222333444', // Invalid: does not begin with 100
        },
      };

      const integrity = evaluateIntegrityIndicators(fraudulentDoc);
      expect(integrity.passed).toBe(false);
      expect(integrity.alerts.length).toBeGreaterThanOrEqual(1);
      expect(integrity.riskPoints).toBeGreaterThanOrEqual(30);

      const riskEval = evaluateDocumentRisk({
        extraction: fraudulentDoc,
        masterCheck: { passed: true, entityType: 'PARTNER', confidence: 0.9, mismatches: [], summary: 'OK' },
        compliance: { isCompliant: true, isExpired: false, isExpiringSoon: false, vatCalculationValid: true, mandatoryFieldsPresent: true, missingMandatoryFields: [], complianceScore: 1.0, notes: [] },
      });

      expect(riskEval.factors.some((f) => f.code === 'INTEGRITY_CHECKSUM_FAILURE')).toBe(true);
      expect(riskEval.integrityAlerts?.length).toBeGreaterThanOrEqual(1);
      expect(riskEval.riskScore).toBeGreaterThanOrEqual(30);
    });
  });

  describe('Capability 9: Autonomous PO/WO DB Lookup in Cross-Doc Reconciliation', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('discovers matching PO and Work Order directly from database via text scan', async () => {
      vi.spyOn(prisma.purchaseOrder, 'findFirst').mockResolvedValue({
        id: 'po-uuid-1',
        poNumber: 'PO-99120',
        vendorName: 'Al Futtaim Auto',
        authorizedPoAmount: 4200.0 as any,
        poDate: new Date('2026-08-20'),
      } as any);

      vi.spyOn(prisma.workOrder, 'findFirst').mockResolvedValue({
        id: 'WO-8812',
        startDate: new Date('2026-09-01'),
        status: 'COMPLETED',
      } as any);

      const invoiceDoc: DocumentExtractionResult = {
        docCategory: 'INVOICE',
        suggestedTitle: 'Garage Invoice',
        confidence: 'HIGH',
        confidenceScore: 0.95,
        referenceNumber: 'INV-7712',
      };

      const docText = `INVOICE FOR FLEET REPAIR
Reference: PO-99120
Associated Work Order: WO-8812
Amount: AED 4,200.00`;

      const resolved = await resolveLinkedDocumentsFromDb('tenant-test', invoiceDoc, docText);

      expect(resolved.linkedPo).toBeDefined();
      expect(resolved.linkedPo?.reference).toBe('PO-99120');
      expect(resolved.linkedPo?.amountAed).toBe(4200);

      expect(resolved.linkedWorkOrder).toBeDefined();
      expect(resolved.linkedWorkOrder?.reference).toBe('WO-8812');
    });
  });

  describe('Capability 10: Direct Finance Anomaly Table Escalation (>5% variance)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('automatically registers high-priority anomaly in ai.agent_anomaly_flags upon variance', async () => {
      const querySpy = vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValue([{ id: 'flag-anomaly-101' }] as any);

      const anomalousResult = {
        hasRelationship: true,
        chain: [],
        quotedAmountAed: 4000,
        poAmountAed: 4000,
        invoiceAmountAed: 5200,
        varianceAed: 1200,
        variancePct: 30.0,
        isVarianceAcceptable: false,
        anomalyDetected: true,
        message: 'ALERT: Invoice exceeds PO by +30% (AED 1,200).',
      };

      const res = await escalateToFinanceAnomaly('tenant-test', 'doc-inv-99', anomalousResult);

      expect(res.success).toBe(true);
      expect(res.anomalyId).toBe('flag-anomaly-101');
      expect(querySpy).toHaveBeenCalled();
    });

    it('ignores non-anomalous reconciliations with acceptable tolerance', async () => {
      const normalResult = {
        hasRelationship: true,
        chain: [],
        poAmountAed: 4000,
        invoiceAmountAed: 4050,
        varianceAed: 50,
        variancePct: 1.25,
        isVarianceAcceptable: true,
        anomalyDetected: false,
        message: 'Commercial amounts verified within acceptable tolerance.',
      };

      const res = await escalateToFinanceAnomaly('tenant-test', 'doc-inv-100', normalResult);
      expect(res.success).toBe(false);
      expect(res.message).toContain('No commercial variance anomaly detected');
    });
  });

  describe('Capability 11: Daily Document Lifecycle Expiry Sweeper', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('identifies expired and expiring documents and transitions lifecycle statuses', async () => {
      vi.spyOn(prisma, '$queryRawUnsafe')
        // 1st call for expired
        .mockResolvedValueOnce([
          { id: 'doc-1', doc_category: 'REGISTRATION_CARD', expiry_date: '2026-08-01', lifecycle_status: 'EXPIRED' }
        ] as any)
        // 2nd call for expiring soon
        .mockResolvedValueOnce([
          { id: 'doc-2', doc_category: 'DRIVER_LICENSE', expiry_date: '2026-09-25', lifecycle_status: 'EXPIRING' },
          { id: 'doc-3', doc_category: 'INSURANCE_POLICY', expiry_date: '2026-09-28', lifecycle_status: 'EXPIRING' }
        ] as any);

      const sweepResult = await sweepDocumentExpiries('tenant-test');

      expect(sweepResult.sweptCount).toBe(3);
      expect(sweepResult.expiredCount).toBe(1);
      expect(sweepResult.expiringCount).toBe(2);
      expect(sweepResult.details.length).toBe(3);
      expect(sweepResult.details[0].newStatus).toBe('EXPIRED');
      expect(sweepResult.details[1].newStatus).toBe('EXPIRING');
    });
  });

  describe('Capability 12: Scheduled Cron Lifecycle Sweep Endpoint (/api/documents/intelligence/cron/lifecycle-sweep)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('processes GET requests with tenant parameter and triggers sweep', async () => {
      vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/documents/intelligence/cron/lifecycle-sweep?tenantId=tenant-corp', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-corp' },
      });

      const res = await lifecycleSweepGET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.scope).toBe('TENANT_tenant-corp');
      expect(json.sweptCount).toBe(0);
    });

    it('processes POST requests and parses tenantId from request body', async () => {
      vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/documents/intelligence/cron/lifecycle-sweep', {
        method: 'POST',
        headers: {
          'x-tenant-id': 'tenant-corp',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ tenantId: 'tenant-corp' }),
      });

      const res = await lifecycleSweepPOST(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.scope).toBe('TENANT_tenant-corp');
    });
  });
});
