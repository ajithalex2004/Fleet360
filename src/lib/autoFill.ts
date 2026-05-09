// ============================================================
// Fleet360 - Platform-wide Auto-Fill Utility
// Smart pre-population for all connected/dependent processes
// ============================================================

// -- Date Calculations -------------------------------------------------------

export function addMonths(dateStr: string, months: number): string {
  if (!dateStr || !months) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

export function addDays(dateStr: string, days: number): string {
  if (!dateStr || !days) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export function monthsBetween(startStr: string, endStr: string): number {
  if (!startStr || !endStr) return 0;
  const s = new Date(startStr);
  const e = new Date(endStr);
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
}

export function remainingMonths(startStr: string, endStr: string): number {
  const today = new Date().toISOString().split('T')[0];
  return monthsBetween(today, endStr);
}

export function toDateInput(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return '';
  return isoOrDate.split('T')[0];
}

export function today(): string {
  return new Date().toISOString().split('T')[0];
}

// -- Inquiry -> Quotation ----------------------------------------------------

export interface InquiryForFill {
  id?: string;
  inquiryNumber?: string;
  customerName?: string;
  companyName?: string;
  customerEmail?: string;
  customerPhone?: string;
  vehicleType?: string;
  vehicleCount?: number;
  leaseType?: string;
  durationMonths?: number;
  startDate?: string;
  requiresDriver?: boolean;
  requiresInsurance?: boolean;
  requiresMaintenance?: boolean;
  notes?: string;
}

export function inquiryToQuotation(inq: InquiryForFill) {
  const startDate    = toDateInput(inq.startDate) || today();
  const duration     = inq.durationMonths ?? 24;
  const endDate      = addMonths(startDate, duration);
  const validUntil   = addDays(today(), 30);
  const lesseeName   = inq.companyName
    ? `${inq.companyName} (${inq.customerName ?? ''})`
    : (inq.customerName ?? '');

  return {
    lesseeName,
    leaseType:           inq.leaseType ?? 'LONG_TERM',
    duration,
    startDate,
    endDate,
    validUntil,
    insuranceIncluded:   inq.requiresInsurance   ?? false,
    maintenanceIncluded: inq.requiresMaintenance ?? false,
    driverIncluded:      inq.requiresDriver      ?? false,
    vehicles: [{
      vehicleType: (inq.vehicleType as any) ?? 'SEDAN',
      make: '', model: '',
      year: new Date().getFullYear(),
      quantity: inq.vehicleCount ?? 1,
      monthlyRate: 0,
    }],
    notes: [
      `Ref: Inquiry ${inq.inquiryNumber ?? inq.id ?? ''}`,
      inq.customerName   ? `Customer: ${inq.customerName}`  : '',
      inq.companyName    ? `Company: ${inq.companyName}`     : '',
      inq.customerEmail  ? `Email: ${inq.customerEmail}`     : '',
      inq.customerPhone  ? `Phone: ${inq.customerPhone}`     : '',
      inq.notes          ? `Notes: ${inq.notes}`             : '',
    ].filter(Boolean).join('\n'),
  };
}

// -- Quotation -> Contract (Lease Agreement) --------------------------------

export interface QuotationForFill {
  id?: string;
  quotationNumber?: string;
  lesseeId?: string;
  lesseeName?: string;
  leaseType?: string;
  durationMonths?: number;
  startDate?: string;
  endDate?: string;
  monthlyRate?: number;
  totalMonthlyRate?: number;
  totalContractValue?: number;
  securityDeposit?: number;
  mileageCap?: number;
  currency?: string;
  insuranceIncluded?: boolean;
  maintenanceIncluded?: boolean;
  driverIncluded?: boolean;
  vehicles?: any[];
  notes?: string;
}

export function quotationToContract(q: QuotationForFill) {
  const startDate  = toDateInput(q.startDate) || today();
  const duration   = q.durationMonths ?? 24;
  const endDate    = q.endDate ? toDateInput(q.endDate) : addMonths(startDate, duration);

  return {
    quotationId:         q.id,
    lesseeId:            q.lesseeId ?? '',
    leaseType:           q.leaseType ?? 'LONG_TERM',
    startDate,
    endDate,
    monthlyRate:         q.totalMonthlyRate ?? q.monthlyRate ?? 0,
    totalContractValue:  q.totalContractValue ?? 0,
    securityDeposit:     q.securityDeposit ?? 0,
    mileageCap:          q.mileageCap ?? null,
    currency:            q.currency ?? 'AED',
    insuranceIncluded:   q.insuranceIncluded   ?? false,
    maintenanceIncluded: q.maintenanceIncluded ?? false,
    driverIncluded:      q.driverIncluded      ?? false,
    notes: `Ref: Quotation ${q.quotationNumber ?? q.id ?? ''}${q.notes ? '\n' + q.notes : ''}`,
  };
}

// -- Contract -> Early Termination ------------------------------------------

export interface ContractForFill {
  id?: string;
  contractNumber?: string;
  lesseeId?: string;
  leaseType?: string;
  startDate?: string;
  endDate?: string;
  monthlyRate?: number;
  totalContractValue?: number;
  securityDeposit?: number;
  currency?: string;
  status?: string;
}

export function contractToEarlyTermination(c: ContractForFill) {
  const remaining = remainingMonths(today(), toDateInput(c.endDate));
  const monthly   = Number(c.monthlyRate ?? 0);
  const defaultPenaltyPct = 20;
  const penaltyAmount     = (defaultPenaltyPct / 100) * monthly * remaining;

  return {
    contractId:         c.id ?? '',
    requestDate:        today(),
    effectiveDate:      addDays(today(), 30),
    remainingMonths:    remaining,
    monthlyRate:        monthly,
    penaltyPct:         defaultPenaltyPct,
    penaltyAmount:      penaltyAmount,
    outstandingPayments: 0,
    depositRefund:       Number(c.securityDeposit ?? 0),
    totalSettlement:     Math.max(0, penaltyAmount - Number(c.securityDeposit ?? 0)),
    currency:            c.currency ?? 'AED',
    notes: `Early termination request for contract ${c.contractNumber ?? c.id ?? ''}`,
  };
}

// -- Contract -> Renewal ----------------------------------------------------

export function contractToRenewal(c: ContractForFill) {
  const currentEnd = toDateInput(c.endDate);
  const newStart   = addDays(currentEnd, 1);
  const newEnd     = addMonths(newStart, 24);

  return {
    originalContractId:  c.id ?? '',
    renewalType:         'SAME_TERMS',
    proposedStartDate:   newStart,
    proposedEndDate:     newEnd,
    proposedMonthlyRate: Number(c.monthlyRate ?? 0),
    initiatedBy:         '',
    notes: `Renewal of contract ${c.contractNumber ?? c.id ?? ''}. Previous end date: ${currentEnd}.`,
  };
}

// -- Contract -> Pre-Billing Statement -------------------------------------

export function contractToPreBilling(c: ContractForFill, billingMonth?: string) {
  const now    = new Date();
  const period = billingMonth ?? `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}`;
  const dueDate = addDays(
    `${period.split('-')[0]}-${period.split('-')[1]}-01`,
    -3
  );

  return {
    contractId:    c.id ?? '',
    billingPeriod: period,
    dueDate:       dueDate || today(),
    baseRent:      Number(c.monthlyRate ?? 0),
    fuelCharges:   0,
    fineCharges:   0,
    maintenanceCharges: 0,
    overageCharges: 0,
    otherCharges:   0,
    currency:      c.currency ?? 'AED',
  };
}

// -- RAC Booking -> Agreement -----------------------------------------------

export interface BookingForFill {
  id?: string;
  bookingRef?: string;
  customerId?: string;
  vehicleId?: string;
  vehicleCategory?: string;
  pickupDate?: string;
  dropoffDate?: string;
  totalDays?: number;
  dailyRate?: number;
  totalAmount?: number;
  currency?: string;
  channel?: string;
}

export function bookingToAgreement(b: BookingForFill) {
  return {
    bookingId:       b.id ?? '',
    customerId:      b.customerId ?? '',
    vehicleId:       b.vehicleId ?? null,
    startDate:       toDateInput(b.pickupDate) || today(),
    endDate:         toDateInput(b.dropoffDate) || addDays(today(), b.totalDays ?? 1),
    dailyRate:       Number(b.dailyRate ?? 0),
    totalAmount:     Number(b.totalAmount ?? 0),
    securityDeposit: Number(b.dailyRate ?? 0) * 5,
    currency:        b.currency ?? 'AED',
    status:          'DRAFT',
    notes: `Agreement for booking ${b.bookingRef ?? b.id ?? ''}`,
  };
}

// -- RAC Booking -> Extension -----------------------------------------------

export function bookingToExtension(b: BookingForFill, extraDays = 1) {
  const currentEnd = toDateInput(b.dropoffDate);
  return {
    newEndDate:  addDays(currentEnd, extraDays),
    extraDays,
    extraAmount: Number(b.dailyRate ?? 0) * extraDays,
    reason:      '',
  };
}

// -- Staff: Schedule -> Trip Log --------------------------------------------

export interface ScheduleForFill {
  id?: string;
  tripNumber?: string;
  routeId?: string;
  vehicleId?: string;
  driverId?: string;
  departureTime?: string;
  capacity?: number;
  confirmedCount?: number;
}

export function scheduleToTripLog(s: ScheduleForFill) {
  return {
    scheduleId:          s.id ?? '',
    actualDepartureTime: new Date().toISOString(),
    passengersBoarded:   s.confirmedCount ?? 0,
    startMileage:        null,
    loggedBy:            '',
    notes: `Trip log for ${s.tripNumber ?? s.id ?? ''}`,
  };
}

// -- Generic helper: compute end date from start + duration -----------------

export function calcEndDate(startDate: string, durationMonths: number): string {
  return addMonths(startDate, durationMonths);
}

export function calcValidUntil(startDate: string, daysValid = 30): string {
  return addDays(startDate || today(), daysValid);
}
