import crypto from 'crypto';

export interface DrayageDbClient {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
}

export interface DrayageTerminal {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  portName: string;
  emirate: string;
  lat: number;
  lng: number;
  geofenceRadiusMeters: number;
  freeDaysDry: number;
  freeDaysReefer: number;
  operatingHours: string;
  status: string;
}

export interface DrayageWarehouse {
  id: string;
  tenantId: string;
  customerId: string | null;
  customerName: string;
  name: string;
  code?: string | null;
  zone: string;
  address: string;
  lat: number;
  lng: number;
  rampsCount: number;
  contactPerson: string | null;
  contactPhone: string | null;
  geofenceConfigured?: boolean;
  geofenceType?: 'CIRCLE' | 'POLYGON';
  geofenceRadiusMeters?: number;
  geofenceCoordinatesJson?: string;
  tripAmountAed?: number | null;
  driverAllowanceAed?: number | null;
}

export interface DrayageClient {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  contactPerson: string | null;
  contactNo: string | null;
  streetAddress: string | null;
  city: string;
  trn: string | null;
  tradeLicense: string | null;
  defaultTripAmountAed: number;
  defaultDriverAllowanceAed: number;
  notes: string | null;
  warehouseCount: number;
  warehouses?: DrayageWarehouse[];
  createdAt: string;
  updatedAt: string;
}

export interface DrayageTrailer {
  id: string;
  tenantId: string;
  plateNumber: string;
  trailerType: '20FT_SKELETAL' | '40FT_SKELETAL' | '40FT_FLATBED' | '45FT_REEFER_CHASSIS' | '40FT_LOWBED' | string;
  capacityTons: number;
  masterStatus: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE';
  operationalStatus: 'EMPTY' | 'LOADED_FCL' | 'DETACHED_AT_RAMP' | 'DETACHED_AT_YARD' | 'EN_ROUTE_MT';
  linkedContainerNumber: string | null;
  currentLocation: string | null;
  lat: number | null;
  lng: number | null;
}

export interface MappedFleetVehicle {
  id: string;
  plateNumber: string;
  make: string;
  model: string;
  year: number | null;
  status: string;
  vehicleUsage: string;
  type?: string | null;
  fuelType: string | null;
  fuelLevelPct?: number | null;
  currentMileage: number | null;
  nextServiceKm?: number | null;
  registrationExpiry: string | null;
  insuranceExpiry: string | null;
  assignedDriverId: string | null;
  assignedDriverName: string | null;
  activeJobCode: string | null;
  lat: number;
  lng: number;
  updatedAt?: string | null;
  assignedTripsCount?: number;
}

export interface MappedFleetDriver {
  id: string;
  employeeId: string | null;
  fullName: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  status: string;
  assignmentType: string | null;
  assignedVehicleId: string | null;
  activeJobCode: string | null;
  complianceOk: boolean;
  completedTripsToday?: number;
}

export interface MappedFleetCustomer {
  id: string;
  customerCode: string | null;
  name: string;
  nameAr: string | null;
  customerType: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  tradeLicense: string | null;
}

export interface DrayageDemurrageInfo {
  containerType: string;
  freeDaysAllowed: number;
  daysInPort: number;
  freeDaysRemaining: number;
  overdueDays: number;
  status: 'SAFE' | 'WARNING' | 'CRITICAL_OVERDUE' | 'RETURNED';
  tierLabel: string;
  dailyRateAed: number;
  accruedPenaltyAed: number;
}

export interface DrayageContainer {
  id: string;
  tenantId: string;
  containerNumber: string;
  size: '20FT' | '40FT' | '40HC' | '45HC' | string;
  containerType: 'DRY' | 'REEFER' | 'OPEN_TOP' | 'FLAT_RACK' | string;
  shipmentType: 'IMPORT' | 'EXPORT' | string;
  status: string;
  customerId: string | null;
  customerName: string;
  terminalId: string | null;
  terminalName: string;
  warehouseId: string | null;
  warehouseName: string;
  doExpiryDate: string | null;
  dischargeDate: string;
  emptyReturnDate: string | null;
  sealNumber: string | null;
  weightKg: number;
  customsInspection: boolean;
  municipalityInspection: boolean;
  cpipInspection: boolean;
  mercInspection: boolean;
  boxcareInspection: boolean;
  linkedTrailerPlate: string | null;
  demurrage: DrayageDemurrageInfo;
}

export interface DrayageJob {
  id: string;
  tenantId: string;
  jobCode: string;
  jobPhase: 'L1' | 'L2';
  parentJobId: string | null;
  shipmentType: 'IMPORT' | 'EXPORT';
  status: string;
  priority: 'STANDARD' | 'HIGH' | 'URGENT';
  customerId: string | null;
  customerName: string;
  warehouseId: string | null;
  warehouseName: string;
  terminalId: string | null;
  terminalName: string;
  containerId: string | null;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  doExpiryDate: string | null;
  tokenNumber: string | null;
  assignedVehicleId: string | null;
  assignedVehiclePlate: string | null;
  assignedDriverId: string | null;
  assignedDriverName: string | null;
  assignedTrailerId: string | null;
  assignedTrailerPlate: string | null;
  placementLocation: 'RAMP' | 'YARD' | null;
  trailerDetached: boolean;
  l2Activated: boolean;
  etcTime: string | null;
  etcAlertStatus: string;
  rateAmountAed: number;
  driverAllowanceAed: number;
  customsInspection: boolean;
  municipalityInspection: boolean;
  cpipInspection: boolean;
  mercInspection: boolean;
  boxcareInspection: boolean;
  currentLat: number | null;
  currentLng: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  cargoWeightKg?: number;
  shippingLine?: string;
  bogieJobId?: string | null;
  streetTurnJobId?: string | null;
}

export interface StreetTurnMatch {
  id: string;
  l2Job: DrayageJob;
  exportJob: DrayageJob;
  shippingLine: string;
  carrierPrefix: string;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  originWarehouse: string;
  destWarehouse: string;
  zone: string;
  interWarehouseDistanceKm: number;
  terminalName: string;
  deadheadKmSaved: number;
  co2SavedKg: number;
  fuelSavingsAed: number;
  turnaroundHoursSaved: number;
  score: number;
}

export interface BogiePairCandidate {
  id: string;
  job1: DrayageJob;
  job2: DrayageJob;
  commonTerminal: string;
  zone1: string;
  zone2: string;
  sameZone: boolean;
  box1WeightKg: number;
  box2WeightKg: number;
  totalPayloadKg: number;
  isWeightCompliant: boolean;
  weightLimitKg: number;
  weightUtilizationPct: number;
  recommendedTrailerType: string;
  combinedRevenueAed: number;
  combinedAllowanceAed: number;
  fuelSavingPct: number;
  tasSlot: string;
  score: number;
}

export interface DrayageDriverAllowance {
  id: string;
  tenantId: string;
  jobId: string;
  jobCode: string;
  driverId: string;
  driverName: string;
  vehiclePlate: string | null;
  containerNumber: string;
  tripPhase: 'L1' | 'L2';
  routeSummary: string;
  allowanceAmountAed: number;
  portGateFeeAed: number;
  overnightHaltAed: number;
  totalAmountAed: number;
  status: 'PENDING' | 'APPROVED' | 'PAID';
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface DrayageGeofence {
  id: string;
  tenantId: string;
  terminalId: string | null;
  terminalName: string;
  name: string;
  type: 'CIRCLE' | 'POLYGON';
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  coordinatesJson: string;
  createdAt: string;
}

export interface DrayageStatusLog {
  id: string;
  tenantId: string;
  jobId: string;
  jobCode: string;
  status: string;
  notes: string;
  actor: string;
  timestamp: string;
}

export interface DrayageDispatchMessage {
  id: string;
  tenantId: string;
  jobId: string;
  jobCode: string;
  senderRole: 'DISPATCHER' | 'DRIVER';
  senderName: string;
  message: string;
  isUrgent: boolean;
  createdAt: string;
}

export interface DrayageAlertItem {
  id: string;
  tenantId: string;
  type: 'DO_EXPIRY' | 'DEMURRAGE_CRITICAL' | 'DEMURRAGE_WARNING' | 'DETACHED_TRAILER' | 'PORT_TOKEN_PENDING';
  severity: 'URGENT' | 'CRITICAL' | 'WARNING';
  title: string;
  message: string;
  terminalName: string;
  containerId: string | null;
  containerNumber: string | null;
  jobId: string | null;
  jobCode: string | null;
  driverName: string | null;
  driverPhone: string | null;
  acknowledged: boolean;
  createdAt: string;
}

/**
 * The drayage tables are created by prisma/migrations/20261103090000_logistics_drayage_tables.
 * This used to run CREATE/ALTER TABLE at runtime (blocked by the runtime-DDL
 * guard), which in production failed silently: the app role has no DDL rights.
 * Kept as a no-op so existing callers need no change.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function ensureDrayageSchema(_db: DrayageDbClient): Promise<void> {}

export function calculateDemurrageClock(args: {
  containerType: string;
  dischargeDate: Date | string;
  emptyReturnDate?: Date | string | null;
  status: string;
  freeDaysDry?: number;
  freeDaysReefer?: number;
}): DrayageDemurrageInfo {
  const isReefer = String(args.containerType).toUpperCase().includes('REEFER');
  const freeDaysAllowed = isReefer ? (args.freeDaysReefer ?? 3) : (args.freeDaysDry ?? 5);
  const discharge = new Date(args.dischargeDate);
  const endRef = args.emptyReturnDate ? new Date(args.emptyReturnDate) : new Date();
  const diffMs = Math.max(0, endRef.getTime() - discharge.getTime());
  const daysInPort = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  const freeDaysRemaining = Math.max(0, freeDaysAllowed - daysInPort);
  const overdueDays = Math.max(0, daysInPort - freeDaysAllowed);

  let accruedPenaltyAed = 0;
  let dailyRateAed = 0;
  let tierLabel = 'Free Period';

  if (overdueDays > 0) {
    const tier1Days = Math.min(overdueDays, 5);
    const tier2Days = Math.max(0, Math.min(overdueDays - 5, 5));
    const tier3Days = Math.max(0, overdueDays - 10);

    const t1Rate = isReefer ? 280 : 180;
    const t2Rate = isReefer ? 480 : 350;
    const t3Rate = isReefer ? 750 : 550;

    accruedPenaltyAed = (tier1Days * t1Rate) + (tier2Days * t2Rate) + (tier3Days * t3Rate);
    if (overdueDays <= 5) {
      dailyRateAed = t1Rate;
      tierLabel = 'Tier 1 (Days 1–5 Overdue)';
    } else if (overdueDays <= 10) {
      dailyRateAed = t2Rate;
      tierLabel = 'Tier 2 (Days 6–10 Overdue)';
    } else {
      dailyRateAed = t3Rate;
      tierLabel = 'Tier 3 (Day 11+ Overdue)';
    }
  }

  const normalizedStatus = String(args.status).toUpperCase();
  const isReturned = normalizedStatus === 'COMPLETED' || normalizedStatus === 'EMPTY_DEPOSITED' || Boolean(args.emptyReturnDate);

  let status: DrayageDemurrageInfo['status'] = 'SAFE';
  if (isReturned) {
    status = 'RETURNED';
  } else if (overdueDays > 0) {
    status = 'CRITICAL_OVERDUE';
  } else if (freeDaysRemaining <= 1) {
    status = 'WARNING';
  }

  return {
    containerType: isReefer ? 'REEFER' : 'DRY',
    freeDaysAllowed,
    daysInPort,
    freeDaysRemaining,
    overdueDays,
    status,
    tierLabel,
    dailyRateAed,
    accruedPenaltyAed,
  };
}

const seededTenants = new Set<string>();


export function detectShippingLine(containerNumber?: string | null, explicitLine?: string | null): string {
  if (explicitLine && explicitLine.trim()) return explicitLine.trim().toUpperCase();
  if (!containerNumber) return 'CARRIER_DEFAULT';
  const prefix = containerNumber.trim().toUpperCase().slice(0, 4);
  if (prefix.startsWith('MSC') || prefix.startsWith('MED')) return 'MSC';
  if (prefix.startsWith('MAE') || prefix.startsWith('MSK')) return 'MAERSK';
  if (prefix.startsWith('HLC') || prefix.startsWith('HLX')) return 'HAPAG-LLOYD';
  if (prefix.startsWith('CMA')) return 'CMA CGM';
  if (prefix.startsWith('ONE')) return 'ONE';
  if (prefix.startsWith('COS')) return 'COSCO';
  if (prefix.startsWith('EGL') || prefix.startsWith('EMC')) return 'EVERGREEN';
  return prefix || 'GENERIC_LINE';
}

export function getWarehouseZoneName(name?: string | null): string {
  const lower = (name || '').toLowerCase();
  if (lower.includes('jafza south') || lower.includes('south')) return 'JAFZA South';
  if (lower.includes('jafza') || lower.includes('jebel ali free zone')) return 'JAFZA North';
  if (lower.includes('nip') || lower.includes('national industries')) return 'National Industries Park (NIP)';
  if (lower.includes('dubai south') || lower.includes('dwc')) return 'Dubai South (DWC)';
  if (lower.includes('al quoz')) return 'Al Quoz Industrial';
  if (lower.includes('kizad') || lower.includes('kezad') || lower.includes('khalifa')) return 'KEZAD Industrial';
  return 'Dubai Logistics Corridor';
}

export async function seedTenantDrayageDefaultsIfNeeded(db: DrayageDbClient, tenantId: string) {
  if (seededTenants.has(tenantId)) return;
  await ensureDrayageSchema(db);

  const termCountRows = await db.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
    `SELECT COUNT(*) AS cnt FROM logistics_drayage_terminals WHERE tenant_id = $1`,
    tenantId,
  );
  const termCount = Number(termCountRows[0]?.cnt ?? 0);

  if (termCount === 0) {
    const defaultTerminals = [
      {
        id: `term-ja1-${tenantId.slice(0, 8)}`,
        name: 'Jebel Ali Port - Terminal 1 (DP World)',
        code: 'DPW-JA-T1',
        portName: 'Jebel Ali Port',
        emirate: 'Dubai',
        lat: 25.0112,
        lng: 55.0612,
        radius: 1800,
        dry: 5,
        reefer: 3,
      },
      {
        id: `term-ja2-${tenantId.slice(0, 8)}`,
        name: 'Jebel Ali Port - Terminal 2 (Mega Vessel Berth)',
        code: 'DPW-JA-T2',
        portName: 'Jebel Ali Port',
        emirate: 'Dubai',
        lat: 25.0245,
        lng: 55.0488,
        radius: 2000,
        dry: 5,
        reefer: 3,
      },
      {
        id: `term-ja3-${tenantId.slice(0, 8)}`,
        name: 'Jebel Ali Port - Terminal 3 (Automated)',
        code: 'DPW-JA-T3',
        portName: 'Jebel Ali Port',
        emirate: 'Dubai',
        lat: 24.9960,
        lng: 55.0390,
        radius: 1600,
        dry: 5,
        reefer: 3,
      },
      {
        id: `term-kp-${tenantId.slice(0, 8)}`,
        name: 'Khalifa Port Container Terminal (AD Ports)',
        code: 'ADP-KP-T1',
        portName: 'Khalifa Port',
        emirate: 'Abu Dhabi',
        lat: 24.8055,
        lng: 54.6462,
        radius: 2200,
        dry: 5,
        reefer: 3,
      },
      {
        id: `term-pr-${tenantId.slice(0, 8)}`,
        name: 'Mina Rashid / Port Khorfakkan Hub',
        code: 'DPW-PR-T1',
        portName: 'Port Rashid',
        emirate: 'Dubai',
        lat: 25.2684,
        lng: 55.2762,
        radius: 1400,
        dry: 5,
        reefer: 3,
      },
    ];

    for (const t of defaultTerminals) {
      await db.$executeRawUnsafe(
        `INSERT INTO logistics_drayage_terminals (
          id, tenant_id, name, code, port_name, emirate, lat, lng,
          geofence_radius_meters, free_days_dry, free_days_reefer, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE')
        ON CONFLICT (id) DO NOTHING`,
        t.id, tenantId, t.name, t.code, t.portName, t.emirate, t.lat, t.lng, t.radius, t.dry, t.reefer,
      );
    }
  }

  const cliCountRows = await db.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
    `SELECT COUNT(*) AS cnt FROM logistics_drayage_clients WHERE tenant_id = $1`,
    tenantId,
  ).catch(() => [{ cnt: 0 }]);

  if (Number(cliCountRows[0]?.cnt ?? 0) === 0) {
    const defaultClients = [
      {
        id: `cli-al-futtaim-${tenantId.slice(0, 8)}`,
        name: 'Al-Futtaim Logistics LLC',
        code: 'ALF-LOG',
        contactPerson: 'Tariq Al-Mansoori',
        contactNo: '+971 50 482 9910',
        streetAddress: 'Plot S-204, Road 4, JAFZA South',
        city: 'Dubai',
        trn: '100294820100003',
        tradeLicense: 'CN-1029481',
        defaultTripAmountAed: 1550,
        defaultDriverAllowanceAed: 150,
        notes: 'Priority FCL client. Direct gate delivery to JAFZA South Gate 5 ramp.',
      },
      {
        id: `cli-landmark-${tenantId.slice(0, 8)}`,
        name: 'Landmark Retail Distribution',
        code: 'LMK-RET',
        contactPerson: 'Saeed Al-Hashemi',
        contactNo: '+971 52 819 3320',
        streetAddress: 'Sector B, Street 14, National Industries Park (NIP)',
        city: 'Dubai',
        trn: '100882194000003',
        tradeLicense: 'CN-2049182',
        defaultTripAmountAed: 1600,
        defaultDriverAllowanceAed: 160,
        notes: 'High volume import accounts. Rapid turn-around required.',
      },
      {
        id: `cli-chalhoub-${tenantId.slice(0, 8)}`,
        name: 'Chalhoub Luxury Supply Chain',
        code: 'CHB-LUX',
        contactPerson: 'Nadia Haddad',
        contactNo: '+971 55 301 7741',
        streetAddress: 'Logistics District, Corridor 3, Dubai South (DWC)',
        city: 'Dubai',
        trn: '100492817000003',
        tradeLicense: 'CN-3918274',
        defaultTripAmountAed: 1750,
        defaultDriverAllowanceAed: 180,
        notes: 'Bonded transit clearance and temperature-controlled reefer cargo.',
      },
      {
        id: `cli-adnoc-${tenantId.slice(0, 8)}`,
        name: 'ADNOC Industrial Polymers',
        code: 'ADN-POL',
        contactPerson: 'Rashid Al-Nuaimi',
        contactNo: '+971 50 912 4402',
        streetAddress: 'Zone A12, Khalifa Economic Zones Abu Dhabi (KEZAD)',
        city: 'Abu Dhabi',
        trn: '100381920000003',
        tradeLicense: 'CN-4819201',
        defaultTripAmountAed: 2100,
        defaultDriverAllowanceAed: 220,
        notes: 'Heavy petrochemicals and polymer resins corridor to Khalifa Port.',
      },
    ];

    for (const c of defaultClients) {
      await db.$executeRawUnsafe(
        `INSERT INTO logistics_drayage_clients (
          id, tenant_id, name, code, contact_person, contact_no, street_address, city,
          trn, trade_license, default_trip_amount_aed, default_driver_allowance_aed, notes, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
        ON CONFLICT (id) DO NOTHING`,
        c.id, tenantId, c.name, c.code, c.contactPerson, c.contactNo, c.streetAddress, c.city,
        c.trn, c.tradeLicense, c.defaultTripAmountAed, c.defaultDriverAllowanceAed, c.notes,
      );
    }
  }

  const whCountRows = await db.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
    `SELECT COUNT(*) AS cnt FROM logistics_drayage_warehouses WHERE tenant_id = $1`,
    tenantId,
  );
  if (Number(whCountRows[0]?.cnt ?? 0) === 0) {
    // Check if tenant has customers in Fleet360 `customers` table to link against
    const existingCustomers = await db.$queryRawUnsafe<Array<{ id: string; name_en: string }>>(
      `SELECT id, name_en FROM customers WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 4`,
      tenantId,
    ).catch(() => []);

    const defaultWarehouses = [
      {
        id: `wh-jafza-${tenantId.slice(0, 8)}`,
        customerId: existingCustomers[0]?.id ?? null,
        customerName: existingCustomers[0]?.name_en ?? 'Al-Futtaim Logistics LLC',
        name: 'JAFZA South Bonded Fulfillment Hub (Gate 5)',
        zone: 'JAFZA South, Dubai',
        address: 'Plot S-204, Jebel Ali Free Zone South, Dubai',
        lat: 24.9642,
        lng: 55.0915,
        ramps: 12,
        contact: 'Tariq Al-Mansoori',
        phone: '+971 50 482 9910',
      },
      {
        id: `wh-nip-${tenantId.slice(0, 8)}`,
        customerId: existingCustomers[1]?.id ?? null,
        customerName: existingCustomers[1]?.name_en ?? 'Landmark Retail Distribution',
        name: 'National Industries Park (NIP) Mega Automated DC',
        zone: 'NIP / TechnoPark, Dubai',
        address: 'Sector B, Street 14, National Industries Park, Dubai',
        lat: 24.9310,
        lng: 55.0750,
        ramps: 18,
        contact: 'Saeed Al-Hashemi',
        phone: '+971 52 819 3320',
      },
      {
        id: `wh-dwc-${tenantId.slice(0, 8)}`,
        customerId: existingCustomers[2]?.id ?? null,
        customerName: existingCustomers[2]?.name_en ?? 'Chalhoub Luxury Supply Chain',
        name: 'Dubai South Aviation & Cold-Chain Hub',
        zone: 'Dubai South (DWC)',
        address: 'Logistics District, Corridor 3, Dubai South',
        lat: 24.8960,
        lng: 55.1580,
        ramps: 8,
        contact: 'Nadia Haddad',
        phone: '+971 55 301 7741',
      },
      {
        id: `wh-kizad-${tenantId.slice(0, 8)}`,
        customerId: existingCustomers[3]?.id ?? null,
        customerName: existingCustomers[3]?.name_en ?? 'ADNOC Industrial Polymers',
        name: 'KEZAD Integrated Polymer & Cold Depot',
        zone: 'KEZAD, Abu Dhabi',
        address: 'Zone A12, Khalifa Economic Zones Abu Dhabi',
        lat: 24.7690,
        lng: 54.7120,
        ramps: 10,
        contact: 'Rashid Al-Nuaimi',
        phone: '+971 50 912 4402',
      },
    ];

    for (const w of defaultWarehouses) {
      await db.$executeRawUnsafe(
        `INSERT INTO logistics_drayage_warehouses (
          id, tenant_id, customer_id, customer_name, name, zone, address, lat, lng, ramps_count, contact_person, contact_phone,
          geofence_configured, geofence_type, geofence_radius_meters, trip_amount_aed, driver_allowance_aed
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,'CIRCLE',800,1550,150)
        ON CONFLICT (id) DO UPDATE
           SET geofence_configured = true,
               geofence_radius_meters = 800,
               trip_amount_aed = 1550,
               driver_allowance_aed = 150`,
        w.id, tenantId, w.customerId, w.customerName, w.name, w.zone, w.address, w.lat, w.lng, w.ramps, w.contact, w.phone,
      );
    }
  }

  const trCountRows = await db.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
    `SELECT COUNT(*) AS cnt FROM logistics_drayage_trailers WHERE tenant_id = $1`,
    tenantId,
  );
  if (Number(trCountRows[0]?.cnt ?? 0) === 0) {
    const defaultTrailers = [
      { id: `tr-9901-${tenantId.slice(0, 8)}`, plate: 'DXB-TR-9901', type: '40FT_SKELETAL', tons: 45, mStatus: 'IN_USE', opStatus: 'LOADED_FCL', cnt: 'MSCU8492014', loc: 'Sheikh Zayed Rd (E11) Corridor', lat: 24.9850, lng: 55.0760 },
      { id: `tr-9902-${tenantId.slice(0, 8)}`, plate: 'DXB-TR-9902', type: '40FT_FLATBED', tons: 48, mStatus: 'IN_USE', opStatus: 'DETACHED_AT_RAMP', cnt: 'MAEU5910283', loc: 'JAFZA South Ramp #4', lat: 24.9642, lng: 55.0915 },
      { id: `tr-9903-${tenantId.slice(0, 8)}`, plate: 'DXB-TR-9903', type: '45FT_REEFER_CHASSIS', tons: 45, mStatus: 'AVAILABLE', opStatus: 'EMPTY', cnt: null, loc: 'Jebel Ali Main Yard', lat: 25.0080, lng: 55.0640 },
      { id: `tr-8801-${tenantId.slice(0, 8)}`, plate: 'AUH-TR-8801', type: '20FT_SKELETAL', tons: 34, mStatus: 'AVAILABLE', opStatus: 'EMPTY', cnt: null, loc: 'Khalifa Port Marshalling Yard', lat: 24.8055, lng: 54.6462 },
      { id: `tr-7704-${tenantId.slice(0, 8)}`, plate: 'SHJ-TR-7704', type: '40FT_LOWBED', tons: 60, mStatus: 'AVAILABLE', opStatus: 'EMPTY', cnt: null, loc: 'National Industries Park Yard', lat: 24.9310, lng: 55.0750 },
    ];
    for (const tr of defaultTrailers) {
      await db.$executeRawUnsafe(
        `INSERT INTO logistics_drayage_trailers (
          id, tenant_id, plate_number, trailer_type, capacity_tons, master_status,
          operational_status, linked_container_number, current_location, lat, lng
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (id) DO NOTHING`,
        tr.id, tenantId, tr.plate, tr.type, tr.tons, tr.mStatus, tr.opStatus, tr.cnt, tr.loc, tr.lat, tr.lng,
      );
    }
  }

  // Ensure dedicated Heavy Prime Movers / Tractors exist for Drayage logistics
  const primeMoverCountRows = await db.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
    `SELECT COUNT(*) AS cnt
       FROM vehicles
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND (
          vehicle_usage = 'LOGISTICS'
          OR type IN ('PRIME_MOVER', 'HEAVY_TRUCK', 'TRACTOR')
          OR vehicle_group IN ('TRUCK', 'HEAVY_VEHICLE', 'PRIME_MOVER')
        )`,
    tenantId,
  ).catch(() => [{ cnt: 0 }]);

  if (Number(primeMoverCountRows[0]?.cnt ?? 0) === 0) {
    const defaultPrimeMovers = [
      { id: `pm-actros-1-${tenantId.slice(0, 8)}`, plate: 'DXB-PR-4011', make: 'Mercedes-Benz', model: 'Actros 2645 LS Prime Mover (6x4)', year: 2024, lat: 25.0112, lng: 55.0612, fuel: 88, mileage: 42000, nextService: 50000, idleHours: 4.5 },
      { id: `pm-volvo-2-${tenantId.slice(0, 8)}`, plate: 'DXB-PR-4012', make: 'Volvo', model: 'FH16 540 Globetrotter Tractor (6x4)', year: 2024, lat: 24.9850, lng: 55.0760, fuel: 94, mileage: 38000, nextService: 45000, idleHours: 2.5 },
      { id: `pm-man-3-${tenantId.slice(0, 8)}`, plate: 'DXB-PR-4013', make: 'MAN', model: 'TGX 33.540 BBS Heavy Hauler (6x4)', year: 2023, lat: 24.9642, lng: 55.0915, fuel: 75, mileage: 65000, nextService: 70000, idleHours: 5.8 },
      { id: `pm-scania-4-${tenantId.slice(0, 8)}`, plate: 'DXB-PR-4014', make: 'Scania', model: 'R500 V8 Heavy Tractor (6x4)', year: 2024, lat: 24.9310, lng: 55.0750, fuel: 68, mileage: 51000, nextService: 60000, idleHours: 1.2 },
      { id: `pm-actros-5-${tenantId.slice(0, 8)}`, plate: 'AUH-PR-3021', make: 'Mercedes-Benz', model: 'Actros 3340 Heavy Prime Mover (6x4)', year: 2023, lat: 24.8055, lng: 54.6462, fuel: 82, mileage: 78000, nextService: 85000, idleHours: 3.0 },
    ];
    for (const pm of defaultPrimeMovers) {
      await db.$executeRawUnsafe(
        `INSERT INTO vehicles (
          id, tenant_id, plate_number, license_plate, registration_no,
          make, model, year, type, vehicle_group, vehicle_usage, status, fuel_type, is_active,
          current_lat, current_lng, fuel_level_pct, fuel_level, current_mileage, next_service_km,
          created_at, updated_at
        ) VALUES ($1,$2,$3,$3,$3,$4,$5,$6,'PRIME_MOVER','TRUCK','LOGISTICS','AVAILABLE','DIESEL',true,$7,$8,$9,$9,$10,$11,NOW(),NOW() - ($12 || ' hours')::interval)
        ON CONFLICT (id) DO UPDATE
          SET current_lat = EXCLUDED.current_lat,
              current_lng = EXCLUDED.current_lng,
              fuel_level_pct = EXCLUDED.fuel_level_pct,
              updated_at = EXCLUDED.updated_at`,
        pm.id, tenantId, pm.plate, pm.make, pm.model, pm.year,
        pm.lat, pm.lng, pm.fuel, pm.mileage, pm.nextService, String(pm.idleHours),
      ).catch(() => {});
    }
  }

  // Ensure dedicated Heavy Duty Drayage Drivers exist
  const heavyDriverCountRows = await db.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
    `SELECT COUNT(*) AS cnt FROM drivers WHERE tenant_id = $1 AND deleted_at IS NULL AND (license_type = 'HEAVY' OR license_type IS NULL)`,
    tenantId,
  ).catch(() => [{ cnt: 0 }]);

  if (Number(heavyDriverCountRows[0]?.cnt ?? 0) === 0) {
    const defaultDrivers = [
      { id: `drv-salim-${tenantId.slice(0, 8)}`, name: 'Salim Al Harthi', phone: '+971 50 128 4491' },
      { id: `drv-rashid-${tenantId.slice(0, 8)}`, name: 'Rashid Al-Marri', phone: '+971 52 391 8840' },
      { id: `drv-tariq-${tenantId.slice(0, 8)}`, name: 'Tariq Mahmood', phone: '+971 55 490 2210' },
      { id: `drv-imran-${tenantId.slice(0, 8)}`, name: 'Imran Khan', phone: '+971 56 718 3392' },
    ];
    for (const d of defaultDrivers) {
      await db.$executeRawUnsafe(
        `INSERT INTO drivers (
          id, tenant_id, name, contact_number, license_type, status, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,'HEAVY','ACTIVE',NOW(),NOW())
        ON CONFLICT (id) DO NOTHING`,
        d.id, tenantId, d.name, d.phone,
      ).catch(() => {});
    }
  }

  // Seed initial realistic drayage containers & jobs if none exist yet
  const jobCountRows = await db.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
    `SELECT COUNT(*) AS cnt FROM logistics_drayage_jobs WHERE tenant_id = $1`,
    tenantId,
  );
  if (Number(jobCountRows[0]?.cnt ?? 0) === 0) {
    // Grab mapped Fleet360 vehicles and drivers if available
    const vehicles = await db.$queryRawUnsafe<Array<{ id: string; plate_number: string | null; license_plate: string | null }>>(
      `SELECT id, plate_number, license_plate FROM vehicles WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 3`,
      tenantId,
    ).catch(() => []);
    const drivers = await db.$queryRawUnsafe<Array<{ id: string; first_name: string | null; last_name: string | null; name: string | null }>>(
      `SELECT id, first_name, last_name, name FROM drivers WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 3`,
      tenantId,
    ).catch(() => []);

    const v1Id = vehicles[0]?.id ?? null;
    const v1Plate = vehicles[0]?.plate_number ?? vehicles[0]?.license_plate ?? 'DXB-84920';
    const d1Id = drivers[0]?.id ?? null;
    const d1Name = drivers[0] ? (`${drivers[0].first_name ?? ''} ${drivers[0].last_name ?? ''}`.trim() || drivers[0].name || 'rashid Al-Marri') : 'Rashid Al-Marri';

    const v2Id = vehicles[1]?.id ?? null;
    const v2Plate = vehicles[1]?.plate_number ?? vehicles[1]?.license_plate ?? 'DXB-51209';
    const d2Id = drivers[1]?.id ?? null;
    const d2Name = drivers[1] ? (`${drivers[1].first_name ?? ''} ${drivers[1].last_name ?? ''}`.trim() || drivers[1].name || 'Imran Khan') : 'Imran Khan';

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const sampleContainers = [
      {
        id: `cnt-1-${tenantId.slice(0, 8)}`,
        num: 'MSCU8492014',
        size: '40HC',
        type: 'DRY',
        shipType: 'IMPORT',
        status: 'IN_TRANSIT',
        custName: 'Al-Futtaim Logistics LLC',
        termId: `term-ja1-${tenantId.slice(0, 8)}`,
        termName: 'Jebel Ali Port - Terminal 1 (DP World)',
        whId: `wh-jafza-${tenantId.slice(0, 8)}`,
        whName: 'JAFZA South Bonded Fulfillment Hub (Gate 5)',
        doExp: new Date(now + 3 * dayMs).toISOString(),
        disch: new Date(now - 3 * dayMs).toISOString(),
        seal: 'DPW-884120',
        wt: 24800,
        customs: true,
        muni: false,
        cpip: true,
        merc: false,
        boxcare: true,
        trPlate: 'DXB-TR-9901',
      },
      {
        id: `cnt-2-${tenantId.slice(0, 8)}`,
        num: 'MAEU5910283',
        size: '40HC',
        type: 'DRY',
        shipType: 'IMPORT',
        status: 'PLACED_AT_RAMP',
        custName: 'Landmark Retail Distribution',
        termId: `term-ja2-${tenantId.slice(0, 8)}`,
        termName: 'Jebel Ali Port - Terminal 2 (Mega Vessel Berth)',
        whId: `wh-nip-${tenantId.slice(0, 8)}`,
        whName: 'National Industries Park (NIP) Mega Automated DC',
        doExp: new Date(now + 1 * dayMs).toISOString(),
        disch: new Date(now - 5 * dayMs).toISOString(),
        seal: 'MSK-391044',
        wt: 26200,
        customs: true,
        muni: true,
        cpip: false,
        merc: false,
        boxcare: false,
        trPlate: 'DXB-TR-9902',
      },
      {
        id: `cnt-3-${tenantId.slice(0, 8)}`,
        num: 'CMAU3019482',
        size: '40HC',
        type: 'REEFER',
        shipType: 'IMPORT',
        status: 'AT_PORT_DISCHARGED',
        custName: 'Chalhoub Luxury Supply Chain',
        termId: `term-ja1-${tenantId.slice(0, 8)}`,
        termName: 'Jebel Ali Port - Terminal 1 (DP World)',
        whId: `wh-dwc-${tenantId.slice(0, 8)}`,
        whName: 'Dubai South Aviation & Cold-Chain Hub',
        doExp: new Date(now - 1 * dayMs).toISOString(),
        disch: new Date(now - 6 * dayMs).toISOString(), // 6 days in port on a 3-day free Reefer -> 3 days overdue!
        seal: 'CMA-772109',
        wt: 21500,
        customs: true,
        muni: true,
        cpip: true,
        merc: true,
        boxcare: false,
        trPlate: null,
      },
      {
        id: `cnt-4-${tenantId.slice(0, 8)}`,
        num: 'HLXU9041128',
        size: '20FT',
        type: 'DRY',
        shipType: 'EXPORT',
        status: 'AT_PORT_DISCHARGED',
        custName: 'ADNOC Industrial Polymers',
        termId: `term-kp-${tenantId.slice(0, 8)}`,
        termName: 'Khalifa Port Container Terminal (AD Ports)',
        whId: `wh-kizad-${tenantId.slice(0, 8)}`,
        whName: 'KEZAD Integrated Polymer & Cold Depot',
        doExp: new Date(now + 4 * dayMs).toISOString(),
        disch: new Date(now - 9 * dayMs).toISOString(), // 9 days in port on a 5-day free Dry -> 4 days overdue!
        seal: 'HPL-550192',
        wt: 19800,
        customs: true,
        muni: false,
        cpip: false,
        merc: false,
        boxcare: true,
        trPlate: null,
      },
    ];

    for (const c of sampleContainers) {
      await db.$executeRawUnsafe(
        `INSERT INTO logistics_drayage_containers (
          id, tenant_id, container_number, size, container_type, shipment_type, status,
          customer_name, terminal_id, terminal_name, warehouse_id, warehouse_name,
          do_expiry_date, discharge_date, seal_number, weight_kg,
          customs_inspection, municipality_inspection, cpip_inspection, merc_inspection, boxcare_inspection,
          linked_trailer_plate
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
          $13::timestamptz,$14::timestamptz,$15,$16,$17,$18,$19,$20,$21,$22
        ) ON CONFLICT (id) DO NOTHING`,
        c.id, tenantId, c.num, c.size, c.type, c.shipType, c.status,
        c.custName, c.termId, c.termName, c.whId, c.whName,
        c.doExp, c.disch, c.seal, c.wt,
        c.customs, c.muni, c.cpip, c.merc, c.boxcare, c.trPlate,
      );
    }

    const sampleJobs = [
      {
        id: `job-1-${tenantId.slice(0, 8)}`,
        code: 'DRY-L1-1001',
        phase: 'L1',
        shipType: 'IMPORT',
        status: 'IN_TRANSIT',
        priority: 'HIGH',
        custName: 'Al-Futtaim Logistics LLC',
        whId: `wh-jafza-${tenantId.slice(0, 8)}`,
        whName: 'JAFZA South Bonded Fulfillment Hub (Gate 5)',
        termId: `term-ja1-${tenantId.slice(0, 8)}`,
        termName: 'Jebel Ali Port - Terminal 1 (DP World)',
        cntId: `cnt-1-${tenantId.slice(0, 8)}`,
        cntNum: 'MSCU8492014',
        cntSize: '40HC',
        cntType: 'DRY',
        doExp: new Date(now + 3 * dayMs).toISOString(),
        token: 'DPW-TKN-8841',
        vId: v1Id,
        vPlate: v1Plate,
        dId: d1Id,
        dName: d1Name,
        trId: `tr-9901-${tenantId.slice(0, 8)}`,
        trPlate: 'DXB-TR-9901',
        placement: null,
        detached: false,
        l2Act: false,
        rate: 1650,
        allow: 160,
        customs: true,
        muni: false,
        cpip: true,
        merc: false,
        boxcare: true,
        lat: 24.9875,
        lng: 55.0762,
      },
      {
        id: `job-2-${tenantId.slice(0, 8)}`,
        code: 'DRY-L1-1002',
        phase: 'L1',
        shipType: 'IMPORT',
        status: 'CONTAINER_DETACHED',
        priority: 'STANDARD',
        custName: 'Landmark Retail Distribution',
        whId: `wh-nip-${tenantId.slice(0, 8)}`,
        whName: 'National Industries Park (NIP) Mega Automated DC',
        termId: `term-ja2-${tenantId.slice(0, 8)}`,
        termName: 'Jebel Ali Port - Terminal 2 (Mega Vessel Berth)',
        cntId: `cnt-2-${tenantId.slice(0, 8)}`,
        cntNum: 'MAEU5910283',
        cntSize: '40HC',
        cntType: 'DRY',
        doExp: new Date(now + 1 * dayMs).toISOString(),
        token: 'DPW-TKN-7920',
        vId: v2Id,
        vPlate: v2Plate,
        dId: d2Id,
        dName: d2Name,
        trId: `tr-9902-${tenantId.slice(0, 8)}`,
        trPlate: 'DXB-TR-9902',
        placement: 'RAMP',
        detached: true,
        l2Act: false,
        rate: 1500,
        allow: 150,
        customs: true,
        muni: true,
        cpip: false,
        merc: false,
        boxcare: false,
        lat: 24.9310,
        lng: 55.0750,
      },
      {
        id: `job-3-${tenantId.slice(0, 8)}`,
        code: 'DRY-L1-1003',
        phase: 'L1',
        shipType: 'IMPORT',
        status: 'PENDING',
        priority: 'URGENT',
        custName: 'Chalhoub Luxury Supply Chain',
        whId: `wh-dwc-${tenantId.slice(0, 8)}`,
        whName: 'Dubai South Aviation & Cold-Chain Hub',
        termId: `term-ja1-${tenantId.slice(0, 8)}`,
        termName: 'Jebel Ali Port - Terminal 1 (DP World)',
        cntId: `cnt-3-${tenantId.slice(0, 8)}`,
        cntNum: 'CMAU3019482',
        cntSize: '40HC',
        cntType: 'REEFER',
        doExp: new Date(now - 1 * dayMs).toISOString(),
        token: null,
        vId: null,
        vPlate: null,
        dId: null,
        dName: null,
        trId: null,
        trPlate: null,
        placement: null,
        detached: false,
        l2Act: false,
        rate: 2250,
        allow: 200,
        customs: true,
        muni: true,
        cpip: true,
        merc: true,
        boxcare: false,
        lat: 25.0112,
        lng: 55.0612,
      },
      {
        id: `job-4-${tenantId.slice(0, 8)}`,
        code: 'DRY-L1-1004',
        phase: 'L1',
        shipType: 'EXPORT',
        status: 'PENDING',
        priority: 'HIGH',
        custName: 'ADNOC Industrial Polymers',
        whId: `wh-kizad-${tenantId.slice(0, 8)}`,
        whName: 'KEZAD Integrated Polymer & Cold Depot',
        termId: `term-kp-${tenantId.slice(0, 8)}`,
        termName: 'Khalifa Port Container Terminal (AD Ports)',
        cntId: `cnt-4-${tenantId.slice(0, 8)}`,
        cntNum: 'HLXU9041128',
        cntSize: '20FT',
        cntType: 'DRY',
        doExp: new Date(now + 4 * dayMs).toISOString(),
        token: null,
        vId: null,
        vPlate: null,
        dId: null,
        dName: null,
        trId: null,
        trPlate: null,
        placement: null,
        detached: false,
        l2Act: false,
        rate: 1850,
        allow: 175,
        customs: true,
        muni: false,
        cpip: false,
        merc: false,
        boxcare: true,
        lat: 24.8055,
        lng: 54.6462,
      },
    ];

    for (const j of sampleJobs) {
      await db.$executeRawUnsafe(
        `INSERT INTO logistics_drayage_jobs (
          id, tenant_id, job_code, job_phase, shipment_type, status, priority,
          customer_name, warehouse_id, warehouse_name, terminal_id, terminal_name,
          container_id, container_number, container_size, container_type, do_expiry_date,
          token_number, assigned_vehicle_id, assigned_vehicle_plate,
          assigned_driver_id, assigned_driver_name, assigned_trailer_id, assigned_trailer_plate,
          placement_location, trailer_detached, l2_activated, rate_amount_aed, driver_allowance_aed,
          customs_inspection, municipality_inspection, cpip_inspection, merc_inspection, boxcare_inspection,
          current_lat, current_lng
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::timestamptz,
          $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36
        ) ON CONFLICT (id) DO NOTHING`,
        j.id, tenantId, j.code, j.phase, j.shipType, j.status, j.priority,
        j.custName, j.whId, j.whName, j.termId, j.termName,
        j.cntId, j.cntNum, j.cntSize, j.cntType, j.doExp,
        j.token, j.vId, j.vPlate, j.dId, j.dName, j.trId, j.trPlate,
        j.placement, j.detached, j.l2Act, j.rate, j.allow,
        j.customs, j.muni, j.cpip, j.merc, j.boxcare, j.lat, j.lng,
      );
    }

    // Seed driver allowances for the 2 assigned jobs
    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_allowances (
        id, tenant_id, job_id, job_code, driver_id, driver_name, vehicle_plate,
        container_number, trip_phase, route_summary, allowance_amount_aed, port_gate_fee_aed,
        overnight_halt_aed, total_amount_aed, status
      ) VALUES
      ($1,$2,$3,'DRY-L1-1001',$4,$5,$6,'MSCU8492014','L1','Jebel Ali T1 → JAFZA South Gate 5',160,35,0,195,'PENDING'),
      ($7,$2,$8,'DRY-L1-1002',$9,$10,$11,'MAEU5910283','L1','Jebel Ali T2 → NIP Mega DC',150,35,50,235,'APPROVED')
      ON CONFLICT (id) DO NOTHING`,
      `alw-1-${tenantId.slice(0, 8)}`, tenantId, `job-1-${tenantId.slice(0, 8)}`, d1Id ?? 'drv-1', d1Name, v1Plate,
      `alw-2-${tenantId.slice(0, 8)}`, `job-2-${tenantId.slice(0, 8)}`, d2Id ?? 'drv-2', d2Name, v2Plate,
    );
  }

  // Ensure Street-Turn and Dual-20FT Bogie candidate jobs exist for this tenant
  const pairingCountRows = await db.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
    `SELECT COUNT(*) AS cnt FROM logistics_drayage_jobs WHERE tenant_id = $1 AND job_code IN ('DRY-L2-1001', 'DRY-EXP-1001', 'DRY-L1-1005', 'DRY-L1-1006')`,
    tenantId,
  ).catch(() => [{ cnt: 0 }]);

  if (Number(pairingCountRows[0]?.cnt ?? 0) < 4) {
    const nowMs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // 1. Dual-20FT Bogie Pair
    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_jobs (
        id, tenant_id, job_code, job_phase, shipment_type, status, priority,
        customer_name, warehouse_id, warehouse_name, terminal_id, terminal_name,
        container_number, container_size, container_type, do_expiry_date,
        rate_amount_aed, driver_allowance_aed, cargo_weight_kg, shipping_line, notes
      ) VALUES
      ($1, $2, 'DRY-L1-1005', 'L1', 'IMPORT', 'PENDING', 'HIGH',
       'Dubai Refreshments (PepsiCo) Hub', $3, 'National Industries Park (NIP) Mega Automated DC',
       $4, 'Jebel Ali Port - Terminal 1 (DP World)',
       'MSCU2109483', '20FT', 'DRY', $5::timestamptz,
       1450, 150, 14500, 'MSC', '20FT Import Cargo - Eligible for Dual-20FT Bogie Bundling'),
      ($6, $2, 'DRY-L1-1006', 'L1', 'IMPORT', 'PENDING', 'HIGH',
       'Agility Logistics Regional Park', $3, 'National Industries Park (NIP) Mega Automated DC',
       $4, 'Jebel Ali Port - Terminal 1 (DP World)',
       'MSCU3918204', '20FT', 'DRY', $7::timestamptz,
       1450, 150, 16200, 'MSC', '20FT Import Cargo - Eligible for Dual-20FT Bogie Bundling')
      ON CONFLICT (id) DO NOTHING`,
      `job-5-${tenantId.slice(0, 8)}`,
      tenantId,
      `wh-nip-${tenantId.slice(0, 8)}`,
      `term-ja1-${tenantId.slice(0, 8)}`,
      new Date(nowMs + 2 * dayMs).toISOString(),
      `job-6-${tenantId.slice(0, 8)}`,
      new Date(nowMs + 3 * dayMs).toISOString(),
    ).catch(() => {});

    // 2. Freshly Activated L2 Empty + Pending Export Booking in JAFZA South (Street-Turn Triangulation)
    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_jobs (
        id, tenant_id, job_code, job_phase, shipment_type, status, priority,
        customer_name, warehouse_id, warehouse_name, terminal_id, terminal_name,
        container_number, container_size, container_type, do_expiry_date,
        rate_amount_aed, driver_allowance_aed, cargo_weight_kg, shipping_line, notes
      ) VALUES
      ($1, $2, 'DRY-L2-1001', 'L2', 'IMPORT', 'PENDING', 'HIGH',
       'Al-Futtaim Logistics LLC', $3, 'JAFZA South Bonded Fulfillment Hub (Gate 5)',
       $4, 'Jebel Ali Port - Terminal 1 (DP World)',
       'MSCU9248102', '40HC', 'DRY', $5::timestamptz,
       950, 120, 3800, 'MSC', 'Freshly activated L2 empty container awaiting depot return (Street-Turn candidate)'),
      ($6, $2, 'DRY-EXP-1001', 'L1', 'EXPORT', 'PENDING', 'HIGH',
       'Gulf Petrochem Exporters FZE', $3, 'JAFZA South Industrial Sector 4',
       $4, 'Jebel Ali Port - Terminal 1 (DP World)',
       'MSCU-TBD', '40HC', 'DRY', $7::timestamptz,
       1950, 180, 21500, 'MSC', 'Pending export booking: requires 40HC MSC empty container for loading (Street-Turn candidate)')
      ON CONFLICT (id) DO NOTHING`,
      `job-l2-1001-${tenantId.slice(0, 8)}`,
      tenantId,
      `wh-jafza-${tenantId.slice(0, 8)}`,
      `term-ja1-${tenantId.slice(0, 8)}`,
      new Date(nowMs + 2 * dayMs).toISOString(),
      `job-exp-1001-${tenantId.slice(0, 8)}`,
      new Date(nowMs + 5 * dayMs).toISOString(),
    ).catch(() => {});
  }

  // Seed default geofences if none exist
  const gfCountRows = await db.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
    `SELECT COUNT(*) AS cnt FROM logistics_drayage_geofences WHERE tenant_id = $1`,
    tenantId,
  );
  if (Number(gfCountRows[0]?.cnt ?? 0) === 0) {
    const defaultGeofences = [
      {
        id: `gf-ja1-${tenantId.slice(0, 8)}`,
        termId: `term-ja1-${tenantId.slice(0, 8)}`,
        termName: 'Jebel Ali Port - Terminal 1 (DP World)',
        name: 'Jebel Ali T1 Gate 3 & Berth Geofence',
        type: 'CIRCLE',
        lat: 25.0112,
        lng: 55.0612,
        radius: 1800,
      },
      {
        id: `gf-ja2-${tenantId.slice(0, 8)}`,
        termId: `term-ja2-${tenantId.slice(0, 8)}`,
        termName: 'Jebel Ali Port - Terminal 2 (Mega Vessel Berth)',
        name: 'Jebel Ali T2 Automated OCR Gate Zone',
        type: 'CIRCLE',
        lat: 25.0245,
        lng: 55.0488,
        radius: 2000,
      },
      {
        id: `gf-kp-${tenantId.slice(0, 8)}`,
        termId: `term-kp-${tenantId.slice(0, 8)}`,
        termName: 'Khalifa Port Container Terminal (AD Ports)',
        name: 'Khalifa Port Semi-Automated Yard Perimeter',
        type: 'CIRCLE',
        lat: 24.8055,
        lng: 54.6462,
        radius: 2200,
      },
      {
        id: `gf-jafza-${tenantId.slice(0, 8)}`,
        termId: `term-ja1-${tenantId.slice(0, 8)}`,
        termName: 'JAFZA South Bonded Fulfillment Hub (Gate 5)',
        name: 'JAFZA South Bonded Ramps #1–#12 Geofence',
        type: 'POLYGON',
        lat: 24.9642,
        lng: 55.0915,
        radius: 850,
      },
    ];
    for (const g of defaultGeofences) {
      await db.$executeRawUnsafe(
        `INSERT INTO logistics_drayage_geofences (
          id, tenant_id, terminal_id, terminal_name, name, type, center_lat, center_lng, radius_meters, coordinates_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO NOTHING`,
        g.id, tenantId, g.termId, g.termName, g.name, g.type, g.lat, g.lng, g.radius,
        JSON.stringify([{ lat: g.lat, lng: g.lng }]),
      );
    }
  }

  // Seed default status logs & dispatch chat messages if none exist
  const logCountRows = await db.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
    `SELECT COUNT(*) AS cnt FROM logistics_drayage_status_logs WHERE tenant_id = $1`,
    tenantId,
  );
  if (Number(logCountRows[0]?.cnt ?? 0) === 0) {
    const j1Id = `job-1-${tenantId.slice(0, 8)}`;
    const j2Id = `job-2-${tenantId.slice(0, 8)}`;
    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
       VALUES
       ($1,$2,$3,'DRY-L1-1001','ASSIGNED','Assigned tractor & skeletal chassis with token DPW-TKN-8841','Dispatch Desk'),
       ($4,$2,$3,'DRY-L1-1001','AT_PORT','Tractor gated in at Jebel Ali Terminal 1 OCR Gate 3','Port OCR Gate'),
       ($5,$2,$3,'DRY-L1-1001','LOADED','Container MSCU8492014 loaded onto chassis DXB-TR-9901','RTG Crane #14'),
       ($6,$2,$3,'DRY-L1-1001','IN_TRANSIT','Departed Jebel Ali T1 en route to JAFZA South Bonded Hub','Driver Mobile App'),
       ($7,$2,$8,'DRY-L1-1002','PLACED_AT_RAMP','Placed container MAEU5910283 at NIP Mega DC Ramp #4','Driver Mobile App'),
       ($9,$2,$8,'DRY-L1-1002','CONTAINER_DETACHED','Tractor uncoupled; trailer DXB-TR-9902 detached at Ramp #4','Driver Mobile App')
       ON CONFLICT (id) DO NOTHING`,
      `log-1-${tenantId.slice(0, 8)}`, tenantId, j1Id,
      `log-2-${tenantId.slice(0, 8)}`, `log-3-${tenantId.slice(0, 8)}`, `log-4-${tenantId.slice(0, 8)}`,
      `log-5-${tenantId.slice(0, 8)}`, j2Id, `log-6-${tenantId.slice(0, 8)}`,
    );

    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_messages (id, tenant_id, job_id, job_code, sender_role, sender_name, message, is_urgent)
       VALUES
       ($1,$2,$3,'DRY-L1-1001','DISPATCHER','Port Operations Desk','Token DPW-TKN-8841 verified. Proceed directly to JAFZA South Gate 5 after customs seal check.',false),
       ($4,$2,$3,'DRY-L1-1001','DRIVER','Rashid Al-Marri','Cleared Gate 3 OCR. Currently on E11 corridor, ETA 18 mins to JAFZA South.',false),
       ($5,$2,$6,'DRY-L1-1002','DRIVER','Imran Khan','Container MAEU5910283 positioned at Ramp #4 and chassis uncoupled. Ready for next L1/L2 dispatch.',true)
       ON CONFLICT (id) DO NOTHING`,
      `msg-1-${tenantId.slice(0, 8)}`, tenantId, j1Id,
      `msg-2-${tenantId.slice(0, 8)}`, `msg-3-${tenantId.slice(0, 8)}`, j2Id,
    );
  }

  seededTenants.add(tenantId);
}

export async function getDrayageWorkspaceData(db: DrayageDbClient, tenantId: string) {
  await seedTenantDrayageDefaultsIfNeeded(db, tenantId);

  // Proactively check and auto-activate any Leg 1 jobs whose Offload ETC timer has elapsed
  await checkAndAutoActivateExpiredEtcJobs(db, tenantId).catch((err) => {
    console.error('[getDrayageWorkspaceData] checkAndAutoActivateExpiredEtcJobs error:', err);
  });

  // Parallelize all 13 workspace SQL queries into a single roundtrip to maximize throughput
  const [
    terminalRows,
    warehouseRows,
    clientRows,
    trailerRows,
    jobRows,
    containerRows,
    rawVehicles,
    rawDrivers,
    rawCustomers,
    allowanceRows,
    geofenceRows,
    statusLogRows,
    messageRows,
    ackRows,
  ] = await Promise.all([
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_terminals WHERE tenant_id = $1 ORDER BY name ASC`,
      tenantId,
    ),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_warehouses WHERE tenant_id = $1 ORDER BY name ASC`,
      tenantId,
    ),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_clients WHERE tenant_id = $1 ORDER BY name ASC`,
      tenantId,
    ).catch(() => []),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_trailers WHERE tenant_id = $1 ORDER BY plate_number ASC`,
      tenantId,
    ),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_jobs WHERE tenant_id = $1 ORDER BY created_at DESC`,
      tenantId,
    ),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_containers WHERE tenant_id = $1 ORDER BY updated_at DESC`,
      tenantId,
    ),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id,
              COALESCE(plate_number, license_plate, registration_no, 'DXB-TRACTOR') AS plate_number,
              COALESCE(make, 'Mercedes-Benz') AS make,
              COALESCE(model, 'Actros 2645 Prime Mover') AS model,
              year,
              type,
              COALESCE(status, 'AVAILABLE') AS status,
              COALESCE(vehicle_usage, 'LOGISTICS') AS vehicle_usage,
              vehicle_group,
              fuel_type,
              COALESCE(fuel_level_pct, fuel_level::int, 85) AS fuel_level_pct,
              COALESCE(current_lat, 25.0112) AS current_lat,
              COALESCE(current_lng, 55.0612) AS current_lng,
              COALESCE(current_mileage, 45000) AS current_mileage,
              COALESCE(next_service_km, 55000) AS next_service_km,
              registration_expiry,
              insurance_expiry,
              COALESCE(updated_at, NOW() - INTERVAL '3.5 hours') AS updated_at
         FROM vehicles
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND (
            vehicle_usage = 'LOGISTICS'
            OR type IN ('PRIME_MOVER', 'HEAVY_TRUCK', 'TRACTOR', 'TRUCK')
            OR vehicle_group IN ('TRUCK', 'HEAVY_VEHICLE', 'PRIME_MOVER')
          )
        ORDER BY CASE WHEN status = 'AVAILABLE' THEN 0 ELSE 1 END, plate_number ASC
        LIMIT 60`,
      tenantId,
    ).catch(() => []),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id,
              employee_id,
              first_name,
              last_name,
              name,
              contact_number AS phone,
              license_number,
              license_expiry,
              COALESCE(status, 'ACTIVE') AS status,
              COALESCE(driver_type, 'LOGISTICS') AS assignment_type,
              assigned_vehicle_id
         FROM drivers
        WHERE tenant_id = $1
          AND deleted_at IS NULL
        ORDER BY CASE WHEN driver_type = 'LOGISTICS' THEN 0 ELSE 1 END, first_name ASC NULLS LAST
        LIMIT 60`,
      tenantId,
    ).catch(() => []),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, customer_code, name_en, name_ar, customer_type, email, mobile_number, city, trade_license
         FROM customers
        WHERE tenant_id = $1
          AND deleted_at IS NULL
        ORDER BY name_en ASC
        LIMIT 60`,
      tenantId,
    ).catch(() => []),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_allowances WHERE tenant_id = $1 ORDER BY created_at DESC`,
      tenantId,
    ),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_geofences WHERE tenant_id = $1 ORDER BY created_at DESC`,
      tenantId,
    ),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_status_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`,
      tenantId,
    ),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_messages WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 200`,
      tenantId,
    ),
    db.$queryRawUnsafe<Array<{ alert_key: string; acknowledged: boolean }>>(
      `SELECT alert_key, acknowledged FROM logistics_drayage_alerts WHERE tenant_id = $1`,
      tenantId,
    ).catch(() => []),
  ]);

  // 1. Terminals
  const terminals: DrayageTerminal[] = terminalRows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    name: String(r.name),
    code: String(r.code),
    portName: String(r.port_name),
    emirate: String(r.emirate ?? 'Dubai'),
    lat: Number(r.lat ?? 25.0112),
    lng: Number(r.lng ?? 55.0612),
    geofenceRadiusMeters: Number(r.geofence_radius_meters ?? 1500),
    freeDaysDry: Number(r.free_days_dry ?? 5),
    freeDaysReefer: Number(r.free_days_reefer ?? 3),
    operatingHours: String(r.operating_hours ?? '24/7 Gate Operations'),
    status: String(r.status ?? 'ACTIVE'),
  }));

  // 2. Warehouses
  const warehouses: DrayageWarehouse[] = warehouseRows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    customerId: r.customer_id ? String(r.customer_id) : null,
    customerName: String(r.customer_name),
    name: String(r.name),
    code: r.code ? String(r.code) : null,
    zone: String(r.zone),
    address: String(r.address),
    lat: Number(r.lat ?? 24.9642),
    lng: Number(r.lng ?? 55.0915),
    rampsCount: Number(r.ramps_count ?? 6),
    contactPerson: r.contact_person ? String(r.contact_person) : null,
    contactPhone: r.contact_phone ? String(r.contact_phone) : null,
    geofenceConfigured: Boolean(r.geofence_configured),
    geofenceType: (r.geofence_type === 'POLYGON' ? 'POLYGON' : 'CIRCLE') as 'CIRCLE' | 'POLYGON',
    geofenceRadiusMeters: Number(r.geofence_radius_meters ?? 800),
    geofenceCoordinatesJson: r.geofence_coordinates_json ? String(r.geofence_coordinates_json) : '[]',
    tripAmountAed: r.trip_amount_aed != null ? Number(r.trip_amount_aed) : null,
    driverAllowanceAed: r.driver_allowance_aed != null ? Number(r.driver_allowance_aed) : null,
  }));

  // 2b. Clients (Client Master)
  const clients: DrayageClient[] = (clientRows || []).map((r: Record<string, unknown>) => {
    const clientId = String(r.id);
    const clientName = String(r.name);
    const mappedWhs = warehouses.filter(
      (w) => w.customerId === clientId || (w.customerName && w.customerName.toLowerCase() === clientName.toLowerCase())
    );
    return {
      id: clientId,
      tenantId: String(r.tenant_id),
      name: clientName,
      code: String(r.code),
      contactPerson: r.contact_person ? String(r.contact_person) : null,
      contactNo: r.contact_no ? String(r.contact_no) : null,
      streetAddress: r.street_address ? String(r.street_address) : null,
      city: String(r.city ?? 'Dubai'),
      trn: r.trn ? String(r.trn) : null,
      tradeLicense: r.trade_license ? String(r.trade_license) : null,
      defaultTripAmountAed: Number(r.default_trip_amount_aed ?? 1550),
      defaultDriverAllowanceAed: Number(r.default_driver_allowance_aed ?? 150),
      notes: r.notes ? String(r.notes) : null,
      warehouseCount: mappedWhs.length,
      warehouses: mappedWhs,
      createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : new Date().toISOString(),
      updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : new Date().toISOString(),
    };
  });

  // 3. Trailers
  const trailers: DrayageTrailer[] = trailerRows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    plateNumber: String(r.plate_number),
    trailerType: String(r.trailer_type),
    capacityTons: Number(r.capacity_tons ?? 45),
    masterStatus: String(r.master_status ?? 'AVAILABLE') as DrayageTrailer['masterStatus'],
    operationalStatus: String(r.operational_status ?? 'EMPTY') as DrayageTrailer['operationalStatus'],
    linkedContainerNumber: r.linked_container_number ? String(r.linked_container_number) : null,
    currentLocation: r.current_location ? String(r.current_location) : null,
    lat: r.lat != null ? Number(r.lat) : null,
    lng: r.lng != null ? Number(r.lng) : null,
  }));

  // 4. Jobs
  const jobs: DrayageJob[] = jobRows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    jobCode: String(r.job_code),
    jobPhase: (String(r.job_phase) === 'L2' ? 'L2' : 'L1'),
    parentJobId: r.parent_job_id ? String(r.parent_job_id) : null,
    shipmentType: (String(r.shipment_type) === 'EXPORT' ? 'EXPORT' : 'IMPORT'),
    status: String(r.status),
    priority: (['STANDARD', 'HIGH', 'URGENT'].includes(String(r.priority)) ? String(r.priority) : 'STANDARD') as DrayageJob['priority'],
    customerId: r.customer_id ? String(r.customer_id) : null,
    customerName: String(r.customer_name),
    warehouseId: r.warehouse_id ? String(r.warehouse_id) : null,
    warehouseName: String(r.warehouse_name),
    terminalId: r.terminal_id ? String(r.terminal_id) : null,
    terminalName: String(r.terminal_name),
    containerId: r.container_id ? String(r.container_id) : null,
    containerNumber: String(r.container_number),
    containerSize: String(r.container_size ?? '40HC'),
    containerType: String(r.container_type ?? 'DRY'),
    doExpiryDate: r.do_expiry_date ? new Date(String(r.do_expiry_date)).toISOString() : null,
    tokenNumber: r.token_number ? String(r.token_number) : null,
    assignedVehicleId: r.assigned_vehicle_id ? String(r.assigned_vehicle_id) : null,
    assignedVehiclePlate: r.assigned_vehicle_plate ? String(r.assigned_vehicle_plate) : null,
    assignedDriverId: r.assigned_driver_id ? String(r.assigned_driver_id) : null,
    assignedDriverName: r.assigned_driver_name ? String(r.assigned_driver_name) : null,
    assignedTrailerId: r.assigned_trailer_id ? String(r.assigned_trailer_id) : null,
    assignedTrailerPlate: r.assigned_trailer_plate ? String(r.assigned_trailer_plate) : null,
    placementLocation: r.placement_location ? (String(r.placement_location) as 'RAMP' | 'YARD') : null,
    trailerDetached: Boolean(r.trailer_detached),
    l2Activated: Boolean(r.l2_activated),
    etcTime: r.etc_time ? new Date(String(r.etc_time)).toISOString() : null,
    etcAlertStatus: r.etc_alert_status ? String(r.etc_alert_status) : 'NEW',
    rateAmountAed: Number(r.rate_amount_aed ?? 1450),
    driverAllowanceAed: Number(r.driver_allowance_aed ?? 150),
    customsInspection: Boolean(r.customs_inspection),
    municipalityInspection: Boolean(r.municipality_inspection),
    cpipInspection: Boolean(r.cpip_inspection),
    mercInspection: Boolean(r.merc_inspection),
    boxcareInspection: Boolean(r.boxcare_inspection),
    currentLat: r.current_lat != null ? Number(r.current_lat) : null,
    currentLng: r.current_lng != null ? Number(r.current_lng) : null,
    notes: r.notes ? String(r.notes) : null,
    createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : new Date().toISOString(),
    updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : new Date().toISOString(),
    cargoWeightKg: r.cargo_weight_kg != null ? Number(r.cargo_weight_kg) : (String(r.container_size) === '20FT' ? 14500 : 22000),
    shippingLine: r.shipping_line ? String(r.shipping_line) : detectShippingLine(String(r.container_number)),
    bogieJobId: r.bogie_job_id ? String(r.bogie_job_id) : null,
    streetTurnJobId: r.street_turn_job_id ? String(r.street_turn_job_id) : null,
  }));

  // 5. Containers + Demurrage Calculation
  const terminalMap = new Map(terminals.map(t => [t.id, t]));
  const containers: DrayageContainer[] = containerRows.map((r: Record<string, unknown>) => {
    const term = r.terminal_id ? terminalMap.get(String(r.terminal_id)) : undefined;
    const dischargeIso = r.discharge_date ? new Date(String(r.discharge_date)).toISOString() : new Date().toISOString();
    const emptyReturnIso = r.empty_return_date ? new Date(String(r.empty_return_date)).toISOString() : null;
    const cType = String(r.container_type ?? 'DRY');
    const cStatus = String(r.status ?? 'AT_PORT_DISCHARGED');
    const demurrage = calculateDemurrageClock({
      containerType: cType,
      dischargeDate: dischargeIso,
      emptyReturnDate: emptyReturnIso,
      status: cStatus,
      freeDaysDry: term?.freeDaysDry ?? 5,
      freeDaysReefer: term?.freeDaysReefer ?? 3,
    });
    return {
      id: String(r.id),
      tenantId: String(r.tenant_id),
      containerNumber: String(r.container_number),
      size: String(r.size ?? '40HC'),
      containerType: cType,
      shipmentType: String(r.shipment_type ?? 'IMPORT'),
      status: cStatus,
      customerId: r.customer_id ? String(r.customer_id) : null,
      customerName: String(r.customer_name),
      terminalId: r.terminal_id ? String(r.terminal_id) : null,
      terminalName: String(r.terminal_name),
      warehouseId: r.warehouse_id ? String(r.warehouse_id) : null,
      warehouseName: String(r.warehouse_name),
      doExpiryDate: r.do_expiry_date ? new Date(String(r.do_expiry_date)).toISOString() : null,
      dischargeDate: dischargeIso,
      emptyReturnDate: emptyReturnIso,
      sealNumber: r.seal_number ? String(r.seal_number) : null,
      weightKg: Number(r.weight_kg ?? 22000),
      customsInspection: Boolean(r.customs_inspection),
      municipalityInspection: Boolean(r.municipality_inspection),
      cpipInspection: Boolean(r.cpip_inspection),
      mercInspection: Boolean(r.merc_inspection),
      boxcareInspection: Boolean(r.boxcare_inspection),
      linkedTrailerPlate: r.linked_trailer_plate ? String(r.linked_trailer_plate) : null,
      demurrage,
    };
  });

  // 6. Mapped Fleet360 Vehicles (from `vehicles` table, prioritizing LOGISTICS usage)
  const activeJobByVehicle = new Map<string, DrayageJob>();
  const tripsCountByVehicle = new Map<string, number>();
  const activeJobByDriver = new Map<string, DrayageJob>();
  const tripsCountByDriver = new Map<string, number>();

  for (const j of jobs) {
    if (j.assignedVehicleId) {
      tripsCountByVehicle.set(j.assignedVehicleId, (tripsCountByVehicle.get(j.assignedVehicleId) || 0) + 1);
      if (j.status !== 'COMPLETED') {
        activeJobByVehicle.set(j.assignedVehicleId, j);
      }
    }
    if (j.assignedDriverId) {
      tripsCountByDriver.set(j.assignedDriverId, (tripsCountByDriver.get(j.assignedDriverId) || 0) + 1);
      if (j.status !== 'COMPLETED') {
        activeJobByDriver.set(j.assignedDriverId, j);
      }
    }
  }

  const vehicles: MappedFleetVehicle[] = rawVehicles.map((v: Record<string, unknown>, idx: number) => {
    const id = String(v.id);
    const activeJob = activeJobByVehicle.get(id);
    return {
      id,
      plateNumber: String(v.plate_number),
      make: String(v.make),
      model: String(v.model),
      year: v.year != null ? Number(v.year) : 2024,
      type: v.type ? String(v.type) : 'PRIME_MOVER',
      status: activeJob ? 'ON_DRAYAGE_TRIP' : String(v.status),
      vehicleUsage: String(v.vehicle_usage),
      fuelType: v.fuel_type ? String(v.fuel_type) : 'DIESEL',
      fuelLevelPct: v.fuel_level_pct != null ? Number(v.fuel_level_pct) : 85,
      currentMileage: v.current_mileage != null ? Number(v.current_mileage) : 48200 + idx * 3100,
      nextServiceKm: v.next_service_km != null ? Number(v.next_service_km) : 55000,
      registrationExpiry: v.registration_expiry instanceof Date ? v.registration_expiry.toISOString() : null,
      insuranceExpiry: v.insurance_expiry instanceof Date ? v.insurance_expiry.toISOString() : null,
      assignedDriverId: activeJob?.assignedDriverId ?? null,
      assignedDriverName: activeJob?.assignedDriverName ?? null,
      activeJobCode: activeJob?.jobCode ?? null,
      lat: activeJob?.currentLat ?? (v.current_lat != null ? Number(v.current_lat) : (25.0080 + (idx % 5) * 0.008)),
      lng: activeJob?.currentLng ?? (v.current_lng != null ? Number(v.current_lng) : (55.0640 + (idx % 5) * 0.009)),
      updatedAt: v.updated_at instanceof Date ? v.updated_at.toISOString() : (typeof v.updated_at === 'string' ? v.updated_at : null),
      assignedTripsCount: tripsCountByVehicle.get(id) || 0,
    };
  });

  // 7. Mapped Fleet360 Drivers (from `drivers` table)
  const drivers: MappedFleetDriver[] = rawDrivers.map((d: Record<string, unknown>) => {
    const id = String(d.id);
    const first = String(d.first_name ?? '').trim();
    const last = String(d.last_name ?? '').trim();
    const fullName = `${first} ${last}`.trim() || String(d.name ?? 'Logistics Driver');
    const licExpiry = d.license_expiry instanceof Date ? d.license_expiry.toISOString() : null;
    const isExpired = licExpiry ? new Date(licExpiry).getTime() < Date.now() : false;
    const activeJob = activeJobByDriver.get(id);
    return {
      id,
      employeeId: d.employee_id ? String(d.employee_id) : null,
      fullName,
      firstName: first || fullName,
      lastName: last,
      phone: d.phone ? String(d.phone) : (d.contact_number ? String(d.contact_number) : '+971 50 000 0000'),
      licenseNumber: d.license_number ? String(d.license_number) : 'UAE-HVY-88210',
      licenseExpiry: licExpiry,
      status: activeJob ? 'ON_TRIP' : String(d.status ?? 'ACTIVE'),
      assignmentType: d.assignment_type ? String(d.assignment_type) : 'LOGISTICS',
      assignedVehicleId: d.assigned_vehicle_id ? String(d.assigned_vehicle_id) : (activeJob?.assignedVehicleId ?? null),
      activeJobCode: activeJob?.jobCode ?? null,
      complianceOk: !isExpired && String(d.status ?? 'ACTIVE') === 'ACTIVE',
      completedTripsToday: tripsCountByDriver.get(id) || 0,
    };
  });

  // 8. Mapped Fleet360 Customers (from `customers` table)
  const customers: MappedFleetCustomer[] = rawCustomers.map((c: Record<string, unknown>) => ({
    id: String(c.id),
    customerCode: c.customer_code ? String(c.customer_code) : null,
    name: String(c.name_en ?? 'Enterprise Client'),
    nameAr: c.name_ar ? String(c.name_ar) : null,
    customerType: String(c.customer_type ?? 'CORPORATE'),
    email: c.email ? String(c.email) : null,
    phone: c.mobile_number ? String(c.mobile_number) : null,
    city: c.city ? String(c.city) : 'Dubai',
    tradeLicense: c.trade_license ? String(c.trade_license) : null,
  }));

  // 9. Driver Allowances
  const allowances: DrayageDriverAllowance[] = allowanceRows.map((a: Record<string, unknown>) => ({
    id: String(a.id),
    tenantId: String(a.tenant_id),
    jobId: String(a.job_id),
    jobCode: String(a.job_code),
    driverId: String(a.driver_id),
    driverName: String(a.driver_name),
    vehiclePlate: a.vehicle_plate ? String(a.vehicle_plate) : null,
    containerNumber: String(a.container_number),
    tripPhase: String(a.trip_phase) === 'L2' ? 'L2' : 'L1',
    routeSummary: String(a.route_summary),
    allowanceAmountAed: Number(a.allowance_amount_aed ?? 150),
    portGateFeeAed: Number(a.port_gate_fee_aed ?? 35),
    overnightHaltAed: Number(a.overnight_halt_aed ?? 0),
    totalAmountAed: Number(a.total_amount_aed ?? 185),
    status: (['PENDING', 'APPROVED', 'PAID'].includes(String(a.status)) ? String(a.status) : 'PENDING') as DrayageDriverAllowance['status'],
    approvedBy: a.approved_by ? String(a.approved_by) : null,
    approvedAt: a.approved_at ? new Date(String(a.approved_at)).toISOString() : null,
    createdAt: a.created_at ? new Date(String(a.created_at)).toISOString() : new Date().toISOString(),
  }));

  // 10. Geofences, Status Logs, Messages & Intelligent Alerts
  const geofences: DrayageGeofence[] = geofenceRows.map((g: Record<string, unknown>) => ({
    id: String(g.id),
    tenantId: String(g.tenant_id),
    terminalId: g.terminal_id ? String(g.terminal_id) : null,
    terminalName: String(g.terminal_name),
    name: String(g.name),
    type: String(g.type) === 'POLYGON' ? 'POLYGON' : 'CIRCLE',
    centerLat: Number(g.center_lat ?? 25.0112),
    centerLng: Number(g.center_lng ?? 55.0612),
    radiusMeters: Number(g.radius_meters ?? 1500),
    coordinatesJson: String(g.coordinates_json ?? '[]'),
    createdAt: g.created_at ? new Date(String(g.created_at)).toISOString() : new Date().toISOString(),
  }));

  // Ensure every configured terminal has an associated geofence (auto-reconciles terminals like DPW-JA-T2)
  for (const term of terminals) {
    const hasGf = geofences.some(
      (g) => g.terminalId === term.id || g.terminalName === term.name || (term.code && g.name.includes(term.code))
    );
    if (!hasGf) {
      const gfId = `gf-${term.id}`;
      const autoGf: DrayageGeofence = {
        id: gfId,
        tenantId,
        terminalId: term.id,
        terminalName: term.name,
        name: `${term.name} Perimeter Geofence`,
        type: 'CIRCLE',
        centerLat: term.lat,
        centerLng: term.lng,
        radiusMeters: term.geofenceRadiusMeters || 1500,
        coordinatesJson: JSON.stringify([{ lat: term.lat, lng: term.lng }]),
        createdAt: new Date().toISOString(),
      };
      geofences.push(autoGf);

      // Persist to database so it stays in sync
      db.$executeRawUnsafe(
        `INSERT INTO logistics_drayage_geofences (
          id, tenant_id, terminal_id, terminal_name, name, type, center_lat, center_lng, radius_meters, coordinates_json
        ) VALUES ($1,$2,$3,$4,$5,'CIRCLE',$6,$7,$8,$9)
        ON CONFLICT (id) DO UPDATE
           SET terminal_name = EXCLUDED.terminal_name,
               name = EXCLUDED.name,
               center_lat = EXCLUDED.center_lat,
               center_lng = EXCLUDED.center_lng,
               radius_meters = EXCLUDED.radius_meters`,
        gfId,
        tenantId,
        term.id,
        term.name,
        autoGf.name,
        term.lat,
        term.lng,
        autoGf.radiusMeters,
        autoGf.coordinatesJson,
      ).catch(() => {});
    }
  }

  const statusLogs: DrayageStatusLog[] = statusLogRows.map((l: Record<string, unknown>) => ({
    id: String(l.id),
    tenantId: String(l.tenant_id),
    jobId: String(l.job_id),
    jobCode: String(l.job_code),
    status: String(l.status),
    notes: String(l.notes ?? ''),
    actor: String(l.actor ?? 'Dispatch Console'),
    timestamp: l.created_at ? new Date(String(l.created_at)).toISOString() : new Date().toISOString(),
  }));

  const messages: DrayageDispatchMessage[] = messageRows.map((m: Record<string, unknown>) => ({
    id: String(m.id),
    tenantId: String(m.tenant_id),
    jobId: String(m.job_id),
    jobCode: String(m.job_code),
    senderRole: String(m.sender_role) === 'DRIVER' ? 'DRIVER' : 'DISPATCHER',
    senderName: String(m.sender_name),
    message: String(m.message),
    isUrgent: Boolean(m.is_urgent),
    createdAt: m.created_at ? new Date(String(m.created_at)).toISOString() : new Date().toISOString(),
  }));

  const ackSet = new Set(ackRows.filter((r: Record<string, unknown>) => r.acknowledged).map((r: Record<string, unknown>) => String(r.alert_key)));

  const alerts: DrayageAlertItem[] = [];
  const jobByContainerId = new Map(jobs.filter(j => j.containerId).map(j => [j.containerId as string, j]));

  for (const c of containers) {
    const linkedJob = jobByContainerId.get(c.id);
    if (c.demurrage.status === 'CRITICAL_OVERDUE') {
      const key = `dem-crit-${c.id}`;
      alerts.push({
        id: key,
        tenantId,
        type: 'DEMURRAGE_CRITICAL',
        severity: 'URGENT',
        title: `Ocean Demurrage Overdue (${c.demurrage.overdueDays}d) — ${c.containerNumber}`,
        message: `${c.containerType} container at ${c.terminalName} has accrued AED ${c.demurrage.accruedPenaltyAed.toLocaleString()} (${c.demurrage.tierLabel} @ AED ${c.demurrage.dailyRateAed}/day). Immediate gate-out or empty return required.`,
        terminalName: c.terminalName,
        containerId: c.id,
        containerNumber: c.containerNumber,
        jobId: linkedJob?.id ?? null,
        jobCode: linkedJob?.jobCode ?? null,
        driverName: linkedJob?.assignedDriverName ?? null,
        driverPhone: '+971 50 482 9910',
        acknowledged: ackSet.has(key),
        createdAt: c.dischargeDate,
      });
    } else if (c.demurrage.status === 'WARNING') {
      const key = `dem-warn-${c.id}`;
      alerts.push({
        id: key,
        tenantId,
        type: 'DEMURRAGE_WARNING',
        severity: 'WARNING',
        title: `Port Free-Days Expiring (<24h left) — ${c.containerNumber}`,
        message: `${c.containerNumber} (${c.size} ${c.containerType}) has ${c.demurrage.freeDaysRemaining} free day(s) remaining at ${c.terminalName} before Tier 1 demurrage begins.`,
        terminalName: c.terminalName,
        containerId: c.id,
        containerNumber: c.containerNumber,
        jobId: linkedJob?.id ?? null,
        jobCode: linkedJob?.jobCode ?? null,
        driverName: linkedJob?.assignedDriverName ?? null,
        driverPhone: '+971 50 482 9910',
        acknowledged: ackSet.has(key),
        createdAt: c.dischargeDate,
      });
    }

    if (c.doExpiryDate && c.status !== 'COMPLETED' && c.status !== 'EMPTY_DEPOSITED') {
      const diffHours = (new Date(c.doExpiryDate).getTime() - Date.now()) / (1000 * 60 * 60);
      if (diffHours <= 48) {
        const key = `do-exp-${c.id}`;
        const isPast = diffHours < 0;
        alerts.push({
          id: key,
          tenantId,
          type: 'DO_EXPIRY',
          severity: isPast ? 'URGENT' : 'CRITICAL',
          title: isPast
            ? `Delivery Order (DO) Expired — ${c.containerNumber}`
            : `Delivery Order Expiring in ${Math.max(1, Math.round(diffHours))}h — ${c.containerNumber}`,
          message: `Shipping line DO for ${c.containerNumber} (${c.customerName}) at ${c.terminalName} ${isPast ? 'has expired' : 'expires soon'}. Extend DO validity or expedite port gate-in.`,
          terminalName: c.terminalName,
          containerId: c.id,
          containerNumber: c.containerNumber,
          jobId: linkedJob?.id ?? null,
          jobCode: linkedJob?.jobCode ?? null,
          driverName: linkedJob?.assignedDriverName ?? null,
          driverPhone: '+971 52 819 3320',
          acknowledged: ackSet.has(key),
          createdAt: c.doExpiryDate,
        });
      }
    }
  }

  for (const j of jobs) {
    if (j.jobPhase === 'L1' && (j.trailerDetached || j.status === 'CONTAINER_DETACHED' || j.status === 'PLACED_AT_RAMP') && !j.l2Activated) {
      const key = `det-l2-${j.id}`;
      const hasEtc = Boolean(j.etcTime);
      const isExpired = hasEtc && new Date(j.etcTime as string).getTime() <= Date.now();
      alerts.push({
        id: key,
        tenantId,
        type: 'DETACHED_TRAILER',
        severity: isExpired ? 'URGENT' : 'CRITICAL',
        title: isExpired
          ? `Offload ETC Expired: Ready for L2 Empty Return — ${j.containerNumber}`
          : hasEtc
          ? `Offload In Progress (ETC: ${new Date(j.etcTime as string).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })}) — ${j.containerNumber}`
          : `Detached Chassis Awaiting L2 Empty Return — ${j.containerNumber}`,
        message: hasEtc
          ? `Container ${j.containerNumber} placed at ${j.warehouseName} (${j.placementLocation ?? 'RAMP'}). Offloading completion estimated at ${new Date(j.etcTime as string).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })}. Background worker will trigger Leg 2.`
          : `Chassis ${j.assignedTrailerPlate ?? 'Skeletal'} is detached at ${j.warehouseName} (${j.placementLocation ?? 'RAMP'}). Activate L2 Empty Return once destuffing finishes.`,
        terminalName: j.terminalName,
        containerId: j.containerId,
        containerNumber: j.containerNumber,
        jobId: j.id,
        jobCode: j.jobCode,
        driverName: j.assignedDriverName,
        driverPhone: '+971 55 301 7741',
        acknowledged: ackSet.has(key),
        createdAt: j.updatedAt,
      });
    }
  }

  // 11. Summary Metrics
  const overdueContainers = containers.filter(c => c.demurrage.status === 'CRITICAL_OVERDUE');
  const warningContainers = containers.filter(c => c.demurrage.status === 'WARNING');
  const totalDemurrageExposureAed = containers.reduce((sum, c) => sum + c.demurrage.accruedPenaltyAed, 0);
  const totalRevenueAed = jobs.reduce((sum, j) => sum + j.rateAmountAed, 0);
  const activeJobsCount = jobs.filter(j => j.status !== 'COMPLETED' && j.status !== 'PENDING').length;
  const pendingDispatchCount = jobs.filter(j => j.status === 'PENDING').length;
  const detachedWaitingL2Count = jobs.filter(j => j.jobPhase === 'L1' && (j.trailerDetached || j.status === 'CONTAINER_DETACHED' || j.status === 'PLACED_AT_RAMP' || j.status === 'PLACED_AT_YARD') && !j.l2Activated).length;

  return {
    summary: {
      totalJobs: jobs.length,
      activeJobsCount,
      pendingDispatchCount,
      detachedWaitingL2Count,
      totalContainers: containers.length,
      overdueContainersCount: overdueContainers.length,
      warningContainersCount: warningContainers.length,
      safeContainersCount: containers.filter(c => c.demurrage.status === 'SAFE').length,
      totalDemurrageExposureAed,
      totalRevenueAed,
      mappedVehiclesCount: vehicles.length,
      mappedDriversCount: drivers.length,
      availableTrailersCount: trailers.filter(t => t.masterStatus === 'AVAILABLE').length,
      totalTrailersCount: trailers.length,
      unacknowledgedAlertsCount: alerts.filter(a => !a.acknowledged).length,
    },
    terminals,
    warehouses,
    trailers,
    containers,
    jobs,
    vehicles,
    drivers,
    customers,
    clients,
    allowances,
    geofences,
    statusLogs,
    messages,
    alerts,
  };
}

export interface CreateDrayageJobBatchInput {
  tenantId: string;
  shipmentType: 'IMPORT' | 'EXPORT';
  priority?: 'STANDARD' | 'HIGH' | 'URGENT';
  customerId?: string | null;
  customerName: string;
  warehouseId?: string | null;
  warehouseName: string;
  terminalId?: string | null;
  terminalName: string;
  rateAmountAed?: number;
  driverAllowanceAed?: number;
  notes?: string | null;
  containers: Array<{
    containerNumber: string;
    size: string;
    containerType: string;
    doExpiryDate?: string | null;
    dischargeDate?: string | null;
    sealNumber?: string | null;
    weightKg?: number;
    customsInspection?: boolean;
    municipalityInspection?: boolean;
    cpipInspection?: boolean;
    mercInspection?: boolean;
    boxcareInspection?: boolean;
  }>;
}

export async function createDrayageJobsBatch(db: DrayageDbClient, input: CreateDrayageJobBatchInput) {
  await ensureDrayageSchema(db);
  const createdJobs: string[] = [];

  // Resolve terminal coordinates for initial pin
  const termRows = input.terminalId
    ? await db.$queryRawUnsafe<Array<{ lat: number; lng: number }>>(
        `SELECT lat, lng FROM logistics_drayage_terminals WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        input.terminalId, input.tenantId,
      )
    : [];
  const startLat = termRows[0]?.lat != null ? Number(termRows[0].lat) : 25.0112;
  const startLng = termRows[0]?.lng != null ? Number(termRows[0].lng) : 55.0612;

  for (const item of input.containers) {
    const cntNum = item.containerNumber.trim().toUpperCase();
    if (!cntNum) continue;

    const containerId = `cnt-${crypto.randomUUID().slice(0, 12)}`;
    const jobId = `job-${crypto.randomUUID().slice(0, 12)}`;
    const jobCode = `DRY-L1-${Math.floor(1000 + Math.random() * 9000)}`;
    const dischargeIso = item.dischargeDate ? new Date(item.dischargeDate).toISOString() : new Date().toISOString();
    const doExpiryIso = item.doExpiryDate ? new Date(item.doExpiryDate).toISOString() : null;

    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_containers (
        id, tenant_id, container_number, size, container_type, shipment_type, status,
        customer_id, customer_name, terminal_id, terminal_name, warehouse_id, warehouse_name,
        do_expiry_date, discharge_date, seal_number, weight_kg,
        customs_inspection, municipality_inspection, cpip_inspection, merc_inspection, boxcare_inspection
      ) VALUES (
        $1,$2,$3,$4,$5,$6,'AT_PORT_DISCHARGED',$7,$8,$9,$10,$11,$12,
        $13::timestamptz,$14::timestamptz,$15,$16,$17,$18,$19,$20,$21
      )`,
      containerId,
      input.tenantId,
      cntNum,
      item.size || '40HC',
      item.containerType || 'DRY',
      input.shipmentType || 'IMPORT',
      input.customerId ?? null,
      input.customerName,
      input.terminalId ?? null,
      input.terminalName,
      input.warehouseId ?? null,
      input.warehouseName,
      doExpiryIso,
      dischargeIso,
      item.sealNumber ?? `SL-${Math.floor(100000 + Math.random() * 900000)}`,
      item.weightKg ?? 22000,
      Boolean(item.customsInspection),
      Boolean(item.municipalityInspection),
      Boolean(item.cpipInspection),
      Boolean(item.mercInspection),
      Boolean(item.boxcareInspection),
    );

    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_jobs (
        id, tenant_id, job_code, job_phase, shipment_type, status, priority,
        customer_id, customer_name, warehouse_id, warehouse_name, terminal_id, terminal_name,
        container_id, container_number, container_size, container_type, do_expiry_date,
        rate_amount_aed, driver_allowance_aed,
        customs_inspection, municipality_inspection, cpip_inspection, merc_inspection, boxcare_inspection,
        current_lat, current_lng, notes
      ) VALUES (
        $1,$2,$3,'L1',$4,'PENDING',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz,
        $17,$18,$19,$20,$21,$22,$23,$24,$25,$26
      )`,
      jobId,
      input.tenantId,
      jobCode,
      input.shipmentType || 'IMPORT',
      input.priority || 'STANDARD',
      input.customerId ?? null,
      input.customerName,
      input.warehouseId ?? null,
      input.warehouseName,
      input.terminalId ?? null,
      input.terminalName,
      containerId,
      cntNum,
      item.size || '40HC',
      item.containerType || 'DRY',
      doExpiryIso,
      input.rateAmountAed ?? (item.containerType === 'REEFER' ? 2100 : 1550),
      input.driverAllowanceAed ?? 150,
      Boolean(item.customsInspection),
      Boolean(item.municipalityInspection),
      Boolean(item.cpipInspection),
      Boolean(item.mercInspection),
      Boolean(item.boxcareInspection),
      startLat,
      startLng,
      input.notes ?? null,
    );

    createdJobs.push(jobCode);
  }

  return { createdCount: createdJobs.length, jobCodes: createdJobs };
}

export async function assignDrayageJob(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    vehicleId: string;
    vehiclePlate: string;
    driverId: string;
    driverName: string;
    trailerId: string;
    trailerPlate: string;
    tokenNumber: string;
  },
) {
  await ensureDrayageSchema(db);

  const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    args.jobId,
    args.tenantId,
  );
  const job = jobRows[0];
  if (!job) throw new Error('Drayage job not found');

  const token = args.tokenNumber?.trim() || `DPW-TKN-${Math.floor(1000 + Math.random() * 9000)}`;

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET status = 'ASSIGNED',
            assigned_vehicle_id = $3,
            assigned_vehicle_plate = $4,
            assigned_driver_id = $5,
            assigned_driver_name = $6,
            assigned_trailer_id = $7,
            assigned_trailer_plate = $8,
            token_number = $9,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.jobId,
    args.tenantId,
    args.vehicleId,
    args.vehiclePlate,
    args.driverId,
    args.driverName,
    args.trailerId,
    args.trailerPlate,
    token,
  );

  // Update trailer operational status
  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_trailers
        SET master_status = 'IN_USE',
            operational_status = $3,
            linked_container_number = $4,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.trailerId,
    args.tenantId,
    String(job.job_phase) === 'L2' ? 'EN_ROUTE_MT' : 'LOADED_FCL',
    String(job.container_number),
  );

  // Update container linked trailer
  if (job.container_id) {
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_containers
          SET linked_trailer_plate = $3,
              status = $4,
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      String(job.container_id),
      args.tenantId,
      args.trailerPlate,
      String(job.job_phase) === 'L2' ? 'EMPTY_RETURN_ASSIGNED' : 'TOKEN_ASSIGNED',
    );
  }

  // Create Driver Trip Allowance entry
  const allowanceAmt = Number(job.driver_allowance_aed ?? 150);
  const gateFee = 35;
  const totalAmt = allowanceAmt + gateFee;
  const routeSummary = String(job.job_phase) === 'L2'
    ? `${job.warehouse_name} → ${job.terminal_name} (Empty Return)`
    : `${job.terminal_name} → ${job.warehouse_name}`;

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_allowances (
      id, tenant_id, job_id, job_code, driver_id, driver_name, vehicle_plate,
      container_number, trip_phase, route_summary, allowance_amount_aed, port_gate_fee_aed,
      overnight_halt_aed, total_amount_aed, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,'PENDING')`,
    `alw-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId,
    String(job.job_code),
    args.driverId,
    args.driverName,
    args.vehiclePlate,
    String(job.container_number),
    String(job.job_phase ?? 'L1'),
    routeSummary,
    allowanceAmt,
    gateFee,
    totalAmt,
  );

  return { ok: true, tokenNumber: token };
}

export async function updateDrayageJobExecutionStatus(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    status: string;
    placementLocation?: 'RAMP' | 'YARD' | null;
    detachTrailer?: boolean;
    etcTime?: string | null;
    notes?: string;
    actor?: string;
  },
) {
  await ensureDrayageSchema(db);
  const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    args.jobId,
    args.tenantId,
  );
  const job = jobRows[0];
  if (!job) throw new Error('Drayage job not found');

  const placement = args.placementLocation ?? (job.placement_location ? String(job.placement_location) : null);
  const detached = args.detachTrailer !== undefined ? args.detachTrailer : Boolean(job.trailer_detached);
  const isRampPlacement = args.status === 'PLACED_AT_RAMP' || (detached && placement === 'RAMP') || args.status === 'CONTAINER_DETACHED';

  // Handle ETC (Estimated Time of Completion for container offloading / destuffing)
  let effectiveEtcTime: string | null = null;
  if (args.etcTime) {
    try {
      effectiveEtcTime = new Date(args.etcTime).toISOString();
    } catch {
      effectiveEtcTime = new Date(Date.now() + 3 * 3600000).toISOString();
    }
  } else if (isRampPlacement) {
    // If not explicitly provided by driver, fallback to standard 3-hour destuffing SLA
    effectiveEtcTime = job.etc_time ? new Date(String(job.etc_time)).toISOString() : new Date(Date.now() + 3 * 3600000).toISOString();
  } else if (job.etc_time) {
    effectiveEtcTime = new Date(String(job.etc_time)).toISOString();
  }

  // Interpolate GPS coordinates depending on stage
  let lat = job.current_lat != null ? Number(job.current_lat) : 25.0112;
  let lng = job.current_lng != null ? Number(job.current_lng) : 55.0612;

  if (args.status === 'IN_TRANSIT') {
    lat = 24.9850;
    lng = 55.0760;
  } else if (['PLACED_AT_RAMP', 'PLACED_AT_YARD', 'CONTAINER_DETACHED', 'WAITING_MT_RETURN'].includes(args.status)) {
    lat = 24.9642;
    lng = 55.0915;
  } else if (['EMPTY_AT_PORT', 'EMPTY_DEPOSITED', 'COMPLETED'].includes(args.status)) {
    lat = 25.0112;
    lng = 55.0612;
  }

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET status = $3,
            placement_location = $4,
            trailer_detached = $5,
            current_lat = $6,
            current_lng = $7,
            etc_time = $8::timestamptz,
            etc_alert_status = CASE WHEN $8 IS NOT NULL THEN 'NEW' ELSE etc_alert_status END,
            notes = CASE WHEN $9::text IS NOT NULL AND $9::text != '' THEN $9::text ELSE notes END,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.jobId,
    args.tenantId,
    args.status,
    placement,
    detached,
    lat,
    lng,
    effectiveEtcTime,
    args.notes ? String(args.notes) : null,
  );

  // Sync container status: When placed at ramp or detached, container transitions to WAITING_MT_RETURN
  if (job.container_id) {
    const isCompletedL2 = String(job.job_phase) === 'L2' && (args.status === 'COMPLETED' || args.status === 'EMPTY_DEPOSITED');
    let cntStatus = args.status;
    if (isRampPlacement || args.status === 'WAITING_MT_RETURN') {
      cntStatus = 'WAITING_MT_RETURN';
    }
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_containers
          SET status = $3,
              empty_return_date = CASE WHEN $4::boolean THEN NOW() ELSE empty_return_date END,
              linked_trailer_plate = CASE WHEN $4::boolean THEN NULL ELSE linked_trailer_plate END,
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      String(job.container_id),
      args.tenantId,
      cntStatus,
      isCompletedL2,
    );
  }

  // Sync trailer status
  if (job.assigned_trailer_id) {
    let trMaster = 'IN_USE';
    let trOp = 'LOADED_FCL';
    if (args.status === 'PLACED_AT_RAMP' || (detached && placement === 'RAMP')) {
      trOp = 'DETACHED_AT_RAMP';
    } else if (args.status === 'PLACED_AT_YARD' || (detached && placement === 'YARD')) {
      trOp = 'DETACHED_AT_YARD';
    } else if (args.status === 'COMPLETED' || args.status === 'EMPTY_DEPOSITED') {
      trMaster = 'AVAILABLE';
      trOp = 'EMPTY';
    }
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_trailers
          SET master_status = $3,
              operational_status = $4,
              linked_container_number = CASE WHEN $3 = 'AVAILABLE' THEN NULL ELSE linked_container_number END,
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      String(job.assigned_trailer_id),
      args.tenantId,
      trMaster,
      trOp,
    );
  }

  const logActor = args.actor || 'Dispatch Console';
  const etcNote = effectiveEtcTime ? ` | Offloading ETC: ${new Date(effectiveEtcTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })}` : '';
  const customNotes = args.notes ? ` - ${args.notes}` : '';

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId,
    String(job.job_code),
    args.status,
    `Execution stage updated to ${args.status}${placement ? ` (${placement})` : ''}${detached ? ' [Chassis Detached]' : ''}${etcNote}${customNotes}`,
    logActor,
  );

  return { ok: true, status: args.status, etcTime: effectiveEtcTime };
}

export async function activateL2EmptyReturnJob(
  db: DrayageDbClient,
  args: { tenantId: string; l1JobId: string },
) {
  await ensureDrayageSchema(db);
  const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    args.l1JobId,
    args.tenantId,
  );
  const l1 = jobRows[0];
  if (!l1) throw new Error('L1 Job not found');
  if (l1.l2_activated) throw new Error('L2 Empty Return is already activated for this container');

  const l2Id = `job-l2-${crypto.randomUUID().slice(0, 10)}`;
  const l2Code = String(l1.job_code).replace('L1', 'L2') || `DRY-L2-${Math.floor(1000 + Math.random() * 9000)}`;

  // Mark L1 as COMPLETED / L2_ACTIVATED
  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET l2_activated = TRUE,
            status = 'COMPLETED',
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.l1JobId,
    args.tenantId,
  );

  // Create L2 Empty Return Job (from Warehouse back to Port Terminal)
  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_jobs (
      id, tenant_id, job_code, job_phase, parent_job_id, shipment_type, status, priority,
      customer_id, customer_name, warehouse_id, warehouse_name, terminal_id, terminal_name,
      container_id, container_number, container_size, container_type, do_expiry_date,
      assigned_trailer_id, assigned_trailer_plate,
      rate_amount_aed, driver_allowance_aed,
      current_lat, current_lng, notes
    ) VALUES (
      $1,$2,$3,'L2',$4,$5,'PENDING','HIGH',
      $6,$7,$8,$9,$10,$11,
      $12,$13,$14,$15,$16::timestamptz,
      $17,$18,
      950, 120,
      $19,$20,$21
    )`,
    l2Id,
    args.tenantId,
    l2Code,
    args.l1JobId,
    String(l1.shipment_type ?? 'IMPORT'),
    l1.customer_id ? String(l1.customer_id) : null,
    String(l1.customer_name),
    l1.warehouse_id ? String(l1.warehouse_id) : null,
    String(l1.warehouse_name),
    l1.terminal_id ? String(l1.terminal_id) : null,
    String(l1.terminal_name),
    l1.container_id ? String(l1.container_id) : null,
    String(l1.container_number),
    String(l1.container_size ?? '40HC'),
    String(l1.container_type ?? 'DRY'),
    l1.do_expiry_date ? new Date(String(l1.do_expiry_date)).toISOString() : null,
    l1.assigned_trailer_id ? String(l1.assigned_trailer_id) : null,
    l1.assigned_trailer_plate ? String(l1.assigned_trailer_plate) : null,
    l1.current_lat != null ? Number(l1.current_lat) : 24.9642,
    l1.current_lng != null ? Number(l1.current_lng) : 55.0915,
    `Auto-generated L2 Empty Container Return from ${l1.job_code}`,
  );

  if (l1.container_id) {
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_containers
          SET status = 'WAITING_MT_RETURN',
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      String(l1.container_id),
      args.tenantId,
    );
  }

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'L2_ACTIVATED', $5, 'Dispatch Console')`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.l1JobId,
    String(l1.job_code),
    `L2 Empty Container Return ${l2Code} activated for container ${l1.container_number}`,
  );

  return { ok: true, l2JobId: l2Id, l2JobCode: l2Code };
}

export async function extendDrayageJobEtcTime(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    minutesToAdd: number;
    reason?: string;
    actor?: string;
  },
) {
  await ensureDrayageSchema(db);
  const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    args.jobId,
    args.tenantId,
  );
  const job = jobRows[0];
  if (!job) throw new Error('Drayage job not found');

  const baseTime = job.etc_time ? new Date(String(job.etc_time)).getTime() : Date.now();
  const newEtc = new Date(baseTime + args.minutesToAdd * 60000).toISOString();

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET etc_time = $3::timestamptz,
            etc_alert_status = 'NEW',
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.jobId,
    args.tenantId,
    newEtc,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'ETC_EXTENDED', $5, $6)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId,
    String(job.job_code),
    `Offloading ETC extended by +${args.minutesToAdd}m to ${new Date(newEtc).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })}${args.reason ? ` (${args.reason})` : ''}`,
    args.actor || 'Dispatch Console',
  );

  return { ok: true, etcTime: newEtc };
}

export async function checkAndAutoActivateExpiredEtcJobs(
  db: DrayageDbClient,
  tenantId?: string,
): Promise<{ checked: number; activated: Array<{ l2JobId: string; l2JobCode: string; l1JobCode: string }> }> {
  await ensureDrayageSchema(db);
  const whereClause = tenantId
    ? `tenant_id = $1 AND job_phase = 'L1' AND l2_activated = FALSE AND etc_time IS NOT NULL AND etc_time <= NOW()`
    : `job_phase = 'L1' AND l2_activated = FALSE AND etc_time IS NOT NULL AND etc_time <= NOW()`;
  const params = tenantId ? [tenantId] : [];
  const expired = await db.$queryRawUnsafe<Array<{ id: string; tenant_id: string; job_code: string; etc_time: Date }>>(
    `SELECT id, tenant_id, job_code, etc_time FROM logistics_drayage_jobs WHERE ${whereClause} LIMIT 25`,
    ...params,
  );

  const activated: Array<{ l2JobId: string; l2JobCode: string; l1JobCode: string }> = [];
  for (const job of expired) {
    try {
      const res = await activateL2EmptyReturnJob(db, {
        tenantId: String(job.tenant_id),
        l1JobId: String(job.id),
      });
      await db.$executeRawUnsafe(
        `UPDATE logistics_drayage_jobs
            SET etc_alert_status = 'ACTIVATED',
                updated_at = NOW()
          WHERE id = $1`,
        job.id,
      );
      await db.$executeRawUnsafe(
        `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
         VALUES ($1, $2, $3, $4, 'AUTO_L2_ACTIVATED', $5, 'Background Timer Worker')`,
        `log-${crypto.randomUUID().slice(0, 12)}`,
        job.tenant_id,
        job.id,
        String(job.job_code),
        `Automated Leg 2 activation triggered upon Offloading ETC expiration (${new Date(job.etc_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })})`,
      );
      activated.push({ l2JobId: res.l2JobId, l2JobCode: res.l2JobCode, l1JobCode: String(job.job_code) });
    } catch (err) {
      console.error(`[checkAndAutoActivateExpiredEtcJobs] Error activating L2 for ${job.job_code}:`, err);
    }
  }
  return { checked: expired.length, activated };
}

export async function recordDrayageStatusLog(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    jobCode: string;
    status: string;
    notes: string;
    actor?: string;
  },
) {
  await ensureDrayageSchema(db);
  const id = `log-${crypto.randomUUID().slice(0, 12)}`;
  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    id,
    args.tenantId,
    args.jobId,
    args.jobCode,
    args.status,
    args.notes,
    args.actor ?? 'Dispatch Console',
  );
  return { ok: true, id };
}

export async function verifyPortEdiForJob(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    provider: 'DUBAI_TRADE_DPWORLD' | 'AD_PORTS_MAQTA';
  },
) {
  await ensureDrayageSchema(db);
  const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    args.jobId,
    args.tenantId,
  );
  const job = jobRows[0];
  if (!job) throw new Error('Job not found');

  const isMaqta = args.provider === 'AD_PORTS_MAQTA';
  const ediResult = {
    provider: args.provider,
    providerLabel: isMaqta ? 'AD Ports Maqta PCS' : 'DP World Dubai Trade PCS',
    containerNumber: String(job.container_number),
    customsStatus: 'CLEARED',
    doStatus: 'VALID',
    doExpiryDate: job.do_expiry_date
      ? new Date(String(job.do_expiry_date)).toISOString().slice(0, 10)
      : new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
    portChargesPaid: true,
    gatePassEligible: true,
    terminalBerth: isMaqta ? 'Khalifa Port Berth KP-4' : 'Jebel Ali T1 Berth 14',
    vesselName: isMaqta ? 'CMA CGM JULES VERNE' : 'MSC GULSUN V.412W',
    tokenNumber: job.token_number ? String(job.token_number) : `${isMaqta ? 'MQT' : 'DPW'}-TKN-${Math.floor(1000 + Math.random() * 9000)}`,
    verifiedAt: new Date().toISOString(),
  };

  if (!job.token_number) {
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_jobs SET token_number = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      args.jobId,
      args.tenantId,
      ediResult.tokenNumber,
    );
  }

  await recordDrayageStatusLog(db, {
    tenantId: args.tenantId,
    jobId: args.jobId,
    jobCode: String(job.job_code),
    status: 'EDI_VERIFIED',
    notes: `${ediResult.providerLabel}: Customs CLEARED, DO VALID, Vessel ${ediResult.vesselName} (${ediResult.terminalBerth})`,
    actor: ediResult.providerLabel,
  });

  return ediResult;
}

export async function appendDrayageItineraryLeg(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    legType: string;
    pickupLocation: string;
    dropoffLocation: string;
    rateAed: number;
  },
) {
  await ensureDrayageSchema(db);
  const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    args.jobId,
    args.tenantId,
  );
  const job = jobRows[0];
  if (!job) throw new Error('Job not found');

  const addedRate = Math.max(0, Number(args.rateAed ?? 250));
  const currentNotes = job.notes ? String(job.notes) : '';
  const legNote = `[Leg: ${args.legType} | ${args.pickupLocation} → ${args.dropoffLocation} | +AED ${addedRate}]`;
  const updatedNotes = currentNotes ? `${currentNotes}\n${legNote}` : legNote;

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET rate_amount_aed = rate_amount_aed + $3,
            notes = $4,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.jobId,
    args.tenantId,
    addedRate,
    updatedNotes,
  );

  await recordDrayageStatusLog(db, {
    tenantId: args.tenantId,
    jobId: args.jobId,
    jobCode: String(job.job_code),
    status: `LEG_${args.legType}`,
    notes: `Appended ${args.legType}: ${args.pickupLocation} → ${args.dropoffLocation} (+AED ${addedRate})`,
    actor: 'Dispatch Console',
  });

  return { ok: true, addedRateAed: addedRate };
}

export async function sendDispatchChatMessage(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    senderRole: 'DISPATCHER' | 'DRIVER';
    senderName: string;
    message: string;
    isUrgent?: boolean;
  },
) {
  await ensureDrayageSchema(db);
  const jobRows = await db.$queryRawUnsafe<Array<{ job_code: string }>>(
    `SELECT job_code FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    args.jobId,
    args.tenantId,
  );
  const jobCode = jobRows[0]?.job_code ? String(jobRows[0].job_code) : 'DRY-JOB';
  const id = `msg-${crypto.randomUUID().slice(0, 12)}`;

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_messages (
      id, tenant_id, job_id, job_code, sender_role, sender_name, message, is_urgent
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    id,
    args.tenantId,
    args.jobId,
    jobCode,
    args.senderRole,
    args.senderName,
    args.message,
    Boolean(args.isUrgent),
  );

  return { ok: true, id };
}

export async function acknowledgeDrayageAlert(
  db: DrayageDbClient,
  args: { tenantId: string; alertKey: string },
) {
  await ensureDrayageSchema(db);
  const id = `ack-${args.tenantId.slice(0, 8)}-${args.alertKey}`;
  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_alerts (id, tenant_id, alert_key, acknowledged, updated_at)
     VALUES ($1, $2, $3, TRUE, NOW())
     ON CONFLICT (id) DO UPDATE SET acknowledged = TRUE, updated_at = NOW()`,
    id,
    args.tenantId,
    args.alertKey,
  );
  return { ok: true };
}

export async function extendContainerDeliveryOrder(
  db: DrayageDbClient,
  args: { tenantId: string; containerId: string; daysToAdd?: number },
) {
  await ensureDrayageSchema(db);
  const days = Math.max(1, Number(args.daysToAdd ?? 3));
  const newExpiryIso = new Date(Date.now() + days * 86400000).toISOString();

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_containers
        SET do_expiry_date = $3::timestamptz,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.containerId,
    args.tenantId,
    newExpiryIso,
  );

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET do_expiry_date = $3::timestamptz,
            updated_at = NOW()
      WHERE container_id = $1 AND tenant_id = $2`,
    args.containerId,
    args.tenantId,
    newExpiryIso,
  );

  await acknowledgeDrayageAlert(db, {
    tenantId: args.tenantId,
    alertKey: `do-exp-${args.containerId}`,
  });

  return { ok: true, newDoExpiryDate: newExpiryIso };
}

export async function calculateMissingAllowances(db: DrayageDbClient, tenantId: string) {
  await ensureDrayageSchema(db);
  const jobsWithoutAllowance = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT j.*
       FROM logistics_drayage_jobs j
       LEFT JOIN logistics_drayage_allowances a
         ON a.job_id = j.id AND a.tenant_id = j.tenant_id
      WHERE j.tenant_id = $1
        AND j.assigned_driver_id IS NOT NULL
        AND a.id IS NULL`,
    tenantId,
  );

  let createdCount = 0;
  for (const job of jobsWithoutAllowance) {
    const allowanceAmt = Number(job.driver_allowance_aed ?? 150);
    const gateFee = 35;
    const totalAmt = allowanceAmt + gateFee;
    const routeSummary = String(job.job_phase) === 'L2'
      ? `${job.warehouse_name} → ${job.terminal_name} (Empty Return)`
      : `${job.terminal_name} → ${job.warehouse_name}`;

    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_allowances (
        id, tenant_id, job_id, job_code, driver_id, driver_name, vehicle_plate,
        container_number, trip_phase, route_summary, allowance_amount_aed, port_gate_fee_aed,
        overnight_halt_aed, total_amount_aed, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,'PENDING')`,
      `alw-${crypto.randomUUID().slice(0, 12)}`,
      tenantId,
      String(job.id),
      String(job.job_code),
      String(job.assigned_driver_id),
      String(job.assigned_driver_name ?? 'Assigned Driver'),
      job.assigned_vehicle_plate ? String(job.assigned_vehicle_plate) : null,
      String(job.container_number),
      String(job.job_phase ?? 'L1'),
      routeSummary,
      allowanceAmt,
      gateFee,
      totalAmt,
    );
    createdCount++;
  }

  return { ok: true, createdCount };
}



// =========================================================================
// STREET-TURN TRIANGULATION & BOGIE ENGINE DOMAIN FUNCTIONS
// =========================================================================

export async function findStreetTurnCandidates(
  db: DrayageDbClient,
  tenantId: string,
): Promise<StreetTurnMatch[]> {
  const workspace = await getDrayageWorkspaceData(db, tenantId);
  const unassignedJobs = workspace.jobs.filter(
    (j) => !j.assignedVehicleId && j.status !== 'COMPLETED' && j.status !== 'CANCELLED' && j.status !== 'STREET_TURNED'
  );

  const l2EmptyJobs = unassignedJobs.filter((j) => j.jobPhase === 'L2' || j.status === 'WAITING_MT_RETURN');
  const exportJobs = unassignedJobs.filter((j) => j.shipmentType === 'EXPORT' || j.jobCode.startsWith('EXP') || j.jobCode.includes('EXP'));

  if (l2EmptyJobs.length === 0 || exportJobs.length === 0) return [];

  const candidates: StreetTurnMatch[] = [];

  for (const l2 of l2EmptyJobs) {
    for (const exp of exportJobs) {
      if (l2.id === exp.id) continue;

      // 1. Zone proximity matching
      const zoneL2 = getWarehouseZoneName(l2.warehouseName);
      const zoneExp = getWarehouseZoneName(exp.warehouseName);
      const sameZone = zoneL2.toLowerCase() === zoneExp.toLowerCase();
      const isCorridorCluster =
        sameZone ||
        (zoneL2.includes('JAFZA') && zoneExp.includes('JAFZA')) ||
        (zoneL2.includes('JAFZA') && zoneExp.includes('NIP')) ||
        (zoneL2.includes('NIP') && zoneExp.includes('JAFZA'));

      if (!isCorridorCluster) continue;

      // 2. Equipment Size & Type Match
      const sizeMatch =
        l2.containerSize === exp.containerSize ||
        (l2.containerSize.startsWith('40') && exp.containerSize.startsWith('40'));
      if (!sizeMatch) continue;

      const typeMatch = (l2.containerType || 'DRY').toUpperCase() === (exp.containerType || 'DRY').toUpperCase();
      if (!typeMatch) continue;

      // 3. Carrier Line Matching
      const l2Line = detectShippingLine(l2.containerNumber, l2.shippingLine);
      const expLine = detectShippingLine(exp.containerNumber, exp.shippingLine);
      const isLineMatch = l2Line === expLine || exp.containerNumber.includes('TBD') || !exp.containerNumber;
      if (!isLineMatch && expLine !== 'GENERIC_LINE' && expLine !== 'CARRIER_DEFAULT') continue;

      const interDist = sameZone ? 3.2 : 7.8;
      const deadheadKmSaved = Math.max(48, Math.round(56 - interDist));
      const co2SavedKg = Math.round(deadheadKmSaved * 0.95 * 10) / 10;
      const fuelSavingsAed = Math.round(deadheadKmSaved * 4.5 + 400);

      let score = 90;
      if (sameZone) score += 8;
      if (l2Line === expLine) score += 5;

      candidates.push({
        id: `STREET-${l2.id}-${exp.id}`,
        l2Job: l2,
        exportJob: exp,
        shippingLine: l2Line,
        carrierPrefix: l2.containerNumber.slice(0, 4),
        containerNumber: l2.containerNumber,
        containerSize: l2.containerSize,
        containerType: l2.containerType,
        originWarehouse: l2.warehouseName,
        destWarehouse: exp.warehouseName,
        zone: zoneL2,
        interWarehouseDistanceKm: interDist,
        terminalName: exp.terminalName || l2.terminalName,
        deadheadKmSaved,
        co2SavedKg,
        fuelSavingsAed,
        turnaroundHoursSaved: 4.0,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export async function executeStreetTurnTriangulation(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    l2JobId: string;
    exportJobId: string;
    vehicleId?: string;
    vehiclePlate?: string;
    driverId?: string;
    driverName?: string;
    trailerId?: string;
    trailerPlate?: string;
    tokenNumber?: string;
    actor?: string;
  },
) {
  await ensureDrayageSchema(db);

  const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_jobs WHERE id IN ($1, $2) AND tenant_id = $3`,
    args.l2JobId,
    args.exportJobId,
    args.tenantId,
  );
  const l2 = rows.find((r) => String(r.id) === args.l2JobId);
  const exp = rows.find((r) => String(r.id) === args.exportJobId);

  if (!l2) throw new Error(`L2 Empty Return Job ${args.l2JobId} not found`);
  if (!exp) throw new Error(`Export Job ${args.exportJobId} not found`);

  const containerNum = String(l2.container_number);
  const containerSize = String(l2.container_size || '40HC');
  const containerType = String(l2.container_type || 'DRY');
  const streetTurnRef = `ST-${Math.floor(1000 + Math.random() * 9000)}`;
  const token = args.tokenNumber || `DPW-ST-${Math.floor(1000 + Math.random() * 9000)}`;

  // 1. Mark L2 job as STREET_TURNED
  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET status = 'STREET_TURNED',
            street_turn_job_id = $3,
            notes = COALESCE(notes || ' | ', '') || $4,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.l2JobId,
    args.tenantId,
    args.exportJobId,
    `Inland Street-Turned to Export Job ${exp.job_code} (${streetTurnRef}) - 52km deadhead avoided`,
  );

  // 2. Allocate empty container to Export Job
  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET container_id = $3,
            container_number = $4,
            container_size = $5,
            container_type = $6,
            street_turn_job_id = $7,
            priority = 'HIGH',
            notes = COALESCE(notes || ' | ', '') || $8,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.exportJobId,
    args.tenantId,
    l2.container_id ? String(l2.container_id) : null,
    containerNum,
    containerSize,
    containerType,
    args.l2JobId,
    `Container ${containerNum} allocated via Inland Street-Turn from ${l2.job_code} (${streetTurnRef})`,
  );

  // 3. If vehicle, driver, and trailer provided, dispatch Export Job
  if (args.vehicleId && args.driverId && args.trailerId) {
    await assignDrayageJob(db, {
      tenantId: args.tenantId,
      jobId: args.exportJobId,
      vehicleId: args.vehicleId,
      vehiclePlate: args.vehiclePlate || 'DXB-TRACTOR',
      driverId: args.driverId,
      driverName: args.driverName || 'Assigned Driver',
      trailerId: args.trailerId,
      trailerPlate: args.trailerPlate || 'DXB-TR-9901',
      tokenNumber: token,
    });
  }

  // 4. Update container status
  if (l2.container_id) {
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_containers
          SET status = 'REALLOCATED_EXPORT',
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      String(l2.container_id),
      args.tenantId,
    );
  }

  // 5. Log status event
  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'STREET_TURN_EXECUTED', $5, $6)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.exportJobId,
    String(exp.job_code),
    `Triangulation Street-Turn executed with ${l2.job_code}. Container ${containerNum} repositioned inland from ${l2.warehouse_name} to ${exp.warehouse_name}. 52km empty port deadhead avoided.`,
    args.actor || 'Dispatcher Console',
  );

  return {
    ok: true,
    streetTurnRef,
    l2JobCode: String(l2.job_code),
    exportJobCode: String(exp.job_code),
    containerNumber: containerNum,
    deadheadKmSaved: 52,
    co2SavedKg: 49.4,
    fuelSavingsAed: 750,
    tokenNumber: token,
  };
}

export async function findBogiePairCandidates(
  db: DrayageDbClient,
  tenantId: string,
): Promise<BogiePairCandidate[]> {
  const workspace = await getDrayageWorkspaceData(db, tenantId);
  const unassignedJobs = workspace.jobs.filter(
    (j) => !j.assignedVehicleId && j.status !== 'COMPLETED' && j.status !== 'CANCELLED'
  );
  const twentyFtJobs = unassignedJobs.filter((j) => j.containerSize === '20FT');

  if (twentyFtJobs.length < 2) return [];

  const candidates: BogiePairCandidate[] = [];
  const usedIds = new Set<string>();

  for (let i = 0; i < twentyFtJobs.length; i++) {
    const j1 = twentyFtJobs[i];
    if (usedIds.has(j1.id)) continue;

    for (let k = i + 1; k < twentyFtJobs.length; k++) {
      const j2 = twentyFtJobs[k];
      if (usedIds.has(j2.id)) continue;

      const sameTerminal =
        j1.terminalName.trim().toLowerCase() === j2.terminalName.trim().toLowerCase();
      if (!sameTerminal) continue;

      const zone1 = getWarehouseZoneName(j1.warehouseName);
      const zone2 = getWarehouseZoneName(j2.warehouseName);
      const sameZone = zone1.toLowerCase() === zone2.toLowerCase();

      const box1WeightKg = j1.cargoWeightKg || 14500;
      const box2WeightKg = j2.cargoWeightKg || 16200;
      const totalPayloadKg = box1WeightKg + box2WeightKg;
      const weightLimitKg = 36000;
      const isWeightCompliant = totalPayloadKg <= weightLimitKg;
      const weightUtilizationPct = Math.round((totalPayloadKg / weightLimitKg) * 100);

      const drop1 = j1.doExpiryDate && j2.doExpiryDate && j1.doExpiryDate <= j2.doExpiryDate ? j1 : j2;
      const drop2 = drop1.id === j1.id ? j2 : j1;

      const combinedRevenueAed = (j1.rateAmountAed || 1450) + (j2.rateAmountAed || 1450);
      const combinedAllowanceAed = (j1.driverAllowanceAed || 150) + (j2.driverAllowanceAed || 150);

      let score = 80;
      if (sameZone) score += 15;
      if (isWeightCompliant) score += 10;
      else score -= 30;

      candidates.push({
        id: `BOGIE-${j1.id}-${j2.id}`,
        job1: drop1,
        job2: drop2,
        commonTerminal: j1.terminalName,
        zone1,
        zone2,
        sameZone,
        box1WeightKg,
        box2WeightKg,
        totalPayloadKg,
        isWeightCompliant,
        weightLimitKg,
        weightUtilizationPct,
        recommendedTrailerType: '40FT_SKELETAL / Bogie Multi-Axle Chassis',
        combinedRevenueAed,
        combinedAllowanceAed,
        fuelSavingPct: 40,
        tasSlot: '08:00 - 10:00 (Gate 3 TAS)',
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export async function executeBogiePairDispatch(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    job1Id: string;
    job2Id: string;
    vehicleId: string;
    vehiclePlate: string;
    driverId: string;
    driverName: string;
    trailerId: string;
    trailerPlate: string;
    tokenNumber?: string;
    actor?: string;
  },
) {
  await ensureDrayageSchema(db);

  const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_jobs WHERE id IN ($1, $2) AND tenant_id = $3`,
    args.job1Id,
    args.job2Id,
    args.tenantId,
  );
  if (jobRows.length !== 2) throw new Error('Both 20FT jobs must exist for Bogie pairing');

  const j1 = jobRows.find((r) => String(r.id) === args.job1Id);
  const j2 = jobRows.find((r) => String(r.id) === args.job2Id);
  if (!j1 || !j2) throw new Error('Jobs not found');

  if (String(j1.container_size) !== '20FT' || String(j2.container_size) !== '20FT') {
    throw new Error('A Bogie trip strictly requires two 20FT containers');
  }

  const trailerRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_trailers WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    args.trailerId,
    args.tenantId,
  );
  const trailer = trailerRows[0];
  if (trailer) {
    const trType = String(trailer.trailer_type || '');
    if (trType.includes('20FT') && !trType.includes('40FT')) {
      throw new Error(`Trailer ${trailer.plate_number} is a 20FT chassis. A Bogie pair requires a 40FT/45FT Skeletal or Bogie trailer.`);
    }
  }

  const w1 = Number(j1.cargo_weight_kg ?? 14500);
  const w2 = Number(j2.cargo_weight_kg ?? 16200);
  const totalPayload = w1 + w2;
  const isWeightCompliant = totalPayload <= 36000;

  const bogieRef = `BOGIE-${Math.floor(1000 + Math.random() * 9000)}`;
  const token = args.tokenNumber || `DPW-BG-${Math.floor(1000 + Math.random() * 9000)}`;

  for (const [idx, job] of [j1, j2].entries()) {
    const otherJobId = job.id === j1.id ? j2.id : j1.id;
    const dropIndex = idx + 1;

    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_jobs
          SET bogie_job_id = $3,
              notes = COALESCE(notes || ' | ', '') || $4,
              priority = 'HIGH',
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      job.id,
      args.tenantId,
      otherJobId,
      `Paired in 2x20FT Bogie Dispatch (${bogieRef}) - Drop #${dropIndex}`,
    );

    await assignDrayageJob(db, {
      tenantId: args.tenantId,
      jobId: String(job.id),
      vehicleId: args.vehicleId,
      vehiclePlate: args.vehiclePlate,
      driverId: args.driverId,
      driverName: args.driverName,
      trailerId: args.trailerId,
      trailerPlate: args.trailerPlate,
      tokenNumber: token,
    });
  }

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'BOGIE_DISPATCH_CREATED', $5, $6)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    String(j1.id),
    String(j1.job_code),
    `Dual-20FT Bogie Pair dispatched (${bogieRef}). Total payload: ${totalPayload.toLocaleString()} kg (${isWeightCompliant ? 'Road Compliant' : 'Overweight Risk'}). Token: ${token}`,
    args.actor || 'Dispatcher Console',
  );

  return {
    ok: true,
    bogieRef,
    tokenNumber: token,
    job1Code: String(j1.job_code),
    job2Code: String(j2.job_code),
    totalPayloadKg: totalPayload,
    isWeightCompliant,
  };
}
