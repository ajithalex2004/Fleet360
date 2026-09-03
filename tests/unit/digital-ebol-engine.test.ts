import { describe, it, expect } from 'vitest';
import {
  parseGs1Barcode,
  createDigitalEBOL,
  generateEBOLSeal,
  ConsignmentPalletItem,
} from '@/lib/digital-ebol-engine';

describe('Digital Bill of Lading (e-BOL) & GS1 Barcode Engine', () => {
  const samplePallet: ConsignmentPalletItem = {
    palletId: 'PAL-EIN360-001',
    gs1Barcode: '(01)06291100000001(10)LOT-2026-A(21)SN987654(3102)000550',
    description: 'Medical Cold-Chain Vaccines',
    palletType: 'EURO_PALLET_EPAL',
    weightKg: 550,
    dimensionsCm: { l: 120, w: 80, h: 140 },
    hazardousCode: null,
    temperatureRange: '-18°C Frozen',
    scannedAt: '2026-09-03T13:30:00.000Z',
    scannedBy: 'Dock Scanner #1',
    verificationStatus: 'VERIFIED_LOADED',
  };

  it('correctly parses GS1-128 barcode Application Identifiers (GTIN, Lot, Serial, Weight)', () => {
    const parsed = parseGs1Barcode(samplePallet.gs1Barcode);

    expect(parsed.gtin).toBe('06291100000001');
    expect(parsed.batchLot).toBe('LOT-2026-A');
    expect(parsed.serialNumber).toBe('SN987654');
    expect(parsed.weightKg).toBe(5.5);
  });

  it('generates an official sealed e-BOL record with UAE Customs Declaration Number', () => {
    const ebol = createDigitalEBOL({
      bookingRef: 'EXL-FRT-9821',
      shipperName: 'EIN360 General Trading LLC',
      shipperAddress: 'JAFZA Gate 4, Dubai',
      shipperContact: '+971 4 888 1234',
      consigneeName: 'Dubai Mall Logistics Dock 3',
      consigneeAddress: 'Downtown Dubai',
      consigneeContact: '+971 4 999 5678',
      items: [samplePallet],
    });

    expect(ebol.ebolNumber).toContain('EBOL-EXL-');
    expect(ebol.uaeCustomsDeclarationNo).toContain('DEC-DXB-CUST-');
    expect(ebol.carrierName).toBe('EXL Solutions Freight Lines LLC');
    expect(ebol.totalPallets).toBe(1);
    expect(ebol.totalGrossWeightKg).toBe(550);
    expect(ebol.cryptographicSeal).toHaveLength(64); // SHA-256 hex
    expect(ebol.status).toBe('SEALED');
  });

  it('verifies tamper-resistance of cryptographic SHA-256 document seal', () => {
    const ebol = createDigitalEBOL({
      bookingRef: 'EXL-FRT-9821',
      shipperName: 'EIN360 General Trading LLC',
      shipperAddress: 'JAFZA Gate 4, Dubai',
      shipperContact: '+971 4 888 1234',
      consigneeName: 'Dubai Mall Logistics Dock 3',
      consigneeAddress: 'Downtown Dubai',
      consigneeContact: '+971 4 999 5678',
      items: [samplePallet],
    });

    const originalSeal = ebol.cryptographicSeal;

    // Tamper with pallet weight
    const tamperedItems = [{ ...samplePallet, weightKg: 999 }];
    const tamperedSeal = generateEBOLSeal({ ...ebol, items: tamperedItems });

    expect(tamperedSeal).not.toBe(originalSeal);
  });
});
