import { describe, it, expect } from 'vitest';
import {
  calculateProgressStage,
  classifyNps,
} from '@/lib/service-tickets/csat-analytics-engine';

describe('Customer Experience, Live Tracking & CSAT Engine (Pillar 5)', () => {
  describe('5-Stage Progress Stepper Logic', () => {
    it('returns Stage 1 for newly received pending tickets', () => {
      const { stage, stageName } = calculateProgressStage('Pending', false);
      expect(stage).toBe(1);
      expect(stageName).toBe('Request Received');
    });

    it('returns Stage 2 when ticket is acknowledged or assigned', () => {
      const { stage, stageName } = calculateProgressStage('Acknowledged', false);
      expect(stage).toBe(2);
      expect(stageName).toBe('Request Acknowledged');
    });

    it('returns Stage 3 when flatbed recovery is dispatched', () => {
      const { stage, stageName } = calculateProgressStage('Pending', true);
      expect(stage).toBe(3);
      expect(stageName).toBe('Recovery Flatbed Dispatched');
    });

    it('returns Stage 4 when ticket is in progress / repair', () => {
      const { stage, stageName } = calculateProgressStage('In Progress', false);
      expect(stage).toBe(4);
      expect(stageName).toBe('Under Inspection & Repair');
    });

    it('returns Stage 5 when ticket is resolved or completed', () => {
      const { stage, stageName } = calculateProgressStage('Resolved', false);
      expect(stage).toBe(5);
      expect(stageName).toBe('Resolved & Completed');
    });
  });

  describe('NPS & CSAT Classification', () => {
    it('classifies 5 stars as PROMOTER', () => {
      expect(classifyNps(5)).toBe('PROMOTER');
    });

    it('classifies 4 stars as PASSIVE', () => {
      expect(classifyNps(4)).toBe('PASSIVE');
    });

    it('classifies 1, 2, and 3 stars as DETRACTOR', () => {
      expect(classifyNps(3)).toBe('DETRACTOR');
      expect(classifyNps(2)).toBe('DETRACTOR');
      expect(classifyNps(1)).toBe('DETRACTOR');
    });
  });
});
