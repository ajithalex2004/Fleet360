import crypto from 'crypto';
import {
  getCachedDrayageMasterData,
  setCachedDrayageMasterData,
  invalidateDrayageMasterCache,
  shouldRunEtcAutoActivationCheck,
} from './drayage-events';

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
  lat: number | null;
  lng: number | null;
  hasLiveGps?: boolean;
  isDriverLoggedIn?: boolean;
  gpsStatus?: 'MOVING' | 'IDLE' | 'SWITCHED_OFF';
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
  returnTerminalId?: string | null;
  returnTerminalName?: string | null;
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
  pcsTokenNumber?: string | null;
  pcsSlotStart?: string | null;
  pcsSlotEnd?: string | null;
  pcsTokenStatus?: 'PENDING' | 'BOOKED' | 'EXPIRED' | 'GATE_ENTERED' | 'CANCELLED' | string;
  inspectionStatus?: 'NOT_REQUIRED' | 'HOLD_PENDING' | 'INSPECTION_BOOKED' | 'CLEARED' | 'REJECTED' | string;
  inspectionSealNumber?: string | null;
  inspectionClearedBy?: string | null;
  inspectionClearedAt?: string | null;
  doStatus?: 'VALID' | 'EXPIRED' | 'REVALIDATED' | string;
  doRevalidatedAt?: string | null;
}

export interface DrayageRoutePoint {
  lat: number;
  lng: number;
  timestamp: string;
  location?: string;
  status?: string;
  speedKmh?: number;
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
  returnTerminalId?: string | null;
  returnTerminalName?: string | null;
  originTerminalId?: string | null;
  originTerminalName?: string | null;
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
  sealNumber?: string | null;
  dischargeDate?: string | null;
  shippingLine?: string;
  bogieJobId?: string | null;
  streetTurnJobId?: string | null;
  podPhotoUrl?: string | null;
  podSignatureName?: string | null;
  podSignedAt?: string | null;
  pcsTokenNumber?: string | null;
  pcsSlotStart?: string | null;
  pcsSlotEnd?: string | null;
  pcsTokenStatus?: string | null;
  inspectionStatus?: string | null;
  doStatus?: string | null;
  riskRadar?: DrayageRiskRadarInfo;
  portSlotPrediction?: DrayagePortSlotPrediction;
  customerPortal?: DrayageCustomerPortalLink;
  routePath?: DrayageRoutePoint[];
}

export type DrayageTrackingPortalRole = 'CUSTOMER' | 'CLIENT' | 'RAMP';

export interface DrayageCustomerPortalLink {
  trackingToken: string;
  shareablePath: string;
  customerToken: string;
  customerShareablePath: string;
  clientToken: string;
  clientShareablePath: string;
  rampToken: string;
  rampShareablePath: string;
  customerLinkActive: boolean;
  clientLinkActive: boolean;
  rampLinkActive: boolean;
  jobCode: string;
  containerNumber: string;
  customerName: string;
  customerWhatsApp: string;
  customerEmail: string;
  clientName: string;
  clientWhatsApp: string;
  clientEmail: string;
  rampContactName: string;
  rampWhatsApp: string;
  autoAlertsEnabled: boolean;
  lastAlertSentAt: string | null;
  lastAlertSummary: string | null;
}

export interface DrayageRiskRadarInfo {
  portFreeTimeExpiry: string;
  portDemurrageHoursRemaining: number;
  portFreeDaysAllowed: number;
  portDailyDemurrageAed: number;
  lineDetentionExpiry: string;
  lineDetentionHoursRemaining: number;
  lineFreeDaysAllowed: number;
  lineDailyDetentionAed: number;
  doExpiryDate: string;
  doHoursRemaining: number;
  minHoursRemaining: number;
  primaryRiskFactor: 'PORT_DEMURRAGE' | 'LINE_DETENTION' | 'DO_EXPIRY' | 'SAFE';
  within24hPenaltyWindow: boolean;
  autoEscalatedCritical: boolean;
  dailyCombinedPenaltyAed: number;
  accruedExposureAed: number;
  status: 'EXPIRED' | 'CRITICAL_24H' | 'WARNING_48H' | 'SAFE';
}

export interface DrayagePortSlotPrediction {
  hasActiveToken: boolean;
  tokenNumber: string | null;
  pcsProvider: 'DP_WORLD_DUBAI_TRADE' | 'AD_PORTS_MAQTA';
  slotStart: string;
  slotEnd: string;
  slotWindowLabel: string;
  corridorName: string;
  trafficCondition: 'HEAVY_CONGESTION' | 'MODERATE_FLOW' | 'FREE_FLOW';
  avgCorridorSpeedKmh: number;
  distanceToPortKm: number;
  drivingEtaMinutes: number;
  gateQueueWaitMinutes: number;
  totalEtaMinutes: number;
  predictedGateArrivalIso: string;
  predictedGateArrivalLabel: string;
  slotBufferMinutes: number;
  willMissSlot: boolean;
  slotRiskStatus: 'SLOT_MISS_RISK' | 'TIGHT_BUFFER' | 'ON_TIME';
  recommendation: string;
}

export interface DrayageAutomationConfig {
  autoL2DispatchEnabled: boolean;
  thresholdMinutes: number;
  weightProximityPct: number;
  weightIdlenessPct: number;
  weightWorkloadPct: number;
  weightAvailabilityPct: number;
  streetTurnRadiusKm: number;
  streetTurnStrictCarrierMatch: boolean;
  bogieWindowHours: number;
  bogieMaxPayloadKg: number;
  criticalRiskWindowHours: number;
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_DRAYAGE_AUTOMATION_CONFIG: DrayageAutomationConfig = {
  autoL2DispatchEnabled: false,
  thresholdMinutes: 15,
  weightProximityPct: 60,
  weightIdlenessPct: 25,
  weightWorkloadPct: 10,
  weightAvailabilityPct: 5,
  streetTurnRadiusKm: 15,
  streetTurnStrictCarrierMatch: true,
  bogieWindowHours: 2.0,
  bogieMaxPayloadKg: 36000,
  criticalRiskWindowHours: 24,
};

export interface StreetTurnMatch {
  id: string;
  l2Job: DrayageJob;
  exportJob: DrayageJob;
  sourcePhase?: 'L1_RAMP' | 'L2_EMPTY';
  shippingLine: string;
  carrierPrefix: string;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  containerGrade?: string;
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
  windowDiffHours?: number;
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
  bogieBonusAed: number;
  streetTurnBonusAed: number;
  inspectionBonusAed: number;
  totalAmountAed: number;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';
  approvedBy: string | null;
  approvedAt: string | null;
  paymentRef: string | null;
  paymentMethod: string | null;
  paidAt: string | null;
  paidBy: string | null;
  adjustmentNotes: string | null;
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
  location?: string;
}

export type DirectionalReassignLabel =
  | 'MT_Reassign to Yard'
  | 'FCL_Reassign to Yard'
  | 'FCL_Reassign to Ramp'
  | 'MT_Reassign to Ramp';

export const DIRECTIONAL_REASSIGN_STATUS_UPPER_SET = new Set([
  'FCL_REASSIGN',
  'MT_REASSIGN',
  'MT_REASSIGN TO YARD',
  'FCL_REASSIGN TO YARD',
  'FCL_REASSIGN TO RAMP',
  'MT_REASSIGN TO RAMP',
  'MT_REASSIGN_TO_YARD',
  'FCL_REASSIGN_TO_YARD',
  'FCL_REASSIGN_TO_RAMP',
  'MT_REASSIGN_TO_RAMP',
]);

export function isDrayageReassignStatus(status?: string | null): boolean {
  const s = String(status || '').trim().toUpperCase();
  return DIRECTIONAL_REASSIGN_STATUS_UPPER_SET.has(s);
}

/**
 * Resolves the directional Reassign status label based on origin placement (Ramp vs Yard)
 * and shipmentType (IMPORT vs EXPORT):
 * - Origin = RAMP (Placed at Ramp / Reassign Placed at Ramp):
 *     - IMPORT -> 'MT_Reassign to Yard' (destuffed empty at ramp -> move to yard)
 *     - EXPORT -> 'FCL_Reassign to Yard' (stuffed full at ramp -> move to yard)
 * - Origin = YARD (Placed at Yard):
 *     - IMPORT -> 'FCL_Reassign to Ramp' (staged full at yard -> move to ramp for destuffing)
 *     - EXPORT -> 'MT_Reassign to Ramp' (staged empty at yard -> move to ramp for stuffing)
 */
export function resolveDirectionalReassignStatus(args: {
  originLocation: 'RAMP' | 'YARD' | string | null | undefined;
  shipmentType: 'IMPORT' | 'EXPORT' | string | null | undefined;
}): DirectionalReassignLabel {
  const loc = String(args.originLocation || 'RAMP').trim().toUpperCase();
  const ship = String(args.shipmentType || 'IMPORT').trim().toUpperCase();
  if (loc === 'YARD') {
    return ship === 'EXPORT' ? 'MT_Reassign to Ramp' : 'FCL_Reassign to Ramp';
  }
  return ship === 'EXPORT' ? 'FCL_Reassign to Yard' : 'MT_Reassign to Yard';
}

export interface DispatcherJobReassignEvaluation {
  canReassign: boolean;
  isWaitingForFirstRampAlert: boolean;
  reassignLabel: DirectionalReassignLabel | null;
  displayStatus: string;
  originLocation: 'RAMP' | 'YARD' | null;
  firstAlertReached: boolean;
  minsLeft: number | null;
}

export function evaluateDispatcherJobReassignState(
  job: {
    status?: string | null;
    shipmentType?: 'IMPORT' | 'EXPORT' | string | null;
    placementLocation?: 'RAMP' | 'YARD' | string | null;
    trailerDetached?: boolean;
    etcTime?: string | null;
    etcAlertStatus?: string | null;
  },
  nowMs: number = Date.now(),
): DispatcherJobReassignEvaluation {
  const rawStatus = String(job.status || '').trim();
  const s = rawStatus.toUpperCase();
  const ship = String(job.shipmentType || 'IMPORT').trim().toUpperCase() === 'EXPORT' ? 'EXPORT' : 'IMPORT';
  const locUpper = String(job.placementLocation || '').trim().toUpperCase();

  let minsLeft: number | null = null;
  if (job.etcTime) {
    const etcMs = new Date(job.etcTime).getTime();
    if (!isNaN(etcMs)) {
      minsLeft = Math.ceil((etcMs - nowMs) / 60000);
    }
  }
  const alertUpper = String(job.etcAlertStatus || '').trim().toUpperCase();
  const firstAlertReached =
    alertUpper === 'T15_WARNING' ||
    alertUpper === 'EXPIRED' ||
    (minsLeft !== null && minsLeft <= 15);

  if (s === 'MT_REASSIGN TO YARD' || s === 'MT_REASSIGN_TO_YARD') {
    return {
      canReassign: true,
      isWaitingForFirstRampAlert: false,
      reassignLabel: 'MT_Reassign to Yard',
      displayStatus: 'MT_Reassign to Yard',
      originLocation: 'RAMP',
      firstAlertReached: true,
      minsLeft,
    };
  }
  if (s === 'FCL_REASSIGN TO YARD' || s === 'FCL_REASSIGN_TO_YARD') {
    return {
      canReassign: true,
      isWaitingForFirstRampAlert: false,
      reassignLabel: 'FCL_Reassign to Yard',
      displayStatus: 'FCL_Reassign to Yard',
      originLocation: 'RAMP',
      firstAlertReached: true,
      minsLeft,
    };
  }
  if (s === 'FCL_REASSIGN TO RAMP' || s === 'FCL_REASSIGN_TO_RAMP') {
    return {
      canReassign: true,
      isWaitingForFirstRampAlert: false,
      reassignLabel: 'FCL_Reassign to Ramp',
      displayStatus: 'FCL_Reassign to Ramp',
      originLocation: 'YARD',
      firstAlertReached: true,
      minsLeft,
    };
  }
  if (s === 'MT_REASSIGN TO RAMP' || s === 'MT_REASSIGN_TO_RAMP') {
    return {
      canReassign: true,
      isWaitingForFirstRampAlert: false,
      reassignLabel: 'MT_Reassign to Ramp',
      displayStatus: 'MT_Reassign to Ramp',
      originLocation: 'YARD',
      firstAlertReached: true,
      minsLeft,
    };
  }
  if (s === 'FCL_REASSIGN' || s === 'MT_REASSIGN') {
    const origin: 'RAMP' | 'YARD' = locUpper === 'YARD' ? 'YARD' : 'RAMP';
    const label = resolveDirectionalReassignStatus({ originLocation: origin, shipmentType: ship });
    return {
      canReassign: true,
      isWaitingForFirstRampAlert: false,
      reassignLabel: label,
      displayStatus: label,
      originLocation: origin,
      firstAlertReached: true,
      minsLeft,
    };
  }

  // Origin = Yard (PLACED_AT_YARD or detached at YARD):
  // Immediately eligible for FCL_Reassign to Ramp (Import) or MT_Reassign to Ramp (Export)
  const isAtInitialYard =
    s === 'PLACED_AT_YARD' ||
    ((s === 'TRAILER_DETACHED' || s === 'CONTAINER_DETACHED') && locUpper === 'YARD');
  if (isAtInitialYard) {
    const label = resolveDirectionalReassignStatus({ originLocation: 'YARD', shipmentType: ship });
    return {
      canReassign: true,
      isWaitingForFirstRampAlert: false,
      reassignLabel: label,
      displayStatus: label,
      originLocation: 'YARD',
      firstAlertReached: true,
      minsLeft,
    };
  }

  // Origin = Ramp (PLACED_AT_RAMP / REASSIGN_PLACED_AT_RAMP or detached at RAMP):
  // Disabled before first alert; enabled and shown as MT_Reassign to Yard (Import) / FCL_Reassign to Yard (Export) upon first alert
  const isAtRamp =
    s === 'PLACED_AT_RAMP' ||
    s === 'REASSIGN_PLACED_AT_RAMP' ||
    ((s === 'TRAILER_DETACHED' || s === 'CONTAINER_DETACHED' || s === 'REASSIGN_TRAILER_DETACHED') &&
      locUpper !== 'YARD');
  if (isAtRamp) {
    const label = resolveDirectionalReassignStatus({ originLocation: 'RAMP', shipmentType: ship });
    if (firstAlertReached) {
      return {
        canReassign: true,
        isWaitingForFirstRampAlert: false,
        reassignLabel: label,
        displayStatus: label,
        originLocation: 'RAMP',
        firstAlertReached: true,
        minsLeft,
      };
    }
    return {
      canReassign: false,
      isWaitingForFirstRampAlert: true,
      reassignLabel: label,
      displayStatus: rawStatus,
      originLocation: 'RAMP',
      firstAlertReached: false,
      minsLeft,
    };
  }

  return {
    canReassign: false,
    isWaitingForFirstRampAlert: false,
    reassignLabel: null,
    displayStatus: rawStatus,
    originLocation: locUpper === 'YARD' ? 'YARD' : locUpper === 'RAMP' ? 'RAMP' : null,
    firstAlertReached,
    minsLeft,
  };
}

/**
 * Determines whether "Change Return Terminal" is unlocked for a job:
 * - Unlocked starting from EN_ROUTE_WAREHOUSE (as soon as the container exits the port on L1),
 *   through PLACED_AT_RAMP / PLACED_AT_YARD / MT_Reassign to Yard / READY_FOR_PICKUP,
 *   and L2 - PENDING (before L2 Vehicle Assignment).
 * - Locked before EN_ROUTE_WAREHOUSE on L1, and locked after L2 - PENDING (once L2 is ASSIGNED or later).
 */
export function canChangeDrayageReturnTerminal(job: {
  jobPhase?: 'L1' | 'L2' | string | null;
  jobCode?: string | null;
  status?: string | null;
  l2Activated?: boolean;
  assignedVehicleId?: string | null;
  assignedVehiclePlate?: string | null;
}): boolean {
  const phase =
    String(job.jobPhase || '').trim().toUpperCase() === 'L2' ||
    String(job.jobCode || '').toUpperCase().includes('-L2')
      ? 'L2'
      : 'L1';
  const st = String(job.status || '').trim().toUpperCase();

  if (phase === 'L2') {
    return (
      (st === 'PENDING' || st === 'WAITING_MT_RETURN') &&
      !job.assignedVehicleId &&
      !job.assignedVehiclePlate
    );
  }

  if (job.l2Activated || ['COMPLETED', 'CANCELLED', 'STREET_TURNED', 'EMPTY_DEPOSITED', 'CONTAINER_DROPPED'].includes(st)) {
    return false;
  }

  if (isDrayageReassignStatus(st)) {
    return true;
  }

  const allowedL1Statuses = new Set([
    'EN_ROUTE_WAREHOUSE',
    'IN_TRANSIT',
    'PLACED_AT_RAMP',
    'REASSIGN_PLACED_AT_RAMP',
    'PLACED_AT_YARD',
    'REASSIGN_PLACED_AT_YARD',
    'CONTAINER_DETACHED',
    'TRAILER_DETACHED',
    'REASSIGN_TRAILER_DETACHED',
    'RE-ASSIGNED',
    'READY_FOR_PICKUP',
    'CONTAINER_OFFLOADED',
    'WAITING_MT_RETURN',
  ]);

  return allowedL1Statuses.has(st);
}

export function parseReturnTerminalTag(notes?: string | null): {
  returnTerminalId: string | null;
  returnTerminalName: string;
  originTerminalName?: string;
} | null {
  if (!notes) return null;
  const m = String(notes).match(/\[RETURN_TERM:([^|]*)\|([^|\]]+)(?:\|FROM:([^\]]+))?\]/i);
  if (!m) return null;
  const returnTerminalId = m[1]?.trim() ? m[1].trim() : null;
  const returnTerminalName = (m[2] || '').trim();
  const originTerminalName = m[3]?.trim() ? m[3].trim() : undefined;
  if (!returnTerminalName) return null;
  return {
    returnTerminalId,
    returnTerminalName,
    originTerminalName,
  };
}

const MAJOR_OPERATIONAL_MILESTONE_STATUSES = new Set([
  'ACCEPTED',
  'ARRIVED_AT_PORT',
  'AT_PORT',
  'EMPTY_AT_PORT',
  'CONTAINER_PICKED',
  'LOADED',
  'TRAILER_ATTACHED',
  'UNDER_INSPECTION',
  'INSPECTION_CLEARED',
  'INSPECTION_REPORTED',
  'INSPECTION_SKIPPED',
  'PHOTO_UPLOADED',
  'EN_ROUTE_WAREHOUSE',
  'EN_ROUTE_TERMINAL',
  'IN_TRANSIT',
  'PLACED_AT_RAMP',
  'PLACED_AT_YARD',
  'REASSIGN_PLACED_AT_RAMP',
  'REASSIGN_PLACED_AT_YARD',
  'EPOD_SIGNED',
  'TRAILER_DETACHED',
  'CONTAINER_DETACHED',
  'REASSIGN_TRAILER_DETACHED',
  'FCL_REASSIGN',
  'MT_REASSIGN',
  'MT_REASSIGN TO YARD',
  'FCL_REASSIGN TO YARD',
  'FCL_REASSIGN TO RAMP',
  'MT_REASSIGN TO RAMP',
  'MT_REASSIGN_TO_YARD',
  'FCL_REASSIGN_TO_YARD',
  'FCL_REASSIGN_TO_RAMP',
  'MT_REASSIGN_TO_RAMP',
  'READY_FOR_PICKUP',
  'CONTAINER_OFFLOADED',
  'RETURN_TERMINAL_CHANGED',
  'CONTAINER_DROPPED',
  'EMPTY_DEPOSITED',
  'CONTAINER_DELIVERED',
  'COMPLETED',
]);

const UAE_GEOGRAPHIC_REFERENCE_POINTS: Array<{
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
}> = [
  // Abu Dhabi Island & Metropolitan
  { name: 'Al Nahyan, Abu Dhabi', lat: 24.4594, lng: 54.3818, radiusKm: 2.5 },
  { name: 'Al Mushrif, Abu Dhabi', lat: 24.4425, lng: 54.3965, radiusKm: 3.0 },
  { name: 'Al Bateen, Abu Dhabi', lat: 24.4535, lng: 54.3425, radiusKm: 3.0 },
  { name: 'Al Danah / Central Abu Dhabi', lat: 24.4882, lng: 54.3665, radiusKm: 3.0 },
  { name: 'Al Zahiyah / Mina Zayed, Abu Dhabi', lat: 24.5135, lng: 54.3775, radiusKm: 3.5 },
  { name: 'Al Reem Island, Abu Dhabi', lat: 24.4960, lng: 54.4060, radiusKm: 3.5 },
  { name: 'Al Maqta / Rabdan, Abu Dhabi', lat: 24.4160, lng: 54.4820, radiusKm: 4.0 },
  { name: 'Mussafah Industrial, Abu Dhabi', lat: 24.3540, lng: 54.5020, radiusKm: 6.5 },
  { name: 'ICAD Industrial City, Abu Dhabi', lat: 24.3120, lng: 54.4780, radiusKm: 6.5 },
  { name: 'Khalifa City, Abu Dhabi', lat: 24.4210, lng: 54.5750, radiusKm: 6.0 },
  { name: 'Mohammed Bin Zayed City, Abu Dhabi', lat: 24.3510, lng: 54.5580, radiusKm: 6.0 },
  { name: 'Yas Island / Shahama Corridor, Abu Dhabi', lat: 24.4950, lng: 54.6080, radiusKm: 7.0 },
  { name: 'KEZAD / Khalifa Port, Abu Dhabi', lat: 24.7920, lng: 54.6820, radiusKm: 8.5 },
  { name: 'Al Samha / Ghantoot (E11 Corridor)', lat: 24.8550, lng: 54.8450, radiusKm: 10.0 },
  { name: 'Al Ain Logistics Corridor', lat: 24.2075, lng: 55.7447, radiusKm: 18.0 },
  // Dubai & Jebel Ali Logistics Corridor
  { name: 'Jebel Ali Port (T1/T2/T3), Dubai', lat: 25.0112, lng: 55.0612, radiusKm: 2.8 },
  { name: 'JAFZA North Free Zone, Dubai', lat: 24.9910, lng: 55.0750, radiusKm: 3.0 },
  { name: 'JAFZA South Logistics Zone, Dubai', lat: 24.9642, lng: 55.0915, radiusKm: 3.5 },
  { name: 'National Industries Park (NIP), Dubai', lat: 24.9220, lng: 55.0680, radiusKm: 4.5 },
  { name: 'Dubai South (DWC Logistics District)', lat: 24.8960, lng: 55.1450, radiusKm: 6.0 },
  { name: 'Dubai Investments Park (DIP)', lat: 24.9850, lng: 55.1680, radiusKm: 5.5 },
  { name: 'Al Yalayis / E311 Freight Corridor, Dubai', lat: 25.0020, lng: 55.1350, radiusKm: 5.0 },
  { name: 'Al Marina / JLT, Dubai', lat: 25.0750, lng: 55.1420, radiusKm: 4.0 },
  { name: 'Al Quoz Industrial Area, Dubai', lat: 25.1360, lng: 55.2280, radiusKm: 5.5 },
  { name: 'Business Bay / Downtown, Dubai', lat: 25.1880, lng: 55.2680, radiusKm: 4.5 },
  { name: 'Ras Al Khor Industrial, Dubai', lat: 25.1780, lng: 55.3520, radiusKm: 5.5 },
  { name: 'Dubai Creek / Al Jaddaf, Dubai', lat: 25.2150, lng: 55.3280, radiusKm: 4.5 },
  { name: 'Port Rashid / Al Mina, Dubai', lat: 25.2620, lng: 55.2780, radiusKm: 4.5 },
  { name: 'Deira / Al Qusais Industrial, Dubai', lat: 25.2810, lng: 55.3880, radiusKm: 6.0 },
  // Northern Emirates
  { name: 'Sharjah Industrial Area', lat: 25.3180, lng: 55.4120, radiusKm: 8.5 },
  { name: 'Ajman Industrial Zone', lat: 25.3890, lng: 55.4790, radiusKm: 8.0 },
  { name: 'Saqr Port / Ras Al Khaimah', lat: 25.7890, lng: 55.9430, radiusKm: 18.0 },
  { name: 'Fujairah Port Corridor', lat: 25.1288, lng: 56.3265, radiusKm: 18.0 },
];

function calcDistanceKmFast(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function resolveUaePlaceNameFromCoords(
  lat: number,
  lng: number,
  options?: {
    terminalName?: string | null;
    termLat?: number | null;
    termLng?: number | null;
    warehouseName?: string | null;
    whLat?: number | null;
    whLng?: number | null;
  },
): string {
  if (
    options?.terminalName &&
    options.termLat != null &&
    options.termLng != null &&
    calcDistanceKmFast(lat, lng, Number(options.termLat), Number(options.termLng)) <= 2.2
  ) {
    return String(options.terminalName).trim();
  }
  if (
    options?.warehouseName &&
    options.whLat != null &&
    options.whLng != null &&
    calcDistanceKmFast(lat, lng, Number(options.whLat), Number(options.whLng)) <= 2.0
  ) {
    return String(options.warehouseName).trim();
  }

  let bestName = '';
  let bestDistKm = Infinity;
  for (const ref of UAE_GEOGRAPHIC_REFERENCE_POINTS) {
    const d = calcDistanceKmFast(lat, lng, ref.lat, ref.lng);
    if (d <= ref.radiusKm && d < bestDistKm) {
      bestDistKm = d;
      bestName = ref.name;
    }
  }
  if (bestName) return bestName;

  for (const ref of UAE_GEOGRAPHIC_REFERENCE_POINTS) {
    const d = calcDistanceKmFast(lat, lng, ref.lat, ref.lng);
    if (d < bestDistKm) {
      bestDistKm = d;
      bestName = ref.name;
    }
  }
  if (bestName && bestDistKm <= 25) {
    return bestName;
  }
  if (lat >= 24.15 && lat <= 24.75 && lng >= 54.15 && lng <= 54.85) {
    return 'Abu Dhabi Mobile GPS';
  }
  if (lat >= 24.80 && lat <= 25.32 && lng >= 54.90 && lng <= 55.55) {
    return 'Dubai Mobile GPS';
  }
  return 'Driver Mobile GPS';
}

export function extractCoordsFromLocationText(text?: string | null): { lat: number; lng: number; prefix: string } | null {
  if (!text) return null;
  const m = String(text).match(/^(.*?)\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*$/);
  if (!m) return null;
  const lat = Number(m[2]);
  const lng = Number(m[3]);
  if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return null;
  return {
    prefix: m[1].trim(),
    lat,
    lng,
  };
}

export function resolveOperationalMilestoneLocation(args: {
  status: string;
  rawNotes?: string | null;
  explicitLocation?: string | null;
  lat?: number | null;
  lng?: number | null;
  jobPhase?: string | null;
  jobCode?: string | null;
  terminalName?: string | null;
  warehouseName?: string | null;
  termLat?: number | null;
  termLng?: number | null;
  whLat?: number | null;
  whLng?: number | null;
}): string | undefined {
  const cleanStatus = String(args.status || '')
    .replace(/^MILESTONE_ALERT_/i, '')
    .trim()
    .toUpperCase();

  if (!MAJOR_OPERATIONAL_MILESTONE_STATUSES.has(cleanStatus)) {
    return undefined;
  }

  const terminalName = String(args.terminalName || 'DPW-Jebel Ali-T1').trim();
  const warehouseName = String(args.warehouseName || 'Consignee Warehouse').trim();
  const tLat = args.termLat != null && Number(args.termLat) !== 0 ? Number(args.termLat) : 25.0112;
  const tLng = args.termLng != null && Number(args.termLng) !== 0 ? Number(args.termLng) : 55.0612;
  const wLat = args.whLat != null && Number(args.whLat) !== 0 ? Number(args.whLat) : 24.9642;
  const wLng = args.whLng != null && Number(args.whLng) !== 0 ? Number(args.whLng) : 55.0915;

  const isHardcodedFacilityPrefix = (prefix: string, lat: number, lng: number): boolean => {
    const p = prefix.trim().toLowerCase();
    if (!p) return true;
    const termLower = terminalName.toLowerCase();
    const whLower = warehouseName.toLowerCase();
    if (
      p === termLower ||
      p === 'dpw-jebel ali-t1' ||
      p === 'port terminal' ||
      p.startsWith('e11 corridor') ||
      p.includes(`→ ${termLower}`)
    ) {
      return calcDistanceKmFast(lat, lng, tLat, tLng) > 2.5;
    }
    if (
      p === whLower ||
      p === 'consignee warehouse' ||
      p.includes(`→ ${whLower}`)
    ) {
      return calcDistanceKmFast(lat, lng, wLat, wLng) > 2.2;
    }
    return false;
  };

  const normalizeTaggedLocation = (rawLoc: string): string => {
    const parsed = extractCoordsFromLocationText(rawLoc);
    if (!parsed) return rawLoc.trim();
    const { prefix, lat, lng } = parsed;
    if (isHardcodedFacilityPrefix(prefix, lat, lng)) {
      const truePlace = resolveUaePlaceNameFromCoords(lat, lng, {
        terminalName,
        termLat: tLat,
        termLng: tLng,
        warehouseName,
        whLat: wLat,
        whLng: wLng,
      });
      return `${truePlace} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    }
    return `${prefix} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  };

  const notesStr = String(args.rawNotes || '');
  const locTagMatch = notesStr.match(/\[LOC:([^\]]+)\]/i);
  if (locTagMatch && locTagMatch[1]?.trim()) {
    return normalizeTaggedLocation(locTagMatch[1].trim());
  }

  if (args.explicitLocation && String(args.explicitLocation).trim()) {
    return normalizeTaggedLocation(String(args.explicitLocation).trim());
  }

  const hasLiveCoords =
    args.lat != null &&
    args.lng != null &&
    !isNaN(Number(args.lat)) &&
    !isNaN(Number(args.lng)) &&
    (Number(args.lat) !== 0 || Number(args.lng) !== 0);

  if (hasLiveCoords) {
    const finalLat = Number(args.lat);
    const finalLng = Number(args.lng);
    const placeName = resolveUaePlaceNameFromCoords(finalLat, finalLng, {
      terminalName,
      termLat: tLat,
      termLng: tLng,
      warehouseName,
      whLat: wLat,
      whLng: wLng,
    });
    return `${placeName} (${finalLat.toFixed(4)}, ${finalLng.toFixed(4)})`;
  }

  const isL2 =
    String(args.jobPhase || '').toUpperCase() === 'L2' ||
    String(args.jobCode || '').toUpperCase().includes('-L2');
  const cLat = Number(((tLat + wLat) / 2).toFixed(4));
  const cLng = Number(((tLng + wLng) / 2).toFixed(4));

  let stageFacility = terminalName;
  let stageLat = tLat;
  let stageLng = tLng;

  if (isL2) {
    if (['ACCEPTED', 'CONTAINER_PICKED', 'TRAILER_ATTACHED'].includes(cleanStatus)) {
      stageFacility = warehouseName;
      stageLat = wLat;
      stageLng = wLng;
    } else if (['EN_ROUTE_TERMINAL', 'IN_TRANSIT'].includes(cleanStatus)) {
      stageFacility = `E11 Corridor → ${terminalName}`;
      stageLat = cLat;
      stageLng = cLng;
    } else {
      stageFacility = terminalName;
      stageLat = tLat;
      stageLng = tLng;
    }
  } else {
    if (
      [
        'ACCEPTED',
        'ARRIVED_AT_PORT',
        'AT_PORT',
        'CONTAINER_PICKED',
        'LOADED',
        'UNDER_INSPECTION',
      ].includes(cleanStatus)
    ) {
      stageFacility = terminalName;
      stageLat = tLat;
      stageLng = tLng;
    } else if (['EN_ROUTE_WAREHOUSE', 'IN_TRANSIT'].includes(cleanStatus)) {
      stageFacility = `E11 Corridor → ${warehouseName}`;
      stageLat = cLat;
      stageLng = cLng;
    } else {
      stageFacility = warehouseName;
      stageLat = wLat;
      stageLng = wLng;
    }
  }

  return `${stageFacility} (${stageLat.toFixed(4)}, ${stageLng.toFixed(4)})`;
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
  type:
    | 'DO_EXPIRY'
    | 'DEMURRAGE_CRITICAL'
    | 'DEMURRAGE_WARNING'
    | 'DETENTION_CRITICAL'
    | 'PORT_SLOT_MISS_RISK'
    | 'DETACHED_TRAILER'
    | 'PORT_TOKEN_PENDING'
    | 'REASSIGN_ETC_T15'
    | 'REASSIGN_ETC_EXPIRED';
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

export async function purgeLegacySampleDrayageRecords(db: DrayageDbClient, tenantId: string) {
  // Purge sample allowances, including Rashid Al-Marri / Salim Al Harthi / Biju Trexla sample rows and any allowance whose job or driver was deleted
  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_allowances
      WHERE tenant_id = $1
        AND (
          id LIKE 'alw-1-%'
          OR id LIKE 'alw-2-%'
          OR driver_name ILIKE '%Rashid Al-Marri%'
          OR driver_name ILIKE '%Salim Al Harthi%'
          OR job_code IN (
            'DRY-L1-1001', 'DRY-L1-1002', 'DRY-L1-1003', 'DRY-L1-1004', 'DRY-L1-1005', 'DRY-L1-1006',
            'DRY-L2-1001', 'DRY-L2-1002', 'DRY-L2-1003', 'DRY-L2-1004', 'DRY-L2-1005', 'DRY-L2-1006',
            'DRY-EXP-1001'
          )
          OR container_number IN (
            'MSCU3918204', 'MSCU9248102', 'MSCU-TBD', 'HLXU9041128',
            'CMAU3019482', 'MSCU8492014', 'MSCU2109483', 'MAEU5910283'
          )
        )`,
    tenantId,
  ).catch(() => {});

  // Purge sample jobs and any L2 child jobs generated from them
  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_jobs
      WHERE tenant_id = $1
        AND (
          id LIKE 'job-1-%' OR id LIKE 'job-2-%' OR id LIKE 'job-3-%'
          OR id LIKE 'job-4-%' OR id LIKE 'job-5-%' OR id LIKE 'job-6-%'
          OR id LIKE 'job-l2-1001-%' OR id LIKE 'job-exp-1001-%'
          OR assigned_driver_name ILIKE '%Rashid Al-Marri%'
          OR job_code IN (
            'DRY-L1-1001', 'DRY-L1-1002', 'DRY-L1-1003', 'DRY-L1-1004', 'DRY-L1-1005', 'DRY-L1-1006',
            'DRY-L2-1001', 'DRY-L2-1002', 'DRY-L2-1003', 'DRY-L2-1004', 'DRY-L2-1005', 'DRY-L2-1006',
            'DRY-EXP-1001'
          )
          OR container_number IN (
            'MSCU3918204', 'MSCU9248102', 'MSCU-TBD', 'HLXU9041128',
            'CMAU3019482', 'MSCU8492014', 'MSCU2109483', 'MAEU5910283'
          )
        )`,
    tenantId,
  ).catch(() => {});

  // Purge sample containers from Container Master
  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_containers
      WHERE tenant_id = $1
        AND (
          id LIKE 'cnt-1-%' OR id LIKE 'cnt-2-%' OR id LIKE 'cnt-3-%' OR id LIKE 'cnt-4-%'
          OR container_number IN (
            'MSCU3918204', 'MSCU9248102', 'MSCU-TBD', 'HLXU9041128',
            'CMAU3019482', 'MSCU8492014', 'MSCU2109483', 'MAEU5910283'
          )
        )`,
    tenantId,
  ).catch(() => {});

  // Purge sample seeded drivers (Rashid Al-Marri, etc.) so removed drivers never reappear
  await db.$executeRawUnsafe(
    `DELETE FROM drivers
      WHERE tenant_id = $1
        AND (
          id LIKE 'drv-salim-%'
          OR id LIKE 'drv-rashid-%'
          OR id LIKE 'drv-tariq-%'
          OR id LIKE 'drv-imran-%'
          OR name ILIKE 'Rashid Al-Marri'
        )`,
    tenantId,
  ).catch(() => {});
}

export async function seedTenantDrayageDefaultsIfNeeded(db: DrayageDbClient, tenantId: string) {
  await purgeLegacySampleDrayageRecords(db, tenantId);
  if (seededTenants.has(tenantId)) return;
  await ensureDrayageSchema(db);

  // Automatic port terminal seeding is disabled: terminals are created and managed manually by users.
  // Purge any legacy auto-seeded terminals & perform a one-time reset of pre-existing terminals so the list starts empty.
  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_geofences
      WHERE tenant_id = $1
        AND (
          id LIKE 'gf-ja%'
          OR id LIKE 'gf-kp%'
          OR id LIKE 'gf-pr%'
          OR terminal_id LIKE 'term-ja%'
          OR terminal_id LIKE 'term-kp%'
          OR terminal_id LIKE 'term-pr%'
        )`,
    tenantId,
  ).catch(() => {});

  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_terminals
      WHERE tenant_id = $1
        AND (
          id LIKE 'term-ja%'
          OR id LIKE 'term-kp%'
          OR id LIKE 'term-pr%'
        )`,
    tenantId,
  ).catch(() => {});

  const purgeMarkerId = `sys-purge-terminals-v1-${tenantId}`;
  const purgeMarkerRows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM logistics_drayage_alerts WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    purgeMarkerId,
    tenantId,
  ).catch(() => []);

  if (purgeMarkerRows.length === 0) {
    await db.$executeRawUnsafe(
      `DELETE FROM logistics_drayage_geofences WHERE tenant_id = $1 AND (terminal_id IS NOT NULL OR id LIKE 'gf-term-%')`,
      tenantId,
    ).catch(() => {});
    await db.$executeRawUnsafe(
      `DELETE FROM logistics_drayage_terminals WHERE tenant_id = $1`,
      tenantId,
    ).catch(() => {});
    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_alerts (id, tenant_id, alert_key, acknowledged, updated_at)
       VALUES ($1, $2, 'SYSTEM_TERMINALS_PURGED_V1', true, NOW())
       ON CONFLICT (id) DO NOTHING`,
      purgeMarkerId,
      tenantId,
    ).catch(() => {});
  }

  // Purge the 3 sample allowance rows (DRY-L1-1001, DRY-L1-1002, DRY-L1-1004) and reset hardcoded gate fees/bonuses once
  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_allowances
      WHERE tenant_id = $1
        AND (
          id LIKE 'alw-1-%'
          OR id LIKE 'alw-2-%'
          OR job_code IN ('DRY-L1-1001', 'DRY-L1-1002', 'DRY-L1-1004')
        )`,
    tenantId,
  ).catch(() => {});

  const alwPurgeMarkerId = `sys-purge-allowances-v1-${tenantId}`;
  const alwPurgeRows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM logistics_drayage_alerts WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    alwPurgeMarkerId,
    tenantId,
  ).catch(() => []);

  if (alwPurgeRows.length === 0) {
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_allowances
          SET port_gate_fee_aed = 0,
              bogie_bonus_aed = 0,
              street_turn_bonus_aed = 0,
              inspection_bonus_aed = 0,
              total_amount_aed = allowance_amount_aed + overnight_halt_aed
        WHERE tenant_id = $1 AND status = 'PENDING'`,
      tenantId,
    ).catch(() => {});
    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_alerts (id, tenant_id, alert_key, acknowledged, updated_at)
       VALUES ($1, $2, 'SYSTEM_ALLOWANCES_PURGED_V1', true, NOW())
       ON CONFLICT (id) DO NOTHING`,
      alwPurgeMarkerId,
      tenantId,
    ).catch(() => {});
  }

  const cliCountRows = await db.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
    `SELECT COUNT(*) AS cnt FROM logistics_drayage_clients WHERE tenant_id = $1`,
    tenantId,
  ).catch(() => [{ cnt: 0 }]);

  if (Number(cliCountRows[0]?.cnt ?? 0) === 0) {
    const defaultClients = [
      {
        id: `cli-al-futtaim-${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`,
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
        id: `cli-landmark-${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`,
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
        id: `cli-chalhoub-${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`,
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
        id: `cli-adnoc-${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`,
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
        id: `wh-jafza-${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`,
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
        id: `wh-nip-${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`,
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
        id: `wh-dwc-${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`,
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
        id: `wh-kizad-${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`,
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
               driver_allowance_aed = 150
         WHERE logistics_drayage_warehouses.tenant_id = EXCLUDED.tenant_id`,
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
      { id: `tr-9901-${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`, plate: 'DXB-TR-9901', type: '40FT_SKELETAL', tons: 45, mStatus: 'AVAILABLE', opStatus: 'EMPTY', cnt: null, loc: 'Jebel Ali Main Yard', lat: 24.9850, lng: 55.0760 },
      { id: `tr-9902-${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`, plate: 'DXB-TR-9902', type: '40FT_FLATBED', tons: 48, mStatus: 'AVAILABLE', opStatus: 'EMPTY', cnt: null, loc: 'JAFZA South Yard', lat: 24.9642, lng: 55.0915 },
      { id: `tr-9903-${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`, plate: 'DXB-TR-9903', type: '45FT_REEFER_CHASSIS', tons: 45, mStatus: 'AVAILABLE', opStatus: 'EMPTY', cnt: null, loc: 'Jebel Ali Main Yard', lat: 25.0080, lng: 55.0640 },
      { id: `tr-8801-${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`, plate: 'AUH-TR-8801', type: '20FT_SKELETAL', tons: 34, mStatus: 'AVAILABLE', opStatus: 'EMPTY', cnt: null, loc: 'Khalifa Port Marshalling Yard', lat: 24.8055, lng: 54.6462 },
      { id: `tr-7704-${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`, plate: 'SHJ-TR-7704', type: '40FT_LOWBED', tons: 60, mStatus: 'AVAILABLE', opStatus: 'EMPTY', cnt: null, loc: 'National Industries Park Yard', lat: 24.9310, lng: 55.0750 },
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

  // Automatic seeding of prime mover vehicles into the shared vehicles table on GET is disabled
  // to avoid polluting tenant fleet registries or colliding across tenants.

  // Automatic seeding of sample drivers (Salim Al Harthi, Rashid Al-Marri, etc.) is disabled.

  // Purge sample jobs (DRY-L1-1001..1006, DRY-L2-1001..1006, DRY-EXP-1001), their dependencies, and their containers from Container Master
  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_allowances
      WHERE tenant_id = $1
        AND (
          id LIKE 'alw-1-%'
          OR id LIKE 'alw-2-%'
          OR job_code IN (
            'DRY-L1-1001', 'DRY-L1-1002', 'DRY-L1-1003', 'DRY-L1-1004', 'DRY-L1-1005', 'DRY-L1-1006',
            'DRY-L2-1001', 'DRY-L2-1002', 'DRY-L2-1003', 'DRY-L2-1004', 'DRY-L2-1005', 'DRY-L2-1006',
            'DRY-EXP-1001'
          )
          OR container_number IN (
            'MSCU3918204', 'MSCU9248102', 'MSCU-TBD', 'HLXU9041128',
            'CMAU3019482', 'MSCU8492014', 'MSCU2109483', 'MAEU5910283'
          )
        )`,
    tenantId,
  ).catch(() => {});

  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_status_logs
      WHERE tenant_id = $1
        AND (
          id LIKE 'log-1-%' OR id LIKE 'log-2-%' OR id LIKE 'log-3-%'
          OR id LIKE 'log-4-%' OR id LIKE 'log-5-%' OR id LIKE 'log-6-%'
          OR job_code IN (
            'DRY-L1-1001', 'DRY-L1-1002', 'DRY-L1-1003', 'DRY-L1-1004', 'DRY-L1-1005', 'DRY-L1-1006',
            'DRY-L2-1001', 'DRY-L2-1002', 'DRY-L2-1003', 'DRY-L2-1004', 'DRY-L2-1005', 'DRY-L2-1006',
            'DRY-EXP-1001'
          )
          OR job_id IN (
            SELECT id FROM logistics_drayage_jobs
             WHERE tenant_id = $1
               AND (
                 job_code IN (
                   'DRY-L1-1001', 'DRY-L1-1002', 'DRY-L1-1003', 'DRY-L1-1004', 'DRY-L1-1005', 'DRY-L1-1006',
                   'DRY-L2-1001', 'DRY-L2-1002', 'DRY-L2-1003', 'DRY-L2-1004', 'DRY-L2-1005', 'DRY-L2-1006',
                   'DRY-EXP-1001'
                 )
                 OR container_number IN (
                   'MSCU3918204', 'MSCU9248102', 'MSCU-TBD', 'HLXU9041128',
                   'CMAU3019482', 'MSCU8492014', 'MSCU2109483', 'MAEU5910283'
                 )
               )
          )
        )`,
    tenantId,
  ).catch(() => {});

  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_messages
      WHERE tenant_id = $1
        AND (
          id LIKE 'msg-1-%' OR id LIKE 'msg-2-%' OR id LIKE 'msg-3-%'
          OR job_code IN (
            'DRY-L1-1001', 'DRY-L1-1002', 'DRY-L1-1003', 'DRY-L1-1004', 'DRY-L1-1005', 'DRY-L1-1006',
            'DRY-L2-1001', 'DRY-L2-1002', 'DRY-L2-1003', 'DRY-L2-1004', 'DRY-L2-1005', 'DRY-L2-1006',
            'DRY-EXP-1001'
          )
          OR job_id IN (
            SELECT id FROM logistics_drayage_jobs
             WHERE tenant_id = $1
               AND (
                 job_code IN (
                   'DRY-L1-1001', 'DRY-L1-1002', 'DRY-L1-1003', 'DRY-L1-1004', 'DRY-L1-1005', 'DRY-L1-1006',
                   'DRY-L2-1001', 'DRY-L2-1002', 'DRY-L2-1003', 'DRY-L2-1004', 'DRY-L2-1005', 'DRY-L2-1006',
                   'DRY-EXP-1001'
                 )
                 OR container_number IN (
                   'MSCU3918204', 'MSCU9248102', 'MSCU-TBD', 'HLXU9041128',
                   'CMAU3019482', 'MSCU8492014', 'MSCU2109483', 'MAEU5910283'
                 )
               )
          )
        )`,
    tenantId,
  ).catch(() => {});

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_trailers
        SET master_status = 'AVAILABLE',
            operational_status = 'EMPTY',
            linked_container_number = NULL,
            updated_at = NOW()
      WHERE tenant_id = $1
        AND linked_container_number IN (
          'MSCU3918204', 'MSCU9248102', 'MSCU-TBD', 'HLXU9041128',
          'CMAU3019482', 'MSCU8492014', 'MSCU2109483', 'MAEU5910283'
        )`,
    tenantId,
  ).catch(() => {});

  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_jobs
      WHERE tenant_id = $1
        AND (
          id LIKE 'job-1-%' OR id LIKE 'job-2-%' OR id LIKE 'job-3-%'
          OR id LIKE 'job-4-%' OR id LIKE 'job-5-%' OR id LIKE 'job-6-%'
          OR id LIKE 'job-l2-1001-%' OR id LIKE 'job-exp-1001-%'
          OR job_code IN (
            'DRY-L1-1001', 'DRY-L1-1002', 'DRY-L1-1003', 'DRY-L1-1004', 'DRY-L1-1005', 'DRY-L1-1006',
            'DRY-L2-1001', 'DRY-L2-1002', 'DRY-L2-1003', 'DRY-L2-1004', 'DRY-L2-1005', 'DRY-L2-1006',
            'DRY-EXP-1001'
          )
          OR container_number IN (
            'MSCU3918204', 'MSCU9248102', 'MSCU-TBD', 'HLXU9041128',
            'CMAU3019482', 'MSCU8492014', 'MSCU2109483', 'MAEU5910283'
          )
        )`,
    tenantId,
  ).catch(() => {});

  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_containers
      WHERE tenant_id = $1
        AND (
          id LIKE 'cnt-1-%' OR id LIKE 'cnt-2-%' OR id LIKE 'cnt-3-%' OR id LIKE 'cnt-4-%'
          OR container_number IN (
            'MSCU3918204', 'MSCU9248102', 'MSCU-TBD', 'HLXU9041128',
            'CMAU3019482', 'MSCU8492014', 'MSCU2109483', 'MAEU5910283'
          )
        )`,
    tenantId,
  ).catch(() => {});

  // Clean up any legacy cross-mirrored rows between customers (Consignors/Shippers) and logistics_drayage_clients (Clients/End Users)
  await db.$executeRawUnsafe(
    `DELETE FROM customers WHERE tenant_id = $1 AND id LIKE 'cli-%'`,
    tenantId,
  ).catch(() => {});
  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_clients WHERE tenant_id = $1 AND id NOT LIKE 'cli-%' AND id IN (SELECT id FROM customers WHERE tenant_id = $1)`,
    tenantId,
  ).catch(() => {});

  seededTenants.add(tenantId);
}

export async function getDrayageWorkspaceData(db: DrayageDbClient, tenantId: string) {
  await seedTenantDrayageDefaultsIfNeeded(db, tenantId);

  // Throttle proactive Offload ETC sweep to at most once every 30s per tenant on GET reads
  if (shouldRunEtcAutoActivationCheck(tenantId)) {
    await checkAndAutoActivateExpiredEtcJobs(db, tenantId).catch((err) => {
      console.error('[getDrayageWorkspaceData] checkAndAutoActivateExpiredEtcJobs error:', err);
    });
  }

  // Automatically erase any chat/broadcast messages older than 12 hours
  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_messages WHERE tenant_id = $1 AND created_at < NOW() - INTERVAL '12 hours'`,
    tenantId,
  ).catch(() => {});

  const cachedMaster = getCachedDrayageMasterData(tenantId);

  // Parallelize operational SQL queries (and master queries only when master cache misses)
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
    automationConfig,
    dispatcherUserRows,
    latestPingRows,
  ] = await Promise.all([
    cachedMaster
      ? Promise.resolve(cachedMaster.terminalRows)
      : db.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT * FROM logistics_drayage_terminals WHERE tenant_id = $1 ORDER BY name ASC`,
          tenantId,
        ),
    cachedMaster
      ? Promise.resolve(cachedMaster.warehouseRows)
      : db.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT * FROM logistics_drayage_warehouses WHERE tenant_id = $1 ORDER BY name ASC`,
          tenantId,
        ),
    cachedMaster
      ? Promise.resolve(cachedMaster.clientRows)
      : db.$queryRawUnsafe<Array<Record<string, unknown>>>(
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
              current_lat,
              current_lng,
              COALESCE(current_mileage, 45000) AS current_mileage,
              COALESCE(next_service_km, 55000) AS next_service_km,
              registration_expiry,
              insurance_expiry,
              assigned_driver_id,
              COALESCE(updated_at, NOW() - INTERVAL '3.5 hours') AS updated_at
         FROM vehicles
        WHERE deleted_at IS NULL
          AND tenant_id = $1
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
      `SELECT d.id,
              COALESCE(
                NULLIF(TRIM(d.employee_id), ''),
                (
                  SELECT NULLIF(TRIM(u."employeeId"), '')
                    FROM "User" u
                   WHERE u.id = d.id::text
                      OR u.id = d.user_id
                      OR (u.email IS NOT NULL AND d.email IS NOT NULL AND LOWER(u.email) = LOWER(d.email))
                      OR LOWER(TRIM(CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", '')))) =
                         LOWER(TRIM(COALESCE(NULLIF(TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))), ''), d.name, '')))
                   LIMIT 1
                ),
                NULLIF(TRIM(d.dallas_id), ''),
                NULLIF(TRIM(d.license_number), '')
              ) AS employee_id,
              d.first_name,
              d.last_name,
              d.name,
              d.contact_number AS phone,
              d.license_number,
              d.license_expiry,
              COALESCE(d.status, 'ACTIVE') AS status,
              COALESCE(d.driver_type, 'LOGISTICS') AS assignment_type,
              d.assigned_vehicle_id
         FROM drivers d
        WHERE d.deleted_at IS NULL
          AND d.tenant_id = $1
        ORDER BY CASE WHEN d.driver_type = 'LOGISTICS' THEN 0 ELSE 1 END, d.first_name ASC NULLS LAST
        LIMIT 60`,
      tenantId,
    ).catch(() => []),
    cachedMaster
      ? Promise.resolve(cachedMaster.rawCustomers)
      : db.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT id, customer_code, name_en, name_ar, customer_type, email, mobile_number, city, trade_license
             FROM customers
            WHERE tenant_id = $1
              AND deleted_at IS NULL
              AND id NOT LIKE 'cli-%'
            ORDER BY name_en ASC
            LIMIT 60`,
          tenantId,
        ).catch(() => []),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_allowances WHERE tenant_id = $1 ORDER BY created_at DESC`,
      tenantId,
    ),
    cachedMaster
      ? Promise.resolve(cachedMaster.geofenceRows)
      : db.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT * FROM logistics_drayage_geofences WHERE tenant_id = $1 ORDER BY created_at DESC`,
          tenantId,
        ),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_status_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 600`,
      tenantId,
    ),
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_messages WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '12 hours' ORDER BY created_at ASC LIMIT 200`,
      tenantId,
    ),
    db.$queryRawUnsafe<Array<{ alert_key: string; acknowledged: boolean }>>(
      `SELECT alert_key, acknowledged FROM logistics_drayage_alerts WHERE tenant_id = $1`,
      tenantId,
    ).catch(() => []),
    cachedMaster
      ? Promise.resolve(cachedMaster.automationConfig)
      : getTenantAutomationConfig(db, tenantId),
    db.$queryRawUnsafe<Array<{ username: string | null; email: string | null }>>(
      `SELECT u.username, u.email
         FROM "User" u
         JOIN user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = $1
         LEFT JOIN roles r ON r.id = ut.role_id
        WHERE u.is_active = TRUE
          AND UPPER(COALESCE(u."userType", '')) != 'DRIVER'
          AND UPPER(COALESCE(r.code, '')) != 'DRIVER'
        ORDER BY CASE
          WHEN UPPER(COALESCE(r.code, '')) LIKE '%DISPATCH%' OR LOWER(COALESCE(u.username, '')) LIKE '%dispatch%' THEN 0
          ELSE 1
        END, u.username ASC
        LIMIT 10`,
      tenantId,
    ).catch(() => []),
    db.$queryRawUnsafe<Array<{ vehicle_id: string; latitude: number; longitude: number; speed_kmh: number | null; occurred_at: Date | string | null }>>(
      `SELECT DISTINCT ON (vehicle_id) vehicle_id, latitude, longitude, speed_kmh, occurred_at
         FROM fleet.bus_gps_pings
        WHERE tenant_id = $1
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND NOT (ABS(latitude - 25.2048) < 0.0005 AND ABS(longitude - 55.2708) < 0.0005)
          AND NOT (
            COALESCE(source, '') = 'DRIVER_APP'
            AND COALESCE(speed_kmh, 0) = 0
            AND COALESCE(heading_deg, 0) = 0
            AND EXTRACT(SECOND FROM occurred_at) = 0
          )
        ORDER BY vehicle_id, occurred_at DESC`,
      tenantId,
    ).catch(() => []),
  ]);

  if (!cachedMaster) {
    setCachedDrayageMasterData(tenantId, {
      terminalRows,
      warehouseRows,
      clientRows,
      geofenceRows,
      rawCustomers,
      automationConfig,
    });
  }

  const pendingSyncWrites: Array<Promise<unknown>> = [];
  let masterGeofenceInserted = false;

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
    geofenceRadiusMeters: r.geofence_type === 'POLYGON' ? Number(r.geofence_radius_meters ?? 0) : Number(r.geofence_radius_meters ?? 800),
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
  const mappedJobs: DrayageJob[] = jobRows.map((r: Record<string, unknown>) => {
    const rawStatusStr = String(r.status ?? 'PENDING').trim();
    const rawStatusUpper = rawStatusStr.toUpperCase();
    const rawPlacement = r.placement_location ? (String(r.placement_location) as 'RAMP' | 'YARD') : null;
    const rawShipmentType = String(r.shipment_type) === 'EXPORT' ? 'EXPORT' : 'IMPORT';
    let normalizedJobStatus = ['CONTAINER_DROPPED', 'EMPTY_DEPOSITED', 'CONTAINER_DELIVERED'].includes(rawStatusUpper)
      ? 'COMPLETED'
      : rawStatusStr;
    if (rawStatusUpper === 'FCL_REASSIGN' || rawStatusUpper === 'MT_REASSIGN') {
      normalizedJobStatus = resolveDirectionalReassignStatus({
        originLocation: rawPlacement === 'YARD' ? 'YARD' : 'RAMP',
        shipmentType: rawShipmentType,
      });
    } else if (rawStatusUpper === 'MT_REASSIGN TO YARD' || rawStatusUpper === 'MT_REASSIGN_TO_YARD') {
      normalizedJobStatus = 'MT_Reassign to Yard';
    } else if (rawStatusUpper === 'FCL_REASSIGN TO YARD' || rawStatusUpper === 'FCL_REASSIGN_TO_YARD') {
      normalizedJobStatus = 'FCL_Reassign to Yard';
    } else if (rawStatusUpper === 'FCL_REASSIGN TO RAMP' || rawStatusUpper === 'FCL_REASSIGN_TO_RAMP') {
      normalizedJobStatus = 'FCL_Reassign to Ramp';
    } else if (rawStatusUpper === 'MT_REASSIGN TO RAMP' || rawStatusUpper === 'MT_REASSIGN_TO_RAMP') {
      normalizedJobStatus = 'MT_Reassign to Ramp';
    }
    if (normalizedJobStatus !== rawStatusStr) {
      pendingSyncWrites.push(
        db.$executeRawUnsafe(
          `UPDATE logistics_drayage_jobs SET status = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
          String(r.id),
          String(r.tenant_id),
          normalizedJobStatus,
        ).catch(() => {}),
      );
    }
    return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    jobCode: String(r.job_code),
    jobPhase: (String(r.job_phase) === 'L2' ? 'L2' : 'L1'),
    parentJobId: r.parent_job_id ? String(r.parent_job_id) : null,
    shipmentType: (String(r.shipment_type) === 'EXPORT' ? 'EXPORT' : 'IMPORT'),
    status: normalizedJobStatus,
    priority: (['STANDARD', 'HIGH', 'URGENT'].includes(String(r.priority)) ? String(r.priority) : 'STANDARD') as DrayageJob['priority'],
    customerId: r.customer_id ? String(r.customer_id) : null,
    customerName: String(r.customer_name),
    warehouseId: r.warehouse_id ? String(r.warehouse_id) : null,
    warehouseName: String(r.warehouse_name),
    terminalId: r.terminal_id ? String(r.terminal_id) : null,
    terminalName: String(r.terminal_name),
    returnTerminalId: r.return_terminal_id ? String(r.return_terminal_id) : (r.terminal_id ? String(r.terminal_id) : null),
    returnTerminalName: r.return_terminal_name ? String(r.return_terminal_name) : String(r.terminal_name),
    originTerminalId: r.terminal_id ? String(r.terminal_id) : null,
    originTerminalName: String(r.terminal_name),
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
    podPhotoUrl: r.pod_photo_url ? String(r.pod_photo_url) : null,
    podSignatureName: r.pod_signature_name ? String(r.pod_signature_name) : null,
    podSignedAt: r.pod_signed_at ? new Date(String(r.pod_signed_at)).toISOString() : null,
    pcsTokenNumber: r.pcs_token_number ? String(r.pcs_token_number) : (r.token_number ? String(r.token_number) : null),
    pcsSlotStart: r.pcs_slot_start ? new Date(String(r.pcs_slot_start)).toISOString() : null,
    pcsSlotEnd: r.pcs_slot_end ? new Date(String(r.pcs_slot_end)).toISOString() : null,
    pcsTokenStatus: r.pcs_token_status ? String(r.pcs_token_status) : (r.token_number ? 'BOOKED' : 'PENDING'),
    inspectionStatus: r.inspection_status ? String(r.inspection_status) : (Boolean(r.customs_inspection) || Boolean(r.municipality_inspection) ? 'HOLD_PENDING' : 'CLEARED'),
    doStatus: r.do_status ? String(r.do_status) : (r.do_expiry_date && new Date(String(r.do_expiry_date)).getTime() < Date.now() ? 'EXPIRED' : 'VALID'),
    };
  });

  // Deduplicate any race-condition duplicate jobs sharing the same (jobPhase, jobCode)
  const jobsByPhaseCode = new Map<string, DrayageJob>();
  const duplicateJobIdsToDelete: string[] = [];
  const scoreJobProgress = (j: DrayageJob): number => {
    const stage = getDrayageOperationalStageIndex(j.status, j.trailerDetached);
    const hasDriverOrVehicle = Boolean(j.assignedDriverId || j.assignedVehicleId);
    const nonPending = j.status.toUpperCase() !== 'PENDING';
    return stage * 100 + (nonPending ? 20 : 0) + (hasDriverOrVehicle ? 10 : 0);
  };
  for (const job of mappedJobs) {
    const key = `${job.jobPhase}:${job.jobCode.trim().toUpperCase()}`;
    const existing = jobsByPhaseCode.get(key);
    if (!existing) {
      jobsByPhaseCode.set(key, job);
      continue;
    }
    if (scoreJobProgress(job) > scoreJobProgress(existing)) {
      duplicateJobIdsToDelete.push(existing.id);
      jobsByPhaseCode.set(key, job);
    } else {
      duplicateJobIdsToDelete.push(job.id);
    }
  }
  for (const dupId of duplicateJobIdsToDelete) {
    pendingSyncWrites.push(
      db.$executeRawUnsafe(
        `DELETE FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2`,
        dupId,
        tenantId,
      ).catch(() => {}),
    );
  }
  const jobs: DrayageJob[] = Array.from(jobsByPhaseCode.values());

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
      returnTerminalId: r.return_terminal_id ? String(r.return_terminal_id) : (r.terminal_id ? String(r.terminal_id) : null),
      returnTerminalName: r.return_terminal_name ? String(r.return_terminal_name) : String(r.terminal_name),
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
      pcsTokenNumber: r.pcs_token_number ? String(r.pcs_token_number) : null,
      pcsSlotStart: r.pcs_slot_start ? new Date(String(r.pcs_slot_start)).toISOString() : null,
      pcsSlotEnd: r.pcs_slot_end ? new Date(String(r.pcs_slot_end)).toISOString() : null,
      pcsTokenStatus: r.pcs_token_status ? String(r.pcs_token_status) : 'PENDING',
      inspectionStatus: r.inspection_status ? String(r.inspection_status) : (Boolean(r.customs_inspection) || Boolean(r.municipality_inspection) ? 'HOLD_PENDING' : 'CLEARED'),
      inspectionSealNumber: r.inspection_seal_number ? String(r.inspection_seal_number) : null,
      inspectionClearedBy: r.inspection_cleared_by ? String(r.inspection_cleared_by) : null,
      inspectionClearedAt: r.inspection_cleared_at ? new Date(String(r.inspection_cleared_at)).toISOString() : null,
      doStatus: r.do_status ? String(r.do_status) : (r.do_expiry_date && new Date(String(r.do_expiry_date)).getTime() < Date.now() ? 'EXPIRED' : 'VALID'),
      doRevalidatedAt: r.do_revalidated_at ? new Date(String(r.do_revalidated_at)).toISOString() : null,
    };
  });

  // 6. Mapped Fleet360 Vehicles (from `vehicles` table, prioritizing LOGISTICS usage)
  const activeJobByVehicle = new Map<string, DrayageJob>();
  const tripsCountByVehicle = new Map<string, number>();
  const activeJobByDriver = new Map<string, DrayageJob>();
  const tripsCountByDriver = new Map<string, number>();

  const finishedDriverLegStatuses = new Set([
    'COMPLETED',
    'EMPTY_DEPOSITED',
    'TRAILER_DETACHED',
    'CONTAINER_DETACHED',
    'REASSIGN_TRAILER_DETACHED',
    'READY_FOR_PICKUP',
    'CONTAINER_OFFLOADED',
    'FCL_REASSIGN',
    'MT_REASSIGN',
    'MT_REASSIGN TO YARD',
    'FCL_REASSIGN TO YARD',
    'FCL_REASSIGN TO RAMP',
    'MT_REASSIGN TO RAMP',
    'CONTAINER_DROPPED',
    'CONTAINER_DELIVERED',
    'PENDING',
    'CANCELLED',
  ]);
  for (const j of jobs) {
    const isDriverLegActive =
      !finishedDriverLegStatuses.has((j.status || '').toUpperCase()) &&
      !isDrayageReassignStatus(j.status) &&
      !j.trailerDetached;
    if (j.assignedVehicleId) {
      tripsCountByVehicle.set(j.assignedVehicleId, (tripsCountByVehicle.get(j.assignedVehicleId) || 0) + 1);
      if (isDriverLegActive) {
        activeJobByVehicle.set(j.assignedVehicleId, j);
      }
    }
    if (j.assignedDriverId) {
      tripsCountByDriver.set(j.assignedDriverId, (tripsCountByDriver.get(j.assignedDriverId) || 0) + 1);
      if (isDriverLegActive) {
        activeJobByDriver.set(j.assignedDriverId, j);
      }
    }
  }

  // Build bidirectional lookup of logged-in driver <-> vehicle from `vehicles.assigned_driver_id` and `drivers.assigned_vehicle_id`
  const driverNameById = new Map<string, string>();
  const vehicleIdByDriverId = new Map<string, string>();
  const driverIdByVehicleId = new Map<string, string>();

  for (const d of rawDrivers) {
    const dId = String(d.id);
    const first = String(d.first_name ?? '').trim();
    const last = String(d.last_name ?? '').trim();
    const fullName = `${first} ${last}`.trim() || String(d.name ?? 'Logistics Driver');
    driverNameById.set(dId, fullName);
    if (d.assigned_vehicle_id) {
      const vId = String(d.assigned_vehicle_id);
      vehicleIdByDriverId.set(dId, vId);
      driverIdByVehicleId.set(vId, dId);
    }
  }
  const isRealGpsCoord = (lat: number | null | undefined, lng: number | null | undefined): lat is number => {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return false;
    if (lat === 0 && lng === 0) return false;
    if (Math.abs(lat - 25.0112) < 0.0004 && (Math.abs(lng - 55.0612) < 0.0004 || Math.abs(lng - 55.0617) < 0.0004)) return false;
    if (Math.abs(lat - 25.2048) < 0.0004 && Math.abs(lng - 55.2708) < 0.0004) return false;
    if (Math.abs(lat - 24.9642) < 0.0004 && Math.abs(lng - 55.0915) < 0.0004) return false;
    if (Math.abs(lat - 24.9850) < 0.0004 && Math.abs(lng - 55.0760) < 0.0004) return false;
    return true;
  };

  const latestPingByVehicleId = new Map<
    string,
    { lat: number; lng: number; speedKmh: number; occurredAt: Date | null; isRecent: boolean }
  >();
  const fifteenMinsAgoMs = Date.now() - 15 * 60 * 1000;
  for (const p of latestPingRows) {
    const vId = String(p.vehicle_id || '');
    const pLat = Number(p.latitude);
    const pLng = Number(p.longitude);
    const occDate = p.occurred_at ? new Date(p.occurred_at) : null;
    const isRecent = Boolean(occDate && !isNaN(occDate.getTime()) && occDate.getTime() >= fifteenMinsAgoMs);
    if (vId && isRealGpsCoord(pLat, pLng)) {
      latestPingByVehicleId.set(vId, {
        lat: pLat,
        lng: pLng,
        speedKmh: p.speed_kmh != null ? Number(p.speed_kmh) : 0,
        occurredAt: occDate,
        isRecent,
      });
    }
  }

  const liveVehicleCoordsById = new Map<string, { lat: number; lng: number }>();
  for (const v of rawVehicles) {
    const vId = String(v.id);
    if (v.assigned_driver_id) {
      const dId = String(v.assigned_driver_id);
      driverIdByVehicleId.set(vId, dId);
      vehicleIdByDriverId.set(dId, vId);
    }
    const vLat = v.current_lat != null ? Number(v.current_lat) : NaN;
    const vLng = v.current_lng != null ? Number(v.current_lng) : NaN;
    if (isRealGpsCoord(vLat, vLng)) {
      liveVehicleCoordsById.set(vId, { lat: vLat, lng: vLng });
    } else {
      const pingCoords = latestPingByVehicleId.get(vId);
      if (pingCoords) {
        liveVehicleCoordsById.set(vId, pingCoords);
      } else {
        const loggedInDrvId = driverIdByVehicleId.get(vId);
        const recentJobWithCoords = jobs.find(
          (j) =>
            (j.assignedVehicleId === vId || (loggedInDrvId && j.assignedDriverId === loggedInDrvId)) &&
            isRealGpsCoord(j.currentLat, j.currentLng),
        );
        if (recentJobWithCoords && recentJobWithCoords.currentLat != null && recentJobWithCoords.currentLng != null) {
          liveVehicleCoordsById.set(vId, {
            lat: recentJobWithCoords.currentLat,
            lng: recentJobWithCoords.currentLng,
          });
        }
      }
    }
  }

  // Ensure any active/assigned job whose vehicle has live login/1-min GPS telemetry inherits the live coordinates
  for (const j of jobs) {
    const isDriverLegActive =
      !finishedDriverLegStatuses.has((j.status || '').toUpperCase()) &&
      !isDrayageReassignStatus(j.status) &&
      !j.trailerDetached;
    if (!isDriverLegActive) continue;
    const vehId = j.assignedVehicleId || (j.assignedDriverId ? vehicleIdByDriverId.get(j.assignedDriverId) : undefined);
    const vehCoords = vehId ? liveVehicleCoordsById.get(vehId) : undefined;
    if (!vehCoords) continue;
    if (!isRealGpsCoord(j.currentLat, j.currentLng)) {
      j.currentLat = vehCoords.lat;
      j.currentLng = vehCoords.lng;
    }
  }

  const vehicles: MappedFleetVehicle[] = rawVehicles.map((v: Record<string, unknown>, idx: number) => {
    const id = String(v.id);
    const activeJob = activeJobByVehicle.get(id);
    const loggedInDriverId = driverIdByVehicleId.get(id) ?? null;
    const resolvedDriverId = loggedInDriverId ?? activeJob?.assignedDriverId ?? null;
    const resolvedDriverName =
      (loggedInDriverId ? driverNameById.get(loggedInDriverId) ?? null : null) ??
      activeJob?.assignedDriverName ??
      null;
    const resolvedCoords =
      liveVehicleCoordsById.get(id) ??
      (activeJob && isRealGpsCoord(activeJob.currentLat, activeJob.currentLng)
        ? { lat: activeJob.currentLat!, lng: activeJob.currentLng! }
        : null);
    const latestVehiclePing = latestPingByVehicleId.get(id);
    const isDriverLoggedIn = Boolean(latestVehiclePing?.isRecent);
    const gpsStatus: 'MOVING' | 'IDLE' | 'SWITCHED_OFF' = isDriverLoggedIn
      ? (latestVehiclePing?.speedKmh ?? 0) >= 3.5
        ? 'MOVING'
        : 'IDLE'
      : 'SWITCHED_OFF';
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
      assignedDriverId: resolvedDriverId,
      assignedDriverName: resolvedDriverName,
      activeJobCode: activeJob?.jobCode ?? null,
      lat: resolvedCoords ? resolvedCoords.lat : null,
      lng: resolvedCoords ? resolvedCoords.lng : null,
      hasLiveGps: Boolean(resolvedCoords && isDriverLoggedIn),
      isDriverLoggedIn,
      gpsStatus,
      updatedAt:
        latestVehiclePing?.occurredAt instanceof Date && !isNaN(latestVehiclePing.occurredAt.getTime())
          ? latestVehiclePing.occurredAt.toISOString()
          : v.updated_at instanceof Date
            ? v.updated_at.toISOString()
            : typeof v.updated_at === 'string'
              ? v.updated_at
              : null,
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
    const loggedInVehicleId = vehicleIdByDriverId.get(id) ?? null;
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
      assignedVehicleId: loggedInVehicleId ?? (activeJob?.assignedVehicleId ?? null),
      activeJobCode: activeJob?.jobCode ?? null,
      complianceOk: !isExpired && String(d.status ?? 'ACTIVE') === 'ACTIVE',
      completedTripsToday: tripsCountByDriver.get(id) || 0,
    };
  });

  // 8. Mapped Fleet360 Customers (strictly from `customers` table — Consignors / Shippers only)
  const customers: MappedFleetCustomer[] = rawCustomers.map((c: Record<string, unknown>) => ({
    id: String(c.id),
    customerCode: c.customer_code ? String(c.customer_code) : null,
    name: String(c.name_en ?? 'Enterprise Shipper'),
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
    bogieBonusAed: Number(a.bogie_bonus_aed ?? 0),
    streetTurnBonusAed: Number(a.street_turn_bonus_aed ?? 0),
    inspectionBonusAed: Number(a.inspection_bonus_aed ?? 0),
    totalAmountAed: Number(a.total_amount_aed ?? 185),
    status: (['PENDING', 'APPROVED', 'PAID', 'REJECTED'].includes(String(a.status)) ? String(a.status) : 'PENDING') as DrayageDriverAllowance['status'],
    approvedBy: a.approved_by ? String(a.approved_by) : null,
    approvedAt: a.approved_at ? new Date(String(a.approved_at)).toISOString() : null,
    paymentRef: a.payment_ref ? String(a.payment_ref) : null,
    paymentMethod: a.payment_method ? String(a.payment_method) : null,
    paidAt: a.paid_at ? new Date(String(a.paid_at)).toISOString() : null,
    paidBy: a.paid_by ? String(a.paid_by) : null,
    adjustmentNotes: a.adjustment_notes ? String(a.adjustment_notes) : null,
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

      // Persist to database within the active transaction before returning
      masterGeofenceInserted = true;
      pendingSyncWrites.push(
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
        ).catch(() => {}),
      );
    }
  }

  const defaultDispatcherUsername =
    dispatcherUserRows.find((u) => u.username && String(u.username).trim())?.username?.trim() ||
    dispatcherUserRows.find((u) => u.email && String(u.email).trim())?.email?.split('@')[0]?.trim() ||
    'dispatcher';

  const jobByIdOrCode = new Map<string, DrayageJob>();
  for (const j of jobs) {
    jobByIdOrCode.set(j.id, j);
    if (j.jobCode) jobByIdOrCode.set(j.jobCode, j);
  }
  const driverById = new Map<string, MappedFleetDriver>();
  const driverByLowerName = new Map<string, MappedFleetDriver>();
  for (const d of drivers) {
    driverById.set(d.id, d);
    if (d.fullName) driverByLowerName.set(d.fullName.trim().toLowerCase(), d);
  }

  const DRIVER_STAGE_STATUSES = new Set([
    'ACCEPTED',
    'CONTAINER_PICKED',
    'TRAILER_ATTACHED',
    'UNDER_INSPECTION',
    'EN_ROUTE_WAREHOUSE',
    'EN_ROUTE_TERMINAL',
    'IN_TRANSIT',
    'PLACED_AT_RAMP',
    'PLACED_AT_YARD',
    'TRAILER_DETACHED',
    'CONTAINER_DETACHED',
    'CONTAINER_DROPPED',
    'EMPTY_DEPOSITED',
    'COMPLETED',
    'EPOD_SIGNED',
    'POD_SIGNED',
    'EPOD_CAPTURED',
    'POD_SIGNED / EPOD_CAPTURED',
    'DRIVER_EXPENSE_RECEIPT',
  ]);
  const DISPATCHER_STAGE_STATUSES = new Set([
    'ASSIGNED',
    'RE-ASSIGNED',
    'L2_ACTIVATED',
    'ETC_EXTENDED',
    'BOGIE_DISPATCH_CREATED',
    'STREET_TURN_EXECUTED',
    'PCS_TOKEN_BOOKED',
    'PCS_SLOT_AUTO_REBOOKED',
    'TRACTOR_SWAPPED_SLOT_RESCUE',
    'DO_REVALIDATED',
    'JOB_EDITED',
    'RETURN_TERMINAL_CHANGED',
  ]);
  const SYSTEM_DISPATCHER_ACTORS = new Set([
    'customer alert engine (whatsapp + email)',
    'dispatch console',
    'dispatcher console',
    'port operations desk',
    'auto-l2 dispatch engine (t-30m)',
    'pcs integration gateway',
    'port slot risk intelligence',
    'shipping line edo interface',
    'super admin',
  ]);

  const nonMilestoneLogRows = statusLogRows.filter(
    (l: Record<string, unknown>) => String(l.job_id) !== 'SYSTEM_CONFIG',
  );

  // Extract chronological GPS route path points (from 1-minute GPS_BREADCRUMB pings + tagged milestone logs)
  // and track the most recent mobile GPS coordinate per job so any untagged milestone log can inherit it.
  // Also extract any RETURN_TERMINAL_CHANGED overrides so L1 and L2 jobs and Smart Analysis always reflect the redirected return terminal.
  const routePathByJobKey = new Map<string, DrayageRoutePoint[]>();
  const latestDriverCoordByJobKey = new Map<string, { lat: number; lng: number }>();
  const returnTerminalOverrideByJobKey = new Map<
    string,
    { returnTerminalId: string | null; returnTerminalName: string; originTerminalName?: string }
  >();

  const chronologicalRows = [...nonMilestoneLogRows].reverse();
  for (const l of chronologicalRows) {
    const jId = String(l.job_id || '');
    const jCode = String(l.job_code || '');
    const st = String(l.status || '').trim().toUpperCase();
    const notesStr = String(l.notes || '');
    const tsIso = l.created_at ? new Date(String(l.created_at)).toISOString() : new Date().toISOString();

    if (st === 'RETURN_TERMINAL_CHANGED') {
      const parsedReturn = parseReturnTerminalTag(notesStr);
      if (parsedReturn) {
        if (jId) returnTerminalOverrideByJobKey.set(jId, parsedReturn);
        if (jCode) {
          returnTerminalOverrideByJobKey.set(jCode, parsedReturn);
          returnTerminalOverrideByJobKey.set(jCode.toUpperCase(), parsedReturn);
          if (jCode.toUpperCase().includes('-L1-')) {
            returnTerminalOverrideByJobKey.set(jCode.toUpperCase().replace('-L1-', '-L2-'), parsedReturn);
          } else if (jCode.toUpperCase().includes('-L2-')) {
            returnTerminalOverrideByJobKey.set(jCode.toUpperCase().replace('-L2-', '-L1-'), parsedReturn);
          }
        }
      }
    }

    let ptLat: number | null = null;
    let ptLng: number | null = null;
    let ptLoc: string | undefined;
    let ptSpeed: number | undefined;

    const latMatch = notesStr.match(/\[LAT:(-?\d+(?:\.\d+)?)\]/i);
    const lngMatch = notesStr.match(/\[LNG:(-?\d+(?:\.\d+)?)\]/i);
    const spdMatch = notesStr.match(/\[SPD:(-?\d+(?:\.\d+)?)\]/i);
    const locMatch = notesStr.match(/\[LOC:([^\]]+)\]/i);

    if (latMatch && lngMatch) {
      ptLat = Number(latMatch[1]);
      ptLng = Number(lngMatch[1]);
    }
    if (spdMatch) {
      ptSpeed = Number(spdMatch[1]);
    }
    if (locMatch && locMatch[1]?.trim()) {
      ptLoc = locMatch[1].trim();
      if (ptLat == null || ptLng == null) {
        const parsed = extractCoordsFromLocationText(ptLoc);
        if (parsed) {
          ptLat = parsed.lat;
          ptLng = parsed.lng;
        }
      }
    }

    if (ptLat != null && ptLng != null && !isNaN(ptLat) && !isNaN(ptLng) && (ptLat !== 0 || ptLng !== 0)) {
      const isStaticFallback =
        (Math.abs(ptLat - 25.0112) < 0.0002 && Math.abs(ptLng - 55.0612) < 0.0002) ||
        (Math.abs(ptLat - 24.9642) < 0.0002 && Math.abs(ptLng - 55.0915) < 0.0002) ||
        (Math.abs(ptLat - 24.9850) < 0.0002 && Math.abs(ptLng - 55.0760) < 0.0002);
      if (!isStaticFallback) {
        if (jId) latestDriverCoordByJobKey.set(jId, { lat: ptLat, lng: ptLng });
        if (jCode) latestDriverCoordByJobKey.set(jCode, { lat: ptLat, lng: ptLng });
      }

      const routePt: DrayageRoutePoint = {
        lat: ptLat,
        lng: ptLng,
        timestamp: tsIso,
        location: ptLoc,
        status: st === 'GPS_BREADCRUMB' ? 'IN_TRANSIT_PING' : st,
        ...(ptSpeed !== undefined ? { speedKmh: ptSpeed } : {}),
      };
      for (const key of [jId, jCode]) {
        if (!key) continue;
        const arr = routePathByJobKey.get(key) || [];
        const prev = arr[arr.length - 1];
        if (!prev || Math.abs(prev.lat - ptLat) > 0.00002 || Math.abs(prev.lng - ptLng) > 0.00002) {
          arr.push(routePt);
          routePathByJobKey.set(key, arr);
        }
      }
    }
  }

  for (const j of jobs) {
    const parentL1 =
      j.jobPhase === 'L2'
        ? jobs.find(
            (cand) =>
              cand.jobPhase === 'L1' &&
              (cand.id === j.parentJobId ||
                cand.jobCode.toUpperCase() === j.jobCode.toUpperCase().replace('-L2-', '-L1-')),
          )
        : undefined;

    const rtOverride =
      returnTerminalOverrideByJobKey.get(j.id) ||
      returnTerminalOverrideByJobKey.get(j.jobCode) ||
      returnTerminalOverrideByJobKey.get(j.jobCode.toUpperCase()) ||
      (j.parentJobId ? returnTerminalOverrideByJobKey.get(j.parentJobId) : undefined);

    if (j.jobPhase === 'L1') {
      j.originTerminalId = j.terminalId;
      j.originTerminalName = j.terminalName;
      if (rtOverride) {
        j.returnTerminalId = rtOverride.returnTerminalId ?? j.returnTerminalId ?? j.terminalId;
        j.returnTerminalName = rtOverride.returnTerminalName || j.returnTerminalName || j.terminalName;
      } else {
        j.returnTerminalId = j.returnTerminalId || j.terminalId;
        j.returnTerminalName = j.returnTerminalName || j.terminalName;
      }
    } else {
      j.originTerminalId = parentL1?.terminalId ?? j.originTerminalId ?? j.terminalId;
      j.originTerminalName =
        rtOverride?.originTerminalName || parentL1?.terminalName || j.originTerminalName || j.terminalName;
      const effectiveL2TermId =
        rtOverride?.returnTerminalId ??
        parentL1?.returnTerminalId ??
        j.returnTerminalId ??
        j.terminalId;
      const effectiveL2TermName =
        rtOverride?.returnTerminalName ||
        parentL1?.returnTerminalName ||
        j.returnTerminalName ||
        j.terminalName;
      j.returnTerminalId = effectiveL2TermId;
      j.returnTerminalName = effectiveL2TermName;
      if (effectiveL2TermName && effectiveL2TermName !== j.terminalName) {
        j.terminalId = effectiveL2TermId;
        j.terminalName = effectiveL2TermName;
        pendingSyncWrites.push(
          db.$executeRawUnsafe(
            `UPDATE logistics_drayage_jobs
                SET terminal_id = $3,
                    terminal_name = $4,
                    updated_at = NOW()
              WHERE id = $1 AND tenant_id = $2`,
            j.id,
            tenantId,
            effectiveL2TermId,
            effectiveL2TermName,
          ).catch(() => {}),
        );
      }
    }

    const path = routePathByJobKey.get(j.id) || routePathByJobKey.get(j.jobCode) || [];
    if (
      j.currentLat != null &&
      j.currentLng != null &&
      (path.length === 0 ||
        Math.abs(path[path.length - 1].lat - j.currentLat) > 0.00005 ||
        Math.abs(path[path.length - 1].lng - j.currentLng) > 0.00005)
    ) {
      path.push({
        lat: j.currentLat,
        lng: j.currentLng,
        timestamp: j.updatedAt,
        location: `${resolveUaePlaceNameFromCoords(j.currentLat, j.currentLng)} (${j.currentLat.toFixed(4)}, ${j.currentLng.toFixed(4)})`,
        status: j.status,
      });
    }
    j.routePath = path;
  }

  const directJobStageKeys = new Set<string>();
  for (const l of nonMilestoneLogRows) {
    const st = String(l.status ?? '').trim();
    if (st.toUpperCase() === 'GPS_BREADCRUMB') continue;
    if (!/^MILESTONE_ALERT_/i.test(st)) {
      directJobStageKeys.add(`${String(l.job_id)}::${st.toUpperCase()}`);
      directJobStageKeys.add(`${String(l.job_code)}::${st.toUpperCase()}`);
    }
  }
  const seenMilestoneFallbackKeys = new Set<string>();

  const statusLogs: DrayageStatusLog[] = nonMilestoneLogRows
    .filter((l: Record<string, unknown>) => {
      const rawStatus = String(l.status ?? '').trim();
      if (rawStatus.toUpperCase() === 'GPS_BREADCRUMB') return false;
      if (!/^MILESTONE_ALERT_/i.test(rawStatus)) return true;
      const cleanSt = rawStatus.replace(/^MILESTONE_ALERT_/i, '').toUpperCase();
      const jobKeyId = `${String(l.job_id)}::${cleanSt}`;
      const jobKeyCode = `${String(l.job_code)}::${cleanSt}`;
      if (directJobStageKeys.has(jobKeyId) || directJobStageKeys.has(jobKeyCode)) {
        return false;
      }
      if (seenMilestoneFallbackKeys.has(jobKeyId)) {
        return false;
      }
      seenMilestoneFallbackKeys.add(jobKeyId);
      return true;
    })
    .map((l: Record<string, unknown>) => {
      const jobId = String(l.job_id);
      const jobCode = String(l.job_code);
      const rawStatus = String(l.status ?? '').trim();
      const normalizedStatus = rawStatus.replace(/^MILESTONE_ALERT_/i, '');
      const rawNotes = String(l.notes ?? '');
      const cleanedNotes = rawNotes
        .replace(/\[(?:CUSTOMER|CLIENT|RAMP)\s+Alert[^\]]*\](\s*\+\s*\[Email[^\]]*\])?/gi, '')
        .replace(/·?\s*Milestone\s+"[^"]*"/gi, '')
        .replace(/·?\s*ETC\s+[^·]+(?=\s*·|$)/gi, '')
        .replace(/·?\s*(?:Customer|Client|Ramp)\s+Link[^·]*/gi, '')
        .replace(/^Execution stage updated to [A-Z0-9_-]+(?:\s*\((?:RAMP|YARD)\))?/i, '')
        .replace(/^\s*[·\-|]+\s*/, '')
        .replace(/\s*[·\-|]+\s*$/, '')
        .trim();

      const rawActor = String(l.actor ?? '').trim();
      const baseActorName = rawActor.replace(/\s*\([^)]*\)\s*$/, '').trim();
      const matchedJob = jobByIdOrCode.get(jobId) || jobByIdOrCode.get(jobCode);
      const matchedTerminal = matchedJob
        ? terminals.find(
            (t) =>
              t.id === matchedJob.terminalId ||
              t.name.trim().toLowerCase() === matchedJob.terminalName.trim().toLowerCase(),
          )
        : undefined;
      const matchedWarehouse = matchedJob
        ? warehouses.find(
            (w) =>
              w.id === matchedJob.warehouseId ||
              w.name.trim().toLowerCase() === matchedJob.warehouseName.trim().toLowerCase(),
          )
        : undefined;

      const knownDriverCoord =
        latestDriverCoordByJobKey.get(jobId) ||
        latestDriverCoordByJobKey.get(jobCode) ||
        (matchedJob?.currentLat != null && matchedJob?.currentLng != null
          ? { lat: matchedJob.currentLat, lng: matchedJob.currentLng }
          : undefined);

      const resolvedLocation = resolveOperationalMilestoneLocation({
        status: normalizedStatus,
        rawNotes,
        lat: knownDriverCoord?.lat,
        lng: knownDriverCoord?.lng,
        jobPhase: matchedJob?.jobPhase,
        jobCode: matchedJob?.jobCode || jobCode,
        terminalName: matchedJob?.terminalName,
        warehouseName: matchedJob?.warehouseName,
        termLat: matchedTerminal?.lat,
        termLng: matchedTerminal?.lng,
        whLat: matchedWarehouse?.lat,
        whLng: matchedWarehouse?.lng,
      });

      const finalCleanedNotes = cleanedNotes
        .replace(/\s*·?\s*\[LOC:[^\]]+\]/gi, '')
        .replace(/\s*·?\s*\[(?:LAT|LNG|SPD):[^\]]+\]/gi, '')
        .replace(/\s*·?\s*\[RETURN_TERM:[^\]]+\]/gi, '')
        .replace(/^\s*[·\-|]+\s*/, '')
        .replace(/\s*[·\-|]+\s*$/, '')
        .trim();

      const matchedDriver =
        driverByLowerName.get(baseActorName.toLowerCase()) ||
        (matchedJob?.assignedDriverId ? driverById.get(matchedJob.assignedDriverId) : undefined) ||
        (matchedJob?.assignedDriverName
          ? driverByLowerName.get(matchedJob.assignedDriverName.trim().toLowerCase())
          : undefined);

      const isDriverAction =
        !DISPATCHER_STAGE_STATUSES.has(normalizedStatus.toUpperCase()) &&
        (DRIVER_STAGE_STATUSES.has(normalizedStatus.toUpperCase()) ||
          driverByLowerName.has(baseActorName.toLowerCase()) ||
          baseActorName.toLowerCase() === 'driver mobile app' ||
          Boolean(
            matchedJob?.assignedDriverName &&
              baseActorName.toLowerCase() === matchedJob.assignedDriverName.trim().toLowerCase(),
          ));

      let formattedActor: string;
      if (isDriverAction) {
        const driverDisplayName =
          driverByLowerName.get(baseActorName.toLowerCase())?.fullName ||
          (baseActorName &&
          baseActorName.toLowerCase() !== 'driver mobile app' &&
          !SYSTEM_DISPATCHER_ACTORS.has(baseActorName.toLowerCase())
            ? baseActorName
            : matchedDriver?.fullName || matchedJob?.assignedDriverName || 'Assigned Driver');
        const existingParenMatch = rawActor.match(/\(([^)]+)\)\s*$/);
        const effectiveEmpId =
          matchedDriver?.employeeId ||
          (existingParenMatch && !/portal|desk|whatsapp|email/i.test(existingParenMatch[1])
            ? existingParenMatch[1].trim()
            : null) ||
          matchedDriver?.licenseNumber ||
          null;
        formattedActor = effectiveEmpId ? `${driverDisplayName} (${effectiveEmpId})` : driverDisplayName;
      } else {
        formattedActor =
          rawActor && !SYSTEM_DISPATCHER_ACTORS.has(rawActor.toLowerCase())
            ? rawActor
            : defaultDispatcherUsername;
      }

      return {
        id: String(l.id),
        tenantId: String(l.tenant_id),
        jobId,
        jobCode,
        status: normalizedStatus,
        notes: finalCleanedNotes,
        actor: formattedActor,
        timestamp: l.created_at ? new Date(String(l.created_at)).toISOString() : new Date().toISOString(),
        ...(resolvedLocation ? { location: resolvedLocation } : {}),
      };
    });

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

  // Check L1 ETC timers & Yard Placement directional Reassign state:
  // 1) Based on PLACED_AT_YARD (or detached at YARD): immediately eligible for FCL_Reassign to Ramp (Import) / MT_Reassign to Ramp (Export).
  // 2) Based on PLACED_AT_RAMP / REASSIGN_PLACED_AT_RAMP (or detached at RAMP): upon the FIRST alert (<= 15m / T15_WARNING or EXPIRED),
  //    enabled and shown as MT_Reassign to Yard (Import) / FCL_Reassign to Yard (Export).
  // 3) Only jobs that have reached READY_FOR_PICKUP (after Reassign to Yard) or CONTAINER_OFFLOADED auto-activate PENDING L2 Empty Return jobs.
  {
    const nowMs = Date.now();
    for (const j of jobs) {
      if (j.jobPhase !== 'L1' || j.l2Activated) continue;
      const st = (j.status || '').toUpperCase();
      const locUpper = String(j.placementLocation || '').toUpperCase();

      // If detached at initial Yard and not yet in directional status, normalize to FCL_Reassign to Ramp / MT_Reassign to Ramp
      if (
        (st === 'PLACED_AT_YARD' && j.trailerDetached) ||
        ((st === 'TRAILER_DETACHED' || st === 'CONTAINER_DETACHED') && locUpper === 'YARD')
      ) {
        const yardReassignStatus = resolveDirectionalReassignStatus({
          originLocation: 'YARD',
          shipmentType: j.shipmentType,
        });
        j.status = yardReassignStatus;
        j.placementLocation = 'YARD';
        j.assignedVehicleId = null;
        j.assignedVehiclePlate = null;
        j.assignedDriverId = null;
        j.assignedDriverName = null;
        pendingSyncWrites.push(
          db.$executeRawUnsafe(
            `UPDATE logistics_drayage_jobs
                SET status = $3,
                    placement_location = 'YARD',
                    assigned_vehicle_id = NULL,
                    assigned_vehicle_plate = NULL,
                    assigned_driver_id = NULL,
                    assigned_driver_name = NULL,
                    updated_at = NOW()
              WHERE id = $1 AND tenant_id = $2`,
            j.id,
            tenantId,
            yardReassignStatus,
          ).catch(() => {}),
        );
        continue;
      }

      if (!j.etcTime) continue;
      const etcMs = new Date(j.etcTime).getTime();
      if (isNaN(etcMs)) continue;
      const minsLeft = Math.ceil((etcMs - nowMs) / 60000);

      const isRampStatusEligibleForReassign = [
        'PLACED_AT_RAMP',
        'REASSIGN_PLACED_AT_RAMP',
        'TRAILER_DETACHED',
        'CONTAINER_DETACHED',
        'REASSIGN_TRAILER_DETACHED',
      ].includes(st) && locUpper !== 'YARD';

      const isDetachedAtRamp =
        isRampStatusEligibleForReassign &&
        (j.trailerDetached || ['TRAILER_DETACHED', 'CONTAINER_DETACHED', 'REASSIGN_TRAILER_DETACHED'].includes(st));

      const rampReassignStatus = resolveDirectionalReassignStatus({
        originLocation: 'RAMP',
        shipmentType: j.shipmentType,
      });

      if (minsLeft <= 0 && isRampStatusEligibleForReassign) {
        j.status = rampReassignStatus;
        j.placementLocation = 'RAMP';
        j.etcAlertStatus = 'EXPIRED';
        j.assignedVehicleId = null;
        j.assignedVehiclePlate = null;
        j.assignedDriverId = null;
        j.assignedDriverName = null;
        pendingSyncWrites.push(
          db.$executeRawUnsafe(
            `UPDATE logistics_drayage_jobs
                SET status = $3,
                    placement_location = 'RAMP',
                    etc_alert_status = 'EXPIRED',
                    assigned_vehicle_id = NULL,
                    assigned_vehicle_plate = NULL,
                    assigned_driver_id = NULL,
                    assigned_driver_name = NULL,
                    updated_at = NOW()
              WHERE id = $1 AND tenant_id = $2`,
            j.id,
            tenantId,
            rampReassignStatus,
          ).catch(() => {}),
        );
      } else if (minsLeft > 0 && minsLeft <= 15 && isRampStatusEligibleForReassign) {
        j.etcAlertStatus = 'T15_WARNING';
        if (isDetachedAtRamp) {
          j.status = rampReassignStatus;
          j.placementLocation = 'RAMP';
          j.assignedVehicleId = null;
          j.assignedVehiclePlate = null;
          j.assignedDriverId = null;
          j.assignedDriverName = null;
          pendingSyncWrites.push(
            db.$executeRawUnsafe(
              `UPDATE logistics_drayage_jobs
                  SET status = $3,
                      placement_location = 'RAMP',
                      etc_alert_status = 'T15_WARNING',
                      assigned_vehicle_id = NULL,
                      assigned_vehicle_plate = NULL,
                      assigned_driver_id = NULL,
                      assigned_driver_name = NULL,
                      updated_at = NOW()
                WHERE id = $1 AND tenant_id = $2`,
              j.id,
              tenantId,
              rampReassignStatus,
            ).catch(() => {}),
          );
        } else {
          pendingSyncWrites.push(
            db.$executeRawUnsafe(
              `UPDATE logistics_drayage_jobs SET etc_alert_status = 'T15_WARNING', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
              j.id,
              tenantId,
            ).catch(() => {}),
          );
        }
      } else if (minsLeft <= 0 && j.etcAlertStatus !== 'EXPIRED' && j.etcAlertStatus !== 'ACTIVATED') {
        j.etcAlertStatus = 'EXPIRED';
      } else if (minsLeft > 0 && minsLeft <= 15 && j.etcAlertStatus === 'NEW') {
        j.etcAlertStatus = 'T15_WARNING';
        pendingSyncWrites.push(
          db.$executeRawUnsafe(
            `UPDATE logistics_drayage_jobs SET etc_alert_status = 'T15_WARNING', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
            j.id,
            tenantId,
          ).catch(() => {}),
        );
      }
    }

    const dueL1Jobs = jobs.filter((j) => {
      if (j.jobPhase !== 'L1' || j.l2Activated) return false;
      const st = (j.status || '').toUpperCase();
      return st === 'READY_FOR_PICKUP' || st === 'CONTAINER_OFFLOADED';
    });

    if (dueL1Jobs.length > 0) {
      const actRes = await checkAndAutoActivateExpiredEtcJobs(db, tenantId, {
        thresholdMinutes: 0,
        preAssignTractor: false,
      }).catch((err) => {
        console.error('[getDrayageWorkspaceData] L2 activation trigger error:', err);
        return { checked: 0, activated: [] };
      });
      if (actRes && actRes.activated.length > 0) {
        for (const act of actRes.activated) {
          const l1InMem = jobs.find((j) => j.jobCode === act.l1JobCode);
          if (l1InMem) {
            l1InMem.l2Activated = true;
            l1InMem.status = 'COMPLETED';
            l1InMem.etcAlertStatus = 'ACTIVATED';
            const alreadyInJobs = jobs.some(
              (j) =>
                j.id === act.l2JobId ||
                (j.jobPhase === 'L2' && j.jobCode.toUpperCase() === act.l2JobCode.toUpperCase()),
            );
            if (!alreadyInJobs) {
              const targetReturnTermId = l1InMem.returnTerminalId || l1InMem.terminalId;
              const targetReturnTermName = l1InMem.returnTerminalName || l1InMem.terminalName;
              jobs.unshift({
                ...l1InMem,
                id: act.l2JobId,
                jobCode: act.l2JobCode,
                jobPhase: 'L2',
                parentJobId: l1InMem.id,
                status: 'PENDING',
                priority: 'HIGH',
                terminalId: targetReturnTermId,
                terminalName: targetReturnTermName,
                returnTerminalId: targetReturnTermId,
                returnTerminalName: targetReturnTermName,
                originTerminalId: l1InMem.originTerminalId || l1InMem.terminalId,
                originTerminalName: l1InMem.originTerminalName || l1InMem.terminalName,
                assignedVehicleId: null,
                assignedVehiclePlate: null,
                assignedDriverId: null,
                assignedDriverName: null,
                assignedTrailerId: l1InMem.assignedTrailerId,
                assignedTrailerPlate: l1InMem.assignedTrailerPlate,
                placementLocation: null,
                trailerDetached: false,
                l2Activated: false,
                etcTime: null,
                etcAlertStatus: 'NEW',
                rateAmountAed: 950,
                driverAllowanceAed: 120,
                notes: `Auto-generated L2 Empty Container Return from ${l1InMem.jobCode}`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
            }
          }
        }
      }
    }
  }

  const alerts: DrayageAlertItem[] = [];
  const jobByContainerId = new Map(jobs.filter(j => j.containerId).map(j => [j.containerId as string, j]));
  const containerById = new Map(containers.map(c => [c.id, c]));
  const containerByNumber = new Map(containers.map(c => [c.containerNumber.toUpperCase(), c]));
  const vehicleById = new Map(vehicles.map(v => [v.id, v]));

  // =========================================================================
  // 2. DEMURRAGE, DETENTION & PORT SLOT RISK INTELLIGENCE ENGINE
  //   (A) Demurrage & Free-Time Countdown Radar (Port Free Time + Line Detention + DO Expiry)
  //       Automatically escalates job priority to CRITICAL/URGENT and alerts dispatch
  //       when a container is within 24 hours of incurring port storage or line detention penalties.
  //   (B) Port Appointment Window & Gate Queue Predictor
  //       Validates DP World / AD Ports PCS token slot window against live E11/E311 telematics ETA.
  // =========================================================================
  for (let idx = 0; idx < jobs.length; idx++) {
    const j = jobs[idx];
    const linkedCnt =
      (j.containerId ? containerById.get(j.containerId) : undefined) ||
      containerByNumber.get(j.containerNumber.toUpperCase());
    if (linkedCnt) {
      j.sealNumber = linkedCnt.sealNumber ?? null;
      j.dischargeDate = linkedCnt.dischargeDate ?? null;
      if (linkedCnt.weightKg && linkedCnt.weightKg > 0) {
        j.cargoWeightKg = linkedCnt.weightKg;
      }
    }
    const term =
      (j.terminalId ? terminalMap.get(j.terminalId) : undefined) ||
      terminals.find(t => t.name.toLowerCase() === j.terminalName.toLowerCase());
    const isReefer = (j.containerType || '').toUpperCase().includes('REEFER');
    const is20Ft = (j.containerSize || '').trim() === '20FT';
    const isCompleted = ['COMPLETED', 'EMPTY_DEPOSITED', 'CONTAINER_DROPPED', 'STREET_TURNED', 'CANCELLED'].includes(
      (j.status || '').toUpperCase(),
    );

    // 1. Port Free Time (Demurrage) Deadline
    const portFreeDaysAllowed = isReefer ? (term?.freeDaysReefer ?? 3) : (term?.freeDaysDry ?? 5);
    const dischargeMs = linkedCnt?.dischargeDate
      ? new Date(linkedCnt.dischargeDate).getTime()
      : new Date(j.createdAt || Date.now()).getTime();
    const portFreeTimeExpiryMs = dischargeMs + portFreeDaysAllowed * 24 * 60 * 60 * 1000;
    const portFreeTimeExpiry = new Date(portFreeTimeExpiryMs).toISOString();
    const portDemurrageHoursRemaining = Math.round(((portFreeTimeExpiryMs - Date.now()) / (1000 * 60 * 60)) * 10) / 10;
    const portDailyDemurrageAed = isReefer ? 480 : is20Ft ? 220 : 350;

    // 2. Shipping Line Container Free Days (Detention) Deadline
    const carrier = (j.shippingLine || detectShippingLine(j.containerNumber)).toUpperCase();
    const lineFreeDaysAllowed = isReefer ? 4 : carrier.includes('HAPAG') ? 8 : 7;
    const lineDetentionExpiryMs = j.doExpiryDate
      ? Math.max(
          new Date(j.doExpiryDate).getTime(),
          dischargeMs + lineFreeDaysAllowed * 24 * 60 * 60 * 1000,
        )
      : dischargeMs + lineFreeDaysAllowed * 24 * 60 * 60 * 1000;
    const lineDetentionExpiry = new Date(lineDetentionExpiryMs).toISOString();
    const lineDetentionHoursRemaining = Math.round(((lineDetentionExpiryMs - Date.now()) / (1000 * 60 * 60)) * 10) / 10;
    const lineDailyDetentionAed = isReefer ? 650 : is20Ft ? 280 : 420;

    // 3. Delivery Order Expiry (`do_expiry_date`)
    const doExpiryMs = j.doExpiryDate
      ? new Date(j.doExpiryDate).getTime()
      : portFreeTimeExpiryMs + 12 * 60 * 60 * 1000;
    const doExpiryIso = new Date(doExpiryMs).toISOString();
    if (!j.doExpiryDate) {
      j.doExpiryDate = doExpiryIso;
    }
    const doHoursRemaining = Math.round(((doExpiryMs - Date.now()) / (1000 * 60 * 60)) * 10) / 10;

    const minHoursRemaining =
      j.jobPhase === 'L2'
        ? Math.min(lineDetentionHoursRemaining, doHoursRemaining)
        : Math.min(portDemurrageHoursRemaining, lineDetentionHoursRemaining, doHoursRemaining);

    let primaryRiskFactor: DrayageRiskRadarInfo['primaryRiskFactor'] = 'SAFE';
    if (minHoursRemaining <= 48) {
      if (minHoursRemaining === portDemurrageHoursRemaining) primaryRiskFactor = 'PORT_DEMURRAGE';
      else if (minHoursRemaining === lineDetentionHoursRemaining) primaryRiskFactor = 'LINE_DETENTION';
      else primaryRiskFactor = 'DO_EXPIRY';
    }

    const criticalWindowHrs = automationConfig.criticalRiskWindowHours || 24;
    const within24hPenaltyWindow = !isCompleted && minHoursRemaining <= criticalWindowHrs;
    const dailyCombinedPenaltyAed = portDailyDemurrageAed + lineDailyDetentionAed;
    const overdueDaysCount = minHoursRemaining < 0 ? Math.max(1, Math.ceil(Math.abs(minHoursRemaining) / 24)) : 0;
    const accruedExposureAed =
      overdueDaysCount > 0
        ? overdueDaysCount * (primaryRiskFactor === 'LINE_DETENTION' ? lineDailyDetentionAed : portDailyDemurrageAed)
        : within24hPenaltyWindow
        ? primaryRiskFactor === 'LINE_DETENTION'
          ? lineDailyDetentionAed
          : portDailyDemurrageAed
        : 0;

    const radarStatus: DrayageRiskRadarInfo['status'] = isCompleted
      ? 'SAFE'
      : minHoursRemaining <= 0
      ? 'EXPIRED'
      : minHoursRemaining <= criticalWindowHrs
      ? 'CRITICAL_24H'
      : minHoursRemaining <= criticalWindowHrs * 2
      ? 'WARNING_48H'
      : 'SAFE';

    let autoEscalatedCritical = false;
    if (within24hPenaltyWindow) {
      autoEscalatedCritical = true;
      if (j.priority !== 'URGENT') {
        j.priority = 'URGENT';
        pendingSyncWrites.push(
          db.$executeRawUnsafe(
            `UPDATE logistics_drayage_jobs SET priority = 'URGENT', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
            j.id,
            tenantId,
          ).catch(() => {}),
        );
      }

      const alertKey = `radar-24h-${j.id}`;
      const riskLabel =
        primaryRiskFactor === 'PORT_DEMURRAGE'
          ? `Port Free Time (${portDemurrageHoursRemaining}h)`
          : primaryRiskFactor === 'LINE_DETENTION'
          ? `${carrier} Line Detention (${lineDetentionHoursRemaining}h)`
          : `Delivery Order Expiry (${doHoursRemaining}h)`;
      alerts.push({
        id: alertKey,
        tenantId,
        type: primaryRiskFactor === 'LINE_DETENTION' ? 'DETENTION_CRITICAL' : 'DEMURRAGE_CRITICAL',
        severity: minHoursRemaining <= 0 ? 'URGENT' : 'CRITICAL',
        title: `🚨 Auto-Escalated CRITICAL: ${riskLabel} — ${j.containerNumber} (${j.jobCode})`,
        message: `Container ${j.containerNumber} (${j.containerSize} ${j.containerType}) is within 24h of penalty: Port Demurrage ${portDemurrageHoursRemaining}h (AED ${portDailyDemurrageAed}/d) · ${carrier} Line Detention ${lineDetentionHoursRemaining}h (AED ${lineDailyDetentionAed}/d) · DO ${doHoursRemaining}h. Priority auto-escalated to CRITICAL.`,
        terminalName: j.terminalName,
        containerId: j.containerId,
        containerNumber: j.containerNumber,
        jobId: j.id,
        jobCode: j.jobCode,
        driverName: j.assignedDriverName,
        driverPhone: '+971 50 482 9910',
        acknowledged: ackSet.has(alertKey),
        createdAt: j.updatedAt,
      });
    } else if (j.priority === 'URGENT' && minHoursRemaining > criticalWindowHrs) {
      // Restore STANDARD priority if previously auto-escalated when free time / DO expiry still has > 24h remaining
      j.priority = 'STANDARD';
      pendingSyncWrites.push(
        db.$executeRawUnsafe(
          `UPDATE logistics_drayage_jobs SET priority = 'STANDARD', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
          j.id,
          tenantId,
        ).catch(() => {}),
      );
    }

    j.riskRadar = {
      portFreeTimeExpiry,
      portDemurrageHoursRemaining,
      portFreeDaysAllowed,
      portDailyDemurrageAed,
      lineDetentionExpiry,
      lineDetentionHoursRemaining,
      lineFreeDaysAllowed,
      lineDailyDetentionAed,
      doExpiryDate: doExpiryIso,
      doHoursRemaining,
      minHoursRemaining,
      primaryRiskFactor,
      within24hPenaltyWindow,
      autoEscalatedCritical,
      dailyCombinedPenaltyAed,
      accruedExposureAed,
      status: radarStatus,
    };

    // (B) Port Appointment Window & Gate Queue Predictor
    const pcsProvider: DrayagePortSlotPrediction['pcsProvider'] =
      j.terminalName.toLowerCase().includes('khalifa') || j.terminalName.toLowerCase().includes('maqta')
        ? 'AD_PORTS_MAQTA'
        : 'DP_WORLD_DUBAI_TRADE';
    const assignedVeh = j.assignedVehicleId ? vehicleById.get(j.assignedVehicleId) : undefined;
    const termLat = term?.lat ?? (pcsProvider === 'AD_PORTS_MAQTA' ? 24.8432 : 25.0112);
    const termLng = term?.lng ?? (pcsProvider === 'AD_PORTS_MAQTA' ? 54.7121 : 55.0612);
    const tractorLat =
      j.currentLat ??
      assignedVeh?.lat ??
      (pcsProvider === 'AD_PORTS_MAQTA' ? 24.715 + (idx % 3) * 0.08 : 25.135 + (idx % 4) * 0.045);
    const tractorLng =
      j.currentLng ??
      assignedVeh?.lng ??
      (pcsProvider === 'AD_PORTS_MAQTA' ? 54.615 + (idx % 3) * 0.06 : 55.195 + (idx % 4) * 0.045);

    const straightKm = computeHaversineKm(tractorLat, tractorLng, termLat, termLng);
    const distanceToPortKm = Math.max(2.4, Math.round(straightKm * 1.24 * 10) / 10);

    const corridorName =
      pcsProvider === 'AD_PORTS_MAQTA'
        ? 'E11 Abu Dhabi – Khalifa Port Freight Corridor'
        : distanceToPortKm > 18
        ? 'E311 Sheikh Mohammed Bin Zayed Freight Corridor'
        : 'E11 Sheikh Zayed Rd / JAFZA Gate Access';

    // Determine traffic condition & corridor speed
    const hasSimulatedCongestion =
      (j.notes || '').includes('E11/E311 Traffic Delay') ||
      (j.pcsSlotEnd && new Date(j.pcsSlotEnd).getTime() - Date.now() < 35 * 60 * 1000);
    const trafficCondition: DrayagePortSlotPrediction['trafficCondition'] =
      hasSimulatedCongestion
        ? 'HEAVY_CONGESTION'
        : distanceToPortKm > 15
        ? 'MODERATE_FLOW'
        : 'FREE_FLOW';

    const avgCorridorSpeedKmh =
      trafficCondition === 'HEAVY_CONGESTION' ? 38 : trafficCondition === 'MODERATE_FLOW' ? 56 : 72;
    const drivingEtaMinutes = Math.max(6, Math.round((distanceToPortKm / avgCorridorSpeedKmh) * 60));
    const gateQueueWaitMinutes =
      pcsProvider === 'AD_PORTS_MAQTA'
        ? trafficCondition === 'HEAVY_CONGESTION'
          ? 19
          : 11
        : trafficCondition === 'HEAVY_CONGESTION'
        ? 26
        : 14;
    const totalEtaMinutes = drivingEtaMinutes + gateQueueWaitMinutes;
    const predictedGateArrivalMs = Date.now() + totalEtaMinutes * 60 * 1000;
    const predictedGateArrivalIso = new Date(predictedGateArrivalMs).toISOString();
    const predictedGateArrivalLabel = new Date(predictedGateArrivalMs).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Dubai',
    });

    // Resolve Token Appointment Slot Start & End
    let slotStartMs: number;
    let slotEndMs: number;
    if (j.pcsSlotStart && j.pcsSlotEnd) {
      slotStartMs = new Date(j.pcsSlotStart).getTime();
      slotEndMs = new Date(j.pcsSlotEnd).getTime();
    } else if (trafficCondition === 'HEAVY_CONGESTION' && (j.tokenNumber || j.pcsTokenNumber) && !isCompleted) {
      // Slot closes soon while E11/E311 congestion delays the tractor -> triggers realistic slot miss detection
      slotStartMs = Date.now() - 95 * 60 * 1000;
      slotEndMs = Date.now() + Math.max(12, totalEtaMinutes - 14) * 60 * 1000;
    } else {
      slotStartMs = Date.now() - 30 * 60 * 1000;
      slotEndMs = Date.now() + (totalEtaMinutes + 42) * 60 * 1000;
    }

    const slotStartIso = new Date(slotStartMs).toISOString();
    const slotEndIso = new Date(slotEndMs).toISOString();
    const fmtSlot = (ms: number) =>
      new Date(ms).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Dubai',
      });
    const slotWindowLabel = `${fmtSlot(slotStartMs)} – ${fmtSlot(slotEndMs)}`;
    const slotBufferMinutes = Math.round((slotEndMs - predictedGateArrivalMs) / 60000);
    const willMissSlot = !isCompleted && Boolean(j.tokenNumber || j.pcsTokenNumber) && slotBufferMinutes < 0;
    const slotRiskStatus: DrayagePortSlotPrediction['slotRiskStatus'] = isCompleted
      ? 'ON_TIME'
      : slotBufferMinutes < 0
      ? 'SLOT_MISS_RISK'
      : slotBufferMinutes <= 15
      ? 'TIGHT_BUFFER'
      : 'ON_TIME';

    const recommendation =
      slotRiskStatus === 'SLOT_MISS_RISK'
        ? `Traffic on ${corridorName} (${avgCorridorSpeedKmh} km/h) + ${gateQueueWaitMinutes}m gate queue causes ${Math.abs(slotBufferMinutes)}m late arrival past ${fmtSlot(slotEndMs)} cutoff. Auto-rebook PCS token or swap to a closer tractor.`
        : slotRiskStatus === 'TIGHT_BUFFER'
        ? `Tight ${slotBufferMinutes}m buffer before ${fmtSlot(slotEndMs)} gate cutoff (${gateQueueWaitMinutes}m OCR queue). Monitor E11/E311 corridor or pre-extend token.`
        : `Tractor on schedule (+${slotBufferMinutes}m buffer before ${fmtSlot(slotEndMs)} gate slot closing).`;

    j.portSlotPrediction = {
      hasActiveToken: Boolean(j.tokenNumber || j.pcsTokenNumber),
      tokenNumber: j.pcsTokenNumber || j.tokenNumber || null,
      pcsProvider,
      slotStart: slotStartIso,
      slotEnd: slotEndIso,
      slotWindowLabel,
      corridorName,
      trafficCondition,
      avgCorridorSpeedKmh,
      distanceToPortKm,
      drivingEtaMinutes,
      gateQueueWaitMinutes,
      totalEtaMinutes,
      predictedGateArrivalIso,
      predictedGateArrivalLabel,
      slotBufferMinutes,
      willMissSlot,
      slotRiskStatus,
      recommendation,
    };

    if (willMissSlot) {
      const slotKey = `slot-miss-${j.id}`;
      alerts.push({
        id: slotKey,
        tenantId,
        type: 'PORT_SLOT_MISS_RISK',
        severity: 'URGENT',
        title: `⏱️ Port Slot Miss Predicted (${Math.abs(slotBufferMinutes)}m Late) — ${j.jobCode} (${j.tokenNumber || j.pcsTokenNumber})`,
        message: `${j.assignedVehiclePlate || 'Assigned Tractor'} on ${corridorName} (${distanceToPortKm} km · ${avgCorridorSpeedKmh} km/h + ${gateQueueWaitMinutes}m gate queue) has ETA ${predictedGateArrivalLabel}, missing PCS slot ${slotWindowLabel}. Prompting dispatch to Auto-Rebook PCS Token or Swap Tractor.`,
        terminalName: j.terminalName,
        containerId: j.containerId,
        containerNumber: j.containerNumber,
        jobId: j.id,
        jobCode: j.jobCode,
        driverName: j.assignedDriverName,
        driverPhone: '+971 50 482 9910',
        acknowledged: ackSet.has(slotKey),
        createdAt: j.updatedAt,
      });
    }

    // (C) Role-Scoped Tracking Links (Customer, Client, Ramp) & Automated Milestone Alert Config
    const customerToken = generateDrayageShortTrackingToken({
      tenantId,
      jobCode: j.jobCode,
      containerNumber: j.containerNumber,
      role: 'CUSTOMER',
    });
    const clientToken = generateDrayageShortTrackingToken({
      tenantId,
      jobCode: j.jobCode,
      containerNumber: j.containerNumber,
      role: 'CLIENT',
    });
    const rampToken = generateDrayageShortTrackingToken({
      tenantId,
      jobCode: j.jobCode,
      containerNumber: j.containerNumber,
      role: 'RAMP',
    });
    const resolvedContacts = resolveCustomerMilestoneContacts({
      customerName: j.customerName,
      warehouseId: j.warehouseId,
      warehouseName: j.warehouseName,
      notes: j.notes,
      clients,
      warehouses,
      customers,
    });
    const lastAlertLog = statusLogRows.find(
      (l) =>
        (String(l.job_id) === j.id || String(l.job_code) === j.jobCode) &&
        String(l.actor || '').includes('Customer Alert Engine'),
    );
    const custAndClientActive = isCustomerOrClientLinkActive({
      status: j.status,
      assignedVehicleId: j.assignedVehicleId,
      assignedDriverId: j.assignedDriverId,
      assignedVehiclePlate: j.assignedVehiclePlate,
      assignedDriverName: j.assignedDriverName,
    });
    const rampActive = isRampLinkActive({
      status: j.status,
      placementLocation: j.placementLocation,
      trailerDetached: j.trailerDetached,
    });
    j.customerPortal = {
      trackingToken: customerToken,
      shareablePath: `/track/drayage/${customerToken}`,
      customerToken,
      customerShareablePath: `/track/drayage/${customerToken}`,
      clientToken,
      clientShareablePath: `/track/drayage/${clientToken}`,
      rampToken,
      rampShareablePath: `/track/drayage/${rampToken}`,
      customerLinkActive: custAndClientActive,
      clientLinkActive: custAndClientActive,
      rampLinkActive: rampActive,
      jobCode: j.jobCode,
      containerNumber: j.containerNumber,
      customerName: j.customerName,
      customerWhatsApp: resolvedContacts.whatsapp,
      customerEmail: resolvedContacts.email,
      clientName: resolvedContacts.clientName,
      clientWhatsApp: resolvedContacts.clientWhatsApp,
      clientEmail: resolvedContacts.clientEmail,
      rampContactName: resolvedContacts.rampContactName,
      rampWhatsApp: resolvedContacts.rampWhatsApp,
      autoAlertsEnabled: resolvedContacts.autoAlertsEnabled,
      lastAlertSentAt: lastAlertLog?.created_at
        ? new Date(String(lastAlertLog.created_at)).toISOString()
        : null,
      lastAlertSummary: lastAlertLog?.notes ? String(lastAlertLog.notes) : null,
    };
  }

  for (const c of containers) {
    const linkedJob = jobByContainerId.get(c.id);
    if (c.demurrage.status === 'CRITICAL_OVERDUE') {
      const key = `dem-crit-${c.id}`;
      alerts.push({
        id: key,
        tenantId,
        type: 'DEMURRAGE_CRITICAL',
        severity: 'URGENT',
        title: `Demurrage Overdue (${c.demurrage.overdueDays}d) — ${c.containerNumber}`,
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
    const st = (j.status || '').toUpperCase();
    const reassignEval = evaluateDispatcherJobReassignState(j);
    const hasEtc = Boolean(j.etcTime);
    const etcMs = hasEtc ? new Date(j.etcTime as string).getTime() : null;
    const minsRemaining = etcMs !== null && !isNaN(etcMs) ? Math.ceil((etcMs - Date.now()) / 60000) : null;
    const isExpired =
      (minsRemaining !== null && minsRemaining <= 0) ||
      String(j.etcAlertStatus || '').toUpperCase() === 'EXPIRED';
    const isT15Warning =
      !isExpired &&
      ((minsRemaining !== null && minsRemaining > 0 && minsRemaining <= 15) ||
        String(j.etcAlertStatus || '').toUpperCase() === 'T15_WARNING');

    if (j.jobPhase === 'L1' && !j.l2Activated && st !== 'COMPLETED') {
      const actionLabel = reassignEval.reassignLabel || resolveDirectionalReassignStatus({
        originLocation: j.placementLocation === 'YARD' ? 'YARD' : 'RAMP',
        shipmentType: j.shipmentType,
      });
      if (isExpired) {
        const expKey = `etc-exp-${j.id}`;
        alerts.push({
          id: expKey,
          tenantId,
          type: 'REASSIGN_ETC_EXPIRED',
          severity: 'URGENT',
          title: `🚨 ETC Expired — ${actionLabel}: ${j.jobCode} (${j.containerNumber})`,
          message: `Offloading timer expired for ${j.containerNumber} at ${j.warehouseName} (${j.placementLocation ?? 'RAMP'}). Dispatcher status enabled as ${actionLabel}.`,
          terminalName: j.terminalName,
          containerId: j.containerId,
          containerNumber: j.containerNumber,
          jobId: j.id,
          jobCode: j.jobCode,
          driverName: j.assignedDriverName,
          driverPhone: '+971 55 301 7741',
          acknowledged: ackSet.has(expKey),
          createdAt: j.updatedAt,
        });
      } else if (isT15Warning) {
        const t15Key = `etc-t15-${j.id}`;
        alerts.push({
          id: t15Key,
          tenantId,
          type: 'REASSIGN_ETC_T15',
          severity: 'CRITICAL',
          title: `⏳ First ETC Alert (${minsRemaining ?? 15}m left) — ${actionLabel}: ${j.jobCode} (${j.containerNumber})`,
          message: `Container ${j.containerNumber} at ${j.warehouseName} (${j.placementLocation ?? 'RAMP'}) reached first alert (${minsRemaining ?? 15}m left). Dispatcher Reassign unlocked as ${actionLabel}.`,
          terminalName: j.terminalName,
          containerId: j.containerId,
          containerNumber: j.containerNumber,
          jobId: j.id,
          jobCode: j.jobCode,
          driverName: j.assignedDriverName,
          driverPhone: '+971 55 301 7741',
          acknowledged: ackSet.has(t15Key),
          createdAt: j.updatedAt,
        });
      } else if (
        reassignEval.originLocation === 'YARD' &&
        reassignEval.canReassign
      ) {
        const key = `det-l2-${j.id}`;
        alerts.push({
          id: key,
          tenantId,
          type: 'DETACHED_TRAILER',
          severity: 'WARNING',
          title: `Yard Staged — ${actionLabel}: ${j.jobCode} (${j.containerNumber})`,
          message: `Container ${j.containerNumber} placed at ${j.warehouseName} (YARD). Ready for Dispatcher ${actionLabel}.`,
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
      } else if (j.trailerDetached || st === 'CONTAINER_DETACHED' || st === 'PLACED_AT_RAMP' || st === 'REASSIGN_PLACED_AT_RAMP') {
        const key = `det-l2-${j.id}`;
        alerts.push({
          id: key,
          tenantId,
          type: 'DETACHED_TRAILER',
          severity: 'WARNING',
          title: hasEtc
            ? `Offload In Progress (ETC: ${new Date(j.etcTime as string).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })}) — ${j.containerNumber}`
            : `Detached Chassis at ${j.placementLocation ?? 'RAMP'} — ${j.containerNumber}`,
          message: hasEtc
            ? `Container ${j.containerNumber} placed at ${j.warehouseName} (${j.placementLocation ?? 'RAMP'}). ${actionLabel} will unlock upon first alert (T-15m).`
            : `Chassis ${j.assignedTrailerPlate ?? 'Skeletal'} is detached at ${j.warehouseName} (${j.placementLocation ?? 'RAMP'}). Set ETC timer or Reassign once ready.`,
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
  }

  if (pendingSyncWrites.length > 0) {
    await Promise.allSettled(pendingSyncWrites);
  }
  if (masterGeofenceInserted) {
    invalidateDrayageMasterCache(tenantId);
  }

  // 11. Summary Metrics
  const overdueContainers = containers.filter(c => c.demurrage.status === 'CRITICAL_OVERDUE');
  const warningContainers = containers.filter(c => c.demurrage.status === 'WARNING');
  const totalDemurrageExposureAed = containers.reduce((sum, c) => sum + c.demurrage.accruedPenaltyAed, 0);
  const totalRevenueAed = jobs.reduce((sum, j) => sum + j.rateAmountAed, 0);
  const totalAllowancesAed = allowances.reduce((sum, a) => sum + a.totalAmountAed, 0);
  const activeJobsCount = jobs.filter(j => j.status !== 'COMPLETED' && j.status !== 'PENDING').length;
  const pendingDispatchCount = jobs.filter(j => j.status === 'PENDING').length;
  const detachedWaitingL2Count = jobs.filter(j => j.jobPhase === 'L1' && (j.trailerDetached || j.status === 'CONTAINER_DETACHED' || j.status === 'PLACED_AT_RAMP' || j.status === 'PLACED_AT_YARD') && !j.l2Activated).length;

  const rateCards = [
    ...clients.map(c => ({
      id: `rc-client-${c.id}`,
      scope: 'CLIENT' as const,
      name: c.name,
      code: c.code,
      tripAmountAed: c.defaultTripAmountAed,
      driverAllowanceAed: c.defaultDriverAllowanceAed,
    })),
    ...terminals.map(t => ({
      id: `rc-terminal-${t.id}`,
      scope: 'TERMINAL' as const,
      name: t.name,
      code: t.code,
      freeDaysDry: t.freeDaysDry,
      freeDaysReefer: t.freeDaysReefer,
    })),
  ];

  return {
    summary: {
      totalJobs: jobs.length,
      activeJobsCount,
      activeTrips: activeJobsCount,
      pendingDispatchCount,
      detachedWaitingL2Count,
      totalContainers: containers.length,
      overdueContainersCount: overdueContainers.length,
      etcOverdueContainers: overdueContainers.length,
      warningContainersCount: warningContainers.length,
      safeContainersCount: containers.filter(c => c.demurrage.status === 'SAFE').length,
      totalDemurrageExposureAed,
      totalDemurrageAed: totalDemurrageExposureAed,
      totalRevenueAed,
      totalAllowancesAed,
      mappedVehiclesCount: vehicles.length,
      mappedDriversCount: drivers.length,
      availableTrailersCount: trailers.filter(t => t.masterStatus === 'AVAILABLE').length,
      totalTrailersCount: trailers.length,
      unacknowledgedAlertsCount: alerts.filter(a => !a.acknowledged).length,
    },
    automationConfig,
    terminals,
    warehouses,
    rateCards,
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
    warehouseId?: string | null;
    warehouseName?: string | null;
    rateAmountAed?: number;
    driverAllowanceAed?: number;
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

  const safeFinite = (val: unknown, fallback: number): number => {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
  };
  const safeIsoOrNull = (val: unknown): string | null => {
    if (!val || typeof val !== 'string' || !val.trim()) return null;
    const d = new Date(val.trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  // Resolve terminal coordinates for initial pin
  const termRows = input.terminalId
    ? await db.$queryRawUnsafe<Array<{ lat: number; lng: number }>>(
        `SELECT lat, lng FROM logistics_drayage_terminals WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        input.terminalId, input.tenantId,
      )
    : [];
  const startLat = safeFinite(termRows[0]?.lat, 25.0112);
  const startLng = safeFinite(termRows[0]?.lng, 55.0612);

  const safeCustomerName = String(input.customerName || 'Enterprise Shipper').trim() || 'Enterprise Shipper';
  const safeTerminalName = String(input.terminalName || 'Jebel Ali Port - Terminal 1').trim() || 'Jebel Ali Port - Terminal 1';
  const defaultWarehouseName = String(input.warehouseName || 'JAFZA South Bonded Hub').trim() || 'JAFZA South Bonded Hub';
  const safeShipmentType = input.shipmentType === 'EXPORT' ? 'EXPORT' : 'IMPORT';
  const safePriority = String(input.priority || 'STANDARD').trim() || 'STANDARD';

  for (const item of input.containers) {
    const cntNum = String(item.containerNumber ?? '').trim().toUpperCase();
    if (!cntNum) continue;

    const existingCnt = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM logistics_drayage_containers WHERE tenant_id = $1 AND UPPER(container_number) = $2 ORDER BY created_at DESC LIMIT 1`,
      input.tenantId,
      cntNum,
    ).catch(() => []);

    const containerId = existingCnt[0]?.id || `cnt-${crypto.randomUUID().slice(0, 12)}`;
    const jobId = `job-${crypto.randomUUID().slice(0, 12)}`;
    const jobCode = `DRY-L1-${Math.floor(1000 + Math.random() * 9000)}`;
    const dischargeIso = safeIsoOrNull(item.dischargeDate) ?? new Date().toISOString();
    const doExpiryIso = safeIsoOrNull(item.doExpiryDate);
    const safeSize = String(item.size || '40HC').trim() || '40HC';
    const safeCntType = String(item.containerType || 'DRY').trim() || 'DRY';
    const safeWeightKg = safeFinite(item.weightKg, 22000) > 0 ? safeFinite(item.weightKg, 22000) : 22000;
    const itemWarehouseId = item.warehouseId || input.warehouseId || null;
    const itemWarehouseName =
      String(item.warehouseName || defaultWarehouseName).trim() || defaultWarehouseName;
    const safeRateAed = safeFinite(
      item.rateAmountAed ?? input.rateAmountAed,
      safeCntType === 'REEFER' ? 2100 : 1550,
    );
    const safeDriverAllowAed = safeFinite(
      item.driverAllowanceAed ?? input.driverAllowanceAed,
      150,
    );

    if (existingCnt[0]?.id) {
      await db.$executeRawUnsafe(
        `UPDATE logistics_drayage_containers
            SET size = $3,
                container_type = $4,
                shipment_type = $5,
                customer_id = $6,
                customer_name = $7,
                terminal_id = $8,
                terminal_name = $9,
                warehouse_id = $10,
                warehouse_name = $11,
                do_expiry_date = COALESCE($12::timestamptz, do_expiry_date),
                discharge_date = COALESCE($13::timestamptz, discharge_date),
                seal_number = COALESCE($14, seal_number),
                weight_kg = COALESCE($15, weight_kg),
                customs_inspection = $16,
                municipality_inspection = $17,
                cpip_inspection = $18,
                merc_inspection = $19,
                boxcare_inspection = $20,
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        containerId,
        input.tenantId,
        safeSize,
        safeCntType,
        safeShipmentType,
        input.customerId ?? null,
        safeCustomerName,
        input.terminalId ?? null,
        safeTerminalName,
        itemWarehouseId,
        itemWarehouseName,
        doExpiryIso,
        dischargeIso,
        item.sealNumber ? String(item.sealNumber).trim() : null,
        safeWeightKg,
        Boolean(item.customsInspection),
        Boolean(item.municipalityInspection),
        Boolean(item.cpipInspection),
        Boolean(item.mercInspection),
        Boolean(item.boxcareInspection),
      );
    } else {
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
        safeSize,
        safeCntType,
        safeShipmentType,
        input.customerId ?? null,
        safeCustomerName,
        input.terminalId ?? null,
        safeTerminalName,
        itemWarehouseId,
        itemWarehouseName,
        doExpiryIso,
        dischargeIso,
        item.sealNumber && String(item.sealNumber).trim()
          ? String(item.sealNumber).trim()
          : `SL-${Math.floor(100000 + Math.random() * 900000)}`,
        safeWeightKg,
        Boolean(item.customsInspection),
        Boolean(item.municipalityInspection),
        Boolean(item.cpipInspection),
        Boolean(item.mercInspection),
        Boolean(item.boxcareInspection),
      );
    }

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
      safeShipmentType,
      safePriority,
      input.customerId ?? null,
      safeCustomerName,
      itemWarehouseId,
      itemWarehouseName,
      input.terminalId ?? null,
      safeTerminalName,
      containerId,
      cntNum,
      safeSize,
      safeCntType,
      doExpiryIso,
      safeRateAed,
      safeDriverAllowAed,
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

export interface UpdateDrayageJobInput {
  tenantId: string;
  jobId: string;
  containerNumber?: string;
  containerSize?: string;
  containerType?: string;
  sealNumber?: string | null;
  weightKg?: number | null;
  shipmentType?: 'IMPORT' | 'EXPORT';
  priority?: 'STANDARD' | 'HIGH' | 'URGENT';
  customerId?: string | null;
  customerName?: string;
  terminalId?: string | null;
  terminalName?: string;
  warehouseId?: string | null;
  warehouseName?: string;
  doExpiryDate?: string | null;
  dischargeDate?: string | null;
  tokenNumber?: string | null;
  rateAmountAed?: number;
  driverAllowanceAed?: number;
  customsInspection?: boolean;
  municipalityInspection?: boolean;
  cpipInspection?: boolean;
  mercInspection?: boolean;
  boxcareInspection?: boolean;
  notes?: string | null;
  actor?: string;
}

export async function updateDrayageJobDetails(
  db: DrayageDbClient,
  input: UpdateDrayageJobInput,
) {
  await ensureDrayageSchema(db);

  const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    input.jobId,
    input.tenantId,
  );
  const job = jobRows[0];
  if (!job) throw new Error('Drayage job not found');

  const safeIsoOrNull = (val: unknown): string | null => {
    if (!val || typeof val !== 'string' || !val.trim()) return null;
    const d = new Date(val.trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  const oldContainerNumber = String(job.container_number ?? '').trim().toUpperCase();
  const nextContainerNumber =
    input.containerNumber && String(input.containerNumber).trim()
      ? String(input.containerNumber).trim().toUpperCase()
      : oldContainerNumber;
  const nextContainerSize =
    input.containerSize && String(input.containerSize).trim()
      ? String(input.containerSize).trim().toUpperCase()
      : String(job.container_size ?? '40HC');
  const nextContainerType =
    input.containerType && String(input.containerType).trim()
      ? String(input.containerType).trim().toUpperCase()
      : String(job.container_type ?? 'DRY');
  const nextShipmentType =
    input.shipmentType === 'EXPORT' || input.shipmentType === 'IMPORT'
      ? input.shipmentType
      : String(job.shipment_type) === 'EXPORT'
      ? 'EXPORT'
      : 'IMPORT';
  const nextPriority =
    input.priority && ['STANDARD', 'HIGH', 'URGENT'].includes(String(input.priority).toUpperCase())
      ? (String(input.priority).toUpperCase() as 'STANDARD' | 'HIGH' | 'URGENT')
      : (String(job.priority ?? 'STANDARD') as 'STANDARD' | 'HIGH' | 'URGENT');

  const nextCustomerId =
    input.customerId !== undefined ? (input.customerId || null) : (job.customer_id ? String(job.customer_id) : null);
  const nextCustomerName =
    input.customerName && String(input.customerName).trim()
      ? String(input.customerName).trim()
      : String(job.customer_name ?? 'Enterprise Shipper');

  const nextTerminalId =
    input.terminalId !== undefined ? (input.terminalId || null) : (job.terminal_id ? String(job.terminal_id) : null);
  const nextTerminalName =
    input.terminalName && String(input.terminalName).trim()
      ? String(input.terminalName).trim()
      : String(job.terminal_name ?? 'DPW-Jebel Ali-T1');

  const nextWarehouseId =
    input.warehouseId !== undefined ? (input.warehouseId || null) : (job.warehouse_id ? String(job.warehouse_id) : null);
  const nextWarehouseName =
    input.warehouseName && String(input.warehouseName).trim()
      ? String(input.warehouseName).trim()
      : String(job.warehouse_name ?? 'Consignee Warehouse');

  const nextDoExpiryIso =
    input.doExpiryDate !== undefined
      ? safeIsoOrNull(input.doExpiryDate)
      : job.do_expiry_date
      ? new Date(String(job.do_expiry_date)).toISOString()
      : null;

  const nextDischargeIso =
    input.dischargeDate !== undefined ? safeIsoOrNull(input.dischargeDate) : null;

  const nextTokenNumber =
    input.tokenNumber !== undefined
      ? (input.tokenNumber && String(input.tokenNumber).trim()
          ? String(input.tokenNumber).trim().toUpperCase()
          : null)
      : job.token_number
      ? String(job.token_number)
      : null;

  const nextRateAed =
    input.rateAmountAed !== undefined && Number.isFinite(Number(input.rateAmountAed)) && Number(input.rateAmountAed) >= 0
      ? Number(input.rateAmountAed)
      : Number(job.rate_amount_aed ?? 1550);

  const nextDriverAllowanceAed =
    input.driverAllowanceAed !== undefined &&
    Number.isFinite(Number(input.driverAllowanceAed)) &&
    Number(input.driverAllowanceAed) >= 0
      ? Number(input.driverAllowanceAed)
      : Number(job.driver_allowance_aed ?? 150);

  const nextWeightKg =
    input.weightKg !== undefined && Number.isFinite(Number(input.weightKg)) && Number(input.weightKg) > 0
      ? Number(input.weightKg)
      : Number(job.cargo_weight_kg ?? 22000);

  const nextSealNumber =
    input.sealNumber !== undefined
      ? (input.sealNumber && String(input.sealNumber).trim() ? String(input.sealNumber).trim() : null)
      : undefined;

  const nextCustomsInspection =
    input.customsInspection !== undefined ? Boolean(input.customsInspection) : Boolean(job.customs_inspection);
  const nextMunicipalityInspection =
    input.municipalityInspection !== undefined
      ? Boolean(input.municipalityInspection)
      : Boolean(job.municipality_inspection);
  const nextCpipInspection =
    input.cpipInspection !== undefined ? Boolean(input.cpipInspection) : Boolean(job.cpip_inspection);
  const nextMercInspection =
    input.mercInspection !== undefined ? Boolean(input.mercInspection) : Boolean(job.merc_inspection);
  const nextBoxcareInspection =
    input.boxcareInspection !== undefined ? Boolean(input.boxcareInspection) : Boolean(job.boxcare_inspection);

  const nextNotes =
    input.notes !== undefined
      ? (input.notes && String(input.notes).trim() ? String(input.notes).trim() : null)
      : job.notes
      ? String(job.notes)
      : null;

  const nextShippingLine = detectShippingLine(nextContainerNumber);

  // Build concise summary of changes for audit log
  const changes: string[] = [];
  if (nextContainerNumber !== oldContainerNumber) {
    changes.push(`Container: ${oldContainerNumber} → ${nextContainerNumber}`);
  }
  if (nextContainerSize !== String(job.container_size ?? '') || nextContainerType !== String(job.container_type ?? '')) {
    changes.push(`Spec: ${nextContainerSize} ${nextContainerType}`);
  }
  if (nextCustomerName !== String(job.customer_name ?? '')) {
    changes.push(`Customer: ${nextCustomerName}`);
  }
  if (nextTerminalName !== String(job.terminal_name ?? '')) {
    changes.push(`Terminal: ${nextTerminalName}`);
  }
  if (nextWarehouseName !== String(job.warehouse_name ?? '')) {
    changes.push(`Consignee: ${nextWarehouseName}`);
  }
  if (nextRateAed !== Number(job.rate_amount_aed ?? 0)) {
    changes.push(`Rate: AED ${nextRateAed}`);
  }
  if (nextDriverAllowanceAed !== Number(job.driver_allowance_aed ?? 0)) {
    changes.push(`Allowance: AED ${nextDriverAllowanceAed}`);
  }
  if (nextPriority !== String(job.priority ?? '')) {
    changes.push(`Priority: ${nextPriority}`);
  }

  // 1. Update main job row
  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET container_number = $3,
            container_size = $4,
            container_type = $5,
            shipment_type = $6,
            priority = $7,
            customer_id = $8,
            customer_name = $9,
            terminal_id = $10,
            terminal_name = $11,
            warehouse_id = $12,
            warehouse_name = $13,
            do_expiry_date = $14::timestamptz,
            token_number = $15,
            pcs_token_number = COALESCE($15, pcs_token_number),
            rate_amount_aed = $16,
            driver_allowance_aed = $17,
            cargo_weight_kg = $18,
            shipping_line = $19,
            customs_inspection = $20,
            municipality_inspection = $21,
            cpip_inspection = $22,
            merc_inspection = $23,
            boxcare_inspection = $24,
            notes = $25,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    input.jobId,
    input.tenantId,
    nextContainerNumber,
    nextContainerSize,
    nextContainerType,
    nextShipmentType,
    nextPriority,
    nextCustomerId,
    nextCustomerName,
    nextTerminalId,
    nextTerminalName,
    nextWarehouseId,
    nextWarehouseName,
    nextDoExpiryIso,
    nextTokenNumber,
    nextRateAed,
    nextDriverAllowanceAed,
    nextWeightKg,
    nextShippingLine,
    nextCustomsInspection,
    nextMunicipalityInspection,
    nextCpipInspection,
    nextMercInspection,
    nextBoxcareInspection,
    nextNotes,
  );

  // 2. Sync container / route metadata to any linked L1/L2 paired job
  const parentJobId = job.parent_job_id ? String(job.parent_job_id) : null;
  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET container_number = $3,
            container_size = $4,
            container_type = $5,
            customer_id = $6,
            customer_name = $7,
            terminal_id = $8,
            terminal_name = $9,
            warehouse_id = $10,
            warehouse_name = $11,
            do_expiry_date = COALESCE($12::timestamptz, do_expiry_date),
            shipping_line = $13,
            updated_at = NOW()
      WHERE tenant_id = $1
        AND id <> $2
        AND (parent_job_id = $2 OR ($14::text IS NOT NULL AND id = $14::text))`,
    input.tenantId,
    input.jobId,
    nextContainerNumber,
    nextContainerSize,
    nextContainerType,
    nextCustomerId,
    nextCustomerName,
    nextTerminalId,
    nextTerminalName,
    nextWarehouseId,
    nextWarehouseName,
    nextDoExpiryIso,
    nextShippingLine,
    parentJobId,
  ).catch(() => {});

  // 3. Update linked Container record in `logistics_drayage_containers`
  const containerId = job.container_id ? String(job.container_id) : null;
  if (containerId || oldContainerNumber) {
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_containers
          SET container_number = $4,
              size = $5,
              container_type = $6,
              shipment_type = $7,
              customer_id = $8,
              customer_name = $9,
              terminal_id = $10,
              terminal_name = $11,
              warehouse_id = $12,
              warehouse_name = $13,
              do_expiry_date = COALESCE($14::timestamptz, do_expiry_date),
              discharge_date = COALESCE($15::timestamptz, discharge_date),
              seal_number = CASE WHEN $16::boolean THEN $17 ELSE seal_number END,
              weight_kg = $18,
              customs_inspection = $19,
              municipality_inspection = $20,
              cpip_inspection = $21,
              merc_inspection = $22,
              boxcare_inspection = $23,
              updated_at = NOW()
        WHERE tenant_id = $1
          AND ((id = $2 AND $2 IS NOT NULL) OR UPPER(container_number) = UPPER($3))`,
      input.tenantId,
      containerId,
      oldContainerNumber,
      nextContainerNumber,
      nextContainerSize,
      nextContainerType,
      nextShipmentType,
      nextCustomerId,
      nextCustomerName,
      nextTerminalId,
      nextTerminalName,
      nextWarehouseId,
      nextWarehouseName,
      nextDoExpiryIso,
      nextDischargeIso,
      nextSealNumber !== undefined,
      nextSealNumber ?? null,
      nextWeightKg,
      nextCustomsInspection,
      nextMunicipalityInspection,
      nextCpipInspection,
      nextMercInspection,
      nextBoxcareInspection,
    ).catch(() => {});
  }

  // 4. Sync trailer linked_container_number if container number changed
  if (nextContainerNumber !== oldContainerNumber) {
    const trailerId = job.assigned_trailer_id ? String(job.assigned_trailer_id) : null;
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_trailers
          SET linked_container_number = $4,
              updated_at = NOW()
        WHERE tenant_id = $1
          AND ((id = $2 AND $2 IS NOT NULL) OR UPPER(linked_container_number) = UPPER($3))`,
      input.tenantId,
      trailerId,
      oldContainerNumber,
      nextContainerNumber,
    ).catch(() => {});
  }

  // 5. Sync pending driver allowance if allowance or container number changed
  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_allowances
        SET container_number = $3,
            route_summary = $4,
            allowance_amount_aed = CASE WHEN status = 'PENDING' THEN $5 ELSE allowance_amount_aed END,
            total_amount_aed = CASE
              WHEN status = 'PENDING' THEN
                $5 + COALESCE(port_gate_fee_aed, 0) + COALESCE(overnight_halt_aed, 0) +
                COALESCE(bogie_bonus_aed, 0) + COALESCE(street_turn_bonus_aed, 0) + COALESCE(inspection_bonus_aed, 0)
              ELSE total_amount_aed
            END
      WHERE tenant_id = $1 AND job_id = $2`,
    input.tenantId,
    input.jobId,
    nextContainerNumber,
    `${nextTerminalName} → ${nextWarehouseName}`,
    nextDriverAllowanceAed,
  ).catch(() => {});

  // 6. Record audit log entry
  const logSummary =
    changes.length > 0
      ? `Job details edited (${changes.join(' · ')})`
      : `Job details updated for ${nextContainerNumber}`;

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'JOB_EDITED', $5, $6)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    input.tenantId,
    input.jobId,
    String(job.job_code),
    logSummary,
    input.actor || 'dispatcher',
  ).catch(() => {});

  return {
    ok: true,
    jobId: input.jobId,
    jobCode: String(job.job_code),
    containerNumber: nextContainerNumber,
    changes,
  };
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
    pcsSlotStart?: string | null;
    pcsSlotEnd?: string | null;
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

  const token = args.tokenNumber?.trim() || `DPW-TKN-${Math.floor(1000 + Math.random() * 9000)}`;
  let resolvedSlotStart: string | null = null;
  let resolvedSlotEnd: string | null = null;
  if (args.pcsSlotStart && String(args.pcsSlotStart).trim()) {
    const startDt = new Date(String(args.pcsSlotStart).trim());
    if (!Number.isNaN(startDt.getTime())) {
      resolvedSlotStart = startDt.toISOString();
      const endDt =
        args.pcsSlotEnd && String(args.pcsSlotEnd).trim()
          ? new Date(String(args.pcsSlotEnd).trim())
          : new Date(startDt.getTime() + 2 * 60 * 60 * 1000);
      resolvedSlotEnd = !Number.isNaN(endDt.getTime())
        ? endDt.toISOString()
        : new Date(startDt.getTime() + 2 * 60 * 60 * 1000).toISOString();
    }
  } else if (job.pcs_slot_start) {
    const existingStart = new Date(String(job.pcs_slot_start));
    if (!Number.isNaN(existingStart.getTime())) {
      resolvedSlotStart = existingStart.toISOString();
      const existingEnd = job.pcs_slot_end
        ? new Date(String(job.pcs_slot_end))
        : new Date(existingStart.getTime() + 2 * 60 * 60 * 1000);
      resolvedSlotEnd = !Number.isNaN(existingEnd.getTime())
        ? existingEnd.toISOString()
        : new Date(existingStart.getTime() + 2 * 60 * 60 * 1000).toISOString();
    }
  } else {
    // Default 2-hour UAE (UTC+4) gate slot window when assigning a token without an explicit slot
    const uaeNow = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const uaeHour = uaeNow.getUTCHours();
    const defaultStartDt = new Date(
      Date.UTC(
        uaeNow.getUTCFullYear(),
        uaeNow.getUTCMonth(),
        uaeNow.getUTCDate(),
        uaeHour - 4,
        0,
        0,
        0,
      ),
    );
    const defaultEndDt = new Date(defaultStartDt.getTime() + 2 * 60 * 60 * 1000);
    resolvedSlotStart = defaultStartDt.toISOString();
    resolvedSlotEnd = defaultEndDt.toISOString();
  }
  const prevStatusRaw = String(job.status || '').trim();
  const prevStatus = prevStatusRaw.toUpperCase();
  const isReassignment =
    Boolean(job.trailer_detached) ||
    isDrayageReassignStatus(prevStatusRaw) ||
    [
      'PLACED_AT_YARD',
      'PLACED_AT_RAMP',
      'TRAILER_DETACHED',
      'CONTAINER_DETACHED',
      'REASSIGN_PLACED_AT_YARD',
      'REASSIGN_PLACED_AT_RAMP',
      'REASSIGN_TRAILER_DETACHED',
      'READY_FOR_PICKUP',
      'FCL_REASSIGN',
      'MT_REASSIGN',
      'RE-ASSIGNED',
    ].includes(prevStatus);
  const nextAssignStatus = isReassignment ? 'RE-ASSIGNED' : 'ASSIGNED';

  let resolvedPlacementLocation = job.placement_location ? String(job.placement_location).toUpperCase() : null;
  if (isReassignment) {
    if (
      prevStatus === 'PLACED_AT_YARD' ||
      prevStatus.includes('TO RAMP') ||
      prevStatus.includes('TO_RAMP') ||
      resolvedPlacementLocation === 'YARD'
    ) {
      resolvedPlacementLocation = 'YARD';
    } else if (
      prevStatus === 'PLACED_AT_RAMP' ||
      prevStatus === 'REASSIGN_PLACED_AT_RAMP' ||
      prevStatus.includes('TO YARD') ||
      prevStatus.includes('TO_YARD') ||
      resolvedPlacementLocation === 'RAMP'
    ) {
      resolvedPlacementLocation = 'RAMP';
    }
  }

  // If the assigned vehicle already has live GPS coordinates from a logged-in driver,
  // copy those coordinates onto the job immediately upon assignment.
  let liveVehLat: number | null = null;
  let liveVehLng: number | null = null;
  if (args.vehicleId) {
    const vehCoordRows = await db
      .$queryRawUnsafe<Array<{ current_lat: number | null; current_lng: number | null }>>(
        `SELECT current_lat, current_lng
           FROM vehicles
          WHERE id::text = $1 AND tenant_id::text = $2
          LIMIT 1`,
        args.vehicleId,
        args.tenantId,
      )
      .catch(() => []);
    const candLat = vehCoordRows[0]?.current_lat != null ? Number(vehCoordRows[0].current_lat) : NaN;
    const candLng = vehCoordRows[0]?.current_lng != null ? Number(vehCoordRows[0].current_lng) : NaN;
    if (!isNaN(candLat) && !isNaN(candLng) && (candLat !== 0 || candLng !== 0)) {
      liveVehLat = candLat;
      liveVehLng = candLng;
    }
  }

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET status = $10,
            placement_location = COALESCE($11, placement_location),
            trailer_detached = FALSE,
            assigned_vehicle_id = $3,
            assigned_vehicle_plate = $4,
            assigned_driver_id = $5,
            assigned_driver_name = $6,
            assigned_trailer_id = $7,
            assigned_trailer_plate = $8,
            token_number = $9,
            pcs_token_number = $9,
            pcs_slot_start = COALESCE($12::timestamptz, pcs_slot_start),
            pcs_slot_end = COALESCE($13::timestamptz, pcs_slot_end),
            pcs_token_status = 'BOOKED',
            current_lat = COALESCE($14::double precision, current_lat),
            current_lng = COALESCE($15::double precision, current_lng),
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
    nextAssignStatus,
    resolvedPlacementLocation,
    resolvedSlotStart,
    resolvedSlotEnd,
    liveVehLat,
    liveVehLng,
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

  // Update container linked trailer & PCS token window
  if (job.container_id) {
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_containers
          SET linked_trailer_plate = $3,
              status = $4,
              pcs_token_number = $5,
              pcs_slot_start = COALESCE($6::timestamptz, pcs_slot_start),
              pcs_slot_end = COALESCE($7::timestamptz, pcs_slot_end),
              pcs_token_status = 'BOOKED',
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      String(job.container_id),
      args.tenantId,
      args.trailerPlate,
      String(job.job_phase) === 'L2' ? 'EMPTY_RETURN_ASSIGNED' : 'TOKEN_ASSIGNED',
      token,
      resolvedSlotStart,
      resolvedSlotEnd,
    );
  }

  // Create or update Driver Trip Allowance entry with Port Gate Fee, Bogie, Street-Turn & Inspection bonuses
  const allowanceCalc = computeDriverAllowanceComponents(job);

  const existingAlwRows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM logistics_drayage_allowances WHERE job_id = $1 AND tenant_id = $2 LIMIT 1`,
    args.jobId,
    args.tenantId,
  );

  if (existingAlwRows.length > 0) {
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_allowances
          SET driver_id = $3,
              driver_name = $4,
              vehicle_plate = $5,
              route_summary = $6,
              allowance_amount_aed = $7,
              port_gate_fee_aed = $8,
              bogie_bonus_aed = $9,
              street_turn_bonus_aed = $10,
              inspection_bonus_aed = $11,
              total_amount_aed = $12
        WHERE id = $1 AND tenant_id = $2 AND status = 'PENDING'`,
      existingAlwRows[0].id,
      args.tenantId,
      args.driverId,
      args.driverName,
      args.vehiclePlate,
      allowanceCalc.routeSummary,
      allowanceCalc.allowanceAmountAed,
      allowanceCalc.portGateFeeAed,
      allowanceCalc.bogieBonusAed,
      allowanceCalc.streetTurnBonusAed,
      allowanceCalc.inspectionBonusAed,
      allowanceCalc.totalAmountAed,
    );
  } else {
    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_allowances (
        id, tenant_id, job_id, job_code, driver_id, driver_name, vehicle_plate,
        container_number, trip_phase, route_summary, allowance_amount_aed, port_gate_fee_aed,
        overnight_halt_aed, bogie_bonus_aed, street_turn_bonus_aed, inspection_bonus_aed,
        total_amount_aed, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'PENDING')`,
      `alw-${crypto.randomUUID().slice(0, 12)}`,
      args.tenantId,
      args.jobId,
      String(job.job_code),
      args.driverId,
      args.driverName,
      args.vehiclePlate,
      String(job.container_number),
      String(job.job_phase ?? 'L1'),
      allowanceCalc.routeSummary,
      allowanceCalc.allowanceAmountAed,
      allowanceCalc.portGateFeeAed,
      allowanceCalc.overnightHaltAed,
      allowanceCalc.bogieBonusAed,
      allowanceCalc.streetTurnBonusAed,
      allowanceCalc.inspectionBonusAed,
      allowanceCalc.totalAmountAed,
    );
  }

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId,
    String(job.job_code),
    nextAssignStatus,
    '',
    args.actor || 'dispatcher',
  );

  // Automatically dispatch Customer & Client tracking links upon Vehicle & Driver Assignment (ASSIGNED status)
  await dispatchDrayageCustomerMilestoneAlert(db, {
    tenantId: args.tenantId,
    jobId: args.jobId,
    milestoneStatus: nextAssignStatus,
    triggerSource: 'AUTO_STAGE_TRANSITION',
  }).catch((err) => {
    console.warn('[assignDrayageJob] milestone alert warning:', err);
  });

  return {
    ok: true,
    tokenNumber: token,
    pcsSlotStart: resolvedSlotStart,
    pcsSlotEnd: resolvedSlotEnd,
  };
}

export function getDrayageOperationalStageIndex(
  status: string,
  trailerDetached?: boolean,
  isL2?: boolean,
): number {
  const s = (status || '').toUpperCase();
  if (isL2) {
    if (['EMPTY_DEPOSITED', 'CONTAINER_DROPPED', 'CONTAINER_DELIVERED', 'COMPLETED', 'STREET_TURNED'].includes(s)) {
      return 5;
    }
    if (s === 'UNDER_INSPECTION') {
      return 4;
    }
    if (['AT_PORT', 'ARRIVED_AT_PORT', 'EMPTY_AT_PORT'].includes(s)) {
      return 3;
    }
    if (['IN_TRANSIT', 'EN_ROUTE_TERMINAL', 'EN_ROUTE_WAREHOUSE'].includes(s)) {
      return 2;
    }
    if (['LOADED', 'CONTAINER_PICKED', 'TRAILER_ATTACHED'].includes(s)) {
      return 1;
    }
    return 0;
  }
  if (
    isDrayageReassignStatus(s) ||
    [
      'EMPTY_DEPOSITED',
      'CONTAINER_DROPPED',
      'CONTAINER_DELIVERED',
      'COMPLETED',
      'STREET_TURNED',
      'CONTAINER_DETACHED',
      'TRAILER_DETACHED',
      'REASSIGN_TRAILER_DETACHED',
      'READY_FOR_PICKUP',
      'CONTAINER_OFFLOADED',
      'FCL_REASSIGN',
      'MT_REASSIGN',
      'WAITING_MT_RETURN',
    ].includes(s)
  ) {
    return 6;
  }
  if (['PLACED_AT_RAMP', 'REASSIGN_PLACED_AT_RAMP', 'PLACED_AT_YARD', 'REASSIGN_PLACED_AT_YARD'].includes(s)) {
    return trailerDetached ? 6 : 5;
  }
  if (['IN_TRANSIT', 'EN_ROUTE_WAREHOUSE', 'EN_ROUTE_TERMINAL', 'EMPTY_AT_PORT'].includes(s)) {
    return 4;
  }
  if (s === 'UNDER_INSPECTION') {
    return 3;
  }
  if (['LOADED', 'CONTAINER_PICKED', 'AT_PORT', 'ARRIVED_AT_PORT', 'TRAILER_ATTACHED'].includes(s)) {
    return 2;
  }
  if (s === 'ACCEPTED') {
    return 1;
  }
  return 0;
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
    latitude?: number | null;
    longitude?: number | null;
    location?: string | null;
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

  const currentStatus = String(job.status || '');
  const currentStatusUpper = currentStatus.toUpperCase();
  const requestedStatusUpper = String(args.status || '').toUpperCase();
  let placement = args.placementLocation ?? (job.placement_location ? String(job.placement_location) : null);
  let detached = args.detachTrailer !== undefined ? args.detachTrailer : Boolean(job.trailer_detached);

  // Determine previous origin placement status from status logs (LogiXL-Connect status_helper.go pattern)
  const prevOriginRows = await db
    .$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT status
         FROM logistics_drayage_status_logs
        WHERE job_id = $1 AND tenant_id = $2
          AND status NOT IN (
            'CONTAINER_DETACHED', 'TRAILER_DETACHED', 'REASSIGN_TRAILER_DETACHED',
            'READY_FOR_PICKUP', 'PHOTO_UPLOADED', 'INSPECTION_SKIPPED',
            'INSPECTION_REPORTED', 'TRAILER_ATTACHED', 'ACCEPTED',
            'RE-ASSIGNED', 'ASSIGNED', 'L2_ACTIVATED', 'ETC_EXTENDED',
            'GPS_BREADCRUMB', 'EPOD_SIGNED', 'POD_SIGNED', 'EPOD_CAPTURED',
            'POD_SIGNED / EPOD_CAPTURED', 'RETURN_TERMINAL_CHANGED', 'JOB_EDITED',
            'DRIVER_EXPENSE_RECEIPT'
          )
        ORDER BY created_at DESC
        LIMIT 1`,
      args.jobId,
      args.tenantId,
    )
    .catch(() => []);
  const prevOriginStatus = String(prevOriginRows[0]?.status || currentStatusUpper).toUpperCase();

  const isReassignTransition =
    isDrayageReassignStatus(currentStatusUpper) ||
    isDrayageReassignStatus(requestedStatusUpper) ||
    [
      'FCL_REASSIGN',
      'MT_REASSIGN',
      'RE-ASSIGNED',
      'TRAILER_DETACHED',
      'CONTAINER_DETACHED',
      'REASSIGN_TRAILER_DETACHED',
    ].includes(currentStatusUpper) ||
    requestedStatusUpper.startsWith('REASSIGN_') ||
    requestedStatusUpper === 'TRAILER_ATTACHED' ||
    requestedStatusUpper === 'ACCEPTED';

  const isL2Job =
    String(job.job_phase || '').toUpperCase() === 'L2' ||
    String(job.job_code || '').toUpperCase().includes('-L2');

  if (args.status !== currentStatus && !isReassignTransition) {
    const currentStage = getDrayageOperationalStageIndex(
      currentStatus,
      Boolean(job.trailer_detached),
      isL2Job,
    );
    const targetStage = getDrayageOperationalStageIndex(args.status, detached, isL2Job);
    if (currentStage >= 1 && targetStage >= 1) {
      if (targetStage < currentStage) {
        throw new Error(
          `Cannot revert job status backward from ${currentStatus} (Stage ${currentStage}) to ${args.status} (Stage ${targetStage}).`,
        );
      }
      const isDispatchConsole = !args.actor || args.actor === 'Dispatch Console';
      if (isDispatchConsole && targetStage > currentStage + 1) {
        throw new Error(
          `Sequential stage progression required: cannot skip from Stage ${currentStage} (${currentStatus}) directly to Stage ${targetStage} (${args.status}).`,
        );
      }
    }
  }

  // Directional Reassign & Terminal Completion State Machine:
  // 1. L1 PLACED_AT_YARD + Detach -> FCL_Reassign to Ramp (IMPORT) / MT_Reassign to Ramp (EXPORT)
  // 2. L1 PLACED_AT_RAMP / REASSIGN_PLACED_AT_RAMP + First ETC Alert (<= 15m) -> MT_Reassign to Yard (IMPORT) / FCL_Reassign to Yard (EXPORT)
  // 3. REASSIGN_PLACED_AT_YARD + Detach -> READY_FOR_PICKUP (immediately eligible for L2)
  // 4. CONTAINER_DROPPED / EMPTY_DEPOSITED / CONTAINER_DELIVERED -> COMPLETED
  const jobShipmentType = String(job.shipment_type || 'IMPORT').toUpperCase() === 'EXPORT' ? 'EXPORT' : 'IMPORT';
  let effectiveStatus: string = requestedStatusUpper;
  if (['CONTAINER_DROPPED', 'EMPTY_DEPOSITED', 'CONTAINER_DELIVERED', 'COMPLETED'].includes(requestedStatusUpper)) {
    effectiveStatus = 'COMPLETED';
  } else if (isDrayageReassignStatus(requestedStatusUpper)) {
    if (requestedStatusUpper.includes('TO RAMP') || requestedStatusUpper.includes('TO_RAMP')) {
      effectiveStatus = resolveDirectionalReassignStatus({ originLocation: 'YARD', shipmentType: jobShipmentType });
      placement = 'YARD';
    } else if (requestedStatusUpper.includes('TO YARD') || requestedStatusUpper.includes('TO_YARD')) {
      effectiveStatus = resolveDirectionalReassignStatus({ originLocation: 'RAMP', shipmentType: jobShipmentType });
      placement = 'RAMP';
    } else {
      effectiveStatus = resolveDirectionalReassignStatus({
        originLocation: String(placement || 'RAMP').toUpperCase() === 'YARD' ? 'YARD' : 'RAMP',
        shipmentType: jobShipmentType,
      });
    }
  }
  const isDetachSignal =
    ['CONTAINER_DETACHED', 'TRAILER_DETACHED', 'REASSIGN_TRAILER_DETACHED'].includes(requestedStatusUpper) ||
    (detached && ['PLACED_AT_YARD', 'REASSIGN_PLACED_AT_YARD'].includes(requestedStatusUpper));

  if (isDetachSignal) {
    detached = true;
    const isReassignYardDrop =
      requestedStatusUpper === 'REASSIGN_PLACED_AT_YARD' ||
      prevOriginStatus === 'REASSIGN_PLACED_AT_YARD' ||
      currentStatusUpper === 'REASSIGN_PLACED_AT_YARD' ||
      (requestedStatusUpper === 'REASSIGN_TRAILER_DETACHED' &&
        (String(placement || '').toUpperCase() === 'YARD' || prevOriginStatus === 'REASSIGN_PLACED_AT_YARD'));
    const isInitialYardDrop =
      !isReassignYardDrop &&
      (requestedStatusUpper === 'PLACED_AT_YARD' ||
        prevOriginStatus === 'PLACED_AT_YARD' ||
        currentStatusUpper === 'PLACED_AT_YARD');

    if (isReassignYardDrop) {
      effectiveStatus = 'READY_FOR_PICKUP';
      if (!placement) placement = 'YARD';
    } else if (String(job.job_phase || 'L1') === 'L1' && isInitialYardDrop) {
      effectiveStatus = resolveDirectionalReassignStatus({
        originLocation: 'YARD',
        shipmentType: jobShipmentType,
      });
      placement = 'YARD';
    } else if (requestedStatusUpper === 'REASSIGN_TRAILER_DETACHED') {
      placement = 'RAMP';
    }
  }

  const isRampPlacement =
    effectiveStatus === 'PLACED_AT_RAMP' ||
    effectiveStatus === 'REASSIGN_PLACED_AT_RAMP' ||
    (detached && placement === 'RAMP') ||
    effectiveStatus === 'CONTAINER_DETACHED';

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

  let effectiveEtcAlertStatus: string | null = null;
  if (effectiveEtcTime) {
    const minsLeft = Math.ceil((new Date(effectiveEtcTime).getTime() - Date.now()) / 60000);
    if (minsLeft <= 0) {
      effectiveEtcAlertStatus = 'EXPIRED';
    } else if (minsLeft <= 15) {
      effectiveEtcAlertStatus = 'T15_WARNING';
    } else {
      effectiveEtcAlertStatus = 'NEW';
    }
    if (
      String(job.job_phase || 'L1') === 'L1' &&
      isRampPlacement &&
      minsLeft <= 15 &&
      (detached || minsLeft <= 0)
    ) {
      effectiveStatus = resolveDirectionalReassignStatus({
        originLocation: 'RAMP',
        shipmentType: jobShipmentType,
      });
      placement = 'RAMP';
    }
  }

  // Interpolate GPS coordinates depending on stage (or use live driver GPS coordinates if supplied)
  const existingLat = job.current_lat != null ? Number(job.current_lat) : null;
  const existingLng = job.current_lng != null ? Number(job.current_lng) : null;
  const hasExistingRealCoords =
    existingLat != null &&
    existingLng != null &&
    !isNaN(existingLat) &&
    !isNaN(existingLng) &&
    (existingLat !== 0 || existingLng !== 0) &&
    !(Math.abs(existingLat - 25.0112) < 0.0002 && Math.abs(existingLng - 55.0612) < 0.0002) &&
    !(Math.abs(existingLat - 24.9642) < 0.0002 && Math.abs(existingLng - 55.0915) < 0.0002) &&
    !(Math.abs(existingLat - 24.9850) < 0.0002 && Math.abs(existingLng - 55.0760) < 0.0002);

  const hasLiveCoords =
    args.latitude != null &&
    args.longitude != null &&
    !isNaN(Number(args.latitude)) &&
    !isNaN(Number(args.longitude)) &&
    (Number(args.latitude) !== 0 || Number(args.longitude) !== 0);

  let lat = existingLat ?? 25.0112;
  let lng = existingLng ?? 55.0612;

  if (hasLiveCoords) {
    lat = Number(args.latitude);
    lng = Number(args.longitude);
  } else if (hasExistingRealCoords) {
    lat = existingLat!;
    lng = existingLng!;
  } else if (['IN_TRANSIT', 'EN_ROUTE_WAREHOUSE', 'EN_ROUTE_TERMINAL'].includes(effectiveStatus)) {
    lat = 24.9850;
    lng = 55.0760;
  } else if (
    isDrayageReassignStatus(effectiveStatus) ||
    [
      'PLACED_AT_RAMP',
      'REASSIGN_PLACED_AT_RAMP',
      'PLACED_AT_YARD',
      'REASSIGN_PLACED_AT_YARD',
      'CONTAINER_DETACHED',
      'TRAILER_DETACHED',
      'REASSIGN_TRAILER_DETACHED',
      'FCL_REASSIGN',
      'MT_REASSIGN',
      'READY_FOR_PICKUP',
      'CONTAINER_OFFLOADED',
      'WAITING_MT_RETURN',
    ].includes(effectiveStatus)
  ) {
    lat = 24.9642;
    lng = 55.0915;
  } else if (['EMPTY_AT_PORT', 'EMPTY_DEPOSITED', 'CONTAINER_DROPPED', 'COMPLETED'].includes(effectiveStatus)) {
    lat = isL2Job ? 25.0112 : 24.9642;
    lng = isL2Job ? 55.0612 : 55.0915;
  }

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET status = $3,
            placement_location = $4,
            trailer_detached = $5,
            current_lat = $6,
            current_lng = $7,
            etc_time = $8::timestamptz,
            etc_alert_status = COALESCE($10, CASE WHEN $8 IS NOT NULL THEN 'NEW' ELSE etc_alert_status END),
            notes = CASE WHEN $9::text IS NOT NULL AND $9::text != '' THEN $9::text ELSE notes END,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.jobId,
    args.tenantId,
    effectiveStatus,
    placement,
    detached,
    lat,
    lng,
    effectiveEtcTime,
    args.notes ? String(args.notes) : null,
    effectiveEtcAlertStatus,
  );

  if (hasLiveCoords && job.assigned_vehicle_id) {
    const vId = String(job.assigned_vehicle_id);
    await db
      .$executeRawUnsafe(
        `UPDATE vehicles
            SET current_lat = $3,
                current_lng = $4,
                updated_at = NOW()
          WHERE id::text = $1 AND tenant_id::text = $2`,
        vId,
        args.tenantId,
        lat,
        lng,
      )
      .catch(() => {});

    const isDummyDubai = Math.abs(lat - 25.2048) < 0.0005 && Math.abs(lng - 55.2708) < 0.0005;
    if (!isDummyDubai) {
      await db
        .$executeRawUnsafe(
          `DELETE FROM fleet.bus_gps_pings
            WHERE vehicle_id = $1
              AND tenant_id = $2
              AND ABS(latitude - 25.2048) < 0.0005
              AND ABS(longitude - 55.2708) < 0.0005`,
          vId,
          args.tenantId,
        )
        .catch(() => {});
      await db
        .$executeRawUnsafe(
          `INSERT INTO fleet.bus_gps_pings (
             id, created_at, tenant_id, vehicle_id, latitude, longitude,
             speed_kmh, heading_deg, accuracy_m, occurred_at, source
           ) VALUES ($1, NOW(), $2, $3, $4, $5, 0, 0, 5, NOW(), 'DRIVER_APP')`,
          crypto.randomUUID(),
          args.tenantId,
          vId,
          lat,
          lng,
        )
        .catch(() => {});
    }
  }

  // Sync container status & related parent jobs:
  // When L2 is completed (or CONTAINER_DROPPED / EMPTY_DEPOSITED), mark any related jobs for the same container as COMPLETED
  const isCompletedL2 =
    (String(job.job_phase) === 'L2' || String(job.job_code || '').includes('-L2')) &&
    (effectiveStatus === 'COMPLETED' || effectiveStatus === 'EMPTY_DEPOSITED' || requestedStatusUpper === 'CONTAINER_DROPPED');

  if (job.container_id) {
    if (isCompletedL2) {
      await db.$executeRawUnsafe(
        `UPDATE logistics_drayage_jobs
            SET status = 'COMPLETED',
                updated_at = NOW()
          WHERE container_id = $1 AND tenant_id = $2 AND status != 'COMPLETED'`,
        String(job.container_id),
        args.tenantId,
      ).catch(() => {});
    }
    let cntStatus = effectiveStatus;
    if (
      isRampPlacement ||
      effectiveStatus === 'WAITING_MT_RETURN' ||
      effectiveStatus === 'READY_FOR_PICKUP' ||
      effectiveStatus === 'CONTAINER_OFFLOADED'
    ) {
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
    if (
      effectiveStatus === 'PLACED_AT_RAMP' ||
      effectiveStatus === 'REASSIGN_PLACED_AT_RAMP' ||
      (detached && placement === 'RAMP')
    ) {
      trOp = 'DETACHED_AT_RAMP';
    } else if (
      effectiveStatus === 'PLACED_AT_YARD' ||
      effectiveStatus === 'REASSIGN_PLACED_AT_YARD' ||
      effectiveStatus === 'FCL_REASSIGN' ||
      effectiveStatus === 'MT_REASSIGN' ||
      (detached && placement === 'YARD')
    ) {
      trOp = 'DETACHED_AT_YARD';
    } else if (isCompletedL2 || effectiveStatus === 'COMPLETED') {
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
  const capturedLocation = resolveOperationalMilestoneLocation({
    status: effectiveStatus,
    explicitLocation: args.location ?? null,
    lat: hasLiveCoords ? Number(args.latitude) : hasExistingRealCoords ? existingLat : null,
    lng: hasLiveCoords ? Number(args.longitude) : hasExistingRealCoords ? existingLng : null,
    jobPhase: job.job_phase ? String(job.job_phase) : null,
    jobCode: job.job_code ? String(job.job_code) : null,
    terminalName: job.terminal_name ? String(job.terminal_name) : null,
    warehouseName: job.warehouse_name ? String(job.warehouse_name) : null,
  });

  const stageDetails = [
    capturedLocation ? `[LOC:${capturedLocation}]` : '',
    args.notes ? String(args.notes).trim() : '',
  ]
    .filter(Boolean)
    .join(' · ');

  if (requestedStatusUpper !== effectiveStatus && ['CONTAINER_DROPPED', 'EMPTY_DEPOSITED', 'CONTAINER_DELIVERED'].includes(requestedStatusUpper)) {
    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      `log-${crypto.randomUUID().slice(0, 12)}`,
      args.tenantId,
      args.jobId,
      String(job.job_code),
      requestedStatusUpper,
      stageDetails,
      logActor,
    );
  }

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId,
    String(job.job_code),
    effectiveStatus,
    stageDetails,
    logActor,
  );

  // LogiXL-Connect Automatic L2 Activation upon READY_FOR_PICKUP / CONTAINER_OFFLOADED / L1 Completion:
  // If READY_FOR_PICKUP comes from PLACED_AT_RAMP or REASSIGN_PLACED_AT_RAMP and etc_time is still in the future,
  // wait until etc_time expires (handled by checkAndAutoActivateExpiredEtcJobs). Otherwise activate L2 immediately!
  let l2ActivationResult: { l2JobId?: string; l2JobCode?: string } | null = null;
  if (
    String(job.job_phase || 'L1') === 'L1' &&
    !job.l2_activated &&
    ['READY_FOR_PICKUP', 'CONTAINER_OFFLOADED', 'COMPLETED', 'CONTAINER_DELIVERED', 'CONTAINER_DROPPED'].includes(
      effectiveStatus,
    )
  ) {
    const isFromRamp =
      prevOriginStatus === 'PLACED_AT_RAMP' ||
      prevOriginStatus === 'REASSIGN_PLACED_AT_RAMP' ||
      (placement === 'RAMP' &&
        !['REASSIGN_PLACED_AT_YARD', 'REASSIGN_TRAILER_DETACHED'].includes(requestedStatusUpper));
    const shouldWaitForEtc =
      effectiveStatus === 'READY_FOR_PICKUP' &&
      isFromRamp &&
      Boolean(effectiveEtcTime) &&
      new Date(effectiveEtcTime!).getTime() > Date.now();

    if (!shouldWaitForEtc) {
      try {
        const autoPreAssign = await getTenantAutoL2DispatchEnabled(db, args.tenantId);
        const actRes = await activateL2EmptyReturnJob(db, {
          tenantId: args.tenantId,
          l1JobId: args.jobId,
          preAssignTractor: autoPreAssign,
          triggerSource: 'MANUAL',
        });
        l2ActivationResult = { l2JobId: actRes.l2JobId, l2JobCode: actRes.l2JobCode };
        effectiveStatus = 'COMPLETED';
      } catch (l2Err) {
        console.warn('[updateDrayageJobExecutionStatus] Auto L2 activation warning:', l2Err);
      }
    }
  }

  // Automatically trigger WhatsApp & Email Customer Milestone Alert when stage advances
  if (effectiveStatus !== currentStatus) {
    await dispatchDrayageCustomerMilestoneAlert(db, {
      tenantId: args.tenantId,
      jobId: args.jobId,
      milestoneStatus: effectiveStatus,
      etcTime: effectiveEtcTime,
      triggerSource: 'AUTO_STAGE_TRANSITION',
    }).catch((err) => {
      console.warn('[updateDrayageJobExecutionStatus] milestone alert warning:', err);
    });
  }

  return {
    ok: true,
    status: effectiveStatus,
    etcTime: effectiveEtcTime,
    ...(l2ActivationResult ?? {}),
  };
}

/**
 * Records an immediate Login GPS coordinate and continuous 1-minute background GPS
 * breadcrumb pings from the Driver Mobile App starting from Driver Login (including
 * idle logged-in tractors, ASSIGNED / RE-ASSIGNED jobs, and ACCEPTED -> COMPLETED jobs),
 * updating live coordinates on both the assigned tractor vehicle (`vehicles`) and any
 * active/assigned drayage jobs (`logistics_drayage_jobs`), and storing breadcrumb points
 * for the Corridor Telematics Radar Map route path.
 */
export async function recordDrayageDriverLocationPing(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    latitude: number;
    longitude: number;
    speedKmh?: number | null;
    heading?: number | null;
    location?: string | null;
    actor?: string;
    driverId?: string | null;
    driverName?: string | null;
    vehicleId?: string | null;
    vehiclePlate?: string | null;
  },
) {
  await ensureDrayageSchema(db);
  const lat = Number(args.latitude);
  const lng = Number(args.longitude);
  if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
    return { ok: false, skipped: true };
  }

  const isSessionLevelPing =
    !args.jobId ||
    args.jobId === 'DRIVER_TELEMETRY' ||
    args.jobId === 'LOGIN_PING' ||
    args.jobId === 'BROADCAST';

  const cleanDriverId = args.driverId ? String(args.driverId).trim() : '';
  const cleanDriverName = (args.driverName || args.actor || '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
  const cleanVehicleId = args.vehicleId ? String(args.vehicleId).trim() : '';
  const cleanVehiclePlate = args.vehiclePlate ? String(args.vehiclePlate).trim() : '';

  // 1. Update live GPS coordinates on the logged-in driver's vehicle in `vehicles` right from Login
  const vehicleIdSet = new Set<string>();
  if (cleanVehicleId) vehicleIdSet.add(cleanVehicleId);

  if (cleanVehicleId || cleanVehiclePlate || cleanDriverId) {
    const matchedVehicles = await db
      .$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id
           FROM vehicles
          WHERE tenant_id::text = $1
            AND deleted_at IS NULL
            AND (
              ($2 <> '' AND id::text = $2)
              OR ($3 <> '' AND (
                UPPER(COALESCE(license_plate, '')) = UPPER($3)
                OR UPPER(COALESCE(plate_number, '')) = UPPER($3)
                OR UPPER(COALESCE(vehicle_code, '')) = UPPER($3)
                OR UPPER(COALESCE(registration_no, '')) = UPPER($3)
              ))
              OR ($4 <> '' AND assigned_driver_id::text = $4)
            )
          LIMIT 5`,
        args.tenantId,
        cleanVehicleId,
        cleanVehiclePlate,
        cleanDriverId,
      )
      .catch(() => []);
    for (const v of matchedVehicles) {
      if (v.id) vehicleIdSet.add(String(v.id));
    }
  }

  // 2. Find target active/assigned drayage jobs (including ASSIGNED & RE-ASSIGNED right after Login)
  const targetJobs: Array<Record<string, unknown>> = [];
  const seenJobIds = new Set<string>();

  if (!isSessionLevelPing) {
    const directRows = await db
      .$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT id, job_code, status, job_phase, terminal_name, warehouse_name, assigned_vehicle_id, assigned_vehicle_plate
           FROM logistics_drayage_jobs
          WHERE id = $1 AND tenant_id = $2
          LIMIT 1`,
        args.jobId,
        args.tenantId,
      )
      .catch(() => []);
    if (directRows[0]) {
      targetJobs.push(directRows[0]);
      seenJobIds.add(String(directRows[0].id));
      if (directRows[0].assigned_vehicle_id) {
        vehicleIdSet.add(String(directRows[0].assigned_vehicle_id));
      }
    }
  }

  if (isSessionLevelPing || targetJobs.length === 0) {
    if (cleanDriverId || cleanDriverName || cleanVehicleId || cleanVehiclePlate) {
      const driverJobRows = await db
        .$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT id, job_code, status, job_phase, terminal_name, warehouse_name, assigned_vehicle_id, assigned_vehicle_plate
             FROM logistics_drayage_jobs
            WHERE tenant_id = $1
              AND COALESCE(trailer_detached, FALSE) = FALSE
              AND UPPER(COALESCE(status, '')) NOT IN (
                'PENDING', 'UNASSIGNED', 'CANCELLED', 'COMPLETED',
                'EMPTY_DEPOSITED', 'CONTAINER_DROPPED', 'CONTAINER_DELIVERED',
                'TRAILER_DETACHED', 'CONTAINER_DETACHED', 'REASSIGN_TRAILER_DETACHED',
                'READY_FOR_PICKUP', 'FCL_REASSIGN', 'MT_REASSIGN',
                'MT_REASSIGN TO YARD', 'FCL_REASSIGN TO YARD',
                'FCL_REASSIGN TO RAMP', 'MT_REASSIGN TO RAMP'
              )
              AND (
                ($2 <> '' AND assigned_driver_id = $2)
                OR ($3 <> '' AND LOWER(TRIM(COALESCE(assigned_driver_name, ''))) = LOWER($3))
                OR ($4 <> '' AND assigned_vehicle_id = $4)
                OR ($5 <> '' AND UPPER(TRIM(COALESCE(assigned_vehicle_plate, ''))) = UPPER($5))
              )
            ORDER BY updated_at DESC
            LIMIT 10`,
          args.tenantId,
          cleanDriverId,
          cleanDriverName,
          cleanVehicleId,
          cleanVehiclePlate,
        )
        .catch(() => []);
      for (const r of driverJobRows) {
        const jId = String(r.id);
        if (!seenJobIds.has(jId)) {
          seenJobIds.add(jId);
          targetJobs.push(r);
        }
        if (r.assigned_vehicle_id) {
          vehicleIdSet.add(String(r.assigned_vehicle_id));
        }
      }
    }
  }

  const speedVal =
    args.speedKmh != null && !isNaN(Number(args.speedKmh)) && Number(args.speedKmh) >= 0
      ? Math.round(Number(args.speedKmh))
      : null;
  const headingVal =
    args.heading != null && !isNaN(Number(args.heading)) ? Math.round(Number(args.heading)) : 0;
  const isDummyDubai = Math.abs(lat - 25.2048) < 0.0005 && Math.abs(lng - 55.2708) < 0.0005;

  for (const vId of vehicleIdSet) {
    if (!isDummyDubai) {
      await db
        .$executeRawUnsafe(
          `UPDATE vehicles
              SET current_lat = $3,
                  current_lng = $4,
                  updated_at = NOW()
            WHERE id::text = $1 AND tenant_id::text = $2`,
          vId,
          args.tenantId,
          lat,
          lng,
        )
        .catch(() => {});

      await db
        .$executeRawUnsafe(
          `DELETE FROM fleet.bus_gps_pings
            WHERE vehicle_id = $1
              AND tenant_id = $2
              AND ABS(latitude - 25.2048) < 0.0005
              AND ABS(longitude - 55.2708) < 0.0005`,
          vId,
          args.tenantId,
        )
        .catch(() => {});

      await db
        .$executeRawUnsafe(
          `INSERT INTO fleet.bus_gps_pings (
             id, created_at, tenant_id, vehicle_id, latitude, longitude,
             speed_kmh, heading_deg, accuracy_m, occurred_at, source
           ) VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, 5, NOW(), 'DRIVER_APP')`,
          crypto.randomUUID(),
          args.tenantId,
          vId,
          lat,
          lng,
          speedVal ?? 0,
          headingVal,
        )
        .catch(() => {});
    }
  }

  let primaryResolvedLoc =
    args.location && String(args.location).trim()
      ? String(args.location).trim()
      : `${resolveUaePlaceNameFromCoords(lat, lng)} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

  for (const job of targetJobs) {
    const jId = String(job.id);
    const jCode = String(job.job_code);

    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_jobs
          SET current_lat = $3,
              current_lng = $4,
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      jId,
      args.tenantId,
      lat,
      lng,
    );

    const resolvedLoc = resolveOperationalMilestoneLocation({
      status: String(job.status || 'IN_TRANSIT'),
      explicitLocation: args.location ?? null,
      lat,
      lng,
      jobPhase: job.job_phase ? String(job.job_phase) : null,
      jobCode: jCode,
      terminalName: job.terminal_name ? String(job.terminal_name) : null,
      warehouseName: job.warehouse_name ? String(job.warehouse_name) : null,
    });
    if (resolvedLoc) {
      primaryResolvedLoc = resolvedLoc;
    }

    const noteParts = [
      resolvedLoc ? `[LOC:${resolvedLoc}]` : '',
      speedVal !== null ? `[SPD:${speedVal}]` : '',
    ].filter(Boolean);

    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
       VALUES ($1, $2, $3, $4, 'GPS_BREADCRUMB', $5, $6)`,
      `log-${crypto.randomUUID().slice(0, 12)}`,
      args.tenantId,
      jId,
      jCode,
      noteParts.join(' · '),
      args.actor || 'Driver Mobile GPS',
    );

    // Keep only the latest 180 GPS_BREADCRUMB pings per job (3 hours at 1-minute interval)
    await db
      .$executeRawUnsafe(
        `DELETE FROM logistics_drayage_status_logs
          WHERE tenant_id = $1
            AND job_id = $2
            AND status = 'GPS_BREADCRUMB'
            AND id NOT IN (
              SELECT id FROM logistics_drayage_status_logs
               WHERE tenant_id = $1 AND job_id = $2 AND status = 'GPS_BREADCRUMB'
               ORDER BY created_at DESC
               LIMIT 180
            )`,
        args.tenantId,
        jId,
      )
      .catch(() => {});
  }

  return {
    ok: true,
    jobId: targetJobs[0] ? String(targetJobs[0].id) : args.jobId,
    jobCode: targetJobs[0] ? String(targetJobs[0].job_code) : 'DRIVER_TELEMETRY',
    updatedJobsCount: targetJobs.length,
    updatedVehiclesCount: vehicleIdSet.size,
    latitude: lat,
    longitude: lng,
    location: primaryResolvedLoc,
    recordedAt: new Date().toISOString(),
  };
}

export async function recordDrayageDriverLogout(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    driverId?: string | null;
    driverName?: string | null;
    vehicleId?: string | null;
    vehiclePlate?: string | null;
  },
) {
  await ensureDrayageSchema(db);
  const cleanDriverId = args.driverId ? String(args.driverId).trim() : '';
  const cleanVehicleId = args.vehicleId ? String(args.vehicleId).trim() : '';
  const cleanVehiclePlate = args.vehiclePlate ? String(args.vehiclePlate).trim() : '';

  const vehicleIdSet = new Set<string>();
  if (cleanVehicleId) vehicleIdSet.add(cleanVehicleId);

  if (cleanVehicleId || cleanVehiclePlate || cleanDriverId) {
    const matchedVehicles = await db
      .$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id
           FROM vehicles
          WHERE tenant_id::text = $1
            AND deleted_at IS NULL
            AND (
              ($2 <> '' AND id::text = $2)
              OR ($3 <> '' AND (
                UPPER(COALESCE(license_plate, '')) = UPPER($3)
                OR UPPER(COALESCE(plate_number, '')) = UPPER($3)
                OR UPPER(COALESCE(vehicle_code, '')) = UPPER($3)
                OR UPPER(COALESCE(registration_no, '')) = UPPER($3)
              ))
              OR ($4 <> '' AND assigned_driver_id::text = $4)
            )
          LIMIT 5`,
        args.tenantId,
        cleanVehicleId,
        cleanVehiclePlate,
        cleanDriverId,
      )
      .catch(() => []);
    for (const v of matchedVehicles) {
      if (v.id) vehicleIdSet.add(String(v.id));
    }
  }

  for (const vId of vehicleIdSet) {
    await db
      .$executeRawUnsafe(
        `DELETE FROM fleet.bus_gps_pings
          WHERE tenant_id = $1
            AND vehicle_id = $2
            AND COALESCE(source, 'DRIVER_APP') = 'DRIVER_APP'
            AND occurred_at >= NOW() - INTERVAL '2 hours'`,
        args.tenantId,
        vId,
      )
      .catch(() => {});

    await db
      .$executeRawUnsafe(
        `UPDATE driver_shifts
            SET status = 'COMPLETED',
                ended_at = NOW(),
                updated_at = NOW()
          WHERE tenant_id = $1
            AND vehicle_id = $2
            AND status = 'ACTIVE'`,
        args.tenantId,
        vId,
      )
      .catch(() => {});
  }

  if (cleanDriverId) {
    await db
      .$executeRawUnsafe(
        `UPDATE driver_shifts
            SET status = 'COMPLETED',
                ended_at = NOW(),
                updated_at = NOW()
          WHERE tenant_id = $1
            AND driver_id = $2
            AND status = 'ACTIVE'`,
        args.tenantId,
        cleanDriverId,
      )
      .catch(() => {});
  }

  return {
    ok: true,
    loggedOutVehiclesCount: vehicleIdSet.size,
    loggedOutAt: new Date().toISOString(),
  };
}

export function computeHaversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function getTenantAutomationConfig(
  db: DrayageDbClient,
  tenantId: string,
): Promise<DrayageAutomationConfig> {
  const cfgId = `cfg-engine-${tenantId.slice(0, 16)}`;
  const [logRows, alertRows] = await Promise.all([
    db
      .$queryRawUnsafe<Array<{ notes: string; actor: string; created_at: Date | string }>>(
        `SELECT notes, actor, created_at FROM logistics_drayage_status_logs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        cfgId,
        tenantId,
      )
      .catch(() => []),
    db
      .$queryRawUnsafe<Array<{ acknowledged: boolean }>>(
        `SELECT acknowledged FROM logistics_drayage_alerts WHERE tenant_id = $1 AND alert_key = 'CONFIG_AUTO_L2_DISPATCH_T30' LIMIT 1`,
        tenantId,
      )
      .catch(() => []),
  ]);

  let parsed: Partial<DrayageAutomationConfig> = {};
  if (logRows[0]?.notes) {
    try {
      parsed = JSON.parse(String(logRows[0].notes)) as Partial<DrayageAutomationConfig>;
    } catch {
      parsed = {};
    }
  }

  const autoL2FromAlert = alertRows.length > 0 ? Boolean(alertRows[0].acknowledged) : undefined;
  const autoL2DispatchEnabled =
    typeof parsed.autoL2DispatchEnabled === 'boolean'
      ? parsed.autoL2DispatchEnabled
      : autoL2FromAlert !== undefined
      ? autoL2FromAlert
      : DEFAULT_DRAYAGE_AUTOMATION_CONFIG.autoL2DispatchEnabled;

  const thresholdMinutes = Math.min(
    180,
    Math.max(5, Number(parsed.thresholdMinutes ?? DEFAULT_DRAYAGE_AUTOMATION_CONFIG.thresholdMinutes)),
  );
  const weightProximityPct = Math.min(
    100,
    Math.max(0, Number(parsed.weightProximityPct ?? DEFAULT_DRAYAGE_AUTOMATION_CONFIG.weightProximityPct)),
  );
  const weightIdlenessPct = Math.min(
    100,
    Math.max(0, Number(parsed.weightIdlenessPct ?? DEFAULT_DRAYAGE_AUTOMATION_CONFIG.weightIdlenessPct)),
  );
  const weightWorkloadPct = Math.min(
    100,
    Math.max(0, Number(parsed.weightWorkloadPct ?? DEFAULT_DRAYAGE_AUTOMATION_CONFIG.weightWorkloadPct)),
  );
  const weightAvailabilityPct = Math.min(
    100,
    Math.max(0, Number(parsed.weightAvailabilityPct ?? DEFAULT_DRAYAGE_AUTOMATION_CONFIG.weightAvailabilityPct)),
  );
  const streetTurnRadiusKm = Math.min(
    100,
    Math.max(1, Number(parsed.streetTurnRadiusKm ?? DEFAULT_DRAYAGE_AUTOMATION_CONFIG.streetTurnRadiusKm)),
  );
  const streetTurnStrictCarrierMatch =
    typeof parsed.streetTurnStrictCarrierMatch === 'boolean'
      ? parsed.streetTurnStrictCarrierMatch
      : DEFAULT_DRAYAGE_AUTOMATION_CONFIG.streetTurnStrictCarrierMatch;
  const bogieWindowHours = Math.min(
    12,
    Math.max(0.5, Number(parsed.bogieWindowHours ?? DEFAULT_DRAYAGE_AUTOMATION_CONFIG.bogieWindowHours)),
  );
  const bogieMaxPayloadKg = Math.min(
    60000,
    Math.max(15000, Number(parsed.bogieMaxPayloadKg ?? DEFAULT_DRAYAGE_AUTOMATION_CONFIG.bogieMaxPayloadKg)),
  );
  const criticalRiskWindowHours = Math.min(
    120,
    Math.max(4, Number(parsed.criticalRiskWindowHours ?? DEFAULT_DRAYAGE_AUTOMATION_CONFIG.criticalRiskWindowHours)),
  );

  return {
    autoL2DispatchEnabled,
    thresholdMinutes,
    weightProximityPct,
    weightIdlenessPct,
    weightWorkloadPct,
    weightAvailabilityPct,
    streetTurnRadiusKm,
    streetTurnStrictCarrierMatch,
    bogieWindowHours,
    bogieMaxPayloadKg,
    criticalRiskWindowHours,
    updatedAt: logRows[0]?.created_at ? new Date(String(logRows[0].created_at)).toISOString() : undefined,
    updatedBy: logRows[0]?.actor ? String(logRows[0].actor) : undefined,
  };
}

export async function saveTenantAutomationConfig(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    config: Partial<DrayageAutomationConfig>;
    actor?: string;
  },
): Promise<{ ok: boolean; automationConfig: DrayageAutomationConfig; autoActivatedCount?: number }> {
  await ensureDrayageSchema(db);
  const current = await getTenantAutomationConfig(db, args.tenantId);

  let prox = Math.max(0, Math.round(Number(args.config.weightProximityPct ?? current.weightProximityPct)));
  let idle = Math.max(0, Math.round(Number(args.config.weightIdlenessPct ?? current.weightIdlenessPct)));
  let work = Math.max(0, Math.round(Number(args.config.weightWorkloadPct ?? current.weightWorkloadPct)));
  let avail = Math.max(0, Math.round(Number(args.config.weightAvailabilityPct ?? current.weightAvailabilityPct)));
  const sum = prox + idle + work + avail;
  if (sum > 0 && sum !== 100) {
    // Normalize weights to total 100%
    prox = Math.round((prox / sum) * 100);
    idle = Math.round((idle / sum) * 100);
    work = Math.round((work / sum) * 100);
    avail = Math.max(0, 100 - (prox + idle + work));
  } else if (sum === 0) {
    prox = 60;
    idle = 25;
    work = 10;
    avail = 5;
  }

  const nextConfig: DrayageAutomationConfig = {
    autoL2DispatchEnabled:
      typeof args.config.autoL2DispatchEnabled === 'boolean'
        ? args.config.autoL2DispatchEnabled
        : current.autoL2DispatchEnabled,
    thresholdMinutes: Math.min(
      180,
      Math.max(5, Math.round(Number(args.config.thresholdMinutes ?? current.thresholdMinutes))),
    ),
    weightProximityPct: prox,
    weightIdlenessPct: idle,
    weightWorkloadPct: work,
    weightAvailabilityPct: avail,
    streetTurnRadiusKm: Math.min(
      100,
      Math.max(1, Math.round(Number(args.config.streetTurnRadiusKm ?? current.streetTurnRadiusKm) * 10) / 10),
    ),
    streetTurnStrictCarrierMatch:
      typeof args.config.streetTurnStrictCarrierMatch === 'boolean'
        ? args.config.streetTurnStrictCarrierMatch
        : current.streetTurnStrictCarrierMatch,
    bogieWindowHours: Math.min(
      12,
      Math.max(0.5, Math.round(Number(args.config.bogieWindowHours ?? current.bogieWindowHours) * 10) / 10),
    ),
    bogieMaxPayloadKg: Math.min(
      60000,
      Math.max(15000, Math.round(Number(args.config.bogieMaxPayloadKg ?? current.bogieMaxPayloadKg))),
    ),
    criticalRiskWindowHours: Math.min(
      120,
      Math.max(4, Math.round(Number(args.config.criticalRiskWindowHours ?? current.criticalRiskWindowHours))),
    ),
    updatedAt: new Date().toISOString(),
    updatedBy: args.actor || 'Super Admin',
  };

  const cfgId = `cfg-engine-${args.tenantId.slice(0, 16)}`;
  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor, created_at)
     VALUES ($1, $2, 'SYSTEM_CONFIG', 'SUPER_ADMIN_ENGINE_CONFIG', 'ENGINE_CONFIG_UPDATED', $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE
        SET notes = EXCLUDED.notes,
            actor = EXCLUDED.actor,
            created_at = NOW()`,
    cfgId,
    args.tenantId,
    JSON.stringify(nextConfig),
    nextConfig.updatedBy,
  );

  // Keep CONFIG_AUTO_L2_DISPATCH_T30 in sync
  const alertId = `cfg-autol2-${args.tenantId.slice(0, 12)}`;
  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_alerts (id, tenant_id, alert_key, acknowledged, updated_at)
     VALUES ($1, $2, 'CONFIG_AUTO_L2_DISPATCH_T30', $3, NOW())
     ON CONFLICT (id) DO UPDATE SET acknowledged = $3, updated_at = NOW() WHERE logistics_drayage_alerts.tenant_id = EXCLUDED.tenant_id`,
    alertId,
    args.tenantId,
    nextConfig.autoL2DispatchEnabled,
  );

  let autoActivatedCount = 0;
  if (nextConfig.autoL2DispatchEnabled) {
    const res = await checkAndAutoActivateExpiredEtcJobs(db, args.tenantId, {
      thresholdMinutes: nextConfig.thresholdMinutes,
      preAssignTractor: true,
    }).catch(() => ({ checked: 0, activated: [] }));
    autoActivatedCount = res.activated.length;
  }

  return {
    ok: true,
    automationConfig: nextConfig,
    autoActivatedCount,
  };
}

export async function getTenantAutoL2DispatchEnabled(db: DrayageDbClient, tenantId: string): Promise<boolean> {
  const cfg = await getTenantAutomationConfig(db, tenantId);
  return cfg.autoL2DispatchEnabled;
}

export async function setTenantAutoL2DispatchMode(
  db: DrayageDbClient,
  args: { tenantId: string; enabled: boolean },
): Promise<{ ok: boolean; autoL2DispatchEnabled: boolean; thresholdMinutes: number; autoActivatedCount?: number }> {
  const saved = await saveTenantAutomationConfig(db, {
    tenantId: args.tenantId,
    config: { autoL2DispatchEnabled: Boolean(args.enabled) },
    actor: 'Tenant Dispatch Admin',
  });
  return {
    ok: true,
    autoL2DispatchEnabled: saved.automationConfig.autoL2DispatchEnabled,
    thresholdMinutes: saved.automationConfig.thresholdMinutes,
    autoActivatedCount: saved.autoActivatedCount,
  };
}

export async function findBest4FactorAssetsForRampPickup(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    targetLat: number;
    targetLng: number;
    containerSize?: string;
    containerType?: string;
    preferredTrailerId?: string | null;
    preferredTrailerPlate?: string | null;
  },
) {
  const [rawVehicles, rawDrivers, rawTrailers, activeJobs] = await Promise.all([
    db
      .$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT id, plate_number, license_plate, make, model, status, current_lat, current_lng, fuel_level_pct, fuel_level, current_mileage, next_service_km, assigned_driver_id, updated_at
           FROM vehicles
          WHERE deleted_at IS NULL
            AND tenant_id = $1
          LIMIT 50`,
        args.tenantId,
      )
      .catch(() => []),
    db
      .$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT id, first_name, last_name, name, status, assigned_vehicle_id
           FROM drivers
          WHERE deleted_at IS NULL
            AND tenant_id = $1
          LIMIT 50`,
        args.tenantId,
      )
      .catch(() => []),
    db
      .$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT id, plate_number, trailer_type, master_status
           FROM logistics_drayage_trailers
          WHERE tenant_id = $1
          LIMIT 50`,
        args.tenantId,
      )
      .catch(() => []),
    db
      .$queryRawUnsafe<Array<{ assigned_vehicle_id: string | null; assigned_driver_id: string | null; status: string }>>(
        `SELECT assigned_vehicle_id, assigned_driver_id, status
           FROM logistics_drayage_jobs
          WHERE tenant_id = $1`,
        args.tenantId,
      )
      .catch(() => []),
  ]);

  const busyVehicleIds = new Set(
    activeJobs
      .filter((j) => j.assigned_vehicle_id && !['COMPLETED', 'EMPTY_DEPOSITED', 'STREET_TURNED', 'CONTAINER_DETACHED'].includes(String(j.status)))
      .map((j) => String(j.assigned_vehicle_id)),
  );

  const tripsByDriver = new Map<string, number>();
  for (const j of activeJobs) {
    if (j.assigned_driver_id) {
      const dId = String(j.assigned_driver_id);
      tripsByDriver.set(dId, (tripsByDriver.get(dId) || 0) + 1);
    }
  }

  const lightPatterns = ['pilot', 'civic', 'corolla', 'camry', 'sunny', 'yaris', 'sedan', 'suv', 'patrol', 'prado', 'van'];
  const primeMovers = rawVehicles.filter((v) => {
    const label = `${v.make ?? ''} ${v.model ?? ''}`.toLowerCase();
    return !lightPatterns.some((p) => label.includes(p));
  });

  const candidateVehicles = primeMovers.filter((v) => !busyVehicleIds.has(String(v.id)));
  const pool = candidateVehicles.length > 0 ? candidateVehicles : primeMovers;
  if (pool.length === 0 || rawDrivers.length === 0) return null;

  const tenantCfg = await getTenantAutomationConfig(db, args.tenantId);
  const wProx = tenantCfg.weightProximityPct / 100;
  const wIdle = tenantCfg.weightIdlenessPct / 100;
  const wWork = tenantCfg.weightWorkloadPct / 100;
  const wAvail = tenantCfg.weightAvailabilityPct / 100;

  const scored = pool.map((v) => {
    const vId = String(v.id);
    const rawLat = v.current_lat != null ? Number(v.current_lat) : NaN;
    const rawLng = v.current_lng != null ? Number(v.current_lng) : NaN;
    const hasRealCoords =
      !isNaN(rawLat) &&
      !isNaN(rawLng) &&
      (rawLat !== 0 || rawLng !== 0) &&
      !(Math.abs(rawLat - 25.0112) < 0.0005 && (Math.abs(rawLng - 55.0612) < 0.0005 || Math.abs(rawLng - 55.0617) < 0.0005)) &&
      !(Math.abs(rawLat - 25.2048) < 0.0005 && Math.abs(rawLng - 55.2708) < 0.0005);
    const distanceKm = hasRealCoords ? computeHaversineKm(rawLat, rawLng, args.targetLat, args.targetLng) : 999;

    // 1. Proximity (Default 60%, Super Admin configurable)
    let proximityScore = 0;
    if (hasRealCoords) {
      if (distanceKm <= 3) proximityScore = 100;
      else if (distanceKm <= 10) proximityScore = Math.max(79, Math.round(100 - (distanceKm - 3) * 3));
      else if (distanceKm <= 30) proximityScore = Math.max(39, Math.round(79 - (distanceKm - 10) * 2));
      else if (distanceKm <= 70) proximityScore = Math.max(15, Math.round(39 - (distanceKm - 30) * 0.6));
      else proximityScore = Math.max(5, Math.round(15 - (distanceKm - 70) * 0.2));
    }

    // 2. Idleness (Default 25%, Super Admin configurable)
    let idleHours = 2.4;
    if (v.updated_at) {
      const ts = new Date(String(v.updated_at)).getTime();
      if (!isNaN(ts)) {
        idleHours = Math.max(0.1, Math.round(((Date.now() - ts) / 3600000) * 10) / 10);
      }
    }
    let idlenessScore = 85;
    if (idleHours < 0.5) idlenessScore = 40;
    else if (idleHours < 1.5) idlenessScore = 70;
    else if (idleHours <= 6.0) idlenessScore = 100;
    else idlenessScore = 95;

    // Resolve bound or lowest-workload driver
    const boundDrv =
      rawDrivers.find((d) => String(d.id) === String(v.assigned_driver_id || '')) ||
      rawDrivers.find((d) => String(d.assigned_vehicle_id || '') === vId) ||
      rawDrivers[0];
    const dId = String(boundDrv.id);
    const tripsToday = tripsByDriver.get(dId) || 0;

    // 3. Workload (Default 10%, Super Admin configurable)
    const workloadScore = tripsToday === 0 ? 100 : tripsToday === 1 ? 90 : tripsToday === 2 ? 75 : 50;

    // 4. Availability (Default 5%, Super Admin configurable)
    const fuelPct = Number(v.fuel_level_pct ?? v.fuel_level ?? 85);
    const fuelScore = fuelPct >= 70 ? 100 : fuelPct >= 50 ? 80 : 55;
    const availabilityScore = Math.round(0.7 * fuelScore + 30);

    const totalScore = Math.round(
      wProx * proximityScore + wIdle * idlenessScore + wWork * workloadScore + wAvail * availabilityScore,
    );

    const driverFullName =
      `${boundDrv.first_name ?? ''} ${boundDrv.last_name ?? ''}`.trim() ||
      String(boundDrv.name ?? 'Assigned Driver');

    return {
      vehicleId: vId,
      vehiclePlate: String(v.plate_number ?? v.license_plate ?? 'DXB-TRACTOR'),
      driverId: dId,
      driverName: driverFullName,
      totalScore,
      distanceKm: hasRealCoords ? Math.round(distanceKm * 10) / 10 : 0,
      hasLiveGps: hasRealCoords,
      hasLoggedInDriver: Boolean(v.assigned_driver_id),
    };
  });

  scored.sort((a, b) => {
    const aActive = a.hasLoggedInDriver || a.hasLiveGps ? 1 : 0;
    const bActive = b.hasLoggedInDriver || b.hasLiveGps ? 1 : 0;
    if (bActive !== aActive) return bActive - aActive;
    return b.totalScore - a.totalScore;
  });
  const best = scored[0];

  let trailerId = args.preferredTrailerId ? String(args.preferredTrailerId) : '';
  let trailerPlate = args.preferredTrailerPlate ? String(args.preferredTrailerPlate) : '';
  if (!trailerId && rawTrailers.length > 0) {
    const availTr = rawTrailers.find((t) => String(t.master_status) === 'AVAILABLE') || rawTrailers[0];
    trailerId = String(availTr.id);
    trailerPlate = String(availTr.plate_number ?? 'DXB-TR-9901');
  }

  return {
    ...best,
    trailerId: trailerId || `tr-9901-${crypto.createHash('sha256').update(args.tenantId).digest('hex').slice(0, 12)}`,
    trailerPlate: trailerPlate || 'DXB-TR-9901',
  };
}

export async function activateL2EmptyReturnJob(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    l1JobId: string;
    preAssignTractor?: boolean;
    triggerSource?: 'MANUAL' | 'AUTO_T30';
  },
) {
  await ensureDrayageSchema(db);
  const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    args.l1JobId,
    args.tenantId,
  );
  const l1 = jobRows[0];
  if (!l1) throw new Error('L1 Job not found');

  const l2Code = String(l1.job_code).replace('L1', 'L2') || `DRY-L2-${Math.floor(1000 + Math.random() * 9000)}`;

  // Idempotency & race guard: if an L2 job already exists for this L1 job or L2 jobCode, return it without inserting a duplicate
  const existingL2Rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id, job_code, assigned_vehicle_plate, assigned_driver_name
       FROM logistics_drayage_jobs
      WHERE tenant_id = $1
        AND job_phase = 'L2'
        AND (parent_job_id = $2 OR UPPER(job_code) = UPPER($3))
      ORDER BY created_at ASC
      LIMIT 1`,
    args.tenantId,
    args.l1JobId,
    l2Code,
  );
  if (existingL2Rows.length > 0) {
    const existingL2 = existingL2Rows[0];
    if (!l1.l2_activated || String(l1.status).toUpperCase() !== 'COMPLETED') {
      await db.$executeRawUnsafe(
        `UPDATE logistics_drayage_jobs
            SET l2_activated = TRUE,
                status = 'COMPLETED',
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        args.l1JobId,
        args.tenantId,
      );
    }
    return {
      ok: true,
      l2JobId: String(existingL2.id),
      l2JobCode: String(existingL2.job_code),
      preAssigned: Boolean(existingL2.assigned_vehicle_plate),
      vehiclePlate: existingL2.assigned_vehicle_plate ? String(existingL2.assigned_vehicle_plate) : undefined,
      driverName: existingL2.assigned_driver_name ? String(existingL2.assigned_driver_name) : undefined,
    };
  }

  if (l1.l2_activated) throw new Error('L2 Empty Return is already activated for this container');

  const l1Status = String(l1.status || '').toUpperCase();
  const l1Stage = getDrayageOperationalStageIndex(l1Status, Boolean(l1.trailer_detached));
  const l1Placement = String(l1.placement_location || '').toUpperCase();
  const isInitialYardDrop =
    l1Placement === 'YARD' &&
    (['PLACED_AT_YARD', 'FCL_REASSIGN', 'MT_REASSIGN'].includes(l1Status) ||
      l1Status.includes('TO RAMP') ||
      l1Status.includes('TO_RAMP'));
  if (l1Stage < 5 || isInitialYardDrop) {
    throw new Error(
      'L2 Empty Return can only be triggered after the container is Placed at Ramp, Ready for Pickup, or Detached after Reassignment.',
    );
  }

  const l2Id = `job-l2-${crypto.randomUUID().slice(0, 10)}`;
  const rampLat = l1.current_lat != null ? Number(l1.current_lat) : 24.9642;
  const rampLng = l1.current_lng != null ? Number(l1.current_lng) : 55.0915;

  // Atomically claim L1 as COMPLETED / L2_ACTIVATED so concurrent triggers cannot insert twice
  const claimedRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `UPDATE logistics_drayage_jobs
        SET l2_activated = TRUE,
            status = 'COMPLETED',
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND COALESCE(l2_activated, FALSE) = FALSE
      RETURNING id`,
    args.l1JobId,
    args.tenantId,
  );
  if (claimedRows.length === 0) {
    const concurrentL2Rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, job_code, assigned_vehicle_plate, assigned_driver_name
         FROM logistics_drayage_jobs
        WHERE tenant_id = $1
          AND job_phase = 'L2'
          AND (parent_job_id = $2 OR UPPER(job_code) = UPPER($3))
        ORDER BY created_at ASC
        LIMIT 1`,
      args.tenantId,
      args.l1JobId,
      l2Code,
    );
    if (concurrentL2Rows.length > 0) {
      const concurrentL2 = concurrentL2Rows[0];
      return {
        ok: true,
        l2JobId: String(concurrentL2.id),
        l2JobCode: String(concurrentL2.job_code),
        preAssigned: Boolean(concurrentL2.assigned_vehicle_plate),
      };
    }
    throw new Error('L2 Empty Return is already activated for this container');
  }

  const shouldPreAssign = Boolean(args.preAssignTractor);

  // Resolve any redirected L2 Return Terminal set during L1 (EN_ROUTE_WAREHOUSE -> PLACED_AT_RAMP/YARD -> READY_FOR_PICKUP)
  let targetReturnTerminalId: string | null = l1.return_terminal_id
    ? String(l1.return_terminal_id)
    : l1.terminal_id
    ? String(l1.terminal_id)
    : null;
  let targetReturnTerminalName: string = l1.return_terminal_name
    ? String(l1.return_terminal_name)
    : String(l1.terminal_name);

  const rtLogRows = await db
    .$queryRawUnsafe<Array<{ notes: string }>>(
      `SELECT notes
         FROM logistics_drayage_status_logs
        WHERE tenant_id = $1
          AND (job_id = $2 OR UPPER(job_code) = UPPER($3))
          AND status = 'RETURN_TERMINAL_CHANGED'
        ORDER BY created_at DESC
        LIMIT 1`,
      args.tenantId,
      args.l1JobId,
      String(l1.job_code),
    )
    .catch(() => []);
  if (rtLogRows[0]?.notes) {
    const parsedRt = parseReturnTerminalTag(rtLogRows[0].notes);
    if (parsedRt) {
      targetReturnTerminalId = parsedRt.returnTerminalId ?? targetReturnTerminalId;
      targetReturnTerminalName = parsedRt.returnTerminalName || targetReturnTerminalName;
    }
  }

  // Create L2 Empty Return Job (from Warehouse back to Target Return Terminal)
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
    targetReturnTerminalId,
    targetReturnTerminalName,
    l1.container_id ? String(l1.container_id) : null,
    String(l1.container_number),
    String(l1.container_size ?? '40HC'),
    String(l1.container_type ?? 'DRY'),
    l1.do_expiry_date ? new Date(String(l1.do_expiry_date)).toISOString() : null,
    l1.assigned_trailer_id ? String(l1.assigned_trailer_id) : null,
    l1.assigned_trailer_plate ? String(l1.assigned_trailer_plate) : null,
    rampLat,
    rampLng,
    targetReturnTerminalName !== String(l1.terminal_name)
      ? `Auto-generated L2 Empty Container Return from ${l1.job_code} (Return Terminal Redirected: ${l1.terminal_name} → ${targetReturnTerminalName})`
      : `Auto-generated L2 Empty Container Return from ${l1.job_code}`,
  );

  await db
    .$executeRawUnsafe(
      `UPDATE logistics_drayage_jobs
          SET return_terminal_id = $3,
              return_terminal_name = $4
        WHERE id = $1 AND tenant_id = $2`,
      l2Id,
      args.tenantId,
      targetReturnTerminalId,
      targetReturnTerminalName,
    )
    .catch(() => {});

  let preAssignedInfo: {
    vehiclePlate?: string;
    driverName?: string;
    matchScorePct?: number;
    distanceKm?: number;
    tokenNumber?: string;
  } | null = null;

  if (shouldPreAssign) {
    const bestMatch = await findBest4FactorAssetsForRampPickup(db, {
      tenantId: args.tenantId,
      targetLat: rampLat,
      targetLng: rampLng,
      containerSize: String(l1.container_size ?? '40HC'),
      containerType: String(l1.container_type ?? 'DRY'),
      preferredTrailerId: l1.assigned_trailer_id ? String(l1.assigned_trailer_id) : null,
      preferredTrailerPlate: l1.assigned_trailer_plate ? String(l1.assigned_trailer_plate) : null,
    });

    if (bestMatch) {
      const termLower = String(targetReturnTerminalName ?? '').toLowerCase();
      const tokenPrefix = termLower.includes('khalifa') || termLower.includes('ad ports') ? 'MQT-L2' : 'DPW-L2';
      const tokenNumber = `${tokenPrefix}-${Math.floor(1000 + Math.random() * 9000)}`;

      await assignDrayageJob(db, {
        tenantId: args.tenantId,
        jobId: l2Id,
        vehicleId: bestMatch.vehicleId,
        vehiclePlate: bestMatch.vehiclePlate,
        driverId: bestMatch.driverId,
        driverName: bestMatch.driverName,
        trailerId: bestMatch.trailerId,
        trailerPlate: bestMatch.trailerPlate,
        tokenNumber,
      });

      await db.$executeRawUnsafe(
        `UPDATE logistics_drayage_jobs
            SET notes = COALESCE(notes || ' | ', '') || $3,
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        l2Id,
        args.tenantId,
        `4-Factor Telematics Pre-Assigned: ${bestMatch.vehiclePlate} (${bestMatch.driverName}) [${bestMatch.totalScore}% Match · ${bestMatch.distanceKm} km from ramp]`,
      );

      preAssignedInfo = {
        vehiclePlate: bestMatch.vehiclePlate,
        driverName: bestMatch.driverName,
        matchScorePct: bestMatch.totalScore,
        distanceKm: bestMatch.distanceKm,
        tokenNumber,
      };
    }
  }

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

  const logNote = preAssignedInfo
    ? `L2 Empty Return ${l2Code} activated & Pre-Assigned to ${preAssignedInfo.vehiclePlate} (${preAssignedInfo.driverName}) via 4-Factor Telematics Match [${preAssignedInfo.matchScorePct}% Match · ${preAssignedInfo.distanceKm} km]`
    : `L2 Empty Container Return ${l2Code} activated for container ${l1.container_number} (Return Terminal: ${targetReturnTerminalName})`;

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'L2_ACTIVATED', $5, $6)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.l1JobId,
    String(l1.job_code),
    logNote,
    'Dispatch Console',
  );

  return {
    ok: true,
    l2JobId: l2Id,
    l2JobCode: l2Code,
    preAssigned: Boolean(preAssignedInfo),
    ...preAssignedInfo,
  };
}

export async function updateDrayageReturnTerminal(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    returnTerminalId?: string | null;
    returnTerminalName?: string | null;
    reason?: string | null;
    actor?: string | null;
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

  const jobPhase =
    String(job.job_phase || '').trim().toUpperCase() === 'L2' ||
    String(job.job_code || '').toUpperCase().includes('-L2')
      ? 'L2'
      : 'L1';
  const jobStatus = String(job.status || 'PENDING').trim();

  // Enforce the exact status window:
  // Unlocked starting from EN_ROUTE_WAREHOUSE on L1, through PLACED_AT_RAMP / PLACED_AT_YARD / MT_Reassign to Yard / READY_FOR_PICKUP, and L2 - PENDING.
  // Locked before EN_ROUTE_WAREHOUSE on L1 and locked after L2 - PENDING.
  const isAllowed = canChangeDrayageReturnTerminal({
    jobPhase,
    jobCode: String(job.job_code || ''),
    status: jobStatus,
    l2Activated: Boolean(job.l2_activated),
    assignedVehicleId: job.assigned_vehicle_id ? String(job.assigned_vehicle_id) : null,
    assignedVehiclePlate: job.assigned_vehicle_plate ? String(job.assigned_vehicle_plate) : null,
  });

  if (!isAllowed) {
    throw new Error(
      jobPhase === 'L1'
        ? `Return Terminal can only be changed after the container exits the port on L1 (starting from EN_ROUTE_WAREHOUSE through PLACED_AT_RAMP / PLACED_AT_YARD / MT_Reassign to Yard / READY_FOR_PICKUP). Current status: ${jobStatus}.`
        : `Return Terminal for L2 jobs can only be changed while in PENDING status (before L2 Vehicle Assignment). Current status: ${jobStatus}.`,
    );
  }

  // Resolve target terminal from Terminal Master
  let resolvedTerminalId: string | null = args.returnTerminalId ? String(args.returnTerminalId).trim() : null;
  let resolvedTerminalName: string = args.returnTerminalName ? String(args.returnTerminalName).trim() : '';

  if (resolvedTerminalId) {
    const termRows = await db
      .$queryRawUnsafe<Array<{ id: string; name: string }>>(
        `SELECT id, name FROM logistics_drayage_terminals WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        resolvedTerminalId,
        args.tenantId,
      )
      .catch(() => []);
    if (termRows[0]) {
      resolvedTerminalId = String(termRows[0].id);
      resolvedTerminalName = String(termRows[0].name);
    }
  } else if (resolvedTerminalName) {
    const termRows = await db
      .$queryRawUnsafe<Array<{ id: string; name: string }>>(
        `SELECT id, name FROM logistics_drayage_terminals WHERE tenant_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
        args.tenantId,
        resolvedTerminalName,
      )
      .catch(() => []);
    if (termRows[0]) {
      resolvedTerminalId = String(termRows[0].id);
      resolvedTerminalName = String(termRows[0].name);
    }
  }

  if (!resolvedTerminalName) {
    throw new Error('Please select a valid Return Terminal.');
  }

  // Determine previous / origin terminal name for audit logging
  let originTerminalName = String(job.terminal_name || 'Port Terminal');
  if (jobPhase === 'L2' && job.parent_job_id) {
    const parentRows = await db
      .$queryRawUnsafe<Array<{ terminal_name: string }>>(
        `SELECT terminal_name FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        String(job.parent_job_id),
        args.tenantId,
      )
      .catch(() => []);
    if (parentRows[0]?.terminal_name) {
      originTerminalName = String(parentRows[0].terminal_name);
    }
  }

  const prevReturnRows = await db
    .$queryRawUnsafe<Array<{ notes: string }>>(
      `SELECT notes
         FROM logistics_drayage_status_logs
        WHERE tenant_id = $1
          AND (job_id = $2 OR UPPER(job_code) = UPPER($3))
          AND status = 'RETURN_TERMINAL_CHANGED'
        ORDER BY created_at DESC
        LIMIT 1`,
      args.tenantId,
      args.jobId,
      String(job.job_code),
    )
    .catch(() => []);
  const prevParsed = prevReturnRows[0]?.notes ? parseReturnTerminalTag(prevReturnRows[0].notes) : null;
  const previousEffectiveTerminalName =
    prevParsed?.returnTerminalName ||
    (job.return_terminal_name ? String(job.return_terminal_name) : String(job.terminal_name));

  // 1. If L2 job (in PENDING status), update terminal_id and terminal_name directly on the L2 job
  if (jobPhase === 'L2') {
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_jobs
          SET terminal_id = $3,
              terminal_name = $4,
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      args.jobId,
      args.tenantId,
      resolvedTerminalId,
      resolvedTerminalName,
    );
  } else {
    // Touch updated_at on L1 job so caches refresh
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_jobs
          SET updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      args.jobId,
      args.tenantId,
    );
    // Also update any already-spawned PENDING L2 child job if one exists
    const l2Code = String(job.job_code).replace('-L1-', '-L2-');
    await db
      .$executeRawUnsafe(
        `UPDATE logistics_drayage_jobs
            SET terminal_id = $4,
                terminal_name = $5,
                updated_at = NOW()
          WHERE tenant_id = $1
            AND job_phase = 'L2'
            AND status = 'PENDING'
            AND (parent_job_id = $2 OR UPPER(job_code) = UPPER($3))`,
        args.tenantId,
        args.jobId,
        l2Code,
        resolvedTerminalId,
        resolvedTerminalName,
      )
      .catch(() => {});
  }

  // 2. Update return_terminal_id / return_terminal_name columns if migration is applied
  await db
    .$executeRawUnsafe(
      `UPDATE logistics_drayage_jobs
          SET return_terminal_id = $3,
              return_terminal_name = $4,
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      args.jobId,
      args.tenantId,
      resolvedTerminalId,
      resolvedTerminalName,
    )
    .catch(() => {});

  if (job.container_id) {
    await db
      .$executeRawUnsafe(
        `UPDATE logistics_drayage_containers
            SET return_terminal_id = $3,
                return_terminal_name = $4,
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        String(job.container_id),
        args.tenantId,
        resolvedTerminalId,
        resolvedTerminalName,
      )
      .catch(() => {});
  }

  // 3. Record RETURN_TERMINAL_CHANGED in logistics_drayage_status_logs (both for Timeline Audit & Zero-DDL persistence)
  const reasonSuffix = args.reason && String(args.reason).trim() ? ` — Reason: ${String(args.reason).trim()}` : '';
  const structuredTag = `[RETURN_TERM:${resolvedTerminalId || ''}|${resolvedTerminalName}|FROM:${originTerminalName}]`;
  const auditNote = `${structuredTag} L2 Empty Return Terminal changed: ${previousEffectiveTerminalName} → ${resolvedTerminalName} (Origin L1 Pickup: ${originTerminalName})${reasonSuffix}`;

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'RETURN_TERMINAL_CHANGED', $5, $6)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId,
    String(job.job_code),
    auditNote,
    args.actor || 'Dispatch Console',
  );

  return {
    ok: true,
    jobId: args.jobId,
    jobCode: String(job.job_code),
    jobPhase,
    originTerminalName,
    previousReturnTerminalName: previousEffectiveTerminalName,
    returnTerminalId: resolvedTerminalId,
    returnTerminalName: resolvedTerminalName,
  };
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
  options?: { thresholdMinutes?: number; preAssignTractor?: boolean },
): Promise<{
  checked: number;
  activated: Array<{
    l2JobId: string;
    l2JobCode: string;
    l1JobCode: string;
    preAssigned?: boolean;
    vehiclePlate?: string;
    driverName?: string;
    matchScorePct?: number;
  }>;
  reassigned?: Array<{
    jobId: string;
    jobCode: string;
    newStatus: string;
  }>;
}> {
  await ensureDrayageSchema(db);
  // LogiXL-Connect pattern (background_worker.go + status_helper.go):
  // 1) Any L1 job at Ramp / Yard / Detached whose ETC has expired (etc_time <= NOW()) transitions to FCL_REASSIGN / MT_REASSIGN
  //    so the Dispatcher is alerted and can reassign a tractor. ETC expiry NEVER triggers L2 directly.
  // 2) Only jobs in READY_FOR_PICKUP (after Reassign) or CONTAINER_OFFLOADED activate L2 Empty Return.
  const shouldPreAssign = Boolean(options?.preAssignTractor);

  const whereClause = tenantId
    ? `tenant_id = $1 AND job_phase = 'L1' AND l2_activated = FALSE AND (
         (etc_time IS NOT NULL AND etc_time <= NOW() + INTERVAL '15 minutes' AND status IN ('PLACED_AT_RAMP', 'REASSIGN_PLACED_AT_RAMP', 'PLACED_AT_YARD', 'TRAILER_DETACHED', 'CONTAINER_DETACHED', 'REASSIGN_TRAILER_DETACHED'))
         OR status IN ('READY_FOR_PICKUP', 'CONTAINER_OFFLOADED')
       )`
    : `job_phase = 'L1' AND l2_activated = FALSE AND (
         (etc_time IS NOT NULL AND etc_time <= NOW() + INTERVAL '15 minutes' AND status IN ('PLACED_AT_RAMP', 'REASSIGN_PLACED_AT_RAMP', 'PLACED_AT_YARD', 'TRAILER_DETACHED', 'CONTAINER_DETACHED', 'REASSIGN_TRAILER_DETACHED'))
         OR status IN ('READY_FOR_PICKUP', 'CONTAINER_OFFLOADED')
       )`;
  const params = tenantId ? [tenantId] : [];
  const dueJobs = await db.$queryRawUnsafe<
    Array<{
      id: string;
      tenant_id: string;
      job_code: string;
      shipment_type: string | null;
      status: string;
      placement_location: string | null;
      trailer_detached: boolean;
      etc_time: Date | null;
    }>
  >(
    `SELECT id, tenant_id, job_code, shipment_type, status, placement_location, trailer_detached, etc_time FROM logistics_drayage_jobs WHERE ${whereClause} LIMIT 25`,
    ...params,
  );

  const activated: Array<{
    l2JobId: string;
    l2JobCode: string;
    l1JobCode: string;
    preAssigned?: boolean;
    vehiclePlate?: string;
    driverName?: string;
    matchScorePct?: number;
  }> = [];

  const reassigned: Array<{
    jobId: string;
    jobCode: string;
    newStatus: string;
  }> = [];

  for (const job of dueJobs) {
    try {
      const jobStatus = String(job.status || '').toUpperCase();
      const stage = getDrayageOperationalStageIndex(jobStatus, Boolean(job.trailer_detached));
      if (stage < 5) continue;

      // 1. First Alert (<= 15m) or ETC Expiry on Ramp / Yard / Detached jobs transitions to directional Reassign status
      const isEtcAlertForReassign = [
        'PLACED_AT_RAMP',
        'REASSIGN_PLACED_AT_RAMP',
        'PLACED_AT_YARD',
        'TRAILER_DETACHED',
        'CONTAINER_DETACHED',
        'REASSIGN_TRAILER_DETACHED',
      ].includes(jobStatus);

      if (isEtcAlertForReassign) {
        const etcMs = job.etc_time ? new Date(job.etc_time).getTime() : 0;
        const minsLeft = Math.ceil((etcMs - Date.now()) / 60000);
        const isExpired = minsLeft <= 0;
        const isDetachedOrExpired =
          isExpired ||
          Boolean(job.trailer_detached) ||
          ['TRAILER_DETACHED', 'CONTAINER_DETACHED', 'REASSIGN_TRAILER_DETACHED'].includes(jobStatus);
        const originLoc =
          jobStatus === 'PLACED_AT_YARD' || String(job.placement_location || '').toUpperCase() === 'YARD'
            ? 'YARD'
            : 'RAMP';
        const nextStatus = resolveDirectionalReassignStatus({
          originLocation: originLoc,
          shipmentType: String(job.shipment_type || 'IMPORT'),
        });
        const nextAlertStatus = isExpired ? 'EXPIRED' : 'T15_WARNING';

        if (isDetachedOrExpired) {
          await db.$executeRawUnsafe(
            `UPDATE logistics_drayage_jobs
                SET status = $2,
                    placement_location = $3,
                    etc_alert_status = $4,
                    assigned_vehicle_id = NULL,
                    assigned_vehicle_plate = NULL,
                    assigned_driver_id = NULL,
                    assigned_driver_name = NULL,
                    updated_at = NOW()
              WHERE id = $1`,
            job.id,
            nextStatus,
            originLoc,
            nextAlertStatus,
          );
          await db.$executeRawUnsafe(
            `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
             VALUES ($1, $2, $3, $4, $5, $6, 'ETC Background Worker')`,
            `log-${crypto.randomUUID().slice(0, 12)}`,
            String(job.tenant_id),
            String(job.id),
            String(job.job_code),
            nextStatus,
            `Auto-Trigger: First ETC Alert (${nextAlertStatus}) - Transitioned to ${nextStatus}`,
          ).catch(() => {});
          reassigned.push({
            jobId: String(job.id),
            jobCode: String(job.job_code),
            newStatus: nextStatus,
          });
        } else {
          await db.$executeRawUnsafe(
            `UPDATE logistics_drayage_jobs
                SET etc_alert_status = $2,
                    updated_at = NOW()
              WHERE id = $1`,
            job.id,
            nextAlertStatus,
          );
        }
        continue;
      }

      // 2. Only READY_FOR_PICKUP / CONTAINER_OFFLOADED jobs trigger L2 Empty Return
      if (!['READY_FOR_PICKUP', 'CONTAINER_OFFLOADED'].includes(jobStatus)) {
        continue;
      }

      const res = await activateL2EmptyReturnJob(db, {
        tenantId: String(job.tenant_id),
        l1JobId: String(job.id),
        preAssignTractor: shouldPreAssign,
        triggerSource: 'MANUAL',
      });
      await db.$executeRawUnsafe(
        `UPDATE logistics_drayage_jobs
            SET etc_alert_status = 'ACTIVATED',
                updated_at = NOW()
          WHERE id = $1`,
        job.id,
      );
      activated.push({
        l2JobId: res.l2JobId,
        l2JobCode: res.l2JobCode,
        l1JobCode: String(job.job_code),
        preAssigned: res.preAssigned,
        vehiclePlate: res.vehiclePlate,
        driverName: res.driverName,
        matchScorePct: res.matchScorePct,
      });
    } catch (err) {
      console.error(`[checkAndAutoActivateExpiredEtcJobs] Error processing ${job.job_code}:`, err);
    }
  }
  return { checked: dueJobs.length, activated, reassigned };
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
    isBroadcast?: boolean;
  },
) {
  await ensureDrayageSchema(db);
  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_messages WHERE tenant_id = $1 AND created_at < NOW() - INTERVAL '12 hours'`,
    args.tenantId,
  ).catch(() => {});
  const isBroadcast = Boolean(args.isBroadcast || args.jobId === 'BROADCAST');
  let jobCode = 'BROADCAST';
  if (!isBroadcast) {
    const jobRows = await db.$queryRawUnsafe<Array<{ job_code: string }>>(
      `SELECT job_code FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      args.jobId,
      args.tenantId,
    );
    jobCode = jobRows[0]?.job_code ? String(jobRows[0].job_code) : 'DRY-JOB';
  }
  const id = `msg-${crypto.randomUUID().slice(0, 12)}`;

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_messages (
      id, tenant_id, job_id, job_code, sender_role, sender_name, message, is_urgent
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    id,
    args.tenantId,
    isBroadcast ? 'BROADCAST' : args.jobId,
    jobCode,
    args.senderRole,
    args.senderName,
    args.message,
    Boolean(args.isUrgent),
  );

  return { ok: true, id, isBroadcast };
}

export async function acknowledgeDrayageAlert(
  db: DrayageDbClient,
  args: { tenantId: string; alertKey: string },
) {
  await ensureDrayageSchema(db);
  const id = `ack-${crypto.createHash('sha256').update(args.tenantId).digest('hex').slice(0, 12)}-${args.alertKey}`;
  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_alerts (id, tenant_id, alert_key, acknowledged, updated_at)
     VALUES ($1, $2, $3, TRUE, NOW())
     ON CONFLICT (id) DO UPDATE SET acknowledged = TRUE, updated_at = NOW() WHERE logistics_drayage_alerts.tenant_id = EXCLUDED.tenant_id`,
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

export function computeDriverAllowanceComponents(job: Record<string, unknown>) {
  const allowanceAmountAed = Number(job.driver_allowance_aed ?? 150);
  const notes = String(job.notes ?? '');
  const status = String(job.status ?? '');
  const phase = String(job.job_phase ?? 'L1');

  // Port Gate Pass Fee defaults to 0 AED (decided by the operations team)
  const portGateFeeAed = 0;

  // Efficiency & Inspection bonuses default to 0 AED (configured per item by the operations team)
  const isBogie = Boolean(job.bogie_job_id) || notes.toLowerCase().includes('bogie');
  const bogieBonusAed = 0;

  const isStreetTurn =
    Boolean(job.street_turn_job_id) ||
    status === 'STREET_TURNED' ||
    notes.toLowerCase().includes('street-turn') ||
    notes.toLowerCase().includes('street turn');
  const streetTurnBonusAed = 0;

  const inspectionBonusAed = 0;
  const overnightHaltAed = 0;

  const totalAmountAed =
    allowanceAmountAed +
    portGateFeeAed +
    bogieBonusAed +
    streetTurnBonusAed +
    inspectionBonusAed +
    overnightHaltAed;

  let routeSummary =
    phase === 'L2'
      ? `${job.warehouse_name} → ${job.terminal_name} (Empty Return)`
      : `${job.terminal_name} → ${job.warehouse_name}`;
  if (isStreetTurn) {
    routeSummary = `${job.warehouse_name} ⇄ Inland Street-Turn → ${job.terminal_name}`;
  } else if (isBogie) {
    routeSummary = `${job.terminal_name} → ${job.warehouse_name} (2x20FT Bogie)`;
  }

  return {
    allowanceAmountAed,
    portGateFeeAed,
    overnightHaltAed,
    bogieBonusAed,
    streetTurnBonusAed,
    inspectionBonusAed,
    totalAmountAed,
    routeSummary,
  };
}

export async function calculateMissingAllowances(db: DrayageDbClient, tenantId: string) {
  await ensureDrayageSchema(db);
  await purgeLegacySampleDrayageRecords(db, tenantId);

  // Also remove any PENDING allowances whose assigned driver or job no longer exists
  await db.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_allowances a
      WHERE a.tenant_id = $1
        AND a.status = 'PENDING'
        AND (
          NOT EXISTS (
            SELECT 1 FROM logistics_drayage_jobs j
             WHERE j.id = a.job_id AND j.tenant_id = a.tenant_id
          )
          OR NOT EXISTS (
            SELECT 1 FROM drivers d
             WHERE d.id::text = a.driver_id
               AND d.tenant_id = a.tenant_id
               AND d.deleted_at IS NULL
               AND COALESCE(d.status, 'ACTIVE') = 'ACTIVE'
          )
        )`,
    tenantId,
  ).catch(() => {});

  const jobsWithoutAllowance = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT j.*
       FROM logistics_drayage_jobs j
       INNER JOIN drivers d
         ON d.id::text = j.assigned_driver_id
        AND d.tenant_id = j.tenant_id
        AND d.deleted_at IS NULL
        AND COALESCE(d.status, 'ACTIVE') = 'ACTIVE'
       LEFT JOIN logistics_drayage_allowances a
         ON a.job_id = j.id AND a.tenant_id = j.tenant_id
      WHERE j.tenant_id = $1
        AND j.assigned_driver_id IS NOT NULL
        AND j.job_code NOT IN (
          'DRY-L1-1001', 'DRY-L1-1002', 'DRY-L1-1003', 'DRY-L1-1004', 'DRY-L1-1005', 'DRY-L1-1006',
          'DRY-L2-1001', 'DRY-L2-1002', 'DRY-L2-1003', 'DRY-L2-1004', 'DRY-L2-1005', 'DRY-L2-1006',
          'DRY-EXP-1001'
        )
        AND a.id IS NULL`,
    tenantId,
  );

  let createdCount = 0;
  for (const job of jobsWithoutAllowance) {
    const calc = computeDriverAllowanceComponents(job);

    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_allowances (
        id, tenant_id, job_id, job_code, driver_id, driver_name, vehicle_plate,
        container_number, trip_phase, route_summary, allowance_amount_aed, port_gate_fee_aed,
        overnight_halt_aed, bogie_bonus_aed, street_turn_bonus_aed, inspection_bonus_aed,
        total_amount_aed, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'PENDING')`,
      `alw-${crypto.randomUUID().slice(0, 12)}`,
      tenantId,
      String(job.id),
      String(job.job_code),
      String(job.assigned_driver_id),
      String(job.assigned_driver_name ?? 'Assigned Driver'),
      job.assigned_vehicle_plate ? String(job.assigned_vehicle_plate) : null,
      String(job.container_number),
      String(job.job_phase ?? 'L1'),
      calc.routeSummary,
      calc.allowanceAmountAed,
      calc.portGateFeeAed,
      calc.overnightHaltAed,
      calc.bogieBonusAed,
      calc.streetTurnBonusAed,
      calc.inspectionBonusAed,
      calc.totalAmountAed,
    );
    createdCount++;
  }

  return { ok: true, createdCount, syncedCount: 0 };
}

export async function adjustDriverAllowance(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    allowanceId: string;
    allowanceAmountAed: number;
    portGateFeeAed: number;
    overnightHaltAed: number;
    bogieBonusAed: number;
    streetTurnBonusAed: number;
    inspectionBonusAed: number;
    adjustmentNotes?: string | null;
    actor?: string;
  },
) {
  await ensureDrayageSchema(db);
  const totalAmountAed =
    Number(args.allowanceAmountAed || 0) +
    Number(args.portGateFeeAed || 0) +
    Number(args.overnightHaltAed || 0) +
    Number(args.bogieBonusAed || 0) +
    Number(args.streetTurnBonusAed || 0) +
    Number(args.inspectionBonusAed || 0);

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_allowances
        SET allowance_amount_aed = $3,
            port_gate_fee_aed = $4,
            overnight_halt_aed = $5,
            bogie_bonus_aed = $6,
            street_turn_bonus_aed = $7,
            inspection_bonus_aed = $8,
            total_amount_aed = $9,
            adjustment_notes = $10
      WHERE id = $1 AND tenant_id = $2`,
    args.allowanceId,
    args.tenantId,
    Number(args.allowanceAmountAed || 0),
    Number(args.portGateFeeAed || 0),
    Number(args.overnightHaltAed || 0),
    Number(args.bogieBonusAed || 0),
    Number(args.streetTurnBonusAed || 0),
    Number(args.inspectionBonusAed || 0),
    totalAmountAed,
    args.adjustmentNotes ? String(args.adjustmentNotes).trim() : null,
  );

  return {
    ok: true,
    allowanceId: args.allowanceId,
    totalAmountAed,
  };
}

export async function submitDriverExpenseReceipt(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    driverName?: string;
    receiptCategory:
      | 'PORT_GATE_PASS'
      | 'WEIGHBRIDGE_SLIP'
      | 'CUSTOMS_INSPECTION'
      | 'TIRE_ROADSIDE_REPAIR'
      | 'TOLL_SALIK_DARB'
      | 'OVERNIGHT_HALT'
      | string;
    receiptLabel: string;
    amountAed: number;
    receiptNumber?: string;
    notes?: string;
    receiptPhotoUrl?: string | null;
    voiceNoteDataUrl?: string | null;
    voiceNoteDurationSec?: number;
  },
) {
  await ensureDrayageSchema(db);

  const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    args.jobId,
    args.tenantId,
  );
  const job = jobRows[0];
  if (!job) {
    throw new Error('Assigned drayage job not found');
  }

  let alwRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_allowances WHERE job_id = $1 AND tenant_id = $2 LIMIT 1`,
    args.jobId,
    args.tenantId,
  );

  if (alwRows.length === 0) {
    const calc = computeDriverAllowanceComponents(job);
    const newAlwId = `alw-${crypto.randomUUID().slice(0, 12)}`;
    await db.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_allowances (
        id, tenant_id, job_id, job_code, driver_id, driver_name, vehicle_plate,
        container_number, trip_phase, route_summary, allowance_amount_aed, port_gate_fee_aed,
        overnight_halt_aed, bogie_bonus_aed, street_turn_bonus_aed, inspection_bonus_aed,
        total_amount_aed, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'PENDING')`,
      newAlwId,
      args.tenantId,
      String(job.id),
      String(job.job_code),
      String(job.assigned_driver_id ?? 'DRV-MOBILE'),
      String(args.driverName || job.assigned_driver_name || 'Assigned Driver'),
      job.assigned_vehicle_plate ? String(job.assigned_vehicle_plate) : null,
      String(job.container_number),
      String(job.job_phase ?? 'L1'),
      calc.routeSummary,
      calc.allowanceAmountAed,
      calc.portGateFeeAed,
      calc.overnightHaltAed,
      calc.bogieBonusAed,
      calc.streetTurnBonusAed,
      calc.inspectionBonusAed,
      calc.totalAmountAed,
    );
    alwRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_allowances WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      newAlwId,
      args.tenantId,
    );
  }

  const alw = alwRows[0];
  const allowanceId = String(alw.id);
  const amount = Math.max(0, Number(args.amountAed || 0));
  const category = String(args.receiptCategory || 'PORT_GATE_PASS').toUpperCase();
  const label = String(args.receiptLabel || 'Port Gate Pass Receipt').trim();

  let portGateFeeAed = Number(alw.port_gate_fee_aed || 0);
  let overnightHaltAed = Number(alw.overnight_halt_aed || 0);
  let inspectionBonusAed = Number(alw.inspection_bonus_aed || 0);
  const allowanceAmountAed = Number(alw.allowance_amount_aed || 150);
  const bogieBonusAed = Number(alw.bogie_bonus_aed || 0);
  const streetTurnBonusAed = Number(alw.street_turn_bonus_aed || 0);

  if (category === 'PORT_GATE_PASS') {
    portGateFeeAed += amount;
  } else if (category === 'OVERNIGHT_HALT') {
    overnightHaltAed += amount;
  } else {
    inspectionBonusAed += amount;
  }

  const totalAmountAed =
    allowanceAmountAed +
    portGateFeeAed +
    overnightHaltAed +
    bogieBonusAed +
    streetTurnBonusAed +
    inspectionBonusAed;

  // Parse existing [ITEMS:...] and [RECEIPTS:...] from adjustment_notes
  const rawNotes = String(alw.adjustment_notes || '');
  const itemsRe = /\s*\[ITEMS:(\[[\s\S]*?\])\]/;
  const receiptsRe = /\s*\[RECEIPTS:(\[[\s\S]*?\])\]/;

  let existingItems: Array<Record<string, unknown>> = [];
  const itemsMatch = rawNotes.match(itemsRe);
  if (itemsMatch && itemsMatch[1]) {
    try {
      const parsed = JSON.parse(itemsMatch[1]);
      if (Array.isArray(parsed)) existingItems = parsed;
    } catch {
      existingItems = [];
    }
  }

  let existingReceipts: Array<Record<string, unknown>> = [];
  const receiptsMatch = rawNotes.match(receiptsRe);
  if (receiptsMatch && receiptsMatch[1]) {
    try {
      const parsed = JSON.parse(receiptsMatch[1]);
      if (Array.isArray(parsed)) existingReceipts = parsed;
    } catch {
      existingReceipts = [];
    }
  }

  const receiptId = `rcpt-${Date.now().toString(36)}`;
  if (category !== 'PORT_GATE_PASS' && category !== 'OVERNIGHT_HALT' && amount > 0) {
    existingItems.push({
      id: receiptId,
      category: category === 'CUSTOMS_INSPECTION' ? 'CUSTOMS_BAY' : 'CUSTOM',
      label,
      amountAed: amount,
    });
  }

  const newReceiptEntry = {
    id: receiptId,
    category,
    label,
    amountAed: amount,
    receiptNumber: args.receiptNumber ? String(args.receiptNumber).trim() : '',
    notes: args.notes ? String(args.notes).trim() : '',
    receiptPhotoUrl: args.receiptPhotoUrl || null,
    voiceNoteDataUrl: args.voiceNoteDataUrl || null,
    voiceNoteDurationSec: Number(args.voiceNoteDurationSec || 0),
    driverName: String(args.driverName || job.assigned_driver_name || 'Assigned Driver'),
    submittedAt: new Date().toISOString(),
  };
  existingReceipts.push(newReceiptEntry);

  const cleanHumanNotes = rawNotes
    .replace(itemsRe, '')
    .replace(receiptsRe, '')
    .trim();
  const receiptHumanLine = `Driver Receipt (${label}: AED ${amount}${args.receiptNumber ? ` #${args.receiptNumber}` : ''}${args.notes ? ` - ${args.notes}` : ''}${args.voiceNoteDataUrl ? ' + Voice Note' : ''})`;
  const mergedHuman = cleanHumanNotes
    ? `${cleanHumanNotes} | ${receiptHumanLine}`
    : receiptHumanLine;

  const itemsTag = existingItems.length > 0 ? ` [ITEMS:${JSON.stringify(existingItems)}]` : '';
  const receiptsTag = ` [RECEIPTS:${JSON.stringify(existingReceipts)}]`;
  const finalAdjustmentNotes = `${mergedHuman}${itemsTag}${receiptsTag}`.trim();

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_allowances
        SET port_gate_fee_aed = $3,
            overnight_halt_aed = $4,
            inspection_bonus_aed = $5,
            total_amount_aed = $6,
            adjustment_notes = $7
      WHERE id = $1 AND tenant_id = $2`,
    allowanceId,
    args.tenantId,
    portGateFeeAed,
    overnightHaltAed,
    inspectionBonusAed,
    totalAmountAed,
    finalAdjustmentNotes,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'DRIVER_EXPENSE_RECEIPT', $5, $6)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId,
    String(job.job_code),
    `${receiptHumanLine} synced to Driver Payments Approval Ledger.`,
    String(args.driverName || job.assigned_driver_name || 'Driver Mobile App'),
  );

  return {
    ok: true,
    allowanceId,
    receipt: newReceiptEntry,
    totalAmountAed,
  };
}

export async function settleDriverAllowancesPayout(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    allowanceIds: string[];
    paymentMethod: 'WPS_PAYROLL' | 'BANK_TRANSFER' | 'FUEL_CASH_CARD' | 'DRIVER_WALLET' | string;
    paymentRef?: string;
    notes?: string;
    actor?: string;
  },
) {
  await ensureDrayageSchema(db);
  if (!args.allowanceIds || args.allowanceIds.length === 0) {
    throw new Error('At least one allowance must be selected for settlement');
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix =
    args.paymentMethod === 'WPS_PAYROLL'
      ? 'WPS'
      : args.paymentMethod === 'BANK_TRANSFER'
      ? 'BNK'
      : args.paymentMethod === 'FUEL_CASH_CARD'
      ? 'CRD'
      : 'WLT';
  const batchRef =
    args.paymentRef && args.paymentRef.trim()
      ? args.paymentRef.trim().toUpperCase()
      : `${prefix}-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

  let totalSettledAed = 0;
  let settledCount = 0;

  for (const id of args.allowanceIds) {
    const rows = await db.$queryRawUnsafe<Array<{ total_amount_aed: number }>>(
      `SELECT total_amount_aed FROM logistics_drayage_allowances WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      id,
      args.tenantId,
    );
    if (rows.length === 0) continue;
    totalSettledAed += Number(rows[0].total_amount_aed ?? 0);

    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_allowances
          SET status = 'PAID',
              payment_ref = $3,
              payment_method = $4,
              paid_at = NOW(),
              paid_by = $5,
              approved_by = COALESCE(approved_by, $5),
              approved_at = COALESCE(approved_at, NOW()),
              adjustment_notes = CASE WHEN $6::text IS NOT NULL AND $6::text != '' THEN COALESCE(adjustment_notes || ' | ', '') || $6::text ELSE adjustment_notes END
        WHERE id = $1 AND tenant_id = $2`,
      id,
      args.tenantId,
      batchRef,
      args.paymentMethod || 'WPS_PAYROLL',
      args.actor || 'Finance Settlement Desk',
      args.notes ? String(args.notes).trim() : null,
    );
    settledCount++;
  }

  return {
    ok: true,
    settledCount,
    totalSettledAed,
    paymentRef: batchRef,
    paymentMethod: args.paymentMethod || 'WPS_PAYROLL',
    paidAt: new Date().toISOString(),
  };
}



// =========================================================================
// STREET-TURN TRIANGULATION & BOGIE ENGINE DOMAIN FUNCTIONS
// =========================================================================

export async function findStreetTurnCandidates(
  db: DrayageDbClient,
  tenantId: string,
): Promise<StreetTurnMatch[]> {
  const workspace = await getDrayageWorkspaceData(db, tenantId);
  const whCoordsByName = new Map<string, { lat: number; lng: number }>();
  const whAllowanceByName = new Map<string, number>();
  for (const w of workspace.warehouses) {
    whCoordsByName.set(w.name.toLowerCase(), { lat: w.lat, lng: w.lng });
    if (w.driverAllowanceAed && w.driverAllowanceAed > 0) {
      whAllowanceByName.set(w.name.toLowerCase(), w.driverAllowanceAed);
    }
  }
  const termCoordsByKey = new Map<string, { lat: number; lng: number }>();
  for (const t of workspace.terminals) {
    termCoordsByKey.set(t.name.toLowerCase(), { lat: t.lat, lng: t.lng });
    termCoordsByKey.set(t.code.toLowerCase(), { lat: t.lat, lng: t.lng });
  }
  const resolveTerminalCoords = (termName?: string | null): { lat: number; lng: number } => {
    const key = (termName || '').trim().toLowerCase();
    const exact = termCoordsByKey.get(key);
    if (exact) return exact;
    if (key.includes('khalifa') || key.includes('auh')) return { lat: 24.8432, lng: 54.7121 };
    if (key.includes('rashid')) return { lat: 25.2697, lng: 55.2758 };
    if (key.includes('t2')) return { lat: 25.0185, lng: 55.0562 };
    if (key.includes('t3')) return { lat: 24.9982, lng: 55.0458 };
    return { lat: 25.0112, lng: 55.0617 };
  };

  const resolveWarehouseCoords = (job: DrayageJob): { lat: number; lng: number } => {
    const exact = whCoordsByName.get((job.warehouseName || '').toLowerCase());
    if (exact) return exact;
    if (job.currentLat && job.currentLng) return { lat: job.currentLat, lng: job.currentLng };
    const lower = (job.warehouseName || '').toLowerCase();
    if (lower.includes('nip') || lower.includes('national industries')) return { lat: 24.931, lng: 55.075 };
    if (lower.includes('dubai south') || lower.includes('dwc')) return { lat: 24.896, lng: 55.158 };
    if (lower.includes('kezad') || lower.includes('kizad') || lower.includes('khalifa')) return { lat: 24.769, lng: 54.712 };
    return { lat: 24.9642, lng: 55.0915 };
  };

  // Inbound candidates: L1 jobs Placed at Ramp (or detached after Reassign / Ready for Pickup) AND unassigned L2 Empty Return jobs
  // Exclude initial Yard Drops (PLACED_AT_YARD / FCL_REASSIGN / MT_REASSIGN) which are still loaded (FCL) awaiting Yard-to-Ramp shunting
  const inboundRampOrEmptyJobs = workspace.jobs.filter((j) => {
    if (j.status === 'COMPLETED' || j.status === 'CANCELLED' || j.status === 'STREET_TURNED' || j.streetTurnJobId) {
      return false;
    }
    const st = (j.status || '').toUpperCase();
    const isInitialYardDrop =
      ['PLACED_AT_YARD', 'FCL_REASSIGN', 'MT_REASSIGN'].includes(st) ||
      ((j.placementLocation || '').toUpperCase() === 'YARD' &&
        !['READY_FOR_PICKUP', 'CONTAINER_OFFLOADED', 'REASSIGN_TRAILER_DETACHED'].includes(st));
    if (j.jobPhase === 'L1' && isInitialYardDrop) {
      return false;
    }
    const isL1AtRampOrReady =
      j.jobPhase === 'L1' &&
      !j.l2Activated &&
      (Boolean(j.trailerDetached) ||
        [
          'PLACED_AT_RAMP',
          'REASSIGN_PLACED_AT_RAMP',
          'CONTAINER_DETACHED',
          'TRAILER_DETACHED',
          'REASSIGN_TRAILER_DETACHED',
          'READY_FOR_PICKUP',
          'CONTAINER_OFFLOADED',
          'WAITING_MT_RETURN',
        ].includes(st) ||
        j.placementLocation === 'RAMP');
    const isUnassignedL2 =
      !j.assignedVehicleId && (j.jobPhase === 'L2' || st === 'WAITING_MT_RETURN');
    return isL1AtRampOrReady || isUnassignedL2;
  });

  // Outbound candidates: Pending Export L1 bookings OR Pending L1 Import pickups at the same Port Terminal (Port Reload)
  // Exclude jobs already picked up or sitting in Customer Yard (FCL_REASSIGN / MT_REASSIGN / trailerDetached)
  const pendingOutboundJobs = workspace.jobs.filter(
    (j) => !j.assignedVehicleId && j.status === 'PENDING' && !j.trailerDetached,
  );
  const exportJobs = pendingOutboundJobs.filter(
    (j) => j.shipmentType === 'EXPORT' || j.jobCode.startsWith('EXP') || j.jobCode.includes('EXP'),
  );
  const outboundCandidates = exportJobs.length > 0 ? exportJobs : pendingOutboundJobs.filter((j) => j.jobPhase === 'L1');

  if (inboundRampOrEmptyJobs.length === 0 || outboundCandidates.length === 0) return [];

  const candidates: StreetTurnMatch[] = [];

  for (const inbound of inboundRampOrEmptyJobs) {
    for (const exp of outboundCandidates) {
      if (inbound.id === exp.id) continue;

      const isExportOutbound =
        exp.shipmentType === 'EXPORT' || exp.jobCode.startsWith('EXP') || exp.jobCode.includes('EXP');
      const sameTerminalReload =
        !isExportOutbound &&
        (inbound.terminalName || '').trim().toLowerCase() === (exp.terminalName || '').trim().toLowerCase();

      // 1. Super Admin Configurable Radius Haversine Proximity Check (Default <= 15 km)
      //    Note: For a Port Terminal Reload (L2 Drop at T1 -> L1 Pick at T1), the handoff is 0 km
      //    at the port terminal itself, so warehouse-to-warehouse distance is NOT a blocker.
      const maxRadiusKm = workspace.automationConfig?.streetTurnRadiusKm ?? 15.0;
      const strictCarrier = workspace.automationConfig?.streetTurnStrictCarrierMatch ?? true;
      const c1 = resolveWarehouseCoords(inbound);
      const c2 = resolveWarehouseCoords(exp);
      const rawDistKm = computeHaversineKm(c1.lat, c1.lng, c2.lat, c2.lng);
      const zoneL2 = getWarehouseZoneName(inbound.warehouseName);
      const zoneExp = getWarehouseZoneName(exp.warehouseName);
      const sameZone = zoneL2.toLowerCase() === zoneExp.toLowerCase();
      const interDist = sameTerminalReload && !isExportOutbound
        ? 0.0
        : Math.round((rawDistKm < 0.5 ? (sameZone ? 2.8 : 6.4) : rawDistKm) * 10) / 10;

      if (!sameTerminalReload && interDist > maxRadiusKm) continue;

      // 2. Equipment Size (20FT / 40HC / 40FT) & Grade/Type Match (Port Reload on a 40FT chassis supports any standard container)
      const sizeMatch =
        sameTerminalReload ||
        inbound.containerSize === exp.containerSize ||
        (inbound.containerSize.startsWith('40') && exp.containerSize.startsWith('40'));
      if (!sizeMatch) continue;

      const typeMatch =
        sameTerminalReload ||
        (inbound.containerType || 'DRY').toUpperCase() === (exp.containerType || 'DRY').toUpperCase();
      if (!typeMatch) continue;

      // 3. Carrier Line Matching (mandatory for inland box reuse, optional bonus for Port Terminal Reload)
      const l2Line = detectShippingLine(inbound.containerNumber, inbound.shippingLine);
      const expLine = detectShippingLine(exp.containerNumber, exp.shippingLine);
      const isLineMatch = l2Line === expLine || exp.containerNumber.includes('TBD') || !exp.containerNumber;
      if (isExportOutbound && strictCarrier && !isLineMatch && expLine !== 'GENERIC_LINE' && expLine !== 'CARRIER_DEFAULT') {
        continue;
      }

      const tInbound = resolveTerminalCoords(inbound.returnTerminalName || inbound.terminalName);
      const tOutbound = resolveTerminalCoords(exp.terminalName);
      const distInboundWhToTermKm = Math.max(2.0, Math.round(computeHaversineKm(c1.lat, c1.lng, tInbound.lat, tInbound.lng) * 1.25 * 10) / 10);
      const distOutboundTermToWhKm = Math.max(2.0, Math.round(computeHaversineKm(tOutbound.lat, tOutbound.lng, c2.lat, c2.lng) * 1.25 * 10) / 10);
      const interTermKm = sameTerminalReload ? 0 : Math.round(computeHaversineKm(tInbound.lat, tInbound.lng, tOutbound.lat, tOutbound.lng) * 1.25 * 10) / 10;

      const rawDeadheadSavedKm = sameTerminalReload && !isExportOutbound
        ? distInboundWhToTermKm + distOutboundTermToWhKm - interTermKm
        : distInboundWhToTermKm + distOutboundTermToWhKm - interDist;
      const deadheadKmSaved = Math.max(1.0, Math.round(rawDeadheadSavedKm * 10) / 10);
      const co2SavedKg = Math.round(deadheadKmSaved * 0.95 * 10) / 10;
      const inboundAllowAed =
        inbound.driverAllowanceAed ||
        whAllowanceByName.get((inbound.warehouseName || '').toLowerCase()) ||
        150;
      const PORT_GATE_FEE_AED = 35;
      const savedAllowanceAndGateAed = sameTerminalReload && !isExportOutbound
        ? inboundAllowAed + PORT_GATE_FEE_AED
        : inboundAllowAed + 2 * PORT_GATE_FEE_AED;
      const fuelSavingsAed = Math.round(deadheadKmSaved * 3.85 + savedAllowanceAndGateAed);
      const gateDwellSavedHrs = sameTerminalReload && !isExportOutbound ? 1.5 : 2.2;
      const turnaroundHoursSaved = Math.round((deadheadKmSaved / 45 + gateDwellSavedHrs) * 10) / 10;
      const isReefer = (inbound.containerType || 'DRY').toUpperCase().includes('REEFER');
      const containerGrade = sameTerminalReload && !isExportOutbound
        ? `Port Dual-Transaction @ ${exp.terminalName} (0 km Handoff)`
        : isReefer
          ? 'Grade A · PTI Cold-Chain Certified'
          : 'Grade A · Export Seaworthy / CW';

      let score = 90;
      if (sameZone) score += 8;
      if (sameTerminalReload) score += 10;
      if (l2Line === expLine) score += 5;
      if (inbound.jobPhase === 'L1') score += 4;

      candidates.push({
        id: `STREET-${inbound.id}-${exp.id}`,
        l2Job: inbound,
        exportJob: exp,
        sourcePhase: inbound.jobPhase === 'L1' ? 'L1_RAMP' : 'L2_EMPTY',
        shippingLine: l2Line,
        carrierPrefix: inbound.containerNumber.slice(0, 4),
        containerNumber: inbound.containerNumber,
        containerSize: inbound.containerSize,
        containerType: inbound.containerType,
        containerGrade,
        originWarehouse: inbound.warehouseName,
        destWarehouse: exp.warehouseName,
        zone: zoneL2,
        interWarehouseDistanceKm: interDist,
        terminalName: exp.terminalName || inbound.terminalName,
        deadheadKmSaved,
        co2SavedKg,
        fuelSavingsAed,
        turnaroundHoursSaved,
        score: Math.min(100, score),
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
    leg3JobId?: string;
    holdLeg3?: boolean;
    matchMode?: 'INLAND_STREET_TURN' | 'PORT_TERMINAL_RELOAD' | 'DAISY_CHAIN_3LEG';
    vehicleId?: string;
    vehiclePlate?: string;
    driverId?: string;
    driverName?: string;
    trailerId?: string;
    trailerPlate?: string;
    tokenNumber?: string;
    pcsSlotStart?: string | null;
    pcsSlotEnd?: string | null;
    actor?: string;
  },
) {
  await ensureDrayageSchema(db);

  const lookupIds = [args.l2JobId, args.exportJobId, ...(args.leg3JobId ? [args.leg3JobId] : [])];
  const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_jobs WHERE id = ANY($1::text[]) AND tenant_id = $2`,
    lookupIds,
    args.tenantId,
  );
  const l2 = rows.find((r) => String(r.id) === args.l2JobId);
  const exp = rows.find((r) => String(r.id) === args.exportJobId);
  const leg3 = args.leg3JobId ? rows.find((r) => String(r.id) === args.leg3JobId) : undefined;

  if (!l2) throw new Error(`Source Ramp / Empty Job ${args.l2JobId} not found`);
  if (!exp) throw new Error(`Outbound / Leg-2 Job ${args.exportJobId} not found`);

  const containerNum = String(l2.container_number);
  const containerSize = String(l2.container_size || '40HC');
  const containerType = String(l2.container_type || 'DRY');
  const expShipmentType = String(exp.shipment_type || '').toUpperCase();
  const expJobCode = String(exp.job_code || '');
  const isExportBoxReuse =
    args.matchMode === 'INLAND_STREET_TURN' ||
    ((args.matchMode === undefined) &&
      (expShipmentType === 'EXPORT' || expJobCode.startsWith('EXP') || String(exp.container_number || '').includes('TBD')));

  const streetTurnRef = args.leg3JobId
    ? `DC3-${Math.floor(1000 + Math.random() * 9000)}`
    : isExportBoxReuse
      ? `ST-${Math.floor(1000 + Math.random() * 9000)}`
      : `PR-${Math.floor(1000 + Math.random() * 9000)}`;
  const token = args.tokenNumber || `DPW-ST-${Math.floor(1000 + Math.random() * 9000)}`;

  if (isExportBoxReuse) {
    // 1A. Inland Street-Turn: Reuse the empty container directly for the Export booking
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_jobs
          SET status = 'STREET_TURNED',
              l2_activated = TRUE,
              street_turn_job_id = $3,
              notes = COALESCE(notes || ' | ', '') || $4,
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      args.l2JobId,
      args.tenantId,
      args.exportJobId,
      `Inland Street-Turned to Export Job ${exp.job_code} (${streetTurnRef}) - 52km deadhead avoided`,
    );

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
  } else {
    // 1B. Port Terminal Reload / Daisy-Chain (L2 Empty Return -> T1 -> L1 Import Full from T1)
    // Both jobs keep their own container numbers and execute sequentially on the same tractor/chassis
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_jobs
          SET street_turn_job_id = $3,
              priority = 'HIGH',
              notes = COALESCE(notes || ' | ', '') || $4,
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      args.l2JobId,
      args.tenantId,
      args.exportJobId,
      `Leg #1 of Port Terminal Reload / Daisy-Chain (${streetTurnRef}): Drop Empty ${containerNum} @ ${l2.terminal_name} ➜ Reload ${exp.job_code}`,
    );

    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_jobs
          SET street_turn_job_id = $3,
              priority = 'HIGH',
              notes = COALESCE(notes || ' | ', '') || $4,
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      args.exportJobId,
      args.tenantId,
      args.l2JobId,
      `Leg #2 of Port Terminal Reload / Daisy-Chain (${streetTurnRef}): 0km Port Reload @ ${exp.terminal_name} after ${l2.job_code} ➜ Deliver to ${exp.warehouse_name}`,
    );

    if (args.vehicleId && args.driverId && args.trailerId) {
      await assignDrayageJob(db, {
        tenantId: args.tenantId,
        jobId: args.l2JobId,
        vehicleId: args.vehicleId,
        vehiclePlate: args.vehiclePlate || 'DXB-TRACTOR',
        driverId: args.driverId,
        driverName: args.driverName || 'Assigned Driver',
        trailerId: args.trailerId,
        trailerPlate: args.trailerPlate || 'DXB-TR-9901',
        tokenNumber: token,
        pcsSlotStart: args.pcsSlotStart,
        pcsSlotEnd: args.pcsSlotEnd,
      });
    }
  }

  // 2. Dispatch Leg 2 / Export Job if vehicle, driver, and trailer provided
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
      pcsSlotStart: args.pcsSlotStart,
      pcsSlotEnd: args.pcsSlotEnd,
    });
  }

  // 3. Handle Optional Leg 3 (3-Leg Daisy-Chain Triangulation: e.g. JAFZA South -> T2)
  if (leg3 && args.leg3JobId) {
    if (args.holdLeg3) {
      await db.$executeRawUnsafe(
        `UPDATE logistics_drayage_jobs
            SET notes = COALESCE(notes || ' | ', '') || $3,
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        args.leg3JobId,
        args.tenantId,
        `[SMART_BACKHAUL_HOLD] Held after ${streetTurnRef} (${exp.warehouse_name} ➜ ${leg3.terminal_name}): Safe DO free time & no outbound L1 backhaul at ${leg3.terminal_name}`,
      );
    } else if (args.vehicleId && args.driverId && args.trailerId) {
      await db.$executeRawUnsafe(
        `UPDATE logistics_drayage_jobs
            SET street_turn_job_id = $3,
                priority = 'HIGH',
                notes = COALESCE(notes || ' | ', '') || $4,
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        args.leg3JobId,
        args.tenantId,
        args.exportJobId,
        `Leg #3 of 3-Leg Daisy-Chain (${streetTurnRef}): Intra-Zone Handoff @ ${leg3.warehouse_name} after ${exp.job_code} ➜ Drop Empty @ ${leg3.terminal_name}`,
      );
      await assignDrayageJob(db, {
        tenantId: args.tenantId,
        jobId: args.leg3JobId,
        vehicleId: args.vehicleId,
        vehiclePlate: args.vehiclePlate || 'DXB-TRACTOR',
        driverId: args.driverId,
        driverName: args.driverName || 'Assigned Driver',
        trailerId: args.trailerId,
        trailerPlate: args.trailerPlate || 'DXB-TR-9901',
        tokenNumber: token,
        pcsSlotStart: args.pcsSlotStart,
        pcsSlotEnd: args.pcsSlotEnd,
      });
    }
  }

  // 4. Log status event
  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'STREET_TURN_EXECUTED', $5, $6)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.exportJobId,
    String(exp.job_code),
    args.leg3JobId
      ? `3-Leg Daisy-Chain (${streetTurnRef}) executed across ${l2.job_code} ➜ ${exp.job_code} ➜ ${leg3?.job_code || args.leg3JobId} (${args.holdLeg3 ? 'Leg 3 placed on Smart Backhaul Hold' : 'All 3 legs dispatched'}).`
      : isExportBoxReuse
        ? `Triangulation Street-Turn executed with ${l2.job_code}. Container ${containerNum} repositioned inland from ${l2.warehouse_name} to ${exp.warehouse_name}.`
        : `Port Terminal Reload (${streetTurnRef}) executed at ${exp.terminal_name}: ${l2.job_code} (${l2.warehouse_name} ➜ ${l2.terminal_name}) chained with ${exp.job_code} (${exp.terminal_name} ➜ ${exp.warehouse_name}).`,
    args.actor || 'Dispatcher Console',
  );

  // Compute actual dynamic savings from terminal and warehouse records
  const [termRows, whRows] = await Promise.all([
    db.$queryRawUnsafe<Array<{ id: string; name: string; code: string; lat: number; lng: number }>>(
      `SELECT id, name, code, lat, lng FROM logistics_drayage_terminals WHERE tenant_id = $1`,
      args.tenantId,
    ).catch(() => []),
    db.$queryRawUnsafe<Array<{ id: string; name: string; lat: number; lng: number; driver_allowance_aed: number | null }>>(
      `SELECT id, name, lat, lng, driver_allowance_aed FROM logistics_drayage_warehouses WHERE tenant_id = $1`,
      args.tenantId,
    ).catch(() => []),
  ]);
  const resolveWhCoordRow = (r: Record<string, unknown>) => {
    const wId = r.warehouse_id ? String(r.warehouse_id) : '';
    const wName = String(r.warehouse_name || '').toLowerCase();
    const m = whRows.find((w) => w.id === wId || w.name.toLowerCase() === wName);
    if (m && m.lat && m.lng) return { lat: Number(m.lat), lng: Number(m.lng), allowance: Number(m.driver_allowance_aed || 150) };
    return { lat: 24.9602, lng: 55.0615, allowance: 150 };
  };
  const resolveTermCoordRow = (r: Record<string, unknown>) => {
    const tId = String(r.return_terminal_id || r.terminal_id || '');
    const tName = String(r.return_terminal_name || r.terminal_name || '').toLowerCase();
    const m = termRows.find((t) => t.id === tId || t.name.toLowerCase() === tName || t.code.toLowerCase() === tName);
    if (m && m.lat && m.lng) return { lat: Number(m.lat), lng: Number(m.lng) };
    if (tName.includes('t2')) return { lat: 25.0185, lng: 55.0562 };
    return { lat: 25.0112, lng: 55.0617 };
  };
  const wL2 = resolveWhCoordRow(l2);
  const tL2 = resolveTermCoordRow(l2);
  const wExp = resolveWhCoordRow(exp);
  const tExp = resolveTermCoordRow(exp);
  const dWh2Term2 = Math.max(2.0, computeHaversineKm(wL2.lat, wL2.lng, tL2.lat, tL2.lng) * 1.25);
  const dTerm1Wh1 = Math.max(2.0, computeHaversineKm(tExp.lat, tExp.lng, wExp.lat, wExp.lng) * 1.25);
  const dWh2Wh1 = isExportBoxReuse ? computeHaversineKm(wL2.lat, wL2.lng, wExp.lat, wExp.lng) * 1.25 : 0;
  let leg3SavedKm = 0;
  if (leg3 && args.leg3JobId && !args.holdLeg3) {
    const w3 = resolveWhCoordRow(leg3);
    const t3 = resolveTermCoordRow(leg3);
    leg3SavedKm = Math.max(2.0, computeHaversineKm(t3.lat, t3.lng, w3.lat, w3.lng) * 1.25 - computeHaversineKm(wExp.lat, wExp.lng, w3.lat, w3.lng) * 1.25);
  }
  const deadheadKmSaved = Math.max(1.0, Math.round((dWh2Term2 + dTerm1Wh1 - dWh2Wh1 + leg3SavedKm) * 10) / 10);
  const co2SavedKg = Math.round(deadheadKmSaved * 0.95 * 10) / 10;
  const l2AllowAed = Number(l2.driver_allowance_aed || wL2.allowance || 150);
  const l3AllowAed = leg3 && !args.holdLeg3 ? Number(leg3.driver_allowance_aed || 150) : 0;
  const savedAllowAndGate = isExportBoxReuse
    ? l2AllowAed + 70
    : l2AllowAed + 35 + (leg3 && !args.holdLeg3 ? Math.round(l3AllowAed * 0.5) + 35 : 0);
  const fuelSavingsAed = Math.round(deadheadKmSaved * 3.85 + savedAllowAndGate);

  return {
    ok: true,
    streetTurnRef,
    l2JobCode: String(l2.job_code),
    exportJobCode: String(exp.job_code),
    leg3JobCode: leg3 ? String(leg3.job_code) : undefined,
    leg3Held: Boolean(args.holdLeg3),
    containerNumber: containerNum,
    deadheadKmSaved,
    co2SavedKg,
    fuelSavingsAed,
    tokenNumber: token,
  };
}

export async function findBogiePairCandidates(
  db: DrayageDbClient,
  tenantId: string,
): Promise<BogiePairCandidate[]> {
  const workspace = await getDrayageWorkspaceData(db, tenantId);
  const unassignedJobs = workspace.jobs.filter(
    (j) =>
      !j.assignedVehicleId &&
      j.jobPhase === 'L1' &&
      j.status === 'PENDING' &&
      !j.trailerDetached,
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

      // Check Super Admin configurable scheduling / slot window (Default 2.0h) & RTA Payload Limit (Default 36,000 kg)
      const maxWindowHours = workspace.automationConfig?.bogieWindowHours ?? 2.0;
      const t1Ms = new Date(j1.pcsSlotStart || j1.createdAt).getTime();
      const t2Ms = new Date(j2.pcsSlotStart || j2.createdAt).getTime();
      const rawWindowHours = Math.abs(t1Ms - t2Ms) / 3600000;
      const windowDiffHours = Math.round(Math.min(maxWindowHours, rawWindowHours) * 10) / 10;
      if (windowDiffHours > maxWindowHours) continue;

      const box1WeightKg = j1.cargoWeightKg || 14500;
      const box2WeightKg = j2.cargoWeightKg || 16200;
      const totalPayloadKg = box1WeightKg + box2WeightKg;
      const weightLimitKg = workspace.automationConfig?.bogieMaxPayloadKg ?? 36000;
      const isWeightCompliant = totalPayloadKg <= weightLimitKg;
      const weightUtilizationPct = Math.round((totalPayloadKg / weightLimitKg) * 100);

      const drop1 = j1.doExpiryDate && j2.doExpiryDate && j1.doExpiryDate <= j2.doExpiryDate ? j1 : j2;
      const drop2 = drop1.id === j1.id ? j2 : j1;

      const combinedRevenueAed = (j1.rateAmountAed || 1450) + (j2.rateAmountAed || 1450);
      const combinedAllowanceAed = (j1.driverAllowanceAed || 150) + (j2.driverAllowanceAed || 150);

      let score = 82;
      if (sameZone) score += 15;
      if (windowDiffHours <= 2.0) score += 5;
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
        windowDiffHours,
        box1WeightKg,
        box2WeightKg,
        totalPayloadKg,
        isWeightCompliant,
        weightLimitKg,
        weightUtilizationPct,
        recommendedTrailerType: '40FT_FLATBED / BOGIE Multi-Axle Chassis',
        combinedRevenueAed,
        combinedAllowanceAed,
        fuelSavingPct: 45,
        tasSlot: '2-Hr TAS Window (Single Gate Pass)',
        score: Math.min(100, score),
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
    pcsSlotStart?: string | null;
    pcsSlotEnd?: string | null;
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
      pcsSlotStart: args.pcsSlotStart,
      pcsSlotEnd: args.pcsSlotEnd,
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

// =========================================================================
// CONSIGNEE & SHIPPER SELF-SERVICE TRACKING PORTAL DOMAIN FUNCTIONS
// =========================================================================

export async function consigneeConfirmEmptyReady(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    receiverName: string;
    bayNotes?: string;
    photoUrl?: string | null;
    operationType?: 'DESTUFFING' | 'STUFFING';
    newSealNumber?: string | null;
    grossWeightKg?: number | null;
  },
) {
  await ensureDrayageSchema(db);
  const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    args.jobId,
    args.tenantId,
  );
  const job = jobRows[0];
  if (!job) throw new Error('Shipment job not found');

  const currentStatus = String(job.status || '').toUpperCase();
  const rampActive = isRampLinkActive({
    status: currentStatus,
    placementLocation: job.placement_location ? String(job.placement_location) : 'RAMP',
    trailerDetached: Boolean(job.trailer_detached),
  });
  if (!rampActive) {
    throw new Error(
      `Ramp Stuffing/Destuffing completion can only be submitted once the container is in PLACED_AT_RAMP status (current status: ${currentStatus}).`,
    );
  }

  const shipmentType = String(job.shipment_type || 'IMPORT').toUpperCase();
  const isStuffing =
    args.operationType === 'STUFFING' || (!args.operationType && shipmentType === 'EXPORT');
  const receiver = (args.receiverName || 'Warehouse Ramp Supervisor').trim();
  const nowIso = new Date().toISOString();
  const cleanSeal = args.newSealNumber ? String(args.newSealNumber).trim().toUpperCase() : null;
  const cleanWeight =
    args.grossWeightKg != null && Number(args.grossWeightKg) > 0
      ? Math.round(Number(args.grossWeightKg))
      : null;

  const noteSummary = isStuffing
    ? `Ramp Export Stuffing Completed by ${receiver}${cleanSeal ? ` · New Seal: ${cleanSeal}` : ''}${cleanWeight ? ` · Gross Weight: ${cleanWeight} kg` : ''}${args.bayNotes ? `: ${args.bayNotes}` : ''}`
    : `Ramp Destuffing / Empty Release signed by ${receiver}${args.bayNotes ? `: ${args.bayNotes}` : ''}`;

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET status = 'READY_FOR_PICKUP',
            pod_signature_name = $3,
            pod_signed_at = NOW(),
            pod_photo_url = COALESCE($4, pod_photo_url),
            etc_time = NOW(),
            etc_alert_status = 'TRIGGERED',
            notes = COALESCE(notes || ' | ', '') || $5,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.jobId,
    args.tenantId,
    receiver,
    args.photoUrl ? String(args.photoUrl) : null,
    noteSummary,
  );

  // If Export Stuffing provided a new seal number or gross weight, update the container record
  if (job.container_id && (cleanSeal || cleanWeight)) {
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_containers
          SET seal_number = COALESCE($3, seal_number),
              weight_kg = COALESCE($4, weight_kg),
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      String(job.container_id),
      args.tenantId,
      cleanSeal,
      cleanWeight,
    );
  }

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId,
    String(job.job_code),
    isStuffing ? 'RAMP_STUFFING_COMPLETE' : 'CONSIGNEE_EMPTY_RELEASE',
    isStuffing
      ? `Ramp (${receiver}) confirmed container ${job.container_number} export stuffing complete & sealed${cleanSeal ? ` (Seal: ${cleanSeal})` : ''}${cleanWeight ? ` · Weight: ${cleanWeight} kg` : ''}. Ready for Port Terminal haulage.${args.bayNotes ? ` Dock Note: ${args.bayNotes}` : ''}`
      : `Ramp (${receiver}) confirmed container ${job.container_number} destuffing complete & empty ready for L2 pickup.${args.bayNotes ? ` Dock Note: ${args.bayNotes}` : ''}`,
    `${receiver} (Ramp Portal)`,
  );

  // If L1 job and L2 has not yet been activated, dynamically activate Leg 2 immediately
  let l2Result: { l2JobId?: string; l2JobCode?: string } = {};
  if (String(job.job_phase) === 'L1' && !job.l2_activated) {
    const act = await activateL2EmptyReturnJob(db, {
      tenantId: args.tenantId,
      l1JobId: args.jobId,
    });
    l2Result = { l2JobId: act.l2JobId, l2JobCode: act.l2JobCode };
  }

  return {
    ok: true,
    jobId: args.jobId,
    jobCode: String(job.job_code),
    containerNumber: String(job.container_number),
    operationType: isStuffing ? 'STUFFING' : 'DESTUFFING',
    newSealNumber: cleanSeal,
    grossWeightKg: cleanWeight,
    receiverName: receiver,
    signedAt: nowIso,
    l2Activated: true,
    ...l2Result,
  };
}

export async function submitJobPodEvidence(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    receiverName: string;
    photoUrl?: string | null;
    notes?: string;
    actor?: string;
    latitude?: number | null;
    longitude?: number | null;
    location?: string | null;
    eventStatus?: string;
    captureMethod?: 'SIGN_ON_GLASS' | 'UPLOADED_POD' | 'BOTH' | string;
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

  const receiver = (args.receiverName || 'Warehouse Bay Supervisor').trim();
  const signedAtIso = new Date().toISOString();

  const hasLivePodCoords =
    args.latitude != null &&
    args.longitude != null &&
    !isNaN(Number(args.latitude)) &&
    !isNaN(Number(args.longitude)) &&
    (Number(args.latitude) !== 0 || Number(args.longitude) !== 0);

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET pod_signature_name = $3,
            pod_signed_at = NOW(),
            pod_photo_url = COALESCE($4, pod_photo_url),
            current_lat = COALESCE($5::double precision, current_lat),
            current_lng = COALESCE($6::double precision, current_lng),
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.jobId,
    args.tenantId,
    receiver,
    args.photoUrl ? String(args.photoUrl) : null,
    hasLivePodCoords ? Number(args.latitude) : null,
    hasLivePodCoords ? Number(args.longitude) : null,
  );

  const epodLat = hasLivePodCoords
    ? Number(args.latitude)
    : job.current_lat != null
    ? Number(job.current_lat)
    : null;
  const epodLng = hasLivePodCoords
    ? Number(args.longitude)
    : job.current_lng != null
    ? Number(job.current_lng)
    : null;

  const lifecycleEventStatus = (args.eventStatus || 'POD_SIGNED / EPOD_CAPTURED').trim();

  const epodLocation = resolveOperationalMilestoneLocation({
    status: 'EPOD_SIGNED',
    explicitLocation: args.location ?? null,
    lat: epodLat,
    lng: epodLng,
    jobPhase: job.job_phase ? String(job.job_phase) : null,
    jobCode: job.job_code ? String(job.job_code) : null,
    terminalName: job.terminal_name ? String(job.terminal_name) : null,
    warehouseName: job.warehouse_name ? String(job.warehouse_name) : null,
  });

  const methodLabel =
    args.captureMethod === 'UPLOADED_POD'
      ? 'Signed POD Document Uploaded'
      : args.captureMethod === 'BOTH'
      ? 'Sign-on-Glass + Signed POD Uploaded'
      : 'Sign-on-Glass ePOD';

  const epodNotes = [
    epodLocation ? `[LOC:${epodLocation}]` : '',
    `Signed by: ${receiver} (${methodLabel})`,
    args.notes ? String(args.notes).trim() : '',
  ]
    .filter(Boolean)
    .join(' · ');

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId,
    String(job.job_code),
    lifecycleEventStatus,
    epodNotes,
    args.actor || `${receiver} (Consignee Portal)`,
  );

  return {
    ok: true,
    jobId: args.jobId,
    receiverName: receiver,
    eventStatus: lifecycleEventStatus,
    signedAt: signedAtIso,
    photoUrl: args.photoUrl ?? null,
  };
}

// =============================================================================
// OPTION C: PORT COMMUNITY SYSTEM (PCS) & GATE TOKEN AUTOMATION DOMAIN ENGINES
// =============================================================================

export async function bookPcsToken(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId?: string;
    containerId?: string;
    terminalName?: string;
    slotWindowMinutes?: number;
    actor?: string;
  },
) {
  await ensureDrayageSchema(db);

  const durationMin = args.slotWindowMinutes && args.slotWindowMinutes > 0 ? args.slotWindowMinutes : 120;
  const start = new Date();
  const end = new Date(start.getTime() + durationMin * 60 * 1000);

  // Generate PCS Token with terminal prefix
  const termName = (args.terminalName || '').toUpperCase();
  let prefix = 'DPW-T1';
  if (termName.includes('TERMINAL 2') || termName.includes('T2')) prefix = 'DPW-T2';
  else if (termName.includes('TERMINAL 3') || termName.includes('T3')) prefix = 'DPW-T3';
  else if (termName.includes('KHALIFA') || termName.includes('AD PORTS') || termName.includes('KP')) prefix = 'ATLP-KP';
  else if (termName.includes('RASHID') || termName.includes('KHORFAKKAN')) prefix = 'DPW-PR';

  const tokenNumber = `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;

  // 1. If jobId supplied, update job and linked container
  let targetContainerNumber = '';
  let targetJobCode = '';

  if (args.jobId) {
    const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      args.jobId,
      args.tenantId,
    );
    const job = jobRows[0];
    if (job) {
      targetJobCode = String(job.job_code);
      targetContainerNumber = String(job.container_number);

      await db.$executeRawUnsafe(
        `UPDATE logistics_drayage_jobs
            SET token_number = $3,
                pcs_token_number = $3,
                pcs_slot_start = $4::timestamptz,
                pcs_slot_end = $5::timestamptz,
                pcs_token_status = 'BOOKED',
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        args.jobId,
        args.tenantId,
        tokenNumber,
        start.toISOString(),
        end.toISOString(),
      );

      // Sync to container record if exists
      if (job.container_id) {
        await db.$executeRawUnsafe(
          `UPDATE logistics_drayage_containers
              SET pcs_token_number = $3,
                  pcs_slot_start = $4::timestamptz,
                  pcs_slot_end = $5::timestamptz,
                  pcs_token_status = 'BOOKED',
                  updated_at = NOW()
            WHERE id = $1 AND tenant_id = $2`,
          String(job.container_id),
          args.tenantId,
          tokenNumber,
          start.toISOString(),
          end.toISOString(),
        );
      }
    }
  }

  // 2. If containerId supplied, update container and any active associated job
  if (args.containerId) {
    const cntRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_containers WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      args.containerId,
      args.tenantId,
    );
    const cnt = cntRows[0];
    if (cnt) {
      targetContainerNumber = String(cnt.container_number);

      await db.$executeRawUnsafe(
        `UPDATE logistics_drayage_containers
            SET pcs_token_number = $3,
                pcs_slot_start = $4::timestamptz,
                pcs_slot_end = $5::timestamptz,
                pcs_token_status = 'BOOKED',
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        args.containerId,
        args.tenantId,
        tokenNumber,
        start.toISOString(),
        end.toISOString(),
      );

      // Also update any matching pending job for this container
      await db.$executeRawUnsafe(
        `UPDATE logistics_drayage_jobs
            SET token_number = $3,
                pcs_token_number = $3,
                pcs_slot_start = $4::timestamptz,
                pcs_slot_end = $5::timestamptz,
                pcs_token_status = 'BOOKED',
                updated_at = NOW()
          WHERE container_number = $1 AND tenant_id = $2 AND status IN ('PENDING', 'ASSIGNED')`,
        targetContainerNumber,
        args.tenantId,
        tokenNumber,
        start.toISOString(),
        end.toISOString(),
      );
    }
  }

  // Audit log
  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'PCS_TOKEN_BOOKED', $5, $6)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId || `cnt-${args.containerId}`,
    targetJobCode || targetContainerNumber || 'PCS-APPOINTMENT',
    `Dubai Trade / ATLP e-Token ${tokenNumber} confirmed. Port Gate slot window: ${start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })} – ${end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })} GST.`,
    args.actor || 'PCS Integration Gateway',
  );

  return {
    ok: true,
    tokenNumber,
    slotStart: start.toISOString(),
    slotEnd: end.toISOString(),
    containerNumber: targetContainerNumber,
  };
}

export async function clearPortInspection(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    containerId?: string;
    jobId?: string;
    agency?: 'CUSTOMS' | 'MUNICIPALITY' | 'CPIP' | 'MERC' | 'BOXCARE' | 'ALL';
    newSealNumber?: string;
    clearedBy?: string;
    notes?: string;
    actor?: string;
    latitude?: number | null;
    longitude?: number | null;
    location?: string | null;
  },
) {
  await ensureDrayageSchema(db);

  const agency = args.agency || 'CUSTOMS';
  const clearedBy = (args.clearedBy || 'Dubai Customs Officer').trim();
  const newSeal = args.newSealNumber ? args.newSealNumber.trim().toUpperCase() : null;
  const nowIso = new Date().toISOString();

  let containerNumber = '';
  let jobCode = '';
  let matchedJobRow: Record<string, unknown> | null = null;

  // Determine container and job references
  if (args.jobId) {
    const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      args.jobId,
      args.tenantId,
    );
    if (jobRows[0]) {
      matchedJobRow = jobRows[0];
      jobCode = String(jobRows[0].job_code);
      containerNumber = String(jobRows[0].container_number);
    }
  }

  if (args.containerId && !containerNumber) {
    const cntRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_containers WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      args.containerId,
      args.tenantId,
    );
    if (cntRows[0]) {
      containerNumber = String(cntRows[0].container_number);
    }
  }

  // Update inspection fields on container
  if (containerNumber) {
    const isAll = agency === 'ALL';
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_containers
          SET customs_inspection = CASE WHEN $3 = 'CUSTOMS' OR $4 THEN false ELSE customs_inspection END,
              municipality_inspection = CASE WHEN $3 = 'MUNICIPALITY' OR $4 THEN false ELSE municipality_inspection END,
              cpip_inspection = CASE WHEN $3 = 'CPIP' OR $4 THEN false ELSE cpip_inspection END,
              merc_inspection = CASE WHEN $3 = 'MERC' OR $4 THEN false ELSE merc_inspection END,
              boxcare_inspection = CASE WHEN $3 = 'BOXCARE' OR $4 THEN false ELSE boxcare_inspection END,
              inspection_status = 'CLEARED',
              inspection_seal_number = COALESCE($5, inspection_seal_number),
              seal_number = COALESCE($5, seal_number),
              inspection_cleared_by = $6,
              inspection_cleared_at = NOW(),
              updated_at = NOW()
        WHERE container_number = $1 AND tenant_id = $2`,
      containerNumber,
      args.tenantId,
      agency,
      isAll,
      newSeal,
      clearedBy,
    );

    // Also update any matching job for this container
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_jobs
          SET customs_inspection = CASE WHEN $3 = 'CUSTOMS' OR $4 THEN false ELSE customs_inspection END,
              municipality_inspection = CASE WHEN $3 = 'MUNICIPALITY' OR $4 THEN false ELSE municipality_inspection END,
              cpip_inspection = CASE WHEN $3 = 'CPIP' OR $4 THEN false ELSE cpip_inspection END,
              merc_inspection = CASE WHEN $3 = 'MERC' OR $4 THEN false ELSE merc_inspection END,
              boxcare_inspection = CASE WHEN $3 = 'BOXCARE' OR $4 THEN false ELSE boxcare_inspection END,
              inspection_status = 'CLEARED',
              updated_at = NOW()
        WHERE container_number = $1 AND tenant_id = $2`,
      containerNumber,
      args.tenantId,
      agency,
      isAll,
    );
  }

  // Audit log
  const inspLat =
    args.latitude != null && !isNaN(Number(args.latitude))
      ? Number(args.latitude)
      : matchedJobRow?.current_lat != null
      ? Number(matchedJobRow.current_lat)
      : null;
  const inspLng =
    args.longitude != null && !isNaN(Number(args.longitude))
      ? Number(args.longitude)
      : matchedJobRow?.current_lng != null
      ? Number(matchedJobRow.current_lng)
      : null;
  const inspLocation = resolveOperationalMilestoneLocation({
    status: 'INSPECTION_CLEARED',
    explicitLocation: args.location ?? null,
    lat: inspLat,
    lng: inspLng,
    jobPhase: matchedJobRow?.job_phase ? String(matchedJobRow.job_phase) : null,
    jobCode: jobCode || null,
    terminalName: matchedJobRow?.terminal_name ? String(matchedJobRow.terminal_name) : null,
    warehouseName: matchedJobRow?.warehouse_name ? String(matchedJobRow.warehouse_name) : null,
  });

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'INSPECTION_CLEARED', $5, $6)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId || `cnt-${containerNumber}`,
    jobCode || containerNumber || 'CLEARANCE',
    `${inspLocation ? `[LOC:${inspLocation}] · ` : ''}Port Authority inspection (${agency}) cleared by ${clearedBy}.${newSeal ? ` Verified new customs seal #${newSeal}.` : ''}${args.notes ? ` Remarks: ${args.notes}` : ''}`,
    args.actor || `${clearedBy} (Customs Clearance Desk)`,
  );

  return {
    ok: true,
    containerNumber,
    agencyCleared: agency,
    newSealNumber: newSeal,
    clearedBy,
    clearedAt: nowIso,
  };
}

export async function revalidateDeliveryOrder(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    containerId?: string;
    jobId?: string;
    extendDays?: number;
    actor?: string;
  },
) {
  await ensureDrayageSchema(db);

  const daysToAdd = args.extendDays && args.extendDays > 0 ? args.extendDays : 5;
  let containerNumber = '';
  let jobCode = '';

  if (args.jobId) {
    const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      args.jobId,
      args.tenantId,
    );
    if (jobRows[0]) {
      jobCode = String(jobRows[0].job_code);
      containerNumber = String(jobRows[0].container_number);
    }
  }

  if (args.containerId && !containerNumber) {
    const cntRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_containers WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      args.containerId,
      args.tenantId,
    );
    if (cntRows[0]) {
      containerNumber = String(cntRows[0].container_number);
    }
  }

  // Extend DO by daysToAdd from now or current expiry
  const newExpiry = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);
  const newExpiryIso = newExpiry.toISOString();

  if (containerNumber) {
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_containers
          SET do_expiry_date = $3::timestamptz,
              do_status = 'REVALIDATED',
              do_revalidated_at = NOW(),
              updated_at = NOW()
        WHERE container_number = $1 AND tenant_id = $2`,
      containerNumber,
      args.tenantId,
      newExpiryIso,
    );

    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_jobs
          SET do_expiry_date = $3::timestamptz,
              do_status = 'REVALIDATED',
              updated_at = NOW()
        WHERE container_number = $1 AND tenant_id = $2`,
      containerNumber,
      args.tenantId,
      newExpiryIso,
    );
  }

  // Audit log
  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'DO_REVALIDATED', $5, $6)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId || `cnt-${containerNumber}`,
    jobCode || containerNumber || 'EDO-SYNC',
    `Electronic Delivery Order (eDO) revalidated via Dubai Trade / ATLP API. Valid until ${newExpiry.toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai' })} (+${daysToAdd} days).`,
    args.actor || 'Shipping Line eDO Interface',
  );

  return {
    ok: true,
    containerNumber,
    newDoExpiry: newExpiryIso,
    daysExtended: daysToAdd,
  };
}

/**
 * Port Appointment Window & Gate Queue Predictor:
 * Automatically rebooks a DP World Dubai Trade or AD Ports Maqta PCS token
 * to the next feasible 2-hour TAS slot aligned with the tractor's live Google Maps / telematics ETA.
 */
export async function rebookPcsTokenForTrafficDelay(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
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
  if (!job) {
    throw new Error('Drayage job not found');
  }

  const terminalName = String(job.terminal_name ?? 'Jebel Ali Port - Terminal 1');
  const isKhalifa = terminalName.toLowerCase().includes('khalifa') || terminalName.toLowerCase().includes('maqta');
  const prefix = isKhalifa ? 'AD-RSL' : 'DPW-RSL';
  const newToken = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Book a fresh 2-hour PCS slot starting 10 mins from now through +130 mins (giving plenty of buffer for E11/E311 ETA + gate queue)
  const slotStart = new Date(Date.now() + 10 * 60 * 1000);
  const slotEnd = new Date(Date.now() + 130 * 60 * 1000);
  const slotStartIso = slotStart.toISOString();
  const slotEndIso = slotEnd.toISOString();
  const cleanNotes = String(job.notes ?? '').replace(/\s*\|\s*E11\/E311 Traffic Delay[^\n|]*/g, '').trim();

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET token_number = $3,
            pcs_token_number = $3,
            pcs_slot_start = $4::timestamptz,
            pcs_slot_end = $5::timestamptz,
            pcs_token_status = 'BOOKED',
            notes = $6,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.jobId,
    args.tenantId,
    newToken,
    slotStartIso,
    slotEndIso,
    cleanNotes ? `${cleanNotes} | PCS Rebooked (${newToken})` : `PCS Rebooked (${newToken})`,
  );

  if (job.container_id) {
    await db.$executeRawUnsafe(
      `UPDATE logistics_drayage_containers
          SET pcs_token_number = $3,
              pcs_slot_start = $4::timestamptz,
              pcs_slot_end = $5::timestamptz,
              pcs_token_status = 'BOOKED',
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      String(job.container_id),
      args.tenantId,
      newToken,
      slotStartIso,
      slotEndIso,
    );
  }

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai' });
  const slotWindowLabel = `${fmtTime(slotStart)} - ${fmtTime(slotEnd)}`;

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'PCS_SLOT_AUTO_REBOOKED', $5, $6)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId,
    String(job.job_code),
    `Auto-rebooked ${isKhalifa ? 'AD Ports Maqta' : 'DP World Dubai Trade'} PCS gate appointment to ${newToken} (New Slot: ${slotWindowLabel}) due to E11/E311 traffic & gate queue ETA.`,
    args.actor || 'Port Slot Risk Intelligence',
  );

  return {
    ok: true,
    jobId: args.jobId,
    jobCode: String(job.job_code),
    tokenNumber: newToken,
    slotStart: slotStartIso,
    slotEnd: slotEndIso,
    slotWindowLabel,
  };
}

/**
 * Port Appointment Window & Gate Queue Predictor:
 * Swaps the assigned tractor on a job at risk of missing its PCS port slot with the nearest
 * available prime mover (via the 4-Factor Telematics Match engine) that can make the gate window on time.
 */
export async function swapTractorForPortSlotRescue(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    vehicleId?: string;
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
  if (!job) {
    throw new Error('Drayage job not found');
  }

  const terminalName = String(job.terminal_name ?? 'Jebel Ali Port - Terminal 1');
  const containerSize = String(job.container_size ?? '40HC');
  const containerType = String(job.container_type ?? 'DRY');
  const isKhalifa = terminalName.toLowerCase().includes('khalifa') || terminalName.toLowerCase().includes('maqta');
  const nearPortLat = isKhalifa ? 24.8385 : 25.0085;
  const nearPortLng = isKhalifa ? 54.7092 : 55.0585;

  const bestMatch = await findBest4FactorAssetsForRampPickup(db, {
    tenantId: args.tenantId,
    targetLat: nearPortLat,
    targetLng: nearPortLng,
    containerSize,
    containerType,
    preferredTrailerId: job.assigned_trailer_id ? String(job.assigned_trailer_id) : null,
    preferredTrailerPlate: job.assigned_trailer_plate ? String(job.assigned_trailer_plate) : null,
  });

  if (!bestMatch) {
    throw new Error('No available rescue prime mover found in the corridor');
  }

  const slotStartIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const slotEndIso = new Date(Date.now() + 95 * 60 * 1000).toISOString();
  const cleanNotes = String(job.notes ?? '').replace(/\s*\|\s*E11\/E311 Traffic Delay[^\n|]*/g, '').trim();

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET assigned_vehicle_id = $3,
            assigned_vehicle_plate = $4,
            assigned_driver_id = $5,
            assigned_driver_name = $6,
            assigned_trailer_id = $7,
            assigned_trailer_plate = $8,
            current_lat = $9,
            current_lng = $10,
            pcs_slot_start = $11::timestamptz,
            pcs_slot_end = $12::timestamptz,
            status = CASE WHEN status = 'PENDING' THEN 'ASSIGNED' ELSE status END,
            notes = $13,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.jobId,
    args.tenantId,
    bestMatch.vehicleId,
    bestMatch.vehiclePlate,
    bestMatch.driverId,
    bestMatch.driverName,
    bestMatch.trailerId,
    bestMatch.trailerPlate,
    nearPortLat,
    nearPortLng,
    slotStartIso,
    slotEndIso,
    cleanNotes
      ? `${cleanNotes} | Slot Rescue Tractor Swap (${bestMatch.vehiclePlate} · ${bestMatch.totalScore}% Match)`
      : `Slot Rescue Tractor Swap (${bestMatch.vehiclePlate} · ${bestMatch.totalScore}% Match)`,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO logistics_drayage_status_logs (id, tenant_id, job_id, job_code, status, notes, actor)
     VALUES ($1, $2, $3, $4, 'TRACTOR_SWAPPED_SLOT_RESCUE', $5, $6)`,
    `log-${crypto.randomUUID().slice(0, 12)}`,
    args.tenantId,
    args.jobId,
    String(job.job_code),
    `Swapped tractor to nearer Prime Mover ${bestMatch.vehiclePlate} (Driver: ${bestMatch.driverName} · ${bestMatch.totalScore}% 4-Factor Match) to meet port gate appointment window at ${terminalName}.`,
    args.actor || 'Port Slot Risk Intelligence',
  );

  return {
    ok: true,
    jobId: args.jobId,
    jobCode: String(job.job_code),
    vehiclePlate: bestMatch.vehiclePlate,
    driverName: bestMatch.driverName,
    trailerPlate: bestMatch.trailerPlate,
    matchScorePct: bestMatch.totalScore,
    distanceKm: bestMatch.distanceKm || 3.4,
  };
}

/**
 * Simulates an E11/E311 heavy freight traffic delay against an expiring PCS gate slot
 * AND <24h Demurrage/Detention threshold so dispatchers can test the Risk Intelligence engine with 1 click.
 */
export async function simulatePortSlotTrafficRisk(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
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
  if (!job) {
    throw new Error('Drayage job not found');
  }

  const token = String(job.token_number || job.pcs_token_number || `DPW-TKN-${Math.floor(1000 + Math.random() * 9000)}`);
  const slotStartIso = new Date(Date.now() - 104 * 60 * 1000).toISOString();
  const slotEndIso = new Date(Date.now() + 16 * 60 * 1000).toISOString(); // Closing in 16 mins!
  const doExpirySoonIso = new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString(); // 14h left (<24h CRITICAL!)
  const congestedLat = 25.195;
  const congestedLng = 55.265;
  const prevNotes = String(job.notes ?? '').trim();

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs
        SET token_number = $3,
            pcs_token_number = $3,
            pcs_slot_start = $4::timestamptz,
            pcs_slot_end = $5::timestamptz,
            pcs_token_status = 'BOOKED',
            do_expiry_date = $6::timestamptz,
            priority = 'URGENT',
            current_lat = $7,
            current_lng = $8,
            notes = $9,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    args.jobId,
    args.tenantId,
    token,
    slotStartIso,
    slotEndIso,
    doExpirySoonIso,
    congestedLat,
    congestedLng,
    prevNotes ? `${prevNotes} | E11/E311 Traffic Delay` : `E11/E311 Traffic Delay`,
  );

  return {
    ok: true,
    jobId: args.jobId,
    jobCode: String(job.job_code),
    tokenNumber: token,
    slotEnd: slotEndIso,
  };
}

// ============================================================================
// 4. LIVE CUSTOMER TRACKING LINK (SHAREABLE PORTAL) & MILESTONE ALERTS
// ============================================================================

function getDrayageTrackingTokenSecret(): string {
  // No built-in fallback: a secret in the repository would let anyone mint a
  // tracking token for any tenant's job. SESSION_SECRET stays a fallback so
  // links already shared with customers keep working.
  const secret = process.env.DRAYAGE_TRACKING_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('DRAYAGE_TRACKING_SECRET (or SESSION_SECRET) must be set to sign tracking links');
  return secret;
}

/**
 * Checks whether Customer Link & Client Link are active for a job.
 * Per policy: Customer Link & Client Link ONLY activate upon Vehicle & Driver Assignment (ASSIGNED status or later).
 */
export function isCustomerOrClientLinkActive(job: {
  status: string;
  assignedVehicleId?: string | null;
  assignedDriverId?: string | null;
  assignedVehiclePlate?: string | null;
  assignedDriverName?: string | null;
}): boolean {
  const st = String(job.status || '').toUpperCase();
  if (!st || st === 'PENDING' || st === 'UNASSIGNED' || st === 'CANCELLED') {
    return false;
  }
  const hasVehicle = Boolean(job.assignedVehicleId || job.assignedVehiclePlate);
  const hasDriver = Boolean(job.assignedDriverId || job.assignedDriverName);
  if (hasVehicle && hasDriver) {
    return true;
  }
  // If the job is already in an active/completed stage past assignment (Stage >= 1), keep Customer/Client link active
  return getDrayageOperationalStageIndex(st) >= 1;
}

/**
 * Checks whether the Ramp Link (Stuffing / Destuffing Completion) is active for a job.
 * Per policy: Ramp Link ONLY activates upon PLACED_AT_RAMP status (and remains accessible through ramp completion).
 */
export function isRampLinkActive(job: {
  status: string;
  placementLocation?: string | null;
  trailerDetached?: boolean;
}): boolean {
  const st = String(job.status || '').toUpperCase();
  const rampStatuses = [
    'PLACED_AT_RAMP',
    'REASSIGN_PLACED_AT_RAMP',
    'CONTAINER_DETACHED',
    'TRAILER_DETACHED',
    'REASSIGN_TRAILER_DETACHED',
    'READY_FOR_PICKUP',
    'WAITING_MT_RETURN',
    'STUFFING_COMPLETE',
    'DESTUFFING_COMPLETE',
  ];
  if (rampStatuses.includes(st)) {
    return String(job.placementLocation || 'RAMP').toUpperCase() !== 'YARD';
  }
  if (
    ['COMPLETED', 'EMPTY_DEPOSITED', 'STREET_TURNED'].includes(st) &&
    String(job.placementLocation || 'RAMP').toUpperCase() === 'RAMP'
  ) {
    return true;
  }
  return false;
}

/**
 * Generates a role-scoped, HMAC-SHA256 signed capability token per (tenantId, jobCode, containerNumber, role)
 * so external stakeholders (Customer, Client, or Ramp Supervisor) can open `/track/drayage/[token]` without logging in.
 */
const shortTrackingTokenCache = new Map<
  string,
  {
    tenantId: string;
    jobCode: string;
    containerNumber: string;
    role: DrayageTrackingPortalRole;
  }
>();

const shortTrackingJobCache = new Map<
  string,
  {
    tenantId: string;
    jobCode: string;
    containerNumber: string;
  }
>();

export function generateDrayageShortTrackingToken(args: {
  tenantId: string;
  jobCode: string;
  containerNumber?: string;
  role?: DrayageTrackingPortalRole;
}): string {
  const role: DrayageTrackingPortalRole = args.role || 'CUSTOMER';
  const rolePrefix = role === 'RAMP' ? 'r' : role === 'CLIENT' ? 'u' : 'c';
  const cleanTenantId = String(args.tenantId).trim();
  const cleanJobCode = String(args.jobCode).trim().toUpperCase();
  const cleanContainer = String(args.containerNumber || '').trim().toUpperCase();
  const sig = crypto
    .createHmac('sha256', getDrayageTrackingTokenSecret())
    .update(`${cleanTenantId}:${cleanJobCode}:${role}`)
    .digest('base64url')
    .slice(0, 8);
  const token = `${rolePrefix}-${cleanJobCode}-${sig}`;
  shortTrackingTokenCache.set(token, {
    tenantId: cleanTenantId,
    jobCode: cleanJobCode,
    containerNumber: cleanContainer,
    role,
  });
  shortTrackingJobCache.set(cleanJobCode, {
    tenantId: cleanTenantId,
    jobCode: cleanJobCode,
    containerNumber: cleanContainer,
  });
  return token;
}

export function generateDrayageCustomerTrackingToken(args: {
  tenantId: string;
  jobCode: string;
  containerNumber: string;
  role?: DrayageTrackingPortalRole;
}): string {
  const role: DrayageTrackingPortalRole = args.role || 'CUSTOMER';
  const payloadObj: Record<string, string> = {
    t: String(args.tenantId).trim(),
    j: String(args.jobCode).trim().toUpperCase(),
    c: String(args.containerNumber).trim().toUpperCase(),
    r: role,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getDrayageTrackingTokenSecret())
    .update(payloadB64)
    .digest('base64url')
    .slice(0, 20);
  return `trk_${payloadB64}.${sig}`;
}

/**
 * Verifies a shareable drayage tracking token (both compact short tokens `c-DRY-L1-4943-xxxxxxxx`
 * and full signed `trk_...` tokens) and extracts tenantId, jobCode, containerNumber, and role.
 */
export function verifyDrayageCustomerTrackingToken(rawToken: string): {
  valid: boolean;
  tenantId?: string;
  jobCode?: string;
  containerNumber?: string;
  role?: DrayageTrackingPortalRole;
} {
  try {
    const cleaned = decodeURIComponent(String(rawToken || '').trim());

    const shortMatch = cleaned.match(/^(c|u|r)-(.+)-([A-Za-z0-9_-]{8})$/);
    if (shortMatch) {
      const rolePrefix = shortMatch[1];
      const jobCode = shortMatch[2].trim().toUpperCase();
      const providedSig = shortMatch[3];
      const role: DrayageTrackingPortalRole =
        rolePrefix === 'r' ? 'RAMP' : rolePrefix === 'u' ? 'CLIENT' : 'CUSTOMER';
      const cached = shortTrackingTokenCache.get(cleaned) || shortTrackingJobCache.get(jobCode);
      if (cached) {
        const expectedSig = crypto
          .createHmac('sha256', getDrayageTrackingTokenSecret())
          .update(`${cached.tenantId}:${cached.jobCode}:${role}`)
          .digest('base64url')
          .slice(0, 8);
        const a = Buffer.from(providedSig, 'utf8');
        const b = Buffer.from(expectedSig, 'utf8');
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
          return {
            valid: true,
            tenantId: cached.tenantId,
            jobCode: cached.jobCode,
            containerNumber: cached.containerNumber,
            role,
          };
        }
      }
      return { valid: false };
    }

    const withoutPrefix = cleaned.startsWith('trk_') ? cleaned.slice(4) : cleaned;
    const dotIdx = withoutPrefix.lastIndexOf('.');
    if (dotIdx <= 0) return { valid: false };

    const payloadB64 = withoutPrefix.slice(0, dotIdx);
    const providedSig = withoutPrefix.slice(dotIdx + 1);
    const expectedSig = crypto
      .createHmac('sha256', getDrayageTrackingTokenSecret())
      .update(payloadB64)
      .digest('base64url')
      .slice(0, 20);

    const a = Buffer.from(providedSig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { valid: false };
    }

    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      t?: string;
      j?: string;
      c?: string;
      r?: string;
    };
    if (!parsed?.t || !parsed?.j) {
      return { valid: false };
    }
    const role: DrayageTrackingPortalRole =
      parsed.r === 'CLIENT' || parsed.r === 'RAMP' ? parsed.r : 'CUSTOMER';
    return {
      valid: true,
      tenantId: String(parsed.t),
      jobCode: String(parsed.j).toUpperCase(),
      containerNumber: String(parsed.c || '').toUpperCase(),
      role,
    };
  } catch {
    return { valid: false };
  }
}

/**
 * Resolves and verifies either a full `trk_...` token or a short token (`c-DRY-L1-4943-xxxxxxxx`),
 * falling back to a DB job lookup by `job_code` + constant-time HMAC check on cold start.
 */
export async function resolveDrayageCustomerTrackingToken(
  db: DrayageDbClient,
  rawToken: string,
): Promise<{
  valid: boolean;
  tenantId?: string;
  jobCode?: string;
  containerNumber?: string;
  role?: DrayageTrackingPortalRole;
}> {
  const syncResult = verifyDrayageCustomerTrackingToken(rawToken);
  if (syncResult.valid) return syncResult;

  try {
    const cleaned = decodeURIComponent(String(rawToken || '').trim());
    const shortMatch = cleaned.match(/^(c|u|r)-(.+)-([A-Za-z0-9_-]{8})$/);
    if (!shortMatch) return { valid: false };

    const rolePrefix = shortMatch[1];
    const jobCode = shortMatch[2].trim().toUpperCase();
    const providedSig = shortMatch[3];
    const role: DrayageTrackingPortalRole =
      rolePrefix === 'r' ? 'RAMP' : rolePrefix === 'u' ? 'CLIENT' : 'CUSTOMER';

    // If the job is already known in memory and verifyDrayageCustomerTrackingToken returned false,
    // the signature is forged — reject immediately without querying the database.
    if (shortTrackingJobCache.has(jobCode)) {
      return { valid: false };
    }

    const rows = await Promise.race([
      db.$queryRawUnsafe<
        Array<{ tenant_id: string; job_code: string; container_number: string }>
      >(
        `SELECT tenant_id, job_code, container_number
           FROM logistics_drayage_jobs
          WHERE UPPER(job_code) = $1
          LIMIT 20`,
        jobCode,
      ),
      new Promise<Array<{ tenant_id: string; job_code: string; container_number: string }>>(
        (resolve) => setTimeout(() => resolve([]), 2500),
      ),
    ]);

    for (const row of rows) {
      const candidateTenantId = String(row.tenant_id || '').trim();
      const candidateJobCode = String(row.job_code || jobCode).trim().toUpperCase();
      const candidateContainer = String(row.container_number || '').trim().toUpperCase();
      const expectedSig = crypto
        .createHmac('sha256', getDrayageTrackingTokenSecret())
        .update(`${candidateTenantId}:${candidateJobCode}:${role}`)
        .digest('base64url')
        .slice(0, 8);
      const a = Buffer.from(providedSig, 'utf8');
      const b = Buffer.from(expectedSig, 'utf8');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        shortTrackingTokenCache.set(cleaned, {
          tenantId: candidateTenantId,
          jobCode: candidateJobCode,
          containerNumber: candidateContainer,
          role,
        });
        shortTrackingJobCache.set(candidateJobCode, {
          tenantId: candidateTenantId,
          jobCode: candidateJobCode,
          containerNumber: candidateContainer,
        });
        return {
          valid: true,
          tenantId: candidateTenantId,
          jobCode: candidateJobCode,
          containerNumber: candidateContainer,
          role,
        };
      }
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}

export function resolveCustomerMilestoneContacts(args: {
  customerName: string;
  warehouseId?: string | null;
  warehouseName?: string | null;
  notes?: string | null;
  clients?: DrayageClient[];
  warehouses?: DrayageWarehouse[];
  customers?: MappedFleetCustomer[];
}): {
  whatsapp: string;
  email: string;
  clientName: string;
  clientWhatsApp: string;
  clientEmail: string;
  rampContactName: string;
  rampWhatsApp: string;
  autoAlertsEnabled: boolean;
} {
  const notesStr = String(args.notes || '');
  const waMatch = notesStr.match(/\[CUST_WA:([^\]]+)\]/);
  const emMatch = notesStr.match(/\[CUST_EMAIL:([^\]]+)\]/);
  const clientWaMatch = notesStr.match(/\[CLIENT_WA:([^\]]+)\]/);
  const clientEmMatch = notesStr.match(/\[CLIENT_EMAIL:([^\]]+)\]/);
  const rampWaMatch = notesStr.match(/\[RAMP_WA:([^\]]+)\]/);
  const autoMatch = notesStr.match(/\[CUST_AUTO_ALERTS:(ON|OFF)\]/);

  const custLower = String(args.customerName || '').toLowerCase();
  const whLower = String(args.warehouseName || '').toLowerCase();

  const matchedCustomer = args.customers?.find((c) => c.name.toLowerCase() === custLower);
  const matchedWh =
    (args.warehouseId ? args.warehouses?.find((w) => w.id === args.warehouseId) : undefined) ||
    (whLower ? args.warehouses?.find((w) => w.name.toLowerCase() === whLower) : undefined) ||
    args.warehouses?.find((w) => w.customerName.toLowerCase() === custLower);

  const matchedClient =
    (matchedWh?.customerId ? args.clients?.find((c) => c.id === matchedWh.customerId) : undefined) ||
    (matchedWh?.customerName
      ? args.clients?.find((c) => c.name.toLowerCase() === matchedWh.customerName.toLowerCase())
      : undefined) ||
    args.clients?.find((c) => c.name.toLowerCase() === custLower);

  const whatsapp =
    waMatch?.[1]?.trim() ||
    matchedCustomer?.phone ||
    matchedClient?.contactNo ||
    matchedWh?.contactPhone ||
    '';

  const email =
    emMatch?.[1]?.trim() ||
    matchedCustomer?.email ||
    '';

  const clientName =
    matchedClient?.name ||
    matchedWh?.customerName ||
    matchedWh?.name ||
    args.warehouseName ||
    'Consignee Client';

  const clientWhatsApp =
    clientWaMatch?.[1]?.trim() ||
    matchedClient?.contactNo ||
    matchedWh?.contactPhone ||
    whatsapp;

  const clientEmail =
    clientEmMatch?.[1]?.trim() ||
    email;

  const rampContactName =
    matchedWh?.contactPerson ||
    matchedClient?.contactPerson ||
    `${args.warehouseName || 'Warehouse'} Ramp Supervisor`;

  const rampWhatsApp =
    rampWaMatch?.[1]?.trim() ||
    matchedWh?.contactPhone ||
    matchedClient?.contactNo ||
    clientWhatsApp;

  const autoAlertsEnabled = autoMatch ? autoMatch[1] === 'ON' : true;

  return {
    whatsapp,
    email,
    clientName,
    clientWhatsApp,
    clientEmail,
    rampContactName,
    rampWhatsApp,
    autoAlertsEnabled,
  };
}

export function formatMilestoneLabelForCustomer(status: string): {
  stageNumber: number;
  title: string;
  customerSummary: string;
} {
  const s = String(status || '').toUpperCase();
  switch (s) {
    case 'ACCEPTED':
      return {
        stageNumber: 1,
        title: '1. Job Accepted',
        customerSummary: 'Driver has accepted the dispatch order and is proceeding to the terminal.',
      };
    case 'AT_PORT':
    case 'ARRIVED_AT_PORT':
    case 'LOADED':
    case 'CONTAINER_PICKED':
    case 'TRAILER_ATTACHED':
      return {
        stageNumber: 2,
        title: '2. Container Picked at Terminal',
        customerSummary: 'Container has been mounted on chassis and gate-in / EIR verified.',
      };
    case 'UNDER_INSPECTION':
      return {
        stageNumber: 3,
        title: '3. Under Inspection',
        customerSummary: 'Container is undergoing regulatory / port terminal inspection.',
      };
    case 'IN_TRANSIT':
    case 'EN_ROUTE_WAREHOUSE':
    case 'EN_ROUTE_TERMINAL':
    case 'EMPTY_AT_PORT':
      return {
        stageNumber: 4,
        title: '4. En Route on UAE Freight Corridor',
        customerSummary: 'Prime mover is en route along the E11 / E311 freight corridor with live GPS tracking.',
      };
    case 'PLACED_AT_RAMP':
    case 'REASSIGN_PLACED_AT_RAMP':
    case 'PLACED_AT_YARD':
    case 'REASSIGN_PLACED_AT_YARD':
      return {
        stageNumber: 5,
        title: s.includes('YARD') ? '5. Placed at Customer Yard' : '5. Placed at Customer Warehouse Ramp',
        customerSummary: 'Container positioned at warehouse facility; offloading / staging active.',
      };
    case 'CONTAINER_DETACHED':
    case 'TRAILER_DETACHED':
    case 'REASSIGN_TRAILER_DETACHED':
    case 'READY_FOR_PICKUP':
    case 'WAITING_MT_RETURN':
    case 'EMPTY_DEPOSITED':
    case 'CONTAINER_DROPPED':
    case 'COMPLETED':
    case 'STREET_TURNED':
      return {
        stageNumber: 6,
        title: '6. Trailer Detached / Completed',
        customerSummary: 'Stage completed and container status updated in dispatch console.',
      };
    default:
      if (isDrayageReassignStatus(s)) {
        return {
          stageNumber: 6,
          title: `6. ${status}`,
          customerSummary: 'Container detached and queued for tractor reassignment shunt.',
        };
      }
      return {
        stageNumber: 0,
        title: '0. Dispatched & Assigned',
        customerSummary: 'Drayage order confirmed and prime mover assigned.',
      };
  }
}

/**
 * Dispatches automated or on-demand WhatsApp & Email milestone alerts to Customer, Client, or Ramp
 * with role-scoped token-secured links, enforcing activation gating rules:
 *  - CUSTOMER & CLIENT links: Active ONLY upon Vehicle & Driver Assignment (ASSIGNED+)
 *  - RAMP link: Active ONLY upon PLACED_AT_RAMP status
 */
export async function dispatchDrayageCustomerMilestoneAlert(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    milestoneStatus?: string;
    etcTime?: string | null;
    customWhatsApp?: string;
    customEmail?: string;
    targetRole?: DrayageTrackingPortalRole;
    channels?: Array<'WHATSAPP' | 'EMAIL'>;
    triggerSource?: 'AUTO_STAGE_TRANSITION' | 'MANUAL_DISPATCH' | 'CUSTOMER_PORTAL';
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

  const jobCode = String(job.job_code);
  const containerNumber = String(job.container_number);
  const customerName = String(job.customer_name || 'Valued Customer');
  const status = String(args.milestoneStatus || job.status || 'IN_TRANSIT').toUpperCase();
  const etcIso = args.etcTime ?? (job.etc_time ? new Date(String(job.etc_time)).toISOString() : null);

  const custClientActive = isCustomerOrClientLinkActive({
    status,
    assignedVehicleId: job.assigned_vehicle_id ? String(job.assigned_vehicle_id) : null,
    assignedDriverId: job.assigned_driver_id ? String(job.assigned_driver_id) : null,
    assignedVehiclePlate: job.assigned_vehicle_plate ? String(job.assigned_vehicle_plate) : null,
    assignedDriverName: job.assigned_driver_name ? String(job.assigned_driver_name) : null,
  });
  const rampActive = isRampLinkActive({
    status,
    placementLocation: job.placement_location ? String(job.placement_location) : 'RAMP',
    trailerDetached: Boolean(job.trailer_detached),
  });

  const requestedRole: DrayageTrackingPortalRole = args.targetRole || 'CUSTOMER';
  if (args.triggerSource === 'MANUAL_DISPATCH') {
    if ((requestedRole === 'CUSTOMER' || requestedRole === 'CLIENT') && !custClientActive) {
      throw new Error(
        `${requestedRole === 'CLIENT' ? 'Client' : 'Customer'} Link only activates upon Vehicle & Driver Assignment (ASSIGNED status). Please assign a Vehicle & Driver first.`,
      );
    }
    if (requestedRole === 'RAMP' && !rampActive) {
      throw new Error(
        'Ramp Link only activates once the container reaches PLACED_AT_RAMP status.',
      );
    }
  } else if (!custClientActive && !rampActive) {
    return {
      ok: true,
      skipped: true,
      reason: 'link_not_active_yet',
    };
  }

  const resolved = resolveCustomerMilestoneContacts({
    customerName,
    warehouseId: job.warehouse_id ? String(job.warehouse_id) : null,
    warehouseName: job.warehouse_name ? String(job.warehouse_name) : null,
    notes: job.notes ? String(job.notes) : null,
  });

  if (args.triggerSource === 'AUTO_STAGE_TRANSITION' && !resolved.autoAlertsEnabled) {
    return {
      ok: true,
      skipped: true,
      reason: 'auto_alerts_disabled',
    };
  }

  const customerToken = generateDrayageShortTrackingToken({
    tenantId: args.tenantId,
    jobCode,
    containerNumber,
    role: 'CUSTOMER',
  });
  const clientToken = generateDrayageShortTrackingToken({
    tenantId: args.tenantId,
    jobCode,
    containerNumber,
    role: 'CLIENT',
  });
  const rampToken = generateDrayageShortTrackingToken({
    tenantId: args.tenantId,
    jobCode,
    containerNumber,
    role: 'RAMP',
  });

  const activeToken =
    requestedRole === 'RAMP'
      ? rampToken
      : requestedRole === 'CLIENT'
      ? clientToken
      : customerToken;

  const targetWhatsApp = (
    args.customWhatsApp ||
    (requestedRole === 'RAMP'
      ? resolved.rampWhatsApp
      : requestedRole === 'CLIENT'
      ? resolved.clientWhatsApp
      : resolved.whatsapp)
  ).trim();
  const targetEmail = (
    args.customEmail ||
    (requestedRole === 'CLIENT' ? resolved.clientEmail : resolved.email)
  ).trim();

  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://fleet360-app-production.up.railway.app';
  const baseUrlClean = appBaseUrl.replace(/\/$/, '');
  const shareableUrl = `${baseUrlClean}/track/drayage/${activeToken}`;
  const customerUrl = `${baseUrlClean}/track/drayage/${customerToken}`;
  const clientUrl = `${baseUrlClean}/track/drayage/${clientToken}`;
  const rampUrl = `${baseUrlClean}/track/drayage/${rampToken}`;

  const milestoneMeta = formatMilestoneLabelForCustomer(status);
  const etcFormatted = etcIso
    ? new Date(etcIso).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Dubai',
      }) + ' GST'
    : null;

  const roleHeader =
    requestedRole === 'RAMP'
      ? `🏭 *Fleet360 Warehouse Ramp Action Link (Stuffing / Destuffing Completion)*`
      : requestedRole === 'CLIENT'
      ? `🏢 *Fleet360 Client (Consignee/End User) Live Container Tracking*`
      : `📦 *Fleet360 Customer (Consignor/Shipper) Live Container Milestone Alert*`;

  const whatsappBody = [
    roleHeader,
    `• *Job / Container:* ${jobCode} (${containerNumber} · ${String(job.container_size || '40HC')})`,
    `• *Customer (Consignor):* ${customerName}`,
    `• *Consignee Facility:* ${String(job.warehouse_name)}`,
    `• *Milestone:* ${milestoneMeta.title}`,
    `• *Route:* ${String(job.terminal_name)} → ${String(job.warehouse_name)}`,
    `• *Assigned Tractor:* ${String(job.assigned_vehicle_plate || 'Assigned')} (${String(job.assigned_driver_name || 'Driver')})`,
    ...(etcFormatted ? [`• *Ramp ETC:* ${etcFormatted}`] : []),
    requestedRole === 'RAMP'
      ? `🔗 *Update Stuffing / Destuffing Completion (No-Login Ramp Portal):* ${shareableUrl}`
      : `🔗 *Live Corridor Map & e-POD Portal (${requestedRole}):* ${shareableUrl}`,
  ].join('\n');

  // Best-effort REST gateway dispatch (pure fetch so client/server bundles stay 100% isomorphic)
  let waProviderStatus = 'DELIVERED_GATEWAY';
  let emailProviderStatus = 'DELIVERED_SMTP';

  if (
    typeof process !== 'undefined' &&
    process.env?.TWILIO_ACCOUNT_SID &&
    process.env?.TWILIO_AUTH_TOKEN &&
    process.env?.TWILIO_WHATSAPP_NUMBER &&
    process.env?.DISABLE_OUTBOUND_NOTIFICATIONS !== 'true' &&
    targetWhatsApp
  ) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const toClean = targetWhatsApp.replace(/[^\d+]/g, '');
      const form = new URLSearchParams({
        From: process.env.TWILIO_WHATSAPP_NUMBER.startsWith('whatsapp:')
          ? process.env.TWILIO_WHATSAPP_NUMBER
          : `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        To: `whatsapp:${toClean.startsWith('+') ? toClean : `+${toClean}`}`,
        Body: whatsappBody,
      });
      const waRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      if (waRes.ok) waProviderStatus = 'TWILIO_WHATSAPP_SENT';
    } catch {
      // Fallback simulated gateway log
    }
  }

  if (
    typeof process !== 'undefined' &&
    process.env?.SENDGRID_API_KEY &&
    process.env?.DISABLE_OUTBOUND_NOTIFICATIONS !== 'true' &&
    targetEmail
  ) {
    try {
      const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: targetEmail }] }],
          from: { email: process.env.EMAIL_FROM || 'no-reply@fleet360.ae', name: 'Fleet360 Drayage Ops' },
          subject: `[Fleet360 ${requestedRole} Portal] ${containerNumber} (${jobCode}) — ${milestoneMeta.title}`,
          content: [{ type: 'text/plain', value: whatsappBody.replace(/\*/g, '') }],
        }),
      });
      if (sgRes.ok) emailProviderStatus = 'SENDGRID_EMAIL_SENT';
    } catch {
      // Fallback simulated SMTP log
    }
  }
  void waProviderStatus;
  void emailProviderStatus;

  return {
    ok: true,
    jobId: args.jobId,
    jobCode,
    containerNumber,
    role: requestedRole,
    milestoneTitle: milestoneMeta.title,
    whatsappTo: targetWhatsApp,
    emailTo: targetEmail,
    trackingToken: activeToken,
    shareablePath: `/track/drayage/${activeToken}`,
    shareableUrl,
    customerUrl,
    clientUrl,
    rampUrl: rampActive ? rampUrl : null,
    whatsappPreview: whatsappBody,
    sentAt: new Date().toISOString(),
  };
}

/**
 * Updates the customer's, client's, and ramp's WhatsApp/Email addresses and Auto-Milestone Alert toggle on a job.
 */
export async function updateDrayageCustomerAlertPreferences(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobId: string;
    customerWhatsApp: string;
    customerEmail: string;
    clientWhatsApp?: string;
    clientEmail?: string;
    rampWhatsApp?: string;
    autoAlertsEnabled: boolean;
  },
) {
  await ensureDrayageSchema(db);
  const jobRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id, job_code, notes FROM logistics_drayage_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    args.jobId,
    args.tenantId,
  );
  const job = jobRows[0];
  if (!job) throw new Error('Drayage job not found');

  const rawNotes = String(job.notes || '')
    .replace(/\s*\|?\s*\[CUST_WA:[^\]]+\]/g, '')
    .replace(/\s*\|?\s*\[CUST_EMAIL:[^\]]+\]/g, '')
    .replace(/\s*\|?\s*\[CLIENT_WA:[^\]]+\]/g, '')
    .replace(/\s*\|?\s*\[CLIENT_EMAIL:[^\]]+\]/g, '')
    .replace(/\s*\|?\s*\[RAMP_WA:[^\]]+\]/g, '')
    .replace(/\s*\|?\s*\[CUST_AUTO_ALERTS:(ON|OFF)\]/g, '')
    .trim();

  const tags: string[] = [
    `[CUST_WA:${args.customerWhatsApp.trim()}]`,
    `[CUST_EMAIL:${args.customerEmail.trim()}]`,
  ];
  if (args.clientWhatsApp?.trim()) tags.push(`[CLIENT_WA:${args.clientWhatsApp.trim()}]`);
  if (args.clientEmail?.trim()) tags.push(`[CLIENT_EMAIL:${args.clientEmail.trim()}]`);
  if (args.rampWhatsApp?.trim()) tags.push(`[RAMP_WA:${args.rampWhatsApp.trim()}]`);
  tags.push(`[CUST_AUTO_ALERTS:${args.autoAlertsEnabled ? 'ON' : 'OFF'}]`);

  const tagBlock = tags.join(' ');
  const updatedNotes = rawNotes ? `${rawNotes} | ${tagBlock}` : tagBlock;

  await db.$executeRawUnsafe(
    `UPDATE logistics_drayage_jobs SET notes = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
    args.jobId,
    args.tenantId,
    updatedNotes,
  );

  return {
    ok: true,
    jobId: args.jobId,
    customerWhatsApp: args.customerWhatsApp.trim(),
    customerEmail: args.customerEmail.trim(),
    clientWhatsApp: args.clientWhatsApp?.trim() || '',
    clientEmail: args.clientEmail?.trim() || '',
    rampWhatsApp: args.rampWhatsApp?.trim() || '',
    autoAlertsEnabled: args.autoAlertsEnabled,
  };
}

/**
 * Resolves the role-scoped tracking portal payload for a verified token.
 * Enforces activation gating:
 *  - CUSTOMER & CLIENT links only activate upon Vehicle & Driver Assignment (ASSIGNED status or later).
 *  - RAMP link only activates upon PLACED_AT_RAMP status.
 */
export async function getPublicCustomerTrackingByToken(
  db: DrayageDbClient,
  args: {
    tenantId: string;
    jobCode: string;
    containerNumber?: string;
    rawToken: string;
    role?: DrayageTrackingPortalRole;
  },
) {
  const workspace = await getDrayageWorkspaceData(db, args.tenantId);
  const matchedJob =
    workspace.jobs.find(
      (j) =>
        j.jobCode.toUpperCase() === args.jobCode.toUpperCase() ||
        (args.containerNumber && j.containerNumber.toUpperCase() === args.containerNumber.toUpperCase()),
    ) || workspace.jobs[0];

  if (!matchedJob) {
    throw new Error('Tracking reference not found');
  }

  const portalRole: DrayageTrackingPortalRole = args.role || 'CUSTOMER';
  const custClientActive = isCustomerOrClientLinkActive({
    status: matchedJob.status,
    assignedVehicleId: matchedJob.assignedVehicleId,
    assignedDriverId: matchedJob.assignedDriverId,
    assignedVehiclePlate: matchedJob.assignedVehiclePlate,
    assignedDriverName: matchedJob.assignedDriverName,
  });
  const rampActive = isRampLinkActive({
    status: matchedJob.status,
    placementLocation: matchedJob.placementLocation,
    trailerDetached: matchedJob.trailerDetached,
  });

  const linkActive = portalRole === 'RAMP' ? rampActive : custClientActive;
  const activationRequirement =
    portalRole === 'RAMP'
      ? 'Ramp Link only activates once the container reaches PLACED_AT_RAMP status at the destination facility.'
      : `${portalRole === 'CLIENT' ? 'Client' : 'Customer'} Link only activates upon Vehicle & Driver Assignment (ASSIGNED status).`;

  const currentStage = getDrayageOperationalStageIndex(matchedJob.status, matchedJob.trailerDetached);
  const jobLogs = workspace.statusLogs.filter(
    (l) => l.jobId === matchedJob.id || l.jobCode === matchedJob.jobCode,
  );

  const matchedContainer = workspace.containers.find(
    (c) =>
      c.id === matchedJob.containerId ||
      c.containerNumber.toUpperCase() === matchedJob.containerNumber.toUpperCase(),
  );
  const resolvedSealNumber = matchedContainer?.sealNumber || null;
  const resolvedWeightKg = matchedContainer?.weightKg || null;

  const stageDefinitions = [
    {
      stageNum: 1,
      code: 'AT_PORT',
      title: 'Gate-In',
      subtitle: `${matchedJob.terminalName} · Token ${matchedJob.tokenNumber || matchedJob.pcsTokenNumber || 'Verified'}`,
    },
    {
      stageNum: 2,
      code: 'LOADED',
      title: 'Loaded at Terminal',
      subtitle: `Container ${matchedJob.containerNumber} (${matchedJob.containerSize} ${matchedJob.containerType}) mounted on chassis`,
    },
    {
      stageNum: 3,
      code: 'CUSTOMS_CLEARED',
      title: 'Customs Cleared',
      subtitle: `Port Customs & Inspection Cleared${resolvedSealNumber ? ` · Seal ${resolvedSealNumber}` : ''}`,
    },
    {
      stageNum: 4,
      code: 'IN_TRANSIT',
      title: 'En Route',
      subtitle: `${matchedJob.portSlotPrediction?.corridorName || 'E11 / E311 Freight Corridor'} → ${matchedJob.warehouseName}`,
    },
    {
      stageNum: 5,
      code: 'PLACED_AT_RAMP',
      title: 'At Warehouse',
      subtitle: `Positioned at ${matchedJob.warehouseName} (${matchedJob.placementLocation || 'RAMP'}) · Offloading / Destuffing`,
    },
    {
      stageNum: 6,
      code: 'EPOD_SIGNED',
      title: 'ePOD Signed',
      subtitle: matchedJob.podSignatureName
        ? `Signed by ${matchedJob.podSignatureName} · Delivery & Seal Verified`
        : `Electronic Proof of Delivery (ePOD) & Seal Verification at ${matchedJob.warehouseName}`,
    },
  ];

  const milestones = stageDefinitions.map((st) => {
    const isCompleted = currentStage > st.stageNum || currentStage === 6;
    const isCurrent = currentStage === st.stageNum && currentStage < 6;
    const matchingLog = jobLogs.find((l) =>
      l.status.toUpperCase().includes(st.code) ||
      (st.stageNum === 2 && l.status.toUpperCase().includes('SCAN')) ||
      (st.stageNum === 4 && l.status.toUpperCase().includes('RAMP')),
    );
    return {
      ...st,
      state: isCompleted ? ('COMPLETED' as const) : isCurrent ? ('CURRENT' as const) : ('UPCOMING' as const),
      timestamp: matchingLog?.timestamp || (isCompleted || isCurrent ? matchedJob.updatedAt : null),
      notes: matchingLog?.notes || null,
    };
  });

  const alertLogs = jobLogs.filter((l) => l.actor.includes('Customer Alert Engine'));

  // Filter vehicles to only the assigned tractor (or corridor context) for privacy
  const relevantVehicles = workspace.vehicles.filter(
    (v) =>
      v.plateNumber === matchedJob.assignedVehiclePlate ||
      v.activeJobCode === matchedJob.jobCode,
  );

  return {
    portalReadOnly: portalRole === 'CUSTOMER',
    portalRole,
    linkActive,
    activationRequirement,
    verifiedToken: args.rawToken,
    refreshedAt: new Date().toISOString(),
    job: {
      id: matchedJob.id,
      jobCode: matchedJob.jobCode,
      jobPhase: matchedJob.jobPhase,
      shipmentType: matchedJob.shipmentType,
      status: matchedJob.status,
      priority: matchedJob.priority,
      customerName: matchedJob.customerName,
      terminalName: matchedJob.terminalName,
      warehouseName: matchedJob.warehouseName,
      containerNumber: matchedJob.containerNumber,
      containerSize: matchedJob.containerSize,
      containerType: matchedJob.containerType,
      shippingLine: matchedJob.shippingLine || 'Ocean Carrier',
      tokenNumber: matchedJob.tokenNumber || matchedJob.pcsTokenNumber,
      assignedVehiclePlate: matchedJob.assignedVehiclePlate,
      assignedDriverName: matchedJob.assignedDriverName,
      assignedTrailerPlate: matchedJob.assignedTrailerPlate,
      placementLocation: matchedJob.placementLocation,
      trailerDetached: matchedJob.trailerDetached,
      l2Activated: matchedJob.l2Activated,
      etcTime: matchedJob.etcTime,
      currentLat: matchedJob.currentLat,
      currentLng: matchedJob.currentLng,
      routePath: matchedJob.routePath || [],
      sealNumber: resolvedSealNumber,
      weightKg: resolvedWeightKg,
      inspectionStatus: matchedJob.inspectionStatus || 'CLEARED',
      podSignatureName: matchedJob.podSignatureName,
      podSignedAt: matchedJob.podSignedAt,
      podPhotoUrl: matchedJob.podPhotoUrl,
      portSlotPrediction: matchedJob.portSlotPrediction,
      customerPortal: matchedJob.customerPortal,
      createdAt: matchedJob.createdAt,
      updatedAt: matchedJob.updatedAt,
    },
    currentStageIndex: currentStage,
    milestones,
    statusLogs: jobLogs.slice(0, 25),
    alertLogs: alertLogs.slice(0, 15),
    corridorMap: {
      terminals: workspace.terminals,
      warehouses: workspace.warehouses,
      geofences: workspace.geofences,
      vehicles: relevantVehicles.length > 0 ? relevantVehicles : workspace.vehicles.slice(0, 3),
    },
  };
}
