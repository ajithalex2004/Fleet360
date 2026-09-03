import { describe, it, expect } from 'vitest';
import {
  createDigitalEPOD,
  generateEPODSeal,
  PalletDeliveryCondition,
} from '@/lib/digital-epod-engine';

describe('Digital Electronic Proof of Delivery (e-POD) Engine', () => {
  const samplePallets: PalletDeliveryCondition[] = [
    {
      palletId: 'PAL-EIN360-001',
      condition: 'INTACT_PERFECT',
      temperatureVerified: '-18.2°C (Frozen Pharma)',
      sealIntact: true,
    },
    {
      palletId: 'PAL-EIN360-002',
      condition: 'INTACT_PERFECT',
      temperatureVerified: '+3.8°C (Cold-Chain Dairy)',
      sealIntact: true,
    },
  ];

  it('creates an official e-POD record with consignee on-glass signature and Emirates ID', () => {
    const epod = createDigitalEPOD({
      bookingRef: 'EXL-FRT-9821',
      ebolNumber: 'EBOL-EXL-2026-8891',
      consigneeName: 'Dubai Mall Retail Receiving Dock 3',
      consigneeRecipientName: 'Rashid Al-Mansoori',
      consigneeDesignation: 'Receiving Dock Lead',
      consigneeEmiratesId: '784-1988-1234567-1',
      consigneeSignatureSvg: '<svg>signature</svg>',
      palletsSummary: samplePallets,
    });

    expect(epod.epodNumber).toContain('EPOD-EXL-');
    expect(epod.ebolNumber).toBe('EBOL-EXL-2026-8891');
    expect(epod.consigneeRecipientName).toBe('Rashid Al-Mansoori');
    expect(epod.consigneeEmiratesId).toBe('784-1988-1234567-1');
    expect(epod.driverName).toBe('Tariq Mansoor');
    expect(epod.status).toBe('DELIVERED_CONFIRMED');
    expect(epod.autoInvoiceTriggered).toBe(true);
    expect(epod.cryptographicPODSeal).toHaveLength(64); // SHA-256 hex
  });

  it('verifies tamper-resistance of cryptographic e-POD seal', () => {
    const epod = createDigitalEPOD({
      bookingRef: 'EXL-FRT-9821',
      ebolNumber: 'EBOL-EXL-2026-8891',
      consigneeName: 'Dubai Mall Retail Receiving Dock 3',
      consigneeRecipientName: 'Rashid Al-Mansoori',
      consigneeDesignation: 'Receiving Dock Lead',
      consigneeEmiratesId: '784-1988-1234567-1',
      consigneeSignatureSvg: '<svg>signature</svg>',
      palletsSummary: samplePallets,
    });

    const originalSeal = epod.cryptographicPODSeal;

    // Tamper with recipient name or delivery time
    const tamperedSeal = generateEPODSeal({
      ...epod,
      consigneeRecipientName: 'Imposter Recipient',
    });

    expect(tamperedSeal).not.toBe(originalSeal);
  });
});
