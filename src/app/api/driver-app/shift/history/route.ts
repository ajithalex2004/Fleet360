export const dynamic = 'force-dynamic';

/**
 * src/app/api/driver-app/shift/history/route.ts
 *
 * GET /api/driver-app/shift/history?limit=20
 *
 * Returns the driver's recent closed shifts with a small summary of
 * what's in each one (checklist completion, fuel entry count + total
 * cost, expense entry count + total). The detail view is a separate
 * drill-down page; this endpoint is for the list view.
 *
 * Shifts are returned in reverse chronological order (most recent
 * first). The cap is 100 to keep the response payload reasonable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
interface HistoryRow {
  id: string;
  started_at: Date;
  ended_at: Date | null;
  status: string;
  checklist_signed_at: Date | null;
  // Checklist is JSONB; we surface its "size" so the UI can say
  // "18/18 items" without re-fetching the full payload.
  checklist_keys: number | null;
  fuel_count: number;
  fuel_total_minor: number;
  expense_count: number;
  expense_total_minor: number;
  expense_currency: string | null;
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const ctx = await requireDriverSession(req);
      if (ctx instanceof NextResponse) return ctx;

      const url = new URL(req.url);
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '20'), 1), 100);

      // One round-trip with subqueries for the summaries. The aggregation
      // is cheap because the indexes on shift_id exist for both fuel_entries
      // and expense_entries.
      const rows = await tx.$queryRaw<HistoryRow[]>`
        SELECT
          s.id,
          s.started_at,
          s.ended_at,
          s.status,
          s.checklist_signed_at,
          CASE
            WHEN s.checklist IS NULL THEN NULL
            ELSE (SELECT count(*)::int FROM jsonb_object_keys(s.checklist))
          END AS checklist_keys,
          COALESCE((SELECT count(*)::int FROM fuel_entries fe
                    WHERE fe.shift_id = s.id
                      AND fe.tenant_id = s.tenant_id
                      AND fe.driver_id = s.driver_id), 0) AS fuel_count,
          COALESCE((SELECT sum(cost_minor)::bigint FROM fuel_entries fe
                    WHERE fe.shift_id = s.id
                      AND fe.tenant_id = s.tenant_id
                      AND fe.driver_id = s.driver_id), 0)::bigint AS fuel_total_minor,
          COALESCE((SELECT count(*)::int FROM expense_entries ee
                    WHERE ee.shift_id = s.id
                      AND ee.tenant_id = s.tenant_id
                      AND ee.driver_id = s.driver_id), 0) AS expense_count,
          COALESCE((SELECT sum(amount_minor)::bigint FROM expense_entries ee
                    WHERE ee.shift_id = s.id
                      AND ee.tenant_id = s.tenant_id
                      AND ee.driver_id = s.driver_id), 0)::bigint AS expense_total_minor,
          COALESCE((SELECT currency FROM fuel_entries fe
                    WHERE fe.shift_id = s.id
                      AND fe.tenant_id = s.tenant_id
                      AND fe.driver_id = s.driver_id
                    LIMIT 1), 'AED') AS expense_currency
        FROM shifts s
        WHERE s.tenant_id = ${ctx.tenantId}::uuid
          AND s.driver_id = ${ctx.userId}::uuid
          AND s.status = 'CLOSED'
        ORDER BY s.started_at DESC
        LIMIT ${limit}
      `;

      return NextResponse.json({
        shifts: rows.map((r) => ({
          id: r.id,
          startedAt: r.started_at.toISOString(),
          endedAt: r.ended_at?.toISOString() ?? null,
          status: r.status,
          checklistSignedAt: r.checklist_signed_at?.toISOString() ?? null,
          checklistItemCount: r.checklist_keys,
          fuel: {
            count: r.fuel_count,
            totalMinor: Number(r.fuel_total_minor),
            currency: r.expense_currency ?? 'AED',
          },
          expenses: {
            count: r.expense_count,
            totalMinor: Number(r.expense_total_minor),
            currency: r.expense_currency ?? 'AED',
          },
        })),
      });
  });
}

