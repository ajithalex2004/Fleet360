import { describe, it, expect } from 'vitest';
import { getUaeShiftModifier, STAFF_TRANSPORT_DEMAND_AGENT } from '@/lib/agents/staff-transport-demand/agent';
import { getAgent } from '@/lib/agents/registry';

describe('Staff Transport Demand Forecasting Agent', () => {
  it('is correctly registered in the Agent Registry', async () => {
    const agent = await getAgent('staff-transport-demand');
    expect(agent).toBeDefined();
    expect(agent.id).toBe('staff-transport-demand');
    expect(agent.name).toBe('Staff Transport Demand Forecaster');
    expect(agent.autonomyLevel).toBe('L2');
  });

  describe('UAE Shift & Seasonality Modifier', () => {
    it('applies Summer Midday Ban multiplier for split shifts between June 15 and September 15', () => {
      // July 15 (Summer Ban peak)
      const summerDate = new Date(2026, 6, 15);
      const splitMod = getUaeShiftModifier(summerDate, 'SPLIT');
      expect(splitMod.multiplier).toBe(1.25);
      expect(splitMod.policyNote).toContain('Summer Midday Ban');

      const morningMod = getUaeShiftModifier(summerDate, 'MORNING');
      expect(morningMod.multiplier).toBe(1.10);
    });

    it('applies Academic Term Start multiplier in late September', () => {
      // September 20
      const schoolDate = new Date(2026, 8, 20);
      const mod = getUaeShiftModifier(schoolDate, 'MORNING');
      expect(mod.multiplier).toBe(1.15);
      expect(mod.policyNote).toContain('Academic Term Start');
    });

    it('returns neutral multiplier 1.0 during standard operational windows', () => {
      // March 10
      const normalDate = new Date(2026, 2, 10);
      const mod = getUaeShiftModifier(normalDate, 'MORNING');
      expect(mod.multiplier).toBe(1.0);
      expect(mod.policyNote).toBeUndefined();
    });
  });

  describe('Agent Definition & Contract', () => {
    it('has standard agent plugin properties', () => {
      expect(STAFF_TRANSPORT_DEMAND_AGENT.id).toBe('staff-transport-demand');
      expect(STAFF_TRANSPORT_DEMAND_AGENT.subscribedEvents).toContain('bus.demand.forecast');
      expect(typeof STAFF_TRANSPORT_DEMAND_AGENT.run).toBe('function');
    });
  });
});
