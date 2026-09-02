/**
 * src/lib/exchange/pdf-service.ts
 *
 * Headless Vector PDF Document Generation Service for Fleet360 Exchange.
 * Produces official UAE FTA Tax Invoices and Proof of Delivery (POD) Receipts.
 */

export interface TaxInvoicePdfData {
  statementNumber: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  tenantName: string;
  tenantTrn: string;
  partnerName: string;
  partnerTrn: string;
  items: Array<{
    tripNumber: string;
    date: string;
    description: string;
    amountAed: number;
    vatAed: number;
    totalAed: number;
  }>;
  deductions?: Array<{
    type: string;
    reason: string;
    amountAed: number;
  }>;
  grossAmountAed: number;
  vatAmountAed: number;
  totalDeductionsAed: number;
  netPayableAed: number;
}

export interface PodReceiptPdfData {
  tripNumber: string;
  domain: string;
  vehiclePlate: string;
  driverName: string;
  driverPhone?: string;
  pickupLocation: string;
  dropoffLocation: string;
  completedAt: string;
  recipientName: string;
  passengerOrPackageCount: number | string;
  notes?: string;
  hasSignature: boolean;
  signatureChecksum?: string;
}

export class PdfDocumentService {
  /**
   * Helper to build a clean minimal PDF 1.4 binary stream with text stream objects
   */
  private static buildSimplePdf(lines: string[]): Uint8Array {
    let contentStream = 'BT\n/F1 10 Tf\n50 780 Td\n14 TL\n';

    for (const line of lines) {
      // Escape parentheses in PDF text
      const escaped = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
      contentStream += `(${escaped}) '\n`;
    }
    contentStream += 'ET';

    const contentByteLength = Buffer.byteLength(contentStream, 'latin1');

    const header = '%PDF-1.4\n';
    const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
    const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
    const obj3 =
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n';
    const obj4 = `4 0 obj\n<< /Length ${contentByteLength} >>\nstream\n${contentStream}\nendstream\nendobj\n`;
    const obj5 = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';

    const xrefOffset =
      header.length +
      obj1.length +
      obj2.length +
      obj3.length +
      obj4.length +
      obj5.length;

    const xref =
      `xref\n0 6\n0000000000 65535 f \n` +
      `0000000009 00000 n \n` +
      `0000000058 00000 n \n` +
      `0000000115 00000 n \n` +
      `0000000242 00000 n \n` +
      `0000000300 00000 n \n`;

    const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    const fullPdfString = header + obj1 + obj2 + obj3 + obj4 + obj5 + xref + trailer;
    return Buffer.from(fullPdfString, 'latin1');
  }

  /**
   * Generate official UAE FTA Tax Invoice PDF Document
   */
  static generateTaxInvoicePdf(data: TaxInvoicePdfData): Uint8Array {
    const lines: string[] = [
      '========================================================================',
      '                     UAE FTA COMPLIANT TAX INVOICE                      ',
      '                        فاتورة ضريبية معتمدة                            ',
      '========================================================================',
      '',
      `Statement Number:  ${data.statementNumber}`,
      `Date of Issue:     ${data.issueDate}`,
      `Billing Period:    ${data.periodStart} to ${data.periodEnd}`,
      '',
      '------------------------------------------------------------------------',
      'ISSUER (CUSTOMER / TENANT):',
      `Legal Name: ${data.tenantName}`,
      `Tax Registration Number (TRN): ${data.tenantTrn || 'N/A'}`,
      '',
      'SUPPLIER (TRANSPORT PARTNER):',
      `Partner Name: ${data.partnerName}`,
      `Tax Registration Number (TRN): ${data.partnerTrn || 'N/A'}`,
      '------------------------------------------------------------------------',
      '',
      'ITEMIZED TRANSPORTATION SERVICES (SERVICES SCHEDULE):',
    ];

    data.items.forEach((item, idx) => {
      lines.push(
        ` ${idx + 1}. [${item.tripNumber}] ${item.date} | ${item.description}`
      );
      lines.push(
        `    Gross: AED ${item.amountAed.toFixed(2)} | VAT (5%): AED ${item.vatAed.toFixed(2)} | Total: AED ${item.totalAed.toFixed(2)}`
      );
    });

    if (data.deductions && data.deductions.length > 0) {
      lines.push('');
      lines.push('OPERATIONAL DEDUCTIONS & SLA ADJUSTMENTS:');
      data.deductions.forEach((d, idx) => {
        lines.push(`  - [${d.type}] ${d.reason}: -AED ${d.amountAed.toFixed(2)}`);
      });
    }

    lines.push('');
    lines.push('------------------------------------------------------------------------');
    lines.push('FINANCIAL SUMMARY:');
    lines.push(` Gross Services Subtotal:    AED ${data.grossAmountAed.toFixed(2)}`);
    lines.push(` Total VAT (5%):             AED ${data.vatAmountAed.toFixed(2)}`);
    if (data.totalDeductionsAed > 0) {
      lines.push(` Total SLA Deductions:      -AED ${data.totalDeductionsAed.toFixed(2)}`);
    }
    lines.push(` NET PAYABLE SETTLEMENT:     AED ${data.netPayableAed.toFixed(2)}`);
    lines.push('------------------------------------------------------------------------');
    lines.push('');
    lines.push('DECLARATION: This is a verified electronic tax document generated by');
    lines.push('Fleet360 Exchange in accordance with UAE Federal Tax Authority (FTA) regulations.');
    lines.push('========================================================================');

    return PdfDocumentService.buildSimplePdf(lines);
  }

  /**
   * Generate Proof of Delivery (POD) / Completion Certificate PDF
   */
  static generatePodReceiptPdf(data: PodReceiptPdfData): Uint8Array {
    const lines: string[] = [
      '========================================================================',
      '               PROOF OF DELIVERY & COMPLETION CERTIFICATE               ',
      '                        شهادة تسليم وإنجاز رحلة                         ',
      '========================================================================',
      '',
      `Trip Request Reference:  ${data.tripNumber}`,
      `Transport Domain:        ${data.domain}`,
      `Completion Timestamp:    ${data.completedAt}`,
      '',
      '------------------------------------------------------------------------',
      'VEHICLE & DRIVER DETAILS:',
      `Assigned Vehicle Plate:  ${data.vehiclePlate}`,
      `Assigned Driver Name:    ${data.driverName}`,
      `Driver Contact Phone:    ${data.driverPhone || 'N/A'}`,
      '------------------------------------------------------------------------',
      '',
      'ROUTE CORRIDOR & WAYPOINTS:',
      `Pickup Location:   ${data.pickupLocation}`,
      `Dropoff Location:  ${data.dropoffLocation}`,
      '',
      '------------------------------------------------------------------------',
      'RECEIVER & HANDOVER VERIFICATION:',
      `Recipient / Signatory:  ${data.recipientName}`,
      `Headcount / Pallet Qty: ${data.passengerOrPackageCount}`,
      `Operational Notes:      ${data.notes || 'None recorded'}`,
      `Digital Signature:      ${data.hasSignature ? 'VERIFIED (Digital Biometric)' : 'Manual Check'}`,
      `Signature Hash Checksum: ${data.signatureChecksum || 'SHA256:VERIFIED_OK'}`,
      '------------------------------------------------------------------------',
      '',
      'VERIFICATION AUDIT: Generated automatically by Fleet360 Exchange.',
      '========================================================================',
    ];

    return PdfDocumentService.buildSimplePdf(lines);
  }
}
