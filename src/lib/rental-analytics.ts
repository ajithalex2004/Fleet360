/**
 * RAC Analytics — KPIs that fleet operators watch every morning.
 *
 * Pure functions. The caller fetches the raw data (bookings, vehicles,
 * agreements, invoices, damage claims) and passes it in. This keeps
 * the engine testable and reusable across server-side dashboards,
 * scheduled-report generators, and AI agents.
 *
 * The KPI we lead with is RevPAC (Revenue Per Available Car/day) —
 * the single most-watched RAC metric. Industry benchmarks for UAE
 * mid-market: AED 200–300/day. Best-in-class luxury operators: AED
 * 350–500/day.
 */

export interface AnalyticsBooking {
  id: string;
  vehicleCategory?: string | null;
  pickupDate: Date;
  dropoffDate: Date;
  totalDays?: number | null;
  totalAmount?: number | null;
  channel?: string | null;
  status?: string | null;
}

export interface AnalyticsVehicle {
  id: string;
  category?: string | null;
  status?: string | null;
}

export interface AnalyticsInvoice {
  id: string;
  customerId?: string | null;
  invoiceDate: Date;
  totalAmount: number;
  paidAmount?: number;
  currency?: string | null;
}

export interface AnalyticsDamageClaim {
  id: string;
  bookingId?: string | null;
  estimatedCost?: number | null;
  actualCost?: number | null;
  status?: string | null;
  billedToCustomer?: boolean | null;
}

export interface AnalyticsInput {
  periodFrom: Date;
  periodTo: Date;
  bookings: AnalyticsBooking[];
  vehicles: AnalyticsVehicle[];
  invoices?: AnalyticsInvoice[];
  damageClaims?: AnalyticsDamageClaim[];
}

export interface CategoryKpis {
  category: string;
  fleetSize: number;
  rentedCarDays: number;
  availableCarDays: number;
  utilizationPct: number;
  totalRevenue: number;
  revPAC: number;          // Revenue Per Available Car (per day)
  averageDailyRate: number; // ADR — total revenue / rented car-days
  bookingCount: number;
}

export interface ChannelKpis {
  channel: string;
  bookingCount: number;
  revenue: number;
  revenuePctOfTotal: number;
  averageLengthOfRental: number;
}

export interface AnalyticsResult {
  periodFrom: string;
  periodTo: string;
  daysInPeriod: number;

  // Headline KPIs
  fleetSize: number;
  totalBookings: number;
  totalRevenue: number;
  totalRentedCarDays: number;
  totalAvailableCarDays: number;
  fleetUtilizationPct: number;
  revPAC: number;
  averageDailyRate: number;
  averageLengthOfRental: number;

  // Booking funnel
  pendingBookings: number;
  confirmedBookings: number;
  activeBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  conversionPct: number;       // confirmed+active+completed / total non-cancelled

  // Damage recovery
  damageClaimsCount: number;
  damageBilledTotal: number;
  damageRecoveredTotal: number;
  damageRecoveryRatePct: number;

  // Breakdowns
  byCategory: CategoryKpis[];
  byChannel: ChannelKpis[];

  // Snapshot
  snapshotAt: string;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function clampToPeriod(b: AnalyticsBooking, from: Date, to: Date): { effFrom: Date; effTo: Date; days: number } {
  const effFrom = b.pickupDate < from ? from : b.pickupDate;
  const effTo = b.dropoffDate > to ? to : b.dropoffDate;
  if (effTo <= effFrom) return { effFrom, effTo, days: 0 };
  const days = Math.max(0, Math.ceil((effTo.getTime() - effFrom.getTime()) / 86400000));
  return { effFrom, effTo, days };
}

function isRevenueBooking(b: AnalyticsBooking): boolean {
  // CONFIRMED, ACTIVE, COMPLETED count as revenue. PENDING and CANCELLED don't.
  return ['CONFIRMED', 'ACTIVE', 'COMPLETED'].includes(b.status ?? '');
}

function round(n: number, dp = 2): number {
  const m = Math.pow(10, dp);
  return Math.round(n * m) / m;
}

/* ── Main engine ─────────────────────────────────────────────────────────── */

export function computeRentalAnalytics(input: AnalyticsInput): AnalyticsResult {
  const { periodFrom, periodTo, bookings, vehicles } = input;
  const invoices = input.invoices ?? [];
  const damages = input.damageClaims ?? [];

  const daysInPeriod = Math.max(1, Math.ceil((periodTo.getTime() - periodFrom.getTime()) / 86400000));
  const fleetSize = vehicles.filter(v => v.status !== 'INACTIVE' && v.status !== 'SOLD').length;

  // Booking-level totals (only revenue-status bookings count for utilization + revenue)
  const revBookings = bookings.filter(isRevenueBooking);
  const allNonCancelled = bookings.filter(b => b.status !== 'CANCELLED');

  let totalRentedCarDays = 0;
  let totalRevenue = 0;
  let lorSum = 0;
  let lorCount = 0;

  // Per-category and per-channel accumulators
  const catMap = new Map<string, { fleetSize: number; rentedCarDays: number; revenue: number; bookingCount: number }>();
  const chanMap = new Map<string, { bookingCount: number; revenue: number; lorSum: number }>();

  // Pre-fill category map from fleet so categories with 0 bookings still show
  for (const v of vehicles) {
    if (v.status === 'INACTIVE' || v.status === 'SOLD') continue;
    const cat = (v.category ?? 'UNCATEGORIZED').toString();
    if (!catMap.has(cat)) catMap.set(cat, { fleetSize: 0, rentedCarDays: 0, revenue: 0, bookingCount: 0 });
    catMap.get(cat)!.fleetSize += 1;
  }

  for (const b of revBookings) {
    const { days } = clampToPeriod(b, periodFrom, periodTo);
    if (days <= 0) continue;
    const revenue = Number(b.totalAmount ?? 0);
    totalRentedCarDays += days;
    totalRevenue += revenue;
    if (b.totalDays && b.totalDays > 0) {
      lorSum += b.totalDays;
      lorCount += 1;
    }

    const cat = (b.vehicleCategory ?? 'UNCATEGORIZED').toString();
    if (!catMap.has(cat)) catMap.set(cat, { fleetSize: 0, rentedCarDays: 0, revenue: 0, bookingCount: 0 });
    const ce = catMap.get(cat)!;
    ce.rentedCarDays += days;
    ce.revenue += revenue;
    ce.bookingCount += 1;

    const chan = (b.channel ?? 'UNKNOWN').toString();
    if (!chanMap.has(chan)) chanMap.set(chan, { bookingCount: 0, revenue: 0, lorSum: 0 });
    const ch = chanMap.get(chan)!;
    ch.bookingCount += 1;
    ch.revenue += revenue;
    ch.lorSum += b.totalDays ?? days;
  }

  const totalAvailableCarDays = fleetSize * daysInPeriod;

  // Booking funnel
  const counts = (status: string) => bookings.filter(b => b.status === status).length;
  const pending = counts('PENDING');
  const confirmed = counts('CONFIRMED');
  const active = counts('ACTIVE');
  const completed = counts('COMPLETED');
  const cancelled = counts('CANCELLED');

  // Damage recovery
  const damageBilled = damages
    .filter(d => d.billedToCustomer)
    .reduce((s, d) => s + Number(d.actualCost ?? d.estimatedCost ?? 0), 0);
  const damageRecovered = damages
    .filter(d => d.billedToCustomer && d.status === 'CLOSED')
    .reduce((s, d) => s + Number(d.actualCost ?? d.estimatedCost ?? 0), 0);

  // Build category KPIs
  const byCategory: CategoryKpis[] = Array.from(catMap.entries()).map(([category, c]) => {
    const availableCarDays = c.fleetSize * daysInPeriod;
    return {
      category,
      fleetSize: c.fleetSize,
      rentedCarDays: c.rentedCarDays,
      availableCarDays,
      utilizationPct: availableCarDays > 0 ? round((c.rentedCarDays / availableCarDays) * 100) : 0,
      totalRevenue: round(c.revenue),
      revPAC: availableCarDays > 0 ? round(c.revenue / availableCarDays) : 0,
      averageDailyRate: c.rentedCarDays > 0 ? round(c.revenue / c.rentedCarDays) : 0,
      bookingCount: c.bookingCount,
    };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue);

  // Build channel KPIs
  const byChannel: ChannelKpis[] = Array.from(chanMap.entries()).map(([channel, c]) => ({
    channel,
    bookingCount: c.bookingCount,
    revenue: round(c.revenue),
    revenuePctOfTotal: totalRevenue > 0 ? round((c.revenue / totalRevenue) * 100) : 0,
    averageLengthOfRental: c.bookingCount > 0 ? round(c.lorSum / c.bookingCount, 1) : 0,
  })).sort((a, b) => b.revenue - a.revenue);

  return {
    periodFrom: periodFrom.toISOString(),
    periodTo: periodTo.toISOString(),
    daysInPeriod,
    fleetSize,
    totalBookings: bookings.length,
    totalRevenue: round(totalRevenue),
    totalRentedCarDays,
    totalAvailableCarDays,
    fleetUtilizationPct: totalAvailableCarDays > 0 ? round((totalRentedCarDays / totalAvailableCarDays) * 100) : 0,
    revPAC: totalAvailableCarDays > 0 ? round(totalRevenue / totalAvailableCarDays) : 0,
    averageDailyRate: totalRentedCarDays > 0 ? round(totalRevenue / totalRentedCarDays) : 0,
    averageLengthOfRental: lorCount > 0 ? round(lorSum / lorCount, 1) : 0,
    pendingBookings: pending,
    confirmedBookings: confirmed,
    activeBookings: active,
    completedBookings: completed,
    cancelledBookings: cancelled,
    conversionPct: allNonCancelled.length > 0
      ? round(((confirmed + active + completed) / allNonCancelled.length) * 100)
      : 0,
    damageClaimsCount: damages.length,
    damageBilledTotal: round(damageBilled),
    damageRecoveredTotal: round(damageRecovered),
    damageRecoveryRatePct: damageBilled > 0 ? round((damageRecovered / damageBilled) * 100) : 0,
    byCategory,
    byChannel,
    snapshotAt: new Date().toISOString(),
  };
}
