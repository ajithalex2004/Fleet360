/**
 * Truth-table tests for bus-ops lifecycle state machines.
 *
 * Every from×to pair in each state machine is exercised so a new state
 * or a rules change forces the test author to explicitly declare intent
 * for every combination.
 */
import { describe, it, expect } from 'vitest';
import {
  canTransitionTrip, assertTripTransition, TripTransitionError,
  canTransitionPassenger, assertPassengerTransition, PassengerTransitionError,
  isTripTerminal, isPassengerTerminal,
  allowedTripTransitions, allowedPassengerTransitions,
  type TripScheduleStatus, type TripPassengerStatus,
} from '@/lib/bus-ops/state-machines';

const TRIP_STATES: TripScheduleStatus[] = ['SCHEDULED','DEPARTED','IN_TRANSIT','COMPLETED','CANCELLED'];
const PAX_STATES: TripPassengerStatus[]  = ['WAITLISTED','CONFIRMED','BOARDED','ALIGHTED','ABSENT','NO_SHOW','CANCELLED'];

// (from, to, expected) — declares every allowed transition; anything
// NOT in this list is expected to be rejected.
const TRIP_ALLOWED: Array<[TripScheduleStatus, TripScheduleStatus]> = [
  ['SCHEDULED',  'DEPARTED'],   ['SCHEDULED',  'CANCELLED'],
  ['DEPARTED',   'IN_TRANSIT'], ['DEPARTED',   'COMPLETED'], ['DEPARTED', 'CANCELLED'],
  ['IN_TRANSIT', 'COMPLETED'],  ['IN_TRANSIT', 'CANCELLED'],
];
const PAX_ALLOWED: Array<[TripPassengerStatus, TripPassengerStatus]> = [
  ['WAITLISTED', 'CONFIRMED'], ['WAITLISTED', 'CANCELLED'],
  ['CONFIRMED',  'BOARDED'],   ['CONFIRMED',  'ABSENT'],
  ['CONFIRMED',  'NO_SHOW'],   ['CONFIRMED',  'CANCELLED'],
  ['BOARDED',    'ALIGHTED'],
  // A per-stop miss is not a verdict on the whole trip: a rider who
  // misses their assigned stop can walk to the next one and catch the
  // same bus, at which point the BLE gateway detects their tag.
  ['ABSENT',     'BOARDED'],   ['ABSENT',     'CANCELLED'],
];

describe('trip lifecycle', () => {
  it('canTransitionTrip matches declared allow-list for every from×to', () => {
    const allowSet = new Set(TRIP_ALLOWED.map(([f, t]) => `${f}>${t}`));
    for (const from of TRIP_STATES) {
      for (const to of TRIP_STATES) {
        const expected = from === to || allowSet.has(`${from}>${to}`);
        expect(canTransitionTrip(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it('assertTripTransition throws TripTransitionError on illegal', () => {
    expect(() => assertTripTransition('COMPLETED', 'SCHEDULED')).toThrow(TripTransitionError);
    expect(() => assertTripTransition('ALIGHTED' as never, 'CONFIRMED' as never)).toThrow();
  });

  it('terminal states have no allowed transitions', () => {
    expect(isTripTerminal('COMPLETED')).toBe(true);
    expect(isTripTerminal('CANCELLED')).toBe(true);
    expect(allowedTripTransitions('COMPLETED')).toHaveLength(0);
    expect(allowedTripTransitions('CANCELLED')).toHaveLength(0);
  });

  it('same-state assignment is idempotent (no throw)', () => {
    for (const s of TRIP_STATES) expect(canTransitionTrip(s, s)).toBe(true);
  });

  it('non-terminal states have >=1 allowed transition', () => {
    for (const s of TRIP_STATES) {
      if (isTripTerminal(s)) continue;
      expect(allowedTripTransitions(s).length).toBeGreaterThan(0);
    }
  });
});

describe('passenger lifecycle', () => {
  it('canTransitionPassenger matches declared allow-list for every from×to', () => {
    const allowSet = new Set(PAX_ALLOWED.map(([f, t]) => `${f}>${t}`));
    for (const from of PAX_STATES) {
      for (const to of PAX_STATES) {
        const expected = from === to || allowSet.has(`${from}>${to}`);
        expect(canTransitionPassenger(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it('assertPassengerTransition throws on illegal', () => {
    expect(() => assertPassengerTransition('ALIGHTED', 'CONFIRMED')).toThrow(PassengerTransitionError);
    expect(() => assertPassengerTransition('NO_SHOW',  'BOARDED')).toThrow();
    expect(() => assertPassengerTransition('CANCELLED','CONFIRMED')).toThrow();
  });

  it('WAITLISTED can promote to CONFIRMED (sweep-waitlist path)', () => {
    expect(canTransitionPassenger('WAITLISTED', 'CONFIRMED')).toBe(true);
  });

  it('BOARDED → ALIGHTED is the only completion path (not BOARDED → ABSENT)', () => {
    expect(canTransitionPassenger('BOARDED', 'ALIGHTED')).toBe(true);
    expect(canTransitionPassenger('BOARDED', 'ABSENT')).toBe(false);
    expect(canTransitionPassenger('BOARDED', 'NO_SHOW')).toBe(false);
  });

  it('ABSENT can re-board — the rider caught the bus at a later stop', () => {
    // The operational rule this encodes: bus leaves Stop A without them
    // (ABSENT), they walk to Stop B, BLE detects the tag (BOARDED). While
    // ABSENT was terminal the manifest stayed wrong for the rest of the
    // trip and headcount disagreed with who was physically aboard.
    expect(canTransitionPassenger('ABSENT', 'BOARDED')).toBe(true);
    expect(canTransitionPassenger('ABSENT', 'CANCELLED')).toBe(true);
    expect(isPassengerTerminal('ABSENT')).toBe(false);
  });

  it('ABSENT cannot jump straight to ALIGHTED or NO_SHOW', () => {
    // Re-boarding has to go through BOARDED so a boarding_events row is
    // written for it — otherwise the alight has no matching board and
    // onboard counts derived from the log go negative.
    expect(canTransitionPassenger('ABSENT', 'ALIGHTED')).toBe(false);
    expect(canTransitionPassenger('ABSENT', 'NO_SHOW')).toBe(false);
  });

  it('terminal states enumerated', () => {
    for (const s of ['ALIGHTED','NO_SHOW','CANCELLED'] as TripPassengerStatus[]) {
      expect(isPassengerTerminal(s)).toBe(true);
    }
    // ABSENT is deliberately non-terminal — see above.
    for (const s of ['WAITLISTED','CONFIRMED','BOARDED','ABSENT'] as TripPassengerStatus[]) {
      expect(isPassengerTerminal(s)).toBe(false);
    }
  });
});
