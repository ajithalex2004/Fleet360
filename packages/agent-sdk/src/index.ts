/**
 * @gravity/agent-sdk
 * -------------------
 * Standalone AI Agent Ecosystem for Fleet Management Platforms.
 *
 * Plug 7 production-grade AI agents into any fleet platform in minutes:
 *   - Predictive Maintenance  (statistical — no LLM)
 *   - Finance Anomaly Detection (statistical — no LLM)
 *   - Route Optimisation      (TSP solver — no LLM)
 *   - Incident Auto-Triage    (rules engine + GPT-4o)
 *   - Smart Dispatch Optimiser (15-factor scoring — no LLM)
 *   - Driver Coaching         (GPT-4o)
 *   - Demand Forecasting      (moving avg + GPT-4o)
 *
 * @example
 * ```ts
 * import { AgentSDK, UniversalAdapter } from '@gravity/agent-sdk';
 *
 * const sdk = new AgentSDK({
 *   baseUrl:      'https://your-gravity-agent-service.com',
 *   apiKey:       'YOUR_API_KEY',
 *   tenantId:     'your-org-id',
 *   openaiApiKey: 'sk-...',
 * });
 *
 * // Run predictive maintenance scan
 * const result = await sdk.run('predictive-maintenance');
 * console.log(result.output.summary);
 *
 * // Send an incident event
 * const adapter = new UniversalAdapter({ tenantId: 'your-org-id' });
 * await sdk.dispatch(
 *   adapter.fromIncidentCreated({
 *     incidentId: 'INC-001',
 *     type: 'ACCIDENT',
 *     severity: 'HIGH',
 *     injuriesReported: true,
 *   })
 * );
 * ```
 */

// Core SDK class
export { AgentSDK, createAgentSDK } from './sdk';

// Universal Platform Adapter
export { UniversalAdapter } from './adapter';

// Webhook receiver
export { WebhookReceiver } from './webhook';

// All public types
export type {
  AgentId,
  AgentEventType,
  AgentEvent,
  AgentResult,
  AgentSDKConfig,
  AsyncDispatchResult,
  AgentCatalogueEntry,
} from './types';

export type { AdapterConfig } from './adapter';
export type { WebhookReceiverConfig } from './webhook';

// Version
export const SDK_VERSION = '1.0.0';
