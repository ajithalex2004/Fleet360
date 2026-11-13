export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { nextRentalSerial, withSavepoint } from '@/lib/rental/locks';
import { escapeIlikePattern } from '@/lib/rental/security-guards';

/**
 * RAC Branch Management API
 * Table: rental_branches
 *
 * GET    /api/rental/branches?status=
 * POST   /api/rental/branches  — create branch (`rental:create:branches`)
 * PATCH  /api/rental/branches  — update branch (`rental:edit:branches`)
 * DELETE /api/rental/branches  — soft-delete branch (`rental:delete:branches`)
 */

const EMIRATE_PREFIX: Record<string, string> = {
  DUBAI: 'DXB',
  ABU_DHABI: 'AUH',
  SHARJAH: 'SHJ',
  AJMAN: 'AJM',
  RAS_AL_KHAIMAH: 'RAK',
  FUJAIRAH: 'FUJ',
  UMM_AL_QUWAIN: 'UAQ',
};

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'branches',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { searchParams } = new URL(req.url);
      const status = searchParams.get('status') ?? '';
      const emirate = searchParams.get('emirate') ?? '';
      const search = searchParams.get('search') ?? '';
      const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? 100) || 100));

      const conds: string[] = ['b.tenant_id::text = $1', 'b.deleted_at IS NULL'];
      const params: unknown[] = [tenantId];
      let pi = 2;

      if (status && status !== 'ALL') {
        conds.push(`b.status = $${pi++}`);
        params.push(status);
      }

      if (emirate && emirate !== 'ALL') {
        conds.push(`b.emirate = $${pi++}`);
        params.push(emirate);
      }

      if (search) {
        conds.push(
          `(b.branch_name ILIKE $${pi} ESCAPE '\\' OR b.branch_code ILIKE $${pi} ESCAPE '\\' OR b.manager_name ILIKE $${pi} ESCAPE '\\')`,
        );
        params.push(`%${escapeIlikePattern(search)}%`);
        pi++;
      }

      const where = `WHERE ${conds.join(' AND ')}`;

      type BranchRow = {
        id: string;
        branch_code: string;
        branch_name: string;
        emirate: string;
        address: string | null;
        phone: string | null;
        email: string | null;
        manager_name: string | null;
        operating_hours: string;
        vehicle_capacity: number;
        status: string;
        latitude: string | null;
        longitude: string | null;
        notes: string | null;
        created_at: string;
        updated_at: string;
      };

      const branches = await withSavepoint<BranchRow[]>(
        tx,
        'rental_branches_list',
        () =>
          tx.$queryRawUnsafe<BranchRow[]>(
            `SELECT b.*
               FROM rental_branches b
               ${where}
               ORDER BY b.emirate ASC, b.branch_name ASC
               LIMIT $${pi}`,
            ...params,
            limit,
          ),
        [],
      );

      type StatRow = {
        total: bigint;
        active: bigint;
        emirates_covered: bigint;
        total_capacity: bigint;
      };
      const statRows = await withSavepoint<StatRow[]>(
        tx,
        'rental_branches_stats',
        () =>
          tx.$queryRawUnsafe<StatRow[]>(
            `SELECT
               COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total,
               COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'ACTIVE') AS active,
               COUNT(DISTINCT emirate) FILTER (WHERE deleted_at IS NULL AND status = 'ACTIVE') AS emirates_covered,
               COALESCE(SUM(vehicle_capacity) FILTER (WHERE deleted_at IS NULL AND status = 'ACTIVE'), 0) AS total_capacity
             FROM rental_branches
             WHERE tenant_id::text = $1`,
            tenantId,
          ),
        [{ total: 0n, active: 0n, emirates_covered: 0n, total_capacity: 0n }],
      );
      const stats = statRows[0] ?? {
        total: 0n,
        active: 0n,
        emirates_covered: 0n,
        total_capacity: 0n,
      };

      return NextResponse.json({
        branches: branches.map((b) => ({
          id: b.id,
          branchCode: b.branch_code,
          branchName: b.branch_name,
          emirate: b.emirate,
          address: b.address,
          phone: b.phone,
          email: b.email,
          managerName: b.manager_name,
          operatingHours: b.operating_hours,
          vehicleCapacity: b.vehicle_capacity,
          status: b.status,
          latitude: b.latitude ? Number(b.latitude) : null,
          longitude: b.longitude ? Number(b.longitude) : null,
          notes: b.notes,
          createdAt: b.created_at,
          updatedAt: b.updated_at,
        })),
        stats: {
          total: Number(stats.total),
          active: Number(stats.active),
          emiratesCovered: Number(stats.emirates_covered),
          totalCapacity: Number(stats.total_capacity),
        },
      });
    } catch (err) {
      console.error('[branches GET]', err);
      return NextResponse.json({ error: 'Failed to load branches' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'branches',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      );
      const {
        branchName,
        emirate,
        address,
        phone,
        email,
        managerName,
        operatingHours = '8:00 AM - 8:00 PM',
        vehicleCapacity = 0,
        latitude,
        longitude,
        notes,
      } = body;

      if (typeof branchName !== 'string' || !branchName.trim()) {
        return NextResponse.json({ error: 'Branch name is required' }, { status: 400 });
      }
      if (typeof emirate !== 'string' || !emirate.trim()) {
        return NextResponse.json({ error: 'Emirate is required' }, { status: 400 });
      }

      const parsedCapacity = Number(vehicleCapacity ?? 0);
      if (!Number.isFinite(parsedCapacity) || parsedCapacity < 0) {
        return NextResponse.json(
          { error: 'vehicleCapacity must be zero or more' },
          { status: 400 },
        );
      }

      const normalizedEmirate = emirate.trim().toUpperCase();
      const prefix = EMIRATE_PREFIX[normalizedEmirate] ?? 'RAC';

      const branchCode =
        typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function'
          ? await nextRentalSerial(tx, {
              tenantId,
              series: `BRANCH-${prefix}`,
              prefix: `${prefix}-`,
              table: 'rental_branches',
              column: 'branch_code',
              padWidth: 3,
            })
          : `${prefix}-001`;

      type NewBranch = { id: string; branch_code: string };
      const [branch] = await tx.$queryRawUnsafe<NewBranch[]>(
        `INSERT INTO rental_branches
           (tenant_id, branch_code, branch_name, emirate, address, phone, email,
            manager_name, operating_hours, vehicle_capacity, latitude, longitude, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id, branch_code`,
        tenantId,
        branchCode,
        branchName.trim(),
        normalizedEmirate,
        typeof address === 'string' && address.trim() ? address.trim() : null,
        typeof phone === 'string' && phone.trim() ? phone.trim() : null,
        typeof email === 'string' && email.trim() ? email.trim() : null,
        typeof managerName === 'string' && managerName.trim() ? managerName.trim() : null,
        typeof operatingHours === 'string' && operatingHours.trim()
          ? operatingHours.trim()
          : '8:00 AM - 8:00 PM',
        Math.trunc(parsedCapacity),
        latitude !== undefined && latitude !== null && latitude !== '' ? Number(latitude) : null,
        longitude !== undefined && longitude !== null && longitude !== ''
          ? Number(longitude)
          : null,
        typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      );

      return NextResponse.json(
        { id: branch.id, branchCode: branch.branch_code },
        { status: 201 },
      );
    } catch (err) {
      console.error('[branches POST]', err);
      return NextResponse.json({ error: 'Failed to create branch' }, { status: 500 });
    }
  });
}

export async function PATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'branches',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      );
      const { id, ...fields } = body;

      if (typeof id !== 'string' || !id.trim()) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
      }
      const branchId = id.trim();

      if ('vehicleCapacity' in fields && fields.vehicleCapacity !== '' && fields.vehicleCapacity != null) {
        const cap = Number(fields.vehicleCapacity);
        if (!Number.isFinite(cap) || cap < 0) {
          return NextResponse.json(
            { error: 'vehicleCapacity must be zero or more' },
            { status: 400 },
          );
        }
        fields.vehicleCapacity = Math.trunc(cap);
      }

      const colMap: Record<string, string> = {
        branchName: 'branch_name',
        emirate: 'emirate',
        address: 'address',
        phone: 'phone',
        email: 'email',
        managerName: 'manager_name',
        operatingHours: 'operating_hours',
        vehicleCapacity: 'vehicle_capacity',
        status: 'status',
        latitude: 'latitude',
        longitude: 'longitude',
        notes: 'notes',
      };

      const setClauses: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];
      let pi = 1;

      for (const [key, col] of Object.entries(colMap)) {
        if (key in fields) {
          setClauses.push(`${col} = $${pi++}`);
          params.push(fields[key] === '' ? null : fields[key]);
        }
      }

      params.push(branchId, tenantId);
      const updated = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE rental_branches
            SET ${setClauses.join(', ')}
          WHERE id::text = $${pi}
            AND tenant_id::text = $${pi + 1}
            AND deleted_at IS NULL
          RETURNING id::text AS id`,
        ...params,
      );
      if (updated.length === 0) {
        return NextResponse.json({ error: 'Branch not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true });
    } catch (err) {
      console.error('[branches PATCH]', err);
      return NextResponse.json({ error: 'Failed to update branch' }, { status: 500 });
    }
  });
}

export async function DELETE(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'delete',
    'branches',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const queryId = req.nextUrl.searchParams.get('id')?.trim() ?? '';
  const bodyRaw = await req.json().catch(() => ({}));
  const body = stripTenantOwnershipFields(
    (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
  );
  const branchId = queryId || (typeof body.id === 'string' ? body.id.trim() : '');
  if (!branchId) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const deleted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE rental_branches
            SET deleted_at = NOW(),
                updated_at = NOW()
          WHERE id::text = $1
            AND tenant_id::text = $2
            AND deleted_at IS NULL
          RETURNING id::text AS id`,
        branchId,
        tenantId,
      );
      if (deleted.length === 0) {
        return NextResponse.json({ error: 'Branch not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (err) {
      console.error('[branches DELETE]', err);
      return NextResponse.json({ error: 'Failed to delete branch' }, { status: 500 });
    }
  });
}
