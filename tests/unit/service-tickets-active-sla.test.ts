import { describe, it, expect } from 'vitest';
import {
  calculateTicketSlaStatus,
  calculateBusinessMinutesElapsed,
  type SlaTicketInput,
} from '@/lib/service-tickets/active-sla-engine';

describe('Active SLA Escalation & On-Call Paging Engine (Pillar 2)', () => {
  describe('Differentiated SLA Calendars', () => {
    it('runs 24/7 Emergency Clock continuously for TOWING tickets', () => {
      const createdAt = new Date('2026-09-01T02:00:00Z'); // 2 AM UTC
      const now = new Date('2026-09-01T02:25:00Z'); // 25 mins later

      const ticket: SlaTicketInput = {
        id: 't-1',
        ticketType: 'TOWING',
        priority: 'High',
        status: 'Pending',
        createdAt,
        readableId: 'ST2026-TOW-0001',
      };

      const result = calculateTicketSlaStatus(ticket, now);

      expect(result.clockType).toBe('EMERGENCY_24_7');
      expect(result.elapsedWorkingMinutes).toBe(25);
      expect(result.isAckOverdue).toBe(true); // 25m > 15m limit
      expect(result.escalationTier).toBe('TIER_2_ESCALATED');
      expect(result.shouldAutoEscalateToTier2).toBe(true);
      expect(result.pagingTargetRole).toBe('SHIFT_SUPERVISOR');
    });

    it('pauses Business Hours Clock overnight for RENEWAL tickets', () => {
      // 11 PM GST (19:00 UTC) to 3 AM GST (23:00 UTC) - outside 08:00-18:00 GST
      const from = new Date('2026-09-01T19:00:00Z');
      const to = new Date('2026-09-01T23:00:00Z');

      const minutes = calculateBusinessMinutesElapsed(from, to);
      expect(minutes).toBe(0); // Night hours should not count
    });

    it('accumulates business minutes during working hours (08:00 - 18:00 GST)', () => {
      // 9 AM GST (05:00 UTC) to 11 AM GST (07:00 UTC) on Tuesday (business day)
      const from = new Date('2026-09-01T05:00:00Z');
      const to = new Date('2026-09-01T07:00:00Z');

      const minutes = calculateBusinessMinutesElapsed(from, to);
      expect(minutes).toBe(120);
    });
  });

  describe('Multi-Tier Escalation Matrix & Director Paging', () => {
    it('classifies unacknowledged ticket <15m as Tier 1 Normal', () => {
      const createdAt = new Date('2026-09-01T10:00:00Z');
      const now = new Date('2026-09-01T10:10:00Z'); // 10 mins

      const ticket: SlaTicketInput = {
        id: 't-2',
        ticketType: 'INCIDENT',
        priority: 'High',
        status: 'Pending',
        createdAt,
        readableId: 'ST2026-INC-0010',
      };

      const result = calculateTicketSlaStatus(ticket, now);

      expect(result.escalationTier).toBe('TIER_1_NORMAL');
      expect(result.isAckOverdue).toBe(false);
      expect(result.shouldAutoEscalateToTier2).toBe(false);
      expect(result.pagingTargetRole).toBe('CONTROLLER');
    });

    it('triggers Tier 3 Breach & Director Alert when emergency ticket is unacknowledged >30m', () => {
      const createdAt = new Date('2026-09-01T10:00:00Z');
      const now = new Date('2026-09-01T10:45:00Z'); // 45 mins

      const ticket: SlaTicketInput = {
        id: 't-3',
        ticketType: 'TOWING',
        priority: 'High',
        status: 'Pending',
        createdAt,
        readableId: 'ST2026-TOW-0045',
      };

      const result = calculateTicketSlaStatus(ticket, now);

      expect(result.escalationTier).toBe('TIER_3_BREACHED');
      expect(result.shouldTriggerTier3DirectorAlert).toBe(true);
      expect(result.pagingTargetRole).toBe('OPERATIONS_DIRECTOR');
      expect(result.escalationReason).toContain('exceeds Tier 2 limit');
    });

    it('considers Resolved tickets as Normal and not overdue', () => {
      const createdAt = new Date('2026-08-30T10:00:00Z');
      const now = new Date('2026-09-01T10:00:00Z'); // 48 hours later

      const ticket: SlaTicketInput = {
        id: 't-4',
        ticketType: 'TOWING',
        priority: 'High',
        status: 'Resolved',
        createdAt,
        readableId: 'ST2026-TOW-0099',
      };

      const result = calculateTicketSlaStatus(ticket, now);

      expect(result.escalationTier).toBe('TIER_1_NORMAL');
      expect(result.isResolveOverdue).toBe(false);
      expect(result.shouldTriggerTier3DirectorAlert).toBe(false);
    });
  });
});
