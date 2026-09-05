import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eventDispatcher, publishEvent } from '@/lib/agents/dispatcher';
import { registerAgent, unregisterAgent, getAgentsForEvent, getAgent } from '@/lib/agents/registry';
import { AgentEvent, AgentRunResult, AgentDefinition } from '@/lib/agents/types';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/lib/agents/schema', () => ({
  ensureAgentSchema: vi.fn().mockResolvedValue(undefined),
}));

describe('Phase 5: Agent Registry Governance & Multi-Tenant Event Dispatcher', () => {
  beforeEach(() => {
    eventDispatcher.clearIdempotencyCache();
    vi.clearAllMocks();
  });

  it('rejects events without a valid tenant_id', async () => {
    const invalidEvent: AgentEvent = {
      agent_id: 'dispatch-optimiser',
      tenant_id: '',
      event_type: 'vehicle.breakdown' as any,
    };

    await expect(publishEvent(invalidEvent)).rejects.toThrow(/tenant_id is required/);
  });

  it('correctly matches wildcard and multi-agent subscriptions', async () => {
    const workOrderEvents = await getAgentsForEvent('vehicle.work_order_created');
    const agentIds = workOrderEvents.map(a => a.id);
    
    // Both Predictive Maintenance and Finance Anomaly subscribe to work orders
    expect(agentIds).toContain('predictive-maintenance');
    expect(agentIds).toContain('finance-anomaly');
  });

  it('supports dynamic agent registration and unregistration with subscription filtering', async () => {
    const testAgent: AgentDefinition = {
      id: 'test-telematics-agent' as any,
      name: 'Test Telematics Agent',
      description: 'Test telematics agent',
      version: '1.0.0',
      agentType: 'BATCH',
      subscribedEvents: ['telematics.speeding' as any, 'telematics.geofence_exit' as any],
      supportsEntityScan: false,
      run: async (event: AgentEvent): Promise<AgentRunResult> => ({
        agentId: 'test-telematics-agent' as any,
        tenantId: event.tenant_id,
        eventType: event.event_type,
        status: 'COMPLETED',
        durationMs: 12,
        itemsProcessed: 1,
        actionsCreated: 1,
        output: { alertCreated: true },
      }),
    };

    registerAgent(testAgent);

    const fetched = await getAgent('test-telematics-agent');
    expect(fetched.name).toBe('Test Telematics Agent');

    const matchingAgents = await getAgentsForEvent('telematics.speeding');
    expect(matchingAgents.some(a => a.id === 'test-telematics-agent')).toBe(true);

    // Publish event
    const results = await publishEvent(
      {
        agent_id: 'test-telematics-agent' as any,
        tenant_id: 'tenant-uae-101',
        event_type: 'telematics.speeding' as any,
        entity_id: 'veh-789',
      },
      { skipIdempotency: true },
    );

    expect(results.length).toBeGreaterThanOrEqual(1);
    const testResult = results.find(r => r.agentId === 'test-telematics-agent');
    expect(testResult?.status).toBe('COMPLETED');
    expect(testResult?.tenantId).toBe('tenant-uae-101');

    // Unregister
    const removed = unregisterAgent('test-telematics-agent');
    expect(removed).toBe(true);

    const matchingAfterUnregister = await getAgentsForEvent('telematics.speeding');
    expect(matchingAfterUnregister.some(a => a.id === 'test-telematics-agent')).toBe(false);
  });

  it('deduplicates duplicate events within idempotency TTL window', async () => {
    const event: AgentEvent = {
      agent_id: 'finance-anomaly',
      tenant_id: 'tenant-dubai-42',
      event_type: 'finance.invoice_created',
      entity_id: 'inv-9999',
    };

    // First publish: processes normally
    const firstRun = await publishEvent(event, { idempotencyTtlMs: 60000 });
    expect(firstRun.length).toBeGreaterThanOrEqual(1);

    // Second publish with same tenant_id + event_type + entity_id: suppressed
    const duplicateRun = await publishEvent(event, { idempotencyTtlMs: 60000 });
    expect(duplicateRun).toEqual([]);

    // Different entity_id: should run
    const diffEntityRun = await publishEvent({
      ...event,
      entity_id: 'inv-10000',
    }, { idempotencyTtlMs: 60000 });
    expect(diffEntityRun.length).toBeGreaterThanOrEqual(1);
  });

  it('isolates agent execution errors and prevents whole fan-out failure', async () => {
    const crashingAgent: AgentDefinition = {
      id: 'crashing-sub-agent' as any,
      name: 'Crashing Sub Agent',
      description: 'Crashing test agent',
      version: '1.0.0',
      agentType: 'BATCH',
      subscribedEvents: ['crash.test.event' as any],
      supportsEntityScan: false,
      run: async () => {
        throw new Error('Database connection failed unexpectedly');
      },
    };

    const healthyAgent: AgentDefinition = {
      id: 'healthy-sub-agent' as any,
      name: 'Healthy Sub Agent',
      description: 'Healthy test agent',
      version: '1.0.0',
      agentType: 'BATCH',
      subscribedEvents: ['crash.test.event' as any],
      supportsEntityScan: false,
      run: async (event: AgentEvent): Promise<AgentRunResult> => ({
        agentId: 'healthy-sub-agent' as any,
        tenantId: event.tenant_id,
        eventType: event.event_type,
        status: 'COMPLETED',
        durationMs: 5,
        itemsProcessed: 1,
        actionsCreated: 0,
        output: { success: true },
      }),
    };

    registerAgent(crashingAgent);
    registerAgent(healthyAgent);

    const results = await publishEvent(
      {
        agent_id: 'healthy-sub-agent' as any,
        tenant_id: 'tenant-ad-99',
        event_type: 'crash.test.event' as any,
      },
      { skipIdempotency: true },
    );

    expect(results.length).toBe(2);
    const crashingResult = results.find(r => r.agentId === 'crashing-sub-agent');
    const healthyResult = results.find(r => r.agentId === 'healthy-sub-agent');

    expect(crashingResult?.status).toBe('FAILED');
    expect(crashingResult?.error).toContain('Database connection failed');
    expect(healthyResult?.status).toBe('COMPLETED');

    unregisterAgent('crashing-sub-agent');
    unregisterAgent('healthy-sub-agent');
  });
});
