export const dynamic = 'force-dynamic';

/**
 * Driver Management Hub — /api/drivers/[id]
 *
 * GET    — fetch a single driver with compliance status, user linkage, and additional documents
 * PATCH  — update driver identity, category, employeeId, issuing authority, additional docs, & reset password
 * DELETE — soft-delete (set deletedAt)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { hashPassword, validatePasswordPolicy } from '@/lib/password-policy';

type Params = { params: Promise<{ id: string }> };

function parseSafeDate(val: unknown): Date | null {
  if (!val || (typeof val === 'string' && !val.trim())) return null;
  const d = new Date(val as string);
  return isNaN(d.getTime()) ? null : d;
}

function emptyToNull(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed === '' ? null : trimmed;
  }
  return String(val);
}

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

export async function GET(_req: NextRequest, { params }: Params) {
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { id } = await params;
      const driver = await tx.driver.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!driver) {
        return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
      }

      const extraRows = await tx.$queryRawUnsafe<Array<{
        employee_id: string | null;
        driver_category: string | null;
        issuing_authority: string | null;
        additional_documents: unknown;
      }>>(
        `SELECT employee_id, driver_category, issuing_authority, additional_documents FROM drivers WHERE id::text = $1 LIMIT 1`,
        id,
      ).catch(() => []);
      const extra = extraRows[0];

      // Check for linked user
      const linkedUser = await tx.user.findFirst({
        where: {
          OR: [
            ...(driver.email ? [{ email: { equals: driver.email, mode: 'insensitive' as const } }] : []),
            ...(extra?.employee_id ? [{ employeeId: extra.employee_id }] : []),
            ...(driver.contactNumber ? [{ mobileNumber: driver.contactNumber }] : []),
          ],
        },
        select: { id: true, username: true, email: true, employeeId: true, isActive: true },
      });

      return NextResponse.json(
        serialize({
          ...driver,
          employeeId: extra?.employee_id ?? null,
          driverCategory: extra?.driver_category || driver.licenseType || 'LIGHT_DUTY',
          issuingAuthority: extra?.issuing_authority ?? null,
          additionalDocuments: extra?.additional_documents ?? [],
          linkedUser: linkedUser || null,
          compliance: complianceFlags(driver),
        })
      );
    } catch (e) {
      console.error('[Driver Hub] GET /api/drivers/[id]:', e);
      return NextResponse.json({ error: 'Failed to fetch driver' }, { status: 500 });
    }
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { id } = await params;
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      const {
        name, firstName, lastName, email, contactNumber, nationality, dob,
        licenseNumber, licenseExpiry, licenseType, driverCategory, employeeId,
        emiratesId, emiratesIdExpiry,
        passportNumber, passportExpiry,
        visaExpiry,
        status, driverType, hierarchy, communicationLanguage, dateOfJoin, dallasId, garageId,
        assignedVehicleId,
        password,
        issuingAuthority,
        additionalDocuments,
      } = body;

      // Validate password upfront before any DB mutations
      if (password && typeof password === 'string' && password.trim()) {
        const pwCheck = validatePasswordPolicy(password.trim());
        if (!pwCheck.ok) {
          return NextResponse.json({ error: 'Password policy error: ' + pwCheck.error }, { status: 400 });
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = {};

      if (name !== undefined && typeof name === 'string') {
        const trimmedName = name.trim();
        data.name = trimmedName;
        // Derive firstName & lastName from full name so table and Driver App stay in sync
        const parts = trimmedName.split(/\s+/);
        data.firstName = parts[0] || '';
        data.lastName = parts.slice(1).join(' ');
      } else {
        if (firstName !== undefined) data.firstName = typeof firstName === 'string' ? firstName.trim() : firstName;
        if (lastName  !== undefined) data.lastName  = typeof lastName === 'string' ? lastName.trim() : lastName;
        if (firstName !== undefined || lastName !== undefined) {
          data.name = [data.firstName, data.lastName].filter(Boolean).join(' ') || null;
        }
      }

      if (email           !== undefined) data.email           = emptyToNull(email);
      if (contactNumber   !== undefined) data.contactNumber   = emptyToNull(contactNumber);
      if (nationality     !== undefined) data.nationality     = emptyToNull(nationality);
      if (dob             !== undefined) data.dob             = parseSafeDate(dob);
      if (licenseNumber   !== undefined) data.licenseNumber   = emptyToNull(licenseNumber) ?? '';
      if (licenseExpiry   !== undefined) data.licenseExpiry   = parseSafeDate(licenseExpiry);
      if (driverCategory  !== undefined || licenseType !== undefined) {
        data.licenseType = emptyToNull(driverCategory || licenseType);
      }
      if (emiratesId      !== undefined) data.emiratesId      = emptyToNull(emiratesId);
      if (emiratesIdExpiry !== undefined) data.emiratesIdExpiry = parseSafeDate(emiratesIdExpiry);
      if (passportNumber  !== undefined) data.passportNumber  = emptyToNull(passportNumber);
      if (passportExpiry  !== undefined) data.passportExpiry  = parseSafeDate(passportExpiry);
      if (visaExpiry      !== undefined) data.visaExpiry      = parseSafeDate(visaExpiry);
      if (status          !== undefined) data.status          = emptyToNull(status) ?? 'ACTIVE';
      if (driverType      !== undefined) data.driverType      = emptyToNull(driverType) ?? 'PERMANENT';
      if (hierarchy       !== undefined) data.hierarchy       = emptyToNull(hierarchy);
      if (communicationLanguage !== undefined) data.communicationLanguage = emptyToNull(communicationLanguage);
      if (dateOfJoin      !== undefined) data.dateOfJoin      = parseSafeDate(dateOfJoin);
      if (dallasId        !== undefined) data.dallasId        = emptyToNull(dallasId);
      if (garageId        !== undefined) data.garageId        = emptyToNull(garageId);
      if (assignedVehicleId !== undefined) data.assignedVehicleId = emptyToNull(assignedVehicleId);

      const updated = await tx.driver.update({ where: { id }, data });

      if (assignedVehicleId !== undefined) {
        const nextVehId = emptyToNull(assignedVehicleId);
        // Clear this driver from any other vehicle
        await tx.$executeRawUnsafe(
          `UPDATE vehicles SET assigned_driver_id = NULL WHERE assigned_driver_id::text = $1 AND ($2::text IS NULL OR id::text != $2) AND tenant_id = $3`,
          id,
          nextVehId,
          tenantId,
        ).catch(() => {});
        if (nextVehId) {
          // Clear any other driver that had this vehicle
          await tx.$executeRawUnsafe(
            `UPDATE drivers SET assigned_vehicle_id = NULL WHERE assigned_vehicle_id::text = $1 AND id::text != $2 AND tenant_id = $3`,
            nextVehId,
            id,
            tenantId,
          ).catch(() => {});
          // Assign this driver to the vehicle
          await tx.$executeRawUnsafe(
            `UPDATE vehicles SET assigned_driver_id = $1 WHERE id::text = $2 AND tenant_id = $3`,
            id,
            nextVehId,
            tenantId,
          ).catch(() => {});
        }
      }

      const cleanEmployeeId = employeeId !== undefined ? emptyToNull(employeeId) : undefined;
      const cleanCategory = driverCategory !== undefined ? emptyToNull(driverCategory) : undefined;
      const cleanAuthority = issuingAuthority !== undefined ? emptyToNull(issuingAuthority) : undefined;

      // Update extra columns (employee_id, driver_category, issuing_authority, additional_documents)
      if (cleanEmployeeId !== undefined || cleanCategory !== undefined || cleanAuthority !== undefined || additionalDocuments !== undefined) {
        await tx.$executeRawUnsafe(
          `UPDATE drivers SET 
             employee_id = CASE WHEN $6 THEN $1 ELSE employee_id END, 
             driver_category = COALESCE($2, driver_category),
             issuing_authority = COALESCE($3, issuing_authority),
             additional_documents = COALESCE($4::jsonb, additional_documents)
           WHERE id::text = $5`,
          cleanEmployeeId ?? null,
          cleanCategory ?? null,
          cleanAuthority ?? null,
          additionalDocuments !== undefined ? JSON.stringify(additionalDocuments) : null,
          id,
          cleanEmployeeId !== undefined,
        ).catch((err) => { console.warn('Failed to update extra driver fields:', err); });
      }

      // Synchronize / provision linked User Profile without risking rollback of driver update on non-critical conflicts
      let linkedUser: { id: string; email: string; username: string | null } | null = null;
      try {
        const lookupOr: Prisma.UserWhereInput[] = [
          ...(updated.email ? [{ email: { equals: updated.email, mode: 'insensitive' as const } }] : []),
          ...(cleanEmployeeId ? [{ employeeId: cleanEmployeeId }] : []),
          ...(updated.contactNumber ? [{ mobileNumber: updated.contactNumber }] : []),
        ];

        const existingUser = lookupOr.length > 0
          ? await tx.user.findFirst({ where: { OR: lookupOr } })
          : null;

        if (!existingUser && (password || updated.email)) {
          const cleanLic = (updated.licenseNumber || id.slice(0, 8)).toLowerCase().replace(/[^a-z0-9]/g, '');
          const targetEmail = (updated.email && updated.email.trim())
            ? updated.email.trim().toLowerCase()
            : `driver.${cleanLic}@fleet360.internal`;
          const targetUsername = updated.email ? updated.email.split('@')[0] : `driver_${cleanLic}`;

          const newUserId = crypto.randomUUID();
          const createdUser = await tx.user.create({
            data: {
              id: newUserId,
              username: targetUsername,
              email: targetEmail,
              firstName: updated.firstName || (updated.name ? updated.name.split(' ')[0] : 'Driver'),
              lastName: updated.lastName || '',
              mobileNumber: updated.contactNumber || null,
              userType: 'DRIVER',
              position: 'Driver',
              employeeId: cleanEmployeeId || null,
              hierarchy: updated.hierarchy || null,
              isActive: updated.status !== 'INACTIVE',
              updatedAt: new Date(),
            },
          });
          linkedUser = { id: createdUser.id, email: createdUser.email, username: createdUser.username };

          const role = await tx.role.findFirst({
            where: {
              AND: [
                { OR: [{ code: 'DRIVER' }, { name: { contains: 'Driver', mode: 'insensitive' } }] },
                { OR: [{ tenantId }, { tenantId: null }] },
              ],
            },
          });

          if (role) {
            await tx.userTenant.upsert({
              where: { userId_tenantId: { userId: createdUser.id, tenantId } },
              update: { roleId: role.id, isActive: true },
              create: { userId: createdUser.id, tenantId, roleId: role.id, isActive: true },
            });
          }
        } else if (existingUser) {
          const updatedUser = await tx.user.update({
            where: { id: existingUser.id },
            data: {
              firstName: updated.firstName || existingUser.firstName,
              lastName: updated.lastName ?? existingUser.lastName,
              mobileNumber: updated.contactNumber ?? existingUser.mobileNumber,
              employeeId: cleanEmployeeId !== undefined ? cleanEmployeeId : existingUser.employeeId,
              hierarchy: updated.hierarchy ?? existingUser.hierarchy,
              userType: 'DRIVER',
              isActive: updated.status !== 'INACTIVE',
              updatedAt: new Date(),
            },
          });
          linkedUser = { id: updatedUser.id, email: updatedUser.email, username: updatedUser.username };
        }

        // If password provided, update password hash
        if (password && typeof password === 'string' && password.trim() && linkedUser) {
          const hashed = hashPassword(password.trim());
          await tx.$executeRawUnsafe(
            `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
            hashed,
            linkedUser.id,
          );
        }
      } catch (userSyncErr) {
        console.warn('[Driver Hub] Non-fatal linked user sync warning:', userSyncErr);
      }

      return NextResponse.json(
        serialize({
          ...updated,
          employeeId: cleanEmployeeId ?? null,
          driverCategory: cleanCategory || updated.licenseType || 'LIGHT_DUTY',
          issuingAuthority: cleanAuthority ?? null,
          additionalDocuments: additionalDocuments ?? [],
          linkedUser,
          compliance: complianceFlags(updated),
        })
      );
    } catch (e: unknown) {
      console.error('[Driver Hub] PATCH /api/drivers/[id] error:', e);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const rawTarget = e.meta?.target;
        const target = Array.isArray(rawTarget) ? rawTarget.join(', ') : String(rawTarget || 'field');
        if (target.includes('license') || target.includes('licenseNumber')) {
          return NextResponse.json({ error: 'A driver with this License Number already exists.' }, { status: 400 });
        }
        if (target.includes('email')) {
          return NextResponse.json({ error: 'A user account with this email address already exists.' }, { status: 400 });
        }
        if (target.includes('employeeId')) {
          return NextResponse.json({ error: 'A user or driver with this Employee ID already exists.' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Unique constraint conflict on ' + target + '.' }, { status: 400 });
      }
      return NextResponse.json({ error: (e instanceof Error && e.message) || 'Failed to update driver' }, { status: 500 });
    }
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const permanent = _req.nextUrl.searchParams.get('permanent') === 'true';

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { id } = await params;
      if (permanent) {
        await tx.driver.update({
          where: { id },
          data:  { status: 'RETIRING', deletedAt: new Date() },
        });
        return NextResponse.json({ success: true, message: 'Driver permanently deleted' });
      }
      await tx.driver.update({
        where: { id },
        data:  { status: 'INACTIVE', deletedAt: null },
      });
      return NextResponse.json({ success: true, message: 'Driver deactivated (Status set to INACTIVE)' });
    } catch (e) {
      console.error('[Driver Hub] DELETE /api/drivers/[id]:', e);
      return NextResponse.json({ error: 'Failed to deactivate driver' }, { status: 500 });
    }
  });
}
