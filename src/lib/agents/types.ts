/**
 * Universal Agent Plugin Contract
 * --------------------------------
 * Any fleet platform (internal or external) sends AgentEvent objects.
 * Every agent returns AgentResult objects.
 * This schema is the stable API surface for the standalone plugin vision.
 */

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
  | 'incident-triage'
  | 'dispatch-optimiser'
  | 'driver-coach'
  | 'demand-forecasting'
  | 'document-intelligence'
  // ── Conversational agents ─────────────────────────────────────────────────
  | 'whatsapp-agent'           // Twilio webhook → regex intent → auto-reply
  | 'chat-widget'              // Platform chat widget — TheSys GPT-5, SSE
  | 'ops-assistant';           // Fleet360 Ops Assistant — TheSys GPT-5, 7 tools

/** Distinguishes always-on conversational agents from on-demand batch agents */
export type AgentType = 'BATCH' | 'CONVERSATIONAL';

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
    brakeSystemPct: number;
    electricalPct: number;
    hvacPct: number;
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
  predictedFailureWindow: string;
  primaryFailureReason?: string;
  autoWorkOrderId?: string;
  scoredAt: string;
}

// ── Route Optimization & Multi-Route Consolidation Contracts ──────────────────
export interface ConsolidationRecommendationItem {
  id: string;
  sourceRouteIds: string[];
  sourceRouteNames: string[];
  sourceRouteNumbers: string[];
  candidateType: 'SIMULTANEOUS_MERGE' | 'TURNAROUND_SEQUENTIAL';
  direction: string;
  shift: string;
  combinedPassengers: number;
  requiredCapacity: number;
  operatorScore: number; // 0–100 ranking
  detourMinutes: number;
  detourKm: number;
  dailyDistanceSavedKm: number;
  weeklySavingsAed: number;
  monthlySavingsAed: number;
  vehiclesReleased: number;
  status: 'SUGGESTED' | 'APPLIED' | 'REJECTED';
}

export interface NetworkDesignSummary {
  currentRoutesCount: number;
  currentVehiclesCount: number;
  recommendedRoutesCount: number;
  recommendedVehiclesCount: number;
  vehiclesSaved: number;
  dailyKmSaved: number;
  monthlyCostSavedAed: number;
  annualCostSavedAed: number;
}

export interface RouteOptimiserOutput {
  summary: string;
  networkDesign: NetworkDesignSummary;
  consolidations: ConsolidationRecommendationItem[];
  singleRouteResults: unknown[];
}

// ── Finance Anomaly Output (8 Comprehensive Streams) ───────────────────────────
export type FinanceStreamType =
  | 'MAINTENANCE'
  | 'FUEL'
  | 'VENDOR_INVOICE'
  | 'PARTNER_SETTLEMENT'
  | 'DRIVER_EXPENSE'
  | 'TRIP_COST'
  | 'CONTRACT'
  | 'PROCUREMENT';

export type AnomalyDetectorId =
  | 'duplicate-invoice'
  | 'amount-outlier'
  | 'round-number'
  | 'velocity-spike'
  | 'category-mismatch'
  | 'fuel-tank-overfill'
  | 'fuel-gps-mismatch'
  | 'fuel-rapid-consecutive'
  | 'fuel-consumption-spike'
  | 'maintenance-parts-inflation'
  | 'maintenance-repeat-repair-warranty'
  | 'maintenance-labor-srt-overrun'
  | 'vendor-rate-card-breach'
  | 'vendor-vat-compliance'
  | 'partner-quote-divergence'
  | 'partner-ghost-trip'
  | 'driver-mileage-inflated'
  | 'trip-unbilled-salik-tolls'
  | 'trip-deadhead-surge'
  | 'contract-off-contract-mileage'
  | 'contract-unbilled-excess-mileage'
  | 'contract-unbilled-damage'
  | 'procurement-po-variance';

export type AnomalyEntityType =
  | 'INVOICE'
  | 'EXPENSE'
  | 'FUEL_LOG'
  | 'WORK_ORDER'
  | 'RENTAL_AGREEMENT'
  | 'EXCHANGE_QUOTATION'
  | 'DRIVER_SETTLEMENT'
  | 'SALIK_TOLL'
  | 'PURCHASE_ORDER'
  | 'TELEMATICS_TRIP'
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
}

// ── Agent Registry Entry ───────────────────────────────────────────────────────
export interface AgentDefinition {
  id: AgentId;
  name: string;
  description: string;
  version: string;
  agentType: AgentType;
  subscribedEvents: AgentEventType[];
  supportsEntityScan: boolean;
  run: (event: AgentEvent) => Promise<AgentRunResult>;
}
