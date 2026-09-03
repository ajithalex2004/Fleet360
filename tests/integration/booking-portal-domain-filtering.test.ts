import { describe, it, expect } from 'vitest';
import { SERVICE_MODULE_MAP } from '@/app/booking-portal/page';

describe('Booking Portal Dynamic Domain Filtering', () => {
  const ALL_SERVICE_CARDS = [
    { type: 'RENTAL', title: 'Rent-a-Car' },
    { type: 'LEASING', title: 'Vehicle Leasing' },
    { type: 'STAFF_TRANSPORT', title: 'Staff Transport' },
    { type: 'EXECUTIVE', title: 'Executive Vehicle' },
    { type: 'LOGISTICS', title: 'Logistics Trip' },
    { type: 'SCHOOL_BUS', title: 'School Bus' },
  ];

  function filterCardsForTenant(enabledModules: string[] | undefined) {
    if (!enabledModules || enabledModules.length === 0) {
      return ALL_SERVICE_CARDS;
    }
    return ALL_SERVICE_CARDS.filter((card) => {
      const requiredModule = SERVICE_MODULE_MAP[card.type];
      return !requiredModule || enabledModules.includes(requiredModule);
    });
  }

  it('maps all 6 booking service types to correct system module keys', () => {
    expect(SERVICE_MODULE_MAP['RENTAL']).toBe('rental');
    expect(SERVICE_MODULE_MAP['LEASING']).toBe('leasing');
    expect(SERVICE_MODULE_MAP['STAFF_TRANSPORT']).toBe('bus-ops');
    expect(SERVICE_MODULE_MAP['EXECUTIVE']).toBe('dispatch');
    expect(SERVICE_MODULE_MAP['LOGISTICS']).toBe('logistics');
    expect(SERVICE_MODULE_MAP['SCHOOL_BUS']).toBe('school-bus');
  });

  it('filters strictly for a dedicated School Bus tenant', () => {
    const visibleCards = filterCardsForTenant(['school-bus']);
    expect(visibleCards.map((c) => c.type)).toEqual(['SCHOOL_BUS']);
    expect(visibleCards.length).toBe(1);
  });

  it('filters strictly for a Car Rental & Leasing tenant', () => {
    const visibleCards = filterCardsForTenant(['rental', 'leasing']);
    expect(visibleCards.map((c) => c.type)).toEqual(['RENTAL', 'LEASING']);
    expect(visibleCards.length).toBe(2);
  });

  it('filters strictly for a Passenger Transport & Shuttle operator', () => {
    const visibleCards = filterCardsForTenant(['bus-ops', 'school-bus']);
    expect(visibleCards.map((c) => c.type)).toEqual(['STAFF_TRANSPORT', 'SCHOOL_BUS']);
    expect(visibleCards.length).toBe(2);
  });

  it('filters strictly for a Freight & Logistics carrier', () => {
    const visibleCards = filterCardsForTenant(['logistics', 'dispatch']);
    expect(visibleCards.map((c) => c.type)).toEqual(['EXECUTIVE', 'LOGISTICS']);
    expect(visibleCards.length).toBe(2);
  });

  it('provides all 6 services for full enterprise tenant or super-admin fallback', () => {
    const unrestrictedCards = filterCardsForTenant([]);
    expect(unrestrictedCards.length).toBe(6);

    const undefinedModulesCards = filterCardsForTenant(undefined);
    expect(undefinedModulesCards.length).toBe(6);
  });
});
