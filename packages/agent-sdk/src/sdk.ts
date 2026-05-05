/**
 * @gravity/agent-sdk — AgentSDK Main Class
 * ------------------------------------------
 * The primary integration point for any fleet management platform.
 *
 * Usage:
 *   import { AgentSDK } from '@gravity/agent-sdk';
 *
 *   const sdk = new AgentSDK({
 *     baseUrl:    'https://your-gravity-agent-service.com',
 *     apiKey:     'YOUR_API_KEY',
 *     tenantId:   'your-org-id',
 *     openaiApiKey: 'sk-...',
 *   });
 *
 *   // Run an agent
 *   const result = await sdk.run('predictive-maintenance');
 *
 *   // Send a specific event
 *   const result = await sdk.dispatch({
 *     agent_id:   'incident-triage',
 *     event_type: 'incident.created',
 *     entity_id:  'incident-uuid-here',
 *     payload:    { incidentType: 'ACCIDENT', severity: 'HIGH' },
 *   });
 *
 *   // Async mode — callback webhook
 *   const job = await sdk.dispatchAsync({
 *     agent_id:    'demand-forecasting',
 *     event_type:  'manual.trigger',
 *     callback_url: 'https://your-platform.com/webhooks/agent-result',
 *   });
 */

import type {
  AgentSDKConfig, AgentEvent, AgentResult, AsyncDispatchResult,
  AgentId, AgentEventType, AgentCatalogueEntry,
} from './types';

export class AgentSDK {
  private config: Required<AgentSDKConfig>;

  constructor(config: AgentSDKConfig) {
    this.config = {
      timeoutMs: 30000,
      openaiApiKey: '',
      ...config,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      'X-Tenant-Id':   this.config.tenantId,
      ...(this.config.openaiApiKey ? { 'X-OpenAI-Key': this.config.openaiApiKey } : {}),
    };
  }

  private async fetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const res = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers(), ...(init.headers ?? {}) },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Agent SDK HTTP ${res.status}: ${body}`);
      }

      return res.json() as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Synchronous dispatch — waits for the agent to complete and returns result.
   * Suitable for agents that complete in <30 seconds (all statistical agents).
   */
  async dispatch(event: Omit<AgentEvent, 'tenant_id' | 'api_key'>): Promise<AgentResult> {
    return this.fetch<AgentResult>('/api/agents/ingest', {
      method: 'POST',
      body:   JSON.stringify({
        ...event,
        tenant_id: this.config.tenantId,
        api_key:   this.config.apiKey,
      }),
    });
  }

  /**
   * Asynchronous dispatch — returns immediately with a job ID.
   * Agent runs in background and POSTs result to callback_url.
   */
  async dispatchAsync(
    event: Omit<AgentEvent, 'tenant_id' | 'api_key'> & { callback_url: string },
  ): Promise<AsyncDispatchResult> {
    return this.fetch<AsyncDispatchResult>('/api/agents/ingest', {
      method: 'POST',
      body:   JSON.stringify({
        ...event,
        tenant_id: this.config.tenantId,
        api_key:   this.config.apiKey,
      }),
    });
  }

  /**
   * Trigger a full-scan run of an agent (manual trigger).
   * Equivalent to clicking "Run Analysis" in the dashboard.
   */
  async run(agentId: AgentId, tenantId?: string): Promise<AgentResult> {
    return this.fetch<AgentResult>('/api/agents/run', {
      method: 'POST',
      body:   JSON.stringify({
        agent_id:  agentId,
        tenant_id: tenantId ?? this.config.tenantId,
      }),
    });
  }

  /**
   * Run all live agents in sequence.
   * Returns results map keyed by agent ID.
   */
  async runAll(): Promise<Record<AgentId, AgentResult>> {
    const catalogue = await this.catalogue();
    const liveAgents = catalogue.filter(a => a.status === 'live');
    const results: Partial<Record<AgentId, AgentResult>> = {};

    for (const agent of liveAgents) {
      try {
        results[agent.id] = await this.run(agent.id);
      } catch (e) {
        results[agent.id] = {
          agentId: agent.id, tenantId: this.config.tenantId, eventType: 'manual.trigger',
          status: 'FAILED', durationMs: 0, itemsProcessed: 0, actionsCreated: 0,
          output: null, error: String(e),
        };
      }
    }

    return results as Record<AgentId, AgentResult>;
  }

  /** Get the agent catalogue (list of all agents + status). */
  async catalogue(): Promise<AgentCatalogueEntry[]> {
    return this.fetch<AgentCatalogueEntry[]>('/api/agents/catalogue');
  }

  /** Get recent agent run logs. */
  async logs(options: { agentId?: AgentId; status?: string; limit?: number } = {}): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (options.agentId) params.set('agent_id', options.agentId);
    if (options.status)  params.set('status', options.status);
    if (options.limit)   params.set('limit', String(options.limit));
    const qs = params.toString();
    return this.fetch<unknown[]>(`/api/agents/logs${qs ? `?${qs}` : ''}`);
  }

  /** Subscribe to agent events via webhook registration. */
  async subscribe(options: {
    agentIds: AgentId[];
    eventTypes: AgentEventType[];
    callbackUrl: string;
    secret?: string;
  }): Promise<{ subscriptionId: string }> {
    return this.fetch('/api/agents/subscriptions', {
      method: 'POST',
      body:   JSON.stringify({ ...options, tenant_id: this.config.tenantId }),
    });
  }
}

/** Factory function — alternative to `new AgentSDK(config)` */
export function createAgentSDK(config: AgentSDKConfig): AgentSDK {
  return new AgentSDK(config);
}
