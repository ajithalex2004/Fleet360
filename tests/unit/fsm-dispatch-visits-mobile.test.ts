import { describe, expect, it } from 'vitest';
import {
  STARTER_CHECKLIST_TEMPLATES,
  canTransitionVisitStatus,
  computeElapsedMinutes,
  detectVisitConflicts,
  evaluateChecklistCompletion,
  evaluateGeofenceCheckIn,
  suggestNextAvailableSlot,
  syncedTechAvailabilityForVisit,
  syncedTicketStatusForVisit,
} from '@/lib/service-tickets/dispatch';

describe('FSM Dispatch — Visit State Machine & Sync Mappers', () => {
  it('enforces valid field visit state transitions', () => {
    expect(canTransitionVisitStatus('SCHEDULED', 'DISPATCHED')).toBe(true);
    expect(canTransitionVisitStatus('DISPATCHED', 'EN_ROUTE')).toBe(true);
    expect(canTransitionVisitStatus('EN_ROUTE', 'ON_SITE')).toBe(true);
    expect(canTransitionVisitStatus('ON_SITE', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionVisitStatus('IN_PROGRESS', 'PAUSED')).toBe(true);
    expect(canTransitionVisitStatus('PAUSED', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionVisitStatus('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(canTransitionVisitStatus('IN_PROGRESS', 'INCOMPLETE')).toBe(true);

    // Invalid jump straight from SCHEDULED to COMPLETED without arrival/work
    expect(canTransitionVisitStatus('SCHEDULED', 'COMPLETED')).toBe(false);
    expect(canTransitionVisitStatus('CANCELLED', 'COMPLETED')).toBe(false);
    // Supervisor reopen of completed visit allowed
    expect(canTransitionVisitStatus('COMPLETED', 'IN_PROGRESS')).toBe(true);
  });

  it('maps visit status to synchronized ticket status and technician availability', () => {
    expect(syncedTicketStatusForVisit('DISPATCHED')).toBe('Assigned');
    expect(syncedTicketStatusForVisit('EN_ROUTE')).toBe('In Progress');
    expect(syncedTicketStatusForVisit('ON_SITE')).toBe('In Progress');
    expect(syncedTicketStatusForVisit('COMPLETED')).toBe('Resolved');
    expect(syncedTicketStatusForVisit('CANCELLED')).toBeNull();

    expect(syncedTechAvailabilityForVisit('EN_ROUTE')).toBe('EN_ROUTE');
    expect(syncedTechAvailabilityForVisit('ON_SITE')).toBe('ON_JOB');
    expect(syncedTechAvailabilityForVisit('PAUSED')).toBe('ON_BREAK');
    expect(syncedTechAvailabilityForVisit('COMPLETED')).toBe('AVAILABLE');
  });
});

describe('FSM Dispatch — Geofence Check-In Evaluation', () => {
  it('passes when site or tech coordinates are missing', () => {
    const r = evaluateGeofenceCheckIn({ techLat: 25.2, techLng: 55.27, siteLat: null, siteLng: null });
    expect(r.withinGeofence).toBe(true);
    expect(r.requiresOverride).toBe(false);
    expect(r.distanceMeters).toBeNull();
  });

  it('passes inside 250m radius and flags override outside 250m', () => {
    // ~111m north
    const near = evaluateGeofenceCheckIn({
      techLat: 25.2058,
      techLng: 55.2708,
      siteLat: 25.2048,
      siteLng: 55.2708,
    });
    expect(near.withinGeofence).toBe(true);
    expect(near.requiresOverride).toBe(false);
    expect(near.distanceMeters).toBeGreaterThan(80);
    expect(near.distanceMeters).toBeLessThan(150);

    // ~1.1 km away
    const far = evaluateGeofenceCheckIn({
      techLat: 25.2148,
      techLng: 55.2708,
      siteLat: 25.2048,
      siteLng: 55.2708,
    });
    expect(far.withinGeofence).toBe(false);
    expect(far.requiresOverride).toBe(true);
    expect(far.distanceMeters).toBeGreaterThan(900);
  });
});

describe('FSM Dispatch — Conflict Detection & Smart Slot Suggestion', () => {
  const existingVisits = [
    {
      id: 'v-1',
      status: 'DISPATCHED' as const,
      ticketReadableId: 'FSM-SR-001',
      ticketTitle: 'Chiller Repair',
      scheduledStartAt: '2026-12-06T08:00:00.000Z',
      scheduledEndAt: '2026-12-06T10:00:00.000Z',
      crew: [{ technicianId: 'tech-1' }],
    },
    {
      id: 'v-cancelled',
      status: 'CANCELLED' as const,
      ticketReadableId: 'FSM-SR-002',
      ticketTitle: 'Cancelled Visit',
      scheduledStartAt: '2026-12-06T10:00:00.000Z',
      scheduledEndAt: '2026-12-06T11:00:00.000Z',
      crew: [{ technicianId: 'tech-1' }],
    },
  ];

  it('detects overlapping active visits and ignores cancelled visits or self', () => {
    const overlap = detectVisitConflicts({
      technicianIds: ['tech-1'],
      startAt: '2026-12-06T09:30:00.000Z',
      endAt: '2026-12-06T10:30:00.000Z',
      existingVisits,
    });
    expect(overlap).toHaveLength(1);
    expect(overlap[0].kind).toBe('VISIT_OVERLAP');
    expect(overlap[0].conflictingId).toBe('v-1');

    // Excluding self (rescheduling v-1) should have no conflict
    const selfEdit = detectVisitConflicts({
      technicianIds: ['tech-1'],
      startAt: '2026-12-06T09:30:00.000Z',
      endAt: '2026-12-06T10:30:00.000Z',
      excludeVisitId: 'v-1',
      existingVisits,
    });
    expect(selfEdit).toHaveLength(0);

    // Adjacent back-to-back slot touching cancelled visit is conflict-free
    const clean = detectVisitConflicts({
      technicianIds: ['tech-1'],
      startAt: '2026-12-06T10:00:00.000Z',
      endAt: '2026-12-06T11:00:00.000Z',
      existingVisits,
    });
    expect(clean).toHaveLength(0);
  });

  it('detects scheduled LEAVE / BLOCKED shift conflicts', () => {
    const shiftsByTech = new Map([
      [
        'tech-1',
        [
          {
            id: 'sh-leave',
            entryType: 'LEAVE' as const,
            startsAt: '2026-12-06T12:00:00.000Z',
            endsAt: '2026-12-06T16:00:00.000Z',
            notes: 'Annual leave',
          },
        ],
      ],
    ]);
    const conflicts = detectVisitConflicts({
      technicianIds: ['tech-1'],
      startAt: '2026-12-06T13:00:00.000Z',
      endAt: '2026-12-06T14:00:00.000Z',
      existingVisits,
      shiftsByTech,
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe('LEAVE_BLOCK');
  });

  it('suggests the earliest conflict-free slot skipping visits and leave blocks', () => {
    const slot = suggestNextAvailableSlot({
      dayIso: '2026-12-06',
      technicianId: 'tech-1',
      durationMins: 90,
      existingVisits,
      shifts: [
        {
          id: 'sh-block',
          entryType: 'BLOCKED',
          startsAt: '2026-12-06T10:00:00.000Z',
          endsAt: '2026-12-06T11:30:00.000Z',
          notes: 'Safety briefing',
        },
      ],
      workdayStartHour: 8,
      workdayEndHour: 18,
      tzOffsetMinutes: 0,
    });
    expect(slot).toEqual({
      startAt: '2026-12-06T11:30:00.000Z',
      endAt: '2026-12-06T13:00:00.000Z',
    });
  });
});

describe('FSM Execution — Digital Checklists & Elapsed Time', () => {
  it('evaluates IN_PROGRESS, PASSED, and FAILED checklist states accurately', () => {
    const partial = evaluateChecklistCompletion([
      { itemId: 'ppe', label: 'PPE worn', type: 'BOOL', required: true, failOnFalse: true, value: true },
      { itemId: 'temp', label: 'Supply temp', type: 'NUMBER', required: true, value: null },
    ]);
    expect(partial.status).toBe('IN_PROGRESS');
    expect(partial.missingRequired).toEqual(['Supply temp']);

    const passed = evaluateChecklistCompletion([
      { itemId: 'ppe', label: 'PPE worn', type: 'BOOL', required: true, failOnFalse: true, value: true },
      { itemId: 'temp', label: 'Supply temp', type: 'NUMBER', required: true, value: 11.5 },
    ]);
    expect(passed.status).toBe('PASSED');
    expect(passed.answeredCount).toBe(2);

    const failed = evaluateChecklistCompletion([
      { itemId: 'ppe', label: 'PPE worn', type: 'BOOL', required: true, failOnFalse: true, value: false },
      { itemId: 'temp', label: 'Supply temp', type: 'NUMBER', required: true, value: 11.5 },
    ]);
    expect(failed.status).toBe('FAILED');
    expect(failed.failedItems).toEqual(['PPE worn']);
  });

  it('computes elapsed minutes safely and exposes starter FM checklist templates', () => {
    expect(computeElapsedMinutes('2026-12-06T08:00:00Z', '2026-12-06T09:15:00Z')).toBe(75);
    expect(computeElapsedMinutes('2026-12-06T10:00:00Z', '2026-12-06T09:00:00Z')).toBe(0);
    expect(computeElapsedMinutes(null)).toBe(0);
    expect(STARTER_CHECKLIST_TEMPLATES.length).toBeGreaterThanOrEqual(4);
  });
});
