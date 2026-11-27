import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { calculateInstantQuotation } from '@/lib/pricing/instant-quotation';

describe('Booking Portal Domain Separation & Global Field Standards', () => {
  const portalSrc = readFileSync('src/app/(app)/booking-portal/new/page.tsx', 'utf8');

  it('removes unconditional hardcoded Executive cards and fake VIP summary values', () => {
    expect(portalSrc).not.toContain('Luxury Vehicle Selection');
    expect(portalSrc).not.toContain('13:00 – 17:30');
    expect(portalSrc).not.toContain('Confirmed VIP');
    expect(portalSrc).not.toContain('MERCEDES_S_CLASS');
    expect(portalSrc).not.toContain('Schedule Reference');
  });

  it('removes post-dispatch execution widgets from booking intake', () => {
    expect(portalSrc).not.toContain('ColdChainTelemetryGraph');
    expect(portalSrc).not.toContain('DigitalEbolScanner');
    expect(portalSrc).not.toContain('DriverHandoverEpod');
  });

  it('provides service-specific primary selectors for all 6 domains', () => {
    expect(portalSrc).toContain('Rental Vehicle Class Selection');
    expect(portalSrc).toContain('Lease Program Structure');
    expect(portalSrc).toContain('Staff Shuttle & Bus Service Selection');
    expect(portalSrc).toContain('Executive Chauffeur Class Selection');
    expect(portalSrc).toContain('Commercial Fleet & Equipment Selection');
    expect(portalSrc).toContain('School Transport Service Plan');
  });

  it('gates Digital KYC strictly to RENTAL and removes Corporate Cost Center from SCHOOL_BUS', () => {
    expect(portalSrc).toContain("{serviceType === 'RENTAL' && (\n                  <DigitalKycUaePass");
    expect(portalSrc).toContain('School Transport Fee & Parent Billing Plan');
    expect(portalSrc).toContain('RTA-Compliant Student Transport');
  });

  it('supports Corporate vs. Personal (B2C) Rent-a-Car toggle hiding Cost Center for personal bookings', () => {
    expect(portalSrc).toContain('Personal / Walk-in (B2C)');
    expect(portalSrc).toContain('Corporate Account (B2B)');
    expect(portalSrc).toContain("(serviceType === 'RENTAL' && !isPersonalRental)");
    expect(portalSrc).toContain('Credit Card at Counter (Security Deposit Required)');
  });

  it('wires cloud-storage document upload dropzones on Logistics and School Bus forms', () => {
    expect(portalSrc).toContain('<BookingDocumentDropzone');
    expect(portalSrc).toContain('domain="logistics"');
    expect(portalSrc).toContain('domain="school-bus"');
    for (const slot of ['commercial-invoice', 'packing-list', 'msds', 'customs-permit', 'student-photo', 'parent-emirates-id', 'medical-certificate']) {
      expect(portalSrc).toContain(`docType: '${slot}'`);
    }
  });

  it('gates advanced Logistics planning widgets behind opt-in toggles', () => {
    expect(portalSrc).toContain("serviceType === 'LOGISTICS' && !!form.multiStopRequired");
    expect(portalSrc).toContain("serviceType === 'LOGISTICS' && !!form.recurringFreight");
    expect(portalSrc).toContain("serviceType === 'LOGISTICS' && !!form.bulkManifestUpload");
  });

  it('includes globally benchmarked required fields for every domain', () => {
    // RAC (Hertz / Sixt / UAE RTA)
    for (const key of ['driverDob', 'licenseCountry', 'insurancePackage', 'mileagePlan', 'crossBorderPermit']) {
      expect(portalSrc).toContain(`key: '${key}'`);
    }
    // Leasing (Ayvens / Arval / Element)
    for (const key of ['customerType', 'jobTitle', 'annualMileage', 'deliveryEmirate', 'tyresIncluded', 'replacementVehicleIncluded']) {
      expect(portalSrc).toContain(`key: '${key}'`);
    }
    // Staff Transport (MoveInSync / Zeelo / Liftango)
    for (const key of ['commuteDirection', 'passType', 'preferredStopLandmark', 'emergencyContact']) {
      expect(portalSrc).toContain(`key: '${key}'`);
    }
    // Executive (Blacklane / Carey / Wheely)
    for (const key of ['bookingFor', 'luggageCount', 'meetAndGreet', 'signboardName', 'charterHours']) {
      expect(portalSrc).toContain(`key: '${key}'`);
    }
    // Logistics (Freightos / DHL / Uber Freight)
    for (const key of ['consigneeCompany', 'consigneeContact', 'packagingType', 'stackable', 'liftgateRequired', 'incoterms']) {
      expect(portalSrc).toContain(`key: '${key}'`);
    }
    // School Bus (STS / Emirates Transport / RTA)
    for (const key of ['parentEmiratesId', 'studentDob', 'studentGender', 'academicTerm', 'makaniNumber', 'authorizedReceiverName', 'busSafetyCodeAccepted']) {
      expect(portalSrc).toContain(`key: '${key}'`);
    }
  });

  it('computes accurate domain-specific quotations for Rental days, Staff Shuttle Pass, School Bus plans, and Leasing', () => {
    // 4-day Mid-Size Rental + Super CDW (45 * 4 = 180)
    const rac = calculateInstantQuotation({
      serviceType: 'RENTAL',
      vehicleCategory: 'Mid-Size',
      rentalDays: 4,
      addOnsAed: 180,
    });
    expect(rac.baseFareAed).toBe(560);
    expect(rac.subtotalAed).toBe(740);
    expect(rac.totalFareAed).toBeCloseTo(777, 2);

    // Individual Staff Commute Pass (eligible for routine auto-approval <= AED 300)
    const staffPass = calculateInstantQuotation({
      serviceType: 'STAFF_TRANSPORT',
      vehicleCategory: 'Scheduled Shuttle Pass',
    });
    expect(staffPass.baseFareAed).toBe(200);
    expect(staffPass.totalFareAed).toBe(210);

    // School Bus One-Way plan
    const schoolOneWay = calculateInstantQuotation({
      serviceType: 'SCHOOL_BUS',
      vehicleCategory: 'Morning Pickup Only',
    });
    expect(schoolOneWay.baseFareAed).toBe(280);
    expect(schoolOneWay.totalFareAed).toBe(294);

    // Leasing 5 Mid-Size Sedans
    const lease = calculateInstantQuotation({
      serviceType: 'LEASING',
      vehicleCategory: 'Mid-Size Sedan',
      quantity: 5,
    });
    expect(lease.baseFareAed).toBe(10500);
  });
});
