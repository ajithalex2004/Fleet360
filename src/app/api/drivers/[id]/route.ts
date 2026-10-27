export const dynamic = 'force-dynamic';

/**
 * Driver Management Hub — /api/drivers/[id]
 *
 * GET    — fetch a single driver with compliance status, user linkage, and additional documents
 * PATCH  — update driver identity, category, employeeId, issuing authority, additional docs, & reset password
 * DELETE — soft-delete (set deletedAt)
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { hashPassword, validatePasswordPolicy } from '@/lib/password-policy';

type Params = { params: Promise<{ id: string }> };

function parseSafeDate(val: unknown): Date | null {
  if (!val) return null;
  const d = new Date(val as string);
  return isNaN(d.getTime()) ? null : d;
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
        additional_documents: any | null;
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
        password,
        issuingAuthority,
        additionalDocuments,
      } = body;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = {};

      if (name            !== undefined) data.name            = name;
      if (firstName       !== undefined) data.firstName       = firstName;
      if (lastName        !== undefined) data.lastName        = lastName;
      if (email           !== undefined) data.email           = email;
      if (contactNumber   !== undefined) data.contactNumber   = contactNumber;
      if (nationality     !== undefined) data.nationality     = nationality;
      if (dob !== undefined) data.dob = parseSafeDate(dob);
      if (licenseNumber   !== undefined) data.licenseNumber   = licenseNumber;
      if (licenseExpiry !== undefined) data.licenseExpiry = parseSafeDate(licenseExpiry);
      if (driverCategory  !== undefined || licenseType !== undefined) {
        data.licenseType = driverCategory || licenseType;
      }
      if (emiratesId      !== undefined) data.emiratesId      = emiratesId;
      if (emiratesIdExpiry !== undefined) data.emiratesIdExpiry = parseSafeDate(emiratesIdExpiry);
      if (passportNumber  !== undefined) data.passportNumber  = passportNumber;
      if (passportExpiry !== undefined) data.passportExpiry = parseSafeDate(passportExpiry);
      if (visaExpiry !== undefined) data.visaExpiry = parseSafeDate(visaExpiry);
      if (status          !== undefined) data.status          = status;
      if (driverType      !== undefined) data.driverType      = driverType;
      if (hierarchy       !== undefined) data.hierarchy       = hierarchy;
      if (communicationLanguage !== undefined) data.communicationLanguage = communicationLanguage;
      if (dateOfJoin !== undefined) data.dateOfJoin = parseSafeDate(dateOfJoin);
      if (dallasId        !== undefined) data.dallasId        = dallasId;
      if (garageId        !== undefined) data.garageId        = garageId;

      const updated = await tx.driver.update({ where: { id }, data });

      // Update extra columns (employee_id, driver_category, issuing_authority, additional_documents)
      if (employeeId !== undefined || driverCategory !== undefined || issuingAuthority !== undefined || additionalDocuments !== undefined) {
        await tx.$executeRawUnsafe(
          `UPDATE drivers SET 
             employee_id = COALESCE($1, employee_id), 
             driver_category = COALESCE($2, driver_category),
             issuing_authority = COALESCE($3, issuing_authority),
             additional_documents = COALESCE($4::jsonb, additional_documents)
           WHERE id::text = $5`,
          employeeId ?? null,
          driverCategory ?? null,
          issuingAuthority ?? null,
          additionalDocuments !== undefined ? JSON.stringify(additionalDocuments) : null,
          id,
        ).catch((err) => { console.warn('Failed to update extra driver fields:', err); });
      }

      // If password provided or driver details changed, update / create linked User Profile
      let linkedUser = await tx.user.findFirst({
        where: {
          OR: [
            ...(updated.email ? [{ email: { equals: updated.email, mode: 'insensitive' as const } }] : []),
            ...(employeeId ? [{ employeeId }] : []),
            ...(updated.contactNumber ? [{ mobileNumber: updated.contactNumber }] : []),
          ],
        },
      });

      if (!linkedUser && (password || email)) {
        const cleanLic = (updated.licenseNumber || id.slice(0, 8)).toLowerCase().replace(/[^a-z0-9]/g, '');
        const targetEmail = (updated.email && updated.email.trim())
          ? updated.email.trim().toLowerCase()
          : `driver.${cleanLic}@fleet360.internal`;
        const targetUsername = updated.email ? updated.email.split('@')[0] : `driver_${cleanLic}`;

        const newUserId = crypto.randomUUID();
        linkedUser = await tx.user.create({
          data: {
            id: newUserId,
            username: targetUsername,
            email: targetEmail,
            firstName: updated.firstName || (updated.name ? updated.name.split(' ')[0] : 'Driver'),
            lastName: updated.lastName || '',
            mobileNumber: updated.contactNumber || null,
            userType: 'DRIVER',
            position: 'Driver',
            employeeId: employeeId || null,
            hierarchy: updated.hierarchy || null,
            isActive: updated.status !== 'INACTIVE',
            updatedAt: new Date(),
          },
        });

        const role = await tx.role.findFirst({
          where: {
            OR: [{ code: 'DRIVER' }, { name: { contains: 'Driver', mode: 'insensitive' } }],
            OR: [{ tenantId }, { tenantId: null }],
          },
        }) || await tx.role.findFirst({ where: { OR: [{ tenantId }, { tenantId: null }] } });

        if (role) {
          await tx.userTenant.upsert({
            where: { userId_tenantId: { userId: linkedUser.id, tenantId } },
            update: { roleId: role.id, isActive: true },
            create: { userId: linkedUser.id, tenantId, roleId: role.id, isActive: true },
          });
        }
      } else if (linkedUser) {
        // Sync contact & hierarchy updates
        await tx.user.update({
          where: { id: linkedUser.id },
          data: {
            mobileNumber: updated.contactNumber ?? linkedUser.mobileNumber,
            employeeId: employeeId ?? linkedUser.employeeId,
            hierarchy: updated.hierarchy ?? linkedUser.hierarchy,
            userType: 'DRIVER',
            isActive: updated.status !== 'INACTIVE',
          },
        });
      }

      // Validate password if provided
      if (password && typeof password === 'string' && password.trim()) {
        const pwCheck = validatePasswordPolicy(password.trim());
        if (!pwCheck.ok) {
          return NextResponse.json({ error: 'Password policy error: ' + pwCheck.error }, { status: 400 });
        }
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

      return NextResponse.json(
        serialize({
          ...updated,
          employeeId: employeeId ?? null,
          driverCategory: driverCategory || updated.licenseType || 'LIGHT_DUTY',
          issuingAuthority: issuingAuthority ?? null,
          additionalDocuments: additionalDocuments ?? [],
          linkedUser: linkedUser ? { id: linkedUser.id, email: linkedUser.email, username: linkedUser.username } : null,
          compliance: complianceFlags(updated),
        })
      );
    } catch (e: any) {
      console.error('[Driver Hub] PATCH /api/drivers/[id] error:', e);
      if (e?.code === 'P2002') {
        const target = Array.isArray(e.meta?.target) ? e.meta.target.join(', ') : String(e.meta?.target || 'field');
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
      return NextResponse.json({ error: e?.message || 'Failed to update driver' }, { status: 500 });
    }
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { id } = await params;
      await tx.driver.update({
        where: { id },
        data:  { deletedAt: new Date() },
      });
      return NextResponse.json({ success: true, message: 'Driver deactivated' });
    } catch (e) {
      console.error('[Driver Hub] DELETE /api/drivers/[id]:', e);
      return NextResponse.json({ error: 'Failed to deactivate driver' }, { status: 500 });
    }
  });
}
