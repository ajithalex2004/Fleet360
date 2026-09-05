import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DRIVER_COACHING_AGENT, buildDeterministicCoachingPlan } from '@/lib/agents/driver-coaching/agent';
import { DEMAND_FORECASTING_AGENT, buildDeterministicDemandNarrative } from '@/lib/agents/demand-forecasting/agent';
import { INCIDENT_TRIAGE_AGENT, buildDeterministicTriageRecommendation } from '@/lib/agents/incident-triage/agent';
import { aiGateway } from '@/lib/agents/gateway';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn(),
  },
}));

vi.mock('@/lib/agents/schema', () => ({
  ensureAgentSchema: vi.fn().mockResolvedValue(undefined),
}));

describe('Phase 7: Driver Coaching & Demand Forecasting Loop Elimination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Deterministic Template Fidelity', () => {
    it('generates high quality driver coaching plan deterministically', () => {
      const plan = buildDeterministicCoachingPlan(
        'Ahmed Al-Mansoor',
        'EXCELLENT',
        ['Performance Maintenance & Excellence'],
        92,
        88,
        95,
      );

      expect(plan).toContain('Weekly Performance Coaching Plan for Ahmed Al-Mansoor (EXCELLENT Standing)');
      expect(plan).toContain('Safety: 95/100');
      expect(plan).toContain('Fuel: 88/100');
      expect(plan).toContain('Speed: 92/100');
      expect(plan).toContain('3-second rule');
    });

    it('generates accurate statistical demand narrative deterministically', () => {
      const narrative = buildDeterministicDemandNarrative(
        'BUS_50_SEATER',
        'DXB-MAIN',
        42,
        'UP',
        47,
        1.15,
      );

      expect(narrative).toContain('BUS_50_SEATER demand is trending up for branch DXB-MAIN with 42 bookings forecast');
      expect(narrative).toContain('Seasonal holiday surge expected');
      expect(narrative).toContain('Recommended target fleet readiness is 47 available units');
    });

    it('generates protocol emergency triage recommendation deterministically', () => {
      const recommendation = buildDeterministicTriageRecommendation(
        'Ambulance Unit',
        'Sheikh Zayed Road Exit 39',
        'Secure scene and render emergency first aid',
        7,
      );

      expect(recommendation).toContain('Dispatch Ambulance Unit to Sheikh Zayed Road Exit 39 immediately');
      expect(recommendation).toContain('Estimated response ETA: 7 minutes');
      expect(recommendation).toContain('Secure scene and render emergency first aid');
    });
  });

  describe('Driver Coaching Selective AI Routing', () => {
    it('processes clean drivers deterministically without calling AI Gateway', async () => {
      const { prisma } = await import('@/lib/prisma');
      const chatSpy = vi.spyOn(aiGateway, 'chat');

      (prisma.$queryRaw as any)
        .mockResolvedValueOnce([
          {
            id: 'drv-1',
            first_name: 'Rashid',
            last_name: 'Khan',
            employee_id: 'EMP-101',
            rag_score: 90,
            rag_status: 'GREEN',
          },
        ])
        .mockResolvedValueOnce([
          {
            driver_id: 'drv-1',
            avg_speed_score: 88,
            avg_fuel_score: 92,
            avg_safety_score: 95,
            violations_last_30d: 0,
            incidents_last_30d: 0,
            trips_last_30d: 45,
          },
        ]);

      const result = await DRIVER_COACHING_AGENT.run({
        agent_id: 'driver-coach',
        tenant_id: 'tenant-uae',
        event_type: 'driver.week_end',
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.itemsProcessed).toBe(1);
      const out = result.output as any;
      expect(out.deterministicCount).toBe(1);
      expect(out.aiCount).toBe(0);
      expect(out.avoidedTokens).toBeGreaterThan(0);
      expect(chatSpy).not.toHaveBeenCalled();
    });

    it('routes at-risk drivers through AI Gateway and records token telemetry', async () => {
      const { prisma } = await import('@/lib/prisma');
      const chatSpy = vi.spyOn(aiGateway, 'chat').mockResolvedValueOnce({
        content: 'AI Custom Coaching: Focus on speed control and avoiding harsh braking.',
        modelUsed: 'gpt-4o-mini',
        provider: 'openai',
        capability: 'ECONOMY_TEXT',
        telemetry: {
          inputTokens: 120,
          outputTokens: 50,
          cachedTokens: 0,
          costUsd: 0.0001,
          costAed: 0.000367,
          durationMs: 250,
        },
      });

      (prisma.$queryRaw as any)
        .mockResolvedValueOnce([
          {
            id: 'drv-2',
            first_name: 'Vikram',
            last_name: 'Singh',
            employee_id: 'EMP-102',
            rag_score: 55, // Low score
            rag_status: 'RED',
          },
        ])
        .mockResolvedValueOnce([
          {
            driver_id: 'drv-2',
            avg_speed_score: 50,
            avg_fuel_score: 58,
            avg_safety_score: 52,
            violations_last_30d: 3, // Violations present
            incidents_last_30d: 1,
            trips_last_30d: 30,
          },
        ]);

      const result = await DRIVER_COACHING_AGENT.run({
        agent_id: 'driver-coach',
        tenant_id: 'tenant-uae',
        event_type: 'driver.week_end',
      });

      expect(result.status).toBe('COMPLETED');
      const out = result.output as any;
      expect(out.aiCount).toBe(1);
      expect(chatSpy).toHaveBeenCalledTimes(1);
      expect(result.telemetry?.modelAlias).toBe('ECONOMY_TEXT');
    });
  });

  describe('Demand Forecasting Loop Elimination', () => {
    it('generates segment forecasts without per-segment LLM loop and builds 1 macro summary', async () => {
      const { prisma } = await import('@/lib/prisma');
      const chatSpy = vi.spyOn(aiGateway, 'chat').mockResolvedValueOnce({
        content: 'Macro fleet demand is projected to increase by 12% next week.',
        modelUsed: 'gpt-4o-mini',
        provider: 'openai',
        capability: 'ECONOMY_TEXT',
        telemetry: {
          inputTokens: 80,
          outputTokens: 30,
          cachedTokens: 0,
          costUsd: 0.00008,
          costAed: 0.00029,
          durationMs: 180,
        },
      });

      // Mock 8 weeks of demand data across 2 segments
      const mockWeeklyRows = [
        { week: '2026-W10', vehicleType: 'SEDAN', branchId: 'DXB', count: 20 },
        { week: '2026-W11', vehicleType: 'SEDAN', branchId: 'DXB', count: 22 },
        { week: '2026-W12', vehicleType: 'SEDAN', branchId: 'DXB', count: 25 },
        { week: '2026-W13', vehicleType: 'SEDAN', branchId: 'DXB', count: 28 },
        { week: '2026-W10', vehicleType: 'SUV', branchId: 'AUH', count: 15 },
        { week: '2026-W11', vehicleType: 'SUV', branchId: 'AUH', count: 16 },
        { week: '2026-W12', vehicleType: 'SUV', branchId: 'AUH', count: 18 },
        { week: '2026-W13', vehicleType: 'SUV', branchId: 'AUH', count: 20 },
      ];

      (prisma.$queryRaw as any).mockResolvedValueOnce(mockWeeklyRows);

      const result = await DEMAND_FORECASTING_AGENT.run({
        agent_id: 'demand-forecasting',
        tenant_id: 'tenant-uae',
        event_type: 'manual.trigger',
      });

      expect(result.status).toBe('COMPLETED');
      const out = result.output as any;
      expect(out.totalForecasts).toBe(2);
      expect(chatSpy).toHaveBeenCalledTimes(1); // 1 single macro summary, not 2 per-segment calls
      expect(out.avoidedLoopCalls).toBe(1);
    });
  });

  describe('Incident Triage Severity-Tiered Routing', () => {
    it('uses deterministic protocol for low/medium severity incidents', async () => {
      const { prisma } = await import('@/lib/prisma');
      const chatSpy = vi.spyOn(aiGateway, 'chat');

      (prisma.$queryRaw as any)
        .mockResolvedValueOnce([
          {
            id: 'inc-1',
            incident_no: 'INC-001',
            incident_type: 'FLAT_TIRE',
            severity: 'LOW',
            description: 'Driver reported punctured right rear tire on shoulder.',
            location: 'Al Khail Road Exit 12',
            vehicle_id: 'veh-55',
            incident_date: new Date().toISOString(),
          },
        ])
        .mockResolvedValueOnce([]); // No ambulances needed for flat tire

      const result = await INCIDENT_TRIAGE_AGENT.run({
        agent_id: 'incident-triage',
        tenant_id: 'tenant-uae',
        event_type: 'incident.created',
      });

      expect(result.status).toBe('COMPLETED');
      const out = result.output as any;
      expect(out.deterministicCount).toBe(1);
      expect(out.aiCount).toBe(0);
      expect(chatSpy).not.toHaveBeenCalled();
    });
  });
});
