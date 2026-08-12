/**
 * tests/unit/driver-reports.test.ts
 *
 * Pins the driver-reports state machine and the type catalogue.
 * The driver app's "File a report" form and the dispatcher's
 * dashboard both depend on this contract.
 *
 * Run: npx vitest run tests/unit/driver-reports.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateReportTransition,
  isRequestType,
  isIncidentType,
  isSeverity,
  isReportStatus,
  isRequestSubtype,
  isMaintenanceSubtype,
  isRenewalSubtype,
  isWashingSubtype,
  defaultSeverity,
  getRequestSubtypeCatalogue,
  getSubtypeMeta,
  REQUEST_TYPES,
  INCIDENT_TYPES,
  INCIDENT_SEVERITIES,
  REPORT_STATUSES,
  MAINTENANCE_SUBTYPES,
  RENEWAL_SUBTYPES,
  WASHING_SUBTYPES,
  getTypeMeta,
  type ReportStatus,
} from '@/lib/driver-reports';

describe('Type catalogue', () => {
  it('REQUEST_TYPES is the 3 request kinds', () => {
    expect(REQUEST_TYPES).toEqual(['MAINTENANCE', 'RENEWAL', 'WASHING']);
  });
  it('INCIDENT_TYPES is the 4 incident kinds', () => {
    expect(INCIDENT_TYPES).toEqual(['ACCIDENT', 'BREAKDOWN', 'TRAFFIC_DELAY', 'PASSENGER_COMPLAINT']);
  });
  it('INCIDENT_SEVERITIES is the 4 severities', () => {
    expect(INCIDENT_SEVERITIES).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  });
  it('REPORT_STATUSES is the 5 lifecycle states', () => {
    expect(REPORT_STATUSES).toEqual(['OPEN', 'ACK', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED']);
  });
});

describe('Type guards', () => {
  it('isRequestType accepts known requests and rejects incidents', () => {
    expect(isRequestType('MAINTENANCE')).toBe(true);
    expect(isRequestType('WASHING')).toBe(true);
    expect(isRequestType('ACCIDENT')).toBe(false);
    expect(isRequestType('banana')).toBe(false);
  });
  it('isIncidentType accepts known incidents and rejects requests', () => {
    expect(isIncidentType('ACCIDENT')).toBe(true);
    expect(isIncidentType('TRAFFIC_DELAY')).toBe(true);
    expect(isIncidentType('MAINTENANCE')).toBe(false);
  });
  it('isSeverity only accepts the 4 enum values', () => {
    expect(isSeverity('LOW')).toBe(true);
    expect(isSeverity('CRITICAL')).toBe(true);
    expect(isSeverity('MEDIUM-HIGH')).toBe(false);
  });
  it('isReportStatus only accepts the 5 lifecycle states', () => {
    for (const s of ['OPEN', 'ACK', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED']) {
      expect(isReportStatus(s)).toBe(true);
    }
    expect(isReportStatus('PENDING')).toBe(false);
  });
});

describe('getTypeMeta', () => {
  it('returns metadata for request types', () => {
    const m = getTypeMeta('REQUEST', 'MAINTENANCE');
    expect(m).not.toBeNull();
    expect(m!.emoji).toBe('🔧');
    expect(m!.label).toBe('Maintenance');
  });
  it('returns metadata for incident types', () => {
    const m = getTypeMeta('INCIDENT', 'BREAKDOWN');
    expect(m).not.toBeNull();
    expect(m!.emoji).toBe('⚙️');
  });
  it('returns null for a type that does not match the kind', () => {
    expect(getTypeMeta('REQUEST', 'ACCIDENT')).toBeNull();
    expect(getTypeMeta('INCIDENT', 'MAINTENANCE')).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
// State machine
// ──────────────────────────────────────────────────────────────────────

describe('evaluateReportTransition — ACK action', () => {
  it('OPEN → ACK is allowed', () => {
    expect(evaluateReportTransition({ currentStatus: 'OPEN', action: 'ACK' }).allowed).toBe(true);
  });
  it('ACK → ACK is idempotent (no-op, allowed)', () => {
    const r = evaluateReportTransition({ currentStatus: 'ACK', action: 'ACK' });
    expect(r.allowed).toBe(true);
    expect(r.nextStatus).toBe('ACK');
  });
  it('IN_PROGRESS cannot be re-ACKed (409)', () => {
    const r = evaluateReportTransition({ currentStatus: 'IN_PROGRESS', action: 'ACK' });
    expect(r.allowed).toBe(false);
  });
  it('RESOLVED cannot be re-ACKed (409)', () => {
    const r = evaluateReportTransition({ currentStatus: 'RESOLVED', action: 'ACK' });
    expect(r.allowed).toBe(false);
  });
  it('CANCELLED cannot be re-ACKed (409)', () => {
    const r = evaluateReportTransition({ currentStatus: 'CANCELLED', action: 'ACK' });
    expect(r.allowed).toBe(false);
  });
});

describe('evaluateReportTransition — PROGRESS action', () => {
  it('ACK → IN_PROGRESS is allowed', () => {
    expect(evaluateReportTransition({ currentStatus: 'ACK', action: 'PROGRESS' }).allowed).toBe(true);
  });
  it('OPEN → IN_PROGRESS is rejected (must ACK first)', () => {
    const r = evaluateReportTransition({ currentStatus: 'OPEN', action: 'PROGRESS' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Acknowledge/);
  });
  it('RESOLVED → IN_PROGRESS is rejected', () => {
    expect(evaluateReportTransition({ currentStatus: 'RESOLVED', action: 'PROGRESS' }).allowed).toBe(false);
  });
});

describe('evaluateReportTransition — RESOLVE action', () => {
  it('IN_PROGRESS → RESOLVED is allowed', () => {
    expect(evaluateReportTransition({ currentStatus: 'IN_PROGRESS', action: 'RESOLVE' }).allowed).toBe(true);
  });
  it('RESOLVED → RESOLVED is idempotent', () => {
    const r = evaluateReportTransition({ currentStatus: 'RESOLVED', action: 'RESOLVE' });
    expect(r.allowed).toBe(true);
    expect(r.nextStatus).toBe('RESOLVED');
  });
  it('OPEN → RESOLVED is rejected (must ACK first)', () => {
    const r = evaluateReportTransition({ currentStatus: 'OPEN', action: 'RESOLVE' });
    expect(r.allowed).toBe(false);
  });
  it('ACK → RESOLVED is rejected (must progress first)', () => {
    const r = evaluateReportTransition({ currentStatus: 'ACK', action: 'RESOLVE' });
    expect(r.allowed).toBe(false);
  });
});

describe('evaluateReportTransition — CANCEL action (driver withdraws)', () => {
  it('OPEN → CANCELLED is allowed (the only valid driver cancel path)', () => {
    const r = evaluateReportTransition({ currentStatus: 'OPEN', action: 'CANCEL' });
    expect(r.allowed).toBe(true);
    expect(r.nextStatus).toBe('CANCELLED');
  });
  it('CANCELLED → CANCELLED is idempotent', () => {
    const r = evaluateReportTransition({ currentStatus: 'CANCELLED', action: 'CANCEL' });
    expect(r.allowed).toBe(true);
  });
  it('ACK → CANCELLED is rejected (driver should contact dispatcher)', () => {
    const r = evaluateReportTransition({ currentStatus: 'ACK', action: 'CANCEL' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/chat/);
  });
  it('IN_PROGRESS → CANCELLED is rejected', () => {
    const r = evaluateReportTransition({ currentStatus: 'IN_PROGRESS', action: 'CANCEL' });
    expect(r.allowed).toBe(false);
  });
  it('RESOLVED → CANCELLED is rejected', () => {
    const r = evaluateReportTransition({ currentStatus: 'RESOLVED', action: 'CANCEL' });
    expect(r.allowed).toBe(false);
  });
});

describe('evaluateReportTransition — full happy path', () => {
  it('OPEN → ACK → IN_PROGRESS → RESOLVED', () => {
    let s: ReportStatus = 'OPEN';
    expect(evaluateReportTransition({ currentStatus: s, action: 'ACK' }).nextStatus).toBe('ACK');
    s = 'ACK';
    expect(evaluateReportTransition({ currentStatus: s, action: 'PROGRESS' }).nextStatus).toBe('IN_PROGRESS');
    s = 'IN_PROGRESS';
    expect(evaluateReportTransition({ currentStatus: s, action: 'RESOLVE' }).nextStatus).toBe('RESOLVED');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Sub-type catalogue + default severity (added in the v2 driver-reports)
// ──────────────────────────────────────────────────────────────────────

describe('Sub-type catalogues', () => {
  it('MAINTENANCE has 4 sub-types', () => {
    expect(MAINTENANCE_SUBTYPES).toEqual([
      'PREVENTIVE',
      'CORRECTIVE',
      'SCHEDULED',
      'BREAKDOWN_ACCIDENT',
    ]);
  });
  it('RENEWAL has 4 sub-types', () => {
    expect(RENEWAL_SUBTYPES).toEqual([
      'INSURANCE',
      'REGISTRATION',
      'LICENSE',
      'PERMITS_CERTIFICATIONS',
    ]);
  });
  it('WASHING has 4 sub-types', () => {
    expect(WASHING_SUBTYPES).toEqual(['BODY_WASH', 'FULL_WASH', 'INTERIOR', 'EXTERIOR']);
  });
});

describe('Sub-type guards', () => {
  it('isMaintenanceSubtype accepts known and rejects others', () => {
    expect(isMaintenanceSubtype('PREVENTIVE')).toBe(true);
    expect(isMaintenanceSubtype('CORRECTIVE')).toBe(true);
    expect(isMaintenanceSubtype('INSURANCE')).toBe(false);
    expect(isMaintenanceSubtype('BANANA')).toBe(false);
  });
  it('isRenewalSubtype accepts known and rejects others', () => {
    expect(isRenewalSubtype('INSURANCE')).toBe(true);
    expect(isRenewalSubtype('PERMITS_CERTIFICATIONS')).toBe(true);
    expect(isRenewalSubtype('PREVENTIVE')).toBe(false);
  });
  it('isWashingSubtype accepts known and rejects others', () => {
    expect(isWashingSubtype('FULL_WASH')).toBe(true);
    expect(isWashingSubtype('INSURANCE')).toBe(false);
  });
  it('isRequestSubtype is the union of the three', () => {
    expect(isRequestSubtype('PREVENTIVE')).toBe(true);
    expect(isRequestSubtype('INSURANCE')).toBe(true);
    expect(isRequestSubtype('FULL_WASH')).toBe(true);
    expect(isRequestSubtype('ACCIDENT')).toBe(false);
    expect(isRequestSubtype('LOW')).toBe(false);
  });
});

describe('getRequestSubtypeCatalogue', () => {
  it('returns MAINTENANCE_SUBTYPES for MAINTENANCE', () => {
    expect(getRequestSubtypeCatalogue('MAINTENANCE')).toEqual(MAINTENANCE_SUBTYPES);
  });
  it('returns RENEWAL_SUBTYPES for RENEWAL', () => {
    expect(getRequestSubtypeCatalogue('RENEWAL')).toEqual(RENEWAL_SUBTYPES);
  });
  it('returns WASHING_SUBTYPES for WASHING', () => {
    expect(getRequestSubtypeCatalogue('WASHING')).toEqual(WASHING_SUBTYPES);
  });
  it('returns null for incident types', () => {
    expect(getRequestSubtypeCatalogue('ACCIDENT')).toBeNull();
    expect(getRequestSubtypeCatalogue('BREAKDOWN')).toBeNull();
  });
  it('every returned subtype is a known request subtype', () => {
    for (const t of REQUEST_TYPES) {
      const catalogue = getRequestSubtypeCatalogue(t);
      if (!catalogue) continue;
      for (const s of catalogue) {
        expect(isRequestSubtype(s)).toBe(true);
      }
    }
  });
});

describe('getSubtypeMeta', () => {
  it('returns UI meta for a known maintenance subtype', () => {
    const m = getSubtypeMeta('PREVENTIVE');
    expect(m).toEqual({
      emoji: '🧰',
      label: 'Preventive',
      hint: expect.stringContaining('Routine') as unknown as string,
    });
  });
  it('returns UI meta for a known renewal subtype', () => {
    const m = getSubtypeMeta('INSURANCE');
    expect(m?.label).toBe('Insurance');
  });
  it('returns UI meta for a known washing subtype', () => {
    const m = getSubtypeMeta('FULL_WASH');
    expect(m?.label).toBe('Full wash');
  });
  it('returns null for unknown subtype', () => {
    expect(getSubtypeMeta('BANANA')).toBeNull();
    expect(getSubtypeMeta('ACCIDENT')).toBeNull(); // incident types are not sub-types
  });
});

describe('defaultSeverity', () => {
  it('ACCIDENT defaults to HIGH', () => {
    expect(defaultSeverity('ACCIDENT')).toBe('HIGH');
  });
  it('BREAKDOWN defaults to HIGH', () => {
    expect(defaultSeverity('BREAKDOWN')).toBe('HIGH');
  });
  it('TRAFFIC_DELAY defaults to LOW', () => {
    expect(defaultSeverity('TRAFFIC_DELAY')).toBe('LOW');
  });
  it('PASSENGER_COMPLAINT defaults to LOW', () => {
    expect(defaultSeverity('PASSENGER_COMPLAINT')).toBe('LOW');
  });
  it('returns null for request types or unknown', () => {
    expect(defaultSeverity('MAINTENANCE')).toBeNull();
    expect(defaultSeverity('BANANA')).toBeNull();
    expect(defaultSeverity('')).toBeNull();
  });
  it('every incident type has a non-null default (so the form never has no severity)', () => {
    for (const t of INCIDENT_TYPES) {
      expect(defaultSeverity(t)).not.toBeNull();
      expect(isSeverity(defaultSeverity(t)!)).toBe(true);
    }
  });
});
