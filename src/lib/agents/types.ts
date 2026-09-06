/**
 * Universal Agent Plugin Contract & Telemetry Governance
 * -------------------------------------------------------
 * Any fleet platform (internal or external) sends AgentEvent objects.
 * Every agent returns AgentResult objects.
 * This schema is the stable API surface for the Fleet360 AI Platform.
 */

// ── Model Capability Aliases (Vendor-Agnostic Abstraction) ────────────────────
export type ModelCapabilityAlias =
  | 'DETERMINISTIC_RULES'     // Tier 0: Pure SQL, rules, Math, 0 API tokens
  | 'LOCAL_STATISTICAL'       // Tier 1: PostGIS, Haversine, Moving Avg, TSP
  | 'ECONOMY_TEXT'            // Tier 2: e.g. gpt-4o-mini, gemini-flash (Summaries, quick extraction)
  | 'STANDARD_REASONING'      // Tier 2.5: e.g. gpt-4o standard, claude-3-5-sonnet
  | 'ADVANCED_REASONING'      // Tier 3: e.g. gpt-5, o1, o3 (deep root cause, scenario comparison)
  | 'VISION_FAST'             // Fast low-res OCR, KYC classification
  | 'VISION_HIGH_ACCURACY'    // High-res damage inspection, multi-panel comparison
  | 'STRUCTURED_EXTRACTION';  // Strict Zod schema JSON extraction

export type ModelProviderType =
  | 'deterministic'
  | 'local_solver'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'thesys';

// ── Business Outcome & Feedback Types ─────────────────────────────────────────
export type BusinessOutcomeType =
  | 'VEHICLE_SAVED'
  | 'OVERTIME_AVOIDED'
  | 'MILEAGE_REDUCED'
  | 'INVOICE_ANOMALY_STOPPED'
  | 'PREVENTIVE_REPAIR_SCHEDULED'
  | 'SLA_BREACH_PREVENTED'
  | 'REVENUE_LEAKAGE_RECOVERED'
  | 'DISPATCH_MATCH_EXECUTED'
  | 'QUOTE_CONVERTED'
  | 'NO_ACTION_REQUIRED';

export type HumanFeedbackType =
  | 'ACCEPTED'
  | 'EDITED'
  | 'REJECTED'
  | 'OVERRIDDEN'
  | 'AUTO_EXECUTED';

// ── Telemetry & Cost Accounting Metrics ───────────────────────────────────────
export interface AgentRunTelemetry {
  modelAlias?: ModelCapabilityAlias;
  modelProvider?: ModelProviderType;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  toolCallsCount?: number;
  agentHopsCount?: number;
  matrixElementsQueried?: number;
  solverDurationMs?: number;
  costUsd?: number;
  costAed?: number;
  estimatedSavingsAed?: number;
  actualSavingsAed?: number;
  businessOutcome?: BusinessOutcomeType;
  decisionQualityScore?: number; // 0.00 to 1.00
  humanFeedback?: HumanFeedbackType;
}

// ── Agent Quality Evaluation Event ────────────────────────────────────────────
export interface AgentEvaluationEvent {
  id?: string;
  agentId: AgentId;
  tenantId: string;
  runId?: string;
  entityId?: string;
  metricCategory: 'ACCURACY' | 'ACCEPTANCE' | 'REASSIGNMENT' | 'FALSE_ALERT' | 'FINANCIAL_RECOVERY';
  metricName: string;
  metricValue: number;
  isPositiveOutcome: boolean;
  notes?: string;
  timestamp?: string;
}

// ── Tenant ROI Summary ────────────────────────────────────────────────────────
export interface AgentRoiSummary {
  tenantId: string;
  agentId: AgentId;
  periodStart: string;
  periodEnd: string;
  totalExecutions: number;
  totalCostAed: number;
  totalSavingsAed: number;
  netValueAed: number;
  roiMultiplier: number;
  acceptanceRatePct: number;
}

// ── Phase 2 Routing Intelligence Types ─────────────────────────────────────────
export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface CanonicalLocation {
  canonicalLocationId?: string; // e.g. 'LOC-MUH-004'
  name?: string;
  latitude: number;
  longitude: number;
  geohash: string; // 6-7 char geohash
  accessPoint?: LatLng; // Exact gate/entry coordinates
  zoneId?: string;
}

export type RoutingCacheTier =
  | 'STATIC_DISTANCE'        // 30-day TTL (Permanent road network distance)
  | 'HISTORICAL_TRAVEL_TIME' // 7-day TTL (Off-peak standard duration)
  | 'TRAFFIC_DYNAMIC';       // 15-minute TTL (Live traffic dispatch)

export interface SpatialShortlistOptions {
  initialRadiusKm?: number;      // Default: 5 km
  expansionStepKm?: number;      // Default: 5 km
  maxRadiusKm?: number;          // Default: 30 km
  minCandidates?: number;        // Default: 1 (Ensures operational feasibility)
  maxCandidates?: number;        // Default: 20 (Candidate cap)
  zoneId?: string;               // Fallback zone boundary
}

export interface SpatialShortlistResult<T> {
  selected: T[];
  radiusKmUsed: number;
  expanded: boolean;
  totalCandidatesEvaluated: number;
}

export interface MatrixPairResult {
  originGeohash: string;
  destGeohash: string;
  originCanonicalId?: string;
  destCanonicalId?: string;
  distanceKm: number;
  durationMin: number;
  isCacheHit: boolean;
  cacheTier: RoutingCacheTier;
  provider: 'google' | 'mapbox' | 'haversine' | 'osrm';
}

export interface DistanceMatrixResult {
  origins: CanonicalLocation[];
  destinations: CanonicalLocation[];
  distances: number[][]; // km [i][j]
  durations: number[][]; // min [i][j]
  pairs: MatrixPairResult[];
  elementsQueried: number;
  cacheHits: number;
  cacheMisses: number;
  providerCallsAvoided: number;
  costUsd: number;
  costAed: number;
  costAvoidedUsd: number;
  costAvoidedAed: number;
  provider: string;
}

export interface RouteDetailResult {
  origin: CanonicalLocation;
  destination: CanonicalLocation;
  distanceKm: number;
  durationMin: number;
  waypoints?: LatLng[];
  polyline?: string;
  isCacheHit: boolean;
  provider: string;
}

// ── Event Types ────────────────────────────────────────────────────────────────
export type AgentEventType =
  | 'vehicle.odometer_updated'
  | 'vehicle.fuel_log_added'
  | 'vehicle.work_order_created'
  | 'vehicle.status_changed'
  | 'finance.invoice_created'
  | 'finance.expense_created'
  | 'finance.fuel_log_added'
  | 'finance.journal_entry_created'
  | 'manual.trigger'          // operator-initiated full scan
  | 'schedule.nightly'        // cron-triggered batch run
  | 'schedule.hourly'         // high-frequency polling
  | 'route.created'           // school bus / logistics route added
  | 'route.updated'           // stop sequence or timing changed
  | 'route.consolidate_scan'  // multi-route network consolidation scan
  | 'stop.added'              // new stop added to a route
  | 'stop.removed'            // stop removed from a route
  | 'schedule.changed'        // service schedule updated
  | 'incident.created'        // new incident reported
  | 'incident.updated'        // incident severity or status changed
  | 'dispatch.job_created'    // new dispatch job
  | 'dispatch.job_reassign'   // driver rejected, reassign needed
  | 'driver.shift_started'    // driver began a shift
  | 'driver.week_end'         // trigger weekly coaching
  | 'booking.created'         // new booking (demand signal)
  | 'booking.completed'       // completed booking (demand history)
  | 'bus_ops.shift_schedule_updated' // staff transport shift changed
  | 'bus_ops.manifest_updated'       // employee accommodation manifest updated
  | 'bus_ops.plan_requested'         // staff transport plan requested
  | 'whatsapp.message_received'  // inbound WhatsApp message
  | 'whatsapp.stats_requested'   // pull 7-day WhatsApp stats
  | 'chat.message_sent'          // user sent a chat widget message
  | 'chat.stats_requested'       // pull 7-day chat stats
  | 'ops.query_received'         // XL Ops Assistant query
  | 'ops.stats_requested';       // pull 7-day Ops Assistant stats

// ── Inbound Event (what any platform sends to the orchestrator) ────────────────
export interface AgentEvent {
  tenant_id: string;
  agent_id: AgentId;           // which agent to invoke
  event_type: AgentEventType;
  entity_id?: string;          // vehicle_id, invoice_id, etc. (null = scan all)
  payload?: Record<string, unknown>;
  callback_url?: string;       // optional webhook for async response
  api_key?: string;            // external platform auth
  idempotency_key?: string;    // prevent duplicate runs
}

// ── Agent Identifiers ──────────────────────────────────────────────────────────
export type AgentId =
  // ── Batch / Scan agents ────────────────────────────────────────────────────
  | 'predictive-maintenance'
  | 'finance-anomaly'
  | 'route-optimiser'
  | 'staff-transport-planner'
  | 'incident-triage'
  | 'dispatch-optimiser'
  | 'driver-coach'
  | 'demand-forecasting'
  | 'document-intelligence'
  | 'vehicle-reuse'
  | 'compliance'
  | 'fleet-workforce-planner'
  | 'quotation-copilot'
  | 'rental-copilot'
  | 'damage-classifier'
  | 'doc-classifier'
  | 'contract-qa'
  // ── Conversational agents ─────────────────────────────────────────────────
  | 'whatsapp-agent'           // Twilio webhook → regex intent → auto-reply
  | 'chat-widget'              // Platform chat widget — TheSys GPT-5, SSE
  | 'ops-assistant';           // Fleet360 Ops Assistant — TheSys GPT-5, 7 tools

/** Distinguishes always-on conversational agents from on-demand batch agents */
export type AgentType = 'BATCH' | 'CONVERSATIONAL' | 'INTERACTIVE_COPILOT';

// ── Agent Autonomy Levels (L0-L4 Governance) ──────────────────────────────────
export type AgentAutonomyLevel =
  | 'L0' // Read / Explain / Stats only
  | 'L1' // Recommend (shows structured suggestions in UI)
  | 'L2' // Prepare / Draft (generates draft quotes/work orders)
  | 'L3' // Execute after Human Approval (1-click commit by authorized user)
  | 'L4'; // Fully Autonomous (Policy-governed low-risk auto-execution - globally disabled in Phase 1)

// ── Risk Levels ────────────────────────────────────────────────────────────────
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ── Recommended Actions ────────────────────────────────────────────────────────
export type MaintenanceAction =
  | 'MONITOR'
  | 'SCHEDULE_SERVICE'
  | 'URGENT_SERVICE'
  | 'GROUND_VEHICLE';

// ── Predictive Maintenance Output (9 Comprehensive Failure Signals) ───────────
export interface MaintenanceRiskFactors {
  serviceOverdue: number;
  serviceOverdueDays: number;
  serviceOverdueKm: number;
  fuelAnomalyScore: number;
  fuelConsumptionBaseline: number;
  fuelConsumptionRecent: number;
  workOrderFrequency: number;
  openWorkOrders: number;
  workOrdersLast90Days: number;
  odometerFactor: number;
  odometerKm: number;
  vehicleAgeFactor: number;
  vehicleAgeYears: number;
  dtcFaultScore: number;
  activeDtcCodes: string[];
  dtcSeveritySummary?: string;
  sensorAnomalyScore: number;
  coolantTempC?: number;
  oilPressureKpa?: number;
  batteryVoltage?: number;
  transmissionTempC?: number;
  sensorWarningList: string[];
  operatingHoursFactor: number;
  engineOperatingHours: number;
  dutyCycleStressRatio: number;
  repeatFailureScore: number;
  repeatFailureCount: number;
  repeatSubsystems: string[];
  subsystemRUL: {
    powertrainPct: number;
    brakingPct: number;
    electricalPct: number;
    hvacPct: number;
    suspensionPct: number;
    coolingPct: number;
    fuelSystemPct: number;
    exhaustAftertreatmentPct: number;
    tiresWheelsPct: number;
  };
}

export interface VehicleRiskScore {
  vehicleId: string;
  vehicleCode: string;
  make: string;
  model: string;
  licensePlate: string;
  riskScore: number;
  riskLevel: RiskLevel;
  factors: MaintenanceRiskFactors;
  recommendedAction: MaintenanceAction;
  predictedFailureWindow?: string;
  autoWorkOrderId?: string;
  scoredAt: string;
}

// ── Route Optimisation Types ──────────────────────────────────────────────────
export interface ConsolidatedRoute {
  targetRouteId: string;
  targetRouteName: string;
  sourceRouteIds: string[];
  sourceRouteNames: string[];
  stopCount: number;
  passengerCount: number;
  vehicleCapacity: number;
  utilizationPct: number;
  estimatedDurationMin: number;
  estimatedDistanceKm: number;
  stops: Array<{
    stopId: string;
    stopName: string;
    lat: number;
    lng: number;
    passengerCount: number;
    originalRouteId: string;
    originalRouteName: string;
  }>;
}

export interface TurnaroundChaining {
  vehicleId?: string;
  firstRouteId: string;
  firstRouteName: string;
  firstRouteEndTime: string;
  secondRouteId: string;
  secondRouteName: string;
  secondRouteStartTime: string;
  deadheadDistanceKm: number;
  deadheadDurationMin: number;
  turnaroundBufferMin: number;
  feasible: boolean;
}

export interface RouteOptimisationResult {
  id?: string;
  tenantId: string;
  totalRoutesAnalyzed: number;
  routesBefore: number;
  routesAfter: number;
  vehiclesSaved: number;
  monthlyCostSavingsAed: number;
  dailyDistanceSavedKm: number;
  monthlyFuelSavedLitres: number;
  monthlyCo2SavedKg: number;
  consolidatedRoutes: ConsolidatedRoute[];
  turnaroundChains: TurnaroundChaining[];
  status: 'SUGGESTED' | 'APPLIED' | 'REJECTED';
  appliedAt?: string;
  appliedBy?: string;
  agentRunId?: string;
  createdAt: string;
}

// ── Staff Transport Planner Types ─────────────────────────────────────────────
export interface StaffTransportStop {
  stopId: string;
  stopName: string;
  lat: number;
  lng: number;
  passengerCount: number;
  estimatedPickupTime: string;
  zone: string;
}

export interface StaffTransportRoutePlan {
  routeId: string;
  routeName: string;
  direction: 'INBOUND' | 'OUTBOUND';
  shiftName: string;
  targetArrivalTime: string;
  calculatedDepartureTime: string;
  totalDurationMin: number;
  totalDistanceKm: number;
  totalPassengers: number;
  recommendedVehicleSize: 'VAN_14' | 'COASTER_30' | 'COACH_50';
  recommendedCapacity: number;
  seatUtilizationPct: number;
  stops: StaffTransportStop[];
  destinationName: string;
  destinationLat: number;
  destinationLng: number;
  assignedVehicleId?: string;
  assignedVehicleCode?: string;
}

export interface VehicleReuseChain {
  vehicleId: string;
  vehicleCode: string;
  vehicleType: string;
  capacity: number;
  chainedRoutes: Array<{
    routeId: string;
    routeName: string;
    shiftName: string;
    departureTime: string;
    arrivalTime: string;
    startLocation: string;
    endLocation: string;
    deadheadToNextKm: number;
    turnaroundBufferMin: number;
  }>;
  totalDutyHours: number;
  totalOperatingKm: number;
  totalDeadheadKm: number;
}

export interface StaffTransportPlanRecommendation {
  id: string;
  tenantId: string;
  planName: string;
  shiftCoverage: string[];
  totalEmployeesCovered: number;
  baselineVehiclesNeeded: number;
  optimizedVehiclesNeeded: number;
  vehiclesSaved: number;
  dailyDistanceSavedKm: number;
  monthlyCostSavedAed: number;
  annualCostSavedAed: number;
  routes: StaffTransportRoutePlan[];
  vehicleReuseChains: VehicleReuseChain[];
  status: 'SUGGESTED' | 'APPLIED' | 'REJECTED';
  generatedAt: string;
}

// ── Finance Anomaly Types ─────────────────────────────────────────────────────
export type AnomalyDetectorId =
  | 'MAINT_01_REPAIR_COST_SPIKE'
  | 'MAINT_02_REPEAT_REPAIR'
  | 'FUEL_01_CONSUMPTION_SURGE'
  | 'FUEL_02_PRICE_ABNORMALITY'
  | 'FUEL_03_TANK_CAPACITY_EXCEEDED'
  | 'FUEL_04_GPS_STATION_MISMATCH'
  | 'INV_01_DUPLICATE_INVOICE'
  | 'INV_02_PO_VARIANCE'
  | 'INV_03_TAX_FTA_5PCT_CALC_ERROR'
  | 'PARTNER_01_SETTLEMENT_DISPUTE'
  | 'PARTNER_02_RATE_CARD_MISMATCH'
  | 'EXP_01_DRIVER_DAILY_LIMIT'
  | 'EXP_02_UNRECOVERED_SALIK_FINES'
  | 'TRIP_01_UNBILLED_OFF_CONTRACT_MILEAGE'
  | 'TRIP_02_EXCESS_MILEAGE_UNBILLED'
  | 'CONT_01_RATE_LEAKAGE'
  | 'CONT_02_ESCROW_SHORTFALL'
  | 'PROC_01_UNMATCHED_GRN'
  | 'PROC_02_PRICE_DRIFT';

export type AnomalyEntityType =
  | 'WORK_ORDER'
  | 'FUEL_LOG'
  | 'INVOICE'
  | 'EXPENSE'
  | 'TRIP'
  | 'PARTNER_SETTLEMENT'
  | 'CONTRACT'
  | 'PURCHASE_ORDER'
  | 'JOURNAL_ENTRY';

export type FinanceStreamType =
  | 'MAINTENANCE'
  | 'FUEL'
  | 'VENDOR_INVOICES'
  | 'PARTNER_SETTLEMENTS'
  | 'DRIVER_EXPENSES'
  | 'TRIP_COSTS'
  | 'CONTRACTS'
  | 'PROCUREMENT'
  | 'JOURNAL_ENTRY';

export interface AnomalyActionRecommendation {
  actionType:
    | 'HOLD_PAYMENT'
    | 'CLAIM_WARRANTY'
    | 'AUTO_DEDUCT_DRIVER'
    | 'INVOICE_CUSTOMER'
    | 'REVISE_PO'
    | 'FLAG_DISPUTE'
    | 'DISMISS';
  title: string;
  description: string;
  financialRecoveryAed?: number;
  payload?: Record<string, unknown>;
}

export interface AnomalyFlag {
  id?: string;
  detectorId: AnomalyDetectorId;
  entityType: AnomalyEntityType;
  entityId: string;
  streamType?: FinanceStreamType;
  severity: AnomalySeverity;
  confidence: number;
  explanation: string;
  amount?: number;
  currency?: string;
  expectedValue?: string | number;
  actualValue?: string | number;
  variancePercentage?: number;
  likelyCause?: string;
  financialExposureAed?: number;
  recommendedAction?: AnomalyActionRecommendation;
  metadata?: Record<string, unknown>;
}

// ── Agent Run Result (returned to caller / stored in agent_runs) ───────────────
export interface AgentRunResult {
  agentId: AgentId;
  tenantId: string;
  eventType: AgentEventType;
  entityId?: string;
  status: 'COMPLETED' | 'FAILED' | 'PARTIAL';
  durationMs: number;
  itemsProcessed: number;
  actionsCreated: number;
  output: unknown;
  error?: string;
  telemetry?: AgentRunTelemetry;
}

// ── Agent Registry Entry ───────────────────────────────────────────────────────
export interface AgentDefinition {
  id: AgentId;
  name: string;
  description: string;
  version: string;
  agentType: AgentType;
  autonomyLevel?: AgentAutonomyLevel;
  subscribedEvents: AgentEventType[];
  supportsEntityScan: boolean;
  run: (event: AgentEvent) => Promise<AgentRunResult>;
}

// ── Vehicle Reuse Domain Types ────────────────────────────────────────────────
export type VehicleCategoryTier =
  | 'SEDAN'
  | 'MINIVAN'
  | 'COASTER_30'
  | 'COACH_50'
  | 'CARGO_VAN'
  | 'LUXURY_VIP';

export interface TripScheduleItem {
  id: string;
  tripNumber?: string;
  routeId?: string;
  clientName?: string;
  origin?: CanonicalLocation | LatLng | { latitude?: number; longitude?: number; lat?: number; lng?: number; name?: string; address?: string; addressName?: string };
  destination?: CanonicalLocation | LatLng | { latitude?: number; longitude?: number; lat?: number; lng?: number; name?: string; address?: string; addressName?: string };
  startLocation?: CanonicalLocation | LatLng | { latitude?: number; longitude?: number; lat?: number; lng?: number; name?: string; address?: string; addressName?: string };
  endLocation?: CanonicalLocation | LatLng | { latitude?: number; longitude?: number; lat?: number; lng?: number; name?: string; address?: string; addressName?: string };
  plannedPickupTime?: string | Date;
  plannedDropoffTime?: string | Date;
  startTime?: string | Date;
  endTime?: string | Date;
  passengerCount: number;
  requiredVehicleType?: VehicleCategoryTier | string;
  vehicleCategoryRequired?: VehicleCategoryTier | string;
  requiredFeatures?: string[];
  operationalZone?: string;
  zoneId?: string;
  assignedVehicleId?: string;
  assignedDriverId?: string;
}

export interface VehicleResource {
  id?: string;
  vehicleId?: string;
  vehicleCode: string;
  seatingCapacity?: number;
  capacity?: number;
  vehicleType?: VehicleCategoryTier | string;
  category?: VehicleCategoryTier | string;
  features?: string[];
  wheelchairAccessible?: boolean;
  fuelType?: 'DIESEL' | 'PETROL' | 'ELECTRIC' | 'HYBRID' | string;
  operationalZone?: string;
  currentZoneId?: string;
  lastDropoffTime?: string | Date;
  lastDropoffLocation?: CanonicalLocation | LatLng | { latitude?: number; longitude?: number; lat?: number; lng?: number };
}

export interface DriverResource {
  id?: string;
  driverId?: string;
  name?: string;
  driverName?: string;
  shiftStartTime?: string | Date;
  dailyHoursRemaining?: number;
  continuousHoursRemaining?: number;
  licenseCategory?: string;
  drivingMinutesUsed?: number;
  dutyMinutesUsed?: number;
  maxDailyDutyMinutes?: number; // Default 600 min (10h)
  maxContinuousMinutes?: number; // Default 270 min (4.5h)
  lastRestBreakAt?: string | Date;
}

export interface ReuseEvaluationRequest {
  tripA: TripScheduleItem;
  tripB: TripScheduleItem;
  vehicle: VehicleResource;
  driver?: DriverResource;
  minimumSafeBufferMin?: number;
}

export interface ReuseEvaluationBreakdown {
  totalWindowMin: number;
  deadheadMin: number;
  turnaroundMin: number;
  bufferMin: number;
  temporalFeasible: boolean;
  capacityFeasible: boolean;
  driverFeasible: boolean;
  zoneFeasible: boolean;
}

export interface ReuseEvaluationResult {
  isFeasible: boolean;
  recommendation: 'FEASIBLE' | 'TIGHT_BUFFER' | 'INFEASIBLE';
  feasibilityStatus: 'FEASIBLE' | 'TIGHT_BUFFER' | 'INFEASIBLE';
  feasibilityScore: number;
  tripAId: string;
  tripBId: string;
  vehicleId: string;
  vehicleCode: string;
  driverId?: string;
  tripAEndTime: string;
  tripBStartTime: string;
  availableGapMin: number;
  deadheadKm: number;
  deadheadMin: number;
  turnaroundMin: number;
  bufferMin: number;
  vehicleCapacitySufficient: boolean;
  vehicleFeaturesMatched: boolean;
  driverDutyPermitted: boolean;
  driverRemainingDutyMin?: number;
  operationalZoneCompatible: boolean;
  reasons: string[];
  infeasibilityReasons: string[];
  breakdown: ReuseEvaluationBreakdown;
  summary: string;
  financialSavingsAed: number;
  avoidedCostUsd: number;
}

// ── Compliance Domain Types ───────────────────────────────────────────────────
export type ComplianceHorizonCategory = 'CRITICAL' | 'URGENT' | 'UPCOMING' | 'COMPLIANT';

export type ComplianceDocumentType =
  | 'MULKIYA_REGISTRATION'
  | 'MOTOR_INSURANCE'
  | 'TECHNICAL_INSPECTION_FAHAS'
  | 'RTA_COMMERCIAL_PERMIT'
  | 'RTA_SCHOOL_BUS_PERMIT'
  | 'SAFETY_EQUIPMENT_CERT'
  | 'CIVIL_DEFENCE_HAZMAT_PERMIT'
  | 'CALIBRATION_CERT_COLD_CHAIN'
  | 'DRIVER_LICENSE'
  | 'EMIRATES_ID'
  | 'RTA_DRIVER_CARD'
  | 'MEDICAL_FITNESS_CERT'
  | 'MOHRE_WORK_PERMIT'
  | 'CONTRACT_AGREEMENT'
  | 'OTHER';

export interface DocumentRecord {
  id: string;
  entityId: string;
  entityType: 'VEHICLE' | 'DRIVER' | 'VENDOR' | 'CONTRACT' | 'EQUIPMENT';
  entityCode: string;
  documentType: ComplianceDocumentType | string;
  documentNumber?: string;
  expiryDate: string | Date;
  issueDate?: string | Date;
  issuingAuthority?: string; // RTA, Dubai Police, MoHRE, DHA, MoIAT, FTA, etc.
  status?: 'ACTIVE' | 'EXPIRED' | 'PENDING_RENEWAL' | 'SUSPENDED';
  metadata?: Record<string, unknown>;
}

export interface ComplianceCriticalItem {
  entityId: string;
  entityType: 'VEHICLE' | 'DRIVER' | 'VENDOR' | 'CONTRACT';
  code: string;
  item: string;
  status: 'EXPIRED' | 'IMMINENT_EXPIRY' | 'SUSPENDED' | 'MISSING';
  daysOverdue: number;
  riskDescription: string;
  potentialFineAed: number;
}

export interface ComplianceRecommendedAction {
  id: string;
  priority: 'P1' | 'P2' | 'P3';
  actionType: 'GROUND_VEHICLE' | 'SUSPEND_DRIVER' | 'BOOK_INSPECTION' | 'RENEW_INSURANCE' | 'AUDIT_INVOICE' | 'NOTIFY_SAFETY_OFFICER';
  title: string;
  description: string;
  targetEntityId: string;
  targetEntityCode: string;
  estimatedFineSavedAed: number;
  deadline?: string;
}

export interface FleetComplianceRiskView {
  fleetComplianceScore: number; // 0–100%
  overallStatus: 'COMPLIANT' | 'HEALTHY_WITH_WARNINGS' | 'CRITICAL_RISK' | 'NON_COMPLIANT';
  totalAssetsMonitored: number;
  totalDocumentsTracked: number;
  criticalCount: number;
  urgentCount: number;
  upcomingCount: number; // Due in 30 days
  fullyCompliantCount: number;
  criticalItems: ComplianceCriticalItem[];
  urgentItems: ComplianceCriticalItem[];
  dueIn30DaysCount: number;
  recommendedActions: ComplianceRecommendedAction[];
  calculatedAt: string;
}

export interface DriverReadinessRequest {
  driverId: string;
  driverName?: string;
  vehicleCategoryRequired?: string;
  jobStartTime?: string | Date;
  jobEndTime?: string | Date;
  estimatedDurationMin?: number;
  // Current live state (if available)
  licenseExpiry?: string | Date;
  emiratesIdExpiry?: string | Date;
  rtaCardExpiry?: string | Date;
  medicalFitnessExpiry?: string | Date;
  licenseClasses?: string[];
  authorizedCategories?: string[];
  dailyDutyMinutesUsed?: number;
  continuousDrivingMinutesUsed?: number;
  lastRestBreakAt?: string | Date;
  blackPoints?: number;
  rosterStatus?: 'ON_DUTY' | 'OFF_DUTY' | 'ON_LEAVE' | 'SICK_LEAVE';
  assignedVehicleId?: string;
}

export interface DriverReadinessResult {
  isEligible: boolean;
  status: 'ELIGIBLE' | 'BLOCKED' | 'WARNING';
  readinessScore: number; // 0–100
  driverId: string;
  driverName: string;
  shiftRemainingMin: number;
  shiftRemainingFormatted: string; // e.g. "5h 40m"
  continuousDrivingMin: number;
  restCompliance: 'PASS' | 'REST_REQUIRED_SOON' | 'VIOLATION';
  blackPoints: number;
  blackPointsRisk: 'SAFE' | 'WARNING_THRESHOLD' | 'CRITICAL_SUSPENSION';
  credentialsValid: boolean;
  vehicleCategoryAuthorized: boolean;
  rosterStatusValid: boolean;
  disqualificationReasons: string[];
  warnings: string[];
  summary: string;
  evaluatedAt: string;
}

export interface FtaInvoiceValidationRequest {
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  vendorTrn: string;
  invoiceDate: string | Date;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  lineItems?: Array<{ description: string; amount: number; vatRate?: number }>;
  salikTagNumber?: string;
  vehiclePlateNumber?: string;
}

export interface FtaInvoiceValidationResult {
  isValid: boolean;
  trnValid: boolean;
  trnFormatted: string;
  vatMathCorrect: boolean;
  expectedVatAmount: number;
  vatDiscrepancyAed: number;
  salikTagMatched: boolean;
  complianceFlags: string[];
  summary: string;
  financialRiskAed: number;
}

export interface ComplianceEvaluationResult {
  scanType: 'FLEET_RISK' | 'DRIVER_READINESS' | 'FTA_TAX_AUDIT' | 'FULL_COMPLIANCE_SWEEP';
  fleetRisk?: FleetComplianceRiskView;
  driverReadiness?: DriverReadinessResult;
  taxValidation?: FtaInvoiceValidationResult;
  actionsGenerated: number;
  estimatedFinesAvoidedAed: number;
}

// ── Master Fleet & Workforce Planner Domain Types ─────────────────────────────
export type PlanFeasibilityState =
  | 'FEASIBLE'
  | 'FEASIBLE_WITH_OUTSOURCING'
  | 'FEASIBLE_WITH_OVERTIME'
  | 'PARTIALLY_FEASIBLE'
  | 'INFEASIBLE';

export type PlanStatus =
  | 'DRAFT'
  | 'OPTIMIZED'
  | 'REVIEWED'
  | 'LOCKED'
  | 'ACTIVE'
  | 'REVISED'
  | 'COMPLETED';

export type PlanningHorizon =
  | 'T_PLUS_7_STRATEGIC'
  | 'T_PLUS_1_OPERATIONAL'
  | 'T_ZERO_DISRUPTION';

export interface DriverHoursPolicy {
  policyId: string;
  jurisdiction: 'UAE_FEDERAL' | 'DUBAI_RTA' | 'ABU_DHABI_ITC' | 'SHARJAH_SRTA' | 'CLIENT_CONTRACT';
  operatorType: 'STAFF_TRANSPORT' | 'SCHOOL_BUS' | 'CAR_RENTAL' | 'FREIGHT' | 'AMBULANCE';
  effectiveFrom: string;
  effectiveTo?: string;
  normalDailyHours: number;        // Default 8.0
  normalWeeklyHours: number;       // Default 48.0
  maxDailyDutyHours: number;       // Default 10.0 (normal + max 2h overtime)
  maxWeeklyDutyHours: number;      // Default 60.0
  maxConsecutiveWorkDays: number;  // Default 6 (1 mandatory rest day per 7 days)
  maxContinuousDrivingMinutes: number; // e.g. 270m (4.5h)
  mandatoryBreakMinutes: number;   // Default 45m
  interShiftRestHours: number;     // Default 11h
  isRamadanSchedule?: boolean;     // Ramadan reduction: 6h/day, 36h/week
  splitShiftMaxSpreadHours?: number;// Default 14h
}

export interface ResourceCostProfile {
  tenantId: string;
  vehicleCategory: string;
  fixedDailyCostAed: number;
  variableCostPerKm: number;
  fuelCostPerKm: number;
  tollCostPerGate: number;
  driverHourlyRateAed: number;
  driverOvertimeHourlyRateAed: number;
  depreciationPerKm: number;
  repositionCostFormula: {
    fuelRatePerKm: number;
    driverTimeRatePerHour: number;
    tollEstimateAed: number;
    vehicleWearPerKm: number;
    returnPositioningRiskFactor: number; // e.g. 1.25 multiplier
  };
  exchangeStandardCharterRateAed: number;
  unservedPenaltyAed: number;
}

export interface RepositionOrder {
  repositionId: string;
  repositionType: 'REPO_VEHICLE' | 'REPO_DRIVER' | 'REPO_BOTH';
  vehicleId?: string;
  vehicleCode?: string;
  vehicleCategory?: string;
  driverId?: string;
  driverName?: string;
  sourceDepot: string;
  targetDepot: string;
  departureTime: string;
  arrivalTime: string;
  deadheadDistanceKm: number;
  deadheadDurationMin: number;
  fuelCostAed: number;
  driverCostAed: number;
  tollCostAed: number;
  totalCostAed: number;
  avoidedOutsourceSavingsAed: number;
  reason: string;
}

export interface MasterAssignmentTriplet {
  assignmentId: string;
  tripId: string;
  tripNumber?: string;
  clientName?: string;
  originName: string;
  destinationName: string;
  pickupTime: string;
  dropoffTime: string;
  passengerCount: number;
  
  // Assigned Resources
  vehicleId: string;
  vehicleCode: string;
  vehicleCategory: string;
  driverId: string;
  driverName: string;
  depotId: string;
  
  // Shift Context
  shiftType: 'SINGLE_SHIFT' | 'SPLIT_SHIFT_MORNING' | 'SPLIT_SHIFT_EVENING' | 'MIDDAY_TRANSFER';
  isReusedVehicle: boolean;
  deadheadFromPreviousKm: number;
  deadheadDurationMin: number;
  turnaroundBufferMin: number;
  
  // Cost breakdown
  operatingCostAed: number;
  overtimeMinutes: number;
  overtimeCostAed: number;
  totalCostAed: number;
}

export interface MaintenanceSlotAssignment {
  vehicleId: string;
  vehicleCode: string;
  serviceType: string;
  garageDepot: string;
  startTime: string;
  endTime: string;
  peakHourImpact: 'ZERO' | 'LOW' | 'HIGH';
  proposedBy: 'PLANNER_IDLE_SLOT' | 'PREDICTIVE_MAINTENANCE_RUL';
}

export interface StandbyAllocation {
  depotId: string;
  depotName: string;
  standbyBusesCount: number;
  standbyVehicles: Array<{ vehicleId: string; vehicleCode: string; category: string }>;
  standbyDriversCount: number;
  standbyDrivers: Array<{ driverId: string; driverName: string; licenseClass: string }>;
  dutyWindowStart: string;
  dutyWindowEnd: string;
  riskJustification: string;
}

export interface PlanScenario {
  scenarioId: 'SCENARIO_A_LOWEST_COST' | 'SCENARIO_B_BALANCED' | 'SCENARIO_C_MAX_RESILIENCE';
  name: string;
  isAiRecommended: boolean;
  totalCostAed: number;
  activeVehiclesCount: number;
  activeDriversCount: number;
  repositioningMovesCount: number;
  repositioningCostAed: number;
  overtimeMinutesTotal: number;
  overtimeCostTotalAed: number;
  standbyVehiclesCount: number;
  standbyDriversCount: number;
  outsourcedTripsCount: number;
  outsourcedCostAed: number;
  unservedTripsCount: number;
  disruptionRiskLevel: 'HIGH' | 'LOW' | 'NEAR_ZERO';
  feasibilityState: PlanFeasibilityState;
  
  assignments: MasterAssignmentTriplet[];
  repositions: RepositionOrder[];
  maintenanceSlots: MaintenanceSlotAssignment[];
  standbyAllocations: StandbyAllocation[];
  explanationNarrative: string;
}

export interface MasterPlanResult {
  planId: string;
  tenantId: string;
  planHorizon: PlanningHorizon;
  planStatus: PlanStatus;
  scheduleDate: string;
  feasibilityState: PlanFeasibilityState;
  
  // Overall Coverage
  totalTripsRequested: number;
  tripsCoveredInternally: number;
  tripsCoveredByReuse: number;
  tripsCoveredByReposition: number;
  tripsCoveredByExchange: number;
  tripsUnserved: number;
  
  // Scenarios
  scenarios: PlanScenario[];
  recommendedScenario: PlanScenario;
  
  // Metrics & Tradeoffs
  totalOperatingCostAed: number;
  totalAvoidedOutsourceSavingsAed: number;
  driverWorkloadVarianceScore: number; // 0–100 (100 = perfectly fair)
  scheduleStabilityScore: number;     // 0–100
  evaluatedAt: string;
}

export interface FleetWorkforcePlanningRequest {
  scheduleDate: string;
  horizon?: PlanningHorizon;
  trips: Array<TripScheduleItem & { depotId?: string; priority?: 'P1' | 'P2' | 'P3' }>;
  vehicles: Array<VehicleResource & { currentDepotId: string; maintenanceRulKm?: number; isGrounded?: boolean }>;
  drivers: Array<DriverResource & { currentDepotId: string; licenseClasses?: string[]; historicalWeeklyDutyMin?: number; rosterStatus?: string }>;
  depots: Array<{ id: string; name: string; lat: number; lng: number }>;
  policy?: Partial<DriverHoursPolicy>;
  costProfile?: Partial<ResourceCostProfile>;
  lockPreviousPlan?: boolean;
}



