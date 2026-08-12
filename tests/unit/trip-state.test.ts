/**
 * tests/unit/trip-state.test.ts
 *
 * Pins the trip state machine + late/early/on-time classifier.
 * These rules are the contract the driver-app UI + the API both
 * rely on. If any of these change, the driver-app lifecycle and
 * the dispatcher reports both need to be updated in lockstep.
 *
 * Run: npx vitest run tests/unit/trip-state.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateTransition,
  classifyTiming,
  startButtonState,
  timingChipClass,
  type TripStatus,
} from '@/lib/trip-state';

// ──────────────────────────────────────────────────────────────────────
// evaluateTransition
// ──────────────────────────────────────────────────────────────────────

describe('evaluateTransition', () => {
  it('allows SCHEDULED → IN_PROGRESS via START', () => {
    const r = evaluateTransition({ currentStatus: 'SCHEDULED', transition: 'START' });
    expect(r.allowed).toBe(true);
    expect(r.nextStatus).toBe('IN_PROGRESS');
  });

  it('is idempotent for START when already IN_PROGRESS (driver double-tap)', () => {
    const r = evaluateTransition({ currentStatus: 'IN_PROGRESS', transition: 'START' });
    expect(r.allowed).toBe(true);
    expect(r.nextStatus).toBe('IN_PROGRESS');
  });

  it('rejects START on a COMPLETED trip — driver must use RESTART', () => {
    const r = evaluateTransition({ currentStatus: 'COMPLETED', transition: 'START' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/already completed/i);
  });

  it('rejects START on a CANCELLED trip', () => {
    const r = evaluateTransition({ currentStatus: 'CANCELLED', transition: 'START' });
    expect(r.allowed).toBe(false);
  });

  it('allows IN_PROGRESS → COMPLETED via END', () => {
    const r = evaluateTransition({ currentStatus: 'IN_PROGRESS', transition: 'END' });
    expect(r.allowed).toBe(true);
    expect(r.nextStatus).toBe('COMPLETED');
  });

  it('is idempotent for END when already COMPLETED (driver double-tap)', () => {
    const r = evaluateTransition({ currentStatus: 'COMPLETED', transition: 'END' });
    expect(r.allowed).toBe(true);
    expect(r.nextStatus).toBe('COMPLETED');
  });

  it('rejects END on a SCHEDULED trip — must START first', () => {
    const r = evaluateTransition({ currentStatus: 'SCHEDULED', transition: 'END' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/has not started/i);
  });

  it('rejects END on a CANCELLED trip', () => {
    const r = evaluateTransition({ currentStatus: 'CANCELLED', transition: 'END' });
    expect(r.allowed).toBe(false);
  });

  it('CANCEL works from any non-CANCELLED state', () => {
    for (const s of ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] as TripStatus[]) {
      const r = evaluateTransition({ currentStatus: s, transition: 'CANCEL' });
      expect(r.allowed).toBe(true);
      expect(r.nextStatus).toBe('CANCELLED');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// classifyTiming
// ──────────────────────────────────────────────────────────────────────

describe('classifyTiming', () => {
  const sched = '2026-08-06T10:00:00.000Z';

  it('classifies an exactly-on-time start as on_time', () => {
    const r = classifyTiming(sched, sched);
    expect(r.timing).toBe('on_time');
    expect(r.deltaMinutes).toBe(0);
    expect(r.label).toBe('on time');
  });

  it('classifies a 3-min late start as on_time (within 5-min window)', () => {
    const r = classifyTiming(sched, '2026-08-06T10:03:00.000Z');
    expect(r.timing).toBe('on_time');
    expect(r.deltaMinutes).toBe(3);
  });

  it('classifies a 7-min late start as late', () => {
    const r = classifyTiming(sched, '2026-08-06T10:07:00.000Z');
    expect(r.timing).toBe('late');
    expect(r.deltaMinutes).toBe(7);
    expect(r.label).toBe('7 min late');
  });

  it('classifies a 3-min early start as on_time', () => {
    const r = classifyTiming(sched, '2026-08-06T09:57:00.000Z');
    expect(r.timing).toBe('on_time');
    expect(r.deltaMinutes).toBe(-3);
  });

  it('classifies a 10-min early start as early', () => {
    const r = classifyTiming(sched, '2026-08-06T09:50:00.000Z');
    expect(r.timing).toBe('early');
    expect(r.deltaMinutes).toBe(-10);
    expect(r.label).toBe('10 min early');
  });

  it('respects a custom window', () => {
    // Window of 15 min: 12-min late = on_time
    const r = classifyTiming(sched, '2026-08-06T10:12:00.000Z', 15);
    expect(r.timing).toBe('on_time');
  });

  it('returns unknown for invalid dates', () => {
    const r = classifyTiming('not-a-date', 'also-not-a-date');
    expect(r.timing).toBe('unknown');
  });
});

// ──────────────────────────────────────────────────────────────────────
// startButtonState
// ──────────────────────────────────────────────────────────────────────

describe('startButtonState', () => {
  const sched = '2026-08-06T10:00:00.000Z';

  it('SCHEDULED → primary Start trip button, no timing yet', () => {
    const s = startButtonState({
      status: 'SCHEDULED',
      scheduledDeparture: sched,
      actualDeparture: null,
      actualArrival: null,
      durationMinutes: null,
    });
    expect(s.action).toBe('START');
    expect(s.variant).toBe('primary');
    expect(s.label).toMatch(/Start trip/);
    expect(s.timing).toBe('unknown');
  });

  it('IN_PROGRESS with on-time actual → primary End trip + on_time chip', () => {
    const s = startButtonState({
      status: 'IN_PROGRESS',
      scheduledDeparture: sched,
      actualDeparture: '2026-08-06T10:02:00.000Z',
      actualArrival: null,
      durationMinutes: null,
    });
    expect(s.action).toBe('END');
    expect(s.variant).toBe('primary');
    expect(s.timing).toBe('on_time');
    expect(s.helperLine).toMatch(/Started /);
    expect(s.helperLine).toMatch(/on time/);
  });

  it('IN_PROGRESS with 8-min late actual → primary End trip + late chip', () => {
    const s = startButtonState({
      status: 'IN_PROGRESS',
      scheduledDeparture: sched,
      actualDeparture: '2026-08-06T10:08:00.000Z',
      actualArrival: null,
      durationMinutes: null,
    });
    expect(s.action).toBe('END');
    expect(s.timing).toBe('late');
    expect(s.deltaMinutes).toBe(8);
  });

  it('COMPLETED → secondary Completed badge, no action', () => {
    const s = startButtonState({
      status: 'COMPLETED',
      scheduledDeparture: sched,
      actualDeparture: '2026-08-06T10:02:00.000Z',
      actualArrival: '2026-08-06T10:45:00.000Z',
      durationMinutes: 43,
    });
    expect(s.action).toBeNull();
    expect(s.variant).toBe('secondary');
    expect(s.label).toMatch(/Completed/);
    expect(s.helperLine).toMatch(/43 min/);
  });

  it('CANCELLED → disabled, no action', () => {
    const s = startButtonState({
      status: 'CANCELLED',
      scheduledDeparture: sched,
      actualDeparture: null,
      actualArrival: null,
      durationMinutes: null,
    });
    expect(s.action).toBeNull();
    expect(s.variant).toBe('disabled');
  });
});

// ──────────────────────────────────────────────────────────────────────
// timingChipClass
// ──────────────────────────────────────────────────────────────────────

describe('timingChipClass', () => {
  it('late → rose', () => {
    expect(timingChipClass('late')).toMatch(/rose/);
  });
  it('early → sky', () => {
    expect(timingChipClass('early')).toMatch(/sky/);
  });
  it('on_time → emerald', () => {
    expect(timingChipClass('on_time')).toMatch(/emerald/);
  });
  it('unknown → slate', () => {
    expect(timingChipClass('unknown')).toMatch(/slate/);
  });
});
