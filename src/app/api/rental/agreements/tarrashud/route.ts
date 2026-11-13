export const dynamic = 'force-dynamic';

/**
 * GET / POST /api/rental/agreements/tarrashud
 *
 * UAE Regulatory Renter Reporting API:
 *   - Dubai RTA Smart Car Rental (`RTA_TARRASHUD`)
 *   - Dubai Police Renter Security Registry (`DUBAI_POLICE`)
 *   - Abu Dhabi Integrated Transport Centre (`ABU_DHABI_ITC`)
 *
 * Architectural Contract:
 *   - `GET`: Lists `rental_regulatory_reports` strictly scoped to `tenantId`, joined with
 *     `agreement_no`, `customer_name`, and vehicle `plate_number`.
 *   - `POST`: Phase 1 queues manifest inside `withTenantRls` (`queueUaeRegulatoryReportInTx`),
 *     Phase 2 dispatches HTTPS payload strictly outside `withTenantRls`
 *     (`dispatchUaeRegulatoryReportOutsideRls`).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { withSavepoint } from '@/lib/rental/locks';
import { isRentalSecurityError } from '@/lib/rental/security-guards';
import {
  determineUaeRegulatoryAuthority,
  dispatchUaeRegulatoryReportOutsideRls,
  queueUaeRegulatoryReportInTx,
  type UaeRegulatoryAuthority,
  type UaeRegulatoryEventType,
} from '@/lib/rental/uae-regulatory-reporting';

const ALLOWED_EVENT_TYPES = new Set<UaeRegulatoryEventType>([
  'HANDOVER',
  'EXTENSION',
  'VEHICLE_SWAP',
  'RETURN',
  'CANCELLATION',
]);

const ALLOWED_AUTHORITIES = new Set<UaeRegulatoryAuthority>([
  'RTA_TARRASHUD',
  'DUBAI_POLICE',
  'ABU_DHABI_ITC',
]);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'agreements',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  const sp = req.nextUrl.searchParams;
  const agreementId = sp.get('agreementId')?.trim() || null;
  const authority = sp.get('authority')?.trim().toUpperCase() || null;
  const status = sp.get('status')?.trim().toUpperCase() || null;
  const eventType = sp.get('eventType')?.trim().toUpperCase() || null;
  const rawLimit = Number(sp.get('limit') ?? 100);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.trunc(rawLimit)), 500) : 100;

  try {
    const rows = await withTenantRls(prisma, tenantId, async (tx) => {
      return withSavepoint<Array<Record<string, unknown>>>(
        tx,
        'tarrashud_list_reports',
        () =>
          tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT rrr.id::text AS id,
                    rrr.tenant_id AS "tenantId",
                    rrr.agreement_id AS "agreementId",
                    rrr.authority,
                    rrr.event_type AS "eventType",
                    rrr.status,
                    rrr.external_ref AS "externalRef",
                    rrr.manifest_payload AS "manifestPayload",
                    rrr.response_payload AS "responsePayload",
                    rrr.error_message AS "errorMessage",
                    rrr.submitted_by AS "submittedBy",
                    rrr.submitted_at AS "submittedAt",
                    rrr.acknowledged_at AS "acknowledgedAt",
                    rrr.created_at AS "createdAt",
                    rrr.updated_at AS "updatedAt",
                    ra.agreement_no AS "agreementNo",
                    COALESCE(rc.full_name, ra.customer_name) AS "customerName",
                    COALESCE(v."plateNumber", (rrr.manifest_payload->'vehicle'->>'plateNumber')) AS "plateNumber"
               FROM rental_regulatory_reports rrr
               LEFT JOIN rental_agreements ra
                 ON ra.id::text = rrr.agreement_id
                AND ra.tenant_id::text = rrr.tenant_id
               LEFT JOIN rental_customers rc
                 ON rc.id::text = ra.customer_id
                AND rc.tenant_id::text = rrr.tenant_id
               LEFT JOIN vehicles v
                 ON v.id::text = ra.vehicle_id
                AND v.tenant_id::text = rrr.tenant_id
              WHERE rrr.tenant_id = $1
                AND ($2::text IS NULL OR rrr.agreement_id = $2)
                AND ($3::text IS NULL OR UPPER(rrr.authority) = $3)
                AND ($4::text IS NULL OR UPPER(rrr.status) = $4)
                AND ($5::text IS NULL OR UPPER(rrr.event_type) = $5)
              ORDER BY rrr.created_at DESC
              LIMIT $6`,
            tenantId,
            agreementId,
            authority,
            status,
            eventType,
            limit,
          ),
        [],
      );
    });

    return NextResponse.json({
      reports: rows,
      total: rows.length,
    });
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[rental/tarrashud GET] error:', err);
    return NextResponse.json(
      { error: 'Failed to load UAE regulatory reports' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'agreements',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  const actorId = (req.headers.get('x-user-id') ?? '').trim() || 'system';

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(
      (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;

    const agreementId = String(body.agreementId ?? '').trim();
    if (!agreementId) {
      return NextResponse.json({ error: 'agreementId is required' }, { status: 400 });
    }

    const rawEventType = String(body.eventType ?? 'HANDOVER')
      .trim()
      .toUpperCase() as UaeRegulatoryEventType;
    if (!ALLOWED_EVENT_TYPES.has(rawEventType)) {
      return NextResponse.json(
        {
          error:
            'Invalid eventType: must be HANDOVER, EXTENSION, VEHICLE_SWAP, RETURN, or CANCELLATION',
        },
        { status: 400 },
      );
    }

    let resolvedAuthority: UaeRegulatoryAuthority | undefined;
    if (body.authority != null && String(body.authority).trim() !== '') {
      const cand = String(body.authority).trim().toUpperCase() as UaeRegulatoryAuthority;
      if (!ALLOWED_AUTHORITIES.has(cand)) {
        return NextResponse.json(
          {
            error:
              'Invalid authority: must be RTA_TARRASHUD, DUBAI_POLICE, or ABU_DHABI_ITC',
          },
          { status: 400 },
        );
      }
      resolvedAuthority = determineUaeRegulatoryAuthority(null, cand);
    }

    const previousVehicleId =
      typeof body.previousVehicleId === 'string' && body.previousVehicleId.trim()
        ? body.previousVehicleId.trim()
        : null;
    const previousPlateNumber =
      typeof body.previousPlateNumber === 'string' && body.previousPlateNumber.trim()
        ? body.previousPlateNumber.trim()
        : null;

    // Phase 1: Queue regulatory manifest inside tenant RLS transaction
    const phase1 = await withTenantRls(prisma, tenantId, async (tx) => {
      const agrCheck = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id
           FROM rental_agreements
          WHERE id::text = $1
            AND tenant_id = $2
          LIMIT 1`,
        agreementId,
        tenantId,
      );
      if (agrCheck.length === 0) {
        return { notFound: true as const, report: null };
      }

      const queued = await queueUaeRegulatoryReportInTx(tx, {
        tenantId,
        agreementId,
        authority: resolvedAuthority,
        eventType: rawEventType,
        submittedBy: actorId,
        previousVehicleId,
        previousPlateNumber,
      });

      return { notFound: false as const, report: queued };
    });

    if (phase1.notFound) {
      return NextResponse.json({ error: 'Rental agreement not found' }, { status: 404 });
    }
    if (!phase1.report) {
      return NextResponse.json(
        { error: 'Unable to queue regulatory report for agreement' },
        { status: 422 },
      );
    }

    // Phase 2: Dispatch live HTTPS request strictly OUTSIDE `withTenantRls`
    const finalReport =
      phase1.report.status === 'QUEUED'
        ? await dispatchUaeRegulatoryReportOutsideRls(phase1.report)
        : phase1.report;

    return NextResponse.json({ report: finalReport }, { status: 201 });
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[rental/tarrashud POST] error:', err);
    return NextResponse.json(
      { error: 'Failed to submit UAE regulatory report' },
      { status: 500 },
    );
  }
}
