import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureFleetSchema();
  try {
    const { id } = await params;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT fwo.*, v.vehicle_code, v.make, v.model, v.license_plate,
              v.vehicle_type_id, v.branch_id, v.branch_name
       FROM fleet_work_orders fwo
       LEFT JOIN vehicles v ON v.id = fwo.vehicle_id
       WHERE fwo.id = $1`,
      id,
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Work order not found' }, { status: 404 });
    }

    return NextResponse.json(rowToCamel(rows[0]));
  } catch (error) {
    console.error('Error fetching work order:', error);
    return NextResponse.json({ error: 'Failed to fetch work order' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureFleetSchema();
  try {
    const { id } = await params;
    const body = await req.json();

    const fieldMap: Record<string, string> = {
      vehicleId: 'vehicle_id',
      woType: 'wo_type',
      status: 'status',
      priority: 'priority',
      garageName: 'garage_name',
      garageContact: 'garage_contact',
      assignedTo: 'assigned_to',
      scheduledDate: 'scheduled_date',
      startDate: 'start_date',
      endDate: 'end_date',
      odometerAtEntry: 'odometer_at_entry',
      authorizedPoAmount: 'authorized_po_amount',
      actualCost: 'actual_cost',
      description: 'description',
      findings: 'findings',
      actionsTaken: 'actions_taken',
      lineItems: 'line_items',
      requestedBy: 'requested_by',
      approvedBy: 'approved_by',
      notes: 'notes',
    };

    const setClauses: string[] = [];
    const queryParams: unknown[] = [new Date().toISOString()];
    setClauses.push(`updated_at = $1`);

    for (const [camelKey, snakeKey] of Object.entries(fieldMap)) {
      if (Object.prototype.hasOwnProperty.call(body, camelKey)) {
        let value = body[camelKey];
        if (camelKey === 'lineItems' && value !== null && typeof value === 'object') {
          value = JSON.stringify(value);
        }
        queryParams.push(value);
        setClauses.push(`${snakeKey} = $${queryParams.length}`);
      }
    }

    // Recompute variance whenever actual_cost or authorized_po_amount is being updated
    const hasActualCost = Object.prototype.hasOwnProperty.call(body, 'actualCost');
    const hasAuthorizedPo = Object.prototype.hasOwnProperty.call(body, 'authorizedPoAmount');

    if (hasActualCost || hasAuthorizedPo) {
      // Fetch current values to compute correctly
      const current = await prisma.$queryRawUnsafe<
        Array<{ actual_cost: unknown; authorized_po_amount: unknown }>
      >(
        `SELECT actual_cost, authorized_po_amount FROM fleet_work_orders WHERE id = $1`,
        id,
      );
      if (current.length > 0) {
        const actualCost =
          hasActualCost ? body.actualCost : current[0].actual_cost;
        const authorizedPoAmount =
          hasAuthorizedPo ? body.authorizedPoAmount : current[0].authorized_po_amount;

        if (actualCost !== null && authorizedPoAmount !== null) {
          const variance = Number(actualCost) - Number(authorizedPoAmount);
          const varianceAlert = variance > 0;

          queryParams.push(variance);
          setClauses.push(`variance = $${queryParams.length}`);
          queryParams.push(varianceAlert);
          setClauses.push(`variance_alert = $${queryParams.length}`);
        }
      }
    }

    queryParams.push(id);
    const idParam = queryParams.length;

    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `UPDATE fleet_work_orders SET ${setClauses.join(', ')} WHERE id = $${idParam} RETURNING *`,
      ...queryParams,
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Work order not found' }, { status: 404 });
    }

    return NextResponse.json(rowToCamel(rows[0]));
  } catch (error) {
    console.error('Error updating work order:', error);
    return NextResponse.json({ error: 'Failed to update work order' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureFleetSchema();
  try {
    const { id } = await params;
    // Work orders are cancelled, not hard deleted
    await prisma.$executeRawUnsafe(
      `UPDATE fleet_work_orders SET status = 'CANCELLED' WHERE id = $1`,
      id,
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error cancelling work order:', error);
    return NextResponse.json({ error: 'Failed to cancel work order' }, { status: 500 });
  }
}
