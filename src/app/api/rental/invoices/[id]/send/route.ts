export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/invoices/:id/send
 * Marks an invoice as SENT (transitions from DRAFT → SENT), posts the balanced
 * double-entry General Ledger entry (`postRacInvoiceIssuedGl` or `postRacCreditNoteOrVoidGl`
 * idempotently), and mirrors to Finance post-commit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { mirrorRentalInvoiceToFinance } from '@/lib/finance/module-ledger';
import {
  postRacCreditNoteOrVoidGl,
  postRacInvoiceIssuedGl,
} from '@/lib/finance/rac-gl-posting';

const ALLOWED_CHANNELS = new Set(['EMAIL', 'WHATSAPP', 'SMS', 'PORTAL']);

function sanitizeNoteToken(v: unknown): string {
  return String(v ?? '')
    .replace(/[\r\n\[\]]/g, ' ')
    .trim()
    .slice(0, 128);
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bodyRaw = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    );

    const rawChannel = String(body.channel ?? 'EMAIL').trim().toUpperCase();
    const channel = ALLOWED_CHANNELS.has(rawChannel) ? rawChannel : 'EMAIL';
    const recipientEmail = body.recipientEmail ? sanitizeNoteToken(body.recipientEmail) : null;
    const recipientPhone = body.recipientPhone ? sanitizeNoteToken(body.recipientPhone) : null;
    const sentBy = req.headers.get('x-user-id')?.trim() || null;

    type SendOutcome =
      | { ok: true; payload: unknown }
      | { ok: false; response: NextResponse };

    const outcome = await withTenantRls<SendOutcome>(prisma, tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<any[]>(
        `SELECT ri.*, ra.agreement_no
           FROM rental_invoices ri
           LEFT JOIN rental_agreements ra
             ON ra.id = ri.agreement_id
            AND ra.tenant_id::text = ri.tenant_id::text
          WHERE ri.id = $1
            AND ri.tenant_id::text = $2
            AND ri.deleted_at IS NULL`,
        params.id,
        tenantId,
      );
      if (!rows.length) {
        return {
          ok: false,
          response: NextResponse.json({ error: 'Invoice not found' }, { status: 404 }),
        };
      }

      const inv = rows[0];
      const currentStatusUpper = String(inv.status ?? 'DRAFT').toUpperCase();
      if (['VOID', 'CANCELLED'].includes(currentStatusUpper)) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: `Cannot send a ${inv.status} invoice` },
            { status: 422 },
          ),
        };
      }

      const now = new Date().toISOString();
      const sentNote =
        '[SENT ' +
        now +
        ' via ' +
        channel +
        (sentBy ? ' by ' + sanitizeNoteToken(sentBy) : '') +
        (recipientEmail ? ' to ' + recipientEmail : '') +
        ']';
      const existingNotes = inv.internal_notes
        ? inv.internal_notes + '\n' + sentNote
        : sentNote;

      // Transition: DRAFT → SENT; all other issued statuses remain unchanged
      const newStatus = currentStatusUpper === 'DRAFT' ? 'SENT' : String(inv.status);

      await tx.$executeRawUnsafe(
        `UPDATE rental_invoices
            SET status = $1,
                internal_notes = $2,
                updated_at = $3::timestamptz
          WHERE id = $4
            AND tenant_id::text = $5
            AND deleted_at IS NULL`,
        newStatus,
        existingNotes,
        now,
        params.id,
        tenantId,
      );

      // Post idempotent double-entry GL (`RAC_INVOICE_ISSUED:${id}` or `RAC_CREDIT_NOTE:${id}`)
      const lines = await tx.$queryRawUnsafe<
        Array<{
          line_type: string | null;
          description: string | null;
          amount: string | number;
          taxable: boolean | null;
          quantity: string | number | null;
          unit_label: string | null;
        }>
      >(
        `SELECT line_type, description, amount, taxable, quantity, unit_label
           FROM rental_invoice_line_items
          WHERE invoice_id = $1 AND tenant_id::text = $2
          ORDER BY sort_order ASC`,
        params.id,
        tenantId,
      );
      const glLines = lines.map((l) => ({
        lineType: l.line_type,
        description: l.description,
        amount: Number(l.amount ?? 0),
        taxable: l.taxable,
        quantity: l.quantity != null ? Number(l.quantity) : 1,
        unitLabel: l.unit_label,
      }));

      if (String(inv.invoice_type ?? '').toUpperCase() === 'CREDIT_NOTE') {
        let parentInvoiceNo: string | null = null;
        if (inv.parent_invoice_id) {
          const pRows = await tx.$queryRawUnsafe<Array<{ invoice_no: string }>>(
            'SELECT invoice_no FROM rental_invoices WHERE id = $1 AND tenant_id::text = $2 LIMIT 1',
            inv.parent_invoice_id,
            tenantId,
          );
          parentInvoiceNo = pRows[0]?.invoice_no ?? null;
        }
        await postRacCreditNoteOrVoidGl(tx, {
          tenantId,
          creditNoteOrInvoiceId: params.id,
          documentNo: String(inv.invoice_no ?? params.id),
          parentInvoiceNo,
          entryDate: inv.invoice_date ?? now,
          currency: String(inv.currency ?? 'AED'),
          subtotalMagnitude: Math.abs(Number(inv.subtotal ?? 0)),
          taxMagnitude: Math.abs(Number(inv.tax_amount ?? 0)),
          totalMagnitude: Math.abs(Number(inv.total_amount ?? 0)),
          lines: glLines,
          preparedBy: sentBy ?? 'rental-api',
        });
      } else {
        await postRacInvoiceIssuedGl(tx, {
          tenantId,
          invoiceId: params.id,
          invoiceNo: String(inv.invoice_no ?? params.id),
          agreementNo: (inv.agreement_no as string | null) ?? null,
          invoiceDate: inv.invoice_date ?? now,
          status: newStatus,
          currency: String(inv.currency ?? 'AED'),
          subtotal: Number(inv.subtotal ?? 0),
          discountAmount: Number(inv.discount_amount ?? 0),
          taxAmount: Number(inv.tax_amount ?? 0),
          totalAmount: Number(inv.total_amount ?? 0),
          lines: glLines,
          preparedBy: sentBy ?? 'rental-api',
        });
      }

      const updated = await tx.$queryRawUnsafe<any[]>(
        `SELECT *
           FROM rental_invoices
          WHERE id = $1
            AND tenant_id::text = $2
            AND deleted_at IS NULL`,
        params.id,
        tenantId,
      );

      return {
        ok: true,
        payload: {
          invoice: updated[0],
          sent: {
            at: now,
            channel,
            recipientEmail,
            recipientPhone,
            sentBy,
          },
        },
      };
    });

    if (!outcome.ok) {
      return outcome.response;
    }

    await mirrorRentalInvoiceToFinance(params.id, tenantId, sentBy ?? 'rental-api').catch((err) =>
      console.warn('[rental/send] mirror failed:', err),
    );

    return NextResponse.json(outcome.payload);
  } catch (e) {
    console.error('Invoice send error:', e);
    return NextResponse.json({ error: 'Failed to send invoice' }, { status: 500 });
  }
}
