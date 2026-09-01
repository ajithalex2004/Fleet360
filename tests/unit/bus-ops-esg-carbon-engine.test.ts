import { describe, it, expect } from 'vitest';
import {
  computeTripCarbon,
  generateDepartmentalCarbonMatrix,
  type EsgTripInput,
} from '@/lib/bus-ops/esg-carbon-engine';

describe('ESG Carbon Footprint & Scope-3 GHG Attribution Engine', () => {
  it('correctly calculates single trip carbon emissions and avoided car baseline', () => {
    // 50 km trip in a 30-seat diesel coaster (822 g/km) with 25 passengers
    const result = computeTripCarbon(50, 'DIESEL_COASTER_30', 25);

    // Total CO2 = 50 * 822 = 41,100 g = 41.10 kg
    expect(result.totalCo2Kg).toBe(41.1);
    // Total Passenger-km = 50 * 25 = 1,250 p-km
    expect(result.totalPassengerKm).toBe(1250);
    // CO2 per p-km = 41,100 / 1250 = 32.88 -> 32.9 g/p-km
    expect(result.co2PerPassengerKm).toBe(32.9);
    // Baseline car CO2 = 1250 * 171 g = 213,750 g = 213.75 kg
    expect(result.baselinePrivateCarCo2Kg).toBe(213.75);
    // Avoided CO2 = 213.75 - 41.10 = 172.65 kg saved!
    expect(result.avoidedCo2Kg).toBe(172.65);
  });

  it('prorates carbon emissions across departments based on passenger manifest', () => {
    const mockTrips: EsgTripInput[] = [
      {
        id: 'trip-1',
        distanceKm: 40,
        vehicleType: 'DIESEL_COASTER_30', // 40 * 822 = 32.88 kg CO2
        departureTime: '2026-08-10T07:00:00.000Z',
        passengers: [
          // 20 passengers total: 10 Production, 6 Logistics, 4 QA
          ...Array.from({ length: 10 }, (_, i) => ({
            staffMemberId: `staff-p-${i}`,
            department: 'Production',
            status: 'BOARDED',
          })),
          ...Array.from({ length: 6 }, (_, i) => ({
            staffMemberId: `staff-l-${i}`,
            department: 'Logistics',
            status: 'BOARDED',
          })),
          ...Array.from({ length: 4 }, (_, i) => ({
            staffMemberId: `staff-q-${i}`,
            department: 'Quality Assurance',
            status: 'BOARDED',
          })),
        ],
      },
    ];

    const summary = generateDepartmentalCarbonMatrix(mockTrips, '2026-08');

    expect(summary.totalTrips).toBe(1);
    expect(summary.totalDistanceKm).toBe(40);
    expect(summary.totalPassengersTransported).toBe(20);
    expect(summary.totalFleetCo2Kg).toBe(32.88);

    // Baseline 20 * 40 * 171 = 136.80 kg
    expect(summary.totalBaselineCarCo2Kg).toBe(136.8);
    expect(summary.totalCarbonSavedKg).toBe(103.92);
    expect(summary.overallSavingsPercentage).toBe(76.0); // ~76% emissions saved vs driving solo!

    expect(summary.departments).toHaveLength(3);

    const prod = summary.departments.find((d) => d.department === 'Production')!;
    expect(prod.totalPassengers).toBe(10);
    expect(prod.allocatedCo2Kg).toBe(16.44); // 50% of 32.88 kg
    expect(prod.carbonSavedKg).toBe(51.96);

    const log = summary.departments.find((d) => d.department === 'Logistics')!;
    expect(log.totalPassengers).toBe(6);
    expect(log.allocatedCo2Kg).toBe(9.86); // 30% of 32.88 kg

    const qa = summary.departments.find((d) => d.department === 'Quality Assurance')!;
    expect(qa.totalPassengers).toBe(4);
    expect(qa.allocatedCo2Kg).toBe(6.58); // 20% of 32.88 kg
  });
});
