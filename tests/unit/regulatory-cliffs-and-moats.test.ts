import { describe, it, expect } from 'vitest';
import { generatePeppolUaeInvoiceXml, isValidUaeTrn, PeppolInvoiceData } from '@/lib/finance/peppol-e-invoice';
import { formatAsateelIngestionPayload, evaluateAsateelDispatchGating, isValidEmiratesId } from '@/lib/compliance/asateel-telematics';
import { enqueueTelemetryPoint, peekBufferedTelemetry, clearBufferedTelemetry } from '@/lib/tracking/offline-telemetry-queue';
import { generateSelfBilledTaxInvoice, MANDATORY_STATUTORY_DECLARATION } from '@/lib/finance/self-billing';
import { reconcileTollCrossings, TollCrossingEvent, ShiftOrTripContext } from '@/lib/fines/toll-reconciliation';
import { calculateTripScope3Carbon, generateScope3AuditCertificate } from '@/lib/esg/scope3-carbon-calculator';

describe('1. UAE Peppol E-Invoicing Engine (UBL 2.1 / PINT-UAE)', () => {
  it('validates 15-digit UAE TRN format', () => {
    expect(isValidUaeTrn('100456789012345')).toBe(true);
    expect(isValidUaeTrn('100-456-789-012-345')).toBe(true);
    expect(isValidUaeTrn('200456789012345')).toBe(false); // Does not start with 100
    expect(isValidUaeTrn('10012345')).toBe(false); // Too short
  });

  it('generates valid PINT-UAE UBL 2.1 XML with 5% VAT and SHA-256 digest', () => {
    const data: PeppolInvoiceData = {
      invoiceNumber: 'INV-2026-0012',
      issueDate: '2026-08-15',
      currency: 'AED',
      seller: {
        name: 'Fleet360 Smart Mobility LLC',
        trn: '100456789012345',
        address: { street: 'SZR', city: 'Dubai', countryCode: 'AE' },
      },
      buyer: {
        name: 'Emirates Global Logistics PJSC',
        trn: '100987654321000',
        address: { street: 'KIZAD', city: 'Abu Dhabi', countryCode: 'AE' },
      },
      lines: [
        {
          id: 1,
          name: 'Heavy Transport Haulage',
          quantity: 2,
          unitPrice: 2000,
          netAmount: 4000,
          vatRatePercent: 5,
          vatAmount: 200,
          taxCategoryCode: 'S',
        },
      ],
    };

    const result = generatePeppolUaeInvoiceXml(data);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.digestHash).toBeDefined();
    expect(result.xml).toContain('urn:peppol:pint:billing-1@ae-1');
    expect(result.xml).toContain('<cbc:TaxAmount currencyID="AED">200.00</cbc:TaxAmount>');
    expect(result.xml).toContain('<cbc:PayableAmount currencyID="AED">4200.00</cbc:PayableAmount>');
  });
});

describe('2. Emirate-Aware Telematics (Abu Dhabi ITC Asateel)', () => {
  it('validates Emirates ID format', () => {
    expect(isValidEmiratesId('784-1990-1234567-1')).toBe(true);
    expect(isValidEmiratesId('784199012345671')).toBe(true);
    expect(isValidEmiratesId('999-1990-1234567-1')).toBe(false);
  });

  it('formats ITC Asateel v2.4 JSON payload with required telemetry telemetry nodes', () => {
    const ping = formatAsateelIngestionPayload({
      companyRegistrationNo: 'ITC-OP-882',
      vehiclePlate: 'AUH-48291',
      plateSource: 'AUH',
      vin: '1HGCR2F83HA000123',
      gpsDeviceImei: '864209041234567',
      driverEmiratesId: '784-1988-7654321-2',
      latitude: 24.453884,
      longitude: 54.377343,
      speedKmh: 85,
      headingDeg: 120,
      ignition: true,
      odometerKm: 42100,
      timestamp: '2026-08-15T14:30:00Z',
    });

    expect(ping.itcStandardVersion).toBe('2.4');
    expect(ping.record.PlateNo).toBe('AUH-48291');
    expect(ping.record.GPS.Speed).toBe(85);
    expect(ping.record.Telemetry.Ignition).toBe(1);
  });

  it('blocks dispatch to Abu Dhabi corridor if Asateel permit is missing', () => {
    const gateResult = evaluateAsateelDispatchGating({
      vehicleId: 'VEH-99',
      plateNumber: 'DXB-10293',
      plateEmirate: 'DXB',
      hasAsateelPermit: false, // Lacks AUH permit
      routeOriginsAndDestinations: ['Dubai', 'Abu Dhabi Mussafah'],
      gpsLastPingTimestamp: new Date().toISOString(),
      driverEmiratesId: '784-1992-1122334-5',
    });

    expect(gateResult.allowed).toBe(false);
    expect(gateResult.jurisdiction).toBe('ABU_DHABI_ITC');
    expect(gateResult.reasons.some(r => r.includes('Asateel'))).toBe(true);
  });
});

describe('3. Offline-First Telemetry Buffering', () => {
  it('enqueues and peeks buffered telemetry points with timestamps', async () => {
    const token = 'test-driver-token-offline-01';
    const id = await enqueueTelemetryPoint(token, {
      latitude: 25.2048,
      longitude: 55.2708,
      speed: 60,
      heading: 90,
      timestamp: '2026-08-15T12:00:00Z',
    });

    expect(id).toBeDefined();
    const buffered = await peekBufferedTelemetry(10, token);
    expect(buffered.length).toBeGreaterThanOrEqual(1);
    expect(buffered[0].latitude).toBe(25.2048);

    await clearBufferedTelemetry(buffered.map(b => b.id));
  });
});

describe('4. UAE VAT Art. 59(9) Self-Billing Engine', () => {
  it('generates self-billed tax invoice with mandatory statutory declaration and 5% VAT', () => {
    const invoice = generateSelfBilledTaxInvoice({
      selfBillNumber: 'SB-2026-00441',
      supplier: {
        supplierName: 'Al Fajr Transport Services',
        supplierTrn: '100667788990011',
        address: 'Sajaa Industrial Area',
        city: 'Sharjah',
        emirate: 'Sharjah',
      },
      items: [
        {
          tripNumber: 'TRIP-101',
          description: 'Inter-Emirate Coach Route: Sharjah to Dubai Media City',
          serviceDate: '2026-08-10',
          quantity: 20,
          ratePerUnit: 300,
          vatRatePct: 5,
        },
      ],
    });

    expect(invoice.statutoryDeclaration).toBe(MANDATORY_STATUTORY_DECLARATION);
    expect(invoice.subtotalNet).toBe(6000);
    expect(invoice.vatTotal).toBe(300);
    expect(invoice.grandTotalGross).toBe(6300);
    expect(invoice.status).toBe('ISSUED');
  });
});

describe('5. Automated Salik & Darb Toll Pass-Through', () => {
  it('matches toll gate crossing within time tolerance to active trip', () => {
    const baseTime = new Date('2026-08-15T10:00:00Z').getTime();

    const crossings: TollCrossingEvent[] = [
      {
        id: 'T-1',
        tollSystem: 'SALIK',
        gateName: 'Al Barsha',
        vehiclePlate: 'DXB-55443',
        crossingTimestamp: new Date(baseTime + 5 * 60 * 1000).toISOString(),
        tollAmountAed: 4.0,
      },
    ];

    const activeTrips: ShiftOrTripContext[] = [
      {
        id: 'TRIP-ST-001',
        type: 'STAFF_TRANSPORT',
        vehiclePlate: 'DXB-55443',
        driverName: 'Rashid Ali',
        customerName: 'Chalhoub Group',
        startTime: new Date(baseTime).toISOString(),
        endTime: new Date(baseTime + 60 * 60 * 1000).toISOString(),
        contractTollsIncluded: false, // Billable to customer
      },
    ];

    const summary = reconcileTollCrossings(crossings, activeTrips, 10);
    expect(summary.totalCrossings).toBe(1);
    expect(summary.matchedCount).toBe(1);
    expect(summary.billableToCustomerAed).toBe(4.0);
    expect(summary.items[0].reconciliationStatus).toBe('MATCHED_TO_TRIP');
  });
});

describe('6. Productized Scope 3 ESG Carbon Accounting', () => {
  it('calculates avoided emissions from shared staff transport modal shift', () => {
    const singleTrip = calculateTripScope3Carbon({
      tripId: 'TRIP-ESG-01',
      category: 'CATEGORY_7_EMPLOYEE_COMMUTE',
      date: '2026-08-15',
      origin: 'Dubai Marina',
      destination: 'DIFC',
      distanceKm: 25,
      passengerCount: 40,
      fuelType: 'DIESEL',
      vehicleCapacity: 50,
    });

    // 25 km * 40 passengers = 1,000 passenger-km
    // Baseline car: 1000 * 0.192 = 192 kg CO2e
    // Shared bus: 1000 * 0.038 = 38 kg CO2e
    // Avoided: 192 - 38 = 154 kg CO2e (80.2% reduction)
    expect(singleTrip.passengerKm).toBe(1000);
    expect(singleTrip.grossEmissionsKgCo2e).toBe(38);
    expect(singleTrip.baselineEmissionsKgCo2e).toBe(192);
    expect(singleTrip.avoidedEmissionsKgCo2e).toBe(154);
    expect(singleTrip.reductionPct).toBeGreaterThan(75);
  });

  it('generates cryptographic certificate with departmental breakdown', () => {
    const cert = generateScope3AuditCertificate('EMAAR Properties PJSC', 'AUG-2026', [
      {
        tripId: 'TRIP-01',
        category: 'CATEGORY_7_EMPLOYEE_COMMUTE',
        date: '2026-08-15',
        origin: 'Ajman',
        destination: 'Downtown Dubai',
        distanceKm: 40,
        passengerCount: 45,
        fuelType: 'DIESEL',
        vehicleCapacity: 50,
        departmentName: 'Facilities & Hospitality',
      },
    ]);

    expect(cert.certificateId).toMatch(/^ESG-CERT-2026-\d{6}$/);
    expect(cert.auditDigestHash).toBeDefined();
    expect(cert.totalAvoidedEmissionsTonnesCo2e).toBeGreaterThan(0);
    expect(cert.departmentalBreakdown).toHaveLength(1);
    expect(cert.departmentalBreakdown[0].department).toBe('Facilities & Hospitality');
  });
});
