export const dynamic = 'force-dynamic';

/**
 * POST /api/bus-ops/route-passengers/bulk-import
 *
 * Accepts a JSON array of rows and creates RoutePassenger records in
 * bulk. Uses friendly identifiers (employee business ID, route name,
 * stop name) that the server resolves to UUIDs — ops paste from any
 * HR export without needing to know internal IDs.
 *
 * Body: { rows: [ {
 *   employeeId,           // business ID (StaffMember.employeeId)
 *   routeName,            // BusRoute.name (or routeCode via BusRoute.code)
 *   pickupStopName,       // RouteStop.stopName on that route (optional)
 *   dropoffStopName,      // RouteStop.stopName on that route (optional)
 *   pickupTime,           // 'HH:MM' 24h (optional)
 *   dropoffTime,          // 'HH:MM' 24h (optional)
 *   effectiveFrom,        // 'YYYY-MM-DD' (defaults to today)
 *   effectiveTo,          // 'YYYY-MM-DD' (optional)
 * } ] }
 *
 * Query params (R10 fix 2026-08-13):
 *   ?dryRun=true         — compute the result without writing anything
 *                          to the DB. Use to preview an import before
 *                          committing. Per-row errors are still
 *                          reported.
 *   ?idempotencyKey=xxx  — caller-supplied token. The first POST with
 *                          a given key runs the import and stores the
 *                          result; subsequent POSTs with the same
 *                          key (and same body) return the cached
 *                          result without re-running. This is the
 *                          fix for "ops pasted the same CSV twice
 *                          and got duplicate rows" — the client
 *                          generates one key per paste and retries
 *                          safely.
 *
 * Response: { total, created, skipped, errored, errors, dryRun, idempotencyKey? }
 *
 * All-or-nothing per row: a single bad row DOES NOT abort the batch;
 * the caller sees per-row status. Overlap protection (same as single
 * POST) is enforced — a duplicate active enrollment returns skipped
 * rather than an error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { createHash } from 'crypto';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const IDEMPOTENCY_KEY_MAX_LEN = 200;
const IDEMPOTENCY_TTL_HOURS = 24;

interface InputRow {
  employeeId?: string;
  routeName?: string;
  routeCode?: string;
  pickupStopName?: string;
  dropoffStopName?: string;
  pickupTime?: string;
  dropoffTime?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  notes?: string;
}

interface RowError { row: number; input: InputRow; error: string }

interface ImportResult {
  total: number;
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

      const createdBy = req.headers.get('x-user-id') ?? null;

      // R10: query-string flags
      const url = new URL(req.url);
      const dryRun          = url.searchParams.get('dryRun') === 'true';
      const idempotencyKey  = url.searchParams.get('idempotencyKey')?.trim() || null;

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
      if (rows.length > 5000) return NextResponse.json({ error: 'Max 5000 rows per import' }, { status: 400 });

      // R10: idempotency replay — if this (tenant, key, body-hash) has been
      // processed before, return the cached result without re-running.
      if (idempotencyKey) {
        const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
        const cached = await tx.bulkImportJob.findUnique({
          where: {
            tenantId_idempotencyKey: { tenantId, idempotencyKey },
          },
          select: { result: true, bodyHash: true, expiresAt: true },
        });
        if (cached && cached.expiresAt > new Date()) {
          if (cached.bodyHash !== bodyHash) {
            return NextResponse.json(
              {
                error: 'idempotencyKey was already used with a different request body',
                hint: 'Generate a fresh key per logical paste, or omit the key to force re-execution.',
              },
              { status: 409 },
            );
          }
          // Replay — return cached result.
          return NextResponse.json({
            ...(cached.result as object),
            idempotencyReplay: true,
          });
        }
      }

      // Preload lookup tables ONCE — resolving per-row would fire 4-5 queries
      // per input, killing throughput on 500+ row imports.
      const [staff, routes] = await Promise.all([
        tx.staffMember.findMany({
          where: { tenantId, deletedAt: null, employeeId: { not: null } },
          select: { id: true, employeeId: true },
        }),
        tx.busRoute.findMany({
          where: { deletedAt: null, OR: [{ tenantId }, { tenantId: null }] },
          select: {
            id: true, name: true, code: true,
            stops: { select: { id: true, stopName: true } },
          },
        }),
      ]);
      const staffByEmpId = new Map(staff.map(s => [s.employeeId!.toLowerCase(), s.id]));
      const routeByName  = new Map(routes.map(r => [r.name.toLowerCase(), r]));
      const routeByCode  = new Map(routes.filter(r => r.code).map(r => [r.code!.toLowerCase(), r]));

      let created = 0, skipped = 0;
      const errors: RowError[] = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          if (!r.employeeId?.trim()) throw new Error('employeeId is required');
          const staffMemberId = staffByEmpId.get(r.employeeId.trim().toLowerCase());
          if (!staffMemberId) throw new Error(`Employee ID "${r.employeeId}" not found in tenant`);

          // Route resolution — prefer code (unique per tenant) then name.
          const route = (r.routeCode && routeByCode.get(r.routeCode.trim().toLowerCase()))
                     ?? (r.routeName && routeByName.get(r.routeName.trim().toLowerCase()));
          if (!route) throw new Error(`Route not found (code="${r.routeCode ?? ''}", name="${r.routeName ?? ''}")`);

          // Stop resolution — must exist on the resolved route.
          let pickupStopId: string | null = null;
          if (r.pickupStopName?.trim()) {
            const s = route.stops.find(x => x.stopName.toLowerCase() === r.pickupStopName!.trim().toLowerCase());
            if (!s) throw new Error(`Pickup stop "${r.pickupStopName}" not on route "${route.name}"`);
            pickupStopId = s.id;
          }
          let dropoffStopId: string | null = null;
          if (r.dropoffStopName?.trim()) {
            const s = route.stops.find(x => x.stopName.toLowerCase() === r.dropoffStopName!.trim().toLowerCase());
            if (!s) throw new Error(`Drop-off stop "${r.dropoffStopName}" not on route "${route.name}"`);
            dropoffStopId = s.id;
          }

          if (r.pickupTime  && !TIME_RE.test(r.pickupTime))  throw new Error('pickupTime must be HH:MM (24h)');
          if (r.dropoffTime && !TIME_RE.test(r.dropoffTime)) throw new Error('dropoffTime must be HH:MM (24h)');

          const effectiveFrom = r.effectiveFrom ? new Date(r.effectiveFrom) : new Date();
          const effectiveTo   = r.effectiveTo   ? new Date(r.effectiveTo)   : null;
          if (isNaN(effectiveFrom.getTime())) throw new Error('effectiveFrom is not a valid date');
          if (effectiveTo && (isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) {
            throw new Error('effectiveTo must be on/after effectiveFrom');
          }

          // Overlap check — same rule as single POST endpoint. Duplicates
          // are `skipped` rather than errored.
          const overlap = await tx.routePassenger.findFirst({
            where: {
              tenantId, deletedAt: null, status: 'ACTIVE',
              routeId: route.id, staffMemberId,
              effectiveFrom: { lte: effectiveTo ?? new Date('9999-12-31') },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
            },
            select: { id: true },
          });
          if (overlap) { skipped++; continue; }

          // R10: dry-run — skip the write but still count it as "would-create".
          if (!dryRun) {
            await tx.routePassenger.create({
              data: {
                tenantId, routeId: route.id, staffMemberId,
                pickupStopId, dropoffStopId,
                pickupTime:  r.pickupTime  || null,
                dropoffTime: r.dropoffTime || null,
                effectiveFrom, effectiveTo,
                status: 'ACTIVE',
                notes: r.notes?.trim() || null,
                createdBy,
              },
            });
          }
          created++;
        } catch (err) {
          errors.push({ row: i + 1, input: r, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      const result: ImportResult = {
        total: rows.length,
        created,
        skipped,      // active overlap
        errored: errors.length,
        errors,
        dryRun,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      };

      // R10: persist the result so a retry with the same key is a no-op.
      if (idempotencyKey && !dryRun) {
        const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
        await tx.bulkImportJob.upsert({
          where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
          create: {
            tenantId,
            idempotencyKey,
            bodyHash,
            result: result as object,
            createdBy,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000),
          },
          update: {
            bodyHash,
            result: result as object,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000),
          },
        });
      }

      return NextResponse.json(result);
  });
}

