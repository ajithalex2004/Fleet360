import { describe, it, expect } from 'vitest';
import {
  generateRecurringTripDates,
  calculateRecurringSchedulePricing,
  RecurringScheduleConfig,
} from '@/lib/recurring-schedule-engine';

describe('Recurring Schedule & Standing Contract Engine', () => {
  it('generates a single trip date when scheduleType is ONE_OFF', () => {
    const config: RecurringScheduleConfig = {
      scheduleType: 'ONE_OFF',
      frequency: 'ONE_OFF',
      daysOfWeek: ['MON'],
      timeSlot: '09:00',
      startDate: '2026-09-08',
      endCondition: 'NEVER',
      endDate: null,
      occurrencesCount: 1,
      standingContractDiscountPercent: 0,
    };

    const trips = generateRecurringTripDates(config);

    expect(trips.length).toBe(1);
    expect(trips[0].sequenceNo).toBe(1);
    expect(trips[0].timeSlot).toBe('09:00');
  });

  it('generates accurate weekly recurrence dates on Mon, Wed, and Fri', () => {
    const config: RecurringScheduleConfig = {
      scheduleType: 'RECURRING',
      frequency: 'WEEKLY',
      daysOfWeek: ['MON', 'WED', 'FRI'],
      timeSlot: '06:30',
      startDate: '2026-09-01',
      endCondition: 'AFTER_OCCURRENCES',
      endDate: null,
      occurrencesCount: 12,
      standingContractDiscountPercent: 10,
    };

    const trips = generateRecurringTripDates(config, 12);

    expect(trips.length).toBe(12);
    // Verify all generated days are either Monday, Wednesday, or Friday
    for (const trip of trips) {
      expect(['Monday', 'Wednesday', 'Friday']).toContain(trip.dayOfWeek);
      expect(trip.timeSlot).toBe('06:30');
      expect(trip.status).toBe('SCHEDULED');
    }
  });

  it('calculates standing contract volume pricing with automated 10% rebate and 5% UAE VAT', () => {
    const singleTrip = 500;
    const totalRuns = 20;

    const pricing = calculateRecurringSchedulePricing(singleTrip, totalRuns);

    expect(pricing.singleTripFareAed).toBe(500);
    expect(pricing.totalOccurrences).toBe(20);
    expect(pricing.grossContractValueAed).toBe(10000); // 500 * 20
    expect(pricing.discountPercent).toBe(10); // 10% volume rebate tier for 20 trips
    expect(pricing.discountAmountAed).toBe(1000);
    expect(pricing.netContractValueAed).toBe(9000);
    expect(pricing.vatAmountAed).toBe(450); // 5% VAT on 9000
    expect(pricing.totalWithVatAed).toBe(9450);
  });
});
