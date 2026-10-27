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
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
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

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp       = request.nextUrl.searchParams;
      const status   = sp.get('status');
      const type     = sp.get('driverType');
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

      const drivers = await tx.driver.findMany({
        where,
        orderBy: { name: 'asc' },
      });

      // Fetch dynamic driver_category, employee_id, issuing_authority, and additional_documents from DB
      const extraRows = await tx.$queryRawUnsafe<Array<{
        id: string;
        employee_id: string | null;
        driver_category: string | null;
        issuing_authority: string | null;
        additional_documents: any | null;
      }>>(
        `SELECT id::text, employee_id, driver_category, issuing_authority, additional_documents FROM drivers WHERE tenant_id = $1 AND deleted_at IS NULL`,
        tenantId,
      ).catch(() => []);
      const extraMap = new Map(extraRows.map(r => [r.id, r]));

      const enriched = drivers.map(d => {
        const extra = extraMap.get(d.id);
        const driverCategory = extra?.driver_category || d.licenseType || 'LIGHT_DUTY';
        return {
          ...d,
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
      return NextResponse.json(
        { error: 'Internal Server Error', details: String(e) },
        { status: 500 }
      );
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
        },
      });

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

      // 2. Map Driver in User Module by creating / linking an entry in the User Profile
      const cleanLic = body.licenseNumber.toLowerCase().replace(/[^a-z0-9]/g, '');
      const targetEmail = (body.email && body.email.trim())
        ? body.email.trim().toLowerCase()
        : `driver.${cleanLic}@fleet360.internal`;

      const targetUsername = (body.username && body.username.trim())
        ? body.username.trim().toLowerCase()
        : (body.email ? body.email.split('@')[0] : `driver_${cleanLic}`);

      // Check if user already exists
      let user = await tx.user.findFirst({
        where: {
          OR: [
            { email: { equals: targetEmail, mode: 'insensitive' } },
            { username: { equals: targetUsername, mode: 'insensitive' } },
            ...(body.employeeId ? [{ employeeId: body.employeeId }] : []),
          ],
        },
      });

      if (!user) {
        const newUserId = crypto.randomUUID();
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
      }) || await tx.role.findFirst({ where: { OR: [{ tenantId }, { tenantId: null }] } });

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
      return NextResponse.json(
        { error: 'Internal Server Error', details: String(e) },
        { status: 500 }
      );
    }
  });
}
