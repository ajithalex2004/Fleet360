export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { batchAutoMatchTenantFines } from '@/lib/fleet/fine-toll-matcher';

/**
 * GET /api/fleet/traffic-fines/auto-match
 * Performs a dry-run auto-match analysis of unpaid traffic fines against driver shifts.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const sp = req.nextUrl.searchParams;
  const threshold = parseInt(sp.get('confidenceThreshold') ?? '75', 10);

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const summary = await batchAutoMatchTenantFines(tx, tenantId, {
        confidenceThreshold: threshold,
        dryRun: true,
      });

      return NextResponse.json(summary);
    } catch (err) {
      console.error('[traffic-fines-auto-match] GET failed:', err);
      return NextResponse.json(
        { error: 'Failed to analyze traffic fine auto-matching' },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/fleet/traffic-fines/auto-match
 * Executes batch auto-matching and updates driverId and assignedTo in the DB.
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      let threshold = 75;
      try {
        const body = await req.json();
        if (typeof body.confidenceThreshold === 'number') {
          threshold = body.confidenceThreshold;
        }
      } catch {
        // Fallback default
      }

      const summary = await batchAutoMatchTenantFines(tx, tenantId, {
        confidenceThreshold: threshold,
        dryRun: false,
      });

      return NextResponse.json({
        success: true,
        summary,
        message: `Auto-match completed: ${summary.matchedToDriverCount} fine(s) matched to driver shifts, ${summary.assignedToCompanyCount} assigned to company, ${summary.unmatchedCount} unmatched.`,
      });
    } catch (err) {
      console.error('[traffic-fines-auto-match] POST failed:', err);
      return NextResponse.json(
        { error: 'Failed to execute traffic fine auto-matching' },
        { status: 500 }
      );
    }
  });
}
