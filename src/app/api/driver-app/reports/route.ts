/**
 * src/app/api/driver-app/reports/route.ts
 *
 * POST /api/driver-app/reports
 *   Driver files a new report (REQUEST or INCIDENT). The driver's id
 *   and tenant come from the session, never from the body.
 *
 *   REQUEST body accepts an optional `subtype` (e.g. MAINTENANCE →
 *   PREVENTIVE). The catalogue is per-type and validated against the
 *   matching sub-type set in @/lib/driver-reports.
 *
 *   INCIDENT reports auto-fill severity from the type's default
 *   (ACCIDENT/BREAKDOWN → HIGH, TRAFFIC_DELAY/PASSENGER_COMPLAINT →
 *   LOW) if the driver doesn't supply one. Drivers can always override.
 *
 * GET /api/driver-app/reports?kind=REQUEST&status=OPEN&subtype=PREVENTIVE&limit=20
 *   Driver lists their own reports, newest first. Optional filters:
 *     - kind:    'REQUEST' | 'INCIDENT'
 *     - status:  'OPEN' | 'ACK' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED'
 *     - subtype: free-text (validated against the catalogue only on write)
 *     - limit:   1-100 (default 20)
 *
 * The dispatcher has its own API surface (under /api/dispatcher/) for
 * viewing the whole tenant's queue and acting on reports.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';
import { privateCacheControl } from '@/lib/server-cache';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import {
  isRequestType,
  isIncidentType,
  isSeverity,
  isReportStatus,
  isRequestSubtype,
  defaultSeverity,
  getRequestSubtypeCatalogue,
} from '@/lib/driver-reports';

const PostBodySchema = z.object({
  kind: z.enum(['REQUEST', 'INCIDENT']),
  type: z.string().min(1).max(50),
  subtype: z.string().min(1).max(50).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  // Trip / shift context (optional — the report might not be tied to a trip)
  tripId: z.string().min(1).max(200).optional(),
  shiftId: z.string().uuid().optional(),
  // Location (optional — best-effort; recorded if available)
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracyM: z.number().nonnegative().optional(),
});

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json().catch(() => ({}));
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Cross-field validation: type must match kind
  if (input.kind === 'REQUEST' && !isRequestType(input.type)) {
    return NextResponse.json(
      { error: `type '${input.type}' is not a valid request type` },
      { status: 400 },
    );
  }
  if (input.kind === 'INCIDENT' && !isIncidentType(input.type)) {
    return NextResponse.json(
      { error: `type '${input.type}' is not a valid incident type` },
      { status: 400 },
    );
  }

  // Sub-type: only valid on REQUEST reports. Must belong to the
  // catalogue for the chosen request type.
  if (input.subtype) {
    if (input.kind !== 'REQUEST') {
      return NextResponse.json(
        { error: 'subtype is only valid for REQUEST reports' },
        { status: 400 },
      );
    }
    if (!isRequestSubtype(input.subtype)) {
      return NextResponse.json(
        { error: `subtype '${input.subtype}' is not a recognised request subtype` },
        { status: 400 },
      );
    }
    // input.type is `string` from Zod; cast through the runtime guard.
    // (We just validated above that input.kind === 'REQUEST' and the
    // type belongs to REQUEST_TYPES, so the cast is safe.)
    const catalogue = isRequestType(input.type)
      ? getRequestSubtypeCatalogue(input.type)
      : null;
    if (catalogue && !catalogue.includes(input.subtype as never)) {
      return NextResponse.json(
        { error: `subtype '${input.subtype}' is not valid for type '${input.type}'. Valid: ${catalogue.join(', ')}` },
        { status: 400 },
      );
    }
  }

  // Severity: incident-only. If the driver didn't supply one, use
  // the type's default (ACCIDENT/BREAKDOWN → HIGH, others → LOW).
  let effectiveSeverity: string | null = null;
  if (input.kind === 'INCIDENT') {
    if (input.severity) {
      if (!isSeverity(input.severity)) {
        return NextResponse.json(
          { error: `severity '${input.severity}' is not a valid severity` },
          { status: 400 },
        );
      }
      effectiveSeverity = input.severity;
    } else {
      // Auto-fill from default. Always set something (no nulls on incidents).
      effectiveSeverity = defaultSeverity(input.type) ?? 'MEDIUM';
    }
  } else if (input.severity) {
    return NextResponse.json(
      { error: 'severity can only be set on INCIDENT reports' },
      { status: 400 },
    );
  }

  const id = crypto.randomUUID();
  const location = input.lat != null && input.lng != null
    ? { lat: input.lat, lng: input.lng, accuracyM: input.accuracyM ?? null }
    : null;

  await prisma.$executeRaw`
    INSERT INTO driver_reports (
      id, tenant_id, driver_id, trip_id, shift_id,
      kind, type, subtype, severity, title, description, location,
      status, created_at, updated_at
    ) VALUES (
      ${id}::uuid,
      ${ctx.tenantId}::uuid,
      ${ctx.userId}::uuid,
      ${input.tripId ?? null},
      ${input.shiftId ?? null}::uuid,
      ${input.kind},
      ${input.type},
      ${input.subtype ?? null},
      ${effectiveSeverity},
      ${input.title},
      ${input.description ?? null},
      ${location ? JSON.stringify(location) : null}::jsonb,
      'OPEN',
      NOW(),
      NOW()
    )
  `;

  return NextResponse.json({
    ok: true,
    id,
    status: 'OPEN',
    kind: input.kind,
    type: input.type,
    subtype: input.subtype ?? null,
    severity: effectiveSeverity,
    title: input.title,
  }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const kind = url.searchParams.get('kind');
  const status = url.searchParams.get('status');
  const subtype = url.searchParams.get('subtype');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '20'), 1), 100);

  if (kind && !['REQUEST', 'INCIDENT'].includes(kind)) {
    return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
  }
  if (status && !isReportStatus(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }
  if (subtype && subtype.length > 50) {
    return NextResponse.json({ error: 'invalid subtype' }, { status: 400 });
  }

  // Build the WHERE fragment with all 3 filter axes (kind, status,
  // subtype). With tagged templates this would need 8 branches
  // (2^3); $queryRawUnsafe is cleaner here. Every interpolated
  // value is either a server-signed UUID, an enum-validated string,
  // a length-bounded string (subtype, max 50 chars), or a number
  // (limit, validated 1-100). All values are single-quoted and
  // single-quote-escaped so user-controlled input can't break out.
  interface ReportRow {
    id: string;
    kind: string;
    type: string;
    subtype: string | null;
    severity: string | null;
    title: string;
    description: string | null;
    location: unknown;
    status: string;
    trip_id: string | null;
    shift_id: string | null;
    acknowledged_by: string | null;
    acknowledged_at: Date | null;
    resolved_by: string | null;
    resolved_at: Date | null;
    resolution_notes: string | null;
    cancelled_by: string | null;
    cancelled_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }

  // Single-quote escape: replace every ' with '' (SQL standard)
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

  const whereParts: string[] = [
    `tenant_id = ${q(ctx.tenantId)}::uuid`,
    `driver_id = ${q(ctx.userId)}::uuid`,
  ];
  if (kind)    whereParts.push(`kind = ${q(kind)}`);
  if (status)  whereParts.push(`status = ${q(status)}`);
  if (subtype) whereParts.push(`subtype = ${q(subtype)}`);

  const sql = `
    SELECT id, kind, type, subtype, severity, title, description, location,
           status, trip_id, shift_id,
           acknowledged_by, acknowledged_at,
           resolved_by, resolved_at, resolution_notes,
           cancelled_by, cancelled_at,
           created_at, updated_at
    FROM driver_reports
    WHERE ${whereParts.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  const rows = await prisma.$queryRawUnsafe<ReportRow[]>(sql);

  return NextResponse.json(
    {
      reports: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        type: r.type,
        subtype: r.subtype,
        severity: r.severity,
        title: r.title,
        description: r.description,
        location: r.location,
        status: r.status,
        tripId: r.trip_id,
        shiftId: r.shift_id,
        acknowledgedBy: r.acknowledged_by,
        acknowledgedAt: r.acknowledged_at?.toISOString() ?? null,
        resolvedBy: r.resolved_by,
        resolvedAt: r.resolved_at?.toISOString() ?? null,
        resolutionNotes: r.resolution_notes,
        cancelledBy: r.cancelled_by,
        cancelledAt: r.cancelled_at?.toISOString() ?? null,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      })),
      generatedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': privateCacheControl(15, 30) } },
  );
}
