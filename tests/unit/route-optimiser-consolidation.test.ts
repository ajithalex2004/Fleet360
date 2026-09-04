import { describe, it, expect } from 'vitest';
import { runRouteOptimiser } from '@/lib/agents/route-optimiser/agent';
import { AgentEvent } from '@/lib/agents/types';
import { haversineKm, optimiseRoute } from '@/lib/agents/route-optimiser/tsp';

describe('Route Optimisation & Network Consolidation Agent', () => {
  it('1. Calculates TSP geometric distance savings on multi-stop route', () => {
    const stops = [
      { id: '1', name: 'Stop A', lat: 25.2048, lng: 55.2708, sequence: 1 },
      { id: '2', name: 'Stop B', lat: 25.2769, lng: 55.2962, sequence: 2 },
      { id: '3', name: 'Stop C', lat: 25.0757, lng: 55.1403, sequence: 3 },
      { id: '4', name: 'Stop D', lat: 25.1972, lng: 55.2744, sequence: 4 },
    ];

    const result = optimiseRoute(stops);
    expect(result.optimisedDistanceKm).toBeLessThanOrEqual(result.originalDistanceKm);
    expect(result.optimisedSequence.length).toBe(4);
  });

  it('2. Evaluates Network Design structure and dollarized cost savings', async () => {
    const mockEvent: AgentEvent = {
      tenant_id: 'test-tenant',
      agent_id: 'route-optimiser',
      event_type: 'manual.trigger',
    };

    const runResult = await runRouteOptimiser(mockEvent);
    expect(runResult.agentId).toBe('route-optimiser');
    expect(runResult.status).toBe('COMPLETED');
    
    const output = runResult.output as {
      networkDesign: {
        currentRoutesCount: number;
        recommendedRoutesCount: number;
        vehiclesSaved: number;
        dailyKmSaved: number;
        monthlyCostSavedAed: number;
      };
      summary: string;
    };

    expect(output.networkDesign).toBeDefined();
    expect(output.networkDesign.recommendedRoutesCount).toBeLessThanOrEqual(
      Math.max(output.networkDesign.currentRoutesCount, 1)
    );
    expect(output.networkDesign.monthlyCostSavedAed).toBeGreaterThanOrEqual(0);
  });
});
