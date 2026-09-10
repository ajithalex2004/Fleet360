import { describe, it, expect } from 'vitest';
import { getAgent } from '@/lib/agents/registry';
import { DOCUMENT_INTELLIGENCE_AGENT } from '@/lib/agents/document-intelligence/agent';
import { extractDocumentIntelligence } from '@/lib/agents/document-intelligence/extractor';
import { autoPopulateFleet360Record } from '@/lib/agents/document-intelligence/auto-populator';
import { DocumentExtractionResult } from '@/lib/agents/types';

describe('Document Intelligence Agent v1.0.0', () => {
  it('is properly registered in the Agent Registry', async () => {
    const agent = await getAgent('document-intelligence');
    expect(agent).toBeDefined();
    expect(agent.id).toBe('document-intelligence');
    expect(agent.name).toBe('Document Intelligence Agent');
    expect(agent.autonomyLevel).toBe('L2');
    expect(agent.agentType).toBe('BATCH');
  });

  describe('Multimodal Extraction Engine across 9 Document Categories', () => {
    it('1. Extracts Vehicle Registration (Mulkiya) entities accurately', async () => {
      const mulkiyaSample = `UNITED ARAB EMIRATES - MINISTRY OF INTERIOR
VEHICLE REGISTRATION CARD (MULKIYA)
Traffic Plate: Dubai B 78219
Chassis / VIN: 1HGBH41JXMN109182
Make & Model: Toyota HiAce Commuter High Roof 3.5L
Model Year: 2024
Color: White
Expiry Date: 2027-08-30
Issue Date: 2024-08-31
Owner: Fleet360 Bus Transport LLC
Traffic File No: 99482710`;

      const result = await extractDocumentIntelligence({
        fileName: 'dubai_mulkiya_vehicle_78219.pdf',
        documentText: mulkiyaSample,
      });

      expect(result.docCategory).toBe('REGISTRATION_CARD');
      expect(result.confidence).toBe('HIGH');
      expect(result.vehicle?.plateNumber).toBe('78219');
      expect(result.vehicle?.plateCode).toBe('B');
      expect(result.vehicle?.emirate).toBe('Dubai');
      expect(result.vehicle?.vin).toBe('1HGBH41JXMN109182');
      expect(result.expiryDate).toBe('2027-08-30');
    });

    it('2. Extracts Motor Insurance Policy entities accurately', async () => {
      const insuranceSample = `ORIENT INSURANCE PJSC - DUBAI
COMMERCIAL MOTOR COMPREHENSIVE POLICY
Policy No: POL-2026-DXB-98172
Insured: Fleet360 Transport Operations LLC
Vehicle: Toyota Coaster 30-Seater (Plate: Abu Dhabi 4 19283)
VIN: 2T1BR32E8FC298412
Sum Insured: AED 215,000.00
Premium Amount: AED 4,850.00 (VAT 5%: AED 242.50) | Total AED: 5,092.50
Period of Insurance: From 01/10/2025 to 30/09/2026
Expiry Date: 2026-09-30`;

      const result = await extractDocumentIntelligence({
        fileName: 'orient_insurance_comprehensive_2026.pdf',
        documentText: insuranceSample,
      });

      expect(result.docCategory).toBe('INSURANCE_POLICY');
      expect(result.referenceNumber).toBe('POL-2026-DXB-98172');
      expect(result.expiryDate).toBe('2026-09-30');
      expect(result.financials?.totalAmount).toBe(5092.50);
      expect(result.financials?.taxAmount).toBe(242.50);
      expect(result.vehicle?.vin).toBe('2T1BR32E8FC298412');
    });

    it('3. Extracts UAE Driver License entities accurately', async () => {
      const licenseSample = `UNITED ARAB EMIRATES - ROADS & TRANSPORT AUTHORITY (RTA)
DRIVING LICENSE / رخصة قيادة
License No: DL-DXB-8839120
Holder Name: Rashid Ahmed Al-Mansoor
Nationality: UAE / Emirati
Emirates ID: 784-1988-1928471-1
Vehicle Categories: Heavy Bus (Category 6), Light Vehicle (Category 3)
Issue Date: 2022-04-15
Expiry Date: 2027-04-14`;

      const result = await extractDocumentIntelligence({
        fileName: 'driver_license_rashid_ahmed.jpg',
        documentText: licenseSample,
      });

      expect(result.docCategory).toBe('DRIVER_LICENSE');
      expect(result.driver?.licenseNumber).toBe('DL-DXB-8839120');
      expect(result.driver?.driverName).toBe('Rashid Ahmed Al-Mansoor');
      expect(result.driver?.emiratesId).toBe('784-1988-1928471-1');
      expect(result.expiryDate).toBe('2027-04-14');
      expect(result.driver?.categories).toContain('Heavy Bus (Category 6)');
    });

    it('4. Extracts Maintenance Job Cards & Workshop Reports accurately', async () => {
      const jobCardSample = `AL-FUTTAIM AUTO CENTERS - DUBAI INDUSTRIAL CITY
MAINTENANCE REPORT & JOB CARD # JC-99120
Vehicle: Toyota HiAce (Plate: Dubai B 78219)
Odometer Reading: 45,210 KM
Service Description: Major 40k Service, Front Brake Pad Replacement, AC Compressor Flush
Total Labor: AED 750.00
Parts Total: AED 1,420.00
VAT (5%): AED 108.50
Net Total AED: 2,278.50
Status: Work Complete - Passed Road Test
Date: 2026-09-02`;

      const result = await extractDocumentIntelligence({
        fileName: 'al_futtaim_job_card_WO-9912.pdf',
        documentText: jobCardSample,
      });

      expect(result.docCategory).toBe('MAINTENANCE_REPORT');
      expect(result.financials?.totalAmount).toBe(2278.50);
      expect(result.financials?.taxAmount).toBe(108.50);
      expect(result.vehicle?.plateNumber).toBe('78219');
    });

    it('5. Extracts Fleet Invoices & Spare Parts Bills accurately', async () => {
      const invoiceSample = `TAX INVOICE - AL NABOODA AUTOMOTIVE PARTS LLC
TRN: 100293847500003
Invoice No: INV-2026-88129
Invoice Date: 2026-08-25
Due Date: 2026-09-24
Customer: Fleet360 Logistics Solutions
Items: 
 1. Heavy Duty Brake Discs (x4) - AED 1,600.00
 2. Synthetic Oil 5W30 200L Drum - AED 3,200.00
Subtotal: AED 4,800.00
VAT (5%): AED 240.00
Total Amount: AED 5,040.00
Payment Terms: Net 30 Days`;

      const result = await extractDocumentIntelligence({
        fileName: 'spare_parts_tax_invoice_INV-88129.pdf',
        documentText: invoiceSample,
      });

      expect(result.docCategory).toBe('INVOICE');
      expect(result.referenceNumber).toBe('INV-2026-88129');
      expect(result.financials?.totalAmount).toBe(5040.00);
      expect(result.financials?.taxAmount).toBe(240.00);
      expect(result.supplier?.supplierName).toBe('AL NABOODA AUTOMOTIVE PARTS LLC');
      expect(result.supplier?.taxNumber).toBe('100293847500003');
    });

    it('6. Extracts Commercial Quotations accurately', async () => {
      const quoteSample = `PRICE QUOTATION - COMMERCIAL LEASING
Quote Reference: QT-2026-4410
Date: 2026-09-01
Valid Until: 2026-09-30
Supplier: Diamond Lease LLC
Description: 12-Month Charter of 5x 50-Seater Yutong Buses
Total Proposed Cost: AED 180,000.00`;

      const result = await extractDocumentIntelligence({
        fileName: 'quotation_50_seater_buses.pdf',
        documentText: quoteSample,
      });

      expect(result.docCategory).toBe('QUOTATION');
      expect(result.financials?.totalAmount).toBe(180000.00);
      expect(result.referenceNumber).toBe('QT-2026-4410');
      expect(result.expiryDate).toBe('2026-09-30');
    });

    it('7. Extracts Lease & Service Contracts accurately', async () => {
      const contractSample = `CORPORATE SERVICE AGREEMENT & LEASE CONTRACT
Agreement No: CNT-2026-9081
Parties: Fleet360 Transport LLC & Emaar Hospitality Group
Term: 01/10/2026 to 30/09/2027
Expiry Date: 2027-09-30
Monthly Rate: AED 35,000.00`;

      const result = await extractDocumentIntelligence({
        fileName: 'emaar_hospitality_staff_transport_contract.pdf',
        documentText: contractSample,
      });

      expect(result.docCategory).toBe('CONTRACT');
      expect(result.referenceNumber).toBe('CNT-2026-9081');
      expect(result.expiryDate).toBe('2027-09-30');
    });

    it('8. Extracts Proof of Delivery (POD) documents accurately', async () => {
      const podSample = `PROOF OF DELIVERY (POD) - COURIER & CARGO
Waybill Number: AWB-9941829
Tracking Ref: TRK-DXB-5521
Shipper: Amazon Fulfilment Center DXB3
Recipient: Emirates SkyCargo Logistics
Received By: Muhammad Ali (Signature on file)
Date & Time: 2026-09-08 14:35 GST
Status: DELIVERED`;

      const result = await extractDocumentIntelligence({
        fileName: 'signed_pod_awb_9941829.png',
        documentText: podSample,
      });

      expect(result.docCategory).toBe('PROOF_OF_DELIVERY');
      expect(result.referenceNumber).toBe('AWB-9941829');
    });

    it('9. Extracts Vehicle Inspection Sheets accurately', async () => {
      const inspectionSample = `RTA ANNUAL VEHICLE INSPECTION & ROADWORTHINESS CERTIFICATE
Inspection Certificate No: INSP-2026-1182
Vehicle Plate: Dubai B 78219
VIN: 1HGBH41JXMN109182
Odometer: 45,300 KM
Brake Efficiency Test: PASSED (88%)
Tire Tread & Suspension: PASSED
Exhaust Emissions: PASSED (Euro 6 compliant)
Overall Result: PASS - APPROVED FOR RENEWAL
Inspection Date: 2026-09-05
Valid Until: 2027-09-04`;

      const result = await extractDocumentIntelligence({
        fileName: 'rta_vehicle_inspection_pass_sheet.pdf',
        documentText: inspectionSample,
      });

      expect(result.docCategory).toBe('INSPECTION_SHEET');
      expect(result.referenceNumber).toBe('INSP-2026-1182');
      expect(result.expiryDate).toBe('2027-09-04');
      expect(result.vehicle?.plateNumber).toBe('78219');
    });
  });

  describe('Auto-Population & Record Linking Engine', () => {
    it('handles vehicle record linking gracefully when record does not exist in test db', async () => {
      const extraction: DocumentExtractionResult = {
        docCategory: 'REGISTRATION_CARD',
        confidence: 'HIGH',
        confidenceScore: 0.98,
        expiryDate: '2027-08-30',
        vehicle: {
          plateNumber: '78219',
          plateCode: 'B',
          emirate: 'Dubai',
          vin: '1HGBH41JXMN109182',
          make: 'Toyota',
          model: 'HiAce',
          year: 2024,
        },
      };

      const result = await autoPopulateFleet360Record('tenant-test-01', extraction);
      expect(result).toBeDefined();
      expect(result.linkedEntityType).toBe('VEHICLE');
      expect(typeof result.success).toBe('boolean');
    });

    it('handles driver record linking gracefully when driver does not exist in test db', async () => {
      const extraction: DocumentExtractionResult = {
        docCategory: 'DRIVER_LICENSE',
        confidence: 'HIGH',
        confidenceScore: 0.96,
        expiryDate: '2027-04-14',
        driver: {
          driverName: 'Rashid Ahmed Al-Mansoor',
          licenseNumber: 'DL-DXB-8839120',
          emiratesId: '784-1988-1928471-1',
          categories: ['Heavy Bus (Category 6)'],
        },
      };

      const result = await autoPopulateFleet360Record('tenant-test-01', extraction);
      expect(result).toBeDefined();
      expect(result.linkedEntityType).toBe('DRIVER');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('End-to-End Agent Execution & Telemetry', () => {
    it('executes agent run successfully with telemetry and time saved calculations', async () => {
      const runResult = await DOCUMENT_INTELLIGENCE_AGENT.run({
        agent_id: 'document-intelligence',
        tenant_id: 'default',
        event_type: 'document.uploaded',
        entity_id: 'mulkiya_sample.pdf',
        metadata: {
          fileName: 'mulkiya_sample.pdf',
          documentText: `VEHICLE REGISTRATION CARD\nPlate: Dubai A 12345\nVIN: 1HGCR2F83HA001928\nExpiry: 2027-01-15`,
          autoApply: false,
        },
      });

      expect(runResult.status).toBe('COMPLETED');
      expect(runResult.agentId).toBe('document-intelligence');
      expect(runResult.output).toBeDefined();
      expect(runResult.output.extraction.docCategory).toBe('REGISTRATION_CARD');
      expect(runResult.output.timeSavedMinutes).toBe(15);
      expect(runResult.telemetry?.costAvoidedAed).toBe(45);
      expect(runResult.telemetry?.decisionQualityScore).toBeGreaterThanOrEqual(0.9);
    });
  });
});
