/**
 * Agent Registry
 * --------------
 * Single source of truth for all registered agents.
 * New agents are added here and automatically discovered by the orchestrator.
 */
import { AgentDefinition, AgentId } from './types';

// Lazy imports to avoid circular deps at module load time
async function getPMAgent(): Promise<AgentDefinition> {
  const { PREDICTIVE_MAINTENANCE_AGENT } = await import('./predictive-maintenance/agent');
  return PREDICTIVE_MAINTENANCE_AGENT;
}

async function getFinanceAnomalyAgent(): Promise<AgentDefinition> {
  const { FINANCE_ANOMALY_AGENT } = await import('./finance-anomaly/agent');
  return FINANCE_ANOMALY_AGENT;
}

async function getRouteOptimiserAgent(): Promise<AgentDefinition> {
  const { ROUTE_OPTIMISER_AGENT } = await import('./route-optimiser/agent');
  return ROUTE_OPTIMISER_AGENT;
}

async function getIncidentTriageAgent(): Promise<AgentDefinition> {
  const { INCIDENT_TRIAGE_AGENT } = await import('./incident-triage/agent');
  return INCIDENT_TRIAGE_AGENT;
}

async function getDispatchOptimiserAgent(): Promise<AgentDefinition> {
  const { DISPATCH_OPTIMISER_AGENT } = await import('./dispatch-optimiser/agent');
  return DISPATCH_OPTIMISER_AGENT;
}

async function getDriverCoachAgent(): Promise<AgentDefinition> {
  const { DRIVER_COACHING_AGENT } = await import('./driver-coaching/agent');
  return DRIVER_COACHING_AGENT;
}

async function getDemandForecastingAgent(): Promise<AgentDefinition> {
  const { DEMAND_FORECASTING_AGENT } = await import('./demand-forecasting/agent');
  return DEMAND_FORECASTING_AGENT;
}

// ── Conversational agent wrappers ──────────────────────────────────────────────
async function getWhatsAppAgent(): Promise<AgentDefinition> {
  const { WHATSAPP_AGENT } = await import('./whatsapp-agent/agent');
  return WHATSAPP_AGENT;
}

async function getChatWidgetAgent(): Promise<AgentDefinition> {
  const { CHAT_WIDGET_AGENT } = await import('./chat-widget/agent');
  return CHAT_WIDGET_AGENT;
}

async function getOpsAssistantAgent(): Promise<AgentDefinition> {
  const { OPS_ASSISTANT_AGENT } = await import('./ops-assistant/agent');
  return OPS_ASSISTANT_AGENT;
}

const AGENT_LOADERS: Record<AgentId, () => Promise<AgentDefinition>> = {
  // ── Batch / Scan ────────────────────────────────────────────────────────────
  'predictive-maintenance': getPMAgent,
  'finance-anomaly':        getFinanceAnomalyAgent,
  'route-optimiser':        getRouteOptimiserAgent,
  'incident-triage':        getIncidentTriageAgent,
  'dispatch-optimiser':     getDispatchOptimiserAgent,
  'driver-coach':           getDriverCoachAgent,
  'demand-forecasting':     getDemandForecastingAgent,
  'document-intelligence':  async () => { throw new Error('Not yet implemented'); },
  // ── Conversational (always-on, stats wrappers) ─────────────────────────────
  'whatsapp-agent':         getWhatsAppAgent,
  'chat-widget':            getChatWidgetAgent,
  'ops-assistant':          getOpsAssistantAgent,
};

export async function getAgent(id: AgentId): Promise<AgentDefinition> {
  const loader = AGENT_LOADERS[id];
  if (!loader) throw new Error(`Unknown agent: ${id}`);
  return loader();
}

export function listAgentIds(): AgentId[] {
  return Object.keys(AGENT_LOADERS) as AgentId[];
}

export const AGENT_CATALOGUE = [
  {
    id: 'predictive-maintenance' as AgentId,
    name: 'Predictive Maintenance Agent',
    description: 'Scores every vehicle using 5 statistical factors and auto-creates work orders for critical-risk vehicles.',
    version: '1.0.0',
    status: 'live',
    model: 'Statistical (no LLM)',
    module: 'Fleet',
  },
  {
    id: 'finance-anomaly' as AgentId,
    name: 'Finance Anomaly Detection Agent',
    description: 'Detects duplicate invoices, amount outliers, round-number entries, and velocity spikes using Z-score and heuristic detectors.',
    version: '1.0.0',
    status: 'live',
    model: 'Statistical (no LLM)',
    module: 'Finance',
  },
  {
    id: 'route-optimiser' as AgentId,
    name: 'Route Optimisation Agent',
    description: 'Runs Nearest Neighbour + 2-opt TSP on every school bus route, saves distance, and auto-applies routes that exceed the savings threshold.',
    version: '1.0.0',
    status: 'live',
    model: 'Statistical (no LLM)',
    module: 'School Bus',
  },
  {
    id: 'incident-triage' as AgentId,
    name: 'Incident Auto-Triage Agent',
    description: 'Classifies incident severity with a rules engine, finds the nearest ambulance unit, and generates GPT-4o dispatch recommendations in <10 seconds.',
    version: '1.0.0',
    status: 'live',
    model: 'Rules Engine + GPT-4o',
    module: 'Incidents / Ambulance',
  },
  {
    id: 'dispatch-optimiser' as AgentId,
    name: 'Smart Dispatch Optimiser Agent',
    description: '15-factor statistical scoring model that ranks every available driver/vehicle against each pending dispatch job.',
    version: '1.0.0',
    status: 'live',
    model: 'Statistical (no LLM)',
    module: 'Dispatch',
  },
  {
    id: 'driver-coach' as AgentId,
    name: 'Driver Coaching Agent',
    description: 'Generates personalised weekly coaching plans from RAG scores, HOS violations, fuel and speed events using GPT-4o.',
    version: '1.0.0',
    status: 'live',
    model: 'GPT-4o',
    module: 'Fleet / Driver',
  },
  {
    id: 'demand-forecasting' as AgentId,
    name: 'Demand Forecasting Agent',
    description: '12-week moving average + trend + UAE holiday model that forecasts fleet demand by vehicle type and branch with GPT-4o narrative.',
    version: '1.0.0',
    status: 'live',
    model: 'Moving Avg + GPT-4o',
    module: 'Fleet / RAC / Leasing',
  },
  {
    id: 'document-intelligence' as AgentId,
    name: 'Document Intelligence Agent',
    description: 'Reads vehicle registration cards, insurance docs, and damage photos using Vision AI.',
    version: '0.1.0',
    status: 'planned',
    model: 'GPT-4o Vision',
    module: 'Fleet / RAC / Leasing',
    agentType: 'BATCH',
  },
  // ── Conversational Agents ──────────────────────────────────────────────────
  {
    id: 'whatsapp-agent' as AgentId,
    name: 'WhatsApp AI Agent',
    description: 'Handles inbound WhatsApp messages via Twilio. Classifies intent and auto-replies without LLM latency. 24/7 always-on.',
    version: '1.0.0',
    status: 'live',
    model: 'Rule-based (no LLM)',
    module: 'Customer Communications',
    agentType: 'CONVERSATIONAL',
    endpoint: 'POST /api/webhooks/whatsapp',
    tools: ['intent_detection', 'auto_reply', 'message_log'],
  },
  {
    id: 'chat-widget' as AgentId,
    name: 'Platform Chat Widget',
    description: 'Global chat widget on every platform page. TheSys GPT-5, SSE streaming, createBooking tool.',
    version: '1.0.0',
    status: 'live',
    model: 'TheSys GPT-5',
    module: 'All Modules',
    agentType: 'CONVERSATIONAL',
    endpoint: 'POST /api/chat',
    tools: ['createBooking'],
  },
  {
    id: 'ops-assistant' as AgentId,
    name: 'Fleet360 Ops Assistant',
    description: 'Conversational operations assistant with 7 fleet tools. TheSys GPT-5, SSE streaming, live data access.',
    version: '1.0.0',
    status: 'live',
    model: 'TheSys GPT-5',
    module: 'Operations / All Modules',
    agentType: 'CONVERSATIONAL',
    endpoint: 'POST /api/operations/simple-chat',
    tools: ['showFleetStatus', 'showVehicles', 'showMaintenanceRequests', 'showAlerts', 'showBookings', 'showKPIDashboard', 'createBooking'],
  },
];
