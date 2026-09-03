export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  RecurringScheduleConfig,
  generateRecurringTripDates,
  calculateRecurringSchedulePricing,
} from '@/lib/recurring-schedule-engine';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const config: RecurringScheduleConfig = body?.config || {
      scheduleType: 'RECURRING',
      frequency: 'WEEKLY',
      daysOfWeek: ['MON', 'WED', 'FRI'],
      timeSlot: '06:30',
      startDate: new Date().toISOString().split('T')[0],
      endCondition: 'AFTER_OCCURRENCES',
      endDate: null,
      occurrencesCount: 24,
      standingContractDiscountPercent: 10,
    };

    const singleTripFareAed = Number(body?.singleTripFareAed || 550);
    const trips = generateRecurringTripDates(config);
    const pricing = calculateRecurringSchedulePricing(
      singleTripFareAed,
      trips.length,
      config.standingContractDiscountPercent
    );

    return NextResponse.json({
      success: true,
      scheduleNo: `SCH-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      config,
      trips,
      totalTripsGenerated: trips.length,
      pricing,
    });
  } catch (err) {
    console.error('[api/logistics/recurring-schedules POST]', err);
    return NextResponse.json({ error: 'Failed to process recurring schedule' }, { status: 500 });
  }
}
