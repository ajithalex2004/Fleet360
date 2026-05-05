/**
 * POST /api/agents/route-results/[id]/apply
 * Applies an operator-approved optimised sequence back to the live route.
 *
 * Body (optional): { action: 'APPLY' | 'REJECT', rejected_by?: string }
 * Default action is APPLY.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAgentSchema } from '@/lib/agents/schema';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await ensureAgentSchema();

    const body = await req.json().catch(() => ({}));
    const action = (body.action ?? 'APPLY') as 'APPLY' | 'REJECT';
    const rejectedBy: string = body.rejected_by ?? 'operator';

    const id = params.id;

    // Fetch the result record
    const rows = await prisma.$queryRaw<ResultRow[]>`
      SELECT id::text, route_id::text, optimised_sequence, status
      FROM route_optimisation_results
      WHERE id = ${id}::uuid
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Result not found' }, { status: 404 });
    }

    const record = rows[0];

    if (record.status === 'AUTO_APPLIED' || record.status === 'APPLIED') {
      return NextResponse.json({ error: 'Route already applied', status: record.status });
    }

    if (action === 'REJECT') {
      await prisma.$executeRaw`
        UPDATE route_optimisation_results
        SET status = 'REJECTED', rejected_at = NOW(), rejected_by = ${rejectedBy}, updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
      return NextResponse.json({ ok: true, action: 'REJECTED' });
    }

    // APPLY — update the live route's stop_sequence
    const optimisedSeq = record.optimised_sequence;

    await prisma.$executeRawUnsafe(`
      UPDATE school_bus_routes
      SET stop_sequence = $1::jsonb, updated_at = NOW()
      WHERE id = $2::uuid
    `, JSON.stringify(optimisedSeq), record.route_id);

    await prisma.$executeRaw`
      UPDATE route_optimisation_results
      SET status = 'APPLIED', applied_at = NOW(), updated_at = NOW()
      WHERE id = ${id}::uuid
    `;

    return NextResponse.json({ ok: true, action: 'APPLIED', route_id: record.route_id });
  } catch (err) {
    console.error('route-results/apply POST error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

interface ResultRow {
  id: string;
  route_id: string;
  optimised_sequence: unknown;
  status: string;
}
