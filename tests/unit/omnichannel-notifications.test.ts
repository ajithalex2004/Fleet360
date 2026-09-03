import { describe, it, expect } from 'vitest';
import {
  buildWhatsAppNotification,
  buildSmsNotification,
  PASSENGER_QUICK_CHIPS,
  DRIVER_QUICK_CHIPS,
} from '@/lib/omnichannel-communication';

describe('Omnichannel Notifications & Live Passenger Communication Engine', () => {
  it('builds interactive WhatsApp Business template payloads with action buttons', () => {
    const waAssigned = buildWhatsAppNotification(
      'DRIVER_ASSIGNED',
      {
        bookingRef: 'FLT-DXB-9842',
        requestorName: 'Sarah Jenkins',
        serviceType: 'EXECUTIVE',
        vehicleModel: 'Mercedes-Benz S-Class',
        vehiclePlate: 'DXB K 8892',
        driverName: 'Rashid Khan',
        driverPhone: '+971509988776',
        pickupLocation: 'DXB Airport Terminal 3',
        totalFareAed: 350,
      },
      '+971501234567'
    );

    expect(waAssigned.header).toContain('FLT-DXB-9842');
    expect(waAssigned.body).toContain('Rashid Khan');
    expect(waAssigned.body).toContain('Mercedes-Benz S-Class');
    expect(waAssigned.body).toContain('DXB K 8892');
    expect(waAssigned.actionButtons.length).toBe(2);
    expect(waAssigned.actionButtons.some((b) => b.label === '📍 View Live Map')).toBe(true);
    expect(waAssigned.actionButtons.some((b) => b.label === '📞 Call Chauffeur')).toBe(true);
  });

  it('generates concise cellular SMS notifications with short tracking links', () => {
    const sms = buildSmsNotification(
      'DRIVER_ARRIVED',
      {
        bookingRef: 'FLT-DXB-9842',
        requestorName: 'Sarah',
        serviceType: 'EXECUTIVE',
        vehiclePlate: 'DXB 8892',
        pickupLocation: 'Terminal 3 Gate 4',
      },
      '+971501234567'
    );

    expect(sms.recipientPhone).toBe('+971501234567');
    expect(sms.messageText).toContain('Terminal 3 Gate 4');
    expect(sms.messageText).toContain('https://flt.ly/t/FLT-DXB-9842');
  });

  it('provides verified quick status chips for passenger and chauffeur messaging', () => {
    expect(PASSENGER_QUICK_CHIPS.length).toBeGreaterThanOrEqual(4);
    expect(PASSENGER_QUICK_CHIPS.some((c) => c.includes('Terminal 3'))).toBe(true);
    expect(PASSENGER_QUICK_CHIPS.some((c) => c.includes('delayed'))).toBe(true);

    expect(DRIVER_QUICK_CHIPS.length).toBeGreaterThanOrEqual(3);
    expect(DRIVER_QUICK_CHIPS.some((c) => c.includes('Arrived'))).toBe(true);
  });
});
