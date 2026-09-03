/**
 * GET /api/leasing-portal/me
 * Returns the authenticated portal user + their lessee record. Used by
 * the portal shell to hydrate the session on load and gate the UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  const lessee = await prisma.lessee.findFirst({
    where: { id: ctx.lesseeId, tenantId: ctx.tenantId },
    select: { id: true, name: true, type: true, email: true, phone: true, tradeLicense: true, emiratesId: true },
  });
  if (!lessee) {
    return NextResponse.json({ error: 'Lessee record no longer exists' }, { status: 404 });
  }

  return NextResponse.json({ user: ctx.user, lessee });
}
