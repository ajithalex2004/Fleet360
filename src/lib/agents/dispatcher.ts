/**
 * Fleet360 Multi-Tenant Event Dispatcher
 * --------------------------------------
 * Broadcasts domain events (e.g. `vehicle.fuel_log_added`, `dispatch.job_created`,
 * `finance.invoice_created`, `bus_ops.shift_scheduled`) to all registered agents
 * subscribed to the event under strict multi-tenant isolation.
 *
 * Capabilities:
 *  1. Event Subscription Discovery via getAgentsForEvent().
 *  2. Concurrency-Controlled Fan-Out Execution.
 *  3. Idempotency Deduplication (prevents duplicate webhook/cron triggers).
 *  4. Strict Multi-Tenant Scoping & Audit Trail Integration.
 */

import { AgentEvent, AgentRunResult } from './types';
import { getAgentsForEvent } from './registry';
import { dispatch } from './orchestrator';

export interface PublishEventOptions {
  concurrencyLimit?: number;
  idempotencyKey?: string;
  idempotencyTtlMs?: number;
  skipIdempotency?: boolean;
}

const PROCESSED_EVENT_KEYS = new Map<string, number>();
const MAX_IDEMPOTENCY_ENTRIES = 5000;

function computeEventKey(event: AgentEvent, customKey?: string): string {
  if (customKey) return `idemp_${event.tenant_id}_${customKey}`;
  const entity = event.entity_id ?? 'global';
  return `idemp_${event.tenant_id}_${event.event_type}_${entity}`;
}

export class EventDispatcher {
  /**
   * Publish a domain event to all subscribed agents.
   */
  async publishEvent(
    event: AgentEvent,
    options: PublishEventOptions = {},
  ): Promise<AgentRunResult[]> {
    if (!event.tenant_id || event.tenant_id.trim() === '') {
      throw new Error('[event-dispatcher] Security violation: tenant_id is required for event dispatch.');
    }

    // Idempotency Deduplication Check
    if (!options.skipIdempotency) {
      const key = computeEventKey(event, options.idempotencyKey);
      const isDuplicate = this.checkAndRecordIdempotency(key, options.idempotencyTtlMs);
      if (isDuplicate) {
        console.warn(`[event-dispatcher] Duplicate event suppressed by idempotency guard: ${key}`);
        return [];
      }
    }

    // Discover Subscribed Agents
    const agents = await getAgentsForEvent(event.event_type);
    if (agents.length === 0) {
      return [];
    }

    const concurrencyLimit = options.concurrencyLimit ?? 5;
    const results: AgentRunResult[] = [];

    // Chunk execution by concurrency limit
    for (let i = 0; i < agents.length; i += concurrencyLimit) {
      const chunk = agents.slice(i, i + concurrencyLimit);
      const chunkPromises = chunk.map((agent) =>
        dispatch({
          ...event,
          agent_id: agent.id,
        }).catch((err): AgentRunResult => ({
          agentId: agent.id,
          tenantId: event.tenant_id,
          eventType: event.event_type,
          entityId: event.entity_id,
          status: 'FAILED',
          durationMs: 0,
          itemsProcessed: 0,
          actionsCreated: 0,
          output: null,
          error: err instanceof Error ? err.message : String(err),
        })),
      );

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Returns true if key was already seen within TTL window, otherwise records it and returns false.
   */
  checkAndRecordIdempotency(key: string, ttlMs = 5 * 60 * 1000): boolean {
    const now = Date.now();
    const existing = PROCESSED_EVENT_KEYS.get(key);

    if (existing && existing > now) {
      return true;
    }

    if (PROCESSED_EVENT_KEYS.size >= MAX_IDEMPOTENCY_ENTRIES) {
      // Evict expired entries
      for (const [k, exp] of PROCESSED_EVENT_KEYS.entries()) {
        if (exp <= now) PROCESSED_EVENT_KEYS.delete(k);
      }
    }

    PROCESSED_EVENT_KEYS.set(key, now + ttlMs);
    return false;
  }

  /**
   * Clear idempotency cache (useful for testing)
   */
  clearIdempotencyCache(): void {
    PROCESSED_EVENT_KEYS.clear();
  }
}

/** Global Shared Event Dispatcher Singleton */
export const eventDispatcher = new EventDispatcher();

/** Top-level function export */
export async function publishEvent(
  event: AgentEvent,
  options?: PublishEventOptions,
): Promise<AgentRunResult[]> {
  return eventDispatcher.publishEvent(event, options);
}
