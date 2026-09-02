import { describe, it, expect } from 'vitest';
import {
  detectChronicDefectRisk,
  type ChronicRiskEvaluation,
} from '@/lib/service-tickets/context-360-engine';

describe('Vehicle 360 & Chronic Defect Risk Engine (Pillar 3)', () => {
  it('returns NONE risk severity when vehicle has zero prior incidents in 90 days', () => {
    const result = detectChronicDefectRisk([]);

    expect(result.isChronicRisk).toBe(false);
    expect(result.ticketCount90Days).toBe(0);
    expect(result.riskSeverity).toBe('NONE');
    expect(result.recurringCategories).toEqual([]);
  });

  it('detects CRITICAL_LEMON when 2 or more recurring cooling/engine failures occur', () => {
    const history = [
      {
        ticketType: 'MAINTENANCE',
        createdAt: new Date('2026-08-15'),
        category: 'ENGINE_OVERHEAT',
      },
      {
        ticketType: 'MAINTENANCE',
        createdAt: new Date('2026-08-28'),
        category: 'ENGINE_OVERHEAT',
      },
    ];

    const result = detectChronicDefectRisk(history);

    expect(result.isChronicRisk).toBe(true);
    expect(result.riskSeverity).toBe('CRITICAL_LEMON');
    expect(result.recurringCategories).toContain('ENGINE_OVERHEAT');
    expect(result.riskMessage).toContain('Critical Chronic Defect');
  });

  it('detects CRITICAL_LEMON when 2 recurring brake/suspension failures occur', () => {
    const history = [
      {
        ticketType: 'MAINTENANCE',
        createdAt: new Date('2026-07-20'),
        category: 'BRAKES_SUSPENSION',
      },
      {
        ticketType: 'MAINTENANCE',
        createdAt: new Date('2026-08-10'),
        category: 'BRAKES_SUSPENSION',
      },
    ];

    const result = detectChronicDefectRisk(history);

    expect(result.isChronicRisk).toBe(true);
    expect(result.riskSeverity).toBe('CRITICAL_LEMON');
    expect(result.recurringCategories).toContain('BRAKES_SUSPENSION');
  });

  it('detects MODERATE risk when 3 distinct non-critical tickets are logged in 90 days', () => {
    const history = [
      {
        ticketType: 'CLEANING',
        createdAt: new Date('2026-08-01'),
        category: 'FLEET_WASH_DETAIL',
      },
      {
        ticketType: 'SUPPORT',
        createdAt: new Date('2026-08-12'),
        category: 'LOST_ITEM',
      },
      {
        ticketType: 'RENEWAL',
        createdAt: new Date('2026-08-25'),
        category: 'MULKIYA_RENEWAL',
      },
    ];

    const result = detectChronicDefectRisk(history);

    expect(result.isChronicRisk).toBe(true);
    expect(result.riskSeverity).toBe('MODERATE');
    expect(result.ticketCount90Days).toBe(3);
  });
});
