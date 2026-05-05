/**
 * @gravity/agent-sdk — Shared Types
 * -----------------------------------
 * These are the stable public types that external platforms use.
 * Import from '@gravity/agent-sdk' — never import internal paths directly.
 */

/** Distinguishes on-demand batch/scan agents from always-on streaming agents */
export type AgentType = 'BATCH' | 'CONVERSATIONAL';

export type AgentId =
  // ── Batch / Scan agents ──────────────────────────────────────────────────
  | 'predictive-maintenance'
  | 'finance-anomaly'
  | 'route-optimiser'
  | 'incident-triage'
  | 'dispatch-optimiser'
  | 'driver-coach'
  | 'demand-forecasting'
  | 'document-intelligence'
  // ── Conversational agents (always-on, expose stats wrappers) ─────────────
  | 'whatsapp-agent'    // Twilio WhatsApp → regex intent → auto-reply
  | 'chat-widget'       // Platform chat widget — TheSys GPT-5, SSE, createBooking
  | 'ops-assistant';    // XL AI Ops Assistant — TheSys GPT-5, 7 fleet tools

export type AgentEventType =
  // ── Triggers ─────────────────────────────────────────────────────────────
  | 'manual.trigger'
  | 'schedule.nightly'
  | 'schedule.hourly'
  // ── Vehicle ───────────────────────────────────────────────────────────────
  | 'vehicle.odometer_updated'
  | 'vehicle.fuel_log_added'
  | 'vehicle.work_order_created'
  | 'vehicle.status_changed'
  // ── Finance ───────────────────────────────────────────────────────────────
  | 'finance.invoice_created'
  | 'finance.expense_created'
  | 'finance.fuel_log_added'
  // ── Routes ────────────────────────────────────────────────────────────────
  | 'route.created'
  | 'route.updated'
  | 'stop.added'
  | 'stop.removed'
  | 'schedule.changed'
  // ── Incidents & Dispatch ──────────────────────────────────────────────────
  | 'incident.created'
  | 'incident.updated'
  | 'dispatch.job_created'
  | 'dispatch.job_reassign'
  // ── Driver & Bookings ─────────────────────────────────────────────────────
  | 'driver.shift_started'
  | 'driver.week_end'
  | 'booking.created'
  | 'booking.completed'
  // ── Conversational ────────────────────────────────────────────────────────
  | 'whatsapp.message_received'
  | 'whatsapp.stats_requested'
  | 'chat.message_sent'
  | 'chat.stats_requested'
  | 'ops.query_received'
  | 'ops.stats_requested';

/**
 * An event sent TO the agent system.
 * Any fleet platform that integrates the SDK creates these.
 */
export interface AgentEvent {
  /** Your platform's tenant/organisation ID */
  tenant_id: string;
  /** Which agent to invoke */
  agent_id: AgentId;
  /** What triggered this event */
  event_type: AgentEventType;
  /** Specific entity (vehicle_id, incident_id, etc.) — omit for full scan */
  entity_id?: string;
  /** Arbitrary payload from your platform */
  payload?: Record<string, unknown>;
  /** Webhook URL — if provided, agent runs async and POSTs result here */
  callback_url?: string;
  /** Your API key for authenticating with the agent service */
  api_key?: string;
  /** Idempotency key — prevent duplicate runs */
  idempotency_key?: string;
}

/** Standard result returned by every agent */
export interface AgentResult {
  agentId: AgentId;
  tenantId: string;
  eventType: AgentEventType;
  status: 'COMPLETED' | 'FAILED' | 'PARTIAL';
  durationMs: number;
  itemsProcessed: number;
  actionsCreated: number;
  output: unknown;
  error?: string;
}

/** SDK configuration */
export interface AgentSDKConfig {
  /** Base URL of the deployed agent microservice */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Default tenant ID */
  tenantId: string;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** OpenAI API key for LLM-powered agents */
  openaiApiKey?: string;
}

/** Async dispatch mode — returns job ID immediately */
export interface AsyncDispatchResult {
  jobId: string;
  status: 'ACCEPTED';
  callbackUrl?: string;
  message: string;
}

/** Agent catalogue entry */
export interface AgentCatalogueEntry {
  id: AgentId;
  name: string;
  description: string;
  version: string;
  status: 'live' | 'beta' | 'planned';
  model: string;
  module: string;
  agentType: AgentType;
  subscribedEvents: AgentEventType[];
  /** Only present for CONVERSATIONAL agents */
  endpoint?: string;
  /** Tools available to CONVERSATIONAL agents */
  tools?: string[];
}
