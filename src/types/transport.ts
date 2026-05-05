// ============================================================
// TRANSPORT PLATFORM — COMPREHENSIVE TYPE DEFINITIONS
// ============================================================

// ─── LEASING ────────────────────────────────────────────────
export type LeaseStatus = 'DRAFT' | 'APPROVED' | 'ACTIVE' | 'EXTENDED' | 'TERMINATED' | 'CLOSED';
export type LeasePaymentStatus = 'PENDING' | 'PAID' | 'OVERDUE';

export interface Lessee {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  name: string;
  type: 'individual' | 'corporate';
  licenseNo?: string;
  tradeLicense?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  nationality?: string;
  emiratesId?: string;
  leaseContracts?: LeaseContract[];
}

export interface LeaseContract {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  contractNumber?: string;
  lesseeId: string;
  lessee?: Lessee;
  vehicleId: string;
  startDate: string;
  endDate: string;
  monthlyRate: number;
  mileageCap?: number;
  securityDeposit?: number;
  currency?: string;
  status?: LeaseStatus;
  notes?: string;
  payments?: LeasePayment[];
  returns?: LeaseVehicleReturn[];
}

export interface LeasePayment {
  id: string;
  contractId: string;
  dueDate: string;
  amount: number;
  paidDate?: string;
  receiptNo?: string;
  status?: LeasePaymentStatus;
}

export interface LeaseVehicleReturn {
  id: string;
  contractId: string;
  returnDate: string;
  mileage?: number;
  condition?: string;
  damages?: string;
  inspector?: string;
  finalCost?: number;
}

// ─── RENT-A-CAR ──────────────────────────────────────────────
export type RentalBookingStatus = 'PENDING' | 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type DamageClaimStatus = 'OPEN' | 'ASSESSED' | 'BILLED' | 'CLOSED';

export interface RentalCustomer {
  id: string;
  createdAt?: string;
  fullName: string;
  nationality?: string;
  passportNo?: string;
  drivingLicenseNo?: string;
  licenseExpiry?: string;
  email?: string;
  phone?: string;
  blacklisted?: boolean;
}

export interface RentalBooking {
  id: string;
  createdAt?: string;
  bookingRef?: string;
  customerId: string;
  customer?: RentalCustomer;
  vehicleId?: string;
  vehicleCategory?: string;
  pickupDate: string;
  dropoffDate: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  totalDays?: number;
  dailyRate?: number;
  totalAmount?: number;
  currency?: string;
  status?: RentalBookingStatus;
  channel?: string;
  notes?: string;
  inspections?: VehicleInspection[];
  damageClaims?: DamageClaim[];
}

export interface VehicleInspection {
  id: string;
  bookingId: string;
  type: 'checkin' | 'checkout';
  mileage?: number;
  fuelLevel?: number;
  damages?: string;
  inspector?: string;
  notes?: string;
}

export interface DamageClaim {
  id: string;
  bookingId: string;
  description?: string;
  estimatedCost?: number;
  actualCost?: number;
  status?: DamageClaimStatus;
  insuranceClaim?: boolean;
  billedToCustomer?: boolean;
}

export interface PricingRule {
  id: string;
  vehicleCategory: string;
  baseDailyRate: number;
  baseKmRate?: number;
  seasonFrom?: string;
  seasonTo?: string;
  multiplier?: number;
  currency?: string;
  isActive?: boolean;
}

// ─── BUS OPERATIONS ──────────────────────────────────────────
export type TripStatus = 'SCHEDULED' | 'DEPARTED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';
export type PassengerStatus = 'CONFIRMED' | 'BOARDED' | 'ABSENT';

export interface BusRoute {
  id: string;
  createdAt?: string;
  name: string;
  origin: string;
  destination: string;
  totalDistanceKm?: number;
  estimatedDurationMins?: number;
  isActive?: boolean;
  stops?: RouteStop[];
  schedules?: TripSchedule[];
}

export interface RouteStop {
  id: string;
  routeId: string;
  stopName: string;
  sequence: number;
  gpsLat?: number;
  gpsLng?: number;
  estimatedArrivalMins?: number;
}

export interface TripSchedule {
  id: string;
  createdAt?: string;
  routeId: string;
  route?: BusRoute;
  vehicleId?: string;
  driverId?: string;
  departureTime: string;
  frequency?: string;
  shiftType?: string;
  status?: TripStatus;
  passengers?: TripPassenger[];
}

export interface TripPassenger {
  id: string;
  tripId: string;
  employeeId?: string;
  employeeName?: string;
  boardingStopId?: string;
  alightingStopId?: string;
  status?: PassengerStatus;
}

export interface TripLog {
  id: string;
  scheduleId: string;
  actualDepartureTime?: string;
  actualArrivalTime?: string;
  mileage?: number;
  fuelUsed?: number;
  incidents?: string;
  notes?: string;
}

export interface StaffMember {
  id: string;
  employeeId?: string;
  name: string;
  department?: string;
  contactNumber?: string;
  email?: string;
  defaultRouteId?: string;
  defaultStopId?: string;
  isActive?: boolean;
}

// ─── FLEET MANAGEMENT ────────────────────────────────────────
export interface VehicleDocument {
  id: string;
  vehicleId: string;
  docType: string;
  docNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  issuedBy?: string;
  fileUrl?: string;
  status?: string;
  notes?: string;
}

export interface FuelLog {
  id: string;
  vehicleId: string;
  driverId?: string;
  fuelDate: string;
  liters: number;
  costPerLiter?: number;
  totalCost?: number;
  mileage?: number;
  station?: string;
  fuelCardId?: string;
  notes?: string;
}

export interface FuelCard {
  id: string;
  cardNumber: string;
  vehicleId?: string;
  driverId?: string;
  monthlyLimit?: number;
  currentBalance?: number;
  isActive?: boolean;
  expiryDate?: string;
}

export interface TrafficFine {
  id: string;
  vehicleId?: string;
  driverId?: string;
  fineDate: string;
  fineAmount: number;
  authority?: string;
  fineRef?: string;
  offenceType?: string;
  status?: string;
  paidDate?: string;
  assignedTo?: string;
}

// ─── DRIVER MANAGEMENT ──────────────────────────────────────
export interface DriverDocument {
  id: string;
  driverId: string;
  docType: string;
  docNumber?: string;
  expiryDate?: string;
  fileUrl?: string;
  status?: string;
}

export interface DriverShift {
  id: string;
  driverId: string;
  shiftDate: string;
  startTime: string;
  endTime?: string;
  totalHours?: number;
  status?: string;
  vehicleId?: string;
  notes?: string;
}

export interface DriverTraining {
  id: string;
  driverId: string;
  courseName: string;
  provider?: string;
  completedDate?: string;
  expiryDate?: string;
  certificateUrl?: string;
  status?: string;
}

export interface DriverPerformance {
  id: string;
  driverId: string;
  periodMonth: number;
  periodYear: number;
  onTimePct?: number;
  incidentCount?: number;
  customerRating?: number;
  fuelEfficiency?: number;
  totalTrips?: number;
  totalKm?: number;
  score?: number;
}

// ─── BOOKING PORTAL ──────────────────────────────────────────
export type BookingStatus = 'PENDING' | 'APPROVED' | 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type BookingServiceType = 'RENTAL' | 'LEASING' | 'STAFF_TRANSPORT' | 'EXECUTIVE';

export interface Booking {
  id: string;
  createdAt?: string;
  bookingRef?: string;
  serviceType: BookingServiceType;
  requestorId?: string;
  requestorName?: string;
  requestorEmail?: string;
  startDate: string;
  endDate?: string;
  vehicleCategory?: string;
  vehicleId?: string;
  notes?: string;
  status?: BookingStatus;
  approvedBy?: string;
  approvedAt?: string;
}

// ─── FINANCE & BILLING ───────────────────────────────────────
export interface PaymentTransaction {
  id: string;
  createdAt?: string;
  invoiceId?: string;
  amount: number;
  currency?: string;
  paymentMethod?: string;
  gatewayRef?: string;
  status?: string;
  paidAt?: string;
  notes?: string;
}

export interface CreditNote {
  id: string;
  createdAt?: string;
  creditNoteNo?: string;
  invoiceId?: string;
  reason?: string;
  amount: number;
  currency?: string;
  approvedBy?: string;
  issuedAt?: string;
  status?: string;
}

export interface FinanceBudget {
  id: string;
  year: number;
  month: number;
  category: string;
  budgetAmount: number;
  actualAmount?: number;
  currency?: string;
}

export interface VatReturn {
  id: string;
  periodFrom: string;
  periodTo: string;
  totalSales?: number;
  totalVatOutput?: number;
  totalVatInput?: number;
  netVatDue?: number;
  status?: string;
  filedAt?: string;
}

// ─── COMPLIANCE ──────────────────────────────────────────────
export interface ComplianceDocument {
  id: string;
  createdAt?: string;
  entityType: string;
  entityId: string;
  docType: string;
  docNumber?: string;
  authority?: string;
  issueDate?: string;
  expiryDate?: string;
  fileUrl?: string;
  status?: string;
  reminderDays?: number;
  notes?: string;
}

export interface InsurancePolicy {
  id: string;
  policyNumber: string;
  vehicleId?: string;
  provider: string;
  policyType: string;
  startDate: string;
  endDate: string;
  premium?: number;
  sumInsured?: number;
  currency?: string;
  status?: string;
  fileUrl?: string;
}

export interface SalikAccount {
  id: string;
  tagNumber: string;
  vehicleId?: string;
  balance?: number;
  autoRecharge?: boolean;
  rechargeAmount?: number;
  isActive?: boolean;
}

// ─── REPORTING ───────────────────────────────────────────────
export interface ReportSchedule {
  id: string;
  reportName: string;
  reportType: string;
  frequency: string;
  recipients: string[];
  format?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  isActive?: boolean;
}

export interface FleetUtilizationMetric {
  vehicleId: string;
  licensePlate: string;
  make: string;
  model: string;
  totalDaysInPeriod: number;
  activeDays: number;
  idleDays: number;
  maintenanceDays: number;
  utilizationPct: number;
  totalKm: number;
  revenue: number;
}

export interface RevenueMetric {
  period: string;
  rentalRevenue: number;
  leasingRevenue: number;
  maintenanceCost: number;
  fuelCost: number;
  netRevenue: number;
}
