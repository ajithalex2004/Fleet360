export const dynamic = 'force-dynamic';

/**
 * Driver Management Hub — /api/drivers
 *
 * Single source of truth for all driver identity & compliance data.
 * When a driver is created in Driver Hub, this endpoint also provisions
 * a linked User account with userType='DRIVER' and sets the initial password.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { withTenantRls, withPlatformAdmin } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { findLinkableDriverUser, syncDriverUserForeignKey } from '@/lib/drivers/driver-login-user';
import { hashPassword, validatePasswordPolicy } from '@/lib/password-policy';

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
  const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const sp = request.nextUrl.searchParams;

  // Give this tenant's driver users a driver profile if they have none.
  // (Table names are user_tenants / tenants / roles: the "UserTenant" /
  // "Tenant" / "Role" spelling this used before never matched, so the
  // statement failed and its error was swallowed.)
  // Only the caller's own tenant: this used to match users in every tenant
  // whose tenant name, hierarchy or email contained "trexla", with
  // platform-admin rights, and write drivers for them on a plain GET.
  await withPlatformAdmin(prisma, async (adminTx) => {
    await adminTx.$executeRawUnsafe(
      `INSERT INTO drivers (
         id, tenant_id, user_id, name, first_name, last_name, email, contact_number,
         employee_id, license_number, status, driver_type, hierarchy, created_at, updated_at
       )
       SELECT
         u.id,
         $1,
         u.id,
         COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", ''))), ''), u.username, 'Driver'),
         COALESCE(u."firstName", SPLIT_PART(u.username, '_', 1), 'Driver'),
         COALESCE(u."lastName", ''),
         u.email,
         u."mobileNumber",
         u."employeeId",
         COALESCE(u."employeeId", CONCAT('LIC-', UPPER(SUBSTRING(MD5(u.id) FROM 1 FOR 6)))),
         CASE WHEN u.is_active = false THEN 'INACTIVE' ELSE 'ACTIVE' END,
         'LOGISTICS',
         COALESCE(u.hierarchy, t.name),
         NOW(),
         NOW()
       FROM "User" u
       JOIN user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = $1
       LEFT JOIN tenants t ON t.id = ut.tenant_id
       LEFT JOIN roles r ON r.id = ut.role_id
       WHERE (
         UPPER(COALESCE(u."userType", '')) = 'DRIVER'
         OR UPPER(COALESCE(r.code, '')) = 'DRIVER'
         OR LOWER(COALESCE(r.name, '')) LIKE '%driver%'
       )
       AND NOT EXISTS (
         SELECT 1 FROM drivers d
         WHERE d.deleted_at IS NULL
           AND (
             d.id::text = u.id
             OR d.user_id = u.id
             OR (d.tenant_id = $1 AND u.email IS NOT NULL AND LOWER(d.email) = LOWER(u.email))
           )
       )
       ON CONFLICT (id) DO NOTHING`,
      tenantId,
    ).catch(() => {});
  }).catch(() => {});

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      // A list request changes nothing else. It used to delete drivers whose
      // id or name matched sample patterns (a real "Rashid Al-Marri"
      // included) and to un-delete every soft-deleted driver, so deleting a
      // driver never stuck.
      const status   = sp.get('status');
      const type     = sp.get('driverType') || sp.get('assignmentType');
      const search   = sp.get('search');
      const expiring = sp.get('expiring');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { tenantId, deletedAt: null };
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
          { dallasId:      { contains: search, mode: 'insensitive' } },
          { hierarchy:     { contains: search, mode: 'insensitive' } },
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

      const tenantDrivers = await tx.driver.findMany({
        where,
        orderBy: { name: 'asc' },
      });

      // The caller's own tenant only. Other tenants' "Trexla / logistics"
      // drivers used to be merged in (names, emails, phone numbers) for any
      // caller passing includeLogistics=true, and for every SUPER_ADMIN.
      const drivers = tenantDrivers;

      // Fetch dynamic user_id, driver_category, employee_id, issuing_authority, and additional_documents from DB
      const extraRows = await tx.$queryRawUnsafe<Array<{
        id: string;
        user_id: string | null;
        employee_id: string | null;
        driver_category: string | null;
        issuing_authority: string | null;
        additional_documents: unknown;
      }>>(
        `SELECT id::text, user_id, employee_id, driver_category, issuing_authority, additional_documents FROM drivers WHERE tenant_id = $1 AND deleted_at IS NULL`,
        tenantId,
      ).catch(() => []);
      const extraMap = new Map(extraRows.map(r => [r.id, r]));

      const enriched = drivers.map(d => {
        const extra = extraMap.get(d.id);
        const driverCategory = extra?.driver_category || d.licenseType || 'LIGHT_DUTY';
        return {
          ...d,
          userId: extra?.user_id ?? null,
          employeeId: extra?.employee_id ?? null,
          driverCategory,
          issuingAuthority: extra?.issuing_authority ?? null,
          additionalDocuments: extra?.additional_documents ?? [],
          compliance: complianceFlags(d),
        };
      });

      return NextResponse.json(serialize(enriched));
    } catch (e) {
      console.error('[Driver Hub] GET /api/drivers:', e);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  });
}

export async function POST(request: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
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
        ?? 'Driver';

      const driverCategory = body.driverCategory || body.licenseType || 'LIGHT_DUTY';

      // The driver's login account, decided before anything is written: an
      // existing account is linked (and its password set) only if it is
      // plainly this tenant's driver login (src/lib/drivers/driver-login-user.ts).
      const cleanLic = body.licenseNumber.toLowerCase().replace(/[^a-z0-9]/g, '');
      const targetEmail = (body.email && body.email.trim())
        ? body.email.trim().toLowerCase()
        : `driver.${cleanLic}@fleet360.internal`;
      const targetUsername = (body.username && body.username.trim())
        ? body.username.trim().toLowerCase()
        : (body.email ? body.email.split('@')[0] : `driver_${cleanLic}`);
      const loginMatch = await findLinkableDriverUser(tenantId, {
        email: targetEmail,
        username: targetUsername,
        employeeId: body.employeeId || null,
      });
      if (loginMatch.kind === 'conflict') {
        return NextResponse.json({ error: loginMatch.message }, { status: 409 });
      }

      // 1. Create Driver Profile in Driver Hub
      const driver = await tx.driver.create({
        data: {
          tenantId,
          name:                  fullName,
          firstName:             body.firstName              ?? (fullName ? fullName.split(' ')[0] : null),
          lastName:              body.lastName               ?? (fullName ? fullName.split(' ').slice(1).join(' ') : null),
          email:                 body.email                  ?? null,
          contactNumber:         body.contactNumber          ?? null,
          nationality:           body.nationality            ?? null,
          dob:                   parseSafeDate(body.dob),

          // Licence & Compliance
          licenseNumber:         body.licenseNumber,
          licenseExpiry:         parseSafeDate(body.licenseExpiry),
          licenseType:           driverCategory,
          emiratesId:            body.emiratesId             ?? null,
          emiratesIdExpiry:      parseSafeDate(body.emiratesIdExpiry),
          passportNumber:        body.passportNumber         ?? null,
          passportExpiry:        parseSafeDate(body.passportExpiry),
          visaExpiry:            parseSafeDate(body.visaExpiry),

          // Organisational
          status:                body.status                 ?? 'ACTIVE',
          driverType:            body.driverType             ?? null,
          hierarchy:             body.hierarchy              ?? null,
          communicationLanguage: body.communicationLanguage  ?? 'English',
          dateOfJoin:            parseSafeDate(body.dateOfJoin) ?? new Date(),
          dallasId:              body.dallasId               ?? null,
          garageId:              body.garageId               ?? null,
          assignedVehicleId:     (typeof body.assignedVehicleId === 'string' && body.assignedVehicleId.trim()) ? body.assignedVehicleId.trim() : null,
        },
      });

      if (driver.assignedVehicleId) {
        await tx.$executeRawUnsafe(
          `UPDATE vehicles SET assigned_driver_id = NULL WHERE assigned_driver_id::text = $1 AND id::text != $2 AND tenant_id = $3`,
          driver.id,
          driver.assignedVehicleId,
          tenantId,
        ).catch(() => {});
        await tx.$executeRawUnsafe(
          `UPDATE vehicles SET assigned_driver_id = $1 WHERE id::text = $2 AND tenant_id = $3`,
          driver.id,
          driver.assignedVehicleId,
          tenantId,
        ).catch(() => {});
      }

      // Store extra columns (employee_id, driver_category, issuing_authority, additional_documents) directly
      await tx.$executeRawUnsafe(
        `UPDATE drivers SET 
           employee_id = $1, 
           driver_category = $2, 
           issuing_authority = $3, 
           additional_documents = $4::jsonb 
         WHERE id::text = $5`,
        body.employeeId || null,
        driverCategory,
        body.issuingAuthority || null,
        JSON.stringify(body.additionalDocuments || []),
        driver.id,
      ).catch((err) => { console.warn('Failed to update extra driver fields:', err); });

      // Validate password if provided
      if (body.password && typeof body.password === 'string' && body.password.trim()) {
        const pwCheck = validatePasswordPolicy(body.password.trim());
        if (!pwCheck.ok) {
          return NextResponse.json({ error: 'Password policy error: ' + pwCheck.error }, { status: 400 });
        }
      }

      // 2. Map Driver in User Module: link this tenant's existing driver login, or create one
      let user = loginMatch.kind === 'linkable' ? loginMatch.user : null;

      if (!user) {
        const newUserId = driver.id;
        user = await tx.user.create({
          data: {
            id:           newUserId,
            username:     targetUsername,
            email:        targetEmail,
            firstName:    body.firstName || (fullName ? fullName.split(' ')[0] : 'Driver'),
            lastName:     body.lastName  || (fullName ? fullName.split(' ').slice(1).join(' ') : ''),
            mobileNumber: body.contactNumber || null,
            userType:     'DRIVER',
            position:     'Driver',
            employeeId:   body.employeeId || null,
            hierarchy:    body.hierarchy  || null,
            isActive:     body.status !== 'INACTIVE',
            updatedAt:    new Date(),
          },
        });
      } else {
        // Update user profile with driver contact & hierarchy
        await tx.user.update({
          where: { id: user.id },
          data: {
            mobileNumber: body.contactNumber ?? user.mobileNumber,
            employeeId:   body.employeeId    ?? user.employeeId,
            hierarchy:    body.hierarchy     ?? user.hierarchy,
            userType:     'DRIVER',
            position:     user.position || 'Driver',
            isActive:     body.status !== 'INACTIVE',
          },
        });
      }

      // 3. Synchronize explicit Foreign Key (`drivers.user_id` -> `User.id`) inside the transaction
      await syncDriverUserForeignKey(tx, {
        tenantId,
        driverId: driver.id,
        userId: user.id,
      }).catch((err) => {
        console.warn('[Driver Hub] Failed to sync drivers.user_id FK:', err);
      });

      // If password provided, hash and update password_hash on the User record
      if (body.password && typeof body.password === 'string' && body.password.trim()) {
        const hashed = hashPassword(body.password.trim());
        await tx.$executeRawUnsafe(
          `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
          hashed,
          user.id,
        );
      }

      // Ensure Driver Role is assigned in userTenants
      const role = await tx.role.findFirst({
        where: {
          AND: [
            {
              OR: [
                { code: 'DRIVER' },
                { name: { contains: 'Driver', mode: 'insensitive' } },
              ],
            },
            {
              OR: [{ tenantId }, { tenantId: null }],
            },
          ],
        },
      });
      // No driver role, no membership: the "any role" fallback here could
      // give a new driver an admin role.

      if (role) {
        await tx.userTenant.upsert({
          where: { userId_tenantId: { userId: user.id, tenantId } },
          update: { roleId: role.id, isActive: true },
          create: { userId: user.id, tenantId, roleId: role.id, isActive: true },
        });
      }

      return NextResponse.json(
        serialize({
          ...driver,
          userId: user.id,
          employeeId: body.employeeId || null,
          driverCategory,
          issuingAuthority: body.issuingAuthority || null,
          additionalDocuments: body.additionalDocuments || [],
          linkedUser: {
            id: user.id,
            username: user.username,
            email: user.email,
          },
        }),
        { status: 201 }
      );
    } catch (e) {
      console.error('[Driver Hub] POST /api/drivers:', e);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  });
}
