import { NextRequest, NextResponse } from 'next/server';
import { assertCanWrite } from '@/lib/access-control';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import {
  reverseCashAllocation,
  writeOffInvoiceOutstanding,
} from '@/lib/finance/cash-allocation';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const guard = assertCanWrite(req, 'finance');
  if (guard) return guard;

  try {
    const { id } = await params;
    const ctx = requireOperationalContext(req, 'finance', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const body = await req.json();
    const action = body.action;

    if (action === 'reverse_allocation') {
      const result = await reverseCashAllocation(
        req,
        ctx,
        id,
        String(body.reason ?? 'Allocation reversed by finance user'),
      );
      return NextResponse.json(result);
    }

    if (action === 'write_off_invoice') {
      const result = await writeOffInvoiceOutstanding(
        req,
        ctx,
        id,
        String(body.reason ?? 'Receivable write-off'),
      );
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[finance/cash-allocation/:id] PATCH error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to update cash allocation',
    }, { status: 500 });
  }
}
