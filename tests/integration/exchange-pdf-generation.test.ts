import { describe, it, expect } from 'vitest';
import { PdfDocumentService } from '@/lib/exchange/pdf-service';

describe('Fleet360 Exchange: Headless PDF Generation (Tax Invoices & POD Receipts)', () => {
  it('Test 1: Generates valid %PDF-1.4 binary stream', () => {
    const pdfBytes = PdfDocumentService.generateTaxInvoicePdf({
      statementNumber: 'STM-202609-001',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-15',
      issueDate: '2026-09-16',
      tenantName: 'Fleet360 Enterprise Transport LLC',
      tenantTrn: '100456789000003',
      partnerName: 'Gulf Premier Transport LLC',
      partnerTrn: '100987654300003',
      items: [
        {
          tripNumber: 'REQ-BUS-99120',
          date: '2026-09-02',
          description: 'Staff Route DXB-JAFZA',
          amountAed: 1200.0,
          vatAed: 60.0,
          totalAed: 1260.0,
        },
      ],
      grossAmountAed: 1200.0,
      vatAmountAed: 60.0,
      totalDeductionsAed: 0.0,
      netPayableAed: 1260.0,
    });

    expect(pdfBytes).toBeDefined();
    expect(pdfBytes.length).toBeGreaterThan(100);

    const pdfString = Buffer.from(pdfBytes).toString('latin1');
    expect(pdfString.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfString.includes('%%EOF')).toBe(true);
  });

  it('Test 2: Includes UAE FTA Tax Registration Numbers & 5% VAT calculations', () => {
    const data = {
      statementNumber: 'STM-202609-002',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-15',
      issueDate: '2026-09-16',
      tenantName: 'Fleet360 Enterprise Transport LLC',
      tenantTrn: '100456789000003',
      partnerName: 'Emirates Cold Chain Logistics LLC',
      partnerTrn: '100987654300003',
      items: [
        {
          tripNumber: 'REQ-FRT-88210',
          date: '2026-09-05',
          description: 'Pharmaceutical Cold-Chain Transport (+4C)',
          amountAed: 2400.0,
          vatAed: 120.0,
          totalAed: 2520.0,
        },
      ],
      deductions: [
        {
          type: 'LATE_ARRIVAL_PENALTY',
          reason: '30 min delay at loading bay',
          amountAed: 100.0,
        },
      ],
      grossAmountAed: 2400.0,
      vatAmountAed: 120.0,
      totalDeductionsAed: 100.0,
      netPayableAed: 2420.0,
    };

    const pdfBytes = PdfDocumentService.generateTaxInvoicePdf(data);
    const pdfString = Buffer.from(pdfBytes).toString('latin1');

    expect(pdfString).toContain('100456789000003');
    expect(pdfString).toContain('100987654300003');
    expect(pdfString).toContain('AED 2420.00');
    expect(pdfString).toContain('LATE_ARRIVAL_PENALTY');
  });

  it('Test 3: Generates Proof of Delivery (POD) Receipt with Signatory Checksum', () => {
    const podData = {
      tripNumber: 'REQ-BUS-99120',
      domain: 'PASSENGER_TRANSPORT',
      vehiclePlate: 'Dubai T 99210',
      driverName: 'Mohammed Al Mansoori',
      driverPhone: '+971 50 123 4567',
      pickupLocation: 'Dubai Silicon Oasis HQ',
      dropoffLocation: 'Jebel Ali Free Zone Gate 4',
      completedAt: '2026-09-02T08:15:00Z',
      recipientName: 'Shift Supervisor Tariq',
      passengerOrPackageCount: 48,
      notes: 'All passengers boarded and arrived safely',
      hasSignature: true,
      signatureChecksum: 'SHA256:4b22e18f9801a2b3c4d5e6f7a8b9c0d1',
    };

    const pdfBytes = PdfDocumentService.generatePodReceiptPdf(podData);
    const pdfString = Buffer.from(pdfBytes).toString('latin1');

    expect(pdfString.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfString).toContain('Dubai T 99210');
    expect(pdfString).toContain('Mohammed Al Mansoori');
    expect(pdfString).toContain('Shift Supervisor Tariq');
    expect(pdfString).toContain('SHA256:4b22e18f9801a2b3c4d5e6f7a8b9c0d1');
  });
});
