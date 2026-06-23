/**
 * Driver Management Hub — /api/drivers/[id]
 *
 * GET    — fetch a single driver with compliance status
 * PATCH  — update driver identity/compliance fields (hub owner)
 * DELETE — soft-delete (set deletedAt)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  assertStatusTransition,
  ensureOperationalTenantColumn,
  recordOperationalChange,
  requireOperationalContext,
} from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

type Params = { params: Promise<{ id: string }> };

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

async function driverBelongsToTenant(id: string, tenantId: string) {
  await ensureOperationalTenantColumn('drivers');
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id FROM drivers WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
    id,
    tenantId,
  );
  return rows.length > 0;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'drivers');
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await driverBelongsToTenant(id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
    }
    const driver = await prisma.driver.findFirst({
      where: { id, deletedAt: null },
      include: {
        assignedVehicle: {
          select: { id: true, make: true, model: true, licensePlate: true, status: true },
        },
      },
    });
    if (!driver) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
    }
    return NextResponse.json(serialize({ ...driver, compliance: complianceFlags(driver) }));
  } catch (error) {
    console.error('[Driver Hub] GET /api/drivers/[id]:', error);
    return NextResponse.json({ error: 'Failed to fetch driver' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'drivers', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const body   = await req.json();
    if (!(await driverBelongsToTenant(id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
    }
    const before = await prisma.driver.findUnique({ where: { id } });
    if (!before) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
    }

    // Separate hub fields from operational assignment fields
    // Modules are allowed to update assignedVehicleId (operational assignment)
    const {
      // Identity
      name, firstName, lastName, email, contactNumber, nationality, dob,
      // Licence & compliance
      licenseNumber, licenseExpiry, licenseType,
      emiratesId, emiratesIdExpiry,
      passportNumber, passportExpiry,
      visaExpiry,
      // Organisational
      status, driverType, hierarchy, communicationLanguage, dateOfJoin, dallasId, garageId,
      // Operational assignment (allowed from modules)
      assignedVehicleId,
    } = body;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {};

    // Only include defined fields (don't overwrite with undefined)
    if (name            !== undefined) data.name            = name;
    if (firstName       !== undefined) data.firstName       = firstName;
    if (lastName        !== undefined) data.lastName        = lastName;
    if (email           !== undefined) data.email           = email;
    if (contactNumber   !== undefined) data.contactNumber   = contactNumber;
    if (nationality     !== undefined) data.nationality     = nationality;
    if (dob             !== undefined) data.dob             = dob ? new Date(dob) : null;
    if (licenseNumber   !== undefined) data.licenseNumber   = licenseNumber;
    if (licenseExpiry   !== undefined) data.licenseExpiry   = licenseExpiry ? new Date(licenseExpiry) : null;
    if (licenseType     !== undefined) data.licenseType     = licenseType;
    if (emiratesId      !== undefined) data.emiratesId      = emiratesId;
    if (emiratesIdExpiry!== undefined) data.emiratesIdExpiry= emiratesIdExpiry ? new Date(emiratesIdExpiry) : null;
    if (passportNumber  !== undefined) data.passportNumber  = passportNumber;
    if (passportExpiry  !== undefined) data.passportExpiry  = passportExpiry ? new Date(passportExpiry) : null;
    if (visaExpiry      !== undefined) data.visaExpiry      = visaExpiry ? new Date(visaExpiry) : null;
    if (status          !== undefined) data.status          = status;
    if (driverType      !== undefined) data.driverType      = driverType;
    if (hierarchy       !== undefined) data.hierarchy       = hierarchy;
    if (communicationLanguage !== undefined) data.communicationLanguage = communicationLanguage;
    if (dateOfJoin      !== undefined) data.dateOfJoin      = dateOfJoin ? new Date(dateOfJoin) : null;
    if (dallasId        !== undefined) data.dallasId        = dallasId;
    if (garageId        !== undefined) data.garageId        = garageId;
    if (assignedVehicleId !== undefined) data.assignedVehicleId = assignedVehicleId;

    const transition = assertStatusTransition('driver', before.status, data.status);
    if (transition) return transition;

    const updated = await prisma.driver.update({ where: { id }, data });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'Driver',
      entityId: id,
      action: data.status !== undefined && data.status !== before.status ? 'STATUS_CHANGE' : 'UPDATE',
      before,
      after: updated,
      summary: `Updated driver ${updated.name ?? updated.licenseNumber ?? id}`,
    });

    const workflowEvents = [];
    if (assignedVehicleId !== undefined && assignedVehicleId !== before.assignedVehicleId) {
      workflowEvents.push(await triggerServiceWorkflow({
        req,
        ctx,
        serviceTypeKey: 'DRIVER_ASSIGNMENT',
        referenceType: 'Driver',
        referenceId: id,
        referenceNumber: updated.licenseNumber ?? id,
        contextData: {
          driverId: id,
          assignedVehicleId: updated.assignedVehicleId,
          previousAssignedVehicleId: before.assignedVehicleId,
          status: updated.status,
        },
      }));
    }

    const complianceFieldsTouched = [
      licenseNumber,
      licenseExpiry,
      emiratesId,
      emiratesIdExpiry,
      passportNumber,
      passportExpiry,
      visaExpiry,
    ].some(value => value !== undefined);

    if (complianceFieldsTouched) {
      workflowEvents.push(await triggerServiceWorkflow({
        req,
        ctx,
        serviceTypeKey: 'DRIVER_LICENSE_RENEWAL',
        referenceType: 'Driver',
        referenceId: id,
        referenceNumber: updated.licenseNumber ?? id,
        contextData: {
          driverId: id,
          licenseExpiry: updated.licenseExpiry,
          emiratesIdExpiry: updated.emiratesIdExpiry,
          passportExpiry: updated.passportExpiry,
          visaExpiry: updated.visaExpiry,
        },
      }));
    }

    return NextResponse.json(serialize({
      ...updated,
      compliance: complianceFlags(updated),
      workflowEvents,
    }));
  } catch (error) {
    console.error('[Driver Hub] PATCH /api/drivers/[id]:', error);
    return NextResponse.json({ error: 'Failed to update driver' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'drivers', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await driverBelongsToTenant(id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
    }
    const before = await prisma.driver.findUnique({ where: { id } });
    const updated = await prisma.driver.update({
      where: { id },
      data:  { deletedAt: new Date() },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'Driver',
      entityId: id,
      action: 'DELETE',
      before,
      after: updated,
      summary: `Deactivated driver ${updated.name ?? updated.licenseNumber ?? id}`,
    });
    return NextResponse.json({ success: true, message: 'Driver deactivated' });
  } catch (error) {
    console.error('[Driver Hub] DELETE /api/drivers/[id]:', error);
    return NextResponse.json({ error: 'Failed to deactivate driver' }, { status: 500 });
  }
}
