/**
 * Agent Registry (Phase 5 Governance & Dynamic Discovery)
 * --------------------------------------------------------
 * Single source of truth for all registered agents.
 * Supports lazy loading, dynamic registration, event-based subscription lookup,
 * and wildcard event routing.
 */
import { AgentDefinition, AgentEventType, AgentId } from './types';

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

async function getStaffTransportPlannerAgent(): Promise<AgentDefinition> {
  const { STAFF_TRANSPORT_PLANNER_AGENT } = await import('./staff-transport-planner/agent');
  return STAFF_TRANSPORT_PLANNER_AGENT;
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
  'predictive-maintenance':     getPMAgent,
  'finance-anomaly':            getFinanceAnomalyAgent,
  'route-optimiser':            getRouteOptimiserAgent,
  'staff-transport-planner':    getStaffTransportPlannerAgent,
  'incident-triage':            getIncidentTriageAgent,
  'dispatch-optimiser':         getDispatchOptimiserAgent,
  'driver-coach':               getDriverCoachAgent,
  'demand-forecasting':         getDemandForecastingAgent,
  'document-intelligence':      async () => { throw new Error('Not yet implemented'); },
  // ── Conversational (always-on, stats wrappers) ─────────────────────────────
  'whatsapp-agent':             getWhatsAppAgent,
  'chat-widget':                getChatWidgetAgent,
  'ops-assistant':              getOpsAssistantAgent,
};

const DYNAMIC_AGENTS = new Map<string, AgentDefinition>();

/**
 * Register or override an agent definition dynamically at runtime.
 */
export function registerAgent(agent: AgentDefinition): void {
  DYNAMIC_AGENTS.set(agent.id, agent);
}

/**
 * Remove a dynamically registered agent.
 */
export function unregisterAgent(agentId: string): boolean {
  return DYNAMIC_AGENTS.delete(agentId);
}

/**
 * Clear all dynamically registered agents.
 */
export function clearDynamicAgents(): void {
  DYNAMIC_AGENTS.clear();
}

/**
 * Retrieve an agent definition by its unique identifier.
 */
export async function getAgent(id: AgentId | string): Promise<AgentDefinition> {
  if (DYNAMIC_AGENTS.has(id)) {
    return DYNAMIC_AGENTS.get(id)!;
  }
  const loader = AGENT_LOADERS[id as AgentId];
  if (!loader) throw new Error(`Unknown agent: ${id}`);
  return loader();
}

/**
 * List all known agent IDs (both static loaders and dynamic registrations).
 */
export function listAgentIds(): string[] {
  const staticIds = Object.keys(AGENT_LOADERS);
  const dynamicIds = Array.from(DYNAMIC_AGENTS.keys());
  return Array.from(new Set([...staticIds, ...dynamicIds]));
}

/**
 * Checks if a registered pattern matches an incoming domain event.
 * Supports exact matching and wildcards (e.g. `vehicle.*`, `*.created`, `*`).
 */
export function matchesEventPattern(pattern: string, eventType: string): boolean {
  if (pattern === '*' || pattern === eventType) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return eventType.startsWith(`${prefix}.`);
  }
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return eventType.endsWith(`.${suffix}`);
  }
  return false;
}

/**
 * Find all registered agents that subscribe to a given event type.
 */
export async function getAgentsForEvent(eventType: AgentEventType | string): Promise<AgentDefinition[]> {
  const matchedAgents: AgentDefinition[] = [];
  const allIds = listAgentIds();

  for (const id of allIds) {
    try {
      const agent = await getAgent(id);
      const events: string[] = agent.subscribedEvents ?? (agent as any).events ?? [];
      const isSubscribed = events.some(pattern =>
        matchesEventPattern(pattern, eventType),
      );
      if (isSubscribed) {
        matchedAgents.push(agent);
      }
    } catch {
      // Ignore uninitialized or planned agents
    }
  }

  return matchedAgents;
}

export const AGENT_CATALOGUE = [
  {
    id: 'predictive-maintenance' as AgentId,
    name: 'Predictive Maintenance Agent',
    description: 'Scores every vehicle using 9 failure factors, sensor telemetry, and failure RUL to auto-schedule maintenance for high-risk vehicles.',
    version: '2.0.0',
    status: 'live',
    model: 'Multi-Signal Sensor & Degradation Model',
    module: 'Fleet / Maintenance',
  },
  {
    id: 'finance-anomaly' as AgentId,
    name: 'Finance Anomaly Detection Agent',
    description: 'AI Financial Control Layer analyzing 8 transaction streams (Maintenance, Fuel, Invoices, Partners, Expenses, Tolls, Contracts, Procurement) to explain root cause and execute 1-click financial remediation.',
    version: '2.0.0',
    status: 'live',
    model: 'Expected vs Actual Intelligence',
    module: 'Finance',
  },
  {
    id: 'route-optimiser' as AgentId,
    name: 'Route Optimisation Agent',
    description: 'Universal multi-route network consolidation engine that merges under-utilized routes, chains turnaround vehicles, and calculates fleet savings across Bus-Ops and School Bus.',
    version: '2.0.0',
    status: 'live',
    model: 'Network Consolidation + 2-Opt TSP',
    module: 'School Bus & Logistics',
  },
  {
    id: 'staff-transport-planner' as AgentId,
    name: 'Staff Transport Planning Agent',
    description: 'Multi-shift optimization engine analyzing employee accommodations, worksites, and manifests to recommend optimal route clusters, vehicle sizing (14/30/50), departure times, and cross-shift vehicle reuse.',
    version: '1.0.0',
    status: 'live',
    model: 'Multi-Shift Geoclustering + 2-Opt TSP',
    module: 'Bus-Ops / Staff Transport',
    agentType: 'BATCH',
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
    description: '15-factor statistical scoring model that evaluates live HOS, compliance, deadhead, maintenance risk, and proximity to execute semi-autonomous dispatch.',
    version: '2.0.0',
    status: 'live',
    model: '15-Factor Semi-Autonomous Dispatch',
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
