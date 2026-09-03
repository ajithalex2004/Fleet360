'use client';

import React, { useState, useEffect } from 'react';
import {
  Repeat,
  Calendar,
  Clock,
  CheckCircle2,
  DollarSign,
  Sparkles,
  Layers,
  ChevronRight,
  ShieldCheck,
  CalendarDays,
} from 'lucide-react';
import {
  RecurringScheduleConfig,
  GeneratedScheduledTrip,
  RecurringPricingBreakdown,
  generateRecurringTripDates,
  calculateRecurringSchedulePricing,
  DayOfWeek,
  RecurrenceFrequency,
} from '@/lib/recurring-schedule-engine';

interface RecurringSchedulePickerProps {
  serviceType: string;
  singleTripFareAed?: number;
  onScheduleChange?: (data: {
    config: RecurringScheduleConfig;
    trips: GeneratedScheduledTrip[];
    pricing: RecurringPricingBreakdown;
  }) => void;
}

const ALL_DAYS: { key: DayOfWeek; label: string }[] = [
  { key: 'MON', label: 'Mon' },
  { key: 'TUE', label: 'Tue' },
  { key: 'WED', label: 'Wed' },
  { key: 'THU', label: 'Thu' },
  { key: 'FRI', label: 'Fri' },
  { key: 'SAT', label: 'Sat' },
  { key: 'SUN', label: 'Sun' },
];

export function RecurringSchedulePicker({
  serviceType,
  singleTripFareAed = 550,
  onScheduleChange,
}: RecurringSchedulePickerProps) {
  const [scheduleType, setScheduleType] = useState<'ONE_OFF' | 'RECURRING'>('RECURRING');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('WEEKLY');
  const [selectedDays, setSelectedDays] = useState<DayOfWeek[]>(['MON', 'WED', 'FRI']);
  const [timeSlot, setTimeSlot] = useState('06:30');
  const [startDate, setStartDate] = useState(
    new Date(Date.now() + 86400000).toISOString().split('T')[0]
  );
  const [occurrencesCount, setOccurrencesCount] = useState(24);
  const [standingDiscountPercent, setStandingDiscountPercent] = useState(10);

  const [generatedTrips, setGeneratedTrips] = useState<GeneratedScheduledTrip[]>([]);
  const [pricing, setPricing] = useState<RecurringPricingBreakdown | null>(null);

  // Recalculate schedule whenever inputs change
  useEffect(() => {
    const config: RecurringScheduleConfig = {
      scheduleType,
      frequency,
      daysOfWeek: selectedDays,
      timeSlot,
      startDate,
      endCondition: 'AFTER_OCCURRENCES',
      endDate: null,
      occurrencesCount,
      standingContractDiscountPercent: standingDiscountPercent,
    };

    const trips = generateRecurringTripDates(config, 20);
    const priceBreakdown = calculateRecurringSchedulePricing(
      singleTripFareAed,
      trips.length,
      standingDiscountPercent
    );

    setGeneratedTrips(trips);
    setPricing(priceBreakdown);

    if (onScheduleChange) {
      onScheduleChange({ config, trips, pricing: priceBreakdown });
    }
  }, [
    scheduleType,
    frequency,
    selectedDays,
    timeSlot,
    startDate,
    occurrencesCount,
    standingDiscountPercent,
    singleTripFareAed,
  ]);

  const toggleDay = (day: DayOfWeek) => {
    if (selectedDays.includes(day)) {
      if (selectedDays.length > 1) {
        setSelectedDays(selectedDays.filter((d) => d !== day));
      }
    } else {
      setSelectedDays([...selectedDays, day]);
    }
  };

  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Repeat className="w-4 h-4 text-orange-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Booking Recurrence & Standing Contract Engine
          </span>
        </div>
        <span className="text-[10px] bg-orange-500/10 text-orange-300 font-mono font-bold px-2 py-0.5 rounded-full border border-orange-500/20">
          Universal All-Domain
        </span>
      </div>

      {/* Schedule Type Switcher */}
      <div className="grid grid-cols-2 gap-2 bg-slate-950/80 p-1.5 rounded-xl border border-white/10">
        <button
          type="button"
          onClick={() => setScheduleType('ONE_OFF')}
          className={`py-2 rounded-lg text-xs font-bold transition-all ${
            scheduleType === 'ONE_OFF'
              ? 'bg-slate-800 text-white shadow'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          📦 Single Ad-Hoc Trip
        </button>
        <button
          type="button"
          onClick={() => setScheduleType('RECURRING')}
          className={`py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            scheduleType === 'RECURRING'
              ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Repeat className="w-3.5 h-3.5" /> 🔁 Recurring Standing Schedule
        </button>
      </div>

      {/* Recurrence Rule Controls (Shown when RECURRING is selected) */}
      {scheduleType === 'RECURRING' && (
        <div className="space-y-4">
          {/* Frequency & Time Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="text-slate-300 block mb-1 font-semibold">Recurrence Frequency</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
                className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-white focus:ring-1 focus:ring-orange-500"
              >
                <option value="WEEKLY">Weekly Standing Runs</option>
                <option value="DAILY">Daily (Mon - Fri)</option>
                <option value="BI_WEEKLY">Bi-Weekly (Every 2 Weeks)</option>
                <option value="MONTHLY">Monthly Standing Schedule</option>
                <option value="SCHOOL_TERM">Academic School Term</option>
              </select>
            </div>

            <div>
              <label className="text-slate-300 block mb-1 font-semibold">Departure / Dock Time</label>
              <input
                type="time"
                value={timeSlot}
                onChange={(e) => setTimeSlot(e.target.value)}
                className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-white font-mono"
              >
              </input>
            </div>

            <div>
              <label className="text-slate-300 block mb-1 font-semibold">Total Planned Runs</label>
              <select
                value={occurrencesCount}
                onChange={(e) => setOccurrencesCount(Number(e.target.value))}
                className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-white font-mono"
              >
                <option value="12">12 Runs (1 Month Standing)</option>
                <option value="24">24 Runs (2 Months Standing)</option>
                <option value="36">36 Runs (3 Months Standing)</option>
                <option value="48">48 Runs (4 Months Standing)</option>
              </select>
            </div>
          </div>

          {/* Days of Week Badges */}
          <div>
            <label className="text-xs text-slate-300 block mb-1.5 font-semibold">
              Active Schedule Days of Week:
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_DAYS.map((day) => {
                const isActive = selectedDays.includes(day.key);
                return (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => toggleDay(day.key)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                      isActive
                        ? 'bg-orange-600 border-orange-500 text-white shadow-md shadow-orange-600/20'
                        : 'bg-slate-950 border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Standing Contract Pricing & Volume Discount Banner */}
          {pricing && (
            <div className="bg-slate-950 border border-orange-500/30 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-orange-400" />
                  <span className="text-xs font-bold text-white">
                    Standing Contract Volume Tier
                  </span>
                </div>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-mono font-bold px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                  {pricing.discountPercent}% Volume Rebate Applied
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-slate-900/60 p-2 rounded-lg">
                  <span className="text-[10px] text-slate-400 block">Single Trip Base</span>
                  <span className="font-mono font-semibold text-slate-200">AED {pricing.singleTripFareAed}</span>
                </div>
                <div className="bg-slate-900/60 p-2 rounded-lg">
                  <span className="text-[10px] text-slate-400 block">Total Scheduled Trips</span>
                  <span className="font-mono font-semibold text-cyan-400">{pricing.totalOccurrences} Trips</span>
                </div>
                <div className="bg-slate-900/60 p-2 rounded-lg">
                  <span className="text-[10px] text-slate-400 block">Volume Discount</span>
                  <span className="font-mono font-semibold text-emerald-400">-AED {pricing.discountAmountAed}</span>
                </div>
                <div className="bg-slate-900/60 p-2 rounded-lg">
                  <span className="text-[10px] text-slate-400 block">Total Contract Value</span>
                  <span className="font-mono font-bold text-orange-400">AED {pricing.totalWithVatAed}</span>
                </div>
              </div>
            </div>
          )}

          {/* Interactive Calendar Preview */}
          <div className="bg-slate-950/60 border border-white/10 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300 flex items-center gap-1.5">
                <CalendarDays className="w-3.5 h-3.5 text-cyan-400" />
                Upcoming Concrete Trips Calendar Preview (Next 5 of {generatedTrips.length}):
              </span>
              <span className="text-[10px] text-slate-400 font-mono">24h Auto-Dispatch</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              {generatedTrips.slice(0, 5).map((trip) => (
                <div
                  key={trip.sequenceNo}
                  className="bg-slate-900 border border-white/10 rounded-xl p-2.5 space-y-1 text-center"
                >
                  <span className="text-[10px] text-orange-400 font-bold block">
                    Run #{trip.sequenceNo}
                  </span>
                  <strong className="text-white text-xs block">{trip.dayOfWeek.slice(0, 3)}</strong>
                  <span className="text-[10px] text-slate-400 block font-mono">{trip.formattedDate}</span>
                  <span className="text-[9px] bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/20 font-mono inline-block">
                    {trip.timeSlot}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
