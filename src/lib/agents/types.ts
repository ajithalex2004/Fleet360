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
  | 'ops-assistant';           // XL AI Ops Assistant — TheSys GPT-5, 7 tools

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

// ── Predictive Maintenance Output ──────────────────────────────────────────────
export interface MaintenanceRiskFactors {
  serviceOverdue: number;         // 0–1 score
  fuelAnomalyScore: number;       // 0–1 score
  workOrderFrequency: number;     // 0–1 score
  vehicleAgeFactor: number;       // 0–1 score
  odometerFactor: number;         // 0–1 score
  serviceOverdueDays: number;     // actual days since last service
  serviceOverdueKm: number;       // actual km since last service
  fuelConsumptionBaseline: number;// L/100km baseline avg
  fuelConsumptionRecent: number;  // L/100km last 30 days
  openWorkOrders: number;
  vehicleAgeYears: number;
  odometerKm: number;
}

export interface VehicleRiskScore {
  vehicleId: string;
  vehicleCode: string;
  make: string;
  model: string;
  licensePlate: string;
  riskScore: number;              // 0.000–1.000
  riskLevel: RiskLevel;
  factors: MaintenanceRiskFactors;
  recommendedAction: MaintenanceAction;
  predictedFailureWindow: string; // '7–14 days', '30–60 days', etc.
  autoWorkOrderId?: string;       // set if WO was auto-created
  scoredAt: string;
}

// ── Finance Anomaly Output ─────────────────────────────────────────────────────
export type AnomalyDetectorId =
  | 'duplicate-invoice'
  | 'amount-outlier'
  | 'round-number'
  | 'velocity-spike'
  | 'category-mismatch';

export type AnomalyEntityType =
  | 'INVOICE'
  | 'EXPENSE'
  | 'FUEL_LOG'
  | 'JOURNAL_ENTRY';

export interface AnomalyFlag {
  detectorId: AnomalyDetectorId;
  entityType: AnomalyEntityType;
  entityId: string;
  severity: AnomalySeverity;
  confidence: number;             // 0.000–1.000
  explanation: string;            // plain-English, one sentence
  amount?: number;
  currency?: string;
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
  output: unknown;                // agent-specific payload
  error?: string;
}

// ── Agent Registry Entry ───────────────────────────────────────────────────────
export interface AgentDefinition {
  id: AgentId;
  name: string;
  description: string;
  version: string;
  agentType: AgentType;           // BATCH (scan/schedule) | CONVERSATIONAL (always-on)
  subscribedEvents: AgentEventType[];
  supportsEntityScan: boolean;    // can scan all entities (not just one)
  run: (event: AgentEvent) => Promise<AgentRunResult>;
}
