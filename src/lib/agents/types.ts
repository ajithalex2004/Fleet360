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
