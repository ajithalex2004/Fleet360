import { describe, it, expect } from 'vitest';
import {
  LEAD_TIME_RULES_HOURS,
  STANDARD_DEPOTS,
  CATEGORY_SAMPLE_MODELS,
} from '@/app/api/fleet/availability/route';

describe('Real-Time Fleet Availability & Inventory Engine', () => {
  it('enforces strict service lead-time requirements for dispatch preparation', () => {
    expect(LEAD_TIME_RULES_HOURS['EXECUTIVE']).toBe(2);
    expect(LEAD_TIME_RULES_HOURS['LOGISTICS']).toBe(4);
    expect(LEAD_TIME_RULES_HOURS['STAFF_TRANSPORT']).toBe(12);
    expect(LEAD_TIME_RULES_HOURS['SCHOOL_BUS']).toBe(12);
    expect(LEAD_TIME_RULES_HOURS['RENTAL']).toBe(2);
    expect(LEAD_TIME_RULES_HOURS['LEASING']).toBe(24);
  });

  it('maintains active standard UAE depots across Dubai, Abu Dhabi, and Sharjah', () => {
    expect(STANDARD_DEPOTS.length).toBeGreaterThanOrEqual(4);

    const dxbDepot = STANDARD_DEPOTS.find((d) => d.id === 'DXB_HUB');
    expect(dxbDepot).toBeDefined();
    expect(dxbDepot?.city).toBe('Dubai');

    const auhDepot = STANDARD_DEPOTS.find((d) => d.id === 'AUH_YAS');
    expect(auhDepot).toBeDefined();
    expect(auhDepot?.city).toBe('Abu Dhabi');

    const dsoDepot = STANDARD_DEPOTS.find((d) => d.id === 'DSO_CENTRAL');
    expect(dsoDepot).toBeDefined();
  });

  it('provides verified sample models across all operational vehicle categories', () => {
    expect(CATEGORY_SAMPLE_MODELS['Luxury Sedan']).toContain('Mercedes-Benz S-Class');
    expect(CATEGORY_SAMPLE_MODELS['Executive Van (MPV)']).toContain('Mercedes-Benz V-Class');
    expect(CATEGORY_SAMPLE_MODELS['3-Ton Reefer (Cold-Chain)']).toContain('Chiller Truck');
    expect(CATEGORY_SAMPLE_MODELS['30-Seat Coaster']).toContain('Toyota Coaster');
    expect(CATEGORY_SAMPLE_MODELS['Compact Sedan']).toContain('Toyota Corolla');
  });
});
