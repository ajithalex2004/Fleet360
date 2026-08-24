/**
 * src/app/api/dispatcher/reports/[id]/acknowledge/route.ts
 *
 * POST /api/dispatcher/reports/[id]/acknowledge
 *
 * Dispatcher / tenant admin marks a report as seen. OPEN → ACK.
 * Idempotent: re-acknowledging an already-ACK report is a 200 no-op.
 *
 * Body (all optional):
 *   { notes?: string }
 *
 * The driver sees the ACK state in the GET /api/driver-app/reports/[id]
 * response (acknowledged_by, acknowledged_at fields).
 *
 * (Future: this endpoint will be paired with a dispatcher list view
 * at /api/dispatcher/reports?status=OPEN&severity=HIGH,CRITICAL so
 * the dispatcher dashboard can sort by severity.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/tenant-session';
import { withTenantRls } from '@/lib/rls';
import { evaluateReportTransition } from '@/lib/driver-reports';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const BodySchema = z.object({
  notes: z.string().max(500).optional(),
});

const ALLOWED_ROLES = new Set(['DISPATCHER', 'TENANT_ADMIN', 'SUPER_ADMIN']);

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  // 1) Auth
  const driverToken = req.cookies.get('xl-driver-session')?.value;
  const adminToken = req.cookies.get('xl-session')?.value;
  const token = driverToken || adminToken;
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const session = await verifySession(token).catch(() => null);
  if (!session) return NextResponse.json({ error: 'invalid session' }, { status: 401 });
  if (!ALLOWED_ROLES.has(session.role ?? '')) {
    return NextResponse.json(
      { error: 'forbidden: only dispatcher / tenant admin can acknowledge reports' },
      { status: 403 },
    );
  }

  // 2) Body (optional)
  let input: z.infer<typeof BodySchema> = {};
  try {
    const text = await req.text();
    const trimmed = text.trim();
    if (trimmed.length > 0 && trimmed !== 'null') {
      const parsed = BodySchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'validation failed', issues: parsed.error.issues },
          { status: 400 },
        );
      }
      input = parsed.data;
    }
  } catch {
    // Empty / null body → use defaults
  }

  // 3) Load + transition
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    tenant_id: string;
    status: string;
    acknowledged_by: string | null;
  }>>`
    SELECT id, tenant_id, status, acknowledged_by
    FROM driver_reports
    WHERE id = ${params.id}::uuid
    LIMIT 1
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: 'report not found' }, { status: 404 });
  }
  const r = rows[0];

  if (r.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'forbidden: report is in a different tenant' }, { status: 403 });
  }

  // 4) Idempotent re-ack
  if (r.status === 'ACK' || r.status === 'IN_PROGRESS' || r.status === 'RESOLVED') {
    return NextResponse.json({
      ok: true,
      id: r.id,
      status: r.status,
      idempotent: true,
      acknowledgedBy: r.acknowledged_by,
    });
  }

  // 5) State machine
  const decision = evaluateReportTransition({
    currentStatus: r.status as Parameters<typeof evaluateReportTransition>[0]['currentStatus'],
    action: 'ACK',
  });
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'cannot acknowledge', reason: decision.reason, currentStatus: r.status },
      { status: 409 },
    );
  }

  // 6) Persist
  const now = new Date();
  await withTenantRls(prisma, session.tenantId, async (tx) => {
    await tx.$executeRaw`
      UPDATE driver_reports
      SET status = 'ACK',
          acknowledged_by = ${session.userId}::uuid,
          acknowledged_at = ${now.toISOString()}::timestamptz,
          updated_at = NOW()
      WHERE id = ${r.id}::uuid
    `;
  });

  return NextResponse.json({
    ok: true,
    id: r.id,
    status: 'ACK',
    acknowledgedBy: session.userId,
    acknowledgedAt: now.toISOString(),
    notes: input.notes ?? null,
  });
}
