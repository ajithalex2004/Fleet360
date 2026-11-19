import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { 
  generateScope3AuditCertificate, 
  EsgTripInput 
} from '@/lib/esg/scope3-carbon-calculator';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sustainability/scope3-report
 * Generates an Audit-Ready GHG Protocol Scope 3 Carbon Certificate & Departmental Matrix
 */
export async function POST(req: NextRequest) {
  const auth = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(rawBody);

    const clientName = String(body.clientName ?? '').trim();
    const reportingPeriod = String(body.reportingPeriod ?? '').trim();
    const trips: EsgTripInput[] = Array.isArray(body.trips) ? body.trips : [];

    const missing: string[] = [];
    if (!clientName) missing.push('clientName is required');
    if (!reportingPeriod) missing.push('reportingPeriod is required');
    if (trips.length === 0) missing.push('trips array with at least one trip is required');

    if (missing.length > 0) {
      return NextResponse.json({
        ok: false,
        error: 'Missing required Scope 3 report fields',
        message: 'Validation failed: clientName, reportingPeriod, and trips are mandatory',
        details: missing,
        missingFields: missing,
      }, { status: 422 });
    }

    const certificate = generateScope3AuditCertificate(clientName, reportingPeriod, trips);

    return NextResponse.json({
      success: true,
      auditCertificate: certificate,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error generating Scope 3 ESG report:', err);
    return NextResponse.json({ error: 'Failed to generate Scope 3 ESG report', details: msg }, { status: 500 });
  }
}

/**
 * GET /api/sustainability/scope3-report
 * Retrieves Scope 3 carbon report for a reporting period
 */
export async function GET(req: NextRequest) {
  const auth = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { tenantId } = auth;

  const sp = req.nextUrl.searchParams;
  const yearParam = sp.get('year');

  if (yearParam !== null && isNaN(Number(yearParam))) {
    return NextResponse.json({
      ok: false,
      error: 'Invalid year format: must be a 4-digit number',
    }, { status: 400 });
  }

  const yearNum = yearParam ? Number(yearParam) : new Date().getFullYear();

  if (yearNum > 2035) {
    return NextResponse.json({
      ok: false,
      error: `Reporting period ${yearNum} is beyond allowed forecast horizon (maximum 2035)`,
      missingFields: ['future_emissions_factor_model'],
    }, { status: 422 });
  }

  const startDate = new Date(Date.UTC(yearNum, 0, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(yearNum, 11, 31, 23, 59, 59, 999));

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const [tripCount, fuelLogs] = await Promise.all([
        tx.tripSchedule.count({
          where: {
            tenantId,
            deletedAt: null,
            departureTime: {
              gte: startDate,
              lte: endDate,
            },
          },
        }).catch(() => 0),
        tx.fuelLog.findMany({
          where: {
            tenantId,
            fuelDate: {
              gte: startDate,
              lte: endDate,
            },
          },
          select: {
            liters: true,
          },
        }).catch(() => []),
      ]);

      const fuelLogCount = fuelLogs.length;

      if (tripCount === 0 && fuelLogCount === 0) {
        return NextResponse.json({
          ok: false,
          error: `No emissions data found for reporting period ${yearNum}`,
          message: 'Tenant has not recorded any telematics or fuel trips for the requested period',
          missingFields: ['trips', 'fuel_records'],
        }, { status: 422 });
      }

      const totalLiters = fuelLogs.reduce((sum, f) => sum + (Number(f.liters) || 0), 0);
      const totalEmissionsKgCo2e = Number((totalLiters * 2.68).toFixed(2));

      return NextResponse.json({
        ok: true,
        success: true,
        reportingYear: yearNum,
        tenantId,
        summary: {
          totalEmissionsKgCo2e,
          tripCount,
          fuelLogCount,
        },
      });
    } catch (err: unknown) {
      console.error('Error querying Scope 3 emissions data:', err);
      return NextResponse.json({
        ok: false,
        error: `No emissions data found for reporting period ${yearNum}`,
        message: 'Tenant has not recorded any telematics or fuel trips for the requested period',
        missingFields: ['trips', 'fuel_records'],
      }, { status: 422 });
    }
  });
}
