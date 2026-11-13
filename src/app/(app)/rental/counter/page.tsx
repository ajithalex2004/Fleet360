'use client';

/**
 * Unified RAC Counter Desk — Pick-Up (Check-Out / Handover) & Return (Check-In & Settlement).
 *
 * Uses existing infrastructure:
 *   - /api/rental/documents/upload (rental storage adapter for walkaround photos)
 *   - /api/rental/damage-claims/classify (optional AI assist after photo)
 *   - /api/rental/availability (vehicle plate assignment on pick-up)
 *   - /api/rental/preauth (card pre-authorization hold at pick-up desk)
 *   - /api/rental/counter/handover (pick-up queue + atomic pick-up check-out)
 *   - /api/rental/counter/return (active agreements baseline + atomic return check-in & invoice settlement)
 */

import React, { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Camera,
  Sparkles,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  X,
  Plus,
  Loader,
  Car,
  CreditCard,
  ShieldAlert,
  Fuel,
  Gauge,
  Receipt,
  FileText,
  ArrowRightLeft,
  Trash2,
  UserPlus,
  Cpu,
  ScanLine,
  Wrench,
  ShieldCheck,
} from 'lucide-react';
import { SignaturePad } from '@/components/rental-counter/SignaturePad';
import { DamageWalkaround, type DamageMarker } from '@/components/rental-counter/DamageWalkaround';
import { pctToEighths, resolveStoredFuelPct, resolveStoredOdometerKm } from '@/lib/rental/fuel-odometer';

/* ─── Types ────────────────────────────────────────────────────────────────── */

type CounterMode = 'pickup' | 'return';
type SettlementAction = 'NONE' | 'CAPTURE_INVOICE' | 'RELEASE_DEPOSIT';
type ReturnDamageSeverity = 'MINOR' | 'MODERATE' | 'SEVERE';

interface AvailableVehicle {
  id: string;
  plateNo: string;
  make: string;
  model: string;
  year?: number;
  category?: string;
  color?: string;
  currentMileage?: number;
}

interface PhotoItem {
  url: string;
  name: string;
  size: number;
}

interface PreAuthHold {
  id?: string;
  authCode: string;
  amount: number;
  cardBrand?: string;
  cardLast4: string;
  cardholderName?: string;
  status: string;
}

interface BookingOption {
  id: string;
  bookingRef: string | null;
  customerId: string;
  vehicleCategory: string | null;
  vehicleId: string | null;
  pickupDate: string;
  dropoffDate: string;
  dailyRate: number | null;
  totalAmount: number | null;
  securityDeposit?: number | null;
  currency: string;
  status: string;
  customerName: string;
  companyName: string | null;
  customerPhone: string | null;
  vehicle: AvailableVehicle | null;
  preauth: PreAuthHold | null;
  ancillaries?: Array<{ ancillaryId?: string; id?: string; code?: string; name?: string; quantity?: number }>;
  additionalDrivers?: AdditionalDriverItem[];
}

interface WalkInCustomerOption {
  id: string;
  fullName: string;
  companyName: string | null;
  phone: string | null;
  customerType: string;
  drivingLicenseNo: string | null;
  licenseExpiry: string | null;
}

interface AncillaryCatalogItem {
  id: string;
  code: string;
  name: string;
  pricingMode: 'PER_DAY' | 'FLAT';
  rate: number;
  maxQuantity: number;
}

interface AdditionalDriverItem {
  fullName: string;
  drivingLicenseNo: string;
  licenseExpiry: string;
  licenseIssuingCountry: string;
  internationalPermitNo?: string;
  feeAmount?: number;
}

interface VehicleExchangeSegment {
  id: string;
  exchangeNo: string | null;
  exchangeDate: string | null;
  reason: string | null;
  fromPlateNumber: string | null;
  fromMileageIn: number;
  fromFuelIn: number;
  toPlateNumber: string | null;
  toMileageOut: number;
  toFuelOut: number;
  rateDifference: number;
}

interface UnbilledFineItem {
  id: string;
  fineRef: string | null;
  offenceType: string;
  fineDate: string | null;
  fineAmount: number;
  knowledgeFee: number;
  adminFee: number;
  status: string;
}

interface UnbilledTollItem {
  id: string;
  gateName: string;
  occurredAt: string | null;
  amount: number;
  adminFee: number;
  tollSystem: string | null;
}

interface AdditionalChargeItem {
  id: string;
  chargeType: string;
  description: string;
  quantity: number;
  unitAmount: number;
  preVatTotal: number;
}

interface SettlementContextData {
  vehicleExchanges: VehicleExchangeSegment[];
  unbilledTrafficFines: UnbilledFineItem[];
  unbilledTolls: UnbilledTollItem[];
  additionalCharges: AdditionalChargeItem[];
  pricingRule: {
    dailyRate: number;
    totalDays: number;
    subtotal: number;
    discountAmount: number;
    includedKmPerDay: number;
    excessKmRate: number;
    lateFeePerHour: number;
    lateFeeCap: number;
    gracePeriodMin: number;
  } | null;
}

interface SixPointClearanceState {
  brakesOk: boolean;
  tyresOk: boolean;
  lightsOk: boolean;
  fluidsOk: boolean;
  windshieldOk: boolean;
  bodySafetyOk: boolean;
}

interface ReturnAgreementItem {
  id: string;
  agreementNo: string;
  bookingId: string | null;
  bookingRef: string | null;
  customerName: string;
  companyName: string | null;
  vehicleId: string | null;
  vehiclePlate: string;
  vehicleName: string;
  vehicleCategory: string | null;
  startDate: string;
  endDate: string;
  dailyRate: number;
  totalAmount: number;
  securityDeposit: number;
  depositStatus: string;
  currency: string;
  pickupOdometer: number;
  pickupFuelEighths: number;
  pickupFuelPct: number;
  pickupChecklist: Record<string, boolean>;
  pickupDamageMarkers: DamageMarker[];
  pickupPhotos: string[];
  preauth: PreAuthHold | null;
}

interface StructuredNewDamage {
  id: string;
  zone: string;
  severity: ReturnDamageSeverity;
  description: string;
  estimatedCost: number;
}

interface ReturnSettlementSummary {
  agreementId?: string;
  invoiceId?: string;
  invoiceNumber: string;
  currency: string;
  subtotal: number;
  lateFee: number;
  excessKmCharge: number;
  fuelSurcharge: number;
  damageCharges: number;
  taxAmount: number;
  totalAmount: number;
  preauthResult: unknown;
  vehicleStatusAfterReturn?: string | null;
  sixPointClearancePassed?: boolean;
  regulatoryReport?: { authority?: string; status?: string; externalRef?: string | null } | null;
}

/* ─── Constants ────────────────────────────────────────────────────────────── */

const SIX_POINT_ITEMS: Array<{ key: keyof SixPointClearanceState; label: string }> = [
  { key: 'brakesOk',     label: 'Brakes & Pads' },
  { key: 'tyresOk',      label: 'Tyres & Tread' },
  { key: 'lightsOk',     label: 'Lights & Signals' },
  { key: 'fluidsOk',     label: 'Engine & Brake Fluids' },
  { key: 'windshieldOk', label: 'Windshield & Glass' },
  { key: 'bodySafetyOk', label: 'Body & Chassis Safety' },
];

const VEHICLE_CATEGORIES = ['ECONOMY', 'COMPACT', 'SEDAN', 'SUV', 'LUXURY', 'VAN'] as const;

const CHECKLIST_ITEMS = [
  { key: 'spareTyre',           label: 'Spare Tyre' },
  { key: 'jackAndTools',        label: 'Jack & Tools' },
  { key: 'salikTag',            label: 'Salik Tag' },
  { key: 'registrationMulkiya', label: 'Registration Mulkiya' },
  { key: 'warningTriangle',     label: 'Warning Triangle' },
  { key: 'firstAidKit',         label: 'First Aid Kit' },
  { key: 'cleanInterior',       label: 'Clean Interior' },
] as const;

const DAMAGE_ZONE_OPTIONS = [
  { value: 'FRONT_BUMPER',       label: 'Front Bumper' },
  { value: 'REAR_BUMPER',        label: 'Rear Bumper' },
  { value: 'HOOD',               label: 'Hood / Bonnet' },
  { value: 'WINDSHIELD',         label: 'Windshield' },
  { value: 'ROOF',               label: 'Roof' },
  { value: 'TRUNK',              label: 'Trunk / Boot' },
  { value: 'FRONT_LEFT_FENDER',  label: 'Front Left Fender' },
  { value: 'FRONT_RIGHT_FENDER', label: 'Front Right Fender' },
  { value: 'FRONT_LEFT_DOOR',    label: 'Front Left Door' },
  { value: 'FRONT_RIGHT_DOOR',   label: 'Front Right Door' },
  { value: 'REAR_LEFT_DOOR',     label: 'Rear Left Door' },
  { value: 'REAR_RIGHT_DOOR',    label: 'Rear Right Door' },
  { value: 'REAR_LEFT_QUARTER',  label: 'Rear Left Quarter' },
  { value: 'REAR_RIGHT_QUARTER', label: 'Rear Right Quarter' },
  { value: 'WHEEL_TYRE',         label: 'Wheel / Alloy / Tyre' },
  { value: 'INTERIOR',           label: 'Cabin / Interior' },
];

const FUEL_LABELS = ['E', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8', 'Full'];

function defaultChecklist(checked = true): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const item of CHECKLIST_ITEMS) {
    map[item.key] = checked;
  }
  return map;
}

function normalizeChecklist(raw: unknown): Record<string, boolean> {
  const result = defaultChecklist(true);
  if (!raw) return result;

  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return result;
    }
  }

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        const lbl = String(obj.key ?? obj.label ?? obj.item ?? '').toLowerCase();
        const val = Boolean(obj.checked ?? obj.passed ?? true);
        for (const item of CHECKLIST_ITEMS) {
          if (
            lbl === item.key.toLowerCase() ||
            lbl.includes(item.label.toLowerCase()) ||
            item.label.toLowerCase().includes(lbl)
          ) {
            result[item.key] = val;
          }
        }
      }
    }
    return result;
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    for (const item of CHECKLIST_ITEMS) {
      if (item.key in obj) {
        result[item.key] = Boolean(obj[item.key]);
      } else if (item.label in obj) {
        result[item.key] = Boolean(obj[item.label]);
      }
    }
  }
  return result;
}

function normalizeFuel(raw: unknown, pctColumn?: unknown): { eighths: number; pct: number } {
  const resolvedPct = resolveStoredFuelPct(pctColumn, raw);
  if (resolvedPct == null) return { eighths: 8, pct: 100 };
  return { eighths: pctToEighths(resolvedPct), pct: resolvedPct };
}

function fmtMoney(n: number, currency = 'AED') {
  const safe = Number.isFinite(Number(n)) ? Number(n) : 0;
  return `${currency || 'AED'} ${safe.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizePreAuth(rawPreauth: unknown): PreAuthHold | null {
  if (!rawPreauth || typeof rawPreauth !== 'object') return null;
  const pa = rawPreauth as Record<string, unknown>;
  const amt = Number(pa.amount ?? pa.holdAmount ?? pa.authorizedAmount ?? 0);
  if (amt > 0 || pa.authCode || pa.auth_code || pa.preauthRef || pa.reference || pa.id) {
    return {
      id: pa.id ? String(pa.id) : undefined,
      authCode: String(pa.authCode ?? pa.auth_code ?? pa.preauthRef ?? pa.reference ?? 'AUTH-HOLD'),
      amount: amt,
      cardBrand: pa.cardBrand ? String(pa.cardBrand) : pa.card_brand ? String(pa.card_brand) : undefined,
      cardLast4: String(pa.cardLast4 ?? pa.card_last4 ?? pa.last4 ?? '4242'),
      cardholderName: pa.cardholderName
        ? String(pa.cardholderName)
        : pa.cardholder_name
          ? String(pa.cardholder_name)
          : undefined,
      status: String(pa.status ?? 'AUTHORIZED').toUpperCase(),
    };
  }
  return null;
}

function normalizeHandoverBooking(b: Record<string, unknown>): BookingOption {
  const cust = (b.customer ?? {}) as Record<string, unknown>;
  const rawVeh = (b.vehicle ?? null) as Record<string, unknown> | null;
  let vehicle: AvailableVehicle | null = null;
  if (rawVeh && typeof rawVeh === 'object' && (rawVeh.id || rawVeh.plateNo || rawVeh.plateNumber || rawVeh.plate_no)) {
    vehicle = {
      id: String(rawVeh.id ?? b.vehicleId ?? ''),
      plateNo: String(
        rawVeh.plateNo ?? rawVeh.plateNumber ?? rawVeh.plate_no ?? rawVeh.registrationNo ?? 'NO-PLATE'
      ),
      make: String(rawVeh.make ?? ''),
      model: String(rawVeh.model ?? ''),
      year: rawVeh.year != null ? Number(rawVeh.year) : undefined,
      category: rawVeh.category
        ? String(rawVeh.category)
        : rawVeh.vehicleType
          ? String(rawVeh.vehicleType)
          : undefined,
      color: rawVeh.color ? String(rawVeh.color) : undefined,
      currentMileage:
        rawVeh.currentMileage != null
          ? Number(rawVeh.currentMileage)
          : rawVeh.mileage != null
            ? Number(rawVeh.mileage)
            : rawVeh.odometer != null
              ? Number(rawVeh.odometer)
              : undefined,
    };
  }

  const rawPreauth =
    b.preauth ??
    b.activePreauth ??
    b.cardPreauth ??
    b.preAuth ??
    (Array.isArray(b.preauths) && b.preauths.length > 0 ? b.preauths[0] : null);

  return {
    id: String(b.id ?? ''),
    bookingRef: b.bookingRef ? String(b.bookingRef) : b.booking_ref ? String(b.booking_ref) : null,
    customerId: String(b.customerId ?? b.customer_id ?? cust.id ?? ''),
    vehicleCategory: b.vehicleCategory
      ? String(b.vehicleCategory)
      : b.vehicle_category
        ? String(b.vehicle_category)
        : null,
    vehicleId: b.vehicleId
      ? String(b.vehicleId)
      : b.vehicle_id
        ? String(b.vehicle_id)
        : vehicle?.id ?? null,
    pickupDate: String(b.pickupDate ?? b.pickup_date ?? ''),
    dropoffDate: String(b.dropoffDate ?? b.dropoff_date ?? ''),
    dailyRate: b.dailyRate != null ? Number(b.dailyRate) : b.daily_rate != null ? Number(b.daily_rate) : null,
    totalAmount: b.totalAmount != null ? Number(b.totalAmount) : b.total_amount != null ? Number(b.total_amount) : null,
    securityDeposit:
      b.securityDeposit != null
        ? Number(b.securityDeposit)
        : b.depositAmount != null
          ? Number(b.depositAmount)
          : null,
    currency: String(b.currency ?? 'AED'),
    status: String(b.status ?? 'PENDING').toUpperCase(),
    customerName: String(cust.fullName ?? cust.full_name ?? b.customerName ?? b.customer_name ?? 'Customer'),
    companyName: cust.companyName
      ? String(cust.companyName)
      : b.companyName
        ? String(b.companyName)
        : null,
    customerPhone: cust.phone ? String(cust.phone) : b.customerPhone ? String(b.customerPhone) : null,
    vehicle,
    preauth: normalizePreAuth(rawPreauth),
    ancillaries: Array.isArray(b.ancillaries) ? (b.ancillaries as BookingOption['ancillaries']) : [],
    additionalDrivers: Array.isArray(b.additionalDrivers)
      ? (b.additionalDrivers as AdditionalDriverItem[])
      : [],
  };
}

function normalizeReturnAgreement(raw: Record<string, unknown>): ReturnAgreementItem {
  const booking = (raw.booking ?? {}) as Record<string, unknown>;
  const customer = ((raw.customer ?? booking.customer) ?? {}) as Record<string, unknown>;
  const vehicle = (raw.vehicle ?? {}) as Record<string, unknown>;
  const baseline = ((raw.pickupBaseline ?? raw.pickupHandover ?? raw.pickupInspection) ?? {}) as Record<string, unknown>;

  const resolvedOdo = resolveStoredOdometerKm(
    baseline.odometer ?? baseline.odometerReading ?? baseline.mileage ?? raw.pickupOdometer ?? raw.pickup_odometer,
    raw.mileageOut ?? raw.mileage_out,
  );
  const rawOdo = resolvedOdo ?? 0;

  const pctFuelCandidate =
    raw.pickupFuelPct ??
    raw.pickup_fuel_level ??
    baseline.fuelLevelPct ??
    baseline.fuelPct;
  const legacyFuelCandidate =
    baseline.fuelLevel ??
    baseline.fuel ??
    raw.pickupFuel ??
    raw.fuelOut ??
    raw.fuel_out ??
    8;
  const fuel = normalizeFuel(legacyFuelCandidate, pctFuelCandidate);

  const rawMarkers =
    baseline.damageMarkers ??
    raw.pickupDamageMarkers ??
    raw.damageMarkers ??
    [];
  let markers: DamageMarker[] = [];
  if (Array.isArray(rawMarkers)) {
    markers = rawMarkers as DamageMarker[];
  } else if (typeof rawMarkers === 'string') {
    try {
      const p = JSON.parse(rawMarkers);
      if (Array.isArray(p)) markers = p;
    } catch { /* ignore */ }
  }

  const rawPhotos = baseline.photoUrls ?? raw.pickupPhotos ?? raw.photoUrls ?? [];
  const photos = Array.isArray(rawPhotos) ? rawPhotos.map(String) : [];

  const rawPreauth =
    raw.preauth ??
    raw.activePreauth ??
    raw.cardPreauth ??
    raw.preAuth ??
    (Array.isArray(raw.preauths) && raw.preauths.length > 0 ? raw.preauths[0] : null);

  const preauth = normalizePreAuth(rawPreauth);

  return {
    id: String(raw.id ?? ''),
    agreementNo: String(raw.agreementNo ?? raw.agreement_no ?? String(raw.id ?? '').slice(0, 8)),
    bookingId: raw.bookingId ? String(raw.bookingId) : booking.id ? String(booking.id) : null,
    bookingRef: raw.bookingRef ? String(raw.bookingRef) : booking.bookingRef ? String(booking.bookingRef) : null,
    customerName: String(
      raw.customerName ??
      raw.customer_name ??
      customer.fullName ??
      customer.full_name ??
      'Walk-in Customer'
    ),
    companyName: customer.companyName ? String(customer.companyName) : null,
    vehicleId: raw.vehicleId ? String(raw.vehicleId) : vehicle.id ? String(vehicle.id) : null,
    vehiclePlate: String(
      raw.vehiclePlate ??
      raw.vehicle_plate ??
      raw.plateNo ??
      raw.vehicleNo ??
      vehicle.plateNo ??
      vehicle.plateNumber ??
      'Unassigned Plate'
    ),
    vehicleName: String(
      raw.vehicleName ??
      raw.vehicle_name ??
      ((vehicle.make ? `${vehicle.make} ${vehicle.model ?? ''}`.trim() : '') ||
        booking.vehicleCategory ||
        raw.vehicleCategory ||
        'Rental Vehicle')
    ),
    vehicleCategory: booking.vehicleCategory
      ? String(booking.vehicleCategory)
      : raw.vehicleCategory
      ? String(raw.vehicleCategory)
      : null,
    startDate: String(raw.startDate ?? raw.start_date ?? booking.pickupDate ?? ''),
    endDate: String(raw.endDate ?? raw.end_date ?? booking.dropoffDate ?? ''),
    dailyRate: Number(raw.dailyRate ?? raw.daily_rate ?? 0),
    totalAmount: Number(raw.totalAmount ?? raw.total_amount ?? 0),
    securityDeposit: Number(raw.securityDeposit ?? raw.security_deposit ?? 0),
    depositStatus: String(raw.depositStatus ?? raw.deposit_status ?? 'PENDING'),
    currency: String(raw.currency ?? 'AED'),
    pickupOdometer: Number(rawOdo) || 0,
    pickupFuelEighths: fuel.eighths,
    pickupFuelPct: fuel.pct,
    pickupChecklist: normalizeChecklist(baseline.checklist ?? baseline.checklistItems ?? raw.pickupChecklist ?? raw.checklist),
    pickupDamageMarkers: markers,
    pickupPhotos: photos,
    preauth,
  };
}

/* ─── 8-Eighth Fuel Gauge Sub-Component ────────────────────────────────────── */

function EighthsFuelGauge({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (eighths: number) => void;
  label: string;
}) {
  const pct = Math.round((value / 8) * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--text-muted)] font-medium flex items-center gap-1.5">
          <Fuel className="h-3.5 w-3.5 text-teal-400" />
          {label}
        </span>
        <span className="font-mono font-semibold text-[var(--text-main)]">
          {FUEL_LABELS[value] ?? `${value}/8`} ({pct}%)
        </span>
      </div>
      <div className="grid grid-cols-9 gap-1">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
          const active = n <= value && (n > 0 || value === 0);
          const color =
            value <= 2
              ? 'bg-rose-500 text-white border-rose-400'
              : value <= 4
              ? 'bg-amber-500 text-white border-amber-400'
              : 'bg-emerald-500 text-white border-emerald-400';
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={`py-2.5 rounded-lg text-[11px] font-bold border transition ${
                n === value
                  ? `${color} ring-2 ring-teal-400/50`
                  : n < value && n > 0
                  ? 'bg-teal-600/40 text-teal-200 border-teal-500/40'
                  : active && value === 0
                  ? 'bg-rose-500 text-white border-rose-400'
                  : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
              }`}
            >
              {FUEL_LABELS[n]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main Counter Desk Content ────────────────────────────────────────────── */

function CounterDeskInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const paramMode = searchParams?.get('mode');
  const paramAgreementId = searchParams?.get('agreementId');
  const paramBookingId = searchParams?.get('bookingId');

  const initialMode: CounterMode =
    paramMode === 'return' || Boolean(paramAgreementId) ? 'return' : 'pickup';

  const [mode, setMode] = useState<CounterMode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [rbacError, setRbacError] = useState<string | null>(null);

  /* ── Pick-Up State ─────────────────────────────────────────────────────── */
  const [pickupSubMode, setPickupSubMode] = useState<'booked' | 'walkin'>('booked');
  const [bookings, setBookings] = useState<BookingOption[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [bookingSearch, setBookingSearch] = useState('');
  const [selectedBooking, setSelectedBooking] = useState<BookingOption | null>(null);

  /* ── Walk-In Direct Checkout + Ancillaries + Additional Drivers State ──── */
  const [walkinCustomers, setWalkinCustomers] = useState<WalkInCustomerOption[]>([]);
  const [walkinCustomerSearch, setWalkinCustomerSearch] = useState('');
  const [walkinCustomerId, setWalkinCustomerId] = useState('');
  const [walkinCategory, setWalkinCategory] = useState<string>('ECONOMY');
  const [walkinPickupDate, setWalkinPickupDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [walkinDropoffDate, setWalkinDropoffDate] = useState<string>(
    () => new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
  );
  const [walkinDailyRate, setWalkinDailyRate] = useState<string>('');
  const [walkinDeposit, setWalkinDeposit] = useState<string>('1500');

  const [ancillaryCatalog, setAncillaryCatalog] = useState<AncillaryCatalogItem[]>([]);
  const [selectedAncillaryQtys, setSelectedAncillaryQtys] = useState<Record<string, number>>({});
  const [additionalDrivers, setAdditionalDrivers] = useState<AdditionalDriverItem[]>([]);
  const [drvDraft, setDrvDraft] = useState<{
    fullName: string;
    drivingLicenseNo: string;
    licenseExpiry: string;
    licenseIssuingCountry: string;
    internationalPermitNo: string;
    feeAmount: string;
  }>({
    fullName: '',
    drivingLicenseNo: '',
    licenseExpiry: '',
    licenseIssuingCountry: 'AE',
    internationalPermitNo: '',
    feeAmount: '50',
  });

  const [availableVehicles, setAvailableVehicles] = useState<AvailableVehicle[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');

  const [mileageOut, setMileageOut] = useState('');
  const [fuelOut, setFuelOut] = useState(8);
  const [pickupChecklist, setPickupChecklist] = useState<Record<string, boolean>>(() => defaultChecklist(true));
  const [pickupMarkers, setPickupMarkers] = useState<DamageMarker[]>([]);
  const [pickupPhotos, setPickupPhotos] = useState<PhotoItem[]>([]);
  const [pickupNotes, setPickupNotes] = useState('');
  const [pickupSignature, setPickupSignature] = useState<string | null>(null);
  const [pickupBusy, setPickupBusy] = useState(false);
  const [pickupDone, setPickupDone] = useState<{
    agreementId?: string;
    agreementNo: string;
    vehiclePlate?: string;
    tarrashudStatus?: string | null;
  } | null>(null);

  /* ── Pick-Up Card Pre-Auth Hold State ──────────────────────────────────── */
  const [showPreauthForm, setShowPreauthForm] = useState(false);
  const [preauthAmount, setPreauthAmount] = useState('1500');
  const [preauthCardBrand, setPreauthCardBrand] = useState('VISA');
  const [preauthCardLast4, setPreauthCardLast4] = useState('');
  const [preauthCardholder, setPreauthCardholder] = useState('');
  const [preauthBusy, setPreauthBusy] = useState(false);

  /* ── Return State ──────────────────────────────────────────────────────── */
  const [activeAgreements, setActiveAgreements] = useState<ReturnAgreementItem[]>([]);
  const [loadingAgreements, setLoadingAgreements] = useState(true);
  const [agreementSearch, setAgreementSearch] = useState('');
  const [selectedAgreement, setSelectedAgreement] = useState<ReturnAgreementItem | null>(null);
  const [settlementCtx, setSettlementCtx] = useState<SettlementContextData | null>(null);
  const [loadingSettlementCtx, setLoadingSettlementCtx] = useState(false);

  const [mileageIn, setMileageIn] = useState('');
  const [fuelIn, setFuelIn] = useState(8);
  const [returnChecklist, setReturnChecklist] = useState<Record<string, boolean>>(() => defaultChecklist(true));
  const [sixPointClearance, setSixPointClearance] = useState<SixPointClearanceState>({
    brakesOk: true,
    tyresOk: true,
    lightsOk: true,
    fluidsOk: true,
    windshieldOk: true,
    bodySafetyOk: true,
  });
  const [groundForMaintenance, setGroundForMaintenance] = useState(false);
  const [returnWalkaroundMarkers, setReturnWalkaroundMarkers] = useState<DamageMarker[]>([]);
  const [newDamages, setNewDamages] = useState<StructuredNewDamage[]>([]);
  const [dmgDraft, setDmgDraft] = useState<{
    zone: string;
    severity: ReturnDamageSeverity;
    description: string;
    estimatedCost: string;
  }>({
    zone: 'FRONT_BUMPER',
    severity: 'MINOR',
    description: '',
    estimatedCost: '350',
  });
  const [returnPhotos, setReturnPhotos] = useState<PhotoItem[]>([]);
  const [returnNotes, setReturnNotes] = useState('');
  const [settlementAction, setSettlementAction] = useState<SettlementAction>('NONE');
  const [returnSignature, setReturnSignature] = useState<string | null>(null);
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnReceipt, setReturnReceipt] = useState<ReturnSettlementSummary | null>(null);

  /* ── Shared Photo / AI / Telematics / KYC State ────────────────────────── */
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const [telematicsBusy, setTelematicsBusy] = useState(false);
  const [telematicsHint, setTelematicsHint] = useState<string | null>(null);
  const [kycBusy, setKycBusy] = useState(false);
  const [kycHint, setKycHint] = useState<string | null>(null);
  const pickupFileRef = useRef<HTMLInputElement>(null);
  const returnFileRef = useRef<HTMLInputElement>(null);
  const kycFileRef = useRef<HTMLInputElement>(null);

  /* ── Sync URL query parameters on mount / change ───────────────────────── */
  useEffect(() => {
    if (paramMode === 'return' || paramAgreementId) {
      setMode('return');
    } else if (paramMode === 'pickup') {
      setMode('pickup');
    }
  }, [paramMode, paramAgreementId]);

  /* ── Load Walk-In Customers & Ancillary Catalog ────────────────────────── */
  const loadWalkInCatalogs = useCallback(async () => {
    try {
      const [custRes, ancRes] = await Promise.all([
        fetch('/api/rental/customers?limit=200', { cache: 'no-store' }),
        fetch('/api/rental/ancillaries', { cache: 'no-store' }),
      ]);
      if (custRes.ok) {
        const cJson = await custRes.json();
        const cRows = Array.isArray(cJson) ? cJson : (cJson?.data ?? cJson?.customers ?? []);
        setWalkinCustomers(
          (Array.isArray(cRows) ? cRows : []).map((c: Record<string, unknown>) => ({
            id: String(c.id ?? ''),
            fullName: String(c.fullName ?? c.full_name ?? 'Customer'),
            companyName: c.companyName ? String(c.companyName) : null,
            phone: c.phone ? String(c.phone) : null,
            customerType: String(c.customerType ?? 'INDIVIDUAL'),
            drivingLicenseNo: c.drivingLicenseNo ? String(c.drivingLicenseNo) : null,
            licenseExpiry: c.licenseExpiry ? String(c.licenseExpiry) : null,
          })),
        );
      }
      if (ancRes.ok) {
        const aJson = await ancRes.json();
        const aRows = Array.isArray(aJson) ? aJson : (aJson?.ancillaries ?? aJson?.data ?? []);
        setAncillaryCatalog(
          (Array.isArray(aRows) ? aRows : [])
            .filter((a: Record<string, unknown>) => a.isActive !== false && a.is_active !== false)
            .map((a: Record<string, unknown>) => ({
              id: String(a.id ?? ''),
              code: String(a.code ?? ''),
              name: String(a.name ?? a.code ?? 'Add-On'),
              pricingMode: String(a.pricingMode ?? a.pricing_mode ?? 'PER_DAY').toUpperCase() === 'FLAT' ? 'FLAT' : 'PER_DAY',
              rate: Number(a.rate ?? a.dailyRate ?? a.unitPrice ?? 0),
              maxQuantity: Math.max(1, Number(a.maxQuantity ?? a.max_quantity ?? 4)),
            })),
        );
      }
    } catch {
      /* optional enrichment */
    }
  }, []);

  /* ── Load Bookings for Pick-Up ─────────────────────────────────────────── */
  const selectBookingForPickup = useCallback((b: BookingOption) => {
    setSelectedBooking(b);
    setSelectedVehicleId(b.vehicleId ?? b.vehicle?.id ?? '');
    if (b.vehicle?.currentMileage != null) {
      setMileageOut(String(b.vehicle.currentMileage));
    }
    setPreauthAmount(b.securityDeposit && b.securityDeposit > 0 ? String(b.securityDeposit) : '1500');
    setPreauthCardholder(b.customerName || '');
    setPreauthCardLast4('');
    setShowPreauthForm(false);
    setSelectedAncillaryQtys({});
    setAdditionalDrivers([]);
    setTelematicsHint(null);
    setError(null);
  }, []);

  const loadBookings = useCallback(async () => {
    setLoadingBookings(true);
    try {
      const res = await fetch('/api/rental/counter/handover', { cache: 'no-store' });
      let rows: unknown[] = [];
      if (res.ok) {
        const data = await res.json();
        rows = Array.isArray(data) ? data : (data?.bookings ?? data?.data ?? []);
      } else {
        const fallback = await fetch('/api/rental/bookings?limit=100', { cache: 'no-store' });
        if (fallback.ok) {
          const fbData = await fallback.json();
          const fbRows = Array.isArray(fbData) ? fbData : (fbData?.data ?? fbData?.bookings ?? []);
          rows = (Array.isArray(fbRows) ? fbRows : []).filter((b: Record<string, unknown>) =>
            ['CONFIRMED', 'PENDING'].includes(String(b.status ?? 'PENDING').toUpperCase())
          );
        }
      }

      let list: BookingOption[] = (Array.isArray(rows) ? rows : []).map((b) =>
        normalizeHandoverBooking((b ?? {}) as Record<string, unknown>)
      );

      if (paramBookingId) {
        let match = list.find((b) => b.id === paramBookingId || b.bookingRef === paramBookingId);
        if (!match) {
          const singleRes = await fetch(
            `/api/rental/counter/handover?bookingId=${encodeURIComponent(paramBookingId)}`,
            { cache: 'no-store' }
          );
          if (singleRes.ok) {
            const singleData = await singleRes.json();
            const singleRows = Array.isArray(singleData)
              ? singleData
              : Array.isArray(singleData?.bookings)
                ? singleData.bookings
                : singleData?.booking
                  ? [singleData.booking]
                  : Array.isArray(singleData?.data)
                    ? singleData.data
                    : singleData?.id
                      ? [singleData]
                      : [];
            const mappedSingle = (Array.isArray(singleRows) ? singleRows : []).map((r) =>
              normalizeHandoverBooking((r ?? {}) as Record<string, unknown>)
            );
            match =
              mappedSingle.find((b) => b.id === paramBookingId || b.bookingRef === paramBookingId) ??
              mappedSingle[0];
            if (match && !list.some((b) => b.id === match!.id)) {
              list = [match, ...list];
            }
          }
        }
        setBookings(list);
        if (match) {
          selectBookingForPickup(match);
        }
      } else {
        setBookings(list);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookings');
    } finally {
      setLoadingBookings(false);
    }
  }, [paramBookingId, selectBookingForPickup]);

  const loadSettlementContext = useCallback(async (agreementId: string) => {
    setLoadingSettlementCtx(true);
    try {
      const res = await fetch(
        `/api/rental/counter/return?agreementId=${encodeURIComponent(agreementId)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return;
      const json = await res.json();
      const ctx = (json?.settlementContext ?? json?.agreements?.[0] ?? null) as Record<string, unknown> | null;
      if (!ctx) return;
      const exchanges = Array.isArray(ctx.vehicleExchanges)
        ? (ctx.vehicleExchanges as VehicleExchangeSegment[])
        : [];
      const fines = Array.isArray(ctx.unbilledTrafficFines)
        ? (ctx.unbilledTrafficFines as UnbilledFineItem[])
        : [];
      const tolls = Array.isArray(ctx.unbilledTolls)
        ? (ctx.unbilledTolls as UnbilledTollItem[])
        : [];
      const charges = Array.isArray(ctx.additionalCharges)
        ? (ctx.additionalCharges as AdditionalChargeItem[])
        : [];
      const rule =
        ctx.pricingRule && typeof ctx.pricingRule === 'object'
          ? (ctx.pricingRule as SettlementContextData['pricingRule'])
          : null;
      setSettlementCtx({
        vehicleExchanges: exchanges,
        unbilledTrafficFines: fines,
        unbilledTolls: tolls,
        additionalCharges: charges,
        pricingRule: rule,
      });
      if (exchanges.length > 0) {
        const lastSwap = exchanges[exchanges.length - 1];
        if (lastSwap.toMileageOut > 0) {
          setMileageIn(String(lastSwap.toMileageOut));
        }
        if (lastSwap.toFuelOut > 0) {
          setFuelIn(pctToEighths(lastSwap.toFuelOut));
        }
      }
    } catch {
      /* ignore optional settlement context failure */
    } finally {
      setLoadingSettlementCtx(false);
    }
  }, []);

  /* ── Load Active Agreements for Return ─────────────────────────────────── */
  const loadReturnAgreements = useCallback(async () => {
    setLoadingAgreements(true);
    try {
      let rawList: unknown[] = [];
      const res = await fetch('/api/rental/counter/return', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        rawList = Array.isArray(data) ? data : (data?.agreements ?? data?.data ?? []);
      } else {
        const fallback = await fetch('/api/rental/agreements?status=ACTIVE&limit=200', { cache: 'no-store' });
        if (fallback.ok) {
          const fbData = await fallback.json();
          rawList = Array.isArray(fbData) ? fbData : (fbData?.data ?? fbData?.agreements ?? []);
        }
      }

      const normalized = (Array.isArray(rawList) ? rawList : []).map((item) =>
        normalizeReturnAgreement((item ?? {}) as Record<string, unknown>)
      );
      setActiveAgreements(normalized);

      if (paramAgreementId) {
        const found = normalized.find(
          (ag) => ag.id === paramAgreementId || ag.agreementNo === paramAgreementId
        );
        if (found) {
          selectAgreementForReturn(found);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load active agreements');
    } finally {
      setLoadingAgreements(false);
    }
  }, [paramAgreementId]);

  function selectAgreementForReturn(ag: ReturnAgreementItem) {
    setSelectedAgreement(ag);
    setSettlementCtx(null);
    setMileageIn(ag.pickupOdometer > 0 ? String(ag.pickupOdometer) : '');
    setFuelIn(ag.pickupFuelEighths);
    setReturnChecklist({ ...ag.pickupChecklist });
    setSixPointClearance({
      brakesOk: true,
      tyresOk: true,
      lightsOk: true,
      fluidsOk: true,
      windshieldOk: true,
      bodySafetyOk: true,
    });
    setGroundForMaintenance(false);
    setReturnWalkaroundMarkers([]);
    setNewDamages([]);
    setReturnPhotos([]);
    setReturnNotes('');
    setSettlementAction(ag.preauth ? 'CAPTURE_INVOICE' : 'NONE');
    setReturnSignature(null);
    setReturnReceipt(null);
    setTelematicsHint(null);
    setError(null);
    setRbacError(null);
    void loadSettlementContext(ag.id);
  }

  // Register service worker once.
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      if (process.env.NODE_ENV === 'production') {
        navigator.serviceWorker.register('/counter-sw.js', { scope: '/rental/counter' }).catch(() => {/* ignore */});
      } else {
        navigator.serviceWorker.getRegistrations()
          .then(rs => rs.forEach(r => r.unregister())).catch(() => {/* ignore */});
        if (typeof caches !== 'undefined') {
          caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {/* ignore */});
        }
      }
    }
    loadBookings();
    loadReturnAgreements();
    loadWalkInCatalogs();
  }, [loadBookings, loadReturnAgreements, loadWalkInCatalogs]);

  /* ── Load Available Vehicles for Booked Reservation OR Walk-In ─────────── */
  useEffect(() => {
    const isWalkIn = pickupSubMode === 'walkin';
    if (!isWalkIn && !selectedBooking) {
      setAvailableVehicles([]);
      return;
    }
    let cancelled = false;
    async function loadVehicles() {
      setLoadingVehicles(true);
      try {
        const pickup = isWalkIn
          ? walkinPickupDate || new Date().toISOString().slice(0, 10)
          : selectedBooking?.pickupDate
            ? selectedBooking.pickupDate.slice(0, 10)
            : new Date().toISOString().slice(0, 10);
        const dropoff = isWalkIn
          ? walkinDropoffDate || pickup
          : selectedBooking?.dropoffDate
            ? selectedBooking.dropoffDate.slice(0, 10)
            : pickup;
        const targetCategory = isWalkIn ? walkinCategory : selectedBooking?.vehicleCategory;
        const params = new URLSearchParams({
          pickupDate: pickup,
          dropoffDate: dropoff,
          startDate: pickup,
          endDate: dropoff,
        });
        if (!showAllCategories && targetCategory) {
          params.set('category', targetCategory);
        }
        const res = await fetch(`/api/rental/availability?${params.toString()}`, { cache: 'no-store' });
        const data = res.ok ? await res.json() : {};
        const rawVehicles = Array.isArray(data) ? data : (data?.vehicles ?? data?.data ?? []);
        if (cancelled) return;

        const mapped: AvailableVehicle[] = (Array.isArray(rawVehicles) ? rawVehicles : []).map(
          (v: Record<string, unknown>) => ({
            id: String(v.id ?? ''),
            plateNo: String(v.plateNo ?? v.plateNumber ?? v.plate_no ?? v.registrationNo ?? 'NO-PLATE'),
            make: String(v.make ?? ''),
            model: String(v.model ?? ''),
            year: v.year ? Number(v.year) : undefined,
            category: v.category ? String(v.category) : v.vehicleType ? String(v.vehicleType) : undefined,
            color: v.color ? String(v.color) : undefined,
            currentMileage: v.currentMileage != null ? Number(v.currentMileage) : v.mileage != null ? Number(v.mileage) : undefined,
          })
        );
        if (!isWalkIn && selectedBooking?.vehicle && !mapped.some((v) => v.id === selectedBooking.vehicle!.id)) {
          mapped.unshift(selectedBooking.vehicle);
        }
        setAvailableVehicles(mapped);

        if (!isWalkIn && selectedBooking?.vehicleId) {
          setSelectedVehicleId(selectedBooking.vehicleId);
          const preVeh = mapped.find((v) => v.id === selectedBooking.vehicleId);
          if (preVeh?.currentMileage && !mileageOut) {
            setMileageOut(String(preVeh.currentMileage));
          }
        } else if (mapped.length > 0 && (!selectedVehicleId || !mapped.some((v) => v.id === selectedVehicleId))) {
          setSelectedVehicleId(mapped[0].id);
          if (mapped[0].currentMileage != null) {
            setMileageOut(String(mapped[0].currentMileage));
          }
        }
      } catch {
        if (!cancelled) setAvailableVehicles([]);
      } finally {
        if (!cancelled) setLoadingVehicles(false);
      }
    }
    loadVehicles();
    return () => {
      cancelled = true;
    };
  }, [pickupSubMode, selectedBooking, showAllCategories, walkinPickupDate, walkinDropoffDate, walkinCategory]);

  /* ── 1-Click Telematics CAN-Bus Pre-Fill ───────────────────────────────── */
  async function fetchTelematicsPreFill(vehicleId: string | null | undefined, target: CounterMode) {
    if (!vehicleId) {
      setError('Please select a vehicle plate first to read live CAN-Bus telematics.');
      return;
    }
    setTelematicsBusy(true);
    setTelematicsHint(null);
    try {
      const res = await fetch(
        `/api/rental/counter/telematics?vehicleId=${encodeURIComponent(vehicleId)}`,
        { cache: 'no-store' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTelematicsHint(json.error ?? `Telematics unavailable (${res.status})`);
        return;
      }
      const tele = (json.telemetry ?? json.data ?? json) as Record<string, unknown>;
      const odo = Number(
        tele.odometerKm ?? tele.currentMileage ?? tele.odometer ?? tele.mileage ?? NaN,
      );
      const fuelPct = Number(
        tele.fuelPct ?? tele.fuelLevelPct ?? tele.fuelLevel ?? tele.fuel ?? NaN,
      );
      if (Number.isFinite(odo) && odo >= 0) {
        if (target === 'pickup') setMileageOut(String(Math.round(odo)));
        else setMileageIn(String(Math.round(odo)));
      }
      if (Number.isFinite(fuelPct) && fuelPct >= 0) {
        const clampedPct = Math.max(0, Math.min(100, fuelPct));
        if (target === 'pickup') setFuelOut(pctToEighths(clampedPct));
        else setFuelIn(pctToEighths(clampedPct));
      }
      setTelematicsHint(
        `CAN-Bus Synced: ${Number.isFinite(odo) ? `${Math.round(odo).toLocaleString()} km` : '—'} · ${
          Number.isFinite(fuelPct) ? `${Math.round(fuelPct)}% fuel` : '—'
        }`,
      );
    } catch (err) {
      setTelematicsHint(err instanceof Error ? err.message : 'Telematics sync failed');
    } finally {
      setTelematicsBusy(false);
    }
  }

  /* ── 1-Click KYC Document Scan (Emirates ID / Driving License) ─────────── */
  async function handleKycScan(file: File) {
    setKycBusy(true);
    setKycHint(null);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('docType', 'DRIVING_LICENSE');
      if (pickupSubMode === 'walkin' && walkinCustomerId) {
        fd.append('customerId', walkinCustomerId);
      } else if (selectedBooking?.customerId) {
        fd.append('customerId', selectedBooking.customerId);
      }
      const res = await fetch('/api/rental/documents/kyc-scan', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setKycHint(json.error ?? `KYC scan returned ${res.status}`);
        return;
      }
      const extracted = (json.extracted ?? json.data ?? json) as Record<string, unknown>;
      const scannedName = String(extracted.fullName ?? extracted.name ?? '').trim();
      const scannedLic = String(extracted.licenseNumber ?? extracted.drivingLicenseNo ?? extracted.idNumber ?? '').trim();
      const scannedExp = String(extracted.expiryDate ?? extracted.licenseExpiry ?? '').slice(0, 10);
      if (scannedName && pickupSubMode === 'walkin' && !walkinCustomerId) {
        setWalkinCustomerSearch(scannedName);
        const match = walkinCustomers.find(
          (c) =>
            c.fullName.toLowerCase().includes(scannedName.toLowerCase()) ||
            (scannedLic && c.drivingLicenseNo === scannedLic),
        );
        if (match) setWalkinCustomerId(match.id);
      }
      if (scannedName && !drvDraft.fullName) {
        setDrvDraft((p) => ({
          ...p,
          fullName: scannedName,
          drivingLicenseNo: scannedLic || p.drivingLicenseNo,
          licenseExpiry: scannedExp || p.licenseExpiry,
        }));
      }
      setKycHint(
        `KYC Verified: ${scannedName || 'Document scanned'}${scannedLic ? ` · Lic #${scannedLic}` : ''}${scannedExp ? ` (Exp ${scannedExp})` : ''}`,
      );
    } catch (err) {
      setKycHint(err instanceof Error ? err.message : 'KYC scan failed');
    } finally {
      setKycBusy(false);
    }
  }

  function addAdditionalDriver() {
    if (!drvDraft.fullName.trim() || !drvDraft.drivingLicenseNo.trim() || !drvDraft.licenseExpiry) {
      setError('Additional driver requires full name, license number, and license expiry date.');
      return;
    }
    setError(null);
    setAdditionalDrivers((prev) => [
      ...prev,
      {
        fullName: drvDraft.fullName.trim(),
        drivingLicenseNo: drvDraft.drivingLicenseNo.trim(),
        licenseExpiry: drvDraft.licenseExpiry,
        licenseIssuingCountry: drvDraft.licenseIssuingCountry.trim().toUpperCase() || 'AE',
        internationalPermitNo: drvDraft.internationalPermitNo.trim() || undefined,
        feeAmount: Math.max(0, parseFloat(drvDraft.feeAmount) || 0),
      },
    ]);
    setDrvDraft({
      fullName: '',
      drivingLicenseNo: '',
      licenseExpiry: '',
      licenseIssuingCountry: 'AE',
      internationalPermitNo: '',
      feeAmount: '50',
    });
  }

  /* ── Photo Upload & AI Damage Classifier ───────────────────────────────── */
  async function handlePhotoUpload(file: File, target?: CounterMode) {
    const activeMode = target ?? mode;
    setUploadingPhoto(true);
    setError(null);
    try {
      const entityType = activeMode === 'return' ? 'AGREEMENT' : pickupSubMode === 'walkin' ? 'CUSTOMER' : 'BOOKING';
      const entityId =
        activeMode === 'return'
          ? selectedAgreement?.id
          : pickupSubMode === 'walkin'
            ? walkinCustomerId
            : selectedBooking?.id;
      if (!entityId) {
        throw new Error(
          activeMode === 'return'
            ? 'Please select an active agreement before uploading photos.'
            : pickupSubMode === 'walkin'
              ? 'Please select a walk-in customer before uploading photos.'
              : 'Please select a booking before uploading photos.'
        );
      }
      const fd = new FormData();
      fd.append('file', file);
      fd.append('entityType', entityType);
      fd.append('entityId', entityId);
      fd.append('docType', 'VEHICLE_PHOTO');
      fd.append('docName', `Counter ${activeMode} photo - ${file.name}`);
      const res = await fetch('/api/rental/documents/upload', { method: 'POST', body: fd });
      const resJson = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resJson.error ?? `Upload failed (${res.status})`);
      const resolvedUrl =
        resJson.url ?? resJson.fileUrl ?? resJson.document?.fileUrl ?? resJson.storage?.url;
      if (!resolvedUrl) throw new Error('Photo upload did not return a valid file URL');
      const item: PhotoItem = {
        url: String(resolvedUrl),
        name: file.name,
        size: file.size,
      };
      if (activeMode === 'pickup') setPickupPhotos((p) => [...p, item]);
      else setReturnPhotos((p) => [...p, item]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo upload failed');
    } finally {
      setUploadingPhoto(false);
    }
  }

  /* ── Authorize Card Pre-Auth Hold on Pick-Up ───────────────────────────── */
  async function submitPickupPreauth() {
    if (!selectedBooking) return;
    const amt = parseFloat(preauthAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Please enter a valid positive pre-authorization amount.');
      return;
    }
    const last4 = preauthCardLast4.trim();
    if (!/^\d{4}$/.test(last4)) {
      setError('Please enter the last 4 digits of the card.');
      return;
    }
    setPreauthBusy(true);
    setError(null);
    setRbacError(null);
    try {
      const res = await fetch('/api/rental/preauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: selectedBooking.id,
          customerId: selectedBooking.customerId,
          amount: amt,
          cardBrand: preauthCardBrand,
          cardLast4: last4,
          cardholderName: preauthCardholder.trim() || selectedBooking.customerName,
        }),
      });
      const resJson = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacError(resJson.error ?? 'Requires counter operator or manager permission to authorize card holds.');
        return;
      }
      if (!res.ok) {
        setError(resJson.error ?? `Pre-authorization failed (${res.status})`);
        return;
      }
      const createdHold =
        normalizePreAuth(resJson.preauth ?? resJson.hold ?? resJson.data ?? resJson) ?? {
          authCode: 'AUTH-HOLD',
          amount: amt,
          cardBrand: preauthCardBrand,
          cardLast4: last4,
          cardholderName: preauthCardholder.trim() || selectedBooking.customerName,
          status: 'AUTHORIZED',
        };
      const updatedBooking: BookingOption = {
        ...selectedBooking,
        preauth: createdHold,
      };
      setSelectedBooking(updatedBooking);
      setBookings((prev) => prev.map((b) => (b.id === updatedBooking.id ? updatedBooking : b)));
      setShowPreauthForm(false);
      setPreauthCardLast4('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authorize card hold');
    } finally {
      setPreauthBusy(false);
    }
  }

  async function classifyLastPhoto(photosList: PhotoItem[], importDiffForReturn = false) {
    if (photosList.length === 0) return;
    const lastPhoto = photosList[photosList.length - 1];
    setAiBusy(true);
    setAiHint(null);
    try {
      const photoRes = await fetch(lastPhoto.url);
      const blob = await photoRes.blob();
      const fd = new FormData();
      fd.append('photo', new File([blob], lastPhoto.name, { type: blob.type }));
      const res = await fetch('/api/rental/damage-claims/classify', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        setAiHint(`AI: ${json.error ?? `error ${res.status}`}`);
        return;
      }
      const c = json.classification;
      const detectedList: Array<Record<string, unknown>> = Array.isArray(c?.damages) ? c.damages : [];
      if (importDiffForReturn && selectedAgreement && detectedList.length > 0) {
        const baselineZones = new Set(
          selectedAgreement.pickupDamageMarkers.map((m) => String(m.zone ?? '').toUpperCase()),
        );
        const imported: StructuredNewDamage[] = [];
        for (const dmg of detectedList) {
          const zRaw = String(dmg.zone ?? dmg.panel ?? 'FRONT_BUMPER').toUpperCase();
          if (baselineZones.has(zRaw)) continue;
          const sevRaw = String(dmg.severity ?? 'MINOR').toUpperCase();
          const sev: ReturnDamageSeverity =
            sevRaw === 'SEVERE' || sevRaw === 'MAJOR'
              ? 'SEVERE'
              : sevRaw === 'MODERATE'
                ? 'MODERATE'
                : 'MINOR';
          const est = Number(dmg.estimatedCost ?? (sev === 'SEVERE' ? 2200 : sev === 'MODERATE' ? 850 : 350));
          imported.push({
            id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            zone: DAMAGE_ZONE_OPTIONS.some((o) => o.value === zRaw) ? zRaw : 'FRONT_BUMPER',
            severity: sev,
            description: String(dmg.description ?? dmg.type ?? 'AI-detected return damage'),
            estimatedCost: est,
          });
        }
        if (imported.length > 0) {
          setNewDamages((prev) => [...prev, ...imported]);
        }
        setAiHint(
          `AI Scan Diff: ${detectedList.length} total detected · ${imported.length} NEW post-pickup item(s) imported (est. AED ${c.billableEstimateMin}-${c.billableEstimateMax}).`,
        );
      } else {
        setAiHint(
          `AI found ${detectedList.length} damage(s) — overall ${c.overallCondition}, billable est. AED ${c.billableEstimateMin}-${c.billableEstimateMax}.`
        );
      }
    } catch (err) {
      setAiHint(err instanceof Error ? `AI error: ${err.message}` : 'AI request failed');
    } finally {
      setAiBusy(false);
    }
  }

  /* ── Submit Pick-Up Handover (Booked Reservation OR Walk-In Direct Checkout) ── */
  async function submitPickup() {
    const isWalkIn = pickupSubMode === 'walkin';
    if (!isWalkIn && !selectedBooking) return;
    if (isWalkIn && (!walkinCustomerId || !selectedVehicleId || !walkinPickupDate || !walkinDropoffDate)) {
      setError('Walk-In checkout requires customer, pickup/dropoff dates, and a concrete vehicle plate.');
      return;
    }
    setPickupBusy(true);
    setError(null);
    setRbacError(null);
    try {
      const ancillariesPayload = Object.entries(selectedAncillaryQtys)
        .filter(([, q]) => q > 0)
        .map(([ancillaryId, quantity]) => ({ ancillaryId, quantity }));

      const payload: Record<string, unknown> = {
        vehicleId: selectedVehicleId || selectedBooking?.vehicleId || undefined,
        mileageOut: parseInt(mileageOut, 10) || 0,
        fuelOut,
        fuelOutPct: Math.round((fuelOut / 8) * 100),
        fuelUnit: 'EIGHTHS',
        checklist: pickupChecklist,
        damageMarkers: pickupMarkers,
        photoUrls: pickupPhotos.map((p) => p.url),
        notes: pickupNotes.trim() || undefined,
        signatureDataUrl: pickupSignature ?? undefined,
        ...(ancillariesPayload.length > 0 ? { ancillaries: ancillariesPayload } : {}),
        ...(additionalDrivers.length > 0 ? { additionalDrivers } : {}),
      };

      if (isWalkIn) {
        payload.customerId = walkinCustomerId;
        payload.vehicleCategory = walkinCategory;
        payload.pickupDate = walkinPickupDate;
        payload.dropoffDate = walkinDropoffDate;
        if (walkinDailyRate.trim()) payload.dailyRate = Number(walkinDailyRate);
        if (walkinDeposit.trim()) payload.securityDeposit = Number(walkinDeposit);
      } else if (selectedBooking) {
        payload.bookingId = selectedBooking.id;
      }

      const res = await fetch('/api/rental/counter/handover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacError(data.error ?? 'Requires counter operator or manager permission.');
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `Server returned ${res.status}`);
        return;
      }
      const assignedVeh = availableVehicles.find((v) => v.id === selectedVehicleId);
      setPickupDone({
        agreementId: data.agreement?.id,
        agreementNo: data.agreement?.agreementNo ?? data.agreementNo ?? 'RA-CREATED',
        vehiclePlate: assignedVeh?.plateNo,
        tarrashudStatus: data.regulatoryReport?.status ?? null,
      });
      loadBookings();
      loadReturnAgreements();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Handover submission failed');
    } finally {
      setPickupBusy(false);
    }
  }

  function resetPickup() {
    setSelectedBooking(null);
    setSelectedVehicleId('');
    setMileageOut('');
    setFuelOut(8);
    setPickupChecklist(defaultChecklist(true));
    setPickupMarkers([]);
    setPickupPhotos([]);
    setPickupNotes('');
    setPickupSignature(null);
    setSelectedAncillaryQtys({});
    setAdditionalDrivers([]);
    setPickupDone(null);
    setAiHint(null);
    setTelematicsHint(null);
    setKycHint(null);
    setError(null);
    setRbacError(null);
  }

  /* ── Add Structured New Damage (Return) ────────────────────────────────── */
  function addNewDamageItem() {
    if (!dmgDraft.description.trim()) {
      setError('Please enter a brief description for the new damage item.');
      return;
    }
    setError(null);
    const cost = Math.max(0, parseFloat(dmgDraft.estimatedCost) || 0);
    setNewDamages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        zone: dmgDraft.zone,
        severity: dmgDraft.severity,
        description: dmgDraft.description.trim(),
        estimatedCost: cost,
      },
    ]);
    setDmgDraft((prev) => ({
      ...prev,
      description: '',
    }));
  }

  /* ── Submit Return & Settlement ────────────────────────────────────────── */
  async function submitReturn() {
    if (!selectedAgreement) return;
    const odoIn = parseInt(mileageIn, 10);
    if (Number.isNaN(odoIn) || odoIn < 0) {
      setError('Please enter a valid return odometer reading.');
      return;
    }
    setReturnBusy(true);
    setError(null);
    setRbacError(null);
    try {
      const combinedDamageMarkers = [
        ...returnWalkaroundMarkers.map((m) => ({
          zone: m.zone,
          zoneId: m.zone,
          type: m.type,
          severity: m.severity === 'MAJOR' ? 'SEVERE' : m.severity,
          description: m.note ?? `${m.type} on ${m.zone}`,
          estimatedCost: m.severity === 'MAJOR' ? 2000 : m.severity === 'MODERATE' ? 800 : 300,
          x: m.x,
          y: m.y,
        })),
        ...newDamages.map((d) => ({
          zone: d.zone,
          zoneId: d.zone,
          type: 'OTHER',
          severity: d.severity,
          description: d.description,
          estimatedCost: d.estimatedCost,
          estimatedRepairCost: d.estimatedCost,
        })),
      ];

      const photoUrlList = returnPhotos.map((p) => p.url);
      const res = await fetch('/api/rental/counter/return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agreementId: selectedAgreement.id,
          mileageIn: odoIn,
          fuelIn,
          fuelInPct: Math.round((fuelIn / 8) * 100),
          fuelUnit: 'EIGHTHS',
          checklist: returnChecklist,
          sixPointClearance,
          groundVehicleForMaintenance: groundForMaintenance,
          newDamageMarkers: combinedDamageMarkers,
          newDamages: combinedDamageMarkers,
          damageMarkers: combinedDamageMarkers,
          damagePhotos: photoUrlList,
          photoUrls: photoUrlList,
          returnNotes: returnNotes.trim() || undefined,
          notes: returnNotes.trim() || undefined,
          settlementAction,
          signatureDataUrl: returnSignature ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacError(
          data.error ??
            'Requires RAC Manager permission — Operators cannot release security deposits directly. Select "None" or "Capture Invoice", or ask a RAC Manager.'
        );
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `Return failed (${res.status})`);
        return;
      }

      const inv = (data.invoice ?? data.settlement ?? data) as Record<string, unknown>;
      const resolvedInvNo = String(
        data.invoiceNumber ??
        inv.invoiceNumber ??
        inv.invoiceNo ??
        inv.invoice_no ??
        ''
      ).trim();
      setReturnReceipt({
        agreementId: selectedAgreement.id,
        invoiceId: inv.id ? String(inv.id) : data.invoiceId ? String(data.invoiceId) : undefined,
        invoiceNumber: resolvedInvNo || 'INV-ISSUED',
        currency: String(inv.currency ?? selectedAgreement.currency ?? 'AED'),
        subtotal: Number(data.subtotal ?? inv.subtotal ?? inv.baseRentalCharge ?? selectedAgreement.totalAmount ?? 0),
        lateFee: Number(data.lateFee ?? inv.lateFee ?? 0),
        excessKmCharge: Number(data.excessKmCharge ?? inv.excessKmCharge ?? 0),
        fuelSurcharge: Number(data.fuelSurcharge ?? inv.fuelSurcharge ?? 0),
        damageCharges: Number(data.damageCharges ?? inv.damageCharges ?? 0),
        taxAmount: Number(data.taxAmount ?? inv.taxAmount ?? 0),
        totalAmount: Number(data.totalAmount ?? inv.totalAmount ?? 0),
        preauthResult: data.preauthResult ?? data.preAuthResult ?? data.depositResult ?? null,
        vehicleStatusAfterReturn: data.vehicleStatusAfterReturn ?? null,
        sixPointClearancePassed: data.sixPointClearancePassed,
        regulatoryReport: data.regulatoryReport ?? null,
      });
      loadReturnAgreements();
      loadBookings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Return check-in failed');
    } finally {
      setReturnBusy(false);
    }
  }

  /* ── Filtered Lists & Live Multi-Segment / Pro-Forma Calculations ──────── */
  const filteredBookings = bookings.filter((b) => {
    const q = bookingSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      (b.bookingRef ?? '').toLowerCase().includes(q) ||
      b.customerName.toLowerCase().includes(q) ||
      (b.companyName ?? '').toLowerCase().includes(q) ||
      (b.vehicleCategory ?? '').toLowerCase().includes(q)
    );
  });

  const filteredWalkInCustomers = walkinCustomers.filter((c) => {
    const q = walkinCustomerSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      c.fullName.toLowerCase().includes(q) ||
      (c.companyName ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').toLowerCase().includes(q) ||
      (c.drivingLicenseNo ?? '').toLowerCase().includes(q)
    );
  });

  const filteredAgreements = activeAgreements.filter((ag) => {
    const q = agreementSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      ag.agreementNo.toLowerCase().includes(q) ||
      ag.customerName.toLowerCase().includes(q) ||
      ag.vehiclePlate.toLowerCase().includes(q) ||
      ag.vehicleName.toLowerCase().includes(q) ||
      (ag.bookingRef ?? '').toLowerCase().includes(q)
    );
  });

  const parsedMileageIn = parseInt(mileageIn, 10);
  const returnFuelPctLive = Math.round((fuelIn / 8) * 100);
  const swaps = settlementCtx?.vehicleExchanges ?? [];
  const lastSwap = swaps.length > 0 ? swaps[swaps.length - 1] : null;
  const minAllowedOdo = lastSwap
    ? lastSwap.toMileageOut
    : (selectedAgreement?.pickupOdometer ?? 0);

  const kmDriven = (() => {
    if (!selectedAgreement || Number.isNaN(parsedMileageIn)) return 0;
    if (swaps.length === 0) {
      return Math.max(0, parsedMileageIn - selectedAgreement.pickupOdometer);
    }
    let sum = Math.max(0, swaps[0].fromMileageIn - selectedAgreement.pickupOdometer);
    for (let i = 0; i < swaps.length - 1; i++) {
      sum += Math.max(0, swaps[i + 1].fromMileageIn - swaps[i].toMileageOut);
    }
    sum += Math.max(0, parsedMileageIn - swaps[swaps.length - 1].toMileageOut);
    return sum;
  })();

  const totalFuelDeficitPctLive = (() => {
    if (!selectedAgreement) return 0;
    if (swaps.length === 0) {
      return Math.max(0, selectedAgreement.pickupFuelPct - returnFuelPctLive);
    }
    let def = Math.max(0, selectedAgreement.pickupFuelPct - swaps[0].fromFuelIn);
    for (let i = 0; i < swaps.length - 1; i++) {
      def += Math.max(0, swaps[i].toFuelOut - swaps[i + 1].fromFuelIn);
    }
    def += Math.max(0, swaps[swaps.length - 1].toFuelOut - returnFuelPctLive);
    return def;
  })();

  const odoBelowBaseline =
    selectedAgreement != null &&
    mileageIn !== '' &&
    !Number.isNaN(parsedMileageIn) &&
    parsedMileageIn < minAllowedOdo;

  const fuelDiffEighths = selectedAgreement
    ? fuelIn - (lastSwap ? pctToEighths(lastSwap.toFuelOut) : selectedAgreement.pickupFuelEighths)
    : 0;
  const walkaroundEstCost = returnWalkaroundMarkers.reduce(
    (sum, m) => sum + (m.severity === 'MAJOR' ? 2000 : m.severity === 'MODERATE' ? 800 : 300),
    0
  );
  const structuredDamageCost = newDamages.reduce((sum, d) => sum + d.estimatedCost, 0);
  const totalEstimatedNewDamage = walkaroundEstCost + structuredDamageCost;

  const sixPointFailedLive =
    !sixPointClearance.brakesOk ||
    !sixPointClearance.tyresOk ||
    !sixPointClearance.lightsOk ||
    !sixPointClearance.fluidsOk ||
    !sixPointClearance.windshieldOk ||
    !sixPointClearance.bodySafetyOk ||
    groundForMaintenance ||
    returnWalkaroundMarkers.some((m) => m.severity === 'MAJOR') ||
    newDamages.some((d) => d.severity === 'SEVERE');

  const proForma = (() => {
    const rule = settlementCtx?.pricingRule;
    const baseRental = rule ? rule.subtotal : (selectedAgreement?.totalAmount ?? 0);
    const discount = rule ? rule.discountAmount : 0;
    const includedKm = rule ? rule.includedKmPerDay * Math.max(1, rule.totalDays) : 250;
    const excessKm = Math.max(0, kmDriven - includedKm);
    const excessKmCharge = rule && rule.excessKmRate > 0 ? Number((excessKm * rule.excessKmRate).toFixed(2)) : 0;
    const fuelSurcharge = Number((totalFuelDeficitPctLive * 5).toFixed(2));

    let lateFee = 0;
    if (selectedAgreement?.endDate && rule && rule.lateFeePerHour > 0) {
      const graceMs = (rule.gracePeriodMin ?? 30) * 60_000;
      const diffMs = Date.now() - new Date(selectedAgreement.endDate).getTime();
      if (diffMs > graceMs) {
        const hrs = Math.ceil((diffMs - graceMs) / 3_600_000);
        lateFee = Number((hrs * rule.lateFeePerHour).toFixed(2));
        if (rule.lateFeeCap > 0) lateFee = Math.min(lateFee, rule.lateFeeCap);
      }
    }

    const extrasTaxable = (settlementCtx?.additionalCharges ?? [])
      .filter((c) => !['FINE', 'TRAFFIC_FINE', 'STATUTORY_FINE', 'KNOWLEDGE_FEE', 'INNOVATION_FEE'].includes(c.chargeType))
      .reduce((s, c) => s + c.preVatTotal, 0);
    const extrasOutOfScope = (settlementCtx?.additionalCharges ?? [])
      .filter((c) => ['FINE', 'TRAFFIC_FINE', 'STATUTORY_FINE', 'KNOWLEDGE_FEE', 'INNOVATION_FEE'].includes(c.chargeType))
      .reduce((s, c) => s + c.preVatTotal, 0);

    const fineStatutory0Pct = (settlementCtx?.unbilledTrafficFines ?? []).reduce(
      (s, f) => s + f.fineAmount + f.knowledgeFee,
      0,
    );
    const fineAdmin5Pct = (settlementCtx?.unbilledTrafficFines ?? []).reduce((s, f) => s + f.adminFee, 0);
    const tollsAndAdmin5Pct = (settlementCtx?.unbilledTolls ?? []).reduce(
      (s, t) => s + t.amount + t.adminFee,
      0,
    );

    const taxableSupply = Math.max(
      0,
      baseRental -
        discount +
        extrasTaxable +
        lateFee +
        excessKmCharge +
        fuelSurcharge +
        totalEstimatedNewDamage +
        fineAdmin5Pct +
        tollsAndAdmin5Pct,
    );
    const outOfScopeTotal = extrasOutOfScope + fineStatutory0Pct;
    const vat5Pct = Number(((taxableSupply * 5) / 100).toFixed(2));
    const subtotalPreVat = Number((taxableSupply + outOfScopeTotal).toFixed(2));
    const grossTotal = Number((subtotalPreVat + vat5Pct).toFixed(2));
    const holdOrDeposit =
      selectedAgreement?.preauth?.amount ??
      (selectedAgreement?.depositStatus?.toUpperCase() === 'PAID' ? selectedAgreement.securityDeposit : 0);
    const netBalanceAfterHold = Number((grossTotal - holdOrDeposit).toFixed(2));

    return {
      baseRental,
      extrasTaxable,
      lateFee,
      includedKm,
      excessKm,
      excessKmCharge,
      fuelSurcharge,
      fineStatutory0Pct,
      fineAdmin5Pct,
      tollsAndAdmin5Pct,
      vat5Pct,
      grossTotal,
      holdOrDeposit,
      netBalanceAfterHold,
    };
  })();

  function switchMode(nextMode: CounterMode) {
    setMode(nextMode);
    setError(null);
    setRbacError(null);
    setAiHint(null);
    router.replace(`/rental/counter?mode=${nextMode}`);
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16">
      {/* Top Counter Header & Segmented Mode Switch */}
      <div className="bg-[var(--bg-surface)]/80 border border-[var(--border-subtle)] rounded-2xl p-5 backdrop-blur-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-teal-500/20 text-teal-300 border border-teal-500/30 mb-1">
              <ArrowRightLeft className="h-3 w-3" /> Unified Counter Desk
            </div>
            <h1 className="text-2xl font-bold text-[var(--text-main)]">
              RAC Pick-Up &amp; Return Counter
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Single-screen check-out handover, plate assignment, return inspection, card pre-auth capture &amp; settlement
            </p>
          </div>

          {/* Segmented Mode Switch */}
          <div className="grid grid-cols-2 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl p-1 min-w-[320px]">
            <button
              type="button"
              onClick={() => switchMode('pickup')}
              className={`px-4 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                mode === 'pickup'
                  ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white shadow'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              <Car className="h-4 w-4" />
              Pick-Up (Check-Out)
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-black/20">
                {bookings.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => switchMode('return')}
              className={`px-4 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                mode === 'return'
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              <Receipt className="h-4 w-4" />
              Return (Check-In)
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-black/20">
                {activeAgreements.length}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* RBAC 403 Alert */}
      {rbacError && (
        <div className="rounded-xl bg-amber-500/15 border border-amber-500/40 p-4 text-amber-200 text-sm flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-amber-300">Requires RAC Manager Permission</div>
              <div className="text-xs mt-0.5">{rbacError}</div>
            </div>
          </div>
          <button onClick={() => setRbacError(null)} className="text-amber-300 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* General Error Alert */}
      {error && (
        <div className="rounded-xl bg-rose-900/35 border border-rose-700 p-4 text-rose-200 text-sm flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          TAB 1: PICK-UP (CHECK-OUT / HANDOVER)
         ═══════════════════════════════════════════════════════════════════════ */}
      {mode === 'pickup' && (
        <>
          {pickupDone ? (
            <div className="rounded-2xl bg-emerald-900/25 border border-emerald-500/40 p-8 text-center space-y-4">
              <CheckCircle2 className="h-14 w-14 text-emerald-400 mx-auto" />
              <div>
                <h2 className="text-2xl font-bold text-[var(--text-main)]">Pick-Up Handover Complete</h2>
                  <p className="text-sm text-emerald-200 mt-1">
                  Booking is now <strong>ACTIVE</strong>. Rental Agreement{' '}
                  <span className="font-mono font-bold text-white">{pickupDone.agreementNo}</span> has been issued
                  {pickupDone.vehiclePlate ? ` for plate ${pickupDone.vehiclePlate}` : ''}.
                  {pickupDone.tarrashudStatus ? ` · UAE Tarrashud: ${pickupDone.tarrashudStatus}` : ''}
                </p>
              </div>
              <div className="flex gap-3 justify-center flex-wrap pt-2">
                <Link
                  href="/rental/agreements"
                  className="px-4 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs font-semibold hover:bg-[var(--bg-surface-hover)]"
                >
                  View Agreements
                </Link>
                {pickupDone.agreementId && (
                  <button
                    type="button"
                    onClick={() => {
                      resetPickup();
                      router.replace(`/rental/counter?mode=return&agreementId=${pickupDone.agreementId}`);
                      setMode('return');
                    }}
                    className="px-4 py-2.5 rounded-xl bg-violet-600/30 border border-violet-500/40 text-violet-200 text-xs font-semibold hover:bg-violet-600/40"
                  >
                    Open in Return Desk →
                  </button>
                )}
                <button
                  type="button"
                  onClick={resetPickup}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-semibold hover:opacity-90 flex items-center gap-1.5"
                >
                  <Plus className="h-4 w-4" /> Next Pick-Up Handover
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* LEFT COLUMN: Step 1 — Booked Reservation OR Walk-In Direct Checkout */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-4 space-y-3">
                  {/* Sub-mode Toggle + KYC Quick Scan */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="grid grid-cols-2 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg p-0.5 flex-1">
                      <button
                        type="button"
                        onClick={() => {
                          setPickupSubMode('booked');
                          setError(null);
                        }}
                        className={`py-1.5 px-2.5 rounded-md text-xs font-semibold transition ${
                          pickupSubMode === 'booked'
                            ? 'bg-teal-600 text-white'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                        }`}
                      >
                        Booked Reservation ({filteredBookings.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPickupSubMode('walkin');
                          setSelectedBooking(null);
                          setError(null);
                        }}
                        className={`py-1.5 px-2.5 rounded-md text-xs font-semibold transition ${
                          pickupSubMode === 'walkin'
                            ? 'bg-cyan-600 text-white'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                        }`}
                      >
                        Walk-In Checkout
                      </button>
                    </div>

                    <input
                      ref={kycFileRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleKycScan(f);
                        if (kycFileRef.current) kycFileRef.current.value = '';
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => kycFileRef.current?.click()}
                      disabled={kycBusy}
                      title="Scan Emirates ID or Driving License"
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-600/25 border border-indigo-500/40 text-indigo-200 text-xs font-semibold hover:bg-indigo-600/35 flex items-center gap-1 flex-shrink-0"
                    >
                      {kycBusy ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
                      KYC Scan
                    </button>
                  </div>

                  {kycHint && (
                    <div className="text-[11px] px-3 py-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-200">
                      {kycHint}
                    </div>
                  )}

                  {pickupSubMode === 'booked' ? (
                    <>
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider">
                          1. Select Booking
                        </h2>
                        <span className="text-xs text-[var(--text-muted)]">
                          {filteredBookings.length} ready
                        </span>
                      </div>
                      <input
                        type="search"
                        value={bookingSearch}
                        onChange={(e) => setBookingSearch(e.target.value)}
                        placeholder="Search ref, customer, corporate, category…"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-teal-500 focus:outline-none"
                      />

                      <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                        {loadingBookings ? (
                          <div className="p-8 text-center text-sm text-[var(--text-muted)] animate-pulse">
                            Loading bookings…
                          </div>
                        ) : filteredBookings.length === 0 ? (
                          <div className="p-8 rounded-xl bg-[var(--bg-canvas)]/50 border border-[var(--border-subtle)] text-center text-xs text-[var(--text-muted)]">
                            No CONFIRMED or PENDING bookings awaiting pick-up.
                          </div>
                        ) : (
                          filteredBookings.map((b) => {
                            const isSelected = selectedBooking?.id === b.id;
                            return (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => selectBookingForPickup(b)}
                                className={`w-full text-left p-3.5 rounded-xl border transition flex items-center justify-between gap-3 ${
                                  isSelected
                                    ? 'bg-teal-500/15 border-teal-500/50 ring-1 ring-teal-500/40'
                                    : 'bg-[var(--bg-canvas)]/60 border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]/60'
                                }`}
                              >
                                <div className="min-w-0 space-y-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-mono text-cyan-300 text-xs font-semibold">
                                      {b.bookingRef ?? b.id.slice(0, 8)}
                                    </span>
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                        b.status === 'CONFIRMED'
                                          ? 'bg-blue-500/20 text-blue-300'
                                          : 'bg-amber-500/20 text-amber-300'
                                      }`}
                                    >
                                      {b.status}
                                    </span>
                                    {b.vehicle?.plateNo && (
                                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)]">
                                        {b.vehicle.plateNo}
                                      </span>
                                    )}
                                  </div>
                                  <div className="font-semibold text-sm text-[var(--text-main)] truncate">
                                    {b.companyName ?? b.customerName}
                                  </div>
                                  <div className="text-xs text-[var(--text-muted)] truncate">
                                    {b.vehicleCategory ?? 'Standard'} ·{' '}
                                    {b.pickupDate ? new Date(b.pickupDate).toLocaleDateString('en-GB') : '—'} →{' '}
                                    {b.dropoffDate ? new Date(b.dropoffDate).toLocaleDateString('en-GB') : '—'}
                                  </div>
                                  {b.preauth && (
                                    <div className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                                      <CreditCard className="h-3 w-3" />
                                      {b.preauth.authCode} · {b.currency} {b.preauth.amount.toLocaleString()} · **** {b.preauth.cardLast4}
                                    </div>
                                  )}
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <div className="font-bold text-xs text-emerald-300">
                                    {b.currency} {(b.totalAmount ?? 0).toLocaleString()}
                                  </div>
                                  <ChevronRight className="h-4 w-4 text-[var(--text-faint)] ml-auto mt-1" />
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3 pt-1">
                      <h2 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider">
                        1. Walk-In Customer &amp; Rental Window
                      </h2>
                      <div>
                        <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                          Filter Customer (Name, Company, Phone, License #)
                        </label>
                        <input
                          type="search"
                          value={walkinCustomerSearch}
                          onChange={(e) => setWalkinCustomerSearch(e.target.value)}
                          placeholder="Search registered RAC customers…"
                          className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                          Select Customer *
                        </label>
                        <select
                          value={walkinCustomerId}
                          onChange={(e) => setWalkinCustomerId(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                        >
                          <option value="">Choose customer…</option>
                          {filteredWalkInCustomers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.companyName ? `${c.companyName} (${c.fullName})` : c.fullName}
                              {c.drivingLicenseNo ? ` · Lic ${c.drivingLicenseNo}` : ' · No License on File'}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] text-[var(--text-muted)] mb-1">Category *</label>
                          <select
                            value={walkinCategory}
                            onChange={(e) => setWalkinCategory(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                          >
                            {VEHICLE_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-[var(--text-muted)] mb-1">Security Deposit (AED)</label>
                          <input
                            type="number"
                            min="0"
                            value={walkinDeposit}
                            onChange={(e) => setWalkinDeposit(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-main)]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-[var(--text-muted)] mb-1">Pick-Up Date *</label>
                          <input
                            type="date"
                            value={walkinPickupDate}
                            onChange={(e) => setWalkinPickupDate(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-[var(--text-muted)] mb-1">Drop-Off Date *</label>
                          <input
                            type="date"
                            value={walkinDropoffDate}
                            min={walkinPickupDate}
                            onChange={(e) => setWalkinDropoffDate(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                          Daily Rate Override (AED — leave blank for Master Tariff; Manager required)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="5"
                          value={walkinDailyRate}
                          onChange={(e) => setWalkinDailyRate(e.target.value)}
                          placeholder="Auto-quoted from RAC Master Price List"
                          className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-main)]"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT COLUMN: Steps 2-5 — Plate Assignment, Ancillaries/Drivers, Walkaround, Checklist & Signature */}
              <div className="lg:col-span-7 space-y-5">
                {pickupSubMode === 'booked' && !selectedBooking ? (
                  <div className="bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] rounded-2xl p-12 text-center space-y-2">
                    <Car className="h-10 w-10 text-teal-400/60 mx-auto" />
                    <div className="text-base font-semibold text-[var(--text-main)]">
                      Select a booking on the left or switch to Walk-In Checkout
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      Assign an available license plate, record baseline odometer &amp; 8/8 fuel, complete the 7-point safety check, and capture the customer&apos;s signature.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* 2. Vehicle Plate Assignment */}
                    <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <h3 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider">
                            2. Vehicle Plate Assignment
                          </h3>
                          <p className="text-xs text-[var(--text-muted)]">
                            Requested Category:{' '}
                            <strong className="text-teal-300">
                              {pickupSubMode === 'walkin'
                                ? walkinCategory
                                : (selectedBooking?.vehicleCategory ?? 'Any')}
                            </strong>
                          </p>
                        </div>
                        <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showAllCategories}
                            onChange={(e) => setShowAllCategories(e.target.checked)}
                            className="accent-teal-500"
                          />
                          Show all fleet categories (upgrade / substitute)
                        </label>
                      </div>

                      {loadingVehicles ? (
                        <div className="text-xs text-[var(--text-muted)] py-3 animate-pulse">
                          Checking available fleet plates…
                        </div>
                      ) : availableVehicles.length === 0 ? (
                        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200 flex items-center justify-between gap-2">
                          <span>
                            No available vehicles returned for{' '}
                            {pickupSubMode === 'walkin'
                              ? walkinCategory
                              : (selectedBooking?.vehicleCategory || 'this window')}
                            .
                            {selectedBooking?.vehicleId
                              ? ` Pre-assigned vehicle (${selectedBooking.vehicleId.slice(0, 8)}) will be used.`
                              : ' Toggle "Show all fleet categories" to pick an upgrade plate.'}
                          </span>
                        </div>
                      ) : (
                        <select
                          value={selectedVehicleId}
                          onChange={(e) => {
                            const vid = e.target.value;
                            setSelectedVehicleId(vid);
                            const found = availableVehicles.find((v) => v.id === vid);
                            if (found?.currentMileage != null && !mileageOut) {
                              setMileageOut(String(found.currentMileage));
                            }
                          }}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-sm text-[var(--text-main)] focus:border-teal-500 focus:outline-none"
                        >
                          <option value="">Select available plate…</option>
                          {availableVehicles.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.plateNo} — {v.make} {v.model} {v.year ? `(${v.year})` : ''} {v.category ? `· ${v.category}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Ancillaries & Additional Drivers Card */}
                    <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4">
                      <h3 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider flex items-center gap-2">
                        <UserPlus className="h-4 w-4 text-teal-400" />
                        Ancillaries &amp; Authorized Additional Drivers
                      </h3>

                      {ancillaryCatalog.length > 0 && (
                        <div>
                          <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold mb-2">
                            Counter Add-Ons (GPS, Child Seat, PAI, Cross-Border Oman Permit)
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {ancillaryCatalog.map((anc) => {
                              const qty = selectedAncillaryQtys[anc.id] ?? 0;
                              return (
                                <div
                                  key={anc.id}
                                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs ${
                                    qty > 0
                                      ? 'bg-teal-500/10 border-teal-500/40 text-teal-200'
                                      : 'bg-[var(--bg-canvas)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="font-semibold truncate text-[var(--text-main)]">{anc.name}</div>
                                    <div className="text-[10px] text-[var(--text-faint)]">
                                      AED {anc.rate}/{anc.pricingMode === 'FLAT' ? 'rental' : 'day'}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSelectedAncillaryQtys((p) => ({
                                          ...p,
                                          [anc.id]: Math.max(0, (p[anc.id] ?? 0) - 1),
                                        }))
                                      }
                                      className="w-6 h-6 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-bold"
                                    >
                                      -
                                    </button>
                                    <span className="w-4 text-center font-mono font-bold">{qty}</span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSelectedAncillaryQtys((p) => ({
                                          ...p,
                                          [anc.id]: Math.min(anc.maxQuantity, (p[anc.id] ?? 0) + 1),
                                        }))
                                      }
                                      className="w-6 h-6 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-bold"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Additional Drivers Builder */}
                      <div className="rounded-xl bg-[var(--bg-canvas)]/70 border border-[var(--border-subtle)] p-3.5 space-y-2.5">
                        <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold">
                          Add Authorized Additional Driver (License Expiry &amp; IDP Checked)
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            placeholder="Driver Full Name *"
                            value={drvDraft.fullName}
                            onChange={(e) => setDrvDraft((p) => ({ ...p, fullName: e.target.value }))}
                            className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                          />
                          <input
                            type="text"
                            placeholder="Driving License No *"
                            value={drvDraft.drivingLicenseNo}
                            onChange={(e) => setDrvDraft((p) => ({ ...p, drivingLicenseNo: e.target.value }))}
                            className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-main)]"
                          />
                          <input
                            type="date"
                            title="License Expiry Date"
                            value={drvDraft.licenseExpiry}
                            onChange={(e) => setDrvDraft((p) => ({ ...p, licenseExpiry: e.target.value }))}
                            className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                          />
                          <input
                            type="text"
                            placeholder="Issuing Country (e.g. AE)"
                            value={drvDraft.licenseIssuingCountry}
                            onChange={(e) => setDrvDraft((p) => ({ ...p, licenseIssuingCountry: e.target.value }))}
                            className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                          />
                          <input
                            type="text"
                            placeholder="IDP # (if non-GCC)"
                            value={drvDraft.internationalPermitNo}
                            onChange={(e) => setDrvDraft((p) => ({ ...p, internationalPermitNo: e.target.value }))}
                            className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                          />
                          <div className="flex gap-1.5">
                            <input
                              type="number"
                              min="0"
                              placeholder="Fee AED"
                              value={drvDraft.feeAmount}
                              onChange={(e) => setDrvDraft((p) => ({ ...p, feeAmount: e.target.value }))}
                              className="w-20 px-2 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-main)]"
                            />
                            <button
                              type="button"
                              onClick={addAdditionalDriver}
                              className="flex-1 px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold"
                            >
                              + Driver
                            </button>
                          </div>
                        </div>

                        {additionalDrivers.length > 0 && (
                          <div className="space-y-1 pt-1">
                            {additionalDrivers.map((d, i) => (
                              <div key={i} className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded bg-teal-500/10 border border-teal-500/30">
                                <span>
                                  <strong>{d.fullName}</strong> · Lic {d.drivingLicenseNo} ({d.licenseIssuingCountry}) · Exp {d.licenseExpiry}
                                  {d.feeAmount ? ` · AED ${d.feeAmount}` : ''}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setAdditionalDrivers((prev) => prev.filter((_, idx) => idx !== i))}
                                  className="text-rose-400 hover:text-rose-200"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 3. Odometer Out, 8-Eighth Fuel Gauge & 7-Point Checklist */}
                    <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-5">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h3 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider">
                          3. Baseline Odometer, Fuel &amp; 7-Point Safety Checklist
                        </h3>
                        <button
                          type="button"
                          onClick={() => void fetchTelematicsPreFill(selectedVehicleId || selectedBooking?.vehicleId, 'pickup')}
                          disabled={telematicsBusy}
                          className="px-3 py-1.5 rounded-lg bg-cyan-600/25 border border-cyan-500/40 text-cyan-200 text-xs font-semibold hover:bg-cyan-600/35 flex items-center gap-1.5"
                        >
                          {telematicsBusy ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5" />}
                          1-Click CAN-Bus Pre-Fill
                        </button>
                      </div>

                      {telematicsHint && mode === 'pickup' && (
                        <div className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-200 font-mono">
                          {telematicsHint}
                        </div>
                      )}

                      <div>
                        <label className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1.5 mb-1.5">
                          <Gauge className="h-3.5 w-3.5 text-teal-400" />
                          Odometer Out at Pick-Up (km) *
                        </label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={mileageOut}
                          onChange={(e) => setMileageOut(e.target.value)}
                          placeholder="e.g. 24500"
                          className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] text-base font-mono focus:border-teal-500 focus:outline-none"
                        />
                      </div>

                      <EighthsFuelGauge
                        value={fuelOut}
                        onChange={setFuelOut}
                        label="Fuel Out (Eighths)"
                      />

                      <div>
                        <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2 font-semibold">
                          7-Point Safety &amp; Accessory Checklist
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {CHECKLIST_ITEMS.map((item) => {
                            const checked = Boolean(pickupChecklist[item.key]);
                            return (
                              <label
                                key={item.key}
                                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs cursor-pointer transition ${
                                  checked
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                    : 'bg-[var(--bg-canvas)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    setPickupChecklist((prev) => ({
                                      ...prev,
                                      [item.key]: e.target.checked,
                                    }))
                                  }
                                  className="accent-emerald-500"
                                />
                                <span className="truncate font-medium">{item.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* 4. Walkaround Damage, Photos & AI Classify */}
                    <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4">
                      <DamageWalkaround markers={pickupMarkers} onChange={setPickupMarkers} />

                      <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                            Pick-Up Walkaround Photos {pickupPhotos.length > 0 && <span className="text-cyan-300">· {pickupPhotos.length}</span>}
                          </span>
                          <input
                            ref={pickupFileRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handlePhotoUpload(file, 'pickup');
                              if (pickupFileRef.current) pickupFileRef.current.value = '';
                            }}
                            className="hidden"
                          />
                          <button
                            type="button"
                            onClick={() => pickupFileRef.current?.click()}
                            disabled={uploadingPhoto}
                            className="px-3.5 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-500 flex items-center gap-1.5 disabled:opacity-40"
                          >
                            {uploadingPhoto ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                            {uploadingPhoto ? 'Uploading…' : 'Add Photo'}
                          </button>
                        </div>

                        {pickupPhotos.length > 0 && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-4 gap-2">
                              {pickupPhotos.map((p, i) => (
                                <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
                                  <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                                  <button
                                    type="button"
                                    onClick={() => setPickupPhotos(pickupPhotos.filter((_, idx) => idx !== i))}
                                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center text-xs"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() => classifyLastPhoto(pickupPhotos)}
                              disabled={aiBusy}
                              className="w-full py-2 rounded-lg bg-violet-600/25 border border-violet-500/40 text-violet-200 text-xs font-medium hover:bg-violet-600/35 disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              {aiBusy ? 'AI analysing latest photo…' : 'AI · Classify Latest Damage Photo'}
                            </button>
                            {aiHint && (
                              <div className="text-xs px-3 py-2 rounded-lg bg-violet-900/30 border border-violet-500/30 text-violet-200">
                                {aiHint}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">Handover Notes (optional)</label>
                        <textarea
                          rows={2}
                          value={pickupNotes}
                          onChange={(e) => setPickupNotes(e.target.value)}
                          placeholder="Existing scuffs noted, child seat fitted, spare key retained…"
                          className="w-full px-3.5 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] resize-none focus:border-teal-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Card Pre-Auth Hold (Security Deposit — Booked Reservation) */}
                    {selectedBooking && (
                      <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4 text-cyan-400" />
                            <h3 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider">
                              Card Pre-Auth Hold
                            </h3>
                          </div>
                          {selectedBooking.preauth ? (
                            <button
                              type="button"
                              onClick={() => setShowPreauthForm((v) => !v)}
                              className="text-xs px-3 py-1 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
                            >
                              {showPreauthForm ? 'Cancel' : 'Replace / New Hold'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setShowPreauthForm((v) => !v)}
                              className="text-xs px-3 py-1.5 rounded-lg bg-cyan-600/25 border border-cyan-500/40 text-cyan-200 font-semibold hover:bg-cyan-600/35"
                            >
                              {showPreauthForm ? 'Hide Form' : '+ Authorize Card Hold'}
                            </button>
                          )}
                        </div>

                        {selectedBooking.preauth ? (
                          <div className="rounded-xl bg-cyan-500/15 border border-cyan-500/40 p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="space-y-0.5">
                              <div className="font-semibold text-cyan-200 flex items-center gap-1.5">
                                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                Pre-Authorization Active ({selectedBooking.preauth.status})
                              </div>
                              <div className="text-[var(--text-muted)]">
                                Authorized via B2B Portal / Counter Desk · Ready for return settlement capture
                              </div>
                            </div>
                            <div className="font-mono font-bold text-cyan-300 text-right">
                              <div>
                                {selectedBooking.preauth.authCode} · {selectedBooking.currency}{' '}
                                {selectedBooking.preauth.amount.toLocaleString()}
                              </div>
                              <div className="text-[11px] text-cyan-200/80">
                                {selectedBooking.preauth.cardBrand ? `${selectedBooking.preauth.cardBrand} ` : ''}****{' '}
                                {selectedBooking.preauth.cardLast4}
                              </div>
                            </div>
                          </div>
                        ) : (
                          !showPreauthForm && (
                            <p className="text-xs text-[var(--text-muted)]">
                              No card pre-authorization hold on file yet. Place a security deposit hold before vehicle release if paying by card.
                            </p>
                          )
                        )}

                        {showPreauthForm && (
                          <div className="rounded-xl bg-[var(--bg-canvas)]/70 border border-[var(--border-subtle)] p-4 space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                                  Hold Amount ({selectedBooking.currency}) *
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  step="0.01"
                                  value={preauthAmount}
                                  onChange={(e) => setPreauthAmount(e.target.value)}
                                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-main)] focus:border-cyan-500 focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Card Brand *</label>
                                <select
                                  value={preauthCardBrand}
                                  onChange={(e) => setPreauthCardBrand(e.target.value)}
                                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:border-cyan-500 focus:outline-none"
                                >
                                  <option value="VISA">VISA</option>
                                  <option value="MASTERCARD">MASTERCARD</option>
                                  <option value="AMEX">AMEX</option>
                                  <option value="MADA">MADA</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Card Last 4 Digits *</label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={4}
                                  value={preauthCardLast4}
                                  onChange={(e) => setPreauthCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                  placeholder="4242"
                                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-main)] focus:border-cyan-500 focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Cardholder Name *</label>
                                <input
                                  type="text"
                                  value={preauthCardholder}
                                  onChange={(e) => setPreauthCardholder(e.target.value)}
                                  placeholder={selectedBooking.customerName}
                                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:border-cyan-500 focus:outline-none"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={submitPickupPreauth}
                                disabled={preauthBusy}
                                className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5"
                              >
                                {preauthBusy ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                                {preauthBusy ? 'Authorizing Hold…' : 'Authorize Pre-Auth Hold'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 5. Customer Signature & Submit */}
                    <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4">
                      <SignaturePad onChange={setPickupSignature} label="4. Customer Check-Out Signature *" />
                      <p className="text-xs text-[var(--text-faint)] italic">
                        By signing, the customer confirms vehicle plate assignment, baseline odometer ({mileageOut || '0'} km), fuel ({fuelOut}/8), 7-point safety checklist, and rental agreement terms.
                      </p>
                      <button
                        type="button"
                        onClick={submitPickup}
                        disabled={
                          pickupBusy ||
                          !mileageOut ||
                          !pickupSignature ||
                          (pickupSubMode === 'walkin' && (!walkinCustomerId || !selectedVehicleId))
                        }
                        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-bold hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg"
                      >
                        {pickupBusy ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {pickupBusy
                          ? 'Issuing Agreement & Activating Rental…'
                          : pickupSubMode === 'walkin'
                            ? 'Complete Walk-In Checkout & Issue Agreement'
                            : 'Confirm Pick-Up & Issue Agreement'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          TAB 2: RETURN (CHECK-IN & SETTLEMENT)
         ═══════════════════════════════════════════════════════════════════════ */}
      {mode === 'return' && (
        <>
          {returnReceipt ? (
            <div className="bg-[var(--bg-surface)]/80 border border-emerald-500/40 rounded-2xl p-6 md:p-8 space-y-6 shadow-xl">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                    <CheckCircle2 className="h-7 w-7 text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                      Return Completed &amp; Invoice Summary
                    </div>
                    <h2 className="text-2xl font-bold text-[var(--text-main)] font-mono mt-0.5">
                      {returnReceipt.invoiceNumber}
                    </h2>
                    <p className="text-xs text-[var(--text-muted)]">
                      Agreement {selectedAgreement?.agreementNo} · {selectedAgreement?.customerName} · {selectedAgreement?.vehiclePlate}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1.5">
                      {returnReceipt.vehicleStatusAfterReturn && (
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                            returnReceipt.vehicleStatusAfterReturn === 'MAINTENANCE'
                              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                              : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          }`}
                        >
                          {returnReceipt.vehicleStatusAfterReturn === 'MAINTENANCE' ? (
                            <Wrench className="h-3 w-3" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          Post-Return Fleet Status: {returnReceipt.vehicleStatusAfterReturn}
                        </span>
                      )}
                      {returnReceipt.sixPointClearancePassed !== undefined && (
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                            returnReceipt.sixPointClearancePassed
                              ? 'bg-teal-500/15 border-teal-500/40 text-teal-300'
                              : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                          }`}
                        >
                          <ShieldCheck className="h-3 w-3" />
                          6-Point Safety: {returnReceipt.sixPointClearancePassed ? 'CLEARED' : 'GROUNDED'}
                        </span>
                      )}
                      {returnReceipt.regulatoryReport && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-indigo-500/15 border border-indigo-500/40 text-indigo-300">
                          <ShieldCheck className="h-3 w-3" />
                          UAE Tarrashud: {returnReceipt.regulatoryReport.status ?? 'QUEUED'}
                          {returnReceipt.regulatoryReport.externalRef
                            ? ` · ${returnReceipt.regulatoryReport.externalRef}`
                            : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[var(--text-muted)] uppercase">Final Invoice Total</div>
                  <div className="text-3xl font-bold text-emerald-400 font-mono">
                    {fmtMoney(returnReceipt.totalAmount, returnReceipt.currency)}
                  </div>
                </div>
              </div>

              {/* Breakdown Rows */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-xl bg-[var(--bg-canvas)]/70 border border-[var(--border-subtle)] p-4 space-y-2.5 text-sm">
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                    Settlement Charge Breakdown
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Base Rental Subtotal</span>
                    <span className="font-mono text-[var(--text-main)]">{fmtMoney(returnReceipt.subtotal, returnReceipt.currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Late Return Fee</span>
                    <span className={`font-mono ${returnReceipt.lateFee > 0 ? 'text-amber-300 font-semibold' : 'text-[var(--text-muted)]'}`}>
                      {fmtMoney(returnReceipt.lateFee, returnReceipt.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Excess KM Charge</span>
                    <span className={`font-mono ${returnReceipt.excessKmCharge > 0 ? 'text-amber-300 font-semibold' : 'text-[var(--text-muted)]'}`}>
                      {fmtMoney(returnReceipt.excessKmCharge, returnReceipt.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Fuel Surcharge</span>
                    <span className={`font-mono ${returnReceipt.fuelSurcharge > 0 ? 'text-amber-300 font-semibold' : 'text-[var(--text-muted)]'}`}>
                      {fmtMoney(returnReceipt.fuelSurcharge, returnReceipt.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">New Damage Charges</span>
                    <span className={`font-mono ${returnReceipt.damageCharges > 0 ? 'text-rose-300 font-semibold' : 'text-[var(--text-muted)]'}`}>
                      {fmtMoney(returnReceipt.damageCharges, returnReceipt.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-[var(--border-subtle)] pt-2">
                    <span className="text-[var(--text-muted)]">VAT (5%)</span>
                    <span className="font-mono text-[var(--text-main)]">{fmtMoney(returnReceipt.taxAmount, returnReceipt.currency)}</span>
                  </div>
                  <div className="flex justify-between border-t border-[var(--border-subtle)] pt-2 font-bold text-base">
                    <span className="text-[var(--text-main)]">Total Amount</span>
                    <span className="font-mono text-emerald-400">{fmtMoney(returnReceipt.totalAmount, returnReceipt.currency)}</span>
                  </div>
                </div>

                {/* Pre-Auth / Deposit Settlement Status */}
                <div className="rounded-xl bg-[var(--bg-canvas)]/70 border border-[var(--border-subtle)] p-4 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Pre-Authorization &amp; Deposit Disposition
                    </div>
                    {returnReceipt.preauthResult ? (
                      <div className="rounded-xl bg-cyan-500/10 border border-cyan-500/30 p-3.5 text-xs text-cyan-200 space-y-1">
                        <div className="font-semibold flex items-center gap-1.5 text-cyan-300">
                          <CreditCard className="h-4 w-4" /> Pre-Auth / Deposit Action Processed
                        </div>
                        <div className="font-mono break-words">
                          {typeof returnReceipt.preauthResult === 'string'
                            ? returnReceipt.preauthResult
                            : JSON.stringify(returnReceipt.preauthResult)}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] p-3.5 text-xs text-[var(--text-muted)]">
                        Invoice generated for standard settlement ({settlementAction}). Manage payment collection or receipt PDFs from Invoices.
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2.5 pt-2">
                    <Link
                      href={
                        (selectedAgreement?.id ?? returnReceipt.agreementId)
                          ? `/rental/invoices?agreementId=${encodeURIComponent(
                              selectedAgreement?.id ?? returnReceipt.agreementId ?? ''
                            )}${
                              returnReceipt?.invoiceNumber && returnReceipt.invoiceNumber !== 'INV-ISSUED'
                                ? `&invoiceNo=${encodeURIComponent(returnReceipt.invoiceNumber)}`
                                : ''
                            }`
                          : '/rental/invoices'
                      }
                      className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600/25 border border-blue-500/40 text-blue-200 text-xs font-semibold hover:bg-blue-600/35 text-center flex items-center justify-center gap-1.5"
                    >
                      <Receipt className="h-4 w-4" /> Go to Invoices
                    </Link>
                    <Link
                      href="/rental/agreements"
                      className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs font-semibold hover:opacity-90 text-center flex items-center justify-center gap-1.5"
                    >
                      <FileText className="h-4 w-4" /> Go to Agreements
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAgreement(null);
                        setReturnReceipt(null);
                      }}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-bold hover:opacity-90"
                    >
                      Process Next Vehicle Return →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* LEFT COLUMN: Active Agreements Selector */}
              <div className="lg:col-span-4 space-y-4">
                <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider">
                      1. Active Agreements
                    </h2>
                    <span className="text-xs text-[var(--text-muted)]">{filteredAgreements.length} out</span>
                  </div>
                  <input
                    type="search"
                    value={agreementSearch}
                    onChange={(e) => setAgreementSearch(e.target.value)}
                    placeholder="Search RA#, plate, customer…"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none"
                  />

                  <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
                    {loadingAgreements ? (
                      <div className="p-8 text-center text-sm text-[var(--text-muted)] animate-pulse">
                        Loading active agreements…
                      </div>
                    ) : filteredAgreements.length === 0 ? (
                      <div className="p-8 rounded-xl bg-[var(--bg-canvas)]/50 border border-[var(--border-subtle)] text-center text-xs text-[var(--text-muted)]">
                        No active rental agreements awaiting return.
                      </div>
                    ) : (
                      filteredAgreements.map((ag) => {
                        const isSelected = selectedAgreement?.id === ag.id;
                        return (
                          <button
                            key={ag.id}
                            type="button"
                            onClick={() => selectAgreementForReturn(ag)}
                            className={`w-full text-left p-3.5 rounded-xl border transition space-y-1.5 ${
                              isSelected
                                ? 'bg-violet-500/15 border-violet-500/50 ring-1 ring-violet-500/40'
                                : 'bg-[var(--bg-canvas)]/60 border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]/60'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs font-bold text-violet-300">{ag.agreementNo}</span>
                              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)]">
                                {ag.vehiclePlate}
                              </span>
                            </div>
                            <div className="font-semibold text-sm text-[var(--text-main)] truncate">
                              {ag.companyName ?? ag.customerName}
                            </div>
                            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                              <span className="truncate">{ag.vehicleName}</span>
                              <span>Due {ag.endDate ? new Date(ag.endDate).toLocaleDateString('en-GB') : '—'}</span>
                            </div>
                            {ag.preauth && (
                              <div className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                                <CreditCard className="h-3 w-3" />
                                {ag.preauth.authCode} · AED {ag.preauth.amount.toLocaleString()} · **** {ag.preauth.cardLast4}
                              </div>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: Side-by-Side Baseline vs Check-In + New Damages + Settlement */}
              <div className="lg:col-span-8 space-y-5">
                {!selectedAgreement ? (
                  <div className="bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] rounded-2xl p-12 text-center space-y-2">
                    <Receipt className="h-10 w-10 text-violet-400/60 mx-auto" />
                    <div className="text-base font-semibold text-[var(--text-main)]">
                      Select an active agreement to begin Return Check-In &amp; Settlement
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      Compare pick-up baseline odometer, fuel &amp; walkaround markers side-by-side, log any new damages, and settle pre-auth holds or final invoices immediately.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Header Banner with Pre-Auth Hold Badge */}
                    <div className="bg-[var(--bg-surface)]/70 border border-violet-500/30 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold text-[var(--text-main)]">
                            {selectedAgreement.agreementNo}
                          </span>
                          <span className="font-mono text-xs px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
                            {selectedAgreement.vehiclePlate}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          {selectedAgreement.customerName} · {selectedAgreement.vehicleName} · Scheduled Return{' '}
                          {selectedAgreement.endDate ? new Date(selectedAgreement.endDate).toLocaleDateString('en-GB') : '—'}
                        </p>
                      </div>

                      {selectedAgreement.preauth ? (
                        <div className="px-3.5 py-2 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 text-xs font-mono flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-cyan-400" />
                          <span>
                            {selectedAgreement.preauth.authCode} · {selectedAgreement.currency}{' '}
                            {selectedAgreement.preauth.amount.toLocaleString()} · **** {selectedAgreement.preauth.cardLast4}
                          </span>
                        </div>
                      ) : (
                        <div className="px-3 py-1.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                          Deposit: {fmtMoney(selectedAgreement.securityDeposit, selectedAgreement.currency)} ({selectedAgreement.depositStatus})
                        </div>
                      )}
                    </div>

                    {/* Side-by-Side Pick-Up Baseline vs Return Check-In Card */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* LEFT: Pick-Up Baseline */}
                      <div className="bg-[var(--bg-surface)]/60 border border-teal-500/25 rounded-2xl p-5 space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-teal-300">
                            Pick-Up Baseline (Check-Out)
                          </h3>
                          <span className="text-[11px] text-[var(--text-muted)]">
                            {selectedAgreement.startDate ? new Date(selectedAgreement.startDate).toLocaleDateString('en-GB') : ''}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-xl bg-[var(--bg-canvas)]/70 border border-[var(--border-subtle)] p-3">
                            <div className="text-[11px] text-[var(--text-muted)]">Pick-Up Odometer</div>
                            <div className="text-lg font-bold font-mono text-[var(--text-main)] mt-0.5">
                              {selectedAgreement.pickupOdometer.toLocaleString()} km
                            </div>
                          </div>
                          <div className="rounded-xl bg-[var(--bg-canvas)]/70 border border-[var(--border-subtle)] p-3">
                            <div className="text-[11px] text-[var(--text-muted)]">Pick-Up Fuel</div>
                            <div className="text-lg font-bold font-mono text-teal-300 mt-0.5">
                              {selectedAgreement.pickupFuelPct}% ({selectedAgreement.pickupFuelEighths}/8)
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold mb-1.5">
                            Pick-Up Checklist
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {CHECKLIST_ITEMS.map((item) => {
                              const ok = selectedAgreement.pickupChecklist[item.key];
                              return (
                                <span
                                  key={item.key}
                                  className={`px-2 py-0.5 rounded-md text-[11px] border ${
                                    ok
                                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                      : 'bg-slate-500/10 border-slate-500/30 text-[var(--text-faint)]'
                                  }`}
                                >
                                  {ok ? '✓' : '—'} {item.label}
                                </span>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold mb-1.5">
                            Pre-Existing Damage Markers ({selectedAgreement.pickupDamageMarkers.length})
                          </div>
                          {selectedAgreement.pickupDamageMarkers.length === 0 ? (
                            <div className="text-xs text-[var(--text-faint)] italic">
                              Clean walkaround — zero damage recorded at pick-up.
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {selectedAgreement.pickupDamageMarkers.map((m, idx) => (
                                <div key={idx} className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1">
                                  {m.zone.replace(/_/g, ' ')} · {m.type} ({m.severity}) {m.note ? `— ${m.note}` : ''}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {selectedAgreement.pickupPhotos.length > 0 && (
                          <div>
                            <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold mb-1.5">
                              Pick-Up Photos ({selectedAgreement.pickupPhotos.length})
                            </div>
                            <div className="grid grid-cols-4 gap-1.5">
                              {selectedAgreement.pickupPhotos.map((url, idx) => (
                                <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded overflow-hidden border border-[var(--border-subtle)] block">
                                  <img src={url} alt={`Pick-up ${idx + 1}`} className="w-full h-full object-cover" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* RIGHT: Return Check-In */}
                      <div className="bg-[var(--bg-surface)]/60 border border-violet-500/25 rounded-2xl p-5 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-violet-300">
                            Return Check-In Inspection
                          </h3>
                          <button
                            type="button"
                            onClick={() => void fetchTelematicsPreFill(selectedAgreement.vehicleId, 'return')}
                            disabled={telematicsBusy || !selectedAgreement.vehicleId}
                            className="px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 text-[11px] font-semibold hover:bg-cyan-500/25 disabled:opacity-40 flex items-center gap-1.5"
                          >
                            {telematicsBusy ? <Loader className="h-3 w-3 animate-spin" /> : <Cpu className="h-3 w-3" />}
                            1-Click CAN-Bus Pre-Fill
                          </button>
                        </div>

                        {telematicsHint && (
                          <div className="px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-[11px] text-cyan-200 font-mono">
                            {telematicsHint}
                          </div>
                        )}

                        <div>
                          <label className="text-xs text-[var(--text-muted)] font-medium block mb-1">
                            Return Odometer (`mileageIn` km) *{' '}
                            {lastSwap && (
                              <span className="text-violet-300 font-mono text-[11px]">
                                (Replacement {lastSwap.toPlateNumber ?? 'car'} baseline: {minAllowedOdo.toLocaleString()} km)
                              </span>
                            )}
                          </label>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={minAllowedOdo}
                            value={mileageIn}
                            onChange={(e) => setMileageIn(e.target.value)}
                            placeholder={`>= ${minAllowedOdo}`}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] text-base font-mono focus:border-violet-500 focus:outline-none"
                          />
                          {odoBelowBaseline && (
                            <p className="text-xs text-rose-400 mt-1">
                              Return odometer is below {lastSwap ? 'replacement vehicle' : 'pick-up'} baseline ({minAllowedOdo.toLocaleString()} km).
                            </p>
                          )}
                        </div>

                        <EighthsFuelGauge
                          value={fuelIn}
                          onChange={setFuelIn}
                          label="Return Fuel (Eighths)"
                        />

                        <div>
                          <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold mb-1.5">
                            Return 7-Point Equipment Checklist
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {CHECKLIST_ITEMS.map((item) => {
                              const checked = Boolean(returnChecklist[item.key]);
                              const missingNow = selectedAgreement.pickupChecklist[item.key] && !checked;
                              return (
                                <label
                                  key={item.key}
                                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${
                                    missingNow
                                      ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                                      : checked
                                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                      : 'bg-[var(--bg-canvas)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) =>
                                      setReturnChecklist((prev) => ({
                                        ...prev,
                                        [item.key]: e.target.checked,
                                      }))
                                    }
                                    className="accent-emerald-500"
                                  />
                                  <span className="truncate">{item.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {/* 6-Point Return Safety Clearance Gate */}
                        <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-[var(--text-muted)] uppercase font-semibold flex items-center gap-1.5">
                              <ShieldCheck className="h-3.5 w-3.5 text-teal-400" />
                              6-Point Return Safety Clearance
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                sixPointFailedLive
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              }`}
                            >
                              {sixPointFailedLive ? 'MAINTENANCE HOLD' : 'ALL CLEAR'}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {SIX_POINT_ITEMS.map((item) => {
                              const ok = sixPointClearance[item.key];
                              return (
                                <label
                                  key={item.key}
                                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${
                                    ok
                                      ? 'bg-teal-500/10 border-teal-500/30 text-teal-200'
                                      : 'bg-rose-500/15 border-rose-500/40 text-rose-300 font-semibold'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={ok}
                                    onChange={(e) =>
                                      setSixPointClearance((prev) => ({
                                        ...prev,
                                        [item.key]: e.target.checked,
                                      }))
                                    }
                                    className="accent-teal-500"
                                  />
                                  <span className="truncate">{item.label}</span>
                                </label>
                              );
                            })}
                          </div>
                          <label className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={groundForMaintenance}
                              onChange={(e) => setGroundForMaintenance(e.target.checked)}
                              className="accent-amber-500"
                            />
                            <Wrench className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                            <span>Ground vehicle for workshop maintenance after return</span>
                          </label>
                          {sixPointFailedLive && (
                            <div className="px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/40 text-[11px] text-amber-200">
                              ⚠ Vehicle will automatically transition to <strong className="font-mono">MAINTENANCE</strong> upon return check-in until workshop sign-off.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Live Estimated Telemetry & Surcharge Warning Strip */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-xl bg-[var(--bg-surface)]/70 border border-[var(--border-subtle)] p-3.5">
                        <div className="text-[11px] text-[var(--text-muted)] uppercase">Est. KM Driven</div>
                        <div className="text-xl font-bold font-mono text-cyan-300 mt-0.5">
                          {kmDriven.toLocaleString()} km
                        </div>
                      </div>
                      <div
                        className={`rounded-xl border p-3.5 ${
                          fuelDiffEighths < 0
                            ? 'bg-amber-500/15 border-amber-500/40'
                            : 'bg-emerald-500/10 border-emerald-500/30'
                        }`}
                      >
                        <div className="text-[11px] text-[var(--text-muted)] uppercase">Fuel Comparison</div>
                        <div
                          className={`text-sm font-bold mt-1 ${
                            fuelDiffEighths < 0 ? 'text-amber-300' : 'text-emerald-300'
                          }`}
                        >
                          {fuelDiffEighths < 0
                            ? `⚠ Short ${Math.abs(fuelDiffEighths)}/8 (${Math.round((Math.abs(fuelDiffEighths) / 8) * 100)}%) — Surcharge applies`
                            : '✓ Fuel level matched / full'}
                        </div>
                      </div>
                      <div
                        className={`rounded-xl border p-3.5 ${
                          totalEstimatedNewDamage > 0
                            ? 'bg-rose-500/15 border-rose-500/40'
                            : 'bg-[var(--bg-surface)]/70 border-[var(--border-subtle)]'
                        }`}
                      >
                        <div className="text-[11px] text-[var(--text-muted)] uppercase">Est. New Damage Total</div>
                        <div
                          className={`text-xl font-bold font-mono mt-0.5 ${
                            totalEstimatedNewDamage > 0 ? 'text-rose-300' : 'text-[var(--text-main)]'
                          }`}
                        >
                          AED {totalEstimatedNewDamage.toLocaleString()}
                        </div>
                      </div>
                    </div>

                    {/* New Damage Logging (Structured Adder + Interactive Silhouette + Photos) */}
                    <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4">
                      <h3 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider">
                        New Return Damage Assessment
                      </h3>

                      {/* Structured New Damage Adder */}
                      <div className="rounded-xl bg-[var(--bg-canvas)]/70 border border-[var(--border-subtle)] p-4 space-y-3">
                        <div className="text-xs font-semibold text-[var(--text-muted)]">
                          Structured New Damage Item (Zone · Severity · Repair Estimate AED)
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                          <div>
                            <label className="text-[11px] text-[var(--text-muted)] block mb-1">Zone</label>
                            <select
                              value={dmgDraft.zone}
                              onChange={(e) => setDmgDraft((p) => ({ ...p, zone: e.target.value }))}
                              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                            >
                              {DAMAGE_ZONE_OPTIONS.map((z) => (
                                <option key={z.value} value={z.value}>{z.label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] text-[var(--text-muted)] block mb-1">Severity</label>
                            <select
                              value={dmgDraft.severity}
                              onChange={(e) => {
                                const sev = e.target.value as ReturnDamageSeverity;
                                const suggested = sev === 'SEVERE' ? '2500' : sev === 'MODERATE' ? '900' : '350';
                                setDmgDraft((p) => ({ ...p, severity: sev, estimatedCost: suggested }));
                              }}
                              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                            >
                              <option value="MINOR">MINOR</option>
                              <option value="MODERATE">MODERATE</option>
                              <option value="SEVERE">SEVERE</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] text-[var(--text-muted)] block mb-1">Est. Repair (AED)</label>
                            <input
                              type="number"
                              min="0"
                              step="50"
                              value={dmgDraft.estimatedCost}
                              onChange={(e) => setDmgDraft((p) => ({ ...p, estimatedCost: e.target.value }))}
                              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-main)]"
                            />
                          </div>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={addNewDamageItem}
                              className="w-full py-2 px-3 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-semibold flex items-center justify-center gap-1"
                            >
                              <Plus className="h-3.5 w-3.5" /> Add Damage
                            </button>
                          </div>
                        </div>
                        <input
                          type="text"
                          value={dmgDraft.description}
                          onChange={(e) => setDmgDraft((p) => ({ ...p, description: e.target.value }))}
                          placeholder="Describe new scratch, dent, cracked glass, or alloy scuff…"
                          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                        />

                        {newDamages.length > 0 && (
                          <div className="space-y-1.5 pt-2">
                            {newDamages.map((d) => (
                              <div
                                key={d.id}
                                className="flex items-center justify-between gap-2 rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs"
                              >
                                <div>
                                  <span className="font-bold text-rose-300">{d.zone.replace(/_/g, ' ')}</span>
                                  <span className="mx-1.5 text-[var(--text-faint)]">·</span>
                                  <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-200 font-semibold text-[10px]">
                                    {d.severity}
                                  </span>
                                  <span className="ml-2 text-[var(--text-main)]">{d.description}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-mono font-bold text-rose-300">
                                    AED {d.estimatedCost.toLocaleString()}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setNewDamages((prev) => prev.filter((x) => x.id !== d.id))}
                                    className="text-rose-400 hover:text-rose-200"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <DamageWalkaround
                        markers={returnWalkaroundMarkers}
                        onChange={setReturnWalkaroundMarkers}
                        baselineMarkers={selectedAgreement.pickupDamageMarkers}
                      />

                      {/* Return Photos & AI */}
                      <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                            Return Evidence Photos {returnPhotos.length > 0 && <span className="text-cyan-300">· {returnPhotos.length}</span>}
                          </span>
                          <input
                            ref={returnFileRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handlePhotoUpload(file, 'return');
                              if (returnFileRef.current) returnFileRef.current.value = '';
                            }}
                            className="hidden"
                          />
                          <button
                            type="button"
                            onClick={() => returnFileRef.current?.click()}
                            disabled={uploadingPhoto}
                            className="px-3.5 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 flex items-center gap-1.5 disabled:opacity-40"
                          >
                            {uploadingPhoto ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                            {uploadingPhoto ? 'Uploading…' : 'Add Photo'}
                          </button>
                        </div>

                        {returnPhotos.length > 0 && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-4 gap-2">
                              {returnPhotos.map((p, i) => (
                                <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
                                  <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                                  <button
                                    type="button"
                                    onClick={() => setReturnPhotos(returnPhotos.filter((_, idx) => idx !== i))}
                                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center text-xs"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() => classifyLastPhoto(returnPhotos, true)}
                              disabled={aiBusy}
                              className="w-full py-2 rounded-lg bg-violet-600/25 border border-violet-500/40 text-violet-200 text-xs font-medium hover:bg-violet-600/35 disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              {aiBusy
                                ? 'AI running pre/post walkaround diff…'
                                : '1-Click AI Damage Scan Diff (Import New Post-Pickup Damages)'}
                            </button>
                            {aiHint && (
                              <div className="text-xs px-3 py-2 rounded-lg bg-violet-900/30 border border-violet-500/30 text-violet-200">
                                {aiHint}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Multi-Segment Vehicle Swaps & Unbilled RTA Fines / Salik-Darb Tolls Review */}
                    {(loadingSettlementCtx ||
                      swaps.length > 0 ||
                      (settlementCtx?.unbilledTrafficFines.length ?? 0) > 0 ||
                      (settlementCtx?.unbilledTolls.length ?? 0) > 0) && (
                      <div className="bg-[var(--bg-surface)]/60 border border-cyan-500/30 rounded-2xl p-5 space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider">
                            Mid-Rental Swaps, RTA Traffic Fines &amp; Salik/Darb Tolls
                          </h3>
                          {loadingSettlementCtx && (
                            <span className="text-xs text-cyan-300 flex items-center gap-1.5">
                              <Loader className="h-3.5 w-3.5 animate-spin" /> Syncing ledger…
                            </span>
                          )}
                        </div>

                        {swaps.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-violet-300">
                              Mid-Rental Vehicle Exchanges ({swaps.length} segment{swaps.length > 1 ? 's' : ''})
                            </div>
                            <div className="space-y-1.5">
                              {swaps.map((sw) => (
                                <div
                                  key={sw.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--bg-canvas)]/70 border border-[var(--border-subtle)] px-3.5 py-2 text-xs"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono font-bold text-violet-300">
                                      {sw.exchangeNo ?? sw.id.slice(0, 8)}
                                    </span>
                                    <span className="font-mono text-[var(--text-main)]">
                                      {sw.fromPlateNumber ?? 'Old Car'} ({sw.fromMileageIn.toLocaleString()} km · {sw.fromFuelIn}%)
                                    </span>
                                    <span className="text-[var(--text-faint)]">→</span>
                                    <span className="font-mono text-emerald-300">
                                      {sw.toPlateNumber ?? 'Replacement'} ({sw.toMileageOut.toLocaleString()} km · {sw.toFuelOut}%)
                                    </span>
                                    {sw.reason && (
                                      <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-200 text-[10px]">
                                        {sw.reason}
                                      </span>
                                    )}
                                  </div>
                                  {sw.rateDifference !== 0 && (
                                    <span className="font-mono text-amber-300 font-semibold">
                                      {sw.rateDifference > 0 ? '+' : ''}AED {sw.rateDifference.toFixed(2)}/day
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {(settlementCtx?.unbilledTrafficFines.length ?? 0) > 0 && (
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-amber-300">
                              Unbilled RTA / Police Traffic Fines ({settlementCtx?.unbilledTrafficFines.length}) — Auto-Billed on Settlement
                            </div>
                            <div className="space-y-1.5">
                              {settlementCtx!.unbilledTrafficFines.map((f) => (
                                <div
                                  key={f.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 px-3.5 py-2 text-xs"
                                >
                                  <div>
                                    <span className="font-mono font-bold text-amber-200">
                                      {f.fineRef ?? f.id.slice(0, 8)}
                                    </span>
                                    <span className="ml-2 text-[var(--text-main)]">{f.offenceType}</span>
                                    {f.fineDate && (
                                      <span className="ml-2 text-[var(--text-muted)]">
                                        ({new Date(f.fineDate).toLocaleDateString('en-GB')})
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                                    <span className="px-2 py-0.5 rounded bg-slate-500/20 text-slate-200">
                                      Fine AED {f.fineAmount.toFixed(2)} (0% Out-of-Scope)
                                    </span>
                                    {f.knowledgeFee > 0 && (
                                      <span className="px-2 py-0.5 rounded bg-slate-500/20 text-slate-200">
                                        Knowledge AED {f.knowledgeFee.toFixed(2)} (0% Out-of-Scope)
                                      </span>
                                    )}
                                    {f.adminFee > 0 && (
                                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-200">
                                        Admin AED {f.adminFee.toFixed(2)} (+5% VAT)
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {(settlementCtx?.unbilledTolls.length ?? 0) > 0 && (
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-cyan-300">
                              Unbilled Salik / Darb Toll Crossings ({settlementCtx?.unbilledTolls.length}) — +5% UAE VAT
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {settlementCtx!.unbilledTolls.map((t) => (
                                <div
                                  key={t.id}
                                  className="flex items-center justify-between rounded-lg bg-cyan-500/10 border border-cyan-500/25 px-3 py-1.5 text-xs"
                                >
                                  <span className="truncate text-[var(--text-main)]">
                                    {t.tollSystem ? `[${t.tollSystem}] ` : ''}
                                    {t.gateName}
                                  </span>
                                  <span className="font-mono text-cyan-200 font-semibold ml-2 shrink-0">
                                    AED {(t.amount + t.adminFee).toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Live UAE FTA Pro-Forma Tax Invoice Breakdown */}
                    <div className="bg-[var(--bg-surface)]/70 border border-emerald-500/30 rounded-2xl p-5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
                        <div>
                          <h3 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider">
                            Live Pro-Forma Tax Invoice Preview
                          </h3>
                          <p className="text-[11px] text-[var(--text-muted)]">
                            UAE FTA VAT Compliant — Statutory Fines &amp; Knowledge Dirham isolated at 0% Out-of-Scope
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] uppercase text-[var(--text-muted)]">Est. Gross Total</div>
                          <div className="text-xl font-bold font-mono text-emerald-400">
                            {fmtMoney(proForma.grossTotal, selectedAgreement.currency)}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">Base Rental Subtotal (5% VAT)</span>
                          <span className="font-mono text-[var(--text-main)]">
                            {fmtMoney(proForma.baseRental, selectedAgreement.currency)}
                          </span>
                        </div>
                        {proForma.extrasTaxable > 0 && (
                          <div className="flex justify-between">
                            <span className="text-[var(--text-muted)]">Ancillaries, Add-Ons &amp; Upgrades (5% VAT)</span>
                            <span className="font-mono text-[var(--text-main)]">
                              {fmtMoney(proForma.extrasTaxable, selectedAgreement.currency)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">Late Return Fee (5% VAT)</span>
                          <span className={`font-mono ${proForma.lateFee > 0 ? 'text-amber-300 font-semibold' : 'text-[var(--text-muted)]'}`}>
                            {fmtMoney(proForma.lateFee, selectedAgreement.currency)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">
                            Excess KM ({kmDriven.toLocaleString()} / {proForma.includedKm.toLocaleString()} incl. km
                            {proForma.excessKm > 0 ? ` · +${proForma.excessKm.toLocaleString()} excess` : ''})
                          </span>
                          <span className={`font-mono ${proForma.excessKmCharge > 0 ? 'text-amber-300 font-semibold' : 'text-[var(--text-muted)]'}`}>
                            {fmtMoney(proForma.excessKmCharge, selectedAgreement.currency)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">
                            Fuel Surcharge ({totalFuelDeficitPctLive}% cumulative deficit)
                          </span>
                          <span className={`font-mono ${proForma.fuelSurcharge > 0 ? 'text-amber-300 font-semibold' : 'text-[var(--text-muted)]'}`}>
                            {fmtMoney(proForma.fuelSurcharge, selectedAgreement.currency)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">Estimated New Return Damage (5% VAT)</span>
                          <span className={`font-mono ${totalEstimatedNewDamage > 0 ? 'text-rose-300 font-semibold' : 'text-[var(--text-muted)]'}`}>
                            {fmtMoney(totalEstimatedNewDamage, selectedAgreement.currency)}
                          </span>
                        </div>
                        {(proForma.tollsAndAdmin5Pct > 0 || proForma.fineAdmin5Pct > 0) && (
                          <div className="flex justify-between">
                            <span className="text-[var(--text-muted)]">Salik/Darb Tolls &amp; Fine Admin Surcharges (5% VAT)</span>
                            <span className="font-mono text-cyan-300">
                              {fmtMoney(proForma.tollsAndAdmin5Pct + proForma.fineAdmin5Pct, selectedAgreement.currency)}
                            </span>
                          </div>
                        )}
                        {proForma.fineStatutory0Pct > 0 && (
                          <div className="flex justify-between">
                            <span className="text-[var(--text-muted)]">
                              RTA Statutory Fines &amp; UAE Knowledge Dirham (0% Out-of-Scope)
                            </span>
                            <span className="font-mono text-amber-200">
                              {fmtMoney(proForma.fineStatutory0Pct, selectedAgreement.currency)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between border-t border-[var(--border-subtle)] pt-1.5">
                          <span className="text-[var(--text-muted)]">UAE VAT (5% on Taxable Supplies Only)</span>
                          <span className="font-mono text-[var(--text-main)]">
                            {fmtMoney(proForma.vat5Pct, selectedAgreement.currency)}
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-[var(--border-subtle)] pt-1.5 font-bold text-sm">
                          <span className="text-[var(--text-main)]">Estimated Final Invoice Total</span>
                          <span className="font-mono text-emerald-400">
                            {fmtMoney(proForma.grossTotal, selectedAgreement.currency)}
                          </span>
                        </div>
                        {proForma.holdOrDeposit > 0 && (
                          <div className="flex justify-between pt-1 text-xs">
                            <span className="text-cyan-300">
                              Active Pre-Auth / Paid Security Deposit ({fmtMoney(proForma.holdOrDeposit, selectedAgreement.currency)})
                            </span>
                            <span
                              className={`font-mono font-bold ${
                                proForma.netBalanceAfterHold > 0 ? 'text-amber-300' : 'text-emerald-300'
                              }`}
                            >
                              {proForma.netBalanceAfterHold > 0
                                ? `Balance Due: ${fmtMoney(proForma.netBalanceAfterHold, selectedAgreement.currency)}`
                                : `Refundable Excess: ${fmtMoney(Math.abs(proForma.netBalanceAfterHold), selectedAgreement.currency)}`}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Settlement Action, Notes & Return Signature */}
                    <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4">
                      <h3 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider">
                        Settlement Action &amp; Customer Return Sign-Off
                      </h3>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                        <label
                          className={`p-3 rounded-xl border cursor-pointer transition space-y-1 ${
                            settlementAction === 'NONE'
                              ? 'bg-violet-500/15 border-violet-500/50 text-[var(--text-main)]'
                              : 'bg-[var(--bg-canvas)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                          }`}
                        >
                          <div className="flex items-center gap-2 text-xs font-bold">
                            <input
                              type="radio"
                              name="settlementAction"
                              checked={settlementAction === 'NONE'}
                              onChange={() => setSettlementAction('NONE')}
                              className="accent-violet-500"
                            />
                            Issue Invoice Only
                          </div>
                          <p className="text-[11px] text-[var(--text-faint)]">
                            Close agreement &amp; generate final invoice without pre-auth capture.
                          </p>
                        </label>

                        <label
                          className={`p-3 rounded-xl border transition space-y-1 ${
                            !selectedAgreement.preauth
                              ? 'opacity-50 cursor-not-allowed bg-[var(--bg-canvas)] border-[var(--border-subtle)]'
                              : settlementAction === 'CAPTURE_INVOICE'
                              ? 'bg-cyan-500/15 border-cyan-500/50 text-[var(--text-main)] cursor-pointer'
                              : 'bg-[var(--bg-canvas)] border-[var(--border-subtle)] text-[var(--text-muted)] cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center gap-2 text-xs font-bold">
                            <input
                              type="radio"
                              name="settlementAction"
                              disabled={!selectedAgreement.preauth}
                              checked={settlementAction === 'CAPTURE_INVOICE'}
                              onChange={() => setSettlementAction('CAPTURE_INVOICE')}
                              className="accent-cyan-500"
                            />
                            Capture Pre-Auth
                          </div>
                          <p className="text-[11px] text-[var(--text-faint)]">
                            {selectedAgreement.preauth
                              ? `Capture final invoice from ${selectedAgreement.preauth.authCode}`
                              : 'No active card pre-auth hold on file'}
                          </p>
                        </label>

                        <label
                          className={`p-3 rounded-xl border cursor-pointer transition space-y-1 ${
                            settlementAction === 'RELEASE_DEPOSIT'
                              ? 'bg-emerald-500/15 border-emerald-500/50 text-[var(--text-main)]'
                              : 'bg-[var(--bg-canvas)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                          }`}
                        >
                          <div className="flex items-center gap-2 text-xs font-bold">
                            <input
                              type="radio"
                              name="settlementAction"
                              checked={settlementAction === 'RELEASE_DEPOSIT'}
                              onChange={() => setSettlementAction('RELEASE_DEPOSIT')}
                              className="accent-emerald-500"
                            />
                            Release Deposit
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[9px] uppercase">
                              Manager
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--text-faint)]">
                            Release deposit / pre-auth hold (requires RAC Manager role).
                          </p>
                        </label>
                      </div>

                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">Return Notes (optional)</label>
                        <textarea
                          rows={2}
                          value={returnNotes}
                          onChange={(e) => setReturnNotes(e.target.value)}
                          placeholder="Customer disputed scratch, Salik tolls reconciled, keys returned…"
                          className="w-full px-3.5 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] resize-none focus:border-violet-500 focus:outline-none"
                        />
                      </div>

                      <SignaturePad onChange={setReturnSignature} label="Customer Return Acknowledgement Signature *" />

                      <button
                        type="button"
                        onClick={submitReturn}
                        disabled={returnBusy || !mileageIn || odoBelowBaseline || !returnSignature}
                        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-bold hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg"
                      >
                        {returnBusy ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {returnBusy ? 'Completing Return & Generating Invoice…' : 'Complete Return & Settle Agreement'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function CounterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24 text-[var(--text-muted)] animate-pulse">
          Loading Unified Counter Desk…
        </div>
      }
    >
      <CounterDeskInner />
    </Suspense>
  );
}
