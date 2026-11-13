export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withSavepoint } from '@/lib/rental/locks';
import { matchFineOrToll, type FineMatchResult } from '@/lib/fleet/fine-toll-matcher';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const vehicleId = sp.get('vehicleId');
      const status = sp.get('status');
      const rentalAgreementId = sp.get('rentalAgreementId')?.trim() || null;
      const { take, skip, page, limit } = paginate(sp);

      let agreementFineIds: string[] | null = null;
      if (rentalAgreementId && typeof tx.$queryRawUnsafe === 'function') {
        const idRows = await withSavepoint<Array<{ id: string }> | null>(
          tx,
          'tf_list_by_agr_ids',
          () =>
            tx.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT id::text AS id
                 FROM traffic_fines
                WHERE tenant_id = $1
                  AND rental_agreement_id = $2`,
              tenantId,
              rentalAgreementId,
            ),
          null,
        );
        if (idRows !== null) {
          agreementFineIds = idRows.map((r) => r.id);
        }
      }

      const where: Prisma.TrafficFineWhereInput = {
        tenantId,
        ...(vehicleId ? { vehicleId } : {}),
        ...(status ? { status } : {}),
        ...(agreementFineIds !== null ? { id: { in: agreementFineIds } } : {}),
      };

      // Sequential queries on `tx` inside `withTenantRls` (never Promise.all on single Postgres connection)
      const data = await tx.trafficFine.findMany({
        where,
        orderBy: { fineDate: 'desc' },
        take,
        skip,
      });
      const total = await tx.trafficFine.count({ where });

      // Enrich with RAC columns (`rental_agreement_id`, `admin_fee`, `knowledge_fee`, `is_billed_to_customer`, `billed_invoice_id`)
      if (data.length > 0 && typeof tx.$queryRawUnsafe === 'function') {
        const ids = data.map((d) => d.id);
        const extraRows = await withSavepoint<
          Array<{
            id: string;
            rental_agreement_id: string | null;
            admin_fee: number | string | null;
            knowledge_fee: number | string | null;
            is_billed_to_customer: boolean | null;
            billed_invoice_id: string | null;
          }>
        >(
          tx,
          'tf_enrich_rac_cols',
          () =>
            tx.$queryRawUnsafe(
              `SELECT id::text AS id,
                      rental_agreement_id,
                      admin_fee,
                      knowledge_fee,
                      is_billed_to_customer,
                      billed_invoice_id
                 FROM traffic_fines
                WHERE tenant_id = $1
                  AND id::text = ANY($2::text[])`,
              tenantId,
              ids,
            ),
          [],
        );

        if (extraRows.length > 0) {
          const extraMap = new Map(extraRows.map((r) => [r.id, r]));
          const enriched = data.map((row) => {
            const ext = extraMap.get(row.id);
            if (!ext) return row;
            return {
              ...row,
              rentalAgreementId: ext.rental_agreement_id ?? null,
              adminFee: round2(Number(ext.admin_fee ?? 0)),
              knowledgeFee: round2(Number(ext.knowledge_fee ?? 0)),
              isBilledToCustomer: Boolean(ext.is_billed_to_customer),
              billedInvoiceId: ext.billed_invoice_id ?? null,
            };
          });
          return NextResponse.json(paginatedResponse(enriched, total, page, limit));
        }
      }

      return NextResponse.json(paginatedResponse(data, total, page, limit));
    } catch (e) {
      console.error('Error fetching traffic fines:', e);
      return NextResponse.json({ error: 'Failed to fetch traffic fines' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const sanitized = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      ) as Record<string, unknown>;

      // Extract RAC-extended fields that may not be present on pre-generated `@prisma/client`
      const {
        rentalAgreementId: rawRentalAgreementId,
        rental_agreement_id: rawRentalAgreementSnake,
        adminFee: rawAdminFee,
        admin_fee: rawAdminFeeSnake,
        knowledgeFee: rawKnowledgeFee,
        knowledge_fee: rawKnowledgeFeeSnake,
        isBilledToCustomer: _ignoredBilled1,
        is_billed_to_customer: _ignoredBilled2,
        billedInvoiceId: _ignoredInv1,
        billed_invoice_id: _ignoredInv2,
        ...prismaBody
      } = sanitized;

      const explicitAgreementId =
        typeof rawRentalAgreementId === 'string' && rawRentalAgreementId.trim()
          ? rawRentalAgreementId.trim()
          : typeof rawRentalAgreementSnake === 'string' && rawRentalAgreementSnake.trim()
            ? rawRentalAgreementSnake.trim()
            : null;

      const fineAmountNum = round2(Number(prismaBody.fineAmount ?? 0));
      const authorityStr = typeof prismaBody.authority === 'string' ? prismaBody.authority : null;
      const authorityNorm = String(authorityStr ?? '')
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_');

      const suppliedAdminFee = rawAdminFee ?? rawAdminFeeSnake;
      const adminFee =
        suppliedAdminFee !== undefined && suppliedAdminFee !== null && suppliedAdminFee !== ''
          ? Math.max(0, round2(Number(suppliedAdminFee)))
          : 0;

      const suppliedKnowledgeFee = rawKnowledgeFee ?? rawKnowledgeFeeSnake;
      const isDubaiStatutoryAuthority =
        authorityNorm === 'RTA' ||
        authorityNorm === 'DUBAI_POLICE' ||
        authorityNorm === 'RTA_DUBAI';
      const knowledgeFee =
        suppliedKnowledgeFee !== undefined &&
        suppliedKnowledgeFee !== null &&
        suppliedKnowledgeFee !== ''
          ? Math.max(0, round2(Number(suppliedKnowledgeFee)))
          : isDubaiStatutoryAuthority && fineAmountNum !== 0
            ? 20
            : 0;

      const vehicleId =
        typeof prismaBody.vehicleId === 'string' && prismaBody.vehicleId.trim()
          ? prismaBody.vehicleId.trim()
          : null;
      const fineDateVal = prismaBody.fineDate
        ? new Date(String(prismaBody.fineDate))
        : null;

      // Auto-match against DriverShifts & active/swapped RAC RentalAgreements when vehicleId + fineDate provided
      let autoMatch: FineMatchResult | null = null;
      let resolvedAgreementId: string | null = explicitAgreementId;
      let resolvedDriverId: string | null =
        typeof prismaBody.driverId === 'string' && prismaBody.driverId.trim()
          ? prismaBody.driverId.trim()
          : null;
      let resolvedAssignedTo: string | null =
        typeof prismaBody.assignedTo === 'string' && prismaBody.assignedTo.trim()
          ? prismaBody.assignedTo.trim()
          : explicitAgreementId
            ? 'RENTAL_CUSTOMER'
            : null;

      if (vehicleId && fineDateVal && !Number.isNaN(fineDateVal.getTime()) && !explicitAgreementId) {
        autoMatch = await matchFineOrToll(tx, {
          tenantId,
          vehicleId,
          fineDate: fineDateVal,
          fineAmount: fineAmountNum,
          offenceType:
            typeof prismaBody.offenceType === 'string' ? prismaBody.offenceType : null,
          authority: authorityStr,
        });

        if (autoMatch.assignedTo === 'RENTAL_CUSTOMER' && autoMatch.rentalAgreementId) {
          resolvedAgreementId = autoMatch.rentalAgreementId;
          resolvedAssignedTo = 'RENTAL_CUSTOMER';
        } else if (autoMatch.assignedTo === 'DRIVER' && autoMatch.driverId && !resolvedDriverId) {
          resolvedDriverId = autoMatch.driverId;
          if (!resolvedAssignedTo) resolvedAssignedTo = 'DRIVER';
        } else if (autoMatch.assignedTo === 'COMPANY' && !resolvedAssignedTo) {
          resolvedAssignedTo = 'COMPANY';
        }
      }

      const createData: Record<string, unknown> = {
        ...prismaBody,
        tenantId,
        ...(fineDateVal && !Number.isNaN(fineDateVal.getTime()) ? { fineDate: fineDateVal } : {}),
        ...(resolvedDriverId ? { driverId: resolvedDriverId } : {}),
        ...(resolvedAssignedTo ? { assignedTo: resolvedAssignedTo } : {}),
      };

      const trafficFine = await tx.trafficFine.create({
        data: createData as Prisma.TrafficFineUncheckedCreateInput,
      });

      // Persist RAC-extended columns (`rental_agreement_id`, `admin_fee`, `knowledge_fee`, `is_billed_to_customer`)
      if (typeof tx.$executeRawUnsafe === 'function') {
        const updatedFull = await withSavepoint<number | null>(
          tx,
          'tf_create_rac_cols_full',
          () =>
            tx.$executeRawUnsafe(
              `UPDATE traffic_fines
                  SET rental_agreement_id = COALESCE($1, rental_agreement_id),
                      admin_fee = $2,
                      knowledge_fee = $3,
                      is_billed_to_customer = FALSE,
                      assigned_to = COALESCE($4, assigned_to)
                WHERE id::text = $5
                  AND tenant_id = $6`,
              resolvedAgreementId,
              adminFee,
              knowledgeFee,
              resolvedAssignedTo,
              trafficFine.id,
              tenantId,
            ),
          null,
        );

        if (updatedFull === null && resolvedAgreementId) {
          await withSavepoint(
            tx,
            'tf_create_rac_cols_min',
            () =>
              tx.$executeRawUnsafe(
                `UPDATE traffic_fines
                    SET rental_agreement_id = COALESCE($1, rental_agreement_id),
                        assigned_to = COALESCE($2, assigned_to)
                  WHERE id::text = $3
                    AND tenant_id = $4`,
                resolvedAgreementId,
                resolvedAssignedTo,
                trafficFine.id,
                tenantId,
              ),
            0,
          );
        }
      }

      return NextResponse.json(
        {
          ...trafficFine,
          driverId: resolvedDriverId ?? trafficFine.driverId,
          assignedTo: resolvedAssignedTo ?? trafficFine.assignedTo,
          rentalAgreementId: resolvedAgreementId,
          adminFee,
          knowledgeFee,
          isBilledToCustomer: false,
          billedInvoiceId: null,
          autoMatch,
        },
        { status: 201 },
      );
    } catch (e) {
      console.error('Error creating traffic fine:', e);
      return NextResponse.json({ error: 'Failed to create traffic fine' }, { status: 500 });
    }
  });
}
