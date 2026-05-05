/**
 * TRIPEXL Auto-Dispatch — Shared Type Definitions
 */

export type ServiceType =
  | 'PASSENGER'   // Staff / VIP transport
  | 'FREIGHT'     // Cargo / logistics
  | 'DELIVERY'    // Last-mile / parcel
  | 'AMBULANCE'   // Emergency medical
  | 'TECHNICIAN'  // On-site service / maintenance
  | 'SCHOOL_BUS'; // Fixed route student transport

export type AmbulancePriority = 'P1' | 'P2' | 'P3';

export type DispatchPriority =
  | AmbulancePriority  // P1 = full preemption, P2 = limited, P3 = normal
  | 'EMERGENCY'        // Non-ambulance emergency
  | 'URGENT'           // SLA < 15 min
  | 'NORMAL'           // Standard booking
  | 'SCHEDULED';       // Pre-scheduled (lowest priority)

export type DispatchStatus =
  | 'PENDING'      // Created, not yet processed
  | 'SEARCHING'    // Eligibility + scoring running
  | 'OFFERED'      // Offered to driver, awaiting response
  | 'ACCEPTED'     // Driver accepted
  | 'IN_PROGRESS'  // Trip underway
  | 'COMPLETED'    // Trip finished
  | 'RETRYING'     // Current driver rejected, trying next
  | 'ESCALATED'    // All candidates exhausted → manual intervention
  | 'FAILED'       // SLA breached or unrecoverable
  | 'CANCELLED';   // Booking cancelled

export type AttemptResponse = 'ACCEPTED' | 'REJECTED' | 'TIMEOUT' | 'FAILED';

export type AmbulanceLevel = 'BLS' | 'ALS' | 'ICU';

/* ─────────────────────────────────────────────────────────────
   Core domain objects
───────────────────────────────────────────────────────────── */

export interface DispatchJob {
  id:               string;
  tenantId:         string;
  bookingId?:       string;
  serviceType:      ServiceType;
  priority:         DispatchPriority;
  status:           DispatchStatus;
  currentAttempt:   number;
  maxAttempts:      number;
  pickupLat?:       number;
  pickupLng?:       number;
  dropoffLat?:      number;
  dropoffLng?:      number;
  zoneId?:          string;
  slaDeadline?:     Date;
  assignedDriverId?:  string;
  assignedVehicleId?: string;
  dispatchScore?:   number;
  escalatedAt?:     Date;
  completedAt?:     Date;
  /** Service-specific payload (passengers, cargo dims, skill requirements, etc.) */
  metadata?:        DispatchMetadata;
  createdAt:        Date;
  updatedAt:        Date;
}

/** Union of per-service metadata shapes */
export type DispatchMetadata =
  | PassengerMeta
  | FreightMeta
  | AmbulanceMeta
  | TechnicianMeta
  | Record<string, unknown>;

export interface PassengerMeta {
  passengerCount:   number;
  requireChildSeat?: boolean;
  requireWheelchair?: boolean;
  tripMergeGroupId?: string;
}

export interface FreightMeta {
  weightKg:             number;
  volumeCbm:            number;
  requiredVehicleType?: string;  // 'PICKUP' | 'VAN' | 'TRUCK' | 'FLATBED'
  hazmAt?:              boolean;
  hsCode?:              string;
  temperatureControlled?: boolean;
}

export interface AmbulanceMeta {
  requiredAmbulanceLevel: AmbulanceLevel;  // 'BLS' | 'ALS' | 'ICU'
  requiredEquipment:      string[];         // ['ventilator', 'defibrillator', ...]
  patientCondition?:      string;
  destinationFacility?:   string;
}

export interface TechnicianMeta {
  requiredSkills:   string[];   // ['HVAC', 'ELECTRICAL', 'PLUMBING', ...]
  slaDeadlineMin?:  number;     // minutes from booking creation
  jobDescription?:  string;
}

export interface DispatchAttempt {
  id:               string;
  dispatchJobId:    string;
  attemptNumber:    number;
  driverId?:        string;
  vehicleId?:       string;
  score?:           number;
  distanceKm?:      number;
  etaMinutes?:      number;
  offeredAt?:       Date;
  respondedAt?:     Date;
  response?:        AttemptResponse;
  rejectionReason?: string;
  scoreBreakdown?:  Record<string, number>;
  acceptToken?:     string;
  createdAt:        Date;
}

/* ─────────────────────────────────────────────────────────────
   Configuration
───────────────────────────────────────────────────────────── */

export interface DispatchWeights {
  /** Smaller distance = better  [0..1] */
  distance:        number;
  /** Smaller ETA = better        [0..1] */
  eta:             number;
  /** Driver rating 0-5           [0..1] */
  rating:          number;
  /** Lower cost = better         [0..1] */
  cost:            number;
  /** Cargo capacity match        [0..1] */
  load?:           number;
  /** Technician skill match      [0..1] */
  skill?:          number;
  /** Ambulance equipment match   [0..1] */
  equipment?:      number;
  /** Crew readiness/certification [0..1] */
  crewReadiness?:  number;
  /** Historical reliability      [0..1] */
  reliability?:    number;
}

export interface DispatchConfig {
  id?:                      string;
  tenantId?:                string;
  serviceType:              ServiceType;
  priority:                 DispatchPriority;
  weights:                  DispatchWeights;
  maxAttempts:              number;
  driverResponseTimeoutMin: number;
  dispatchRadiusKm:         number;
  preferSameZone:           boolean;
  crossZoneAllowed:         boolean;
  allowPreemption:          boolean;
  preemptiblePriorities?:   DispatchPriority[];
}

/* ─────────────────────────────────────────────────────────────
   Candidate (output of eligibility engine, input to scoring)
───────────────────────────────────────────────────────────── */

export interface Candidate {
  driverId:          string;
  vehicleId:         string;
  distanceKm:        number;
  etaMinutes:        number;
  driverRating:      number;   // 0-5
  vehicleCapacity:   number;   // seats or payload kg
  utilizationScore:  number;   // 0-1 (lower = less utilised = prefer)
  costPerKm:         number;
  zoneId?:           string;
  skillTags?:        string[];
  equipmentTags?:    string[];
  ambulanceLevel?:   AmbulanceLevel;
  // Computed after scoring
  score?:            number;
  scoreBreakdown?:   Record<string, number>;
}

/* ─────────────────────────────────────────────────────────────
   Geo
───────────────────────────────────────────────────────────── */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/* ─────────────────────────────────────────────────────────────
   School Bus
───────────────────────────────────────────────────────────── */

export interface SchoolBusRoute {
  id:                 string;
  tenantId:           string;
  routeName:          string;
  routeCode?:         string;
  direction:          'PICKUP' | 'DROPOFF' | 'BOTH';
  departureTime:      string;  // HH:MM
  arrivalTime?:       string;
  assignedVehicleId?: string;
  assignedDriverId?:  string;
  studentCount:       number;
  waypoints:          RouteWaypoint[];
  status:             'ACTIVE' | 'INACTIVE' | 'IN_PROGRESS' | 'COMPLETED';
  createdAt:          Date;
  updatedAt:          Date;
}

export interface RouteWaypoint {
  sequence:   number;
  lat:        number;
  lng:        number;
  stopName:   string;
  studentIds: string[];
  scheduledArrival?: string;
}

/* ─────────────────────────────────────────────────────────────
   Ambulance capability
───────────────────────────────────────────────────────────── */

export interface AmbulanceCapability {
  vehicleId:          string;
  level:              AmbulanceLevel;
  equipment:          string[];
  paramedicId?:       string;
  paramedicCertified: boolean;
  certifiedAt?:       Date;
  expiresAt?:         Date;
  operationalStatus:  'READY' | 'BUSY' | 'MAINTENANCE' | 'OFFLINE';
}
