export const dynamic = 'force-dynamic';

/**
 * POST /api/leasing/invoices/[id]/void
 *
 * Leasing has no credit-note concept (unlike the rental module's
 * rental_invoices void, which auto-generates an offsetting negative
 * sibling invoice for anything already paid). This mirrors the simpler
 * half of that pattern: a status flip to CANCELLED with an audit note,
 * refused outright for a fully PAID invoice (nothing here reverses actual
 * customer payments) — the return workflow's `correct` action is what
 * reverses a *deposit application* against an invoice; this endpoint is
 * for voiding the invoice record itself when nothing has been collected
 * against it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { logAudit } from '@/lib/audit';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;
  const actor = req.headers.get('x-user-id') ?? 'staff';

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(bodyRaw);

      const invoice = await tx.leaseInvoice.findFirst({ where: { id: params.id, tenantId } });
      if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      if (invoice.status === 'CANCELLED') {
        return NextResponse.json({ error: 'Invoice already cancelled' }, { status: 400 });
      }
      if (invoice.status === 'PAID') {
        return NextResponse.json(
          { error: 'Paid invoices cannot be voided — reverse the underlying payment or deposit application first.' },
          { status: 400 },
        );
      }

      const timestamp = new Date().toISOString();
      const updated = await tx.leaseInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'CANCELLED',
          notes: `${invoice.notes ? invoice.notes + '\n' : ''}[${timestamp}] Voided by ${actor}${body.reason ? `: ${body.reason}` : ''}`,
        },
      });

      void logAudit({
        tenantId,
        userId: actor,
        entityType: 'LeaseInvoice',
        entityId: invoice.id,
        action: 'UPDATE',
        details: `Invoice ${invoice.invoiceNo ?? invoice.id} voided${body.reason ? `: ${body.reason}` : ''}`,
      });

      return NextResponse.json(updated);
    } catch (e) {
      console.error('[invoices/[id]/void]', e);
      return NextResponse.json({ error: 'Failed to void invoice' }, { status: 500 });
    }
  });
}
