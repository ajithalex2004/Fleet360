export const dynamic = 'force-dynamic';

/**
 * Finance Audit Log API — /api/finance/audit-log
 * Comprehensive immutable audit trail for all finance module actions
 * Covers: JE posting, approvals, period locks, CT filings, bank reconciliation, asset disposals
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// Tables come from migrations (the last: 20261005090000_finance_tenant_tables).
// A request runs no DDL: the runtime role may not create tables, and the
// failed statement aborted the request's transaction, so every query after
// it failed too.

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const sp        = req.nextUrl.searchParams;
      const module_   = sp.get('module');
      const action    = sp.get('action');
      const entityId  = sp.get('entityId');
      const from      = sp.get('from');
      const to        = sp.get('to');
      const search    = sp.get('search');
      const limit     = parseInt(sp.get('limit') ?? '100');
      const offset    = parseInt(sp.get('offset') ?? '0');

      let where = 'WHERE tenant_id = $1';
      const params: unknown[] = [tenantId];
      let pi = 2;

      if (module_)  { where += ` AND module = $${pi++}`;                params.push(module_); }
      if (action)   { where += ` AND action = $${pi++}`;                params.push(action); }
      if (entityId) { where += ` AND entity_id = $${pi++}`;             params.push(entityId); }
      if (from)     { where += ` AND created_at >= $${pi++}::timestamptz`;           params.push(from); }
      if (to)       { where += ` AND created_at < ($${pi++}::date + interval '1 day')`; params.push(to); }
      if (search)   { where += ` AND (description ILIKE $${pi} OR entity_ref ILIKE $${pi} OR performed_by ILIKE $${pi})`; params.push(`%${search}%`); pi++; }

      const [rows, [countRow]] = await Promise.all([
        tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `SELECT * FROM finance_audit_log ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi+1}`,
          ...params, limit, offset
        ).catch(()=>[]),
        tx.$queryRawUnsafe<{count:string}[]>(
          `SELECT COUNT(*)::text as count FROM finance_audit_log ${where}`, ...params
        ).catch(()=>[{count:'0'}]),
      ]);

      // Module breakdown counts
      const moduleCounts = await tx.$queryRawUnsafe<{module:string; count:string}[]>(
        `SELECT module, COUNT(*)::text as count FROM finance_audit_log WHERE tenant_id = $1 GROUP BY module ORDER BY count DESC`,
        tenantId,
      ).catch(()=>[]);

      return NextResponse.json({
        data: rows,
        total: parseInt(countRow?.count ?? '0'),
        limit, offset,
        moduleCounts,
      });
  });
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const { module: mod, action, entityType, entityId, entityRef, performedBy, description, amount, oldValues, newValues, metadata, ipAddress } = body;

      if (!mod || !action || !entityType || !entityId || !performedBy || !description) {
        return NextResponse.json({ error: 'Missing required fields: module, action, entityType, entityId, performedBy, description' }, { status: 400 });
      }

      const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
        `INSERT INTO finance_audit_log
           (module, action, entity_type, entity_id, entity_ref, performed_by, ip_address, description, amount, old_values, new_values, metadata, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        mod, action, entityType, entityId, entityRef ?? null, performedBy,
        ipAddress ?? null, description, amount ?? null,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        metadata  ? JSON.stringify(metadata)  : null,
        tenantId,
      ).catch(()=>[]);

      return NextResponse.json(row ?? {}, { status: 201 });
  });
}

