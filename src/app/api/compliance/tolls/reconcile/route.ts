import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { withSavepoint } from '@/lib/rental/locks';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  reconcileTollCrossings,
  TollCrossingEvent,
  ShiftOrTripContext,
} from '@/lib/fines/toll-reconciliation';

export const dynamic = 'force-dynamic';

const DEMO_TOLL_CROSSINGS: TollCrossingEvent[] = [
  {
    id: 'TOLL-001',
    tollSystem: 'SALIK',
    gateName: 'Al Barsha Gate (Sheikh Zayed Road)',
    vehiclePlate: 'DXB-54210',
    crossingTimestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    tollAmountAed: 4.0,
  },
  {
    id: 'TOLL-002',
    tollSystem: 'SALIK',
    gateName: 'Airport Tunnel Gate',
    vehiclePlate: 'DXB-54210',
    crossingTimestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    tollAmountAed: 4.0,
  },
  {
    id: 'TOLL-003',
    tollSystem: 'DARB',
    gateName: 'Sheikh Zayed Bridge Gate',
    vehiclePlate: 'AUH-19283',
    crossingTimestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    tollAmountAed: 4.0,
  },
  {
    id: 'TOLL-004',
    tollSystem: 'SALIK',
    gateName: 'Al Safa Gate',
    vehiclePlate: 'DXB-99999',
    crossingTimestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    tollAmountAed: 4.0,
  },
];

const DEMO_ACTIVE_CONTEXTS: ShiftOrTripContext[] = [
  {
    id: 'TRIP-ST-8821',
    type: 'STAFF_TRANSPORT',
    vehiclePlate: 'DXB-54210',
    driverName: 'Muhammad Rashid',
    customerName: 'Emaar Hospitality Group',
    startTime: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    routeCode: 'ROUTE-DSO-DOWNTOWN',
    contractTollsIncluded: false,
  },
  {
    id: 'TRIP-LOG-4412',
    type: 'LOGISTICS_FREIGHT',
    vehiclePlate: 'AUH-19283',
    driverName: 'Suresh Kumar',
    customerName: 'ADNOC Distribution',
    startTime: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    routeCode: 'AUH-KIZAD-EXPRESS',
    contractTollsIncluded: true,
  },
];

type RentalAgreementContextRow = {
  id: string;
  vehicle_plate: string | null;
  customer_id: string | null;
  customer_name: string | null;
  start_date: string | Date;
  end_date: string | Date;
};

type ReconciledTollRow = {
  id: string;
  rental_agreement_id: string;
};

async function loadTenantRentalContexts(tenantId: string): Promise<ShiftOrTripContext[]> {
  return withTenantRls(prisma, tenantId, async (tx) => {
    let rows = await withSavepoint<RentalAgreementContextRow[] | null>(
      tx,
      'tolls_rac_agreements',
      () =>
        tx.$queryRawUnsafe<RentalAgreementContextRow[]>(
          `SELECT
             COALESCE(NULLIF(TRIM(ra.agreement_no), ''), ra.id::text) AS id,
             COALESCE(
               NULLIF(TRIM(v.license_plate), ''),
               NULLIF(TRIM(v.plate_number), ''),
               NULLIF(TRIM(v.registration_no), '')
             ) AS vehicle_plate,
             ra.customer_id,
             COALESCE(NULLIF(TRIM(rc.company_name), ''), rc.full_name, 'Rental Customer') AS customer_name,
             ra.start_date,
             COALESCE(ra.actual_return_date, ra.end_date, NOW() + INTERVAL '1 day') AS end_date
           FROM rental_agreements ra
           LEFT JOIN vehicles v ON v.id = ra.vehicle_id AND v.deleted_at IS NULL
           LEFT JOIN rental_customers rc ON rc.id = ra.customer_id AND rc.deleted_at IS NULL
           WHERE ra.tenant_id::text = $1
             AND ra.deleted_at IS NULL
             AND UPPER(COALESCE(ra.status, '')) IN ('ACTIVE', 'COMPLETED', 'CLOSED')
           ORDER BY ra.start_date DESC
           LIMIT 500`,
          tenantId,
        ),
      null,
    );

    if (rows === null) {
      rows = await withSavepoint<RentalAgreementContextRow[]>(
        tx,
        'tolls_rac_agreements_legacy',
        () =>
          tx.$queryRawUnsafe<RentalAgreementContextRow[]>(
            `SELECT
               COALESCE(NULLIF(TRIM(ra.agreement_no), ''), ra.id::text) AS id,
               COALESCE(
                 NULLIF(TRIM(v.license_plate), ''),
                 NULLIF(TRIM(v.plate_number), ''),
                 NULLIF(TRIM(v.registration_no), '')
               ) AS vehicle_plate,
               ra.customer_id,
               COALESCE(NULLIF(TRIM(rc.company_name), ''), rc.full_name, 'Rental Customer') AS customer_name,
               ra.start_date,
               COALESCE(ra.end_date, NOW() + INTERVAL '1 day') AS end_date
             FROM rental_agreements ra
             LEFT JOIN vehicles v ON v.id = ra.vehicle_id AND v.deleted_at IS NULL
             LEFT JOIN rental_customers rc ON rc.id = ra.customer_id AND rc.deleted_at IS NULL
             WHERE ra.tenant_id::text = $1
               AND UPPER(COALESCE(ra.status, '')) IN ('ACTIVE', 'COMPLETED', 'CLOSED')
             ORDER BY ra.start_date DESC
             LIMIT 500`,
            tenantId,
          ),
        [],
      );
    }

    return rows
      .filter((r) => Boolean(r.vehicle_plate))
      .map((r) => ({
        id: String(r.id),
        type: 'RENTAL_CONTRACT' as const,
        vehiclePlate: String(r.vehicle_plate),
        customerId: r.customer_id ? String(r.customer_id) : undefined,
        customerName: r.customer_name ? String(r.customer_name) : undefined,
        startTime: new Date(String(r.start_date)).toISOString(),
        endTime: new Date(String(r.end_date)).toISOString(),
        routeCode: String(r.id),
        contractTollsIncluded: false,
      }));
  });
}

/**
 * Matches persisted unmatched `toll_transactions` (`responsible_party = 'FLEET'` and
 * `rental_agreement_id IS NULL`) against active/completed/closed `rental_agreements`
 * where `occurred_at BETWEEN start_date AND COALESCE(actual_return_date, end_date)`,
 * stamping `rental_agreement_id = ra.id` and `responsible_party = 'CUSTOMER'`.
 */
async function reconcilePersistedRentalTolls(tenantId: string): Promise<ReconciledTollRow[]> {
  return withTenantRls(prisma, tenantId, async (tx) => {
    const primary = await withSavepoint<ReconciledTollRow[] | null>(
      tx,
      'tolls_reconcile_db_rac',
      () =>
        tx.$queryRawUnsafe<ReconciledTollRow[]>(
          `WITH matched AS (
             SELECT DISTINCT ON (tt.id)
                    tt.id AS toll_id,
                    ra.id AS agreement_id
               FROM toll_transactions tt
               JOIN rental_agreements ra
                 ON ra.tenant_id::text = tt.tenant_id::text
                AND ra.vehicle_id = tt.vehicle_id
              WHERE tt.tenant_id::text = $1
                AND UPPER(COALESCE(tt.responsible_party, 'FLEET')) = 'FLEET'
                AND tt.rental_agreement_id IS NULL
                AND ra.deleted_at IS NULL
                AND UPPER(COALESCE(ra.status, '')) IN ('ACTIVE', 'COMPLETED', 'CLOSED')
                AND tt.occurred_at BETWEEN ra.start_date AND COALESCE(ra.actual_return_date, ra.end_date)
              ORDER BY tt.id, ra.start_date DESC
           )
           UPDATE toll_transactions tt
              SET rental_agreement_id = matched.agreement_id,
                  responsible_party = 'CUSTOMER'
             FROM matched
            WHERE tt.id = matched.toll_id
              AND tt.tenant_id::text = $1
           RETURNING tt.id::text AS id, tt.rental_agreement_id::text AS rental_agreement_id`,
          tenantId,
        ),
      null,
    );

    if (primary !== null) {
      return primary;
    }

    return withSavepoint<ReconciledTollRow[]>(
      tx,
      'tolls_reconcile_db_rac_legacy',
      () =>
        tx.$queryRawUnsafe<ReconciledTollRow[]>(
          `WITH matched AS (
             SELECT DISTINCT ON (tt.id)
                    tt.id AS toll_id,
                    ra.id AS agreement_id
               FROM toll_transactions tt
               JOIN rental_agreements ra
                 ON ra.tenant_id::text = tt.tenant_id::text
                AND ra.vehicle_id = tt.vehicle_id
              WHERE tt.tenant_id::text = $1
                AND UPPER(COALESCE(tt.responsible_party, 'FLEET')) = 'FLEET'
                AND tt.rental_agreement_id IS NULL
                AND ra.deleted_at IS NULL
                AND UPPER(COALESCE(ra.status, '')) IN ('ACTIVE', 'COMPLETED', 'CLOSED')
                AND tt.occurred_at BETWEEN ra.start_date AND ra.end_date
              ORDER BY tt.id, ra.start_date DESC
           )
           UPDATE toll_transactions tt
              SET rental_agreement_id = matched.agreement_id,
                  responsible_party = 'CUSTOMER'
             FROM matched
            WHERE tt.id = matched.toll_id
              AND tt.tenant_id::text = $1
           RETURNING tt.id::text AS id, tt.rental_agreement_id::text AS rental_agreement_id`,
          tenantId,
        ),
      [],
    );
  });
}

/**
 * POST /api/compliance/tolls/reconcile
 * Executes spatial-temporal reconciliation between toll crossings and active trips/shifts/rentals
 * and attributes persisted unmatched `toll_transactions` rows to matching RAC `rental_agreements`.
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(
      rawBody && typeof rawBody === 'object' ? rawBody : {},
    );
    const useDemoFallback = body.useDemoFallback === true;
    const isDryRun = body.dryRun === true;

    const dbMatchedTolls = isDryRun
      ? []
      : await reconcilePersistedRentalTolls(tenantId).catch(() => []);

    const tollCrossings: TollCrossingEvent[] = Array.isArray(body.tollCrossings)
      ? body.tollCrossings
      : useDemoFallback
        ? DEMO_TOLL_CROSSINGS
        : [];

    let activeContexts: ShiftOrTripContext[];
    if (Array.isArray(body.activeContexts)) {
      if (body.mergeRentalAgreements === true) {
        const racContexts = await loadTenantRentalContexts(tenantId).catch(() => []);
        const seenIds = new Set(body.activeContexts.map((c: ShiftOrTripContext) => c.id));
        activeContexts = [
          ...body.activeContexts,
          ...racContexts.filter((c) => !seenIds.has(c.id)),
        ];
      } else {
        activeContexts = body.activeContexts;
      }
    } else {
      const racContexts = await loadTenantRentalContexts(tenantId).catch(() => []);
      activeContexts =
        racContexts.length > 0
          ? racContexts
          : useDemoFallback
            ? DEMO_ACTIVE_CONTEXTS
            : [];
    }

    const tolerance = Number(body.toleranceMinutes || 10);
    const summary = reconcileTollCrossings(tollCrossings, activeContexts, tolerance);

    return NextResponse.json({
      success: true,
      toleranceMinutes: tolerance,
      summary,
      dbReconciliation: {
        matchedRentalTollsCount: dbMatchedTolls.length,
        matchedTollIds: dbMatchedTolls.map((r) => r.id),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in toll reconciliation API:', err);
    return NextResponse.json(
      { error: 'Failed to reconcile toll crossings', details: message },
      { status: 500 },
    );
  }
}
