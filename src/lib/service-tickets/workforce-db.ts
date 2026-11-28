/**
 * Server-side PostgreSQL repository for Field Service Management Workforce:
 *   - Technicians (roster, availability, rates, skills/certs, territories, shifts)
 *   - Persistent Named Teams / Squads & team members
 *   - Geographic Service Territories
 *   - Granular FSM RBAC & territory/team scopes
 *
 * Every function accepts a `TxClient` obtained inside `withTenantRls(prisma, tenantId, ...)`
 * and explicitly scopes queries by `tenant_id` for defense-in-depth.
 */

import type { TxClient } from '@/lib/rls';
import {
  AVAILABILITY_STATUSES,
  EMPLOYMENT_TYPES,
  FSM_ROLES,
  SHIFT_ENTRY_TYPES,
  normalizeCode,
  validateShiftWindow,
  validateTechnicianInput,
  type AvailabilityStatus,
  type EmploymentType,
  type FsmRole,
  type FsmTeam,
  type FsmTeamMember,
  type FsmTechnician,
  type FsmTechnicianLocation,
  type FsmTechnicianShift,
  type FsmTechnicianSkill,
  type FsmTechnicianTerritory,
  type FsmTerritory,
  type FsmUserScope,
  type ShiftEntryType,
} from './workforce';

export class WorkforceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'WorkforceError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(v: string, label: string): string {
  const s = v.trim();
  if (!UUID_RE.test(s)) throw new WorkforceError(`Invalid ${label} ID.`, 400);
  return s;
}

const toNum = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const optText = (v: unknown, max = 200): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

const optCoord = (v: unknown, limit: number): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > limit) {
    throw new WorkforceError('Coordinate is out of range.', 400);
  }
  return n;
};

// ── Territories ──────────────────────────────────────────────────────────────

interface TerritoryRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  city: string | null;
  center_lat: string | number | null;
  center_lng: string | number | null;
  radius_km: string | number | null;
  is_active: boolean;
  tech_count: string | number;
  team_count: string | number;
  created_at: string;
  updated_at: string;
}

function mapTerritory(r: TerritoryRow): FsmTerritory {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    city: r.city,
    centerLat: toNum(r.center_lat),
    centerLng: toNum(r.center_lng),
    radiusKm: toNum(r.radius_km),
    isActive: r.is_active,
    technicianCount: Number(r.tech_count ?? 0),
    teamCount: Number(r.team_count ?? 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listTerritories(tx: TxClient, tenantId: string): Promise<FsmTerritory[]> {
  const rows = await tx.$queryRawUnsafe<TerritoryRow[]>(
    `SELECT t.id::text, t.tenant_id, t.code, t.name, t.city,
            t.center_lat, t.center_lng, t.radius_km, t.is_active,
            t.created_at::text, t.updated_at::text,
            (SELECT COUNT(*) FROM fsm_technician_territories tt
               JOIN fsm_technicians ft ON ft.id = tt.technician_id AND ft.deleted_at IS NULL
              WHERE tt.tenant_id = t.tenant_id AND tt.territory_id = t.id) AS tech_count,
            (SELECT COUNT(*) FROM fsm_teams tm
              WHERE tm.tenant_id = t.tenant_id AND tm.territory_id = t.id AND tm.deleted_at IS NULL) AS team_count
       FROM fsm_territories t
      WHERE t.tenant_id = $1 AND t.deleted_at IS NULL
      ORDER BY t.name ASC`,
    tenantId,
  );
  return rows.map(mapTerritory);
}

export async function createTerritory(
  tx: TxClient,
  tenantId: string,
  input: Record<string, unknown>,
): Promise<FsmTerritory> {
  const name = optText(input.name, 120);
  if (!name) throw new WorkforceError('Territory name is required.');
  const code = normalizeCode(String(input.code ?? name), 40);
  if (!code) throw new WorkforceError('Territory code is required.');
  const city = optText(input.city, 80);
  const centerLat = optCoord(input.centerLat, 90);
  const centerLng = optCoord(input.centerLng, 180);
  const radiusKm = input.radiusKm !== undefined && input.radiusKm !== '' && input.radiusKm !== null
    ? Math.max(0, Number(input.radiusKm))
    : null;
  if (radiusKm !== null && !Number.isFinite(radiusKm)) {
    throw new WorkforceError('Radius must be a valid number.');
  }

  try {
    const [row] = await tx.$queryRawUnsafe<TerritoryRow[]>(
      `INSERT INTO fsm_territories (tenant_id, code, name, city, center_lat, center_lng, radius_km)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id::text, tenant_id, code, name, city, center_lat, center_lng, radius_km,
                 is_active, 0 AS tech_count, 0 AS team_count, created_at::text, updated_at::text`,
      tenantId, code, name, city, centerLat, centerLng, radiusKm,
    );
    return mapTerritory(row);
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      throw new WorkforceError(`Territory code "${code}" already exists.`, 409);
    }
    throw err;
  }
}

export async function updateTerritory(
  tx: TxClient,
  tenantId: string,
  id: string,
  input: Record<string, unknown>,
): Promise<FsmTerritory> {
  const terrId = assertUuid(id, 'territory');
  const sets: string[] = [];
  const args: unknown[] = [];
  let p = 1;
  const setIf = (col: string, val: unknown) => {
    sets.push(`${col} = $${p++}`);
    args.push(val);
  };

  if (input.name !== undefined) {
    const name = optText(input.name, 120);
    if (!name) throw new WorkforceError('Territory name cannot be empty.');
    setIf('name', name);
  }
  if (input.city !== undefined) setIf('city', optText(input.city, 80));
  if (input.centerLat !== undefined) setIf('center_lat', optCoord(input.centerLat, 90));
  if (input.centerLng !== undefined) setIf('center_lng', optCoord(input.centerLng, 180));
  if (input.radiusKm !== undefined) {
    const r = input.radiusKm === null || input.radiusKm === '' ? null : Number(input.radiusKm);
    if (r !== null && (!Number.isFinite(r) || r < 0)) throw new WorkforceError('Radius must be non-negative.');
    setIf('radius_km', r);
  }
  if (typeof input.isActive === 'boolean') setIf('is_active', input.isActive);
  if (sets.length === 0) throw new WorkforceError('No updatable fields provided.');

  sets.push('updated_at = NOW()');
  args.push(terrId, tenantId);

  const [row] = await tx.$queryRawUnsafe<TerritoryRow[]>(
    `UPDATE fsm_territories
        SET ${sets.join(', ')}
      WHERE id = $${p}::uuid AND tenant_id = $${p + 1} AND deleted_at IS NULL
      RETURNING id::text, tenant_id, code, name, city, center_lat, center_lng, radius_km,
                is_active, 0 AS tech_count, 0 AS team_count, created_at::text, updated_at::text`,
    ...args,
  );
  if (!row) throw new WorkforceError('Territory not found.', 404);
  return mapTerritory(row);
}

export async function softDeleteTerritory(tx: TxClient, tenantId: string, id: string): Promise<void> {
  const terrId = assertUuid(id, 'territory');
  const count = await tx.$executeRawUnsafe(
    `UPDATE fsm_territories SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    terrId, tenantId,
  );
  if (!count) throw new WorkforceError('Territory not found.', 404);
}

// ── Technicians ──────────────────────────────────────────────────────────────

interface TechnicianRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  employee_code: string;
  full_name: string;
  email: string;
  mobile: string | null;
  photo_url: string | null;
  primary_department: string;
  employment_type: string;
  contractor_partner_id: string | null;
  home_base_address: string | null;
  home_base_lat: string | number | null;
  home_base_lng: string | number | null;
  assigned_vehicle_id: string | null;
  hourly_cost_rate: string | number;
  hourly_billable_rate: string | number;
  currency: string;
  max_daily_jobs: number;
  availability_status: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface SkillRow {
  id: string;
  technician_id: string;
  skill_code: string;
  skill_name: string;
  proficiency_level: number;
  is_certification: boolean;
  certificate_number: string | null;
  issuing_authority: string | null;
  issued_at: string | null;
  expires_at: string | null;
  document_url: string | null;
}

interface TechTerrRow {
  technician_id: string;
  territory_id: string;
  territory_code: string;
  territory_name: string;
  is_primary: boolean;
}

interface TechLocRow {
  technician_id: string;
  latitude: string | number;
  longitude: string | number;
  accuracy_m: string | number | null;
  battery_pct: number | null;
  recorded_at: string;
}

interface ShiftRow {
  id: string;
  technician_id: string;
  entry_type: string;
  starts_at: string;
  ends_at: string;
  notes: string | null;
}

function hydrateTechnicians(
  rows: TechnicianRow[],
  skillRows: SkillRow[],
  terrRows: TechTerrRow[],
  locRows: TechLocRow[],
): FsmTechnician[] {
  const skillsByTech = new Map<string, FsmTechnicianSkill[]>();
  for (const s of skillRows) {
    const arr = skillsByTech.get(s.technician_id) ?? [];
    arr.push({
      id: s.id,
      technicianId: s.technician_id,
      skillCode: s.skill_code,
      skillName: s.skill_name,
      proficiencyLevel: Number(s.proficiency_level) || 2,
      isCertification: Boolean(s.is_certification),
      certificateNumber: s.certificate_number,
      issuingAuthority: s.issuing_authority,
      issuedAt: s.issued_at,
      expiresAt: s.expires_at,
      documentUrl: s.document_url,
    });
    skillsByTech.set(s.technician_id, arr);
  }

  const terrsByTech = new Map<string, FsmTechnicianTerritory[]>();
  for (const t of terrRows) {
    const arr = terrsByTech.get(t.technician_id) ?? [];
    arr.push({
      territoryId: t.territory_id,
      territoryCode: t.territory_code,
      territoryName: t.territory_name,
      isPrimary: Boolean(t.is_primary),
    });
    terrsByTech.set(t.technician_id, arr);
  }

  const locByTech = new Map<string, FsmTechnicianLocation>();
  for (const l of locRows) {
    locByTech.set(l.technician_id, {
      latitude: Number(l.latitude),
      longitude: Number(l.longitude),
      accuracyM: toNum(l.accuracy_m),
      batteryPct: l.battery_pct,
      recordedAt: l.recorded_at,
    });
  }

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    employeeCode: r.employee_code,
    fullName: r.full_name,
    email: r.email,
    mobile: r.mobile,
    photoUrl: r.photo_url,
    primaryDepartment: r.primary_department,
    employmentType: (EMPLOYMENT_TYPES as readonly string[]).includes(r.employment_type)
      ? (r.employment_type as EmploymentType)
      : 'INTERNAL',
    contractorPartnerId: r.contractor_partner_id,
    homeBaseAddress: r.home_base_address,
    homeBaseLat: toNum(r.home_base_lat),
    homeBaseLng: toNum(r.home_base_lng),
    assignedVehicleId: r.assigned_vehicle_id,
    hourlyCostRate: Number(r.hourly_cost_rate ?? 0),
    hourlyBillableRate: Number(r.hourly_billable_rate ?? 0),
    currency: r.currency || 'AED',
    maxDailyJobs: Number(r.max_daily_jobs ?? 8),
    availabilityStatus: (AVAILABILITY_STATUSES as readonly string[]).includes(r.availability_status)
      ? (r.availability_status as AvailabilityStatus)
      : 'AVAILABLE',
    isActive: Boolean(r.is_active),
    skills: skillsByTech.get(r.id) ?? [],
    territories: terrsByTech.get(r.id) ?? [],
    location: locByTech.get(r.id) ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

const TECH_COLS = `id::text, tenant_id, user_id, employee_code, full_name, email, mobile, photo_url,
  primary_department, employment_type, contractor_partner_id, home_base_address,
  home_base_lat, home_base_lng, assigned_vehicle_id, hourly_cost_rate, hourly_billable_rate,
  currency, max_daily_jobs, availability_status, is_active, created_at::text, updated_at::text`;

export async function listTechnicians(
  tx: TxClient,
  tenantId: string,
  filters: { department?: string; territoryId?: string; activeOnly?: boolean } = {},
): Promise<FsmTechnician[]> {
  const wheres = ['tenant_id = $1', 'deleted_at IS NULL'];
  const args: unknown[] = [tenantId];
  let p = 2;

  if (filters.activeOnly) wheres.push('is_active = TRUE');
  if (filters.department) {
    wheres.push(`primary_department = $${p++}`);
    args.push(filters.department);
  }
  if (filters.territoryId && UUID_RE.test(filters.territoryId)) {
    wheres.push(
      `EXISTS (SELECT 1 FROM fsm_technician_territories tt WHERE tt.tenant_id = fsm_technicians.tenant_id AND tt.technician_id = fsm_technicians.id AND tt.territory_id = $${p++}::uuid)`,
    );
    args.push(filters.territoryId);
  }

  const [rows, skillRows, terrRows, locRows] = await Promise.all([
    tx.$queryRawUnsafe<TechnicianRow[]>(
      `SELECT ${TECH_COLS} FROM fsm_technicians WHERE ${wheres.join(' AND ')} ORDER BY full_name ASC`,
      ...args,
    ),
    tx.$queryRawUnsafe<SkillRow[]>(
      `SELECT id::text, technician_id::text, skill_code, skill_name, proficiency_level,
              is_certification, certificate_number, issuing_authority,
              issued_at::text, expires_at::text, document_url
         FROM fsm_technician_skills
        WHERE tenant_id = $1
        ORDER BY is_certification DESC, skill_name ASC`,
      tenantId,
    ),
    tx.$queryRawUnsafe<TechTerrRow[]>(
      `SELECT tt.technician_id::text, tt.territory_id::text, tt.is_primary,
              t.code AS territory_code, t.name AS territory_name
         FROM fsm_technician_territories tt
         JOIN fsm_territories t ON t.id = tt.territory_id AND t.deleted_at IS NULL
        WHERE tt.tenant_id = $1
        ORDER BY tt.is_primary DESC, t.name ASC`,
      tenantId,
    ),
    tx.$queryRawUnsafe<TechLocRow[]>(
      `SELECT technician_id::text, latitude, longitude, accuracy_m, battery_pct, recorded_at::text
         FROM fsm_technician_locations
        WHERE tenant_id = $1`,
      tenantId,
    ),
  ]);

  return hydrateTechnicians(rows, skillRows, terrRows, locRows);
}

export async function getTechnician(tx: TxClient, tenantId: string, id: string): Promise<FsmTechnician> {
  const techId = assertUuid(id, 'technician');
  const [rows, skillRows, terrRows, locRows] = await Promise.all([
    tx.$queryRawUnsafe<TechnicianRow[]>(
      `SELECT ${TECH_COLS} FROM fsm_technicians WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
      techId, tenantId,
    ),
    tx.$queryRawUnsafe<SkillRow[]>(
      `SELECT id::text, technician_id::text, skill_code, skill_name, proficiency_level,
              is_certification, certificate_number, issuing_authority,
              issued_at::text, expires_at::text, document_url
         FROM fsm_technician_skills
        WHERE tenant_id = $1 AND technician_id = $2::uuid
        ORDER BY is_certification DESC, skill_name ASC`,
      tenantId, techId,
    ),
    tx.$queryRawUnsafe<TechTerrRow[]>(
      `SELECT tt.technician_id::text, tt.territory_id::text, tt.is_primary,
              t.code AS territory_code, t.name AS territory_name
         FROM fsm_technician_territories tt
         JOIN fsm_territories t ON t.id = tt.territory_id AND t.deleted_at IS NULL
        WHERE tt.tenant_id = $1 AND tt.technician_id = $2::uuid`,
      tenantId, techId,
    ),
    tx.$queryRawUnsafe<TechLocRow[]>(
      `SELECT technician_id::text, latitude, longitude, accuracy_m, battery_pct, recorded_at::text
         FROM fsm_technician_locations
        WHERE tenant_id = $1 AND technician_id = $2::uuid`,
      tenantId, techId,
    ),
  ]);
  if (!rows[0]) throw new WorkforceError('Technician not found.', 404);
  return hydrateTechnicians(rows, skillRows, terrRows, locRows)[0];
}

export async function createTechnician(
  tx: TxClient,
  tenantId: string,
  input: Record<string, unknown>,
): Promise<FsmTechnician> {
  const err = validateTechnicianInput(input);
  if (err) throw new WorkforceError(err, 400);

  const fullName = String(input.fullName).trim();
  const email = String(input.email).trim().toLowerCase();
  const employeeCode = normalizeCode(
    String(input.employeeCode ?? '') || `TECH_${fullName.slice(0, 8)}_${Date.now().toString().slice(-4)}`,
    40,
  );
  const mobile = optText(input.mobile, 40);
  const primaryDepartment = optText(input.primaryDepartment, 60) || 'OPERATIONS_TRIAGE';
  const employmentType: EmploymentType =
    typeof input.employmentType === 'string' && (EMPLOYMENT_TYPES as readonly string[]).includes(input.employmentType)
      ? (input.employmentType as EmploymentType)
      : 'INTERNAL';
  const availabilityStatus: AvailabilityStatus =
    typeof input.availabilityStatus === 'string' &&
    (AVAILABILITY_STATUSES as readonly string[]).includes(input.availabilityStatus)
      ? (input.availabilityStatus as AvailabilityStatus)
      : 'AVAILABLE';
  const hourlyCostRate = Math.max(0, Number(input.hourlyCostRate ?? 0) || 0);
  const hourlyBillableRate = Math.max(0, Number(input.hourlyBillableRate ?? 0) || 0);
  const maxDailyJobs = Math.min(50, Math.max(1, Number(input.maxDailyJobs ?? 8) || 8));
  const homeBaseAddress = optText(input.homeBaseAddress, 200);
  const homeBaseLat = optCoord(input.homeBaseLat, 90);
  const homeBaseLng = optCoord(input.homeBaseLng, 180);
  const assignedVehicleId = optText(input.assignedVehicleId, 80);
  const userId = optText(input.userId, 80);
  const currency = optText(input.currency, 8) || 'AED';

  try {
    const [row] = await tx.$queryRawUnsafe<TechnicianRow[]>(
      `INSERT INTO fsm_technicians (
         tenant_id, user_id, employee_code, full_name, email, mobile,
         primary_department, employment_type, home_base_address, home_base_lat, home_base_lng,
         assigned_vehicle_id, hourly_cost_rate, hourly_billable_rate, currency,
         max_daily_jobs, availability_status
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11,
         $12, $13, $14, $15,
         $16, $17
       )
       RETURNING ${TECH_COLS}`,
      tenantId, userId, employeeCode, fullName, email, mobile,
      primaryDepartment, employmentType, homeBaseAddress, homeBaseLat, homeBaseLng,
      assignedVehicleId, hourlyCostRate, hourlyBillableRate, currency,
      maxDailyJobs, availabilityStatus,
    );

    if (Array.isArray(input.skills)) {
      await replaceTechnicianSkills(tx, tenantId, row.id, input.skills as Array<Record<string, unknown>>);
    }
    if (Array.isArray(input.territoryIds)) {
      await replaceTechnicianTerritories(
        tx,
        tenantId,
        row.id,
        input.territoryIds.map((t) => String(t)),
        typeof input.primaryTerritoryId === 'string' ? input.primaryTerritoryId : null,
      );
    }
    return getTechnician(tx, tenantId, row.id);
  } catch (e) {
    if (e instanceof Error && /unique/i.test(e.message)) {
      throw new WorkforceError(`Employee code "${employeeCode}" already exists.`, 409);
    }
    throw e;
  }
}

export async function updateTechnician(
  tx: TxClient,
  tenantId: string,
  id: string,
  input: Record<string, unknown>,
): Promise<FsmTechnician> {
  const techId = assertUuid(id, 'technician');
  const sets: string[] = [];
  const args: unknown[] = [];
  let p = 1;
  const setIf = (col: string, val: unknown) => {
    sets.push(`${col} = $${p++}`);
    args.push(val);
  };

  if (input.fullName !== undefined) {
    const v = optText(input.fullName, 120);
    if (!v) throw new WorkforceError('Full name cannot be empty.');
    setIf('full_name', v);
  }
  if (input.email !== undefined) {
    const v = String(input.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new WorkforceError('Valid email address is required.');
    setIf('email', v);
  }
  if (input.mobile !== undefined) setIf('mobile', optText(input.mobile, 40));
  if (input.userId !== undefined) setIf('user_id', optText(input.userId, 80));
  if (input.primaryDepartment !== undefined) setIf('primary_department', optText(input.primaryDepartment, 60) || 'OPERATIONS_TRIAGE');
  if (typeof input.employmentType === 'string' && (EMPLOYMENT_TYPES as readonly string[]).includes(input.employmentType)) {
    setIf('employment_type', input.employmentType);
  }
  if (typeof input.availabilityStatus === 'string' && (AVAILABILITY_STATUSES as readonly string[]).includes(input.availabilityStatus)) {
    setIf('availability_status', input.availabilityStatus);
  }
  if (input.homeBaseAddress !== undefined) setIf('home_base_address', optText(input.homeBaseAddress, 200));
  if (input.homeBaseLat !== undefined) setIf('home_base_lat', optCoord(input.homeBaseLat, 90));
  if (input.homeBaseLng !== undefined) setIf('home_base_lng', optCoord(input.homeBaseLng, 180));
  if (input.assignedVehicleId !== undefined) setIf('assigned_vehicle_id', optText(input.assignedVehicleId, 80));
  if (input.hourlyCostRate !== undefined) setIf('hourly_cost_rate', Math.max(0, Number(input.hourlyCostRate) || 0));
  if (input.hourlyBillableRate !== undefined) setIf('hourly_billable_rate', Math.max(0, Number(input.hourlyBillableRate) || 0));
  if (input.maxDailyJobs !== undefined) {
    const n = Number(input.maxDailyJobs);
    if (!Number.isInteger(n) || n < 1 || n > 50) throw new WorkforceError('Max daily jobs must be 1–50.');
    setIf('max_daily_jobs', n);
  }
  if (typeof input.isActive === 'boolean') setIf('is_active', input.isActive);

  if (sets.length > 0) {
    sets.push('updated_at = NOW()');
    args.push(techId, tenantId);
    const updated = await tx.$executeRawUnsafe(
      `UPDATE fsm_technicians SET ${sets.join(', ')}
        WHERE id = $${p}::uuid AND tenant_id = $${p + 1} AND deleted_at IS NULL`,
      ...args,
    );
    if (!updated) throw new WorkforceError('Technician not found.', 404);
  }

  if (Array.isArray(input.skills)) {
    await replaceTechnicianSkills(tx, tenantId, techId, input.skills as Array<Record<string, unknown>>);
  }
  if (Array.isArray(input.territoryIds)) {
    await replaceTechnicianTerritories(
      tx,
      tenantId,
      techId,
      input.territoryIds.map((t) => String(t)),
      typeof input.primaryTerritoryId === 'string' ? input.primaryTerritoryId : null,
    );
  }

  return getTechnician(tx, tenantId, techId);
}

export async function softDeleteTechnician(tx: TxClient, tenantId: string, id: string): Promise<void> {
  const techId = assertUuid(id, 'technician');
  const count = await tx.$executeRawUnsafe(
    `UPDATE fsm_technicians SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    techId, tenantId,
  );
  if (!count) throw new WorkforceError('Technician not found.', 404);
}

export async function replaceTechnicianSkills(
  tx: TxClient,
  tenantId: string,
  technicianId: string,
  skills: Array<Record<string, unknown>>,
): Promise<FsmTechnicianSkill[]> {
  const techId = assertUuid(technicianId, 'technician');
  await tx.$executeRawUnsafe(
    `DELETE FROM fsm_technician_skills WHERE tenant_id = $1 AND technician_id = $2::uuid`,
    tenantId, techId,
  );

  const seen = new Set<string>();
  for (const s of skills) {
    const skillName = optText(s.skillName ?? s.skillCode, 80);
    const skillCode = normalizeCode(String(s.skillCode ?? skillName ?? ''), 48);
    if (!skillCode || !skillName || seen.has(skillCode)) continue;
    seen.add(skillCode);
    const prof = Math.min(4, Math.max(1, Math.round(Number(s.proficiencyLevel ?? 2) || 2)));
    const isCert = Boolean(s.isCertification);
    const certNo = optText(s.certificateNumber, 80);
    const auth = optText(s.issuingAuthority, 100);
    const issuedAt = optText(s.issuedAt, 20);
    const expiresAt = optText(s.expiresAt, 20);

    await tx.$executeRawUnsafe(
      `INSERT INTO fsm_technician_skills (
         tenant_id, technician_id, skill_code, skill_name, proficiency_level,
         is_certification, certificate_number, issuing_authority, issued_at, expires_at
       ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9::date, $10::date)`,
      tenantId, techId, skillCode, skillName, prof, isCert, certNo, auth, issuedAt, expiresAt,
    );
  }

  const rows = await tx.$queryRawUnsafe<SkillRow[]>(
    `SELECT id::text, technician_id::text, skill_code, skill_name, proficiency_level,
            is_certification, certificate_number, issuing_authority,
            issued_at::text, expires_at::text, document_url
       FROM fsm_technician_skills
      WHERE tenant_id = $1 AND technician_id = $2::uuid
      ORDER BY is_certification DESC, skill_name ASC`,
    tenantId, techId,
  );
  return rows.map((s) => ({
    id: s.id,
    technicianId: s.technician_id,
    skillCode: s.skill_code,
    skillName: s.skill_name,
    proficiencyLevel: Number(s.proficiency_level) || 2,
    isCertification: Boolean(s.is_certification),
    certificateNumber: s.certificate_number,
    issuingAuthority: s.issuing_authority,
    issuedAt: s.issued_at,
    expiresAt: s.expires_at,
    documentUrl: s.document_url,
  }));
}

export async function replaceTechnicianTerritories(
  tx: TxClient,
  tenantId: string,
  technicianId: string,
  territoryIds: string[],
  primaryTerritoryId?: string | null,
): Promise<void> {
  const techId = assertUuid(technicianId, 'technician');
  await tx.$executeRawUnsafe(
    `DELETE FROM fsm_technician_territories WHERE tenant_id = $1 AND technician_id = $2::uuid`,
    tenantId, techId,
  );
  const uniqueIds = Array.from(new Set(territoryIds.filter((id) => UUID_RE.test(id))));
  for (let i = 0; i < uniqueIds.length; i++) {
    const tid = uniqueIds[i];
    const isPrimary = primaryTerritoryId ? tid === primaryTerritoryId : i === 0;
    await tx.$executeRawUnsafe(
      `INSERT INTO fsm_technician_territories (tenant_id, technician_id, territory_id, is_primary)
       SELECT $1, $2::uuid, id, $4
         FROM fsm_territories
        WHERE id = $3::uuid AND tenant_id = $1 AND deleted_at IS NULL
       ON CONFLICT (tenant_id, technician_id, territory_id) DO UPDATE SET is_primary = EXCLUDED.is_primary`,
      tenantId, techId, tid, isPrimary,
    );
  }
}

export async function listTechnicianShifts(
  tx: TxClient,
  tenantId: string,
  technicianId: string,
): Promise<FsmTechnicianShift[]> {
  const techId = assertUuid(technicianId, 'technician');
  const rows = await tx.$queryRawUnsafe<ShiftRow[]>(
    `SELECT id::text, technician_id::text, entry_type, starts_at::text, ends_at::text, notes
       FROM fsm_technician_shifts
      WHERE tenant_id = $1 AND technician_id = $2::uuid
      ORDER BY starts_at ASC`,
    tenantId, techId,
  );
  return rows.map((r) => ({
    id: r.id,
    technicianId: r.technician_id,
    entryType: r.entry_type as ShiftEntryType,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    notes: r.notes,
  }));
}

export async function addTechnicianShift(
  tx: TxClient,
  tenantId: string,
  technicianId: string,
  input: Record<string, unknown>,
): Promise<FsmTechnicianShift> {
  const techId = assertUuid(technicianId, 'technician');
  const winErr = validateShiftWindow(input.startsAt, input.endsAt);
  if (winErr) throw new WorkforceError(winErr, 400);
  const entryType: ShiftEntryType =
    typeof input.entryType === 'string' && (SHIFT_ENTRY_TYPES as readonly string[]).includes(input.entryType)
      ? (input.entryType as ShiftEntryType)
      : 'SHIFT';
  const notes = optText(input.notes, 200);

  const [row] = await tx.$queryRawUnsafe<ShiftRow[]>(
    `INSERT INTO fsm_technician_shifts (tenant_id, technician_id, entry_type, starts_at, ends_at, notes)
     VALUES ($1, $2::uuid, $3, $4::timestamptz, $5::timestamptz, $6)
     RETURNING id::text, technician_id::text, entry_type, starts_at::text, ends_at::text, notes`,
    tenantId, techId, entryType, new Date(String(input.startsAt)).toISOString(), new Date(String(input.endsAt)).toISOString(), notes,
  );
  return {
    id: row.id,
    technicianId: row.technician_id,
    entryType: row.entry_type as ShiftEntryType,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    notes: row.notes,
  };
}

export async function deleteTechnicianShift(
  tx: TxClient,
  tenantId: string,
  technicianId: string,
  shiftId: string,
): Promise<void> {
  const techId = assertUuid(technicianId, 'technician');
  const sId = assertUuid(shiftId, 'shift');
  const count = await tx.$executeRawUnsafe(
    `DELETE FROM fsm_technician_shifts WHERE id = $1::uuid AND technician_id = $2::uuid AND tenant_id = $3`,
    sId, techId, tenantId,
  );
  if (!count) throw new WorkforceError('Shift entry not found.', 404);
}

// ── Teams / Squads ───────────────────────────────────────────────────────────

interface TeamRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  department_key: string;
  territory_id: string | null;
  territory_name: string | null;
  lead_technician_id: string | null;
  lead_name: string | null;
  lead_email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface TeamMemberRow {
  team_id: string;
  technician_id: string;
  role: string;
  full_name: string;
  email: string;
  employee_code: string;
  availability_status: string;
}

export async function listTeams(tx: TxClient, tenantId: string): Promise<FsmTeam[]> {
  const [teamRows, memberRows] = await Promise.all([
    tx.$queryRawUnsafe<TeamRow[]>(
      `SELECT tm.id::text, tm.tenant_id, tm.code, tm.name, tm.department_key,
              tm.territory_id::text, tr.name AS territory_name,
              tm.lead_technician_id::text, lt.full_name AS lead_name, lt.email AS lead_email,
              tm.is_active, tm.created_at::text, tm.updated_at::text
         FROM fsm_teams tm
         LEFT JOIN fsm_territories tr ON tr.id = tm.territory_id AND tr.deleted_at IS NULL
         LEFT JOIN fsm_technicians lt ON lt.id = tm.lead_technician_id AND lt.deleted_at IS NULL
        WHERE tm.tenant_id = $1 AND tm.deleted_at IS NULL
        ORDER BY tm.name ASC`,
      tenantId,
    ),
    tx.$queryRawUnsafe<TeamMemberRow[]>(
      `SELECT m.team_id::text, m.technician_id::text, m.role,
              ft.full_name, ft.email, ft.employee_code, ft.availability_status
         FROM fsm_team_members m
         JOIN fsm_technicians ft ON ft.id = m.technician_id AND ft.deleted_at IS NULL
        WHERE m.tenant_id = $1
        ORDER BY CASE WHEN m.role = 'LEAD' THEN 0 ELSE 1 END, ft.full_name ASC`,
      tenantId,
    ),
  ]);

  const byTeam = new Map<string, FsmTeamMember[]>();
  for (const m of memberRows) {
    const arr = byTeam.get(m.team_id) ?? [];
    arr.push({
      technicianId: m.technician_id,
      fullName: m.full_name,
      email: m.email,
      employeeCode: m.employee_code,
      availabilityStatus: (AVAILABILITY_STATUSES as readonly string[]).includes(m.availability_status)
        ? (m.availability_status as AvailabilityStatus)
        : 'AVAILABLE',
      role: m.role === 'LEAD' ? 'LEAD' : 'MEMBER',
    });
    byTeam.set(m.team_id, arr);
  }

  return teamRows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    departmentKey: r.department_key,
    territoryId: r.territory_id,
    territoryName: r.territory_name,
    leadTechnicianId: r.lead_technician_id,
    leadTechnicianName: r.lead_name,
    leadTechnicianEmail: r.lead_email,
    isActive: Boolean(r.is_active),
    members: byTeam.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function createTeam(
  tx: TxClient,
  tenantId: string,
  input: Record<string, unknown>,
): Promise<FsmTeam> {
  const name = optText(input.name, 120);
  if (!name) throw new WorkforceError('Team name is required.');
  const code = normalizeCode(String(input.code ?? name), 40);
  if (!code) throw new WorkforceError('Team code is required.');
  const departmentKey = optText(input.departmentKey, 60) || 'OPERATIONS_TRIAGE';
  const territoryId = typeof input.territoryId === 'string' && UUID_RE.test(input.territoryId) ? input.territoryId : null;
  const leadTechnicianId =
    typeof input.leadTechnicianId === 'string' && UUID_RE.test(input.leadTechnicianId)
      ? input.leadTechnicianId
      : null;

  try {
    const [row] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO fsm_teams (tenant_id, code, name, department_key, territory_id, lead_technician_id)
       VALUES ($1, $2, $3, $4, $5::uuid, $6::uuid)
       RETURNING id::text`,
      tenantId, code, name, departmentKey, territoryId, leadTechnicianId,
    );
    const memberIds = Array.isArray(input.memberIds) ? input.memberIds.map(String) : [];
    if (leadTechnicianId && !memberIds.includes(leadTechnicianId)) memberIds.unshift(leadTechnicianId);
    if (memberIds.length > 0) {
      await replaceTeamMembers(tx, tenantId, row.id, memberIds, leadTechnicianId);
    }
    const teams = await listTeams(tx, tenantId);
    return teams.find((t) => t.id === row.id)!;
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      throw new WorkforceError(`Team code "${code}" already exists.`, 409);
    }
    throw err;
  }
}

export async function updateTeam(
  tx: TxClient,
  tenantId: string,
  id: string,
  input: Record<string, unknown>,
): Promise<FsmTeam> {
  const teamId = assertUuid(id, 'team');
  const sets: string[] = [];
  const args: unknown[] = [];
  let p = 1;
  const setIf = (col: string, val: unknown, cast = '') => {
    sets.push(`${col} = $${p++}${cast}`);
    args.push(val);
  };

  if (input.name !== undefined) {
    const v = optText(input.name, 120);
    if (!v) throw new WorkforceError('Team name cannot be empty.');
    setIf('name', v);
  }
  if (input.departmentKey !== undefined) setIf('department_key', optText(input.departmentKey, 60) || 'OPERATIONS_TRIAGE');
  if (input.territoryId !== undefined) {
    const tid = typeof input.territoryId === 'string' && UUID_RE.test(input.territoryId) ? input.territoryId : null;
    setIf('territory_id', tid, '::uuid');
  }
  const leadId =
    input.leadTechnicianId !== undefined
      ? typeof input.leadTechnicianId === 'string' && UUID_RE.test(input.leadTechnicianId)
        ? input.leadTechnicianId
        : null
      : undefined;
  if (leadId !== undefined) setIf('lead_technician_id', leadId, '::uuid');
  if (typeof input.isActive === 'boolean') setIf('is_active', input.isActive);

  if (sets.length > 0) {
    sets.push('updated_at = NOW()');
    args.push(teamId, tenantId);
    const updated = await tx.$executeRawUnsafe(
      `UPDATE fsm_teams SET ${sets.join(', ')}
        WHERE id = $${p}::uuid AND tenant_id = $${p + 1} AND deleted_at IS NULL`,
      ...args,
    );
    if (!updated) throw new WorkforceError('Team not found.', 404);
  }

  if (Array.isArray(input.memberIds)) {
    const memberIds = input.memberIds.map(String);
    if (leadId && !memberIds.includes(leadId)) memberIds.unshift(leadId);
    await replaceTeamMembers(tx, tenantId, teamId, memberIds, leadId ?? null);
  }

  const teams = await listTeams(tx, tenantId);
  const found = teams.find((t) => t.id === teamId);
  if (!found) throw new WorkforceError('Team not found.', 404);
  return found;
}

export async function replaceTeamMembers(
  tx: TxClient,
  tenantId: string,
  teamId: string,
  memberIds: string[],
  leadTechnicianId?: string | null,
): Promise<void> {
  const id = assertUuid(teamId, 'team');
  await tx.$executeRawUnsafe(
    `DELETE FROM fsm_team_members WHERE tenant_id = $1 AND team_id = $2::uuid`,
    tenantId, id,
  );
  const uniqueIds = Array.from(new Set(memberIds.filter((m) => UUID_RE.test(m))));
  for (const techId of uniqueIds) {
    const role = leadTechnicianId && techId === leadTechnicianId ? 'LEAD' : 'MEMBER';
    await tx.$executeRawUnsafe(
      `INSERT INTO fsm_team_members (tenant_id, team_id, technician_id, role)
       SELECT $1, $2::uuid, id, $4
         FROM fsm_technicians
        WHERE id = $3::uuid AND tenant_id = $1 AND deleted_at IS NULL
       ON CONFLICT (tenant_id, team_id, technician_id) DO UPDATE SET role = EXCLUDED.role`,
      tenantId, id, techId, role,
    );
  }
}

export async function softDeleteTeam(tx: TxClient, tenantId: string, id: string): Promise<void> {
  const teamId = assertUuid(id, 'team');
  const count = await tx.$executeRawUnsafe(
    `UPDATE fsm_teams SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    teamId, tenantId,
  );
  if (!count) throw new WorkforceError('Team not found.', 404);
}

// ── Granular FSM RBAC Scopes ─────────────────────────────────────────────────

interface ScopeRow {
  id: string;
  tenant_id: string;
  user_id: string;
  user_email: string | null;
  user_name: string | null;
  fsm_role: string;
  territory_id: string | null;
  territory_name: string | null;
  team_id: string | null;
  team_name: string | null;
  created_at: string;
}

function mapScope(r: ScopeRow): FsmUserScope {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    userEmail: r.user_email,
    userName: r.user_name,
    fsmRole: (FSM_ROLES as readonly string[]).includes(r.fsm_role) ? (r.fsm_role as FsmRole) : 'FSM_VIEWER',
    territoryId: r.territory_id,
    territoryName: r.territory_name,
    teamId: r.team_id,
    teamName: r.team_name,
    createdAt: r.created_at,
  };
}

export async function listFsmScopes(tx: TxClient, tenantId: string): Promise<FsmUserScope[]> {
  const rows = await tx.$queryRawUnsafe<ScopeRow[]>(
    `SELECT s.id::text, s.tenant_id, s.user_id, s.user_email, s.user_name, s.fsm_role,
            s.territory_id::text, tr.name AS territory_name,
            s.team_id::text, tm.name AS team_name,
            s.created_at::text
       FROM fsm_user_territory_scopes s
       LEFT JOIN fsm_territories tr ON tr.id = s.territory_id AND tr.deleted_at IS NULL
       LEFT JOIN fsm_teams tm ON tm.id = s.team_id AND tm.deleted_at IS NULL
      WHERE s.tenant_id = $1
      ORDER BY s.created_at DESC`,
    tenantId,
  );
  return rows.map(mapScope);
}

export async function getUserFsmScopes(
  tx: TxClient,
  tenantId: string,
  userId: string,
): Promise<FsmUserScope[]> {
  if (!userId) return [];
  const rows = await tx.$queryRawUnsafe<ScopeRow[]>(
    `SELECT s.id::text, s.tenant_id, s.user_id, s.user_email, s.user_name, s.fsm_role,
            s.territory_id::text, tr.name AS territory_name,
            s.team_id::text, tm.name AS team_name,
            s.created_at::text
       FROM fsm_user_territory_scopes s
       LEFT JOIN fsm_territories tr ON tr.id = s.territory_id AND tr.deleted_at IS NULL
       LEFT JOIN fsm_teams tm ON tm.id = s.team_id AND tm.deleted_at IS NULL
      WHERE s.tenant_id = $1 AND s.user_id = $2`,
    tenantId, userId,
  ).catch(() => [] as ScopeRow[]);
  return rows.map(mapScope);
}

export async function addFsmScope(
  tx: TxClient,
  tenantId: string,
  input: Record<string, unknown>,
): Promise<FsmUserScope> {
  const userId = optText(input.userId, 120);
  if (!userId) throw new WorkforceError('User is required.');
  const fsmRole = String(input.fsmRole ?? '').trim().toUpperCase();
  if (!(FSM_ROLES as readonly string[]).includes(fsmRole)) {
    throw new WorkforceError(`Invalid FSM role. Choose one of: ${FSM_ROLES.join(', ')}`);
  }
  const userEmail = optText(input.userEmail, 160);
  const userName = optText(input.userName, 120);
  const territoryId =
    typeof input.territoryId === 'string' && UUID_RE.test(input.territoryId) ? input.territoryId : null;
  const teamId = typeof input.teamId === 'string' && UUID_RE.test(input.teamId) ? input.teamId : null;

  try {
    const [row] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO fsm_user_territory_scopes (tenant_id, user_id, user_email, user_name, fsm_role, territory_id, team_id)
       VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::uuid)
       RETURNING id::text`,
      tenantId, userId, userEmail, userName, fsmRole, territoryId, teamId,
    );
    const scopes = await listFsmScopes(tx, tenantId);
    return scopes.find((s) => s.id === row.id)!;
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      throw new WorkforceError('That user already holds this exact FSM role and scope.', 409);
    }
    throw err;
  }
}

export async function deleteFsmScope(tx: TxClient, tenantId: string, id: string): Promise<void> {
  const scopeId = assertUuid(id, 'scope');
  const count = await tx.$executeRawUnsafe(
    `DELETE FROM fsm_user_territory_scopes WHERE id = $1::uuid AND tenant_id = $2`,
    scopeId, tenantId,
  );
  if (!count) throw new WorkforceError('Role scope not found.', 404);
}
