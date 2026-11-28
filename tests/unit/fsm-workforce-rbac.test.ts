import { describe, expect, it } from 'vitest';
import {
  checkFsmPermission,
  expiredCertificationsOf,
  getCertificationStatus,
  haversineKm,
  isTechnicianAvailableAt,
  normalizeCode,
  scoreTechnicianForAssignment,
  validateShiftWindow,
  validateTechnicianInput,
  type FsmTechnician,
  type FsmTechnicianSkill,
} from '@/lib/service-tickets/workforce';

function makeSkill(overrides: Partial<FsmTechnicianSkill> = {}): FsmTechnicianSkill {
  return {
    id: 'sk-1',
    technicianId: 'tech-1',
    skillCode: 'HVAC',
    skillName: 'HVAC / Chiller Systems',
    proficiencyLevel: 3,
    isCertification: true,
    certificateNumber: 'CERT-101',
    issuingAuthority: 'DCD',
    issuedAt: '2025-01-01',
    expiresAt: '2027-01-01',
    documentUrl: null,
    ...overrides,
  };
}

function makeTech(overrides: Partial<FsmTechnician> = {}): FsmTechnician {
  return {
    id: 'tech-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    employeeCode: 'TECH_001',
    fullName: 'Ahmed Al Mansoori',
    email: 'ahmed@fleet360.ae',
    mobile: '+971501234567',
    photoUrl: null,
    primaryDepartment: 'FM_HARD_SERVICES',
    employmentType: 'INTERNAL',
    contractorPartnerId: null,
    homeBaseAddress: 'Al Quoz Depot',
    homeBaseLat: 25.1375,
    homeBaseLng: 55.2281,
    assignedVehicleId: null,
    hourlyCostRate: 65,
    hourlyBillableRate: 150,
    currency: 'AED',
    maxDailyJobs: 6,
    availabilityStatus: 'AVAILABLE',
    isActive: true,
    skills: [makeSkill()],
    territories: [
      { territoryId: 'terr-dxb', territoryCode: 'DXB_CENTRAL', territoryName: 'Dubai Central', isPrimary: true },
    ],
    location: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('FSM Workforce — Certifications & Expiry', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('classifies NO_EXPIRY when expiresAt is null or invalid', () => {
    expect(getCertificationStatus({ isCertification: true, expiresAt: null }, now)).toEqual({
      status: 'NO_EXPIRY',
      daysRemaining: null,
    });
    expect(getCertificationStatus({ isCertification: true, expiresAt: 'not-a-date' }, now)).toEqual({
      status: 'NO_EXPIRY',
      daysRemaining: null,
    });
  });

  it('classifies EXPIRED, EXPIRING_SOON, and VALID accurately', () => {
    const expired = getCertificationStatus({ isCertification: true, expiresAt: '2026-06-01' }, now);
    expect(expired.status).toBe('EXPIRED');
    expect(expired.daysRemaining).toBeLessThan(0);

    const soon = getCertificationStatus({ isCertification: true, expiresAt: '2026-06-30' }, now);
    expect(soon.status).toBe('EXPIRING_SOON');
    expect(soon.daysRemaining).toBeGreaterThanOrEqual(0);
    expect(soon.daysRemaining).toBeLessThanOrEqual(30);

    const valid = getCertificationStatus({ isCertification: true, expiresAt: '2026-12-31' }, now);
    expect(valid.status).toBe('VALID');
    expect(valid.daysRemaining).toBeGreaterThan(30);
  });

  it('filters expiredCertificationsOf to certified expired skills only', () => {
    const skills = [
      makeSkill({ skillCode: 'FIRE_SAFETY', isCertification: true, expiresAt: '2026-05-01' }),
      makeSkill({ skillCode: 'HVAC', isCertification: false, expiresAt: '2026-05-01' }),
      makeSkill({ skillCode: 'PLUMBING', isCertification: true, expiresAt: '2027-05-01' }),
    ];
    const expired = expiredCertificationsOf(skills, now);
    expect(expired.map((s) => s.skillCode)).toEqual(['FIRE_SAFETY']);
  });
});

describe('FSM Workforce — Availability & Shifts', () => {
  const at = new Date('2026-06-15T10:00:00Z');

  it('blocks inactive technicians and ON_LEAVE status', () => {
    expect(isTechnicianAvailableAt({ isActive: false, availabilityStatus: 'AVAILABLE' }, [], at)).toEqual({
      available: false,
      reason: 'Inactive technician',
    });
    expect(isTechnicianAvailableAt({ isActive: true, availabilityStatus: 'ON_LEAVE' }, [], at)).toEqual({
      available: false,
      reason: 'Marked on leave',
    });
  });

  it('blocks technicians during overlapping LEAVE or BLOCKED shift windows', () => {
    const leaveShifts = [
      { entryType: 'LEAVE' as const, startsAt: '2026-06-15T08:00:00Z', endsAt: '2026-06-15T18:00:00Z' },
    ];
    expect(isTechnicianAvailableAt({ isActive: true, availabilityStatus: 'AVAILABLE' }, leaveShifts, at)).toEqual({
      available: false,
      reason: 'Scheduled leave',
    });

    const blockedShifts = [
      { entryType: 'BLOCKED' as const, startsAt: '2026-06-15T09:00:00Z', endsAt: '2026-06-15T12:00:00Z' },
    ];
    expect(isTechnicianAvailableAt({ isActive: true, availabilityStatus: 'AVAILABLE' }, blockedShifts, at)).toEqual({
      available: false,
      reason: 'Blocked shift window',
    });
  });

  it('allows technicians on regular SHIFT or outside leave windows', () => {
    const shifts = [
      { entryType: 'SHIFT' as const, startsAt: '2026-06-15T06:00:00Z', endsAt: '2026-06-15T16:00:00Z' },
      { entryType: 'LEAVE' as const, startsAt: '2026-06-20T00:00:00Z', endsAt: '2026-06-22T00:00:00Z' },
    ];
    expect(isTechnicianAvailableAt({ isActive: true, availabilityStatus: 'AVAILABLE' }, shifts, at)).toEqual({
      available: true,
    });
  });
});

describe('FSM Workforce — Best-Fit Assignment Scoring', () => {
  const now = new Date('2026-06-15T10:00:00Z');

  it('computes haversine distance accurately', () => {
    expect(haversineKm(25.2048, 55.2708, 25.2048, 55.2708)).toBe(0);
    // Downtown Dubai to Dubai Marina (~19 km)
    const d = haversineKm(25.1972, 55.2744, 25.0805, 55.1403);
    expect(d).toBeGreaterThan(17);
    expect(d).toBeLessThan(21);
  });

  it('gives near-perfect score to available, skilled, local primary-territory tech', () => {
    const tech = makeTech({
      skills: [makeSkill({ skillCode: 'HVAC', proficiencyLevel: 4, expiresAt: '2027-06-01' })],
      location: { latitude: 25.14, longitude: 55.23, accuracyM: 10, batteryPct: 90, recordedAt: now.toISOString() },
    });
    const rec = scoreTechnicianForAssignment({
      tech,
      department: 'FM_HARD_SERVICES',
      territoryId: 'terr-dxb',
      requiredSkills: ['HVAC'],
      siteLat: 25.145,
      siteLng: 55.232,
      now,
    });
    expect(rec.eligible).toBe(true);
    expect(rec.score).toBe(100);
    expect(rec.distanceKm).toBeLessThan(2);
    expect(rec.badges).toContain('Available now');
    expect(rec.badges).toContain('All required skills');
    expect(rec.badges).toContain('Matching dept');
    expect(rec.badges).toContain('Primary territory');
    expect(rec.warnings).toHaveLength(0);
  });

  it('marks technician ineligible when a required certification is expired', () => {
    const tech = makeTech({
      skills: [makeSkill({ skillCode: 'FIRE_SAFETY', skillName: 'Fire Safety', isCertification: true, expiresAt: '2026-01-01' })],
    });
    const rec = scoreTechnicianForAssignment({
      tech,
      requiredSkills: ['FIRE_SAFETY'],
      now,
    });
    expect(rec.eligible).toBe(false);
    expect(rec.warnings.some((w) => w.startsWith('Required cert expired'))).toBe(true);
  });

  it('marks technician ineligible during scheduled leave and ranks available tech higher', () => {
    const onLeaveTech = makeTech({ id: 't-leave', availabilityStatus: 'ON_LEAVE' });
    const availTech = makeTech({ id: 't-avail', availabilityStatus: 'AVAILABLE' });
    const rLeave = scoreTechnicianForAssignment({ tech: onLeaveTech, department: 'FM_HARD_SERVICES', now });
    const rAvail = scoreTechnicianForAssignment({ tech: availTech, department: 'FM_HARD_SERVICES', now });

    expect(rLeave.eligible).toBe(false);
    expect(rAvail.eligible).toBe(true);
    expect(rAvail.score).toBeGreaterThan(rLeave.score);
  });

  it('falls back to homeBase coordinates when live GPS location is absent', () => {
    const tech = makeTech({ location: null, homeBaseLat: 25.1375, homeBaseLng: 55.2281 });
    const rec = scoreTechnicianForAssignment({
      tech,
      siteLat: 25.1375,
      siteLng: 55.2281,
      now,
    });
    expect(rec.distanceKm).toBe(0);
    expect(rec.badges).toContain('0 km away');
  });
});

describe('FSM RBAC — Granular Role & Territory/Team Scoping', () => {
  it('always allows SUPER_ADMIN and TENANT_ADMIN', () => {
    expect(checkFsmPermission({ platformRole: 'SUPER_ADMIN', fsmScopes: [], action: 'rbac:manage' }).allowed).toBe(true);
    expect(checkFsmPermission({ platformRole: 'TENANT_ADMIN', fsmScopes: [], action: 'workforce:write' }).allowed).toBe(true);
  });

  it('enforces territory scoping for FSM_DISPATCHER', () => {
    const scopes = [{ fsmRole: 'FSM_DISPATCHER' as const, territoryId: 'terr-dxb', teamId: null }];
    expect(
      checkFsmPermission({
        platformRole: 'USER',
        fsmScopes: scopes,
        action: 'dispatch:assign',
        targetTerritoryId: 'terr-dxb',
      }).allowed,
    ).toBe(true);

    const wrongTerr = checkFsmPermission({
      platformRole: 'USER',
      fsmScopes: scopes,
      action: 'dispatch:assign',
      targetTerritoryId: 'terr-auh',
    });
    expect(wrongTerr.allowed).toBe(false);

    // Dispatcher cannot manage RBAC or write workforce roster
    expect(
      checkFsmPermission({
        platformRole: 'USER',
        fsmScopes: scopes,
        action: 'workforce:write',
        targetTerritoryId: 'terr-dxb',
      }).allowed,
    ).toBe(false);
  });

  it('enforces team scoping for FSM_TEAM_LEAD', () => {
    const scopes = [{ fsmRole: 'FSM_TEAM_LEAD' as const, territoryId: null, teamId: 'team-hvac-a' }];
    expect(
      checkFsmPermission({
        platformRole: 'USER',
        fsmScopes: scopes,
        action: 'tickets:escalate',
        targetTeamId: 'team-hvac-a',
      }).allowed,
    ).toBe(true);
    expect(
      checkFsmPermission({
        platformRole: 'USER',
        fsmScopes: scopes,
        action: 'tickets:escalate',
        targetTeamId: 'team-plumb-b',
      }).allowed,
    ).toBe(false);
  });

  it('grants commercial contract management only to FSM_COMMERCIAL_MANAGER / FSM_ADMIN', () => {
    const commercial = [{ fsmRole: 'FSM_COMMERCIAL_MANAGER' as const, territoryId: null, teamId: null }];
    expect(checkFsmPermission({ platformRole: 'USER', fsmScopes: commercial, action: 'contracts:manage' }).allowed).toBe(true);
    expect(checkFsmPermission({ platformRole: 'USER', fsmScopes: commercial, action: 'dispatch:assign' }).allowed).toBe(false);

    const viewer = [{ fsmRole: 'FSM_VIEWER' as const, territoryId: null, teamId: null }];
    expect(checkFsmPermission({ platformRole: 'USER', fsmScopes: viewer, action: 'workforce:read' }).allowed).toBe(true);
    expect(checkFsmPermission({ platformRole: 'USER', fsmScopes: viewer, action: 'contracts:manage' }).allowed).toBe(false);
  });

  it('falls back cleanly for legacy platform operations roles when no FSM scopes exist', () => {
    expect(checkFsmPermission({ platformRole: 'OPERATIONS_MANAGER', fsmScopes: [], action: 'dispatch:assign' }).allowed).toBe(true);
    expect(checkFsmPermission({ platformRole: 'OPERATIONS_MANAGER', fsmScopes: [], action: 'workforce:write' }).allowed).toBe(true);
    expect(checkFsmPermission({ platformRole: 'OPERATIONS_MANAGER', fsmScopes: [], action: 'rbac:manage' }).allowed).toBe(false);
  });

  it('denies mutations for unprivileged users without scopes while allowing read', () => {
    expect(checkFsmPermission({ platformRole: 'DRIVER', fsmScopes: [], action: 'workforce:read' }).allowed).toBe(true);
    expect(checkFsmPermission({ platformRole: 'DRIVER', fsmScopes: [], action: 'dispatch:assign' }).allowed).toBe(false);
  });
});

describe('FSM Workforce — Normalization & Validation', () => {
  it('normalizes codes cleanly', () => {
    expect(normalizeCode('  dxb - north zone! ')).toBe('DXB_-_NORTH_ZONE');
    expect(normalizeCode('___hvac squad 1___')).toBe('HVAC_SQUAD_1');
    expect(normalizeCode('A'.repeat(60), 12)).toBe('A'.repeat(12));
  });

  it('validates technician inputs', () => {
    expect(validateTechnicianInput({ fullName: '', email: 'a@b.com' })).toMatch(/full name is required/i);
    expect(validateTechnicianInput({ fullName: 'A'.repeat(121), email: 'a@b.com' })).toMatch(/120 characters/i);
    expect(validateTechnicianInput({ fullName: 'Ali', email: 'bad-email' })).toMatch(/valid email/i);
    expect(validateTechnicianInput({ fullName: 'Ali', email: 'ali@x.ae', employeeCode: '!!!' })).toMatch(/letters or digits/i);
    expect(validateTechnicianInput({ fullName: 'Ali', email: 'ali@x.ae', maxDailyJobs: 0 })).toMatch(/between 1 and 50/i);
    expect(validateTechnicianInput({ fullName: 'Ali', email: 'ali@x.ae', maxDailyJobs: 2.5 })).toMatch(/between 1 and 50/i);
    expect(validateTechnicianInput({ fullName: 'Ali', email: 'ali@x.ae', employeeCode: 'TECH-09', maxDailyJobs: 8 })).toBeNull();
  });

  it('validates shift windows', () => {
    expect(validateShiftWindow('bad', '2026-06-15T16:00:00Z')).toMatch(/valid start and end/i);
    expect(validateShiftWindow('2026-06-15T16:00:00Z', '2026-06-15T08:00:00Z')).toMatch(/after start/i);
    expect(validateShiftWindow('2026-06-15T08:00:00Z', '2026-06-15T08:00:00Z')).toMatch(/after start/i);
    expect(validateShiftWindow('2026-06-15T08:00:00Z', '2026-06-15T16:00:00Z')).toBeNull();
  });
});
