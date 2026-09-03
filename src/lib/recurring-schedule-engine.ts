export type RecurrenceFrequency =
  | 'ONE_OFF'
  | 'DAILY'
  | 'WEEKLY'
  | 'BI_WEEKLY'
  | 'MONTHLY'
  | 'SCHOOL_TERM';

export type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface RecurringScheduleConfig {
  scheduleType: 'ONE_OFF' | 'RECURRING';
  frequency: RecurrenceFrequency;
  daysOfWeek: DayOfWeek[];
  timeSlot: string;
  startDate: string;
  endCondition: 'NEVER' | 'UNTIL_DATE' | 'AFTER_OCCURRENCES';
  endDate: string | null;
  occurrencesCount: number;
  standingContractDiscountPercent: number;
}

export interface GeneratedScheduledTrip {
  sequenceNo: number;
  tripDateIso: string;
  formattedDate: string;
  dayOfWeek: string;
  timeSlot: string;
  status: 'SCHEDULED' | 'DISPATCHED' | 'COMPLETED';
}

export interface RecurringPricingBreakdown {
  singleTripFareAed: number;
  totalOccurrences: number;
  grossContractValueAed: number;
  discountPercent: number;
  discountAmountAed: number;
  netContractValueAed: number;
  vatAmountAed: number;
  totalWithVatAed: number;
  monthlyAverageAed: number;
}

const DAY_MAP: Record<DayOfWeek, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Generates concrete ISO dates matching the recurrence rules
 */
export function generateRecurringTripDates(
  config: RecurringScheduleConfig,
  maxGenerated: number = 30
): GeneratedScheduledTrip[] {
  if (config.scheduleType === 'ONE_OFF') {
    const start = new Date(config.startDate || new Date());
    return [
      {
        sequenceNo: 1,
        tripDateIso: start.toISOString().split('T')[0],
        formattedDate: start.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
        dayOfWeek: DAY_NAMES[start.getDay()],
        timeSlot: config.timeSlot || '08:00',
        status: 'SCHEDULED',
      },
    ];
  }

  const generated: GeneratedScheduledTrip[] = [];
  const start = new Date(config.startDate || new Date());
  const endDate = config.endDate ? new Date(config.endDate) : null;
  const targetOccurrences =
    config.endCondition === 'AFTER_OCCURRENCES'
      ? Math.min(config.occurrencesCount || 10, maxGenerated)
      : maxGenerated;

  const activeDayNumbers = (config.daysOfWeek || ['MON', 'WED', 'FRI']).map((d) => DAY_MAP[d]);

  const current = new Date(start);
  let count = 0;

  // Search ahead up to 180 days
  for (let dayOffset = 0; dayOffset < 180 && count < targetOccurrences; dayOffset++) {
    const dayOfWeek = current.getDay();

    if (endDate && current > endDate) {
      break;
    }

    let isMatch = false;

    if (config.frequency === 'DAILY') {
      // Weekday daily or all daily
      isMatch = activeDayNumbers.includes(dayOfWeek);
    } else if (config.frequency === 'WEEKLY') {
      isMatch = activeDayNumbers.includes(dayOfWeek);
    } else if (config.frequency === 'BI_WEEKLY') {
      const weekNumber = Math.floor(dayOffset / 7);
      isMatch = weekNumber % 2 === 0 && activeDayNumbers.includes(dayOfWeek);
    } else if (config.frequency === 'MONTHLY') {
      isMatch = current.getDate() === start.getDate();
    } else if (config.frequency === 'SCHOOL_TERM') {
      // Mon - Fri school days
      isMatch = dayOfWeek >= 1 && dayOfWeek <= 5;
    }

    if (isMatch) {
      count++;
      generated.push({
        sequenceNo: count,
        tripDateIso: current.toISOString().split('T')[0],
        formattedDate: current.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
        dayOfWeek: DAY_NAMES[dayOfWeek],
        timeSlot: config.timeSlot || '07:30',
        status: 'SCHEDULED',
      });
    }

    current.setDate(current.getDate() + 1);
  }

  return generated;
}

/**
 * Calculates volume discounts and billing totals for standing contracts
 */
export function calculateRecurringSchedulePricing(
  singleTripFareAed: number,
  totalOccurrences: number,
  customDiscountPercent?: number
): RecurringPricingBreakdown {
  let discountPercent = customDiscountPercent ?? 0;

  // Automated standing volume discount tier
  if (customDiscountPercent === undefined) {
    if (totalOccurrences >= 30) {
      discountPercent = 15; // 15% discount for 30+ trips
    } else if (totalOccurrences >= 10) {
      discountPercent = 10; // 10% discount for 10+ trips
    } else if (totalOccurrences >= 5) {
      discountPercent = 5; // 5% discount for 5+ trips
    }
  }

  const grossContractValueAed = Math.round(singleTripFareAed * totalOccurrences);
  const discountAmountAed = Math.round(grossContractValueAed * (discountPercent / 100));
  const netContractValueAed = grossContractValueAed - discountAmountAed;
  const vatAmountAed = Math.round(netContractValueAed * 0.05 * 100) / 100;
  const totalWithVatAed = Math.round((netContractValueAed + vatAmountAed) * 100) / 100;
  const monthlyAverageAed = Math.round((totalWithVatAed / Math.max(1, totalOccurrences / 20)) * 100) / 100;

  return {
    singleTripFareAed,
    totalOccurrences,
    grossContractValueAed,
    discountPercent,
    discountAmountAed,
    netContractValueAed,
    vatAmountAed,
    totalWithVatAed,
    monthlyAverageAed,
  };
}
