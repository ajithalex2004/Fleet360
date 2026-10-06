import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions';
import { busOpsAccessFor } from '@/lib/bus-ops/access';
export async function requireBusOpsAdminAccess(req: NextRequest, resource: string): Promise<NextResponse | null> {
  const { access, refusal } = await busOpsAccessFor(req);
  if (refusal) return refusal;
  return hasPermission(access.permissions, 'bus-ops', 'admin', resource) ? null
    : NextResponse.json({ error: 'Missing Bus Ops administrative permission' }, { status: 403 });
}
