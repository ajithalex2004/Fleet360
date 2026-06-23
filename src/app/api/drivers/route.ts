/**
 * Driver Management Hub — /api/drivers
 *
 * The Driver Hub is the single source of truth for all driver identity
 * and compliance data. Operational modules (Booking, Staff, School Bus,
 * Incident) READ drivers from here but NEVER maintain their own copies.
 *
 * GET  /api/drivers  — list all drivers (filterable + compliance enriched)
 * POST /api/drivers  — create a new driver (Driver Hub only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  attachTenantToEntity,
  ensureOperationalTenantColumn,
  recordOperationalChange,
  requireOperationalContext,
  tenantScopedIds,
} from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

function serialize(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serialize);
  if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, serialize(v)])
    );
  }
  return obj;
}

/** Compute compliance status for a driver's documents */
function complianceFlags(d: {
  licenseExpiry?: Date | null;
  emiratesIdExpiry?: Date | null;
  passportExpiry?: Date | null;
  visaExpiry?: Date | null;
}) {
  const now = Date.now();
  const threshold = now + 30 * 86400000;
  const check = (dt: Date | null | undefined) => {
    if (!dt) return 'missing';
    const t = dt.getTime();
    if (t < now) return 'expired';
    if (t < threshold) return 'expiring_soon';
    return 'valid';
  };
  const statuses = [
    check(d.licenseExpiry),
    check(d.emiratesIdExpiry),
    check(d.passportExpiry),
    check(d.visaExpiry),
  ];
  return {
    license:    check(d.licenseExpiry),
    emiratesId: check(d.emiratesIdExpiry),
    passport:   check(d.passportExpiry),
    visa:       check(d.visaExpiry),
    hasIssues:  statuses.some(s => s !== 'valid'),
    alertLevel: statuses.includes('expired')       ? 'critical'
              : statuses.includes('expiring_soon') ? 'warning'
              : statuses.includes('missing')       ? 'incomplete'
              : 'ok',
  };
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const ctx = requireOperationalContext(request, 'drivers', { requestedTenantId: sp.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('drivers');

    const status   = sp.get('status');
    const type     = sp.get('driverType');
    const search   = sp.get('search');
    const expiring = sp.get('expiring'); // 'true' → only compliance-issue drivers

    const ids = await tenantScopedIds('drivers', ctx.tenantId, { activeOnly: true });
    if (ids.length === 0) return NextResponse.json([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { deletedAt: null };
    where.id = { in: ids };
    if (status) where.status     = status;
    if (type)   where.driverType = type;
    if (search) {
      where.OR = [
        { name:          { contains: search, mode: 'insensitive' } },
        { firstName:     { contains: search, mode: 'insensitive' } },
        { lastName:      { contains: search, mode: 'insensitive' } },
        { licenseNumber: { contains: search, mode: 'insensitive' } },
        { email:         { contains: search, mode: 'insensitive' } },
        { contactNumber: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (expiring === 'true') {
      const threshold = new Date(Date.now() + 30 * 86400000);
      where.OR = [
        { licenseExpiry:    { lte: threshold } },
        { emiratesIdExpiry: { lte: threshold } },
        { passportExpiry:   { lte: threshold } },
        { visaExpiry:       { lte: threshold } },
      ];
    }

    const drivers = await prisma.driver.findMany({
      where,
      include: {
        assignedVehicle: {
          select: { id: true, make: true, model: true, licensePlate: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const enriched = drivers.map(d => ({
      ...d,
      compliance: complianceFlags(d),
    }));

    return NextResponse.json(serialize(enriched));
  } catch (error) {
    console.error('[Driver Hub] GET /api/drivers:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = requireOperationalContext(request, 'drivers', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('drivers');

    const body = await request.json();

    // Required fields
    const missing: string[] = [];
    if (!body.name && !body.firstName) missing.push('name or firstName');
    if (!body.licenseNumber)           missing.push('licenseNumber');
    if (missing.length) {
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(', ')}` },
        { status: 400 }
      );
    }

    const fullName = body.name
      ?? [body.firstName, body.lastName].filter(Boolean).join(' ')
      ?? null;

    const driver = await prisma.driver.create({
      data: {
        // Identity
        name:                  fullName,
        firstName:             body.firstName              ?? null,
        lastName:              body.lastName               ?? null,
        email:                 body.email                  ?? null,
        contactNumber:         body.contactNumber          ?? null,
        nationality:           body.nationality            ?? null,
        dob:                   body.dob ? new Date(body.dob) : null,

        // Licence & Compliance (hub core)
        licenseNumber:         body.licenseNumber,
        licenseExpiry:         body.licenseExpiry     ? new Date(body.licenseExpiry)     : null,
        licenseType:           body.licenseType            ?? null,
        emiratesId:            body.emiratesId             ?? null,
        emiratesIdExpiry:      body.emiratesIdExpiry  ? new Date(body.emiratesIdExpiry)  : null,
        passportNumber:        body.passportNumber         ?? null,
        passportExpiry:        body.passportExpiry    ? new Date(body.passportExpiry)    : null,
        visaExpiry:            body.visaExpiry        ? new Date(body.visaExpiry)        : null,

        // Organisational
        status:                body.status                 ?? 'ACTIVE',
        driverType:            body.driverType             ?? null,
        hierarchy:             body.hierarchy              ?? null,
        communicationLanguage: body.communicationLanguage  ?? null,
        dateOfJoin:            body.dateOfJoin       ? new Date(body.dateOfJoin)        : null,
        dallasId:              body.dallasId               ?? null,
        garageId:              body.garageId               ?? null,
      },
    });
    await attachTenantToEntity('drivers', driver.id, ctx.tenantId);
    await recordOperationalChange({
      req: request,
      ctx,
      entityType: 'Driver',
      entityId: driver.id,
      action: 'CREATE',
      after: driver,
      summary: `Created driver ${driver.name ?? driver.licenseNumber ?? driver.id}`,
    });

    const workflow = await triggerServiceWorkflow({
      req: request,
      ctx,
      serviceTypeKey: 'DRIVER_ONBOARDING',
      referenceType: 'Driver',
      referenceId: driver.id,
      referenceNumber: driver.licenseNumber ?? driver.id,
      contextData: {
        driverId: driver.id,
        driverName: driver.name,
        driverType: driver.driverType,
        status: driver.status,
      },
    });

    return NextResponse.json(serialize({ ...driver, workflow }), { status: 201 });
  } catch (error) {
    console.error('[Driver Hub] POST /api/drivers:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: String(error) },
      { status: 500 }
    );
  }
}
