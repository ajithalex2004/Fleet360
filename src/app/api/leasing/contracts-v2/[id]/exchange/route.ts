export const dynamic = 'force-dynamic';

/**
 * /api/leasing/contracts-v2/[id]/exchange — list and create vehicle exchanges.
 *
 * An exchange is also a physical return of the outgoing vehicle to the
 * fleet, so it must go through the same handover/clearance gate an
 * end-of-contract return does — it can auto-create a SCHEDULED RETURN
 * handover placeholder for the outgoing vehicle, but never auto-completes
 * one (that would skip real inspection/signature evidence). The exchange
 * stays blocked until a genuinely COMPLETED RETURN handover exists.
 *
 * Tenant scoping: requires x-tenant-id. The contract must belong to the
 * caller's tenant; the created LeaseVehicleExchange row is stamped with the
 * same tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { withContractAndVehicleLock } from '@/lib/leasing/contract-lock';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        // Verify contract ownership before exposing exchange history.
        const contract = await tx.leaseContract2.findFirst({
          where: { id: params.id, tenantId },
          select: { id: true },
        });
        if (!contract) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const exchanges = await tx.leaseVehicleExchange.findMany({
          where: { tenantId, contractId: params.id },
          orderBy: { exchangeDate: 'desc' },
        });
        return NextResponse.json(exchanges);
      } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const { outgoingVehicleId, incomingVehicleId } = body as { outgoingVehicleId?: string; incomingVehicleId?: string };

      const contract = await tx.leaseContract2.findFirst({
        where: { id: params.id, tenantId },
        select: { id: true },
      });
      if (!contract) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const result = await withContractAndVehicleLock(
        tx,
        tenantId,
        { contractId: params.id, vehicleIds: [outgoingVehicleId, incomingVehicleId] },
        async () => {
          if (outgoingVehicleId) {
            const completedHandover = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT id FROM leasing_handovers
                WHERE tenant_id = $1 AND contract_id = $2 AND vehicle_id = $3
                  AND handover_type = 'RETURN' AND status = 'COMPLETED'
                ORDER BY handover_date DESC LIMIT 1`,
              tenantId, params.id, outgoingVehicleId,
            );
            if (!completedHandover.length) {
              const existingTask = await tx.$queryRawUnsafe<Array<{ id: string }>>(
                `SELECT id FROM leasing_handovers
                  WHERE tenant_id = $1 AND contract_id = $2 AND vehicle_id = $3
                    AND handover_type = 'RETURN' AND status IN ('SCHEDULED','IN_PROGRESS')
                  LIMIT 1`,
                tenantId, params.id, outgoingVehicleId,
              );
              if (!existingTask.length) {
                const contractVehicle = await tx.leaseContractVehicle.findFirst({
                  where: { tenantId, contractId: params.id, vehicleId: outgoingVehicleId },
                });
                const occurrence = contractVehicle
                  ? await tx.leaseAllocationOccurrence.findFirst({
                      where: { tenantId, contractVehicleId: contractVehicle.id, vehicleId: outgoingVehicleId, status: 'ACTIVE' },
                    })
                  : null;
                const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
                const [seqRow] = await tx.$queryRawUnsafe<Array<{ seq: bigint }>>(
                  `SELECT COUNT(*) + 1 AS seq FROM leasing_handovers WHERE tenant_id = $1 AND handover_no LIKE $2`,
                  tenantId, `LHO-${yyyymm}-%`,
                );
                const handoverNo = `LHO-${yyyymm}-${String(Number(seqRow?.seq ?? 1)).padStart(4, '0')}`;
                await tx.$executeRawUnsafe(
                  `INSERT INTO leasing_handovers
                     (tenant_id, handover_no, contract_id, vehicle_id, vehicle_no, lessee_name, handover_type, handover_date, status, occurrence_id)
                   VALUES ($1,$2,$3,$4,$5,$6,'RETURN',$7,'SCHEDULED',$8)`,
                  tenantId, handoverNo, params.id, outgoingVehicleId, outgoingVehicleId, 'Exchange outgoing vehicle',
                  new Date().toISOString(), occurrence?.id ?? null,
                );
              }
              return NextResponse.json(
                { error: 'Outgoing vehicle inspection not yet completed — a RETURN handover must be COMPLETED before this exchange can proceed.' },
                { status: 409 },
              );
            }
          }

          const exchange = await tx.leaseVehicleExchange.create({
            data: {
              ...body,
              contractId: params.id,
              exchangeDate: body.exchangeDate ? new Date(body.exchangeDate) : new Date(),
              tenantId,
            },
          });

          if (incomingVehicleId && outgoingVehicleId) {
            const contractVehicle = await tx.leaseContractVehicle.findFirst({
              where: { tenantId, contractId: params.id, vehicleId: outgoingVehicleId },
            });

            // LeaseContractVehicle keeps its existing in-place-mutation
            // behavior — other consumers already depend on this row being
            // the current-snapshot for the slot. History instead lives in
            // LeaseAllocationOccurrence.
            await tx.leaseContractVehicle.updateMany({
              where: { tenantId, contractId: params.id, vehicleId: outgoingVehicleId },
              data: { vehicleId: incomingVehicleId, status: 'EXCHANGED' },
            });

            if (contractVehicle) {
              const outgoingOccurrence = await tx.leaseAllocationOccurrence.findFirst({
                where: { tenantId, contractVehicleId: contractVehicle.id, vehicleId: outgoingVehicleId, status: 'ACTIVE' },
              });
              // May already be ENDED if the outgoing handover's own
              // COMPLETE action already closed it via linkReturnFromHandover
              // — only close it here if that hasn't happened yet.
              if (outgoingOccurrence) {
                await tx.leaseAllocationOccurrence.update({
                  where: { id: outgoingOccurrence.id },
                  data: { status: 'ENDED', endedAt: exchange.exchangeDate, endReason: 'EXCHANGE' },
                });
              }

              const maxSeq = await tx.leaseAllocationOccurrence.aggregate({
                where: { tenantId, contractVehicleId: contractVehicle.id },
                _max: { sequenceNo: true },
              });
              await tx.leaseAllocationOccurrence.create({
                data: {
                  tenantId,
                  contractId: params.id,
                  contractVehicleId: contractVehicle.id,
                  vehicleId: incomingVehicleId,
                  sequenceNo: (maxSeq._max.sequenceNo ?? 0) + 1,
                  startedAt: exchange.exchangeDate,
                  status: 'ACTIVE',
                },
              });
            }
          }

          return NextResponse.json(exchange, { status: 201 });
        },
      );

      return result;
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
