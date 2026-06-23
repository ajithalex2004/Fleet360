import { NextRequest, NextResponse } from 'next/server';

export interface DataMasterContext {
  tenantId: string;
  userId: string;
  role: string;
}

export function getDataMasterContext(req: NextRequest): DataMasterContext | NextResponse {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? '';

  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  return { tenantId, userId, role };
}

export function requireDataMasterAdmin(req: NextRequest): DataMasterContext | NextResponse {
  const ctx = getDataMasterContext(req);
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.role !== 'SUPER_ADMIN' && ctx.role !== 'TENANT_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return ctx;
}
