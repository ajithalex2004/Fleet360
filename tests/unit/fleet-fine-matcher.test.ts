/**
 * tests/unit/fleet-fine-matcher.test.ts
 *
 * Unit tests for Traffic Fine & Toll (Salik/Darb) Auto-Matcher Engine.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyOffenceLiability,
  matchFineWithShiftRecords,
} from '@/lib/fleet/fine-toll-matcher';

describe('Traffic Fine & Toll Auto-Matcher Engine', () => {
  describe('classifyOffenceLiability', () => {
    it('classifies driving offenses as DRIVER liability', () => {
      expect(classifyOffenceLiability('SPEEDING')).toBe('DRIVER');
      expect(classifyOffenceLiability('RED_LIGHT_VIOLATION')).toBe('DRIVER');
      expect(classifyOffenceLiability('LANE_DISCIPLINE')).toBe('DRIVER');
      expect(classifyOffenceLiability('SALIK_TOLL_CROSSING')).toBe('DRIVER');
    });

    it('classifies vehicle compliance and equipment defects as COMPANY liability', () => {
      expect(classifyOffenceLiability('EXPIRED_REGISTRATION')).toBe('COMPANY');
      expect(classifyOffenceLiability('EXPIRED_MULKIYA')).toBe('COMPANY');
      expect(classifyOffenceLiability('EXPIRED_INSURANCE')).toBe('COMPANY');
      expect(classifyOffenceLiability('WINDOW_TINT_OVER_LEGAL_LIMIT')).toBe('COMPANY');
      expect(classifyOffenceLiability('BALD_TIRES_DEFECT')).toBe('COMPANY');
    });
  });

  describe('matchFineWithShiftRecords', () => {
    const sampleFine = {
      id: 'fine-101',
      vehicleId: 'veh-500',
      fineDate: new Date('2026-09-01T14:30:00Z'),
      fineAmount: 600,
      offenceType: 'SPEEDING',
      authority: 'RTA Dubai',
    };

    const sampleShifts = [
      {
        id: 'shift-01',
        driverId: 'drv-ahmed',
        driverName: 'Ahmed Al-Mansoor',
        vehicleId: 'veh-500',
        shiftDate: new Date('2026-09-01T00:00:00Z'),
        startTime: new Date('2026-09-01T08:00:00Z'),
        endTime: new Date('2026-09-01T17:00:00Z'), // Encompasses 14:30
      },
      {
        id: 'shift-02',
        driverId: 'drv-rashid',
        driverName: 'Rashid Khan',
        vehicleId: 'veh-999',
        shiftDate: new Date('2026-09-01T00:00:00Z'),
        startTime: new Date('2026-09-01T08:00:00Z'),
        endTime: new Date('2026-09-01T17:00:00Z'),
      },
    ];

    it('matches an active driver shift temporally with 95% confidence', () => {
      const match = matchFineWithShiftRecords(sampleFine, sampleShifts);

      expect(match.assignedTo).toBe('DRIVER');
      expect(match.driverId).toBe('drv-ahmed');
      expect(match.driverName).toBe('Ahmed Al-Mansoor');
      expect(match.matchConfidence).toBe(95);
      expect(match.matchSource).toBe('EXACT_SHIFT_TIMESTAMP');
      expect(match.shiftId).toBe('shift-01');
    });

    it('routes vehicle defect offenses directly to COMPANY liability with 100% confidence', () => {
      const defectFine = {
        ...sampleFine,
        offenceType: 'EXPIRED_MULKIYA',
      };

      const match = matchFineWithShiftRecords(defectFine, sampleShifts);

      expect(match.assignedTo).toBe('COMPANY');
      expect(match.driverId).toBeNull();
      expect(match.matchConfidence).toBe(100);
      expect(match.matchSource).toBe('COMPANY_DEFECT_OFFENCE');
    });

    it('matches via trip manifest when no explicit shift window is active', () => {
      const sampleTrips = [
        {
          id: 'trip-707',
          driverId: 'drv-tariq',
          driverName: 'Tariq Mahmoud',
          vehicleId: 'veh-500',
          startTime: new Date('2026-09-01T14:00:00Z'),
          endTime: new Date('2026-09-01T15:30:00Z'), // Encompasses 14:30
        },
      ];

      // No shift active for veh-500
      const match = matchFineWithShiftRecords(sampleFine, [], sampleTrips);

      expect(match.assignedTo).toBe('DRIVER');
      expect(match.driverId).toBe('drv-tariq');
      expect(match.matchConfidence).toBe(90);
      expect(match.matchSource).toBe('TRIP_MANIFEST');
      expect(match.tripId).toBe('trip-707');
    });

    it('returns UNMATCHED when vehicle has no recorded shift or trip at violation time', () => {
      const midnightFine = {
        ...sampleFine,
        fineDate: new Date('2026-09-01T23:45:00Z'), // Outside shift-01 (08:00 - 17:00)
      };

      const match = matchFineWithShiftRecords(midnightFine, sampleShifts);

      expect(match.matchConfidence).toBe(80); // Same day exclusive driver duty fallback
      expect(match.matchSource).toBe('DAILY_SHIFT_EXCLUSIVE');
      expect(match.driverId).toBe('drv-ahmed');

      // But if there are multiple drivers on that vehicle that day:
      const multipleShifts = [
        ...sampleShifts,
        {
          id: 'shift-03',
          driverId: 'drv-omar',
          driverName: 'Omar Farooq',
          vehicleId: 'veh-500',
          shiftDate: new Date('2026-09-01T00:00:00Z'),
          startTime: new Date('2026-09-01T18:00:00Z'),
          endTime: new Date('2026-09-01T22:00:00Z'),
        },
      ];

      const ambiguousMatch = matchFineWithShiftRecords(midnightFine, multipleShifts);
      expect(ambiguousMatch.matchConfidence).toBe(0);
      expect(ambiguousMatch.matchSource).toBe('UNMATCHED');
      expect(ambiguousMatch.notes).toContain('Ambiguous');
    });
  });
});
