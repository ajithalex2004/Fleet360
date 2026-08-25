/**
 * POST /api/bus-ops/routes/bulk-import
 *
 * Bulk-create staff-transport BusRoutes from a preprocessed row list. The
 * client parses the CSV/XLSX (RoutesBulkImportModal), sends canonical
 * JSON, and this endpoint splits each row into two BusRoute records —
 * one OUTBOUND (morning: fromLocation → unitName) and one INBOUND
 * (evening: unitName → fromLocation with swapped stops). Origin and
 * destination lat/lng ride on RouteStop rows (sequence 1 and 2) so the
 * Fleet Planner can route without a re-geocode.
 *
 * Body: { rows: [ InputRow ] }
 * Query params:
 *   ?dryRun=true         — validate and compute the plan without writing.
 *   ?idempotencyKey=xxx  — same-tenant + same-body replay returns the
 *                          cached result. Caller generates one key per
 *                          "Import" click and retries safely on network
 *                          errors.
 *
 * Response: {
 *   total,               // input rows
 *   plannedRoutes,       // 2 × valid rows
 *   created,             // routes actually inserted (dryRun => 0)
 *   skipped,             // planned but not created (row-level failure)
 *   errored,             // rows that failed validation or DB insert
 *   errors: RowError[],  // per-row diagnostics
 *   dryRun,
 *   idempotencyKey?,
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { createHash } from 'crypto';
import {
  allocateNextRouteCode,
  isUniqueConstraintError,
} from '@/lib/bus-ops/allocate-route-code';
import { revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const ROUTES_CACHE_TAG = 'bus-ops:routes';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ROWS = 2000;
const IDEMPOTENCY_KEY_MAX_LEN = 200;
const IDEMPOTENCY_TTL_HOURS = 24;

/** Canonical shape the client sends. All strings pre-trimmed. */
interface InputRow {
  unitName?: string;              // destination workplace name (morning drop-off org)
  fromLocation?: string;          // origin (morning pickup location)
  fromLat?: number | string;
  fromLng?: number | string;
  dropOffLocation?: string;       // destination location name (morning drop-off location)
  dropOffLat?: number | string;
  dropOffLng?: number | string;
  pickupTime?: string;            // HH:MM 24h — morning depart from fromLocation
  dropOffTime?: string;           // HH:MM 24h — morning arrive at unitName
  returnPickupTime?: string;      // HH:MM 24h — evening depart from unitName
  returnArrivalTime?: string;     // HH:MM 24h — evening arrive back at fromLocation
  capacity?: number | string;     // seats
  daysOfWeek?: string;            // freeform — stored in notes for now
  frequency?: string;             // Daily / Weekly — informational, stored in notes
  routeCode?: string;             // optional; auto-allocated when blank
  requiredVehicleGroup?: string;  // BUS | VAN | ...
  requiredLicenseType?: string;   // LIGHT | HEAVY | BUS | MOTORCYCLE
  notes?: string;
}

interface RowError { row: number; direction?: 'OUTBOUND' | 'INBOUND'; input: InputRow; error: string }

interface ImportResult {
  total: number;
  plannedRoutes: number;
  created: number;
  skipped: number;
  errored: number;
  errors: RowError[];
  dryRun: boolean;
  idempotencyKey?: string;
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const url = new URL(req.url);
      const dryRun = url.searchParams.get('dryRun') === 'true';
      const idempotencyKey = url.searchParams.get('idempotencyKey')?.trim() || null;
      if (idempotencyKey && idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LEN) {
        return NextResponse.json(
          { error: `idempotencyKey must be ≤ ${IDEMPOTENCY_KEY_MAX_LEN} chars` },
          { status: 400 },
        );
      }

      let body: { rows?: InputRow[] };
      try { const bodyRaw = await req.json(); body = stripTenantOwnershipFields(bodyRaw); }
      catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (rows.length === 0) return NextResponse.json({ error: 'rows array is required' }, { status: 400 });
      if (rows.length > MAX_ROWS) {
        return NextResponse.json({ error: `Max ${MAX_ROWS} rows per import` }, { status: 400 });
      }

      // Idempotency replay — dryRun requests are NOT cached (they are cheap and
      // callers should be able to preview repeatedly without cache confusion).
      // Table is `bulk_import_jobs` (raw-migration only, no Prisma model — see
      // prisma/migrations/20260813110000_bulk_import_idempotency).
      const bodyHash = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
      if (idempotencyKey && !dryRun) {
        const cached = await tx.$queryRawUnsafe<Array<{ result: ImportResult; body_hash: string }>>(
          `SELECT result, body_hash FROM bulk_import_jobs
           WHERE tenant_id = $1::uuid AND idempotency_key = $2
             AND expires_at > NOW()
           LIMIT 1`,
          tenantId, idempotencyKey,
        ).catch(() => []);
        if (cached.length > 0) {
          if (cached[0].body_hash !== bodyHash) {
            return NextResponse.json(
              {
                error: 'idempotencyKey was already used with a different request body',
                hint: 'Generate a fresh key per logical import, or omit the key to force re-execution.',
              },
              { status: 409 },
            );
          }
          return NextResponse.json({ ...cached[0].result, idempotencyKey, replayed: true });
        }
      }

      const errors: RowError[] = [];
      const created: string[] = [];
      let plannedRoutes = 0;

      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        const rowNum = i + 1;
        const validated = validateRow(raw);
        if (!validated.ok) {
          errors.push({ row: rowNum, input: raw, error: validated.error });
          continue;
        }
        const v = validated.value;

        // Build both direction plans up-front so we can report per-direction errors.
        const outbound = buildOutbound(v);
        const inbound = buildInbound(v);
        plannedRoutes += 2;

        if (dryRun) continue;

        for (const plan of [outbound, inbound]) {
          try {
            // Must allocate through `tx`, not the outer `prisma`: the outer
            // client checks out a second pool connection while this
            // transaction still holds one (an exhaustion risk under
            // concurrency), and it cannot see routes created earlier in this
            // same transaction — so every row in a batch would be handed the
            // same code and all but the first would collide.
            const code =
              plan.explicitCode ??
              (await allocateNextRouteCode(tx, tenantId, 'STAFF'));
            const route = await tx.busRoute.create({
              data: {
                tenantId,
                name: plan.name,
                code,
                origin: plan.origin,
                destination: plan.destination,
                routeType: 'STAFF',
                requiredVehicleGroup: plan.requiredVehicleGroup ?? null,
                requiredLicenseType: plan.requiredLicenseType ?? null,
                capacity: plan.capacity ?? null,
                direction: plan.direction,
                shiftType: plan.shiftType,
                departureTime: plan.departureTime,
                expectedArrivalTime: plan.expectedArrivalTime,
                isActive: true,
                notes: plan.notes ?? null,
                stops: {
                  create: plan.stops.map((s, si) => ({
                    stopName: s.stopName,
                    sequence: si + 1,
                    gpsLat: s.gpsLat,
                    gpsLng: s.gpsLng,
                    tenantId,
                  })),
                },
              },
              select: { id: true },
            });
            created.push(route.id);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const friendly = isUniqueConstraintError(e)
              ? `Route code collision (${plan.direction}) — retry`
              : msg;
            errors.push({ row: rowNum, direction: plan.direction, input: raw, error: friendly });
          }
        }
      }

      const result: ImportResult = {
        total: rows.length,
        plannedRoutes,
        created: created.length,
        skipped: plannedRoutes - created.length - errors.filter(e => e.direction).length,
        errored: errors.length,
        errors,
        dryRun,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      };

      // Bust the routes cache so the Routes page sees the new rows immediately
      // (not after the 30 s unstable_cache TTL expires).
      if (!dryRun && created.length > 0) {
        await revalidateCache([ROUTES_CACHE_TAG]);
      }

      if (idempotencyKey && !dryRun) {
        // Store result for replay. Failure to persist is non-fatal — worst case
        // a duplicate submit does the work twice.
        const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);
        // Must be awaited. An un-awaited promise inside an interactive
        // transaction callback is abandoned when the callback returns, so the
        // ledger row usually never lands and replay protection silently does
        // nothing — the same floating-promise failure as the `void logAudit`
        // pattern fixed elsewhere in this codebase. Still best-effort: the
        // .catch keeps a ledger failure from failing the import itself.
        await tx.$executeRawUnsafe(
          `INSERT INTO bulk_import_jobs (tenant_id, idempotency_key, body_hash, result, expires_at)
           VALUES ($1::uuid, $2, $3, $4::jsonb, $5::timestamptz)
           ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
             SET body_hash = EXCLUDED.body_hash,
                 result = EXCLUDED.result,
                 expires_at = EXCLUDED.expires_at,
                 updated_at = NOW()`,
          tenantId, idempotencyKey, bodyHash, JSON.stringify(result), expiresAt.toISOString(),
        ).catch(() => { /* best-effort */ });
      }

      return NextResponse.json(result);
  });
}


// ── validation ──────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function requiredStr(v: unknown, name: string): string | { err: string } {
  if (typeof v !== 'string' || !v.trim()) return { err: `${name} is required` };
  return v.trim();
}

function requiredTime(v: unknown, name: string): string | { err: string } {
  if (typeof v !== 'string' || !v.trim()) return { err: `${name} is required` };
  const t = v.trim();
  if (!TIME_RE.test(t)) return { err: `${name} must be HH:MM 24h (got "${t}")` };
  return t;
}

function optionalTime(v: unknown, name: string): string | null | { err: string } {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return { err: `${name} must be a HH:MM string` };
  const t = v.trim();
  if (!t) return null;
  if (!TIME_RE.test(t)) return { err: `${name} must be HH:MM 24h (got "${t}")` };
  return t;
}

function requiredLatLng(v: unknown, name: string, kind: 'lat' | 'lng'): number | { err: string } {
  const n = toNum(v);
  if (n === null) return { err: `${name} is required (number)` };
  const min = kind === 'lat' ? -90 : -180;
  const max = kind === 'lat' ? 90 : 180;
  if (n < min || n > max) return { err: `${name} out of range (${min}..${max})` };
  return n;
}

interface ValidatedRow {
  unitName: string;
  fromLocation: string;
  fromLat: number; fromLng: number;
  dropOffLocation: string;
  dropOffLat: number; dropOffLng: number;
  pickupTime: string;
  dropOffTime: string;
  returnPickupTime: string;
  returnArrivalTime: string | null;
  capacity: number | null;
  daysOfWeek: string | null;
  frequency: string | null;
  routeCode: string | null;
  requiredVehicleGroup: string | null;
  requiredLicenseType: string | null;
  notes: string | null;
}

function isErr<T>(r: T | { err: string }): r is { err: string } {
  return !!r && typeof r === 'object' && 'err' in (r as object);
}

function validateRow(raw: InputRow): { ok: true; value: ValidatedRow } | { ok: false; error: string } {
  const errs: string[] = [];
  const push = <T>(r: T | { err: string }): T | null => {
    if (isErr(r)) { errs.push(r.err); return null; }
    return r as T;
  };

  const unitName    = push(requiredStr(raw.unitName, 'unitName'));
  const fromLoc     = push(requiredStr(raw.fromLocation, 'fromLocation'));
  const fromLat     = push(requiredLatLng(raw.fromLat, 'fromLat', 'lat'));
  const fromLng     = push(requiredLatLng(raw.fromLng, 'fromLng', 'lng'));
  const dropOffLoc  = push(requiredStr(raw.dropOffLocation, 'dropOffLocation'));
  const dropOffLat  = push(requiredLatLng(raw.dropOffLat, 'dropOffLat', 'lat'));
  const dropOffLng  = push(requiredLatLng(raw.dropOffLng, 'dropOffLng', 'lng'));
  const pickupTime  = push(requiredTime(raw.pickupTime, 'pickupTime'));
  const dropOffTime = push(requiredTime(raw.dropOffTime, 'dropOffTime'));
  const returnPick  = push(requiredTime(raw.returnPickupTime, 'returnPickupTime'));
  const returnArrRaw = push(optionalTime(raw.returnArrivalTime, 'returnArrivalTime'));

  if (errs.length || !unitName || !fromLoc
      || fromLat === null || fromLng === null
      || !dropOffLoc || dropOffLat === null || dropOffLng === null
      || !pickupTime || !dropOffTime || !returnPick) {
    return { ok: false, error: errs.join('; ') || 'row failed validation' };
  }

  const cap = toNum(raw.capacity);
  return {
    ok: true,
    value: {
      unitName,
      fromLocation: fromLoc,
      fromLat, fromLng,
      dropOffLocation: dropOffLoc,
      dropOffLat, dropOffLng,
      pickupTime,
      dropOffTime,
      returnPickupTime: returnPick,
      returnArrivalTime: (returnArrRaw as string | null) ?? null,
      capacity: cap == null ? null : Math.max(1, Math.round(cap)),
      daysOfWeek: (raw.daysOfWeek ?? '').toString().trim() || null,
      frequency: (raw.frequency ?? '').toString().trim() || null,
      routeCode: (raw.routeCode ?? '').toString().trim().toUpperCase() || null,
      requiredVehicleGroup: (raw.requiredVehicleGroup ?? '').toString().trim().toUpperCase() || null,
      requiredLicenseType: (raw.requiredLicenseType ?? '').toString().trim().toUpperCase() || null,
      notes: (raw.notes ?? '').toString().trim() || null,
    },
  };
}

// ── plan builders (row → BusRoute) ──────────────────────────────────────────

interface DirectionPlan {
  direction: 'OUTBOUND' | 'INBOUND';
  shiftType: 'MORNING' | 'EVENING';
  name: string;
  origin: string;
  destination: string;
  departureTime: string;
  expectedArrivalTime: string | null;
  capacity: number | null;
  requiredVehicleGroup: string | null;
  requiredLicenseType: string | null;
  notes: string | null;
  explicitCode: string | null;
  stops: Array<{ stopName: string; gpsLat: number; gpsLng: number }>;
}

function metaSuffix(v: ValidatedRow): string {
  const parts: string[] = [];
  if (v.daysOfWeek) parts.push(`Days: ${v.daysOfWeek}`);
  if (v.frequency) parts.push(`Freq: ${v.frequency}`);
  return parts.join(' · ');
}

function buildOutbound(v: ValidatedRow): DirectionPlan {
  const suffix = metaSuffix(v);
  return {
    direction: 'OUTBOUND',
    shiftType: 'MORNING',
    name: `${v.fromLocation} → ${v.dropOffLocation} · ${v.pickupTime}`,
    origin: v.fromLocation,
    destination: v.dropOffLocation,
    departureTime: v.pickupTime,
    expectedArrivalTime: v.dropOffTime,
    capacity: v.capacity,
    requiredVehicleGroup: v.requiredVehicleGroup,
    requiredLicenseType: v.requiredLicenseType,
    notes: [v.notes, suffix].filter(Boolean).join(' | ') || null,
    explicitCode: v.routeCode ? `${v.routeCode}-OUT` : null,
    stops: [
      { stopName: v.fromLocation, gpsLat: v.fromLat, gpsLng: v.fromLng },
      { stopName: v.dropOffLocation, gpsLat: v.dropOffLat, gpsLng: v.dropOffLng },
    ],
  };
}

function buildInbound(v: ValidatedRow): DirectionPlan {
  const suffix = metaSuffix(v);
  return {
    direction: 'INBOUND',
    shiftType: 'EVENING',
    name: `${v.dropOffLocation} → ${v.fromLocation} · ${v.returnPickupTime}`,
    origin: v.dropOffLocation,
    destination: v.fromLocation,
    departureTime: v.returnPickupTime,
    expectedArrivalTime: v.returnArrivalTime,
    capacity: v.capacity,
    requiredVehicleGroup: v.requiredVehicleGroup,
    requiredLicenseType: v.requiredLicenseType,
    notes: [v.notes, suffix].filter(Boolean).join(' | ') || null,
    explicitCode: v.routeCode ? `${v.routeCode}-IN` : null,
    stops: [
      { stopName: v.dropOffLocation, gpsLat: v.dropOffLat, gpsLng: v.dropOffLng },
      { stopName: v.fromLocation, gpsLat: v.fromLat, gpsLng: v.fromLng },
    ],
  };
}
