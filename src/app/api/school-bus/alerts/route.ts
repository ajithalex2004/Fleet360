export const dynamic = 'force-dynamic';

/**
 * GET /api/school-bus/alerts?date=YYYY-MM-DD: guardian notification summary
 * for a day (school-bus portal dashboard).
 *
 * school_bus_guardian_notifications has no tenant_id; each row belongs to a
 * student, so the tenant comes from school_bus_students (row level
 * security plus an explicit tenant filter). "Delivered" means at least one
 * guardian was reached; delivery is all the channel reports, there is no
 * read receipt.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const dateParam = req.nextUrl.searchParams.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    ? dateParam
    : new Date().toISOString().slice(0, 10);

  try {
    const [row] = await withTenantRls(prisma, tenantId, (tx) =>
      tx.$queryRawUnsafe<Array<{ sent: bigint; delivered: bigint }>>(
        `SELECT COUNT(*) AS sent,
                COUNT(*) FILTER (WHERE n.reached_guardian1 OR n.reached_guardian2) AS delivered
           FROM school_bus_guardian_notifications n
           JOIN school_bus_students s ON s.id = n.student_id
          WHERE s.tenant_id::text = $1
            AND n.sent_at >= $2::date
            AND n.sent_at <  $2::date + INTERVAL '1 day'`,
        tenantId,
        date,
      ),
    );
    const sent = Number(row?.sent ?? 0);
    const delivered = Number(row?.delivered ?? 0);
    return NextResponse.json(
      {
        date,
        sentToday: sent,
        readToday: delivered,
        readRate: sent > 0 ? Math.round((delivered / sent) * 100) : 0,
        pending: sent - delivered,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error('[school-bus/alerts] GET failed:', e);
    return NextResponse.json({ error: 'Failed to load notification summary' }, { status: 500 });
  }
}
