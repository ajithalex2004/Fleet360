import { describe, it, expect } from 'vitest';
import { DriverDispatchService } from '@/lib/exchange/driver-dispatch-service';

describe('Fleet360 Exchange: Contracted Rate Card Auto-Pricing & Automated Driver Dispatch', () => {
  it('validates Contracted Rate Card auto-pricing matrix matching origin/destination corridors and vehicle capacity', () => {
    // 1. Rate Card Matrix setup
    const rateCardMatrix = [
      {
        id: 'rc-dxb-jafza-50',
        title: 'Dubai Metro to JAFZA Staff Corridor',
        originZone: 'Dubai',
        destinationZone: 'JAFZA',
        vehicleType: '50-Seat Bus',
        rateAmount: 650.0,
        currency: 'AED',
      },
      {
        id: 'rc-auh-mussafah-30',
        title: 'Abu Dhabi to Mussafah Shuttle',
        originZone: 'Abu Dhabi',
        destinationZone: 'Mussafah',
        vehicleType: '30-Seat Coaster',
        rateAmount: 480.0,
        currency: 'AED',
      },
    ];

    const matchRate = (origin: string, destination: string, vehicleType: string) => {
      const match = rateCardMatrix.find((rc) => {
        const originMatch = origin.toLowerCase().includes(rc.originZone.toLowerCase());
        const destMatch = destination.toLowerCase().includes(rc.destinationZone.toLowerCase());
        const vehicleMatch = vehicleType.toLowerCase().includes(rc.vehicleType.toLowerCase());
        return originMatch && destMatch && vehicleMatch;
      });

      if (!match) return { found: false, baseAmount: 0, vatAmount: 0, totalAmount: 0 };

      const baseAmount = match.rateAmount;
      const vatAmount = baseAmount * 0.05; // 5% UAE VAT
      const totalAmount = baseAmount + vatAmount;

      return {
        found: true,
        rateCardId: match.id,
        title: match.title,
        baseAmount,
        vatAmount,
        totalAmount,
      };
    };

    // Test DXB -> JAFZA corridor
    const resultDxb = matchRate('Dubai Investment Park', 'JAFZA South Gate', '50-Seat Bus');
    expect(resultDxb.found).toBe(true);
    expect(resultDxb.baseAmount).toBe(650.0);
    expect(resultDxb.vatAmount).toBe(32.5);
    expect(resultDxb.totalAmount).toBe(682.5);

    // Test AUH -> Mussafah corridor
    const resultAuh = matchRate('Abu Dhabi City Center', 'Mussafah Industrial Area', '30-Seat Coaster');
    expect(resultAuh.found).toBe(true);
    expect(resultAuh.totalAmount).toBe(504.0); // 480 + 24 VAT
  });

  it('validates automated WhatsApp / SMS driver link dispatch with customized template', async () => {
    const rawToken = '7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a';

    const dispatchResult = await DriverDispatchService.dispatchDriverLink({
      driverName: 'Muhammad Tariq',
      driverPhone: '+971 50 889 1234',
      vehiclePlate: 'Dubai K 77192',
      pickupLocation: 'Deira City Centre Gate 3',
      pickupTime: '06:15 AM',
      dropoffLocation: 'JAFZA Freezone Phase 2',
      rawToken,
      channel: 'WHATSAPP',
    });

    expect(dispatchResult.success).toBe(true);
    expect(dispatchResult.channel).toBe('WHATSAPP');
    expect(dispatchResult.recipient).toBe('+971508891234');
    expect(dispatchResult.dispatchUrl).toContain(`/track/partner-trip/${rawToken}`);
    expect(dispatchResult.messageId).toBeDefined();
  });
});
