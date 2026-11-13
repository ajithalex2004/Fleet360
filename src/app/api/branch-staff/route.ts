export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { loadModuleAccess, branchStaffModules } from '@/lib/authz/module-access';

// `catch (err)` is typed `unknown` under strict mode — `err.message` doesn't
// compile without narrowing first.
function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-generate staff number: STF-YYYYMM-XXXX
// ─────────────────────────────────────────────────────────────────────────────
async function generateStaffNo(
  tx: { $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T> },
  tenantId: string,
): Promise<string> {
  const now   = new Date();
  const ym    = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rows  = await tx.$queryRawUnsafe<{ cnt: string }[]>(
    `SELECT COUNT(*)::text AS cnt FROM branch_staff_assignments WHERE tenant_id::text = $1 AND staff_no LIKE $2`,
    tenantId,
    `STF-${ym}-%`,
  );
  const seq = (parseInt(rows[0]?.cnt || '0') + 1).toString().padStart(4, '0');
  return `STF-${ym}-${seq}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/branch-staff
// Query params: module, branch_name, role, status, search, page, limit
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const access = await loadModuleAccess(req.headers, tenantId);

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {

        const sp          = new URL(req.url).searchParams;
        const moduleParam = sp.get('module');
        const denied      = access(branchStaffModules(moduleParam), 'view', '/api/branch-staff');
        if (denied) return denied;
        const branch_name = sp.get('branch_name');
        const role        = sp.get('role');
        const status      = sp.get('status');
        const search      = sp.get('search');
        const page        = Math.max(1, parseInt(sp.get('page') || '1'));
        const limit       = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '50')));
        const offset      = (page - 1) * limit;

        // Build WHERE clauses dynamically
        const conditions: string[] = ['tenant_id::text = $1', 'deleted_at IS NULL'];
        const params: unknown[]    = [tenantId];

        if (moduleParam) {
          params.push(moduleParam);
          conditions.push(`(module = $${params.length} OR module = 'BOTH')`);
        }
        if (branch_name) {
          params.push(branch_name);
          conditions.push(`branch_name = $${params.length}`);
        }
        if (role) {
          params.push(role);
          conditions.push(`role = $${params.length}`);
        }
        if (status) {
          params.push(status);
          conditions.push(`status = $${params.length}`);
        }
        if (search) {
          params.push(`%${search}%`);
          conditions.push(`(full_name ILIKE $${params.length} OR staff_no ILIKE $${params.length} OR employee_id ILIKE $${params.length})`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        // Count
        const countRows = await tx.$queryRawUnsafe<{ cnt: string }[]>(
          `SELECT COUNT(*)::text AS cnt FROM branch_staff_assignments ${where}`,
          ...params
        );
        const total = parseInt(countRows[0]?.cnt || '0');

        // Data
        const listParams = [...params, limit, offset];
        const staff = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM branch_staff_assignments ${where} ORDER BY created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
          ...listParams
        );

        // Module-scoped KPI & role summary conditions
        const kpiConditions: string[] = ['tenant_id::text = $1', 'deleted_at IS NULL'];
        const kpiParams: unknown[]    = [tenantId];
        if (moduleParam) {
          kpiParams.push(moduleParam);
          kpiConditions.push(`(module = $${kpiParams.length} OR module = 'BOTH')`);
        }
        const kpiWhere = `WHERE ${kpiConditions.join(' AND ')}`;

        // Summary counts by role (scoped to module if provided)
        const roleSummary = await tx.$queryRawUnsafe<{ role: string; cnt: string }[]>(
          `SELECT role, COUNT(*)::text AS cnt FROM branch_staff_assignments ${kpiWhere} AND status = 'ACTIVE' GROUP BY role`,
          ...kpiParams,
        );

        // KPI totals (scoped to module if provided)
        const kpiRows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT
             COUNT(*)::int                                                              AS total,
             COUNT(*) FILTER (WHERE status = 'ACTIVE')::int                           AS active,
             COUNT(*) FILTER (WHERE status = 'ON_LEAVE')::int                         AS on_leave,
             COUNT(*) FILTER (WHERE role = 'BRANCH_MANAGER' AND status = 'ACTIVE')::int AS branch_managers
           FROM branch_staff_assignments
           ${kpiWhere}`,
          ...kpiParams,
        );

        return NextResponse.json({
          data:        staff,
          total,
          page,
          limit,
          pages:       Math.ceil(total / limit),
          kpi:         kpiRows[0] || { total: 0, active: 0, on_leave: 0, branch_managers: 0 },
          roleSummary: roleSummary.reduce((acc: Record<string, number>, r) => {
            acc[r.role] = parseInt(r.cnt);
            return acc;
          }, {}),
        });
        } catch (err) {
        console.error('[branch-staff GET]', err);
        return NextResponse.json({ error: errorMessage(err, 'Failed') }, { status: 500 });
      }
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/branch-staff — create new assignment
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const access = await loadModuleAccess(req.headers, tenantId);

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

        const {
          full_name, email, phone, role, module, branch_id, branch_name,
          emirate, start_date, end_date, status = 'ACTIVE',
          employee_id, nationality, notes,
        } = body;
        const denied = access(branchStaffModules(String(module ?? '')), 'create', '/api/branch-staff');
        if (denied) return denied;

        if (!full_name || !phone || !role || !module || !branch_name || !start_date) {
          return NextResponse.json({ error: 'Missing required fields: full_name, phone, role, module, branch_name, start_date' }, { status: 400 });
        }

        const staff_no = await generateStaffNo(tx, tenantId);

        const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
          `INSERT INTO branch_staff_assignments
             (tenant_id, staff_no, full_name, email, phone, role, module, branch_id, branch_name, emirate, start_date, end_date, status, employee_id, nationality, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           RETURNING *`,
          tenantId, staff_no, full_name, email || null, phone, role, module,
          branch_id || null, branch_name, emirate || null,
          start_date, end_date || null, status,
          employee_id || null, nationality || null, notes || null
        );

        return NextResponse.json(rows[0], { status: 201 });
        } catch (err) {
        console.error('[branch-staff POST]', err);
        return NextResponse.json({ error: errorMessage(err, 'Failed to create staff assignment') }, { status: 500 });
      }
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/branch-staff — update one record (id in body)
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const access = await loadModuleAccess(req.headers, tenantId);

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const { id, ...fields } = body;

        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

        // The record's module decides who may change it (and the new one,
        // when the change moves it to another module).
        const [current] = await tx.$queryRawUnsafe<Array<{ module: string }>>(
          `SELECT module FROM branch_staff_assignments WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL`,
          String(id),
          tenantId,
        );
        if (!current) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
        const denied = access(branchStaffModules(current.module), 'edit', '/api/branch-staff')
          ?? ('module' in fields ? access(branchStaffModules(String(fields.module ?? '')), 'edit', '/api/branch-staff') : null);
        if (denied) return denied;

        // Build SET clause dynamically
        const allowed = ['full_name','email','phone','role','module','branch_id','branch_name',
                         'emirate','start_date','end_date','status','employee_id','nationality','notes'];
        const setClauses: string[] = ['updated_at = NOW()'];
        const params: unknown[]    = [];

        for (const [key, val] of Object.entries(fields)) {
          if (allowed.includes(key)) {
            params.push(val);
            setClauses.push(`${key} = $${params.length}`);
          }
        }

        if (setClauses.length === 1) {
          return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
        }

        params.push(String(id), tenantId);
        const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
          `UPDATE branch_staff_assignments SET ${setClauses.join(', ')} WHERE id::text = $${params.length - 1} AND tenant_id::text = $${params.length} AND deleted_at IS NULL RETURNING *`,
          ...params
        );

        if (rows.length === 0) {
          return NextResponse.json({ error: 'Record not found' }, { status: 404 });
        }
        return NextResponse.json(rows[0]);
      } catch (err) {
        console.error('[branch-staff PATCH]', err);
        return NextResponse.json({ error: errorMessage(err, 'Failed to update') }, { status: 500 });
      }
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/branch-staff — soft-delete (id in query)
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const access = await loadModuleAccess(req.headers, tenantId);

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const id = new URL(req.url).searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

        const [current] = await tx.$queryRawUnsafe<Array<{ module: string }>>(
          `SELECT module FROM branch_staff_assignments WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL`,
          id,
          tenantId,
        );
        if (!current) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
        const denied = access(branchStaffModules(current.module), 'delete', '/api/branch-staff');
        if (denied) return denied;

        await tx.$executeRawUnsafe(
          `UPDATE branch_staff_assignments SET deleted_at = NOW(), status = 'INACTIVE', updated_at = NOW() WHERE id::text = $1 AND tenant_id::text = $2`,
          id,
          tenantId,
        );
        return NextResponse.json({ success: true });
        } catch (err) {
        console.error('[branch-staff DELETE]', err);
        return NextResponse.json({ error: errorMessage(err, 'Failed') }, { status: 500 });
      }
  });
}
