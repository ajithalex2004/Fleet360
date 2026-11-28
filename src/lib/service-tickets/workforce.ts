/**
 * Browser-safe shared types, validation helpers, technician matching scorer,
 * certification expiry evaluation, and granular FSM RBAC permission evaluator.
 */

export const AVAILABILITY_STATUSES = [
  'AVAILABLE',
  'ON_JOB',
  'EN_ROUTE',
  'ON_BREAK',
  'OFF_SHIFT',
  'ON_LEAVE',
] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export const EMPLOYMENT_TYPES = ['INTERNAL', 'CONTRACTOR'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const SHIFT_ENTRY_TYPES = ['SHIFT', 'ON_CALL', 'LEAVE', 'TRAINING', 'BLOCKED'] as const;
export type ShiftEntryType = (typeof SHIFT_ENTRY_TYPES)[number];

export const FSM_ROLES = [
  'FSM_ADMIN',
  'FSM_DISPATCHER',
  'FSM_TEAM_LEAD',
  'FSM_TECHNICIAN',
  'FSM_COMMERCIAL_MANAGER',
  'FSM_VIEWER',
] as const;
export type FsmRole = (typeof FSM_ROLES)[number];

export const FSM_ROLE_META: Record<FsmRole, { label: string; description: string }> = {
  FSM_ADMIN: {
    label: 'FSM Admin',
    description: 'Full access to workforce, teams, territories, dispatch, contracts, and RBAC.',
  },
  FSM_DISPATCHER: {
    label: 'Dispatcher',
    description: 'Assigns technicians/teams, manages shifts, schedules visits, and triages tickets.',
  },
  FSM_TEAM_LEAD: {
    label: 'Team Lead / Supervisor',
    description: 'Manages assigned team/territory workload, escalations, and approvals.',
  },
  FSM_TECHNICIAN: {
    label: 'Field Technician',
    description: 'Views and executes own assigned field visits and updates job status.',
  },
  FSM_COMMERCIAL_MANAGER: {
    label: 'Commercial Manager',
    description: 'Manages AMCs, warranties, chargeable entitlements, and cost recharges.',
  },
  FSM_VIEWER: {
    label: 'Read-Only Viewer',
    description: 'View-only access to tickets, technicians, and SLA dashboards within scope.',
  },
};

export const COMMON_FSM_SKILLS: Array<{ code: string; name: string; regulated?: boolean }> = [
  { code: 'HVAC', name: 'HVAC / Chiller Systems' },
  { code: 'ELECTRICAL_LV', name: 'Electrical (Low Voltage)', regulated: true },
  { code: 'PLUMBING', name: 'Plumbing & Water Systems' },
  { code: 'FIRE_SAFETY', name: 'Fire Alarm & Life Safety', regulated: true },
  { code: 'LIFT_MECH', name: 'Lift & Escalator Mechanical', regulated: true },
  { code: 'BUILDING_FABRIC', name: 'Building Fabric / Civil' },
  { code: 'CLEANING_OPS', name: 'Soft Services / Cleaning' },
  { code: 'PEST_CONTROL', name: 'Pest Control Certified', regulated: true },
  { code: 'SECURITY_CCTV', name: 'CCTV & Access Control' },
  { code: 'AUTO_MECH', name: 'Fleet / Automotive Mechanic' },
  { code: 'RECOVERY_TOW', name: 'Roadside Recovery & Towing', regulated: true },
  { code: 'WORKING_AT_HEIGHT', name: 'Working at Heights', regulated: true },
];

export type CertStatus = 'EXPIRED' | 'EXPIRING_SOON' | 'VALID' | 'NO_EXPIRY';

export interface FsmTechnicianSkill {
  id: string;
  technicianId: string;
  skillCode: string;
  skillName: string;
  proficiencyLevel: number; // 1..4
  isCertification: boolean;
  certificateNumber: string | null;
  issuingAuthority: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  documentUrl: string | null;
}

export interface FsmTechnicianTerritory {
  territoryId: string;
  territoryCode: string;
  territoryName: string;
  isPrimary: boolean;
}

export interface FsmTechnicianLocation {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  batteryPct: number | null;
  recordedAt: string;
}

export interface FsmTechnicianShift {
  id: string;
  technicianId: string;
  entryType: ShiftEntryType;
  startsAt: string;
  endsAt: string;
  notes: string | null;
}

export interface FsmTechnician {
  id: string;
  tenantId: string;
  userId: string | null;
  employeeCode: string;
  fullName: string;
  email: string;
  mobile: string | null;
  photoUrl: string | null;
  primaryDepartment: string;
  employmentType: EmploymentType;
  contractorPartnerId: string | null;
  homeBaseAddress: string | null;
  homeBaseLat: number | null;
  homeBaseLng: number | null;
  assignedVehicleId: string | null;
  hourlyCostRate: number;
  hourlyBillableRate: number;
  currency: string;
  maxDailyJobs: number;
  availabilityStatus: AvailabilityStatus;
  isActive: boolean;
  skills: FsmTechnicianSkill[];
  territories: FsmTechnicianTerritory[];
  location: FsmTechnicianLocation | null;
  createdAt: string;
  updatedAt: string;
}

export interface FsmTerritory {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  city: string | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
  isActive: boolean;
  technicianCount: number;
  teamCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FsmTeamMember {
  technicianId: string;
  fullName: string;
  email: string;
  employeeCode: string;
  availabilityStatus: AvailabilityStatus;
  role: 'LEAD' | 'MEMBER';
}

export interface FsmTeam {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  departmentKey: string;
  territoryId: string | null;
  territoryName: string | null;
  leadTechnicianId: string | null;
  leadTechnicianName: string | null;
  leadTechnicianEmail: string | null;
  isActive: boolean;
  members: FsmTeamMember[];
  createdAt: string;
  updatedAt: string;
}

export interface FsmUserScope {
  id: string;
  tenantId: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  fsmRole: FsmRole;
  territoryId: string | null;
  territoryName: string | null;
  teamId: string | null;
  teamName: string | null;
  createdAt: string;
}

// ── Certification & Shift Helpers ────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/**
 * Evaluate a skill/certification expiry state.
 * Certs expiring within `soonDays` (default 30) are flagged EXPIRING_SOON.
 */
export function getCertificationStatus(
  skill: Pick<FsmTechnicianSkill, 'isCertification' | 'expiresAt'>,
  now: Date = new Date(),
  soonDays = 30,
): { status: CertStatus; daysRemaining: number | null } {
  if (!skill.expiresAt) {
    return { status: 'NO_EXPIRY', daysRemaining: null };
  }
  const expMs = new Date(`${skill.expiresAt.slice(0, 10)}T23:59:59Z`).getTime();
  if (!Number.isFinite(expMs)) {
    return { status: 'NO_EXPIRY', daysRemaining: null };
  }
  const daysRemaining = Math.floor((expMs - now.getTime()) / MS_PER_DAY);
  if (daysRemaining < 0) return { status: 'EXPIRED', daysRemaining };
  if (daysRemaining <= soonDays) return { status: 'EXPIRING_SOON', daysRemaining };
  return { status: 'VALID', daysRemaining };
}

/** Check whether a technician has any expired certifications. */
export function expiredCertificationsOf(
  skills: readonly Pick<FsmTechnicianSkill, 'skillCode' | 'skillName' | 'isCertification' | 'expiresAt'>[],
  now: Date = new Date(),
) {
  return skills.filter(
    (s) => s.isCertification && getCertificationStatus(s, now).status === 'EXPIRED',
  );
}

/** Check whether a technician is blocked by leave/blocked shift at `at`. */
export function isTechnicianAvailableAt(
  tech: Pick<FsmTechnician, 'isActive' | 'availabilityStatus'>,
  shifts: readonly Pick<FsmTechnicianShift, 'entryType' | 'startsAt' | 'endsAt'>[],
  at: Date = new Date(),
): { available: boolean; reason?: string } {
  if (!tech.isActive) return { available: false, reason: 'Inactive technician' };
  if (tech.availabilityStatus === 'ON_LEAVE') return { available: false, reason: 'Marked on leave' };
  const ts = at.getTime();
  for (const s of shifts) {
    if (s.entryType !== 'LEAVE' && s.entryType !== 'BLOCKED') continue;
    const start = new Date(s.startsAt).getTime();
    const end = new Date(s.endsAt).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && ts >= start && ts < end) {
      return {
        available: false,
        reason: s.entryType === 'LEAVE' ? 'Scheduled leave' : 'Blocked shift window',
      };
    }
  }
  return { available: true };
}

// ── Best-Fit Assignment Scoring ──────────────────────────────────────────────

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface TechnicianMatchRecommendation {
  technicianId: string;
  score: number; // 0..100
  eligible: boolean;
  distanceKm: number | null;
  badges: string[];
  warnings: string[];
}

/**
 * Deterministic 0–100 recommendation score for assigning a technician to a ticket.
 * Weights:
 *   - Availability & Active status (25 pts)
 *   - Skill & Proficiency match (35 pts)
 *   - Department & Territory match (20 pts)
 *   - Proximity / Distance to site (20 pts)
 */
export function scoreTechnicianForAssignment(input: {
  tech: FsmTechnician;
  department?: string | null;
  territoryId?: string | null;
  requiredSkills?: string[];
  siteLat?: number | null;
  siteLng?: number | null;
  shifts?: readonly Pick<FsmTechnicianShift, 'entryType' | 'startsAt' | 'endsAt'>[];
  now?: Date;
}): TechnicianMatchRecommendation {
  const now = input.now ?? new Date();
  const badges: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  const avail = isTechnicianAvailableAt(input.tech, input.shifts ?? [], now);
  if (!avail.available) {
    warnings.push(avail.reason ?? 'Unavailable');
  } else if (input.tech.availabilityStatus === 'AVAILABLE') {
    score += 25;
    badges.push('Available now');
  } else if (input.tech.availabilityStatus === 'ON_JOB' || input.tech.availabilityStatus === 'EN_ROUTE') {
    score += 14;
    badges.push(input.tech.availabilityStatus === 'EN_ROUTE' ? 'En route' : 'Currently on job');
  } else {
    score += 8;
  }

  // Skills & certification checks
  const req = (input.requiredSkills ?? []).map((s) => s.toUpperCase());
  const expired = expiredCertificationsOf(input.tech.skills, now);
  if (expired.length > 0) {
    warnings.push(`Expired cert: ${expired.map((c) => c.skillName).join(', ')}`);
  }

  if (req.length === 0) {
    score += input.tech.skills.length > 0 ? 25 : 15;
  } else {
    let matched = 0;
    let profSum = 0;
    for (const code of req) {
      const hit = input.tech.skills.find((s) => s.skillCode.toUpperCase() === code);
      if (hit) {
        const expStatus = getCertificationStatus(hit, now).status;
        if (hit.isCertification && expStatus === 'EXPIRED') {
          warnings.push(`Required cert expired: ${hit.skillName}`);
        } else {
          matched++;
          profSum += hit.proficiencyLevel;
        }
      }
    }
    const ratio = matched / req.length;
    score += Math.round(ratio * 27 + (matched > 0 ? Math.min(8, (profSum / matched) * 2) : 0));
    if (matched === req.length) badges.push('All required skills');
    else if (matched > 0) badges.push(`${matched}/${req.length} skills`);
    else warnings.push('Missing required skill');
  }

  // Department & territory
  if (input.department && input.tech.primaryDepartment === input.department) {
    score += 12;
    badges.push('Matching dept');
  }
  if (input.territoryId) {
    const matchTerr = input.tech.territories.find((t) => t.territoryId === input.territoryId);
    if (matchTerr) {
      score += matchTerr.isPrimary ? 8 : 5;
      badges.push(matchTerr.isPrimary ? 'Primary territory' : 'Secondary territory');
    }
  } else {
    score += 6;
  }

  // Distance
  const techLat = input.tech.location?.latitude ?? input.tech.homeBaseLat;
  const techLng = input.tech.location?.longitude ?? input.tech.homeBaseLng;
  let distanceKm: number | null = null;
  if (
    typeof input.siteLat === 'number' &&
    typeof input.siteLng === 'number' &&
    typeof techLat === 'number' &&
    typeof techLng === 'number'
  ) {
    distanceKm = Math.round(haversineKm(techLat, techLng, input.siteLat, input.siteLng) * 10) / 10;
    if (distanceKm <= 5) score += 20;
    else if (distanceKm <= 15) score += 15;
    else if (distanceKm <= 35) score += 10;
    else score += 4;
    badges.push(`${distanceKm} km away`);
  } else {
    score += 10;
  }

  const eligible = avail.available && !warnings.some((w) => w.startsWith('Required cert expired'));
  return {
    technicianId: input.tech.id,
    score: Math.max(0, Math.min(100, score)),
    eligible,
    distanceKm,
    badges,
    warnings,
  };
}

// ── Granular FSM RBAC Evaluator ──────────────────────────────────────────────

export type FsmPermissionAction =
  | 'workforce:read'
  | 'workforce:write'
  | 'dispatch:assign'
  | 'tickets:escalate'
  | 'contracts:manage'
  | 'rbac:manage';

const ROLE_PERMISSIONS: Record<FsmRole, ReadonlySet<FsmPermissionAction>> = {
  FSM_ADMIN: new Set([
    'workforce:read',
    'workforce:write',
    'dispatch:assign',
    'tickets:escalate',
    'contracts:manage',
    'rbac:manage',
  ]),
  FSM_DISPATCHER: new Set(['workforce:read', 'dispatch:assign', 'tickets:escalate']),
  FSM_TEAM_LEAD: new Set(['workforce:read', 'dispatch:assign', 'tickets:escalate']),
  FSM_TECHNICIAN: new Set(['workforce:read']),
  FSM_COMMERCIAL_MANAGER: new Set(['workforce:read', 'contracts:manage']),
  FSM_VIEWER: new Set(['workforce:read']),
};

const PLATFORM_ADMIN_ROLES = new Set(['SUPER_ADMIN', 'TENANT_ADMIN']);
const PLATFORM_OPS_ROLES = new Set(['OPERATIONS_MANAGER', 'FLEET_MANAGER', 'OPERATIONS']);

/**
 * Evaluates whether a caller with `platformRole` + tenant `fsmScopes` can perform
 * `action`, optionally constrained by `targetTerritoryId` or `targetTeamId`.
 */
export function checkFsmPermission(input: {
  platformRole: string | null | undefined;
  fsmScopes: readonly Pick<FsmUserScope, 'fsmRole' | 'territoryId' | 'teamId'>[];
  action: FsmPermissionAction;
  targetTerritoryId?: string | null;
  targetTeamId?: string | null;
}): { allowed: boolean; reason?: string } {
  const role = (input.platformRole ?? '').trim().toUpperCase();
  if (PLATFORM_ADMIN_ROLES.has(role)) return { allowed: true };

  // Check explicit granular FSM scopes first (supports territory/team restrictions).
  if (input.fsmScopes.length > 0) {
    for (const s of input.fsmScopes) {
      if (!ROLE_PERMISSIONS[s.fsmRole]?.has(input.action)) continue;
      const terrMatch = !s.territoryId || !input.targetTerritoryId || s.territoryId === input.targetTerritoryId;
      const teamMatch = !s.teamId || !input.targetTeamId || s.teamId === input.targetTeamId;
      if (terrMatch && teamMatch) {
        return { allowed: true };
      }
    }
    return {
      allowed: false,
      reason: `Your FSM role/territory scope does not permit "${input.action}" for this target.`,
    };
  }

  // Backward-compatible fallback for existing platform operations roles when no granular scopes are assigned yet.
  if (PLATFORM_OPS_ROLES.has(role)) {
    if (input.action === 'rbac:manage') {
      return { allowed: false, reason: 'Only Tenant Admins or FSM Admins can manage FSM role scopes.' };
    }
    return { allowed: true };
  }

  if (input.action === 'workforce:read') {
    return { allowed: true };
  }

  return { allowed: false, reason: `Insufficient permissions for "${input.action}".` };
}

// ── Input Normalization & Validation ─────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeCode(raw: string, maxLen = 40): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen);
}

export function validateTechnicianInput(input: {
  fullName?: unknown;
  email?: unknown;
  employeeCode?: unknown;
  maxDailyJobs?: unknown;
}): string | null {
  const name = String(input.fullName ?? '').trim();
  if (!name) return 'Technician full name is required.';
  if (name.length > 120) return 'Technician full name must be 120 characters or fewer.';

  const email = String(input.email ?? '').trim();
  if (!email || !EMAIL_RE.test(email)) return 'A valid email address is required.';

  if (input.employeeCode !== undefined && String(input.employeeCode).trim()) {
    const code = normalizeCode(String(input.employeeCode));
    if (!code) return 'Employee code must contain letters or digits.';
  }

  if (input.maxDailyJobs !== undefined && input.maxDailyJobs !== null && input.maxDailyJobs !== '') {
    const n = Number(input.maxDailyJobs);
    if (!Number.isInteger(n) || n < 1 || n > 50) return 'Max daily jobs must be an integer between 1 and 50.';
  }
  return null;
}

export function validateShiftWindow(startsAt: unknown, endsAt: unknown): string | null {
  const s = new Date(String(startsAt ?? ''));
  const e = new Date(String(endsAt ?? ''));
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return 'Valid start and end timestamps are required.';
  }
  if (e.getTime() <= s.getTime()) {
    return 'Shift end time must be after start time.';
  }
  return null;
}
