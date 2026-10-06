export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/agreements/[id]/refund-deposit
 *
 * Requests the refund of a rental agreement's security deposit, through
 * Finance > Security Deposits: the agreement's deposit record (created from
 * the agreement if Finance has none yet) gets a refund request for the
 * amount given (default: all that's available after deductions). With a
 * company Refund Approval workflow, the request waits for it and the
 * agreement shows REFUND_REQUESTED until Finance pays it (REFUNDED) or the
 * request is rejected / cancelled (back to PAID); without one, the refund
 * is recorded and paid at once and the agreement shows REFUNDED.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { nextDocumentNumber } from '@/lib/finance/document-number';
import { startRefundRequest, SecurityDepositError } from '@/lib/finance/security-deposit';
import { approvalRequired, withApprovalStart } from '@/lib/workflow/approvals';
import { sessionUser } from '@/lib/session-user';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;
  const body = stripTenantOwnershipFields(await req.json().catch(() => ({}))) as Record<string, unknown>;

  const needsApproval = await approvalRequired(tenantId, 'finance_deposit_refund');
  const actor = (await sessionUser(req.headers).catch(() => null))?.email ?? req.headers.get('x-user-id') ?? 'staff';
  let depositId: string | null = null;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const agreement = await tx.rentalAgreement.findFirst({ where: { id: params.id, tenantId } });
      if (!agreement) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });
      if ((agreement.depositStatus ?? 'PENDING') !== 'PAID') {
        return NextResponse.json({
          error: agreement.depositStatus === 'REFUND_REQUESTED'
            ? 'A refund is already requested for this deposit'
            : `The deposit is ${agreement.depositStatus ?? 'PENDING'}: only a paid deposit can be refunded`,
        }, { status: 409 });
      }
      const collected = Number(agreement.securityDeposit ?? 0);
      if (!(collected > 0)) return NextResponse.json({ error: 'This agreement has no security deposit' }, { status: 400 });

      // The agreement's deposit in Finance (by agreement id or number), else one made from it.
      const found = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text AS id FROM finance_security_deposits
          WHERE tenant_id = $1 AND (contract_id = $2 OR contract_id = $3)
          ORDER BY created_at DESC LIMIT 1`,
        tenantId, agreement.id, agreement.agreementNo ?? '');
      depositId = found[0]?.id ?? null;
      if (!depositId) {
        const customer = await tx.rentalCustomer.findFirst({ where: { id: agreement.customerId, tenantId }, select: { fullName: true } });
        const vehicle = agreement.vehicleId
          ? await tx.vehicle.findFirst({ where: { id: agreement.vehicleId, tenantId }, select: { licensePlate: true, type: true } })
          : null;
        const depositNo = await nextDocumentNumber(tx, tenantId, 'FSD');
        const created = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO finance_security_deposits
             (tenant_id, deposit_no, contract_id, contract_type, customer_name, vehicle_no, vehicle_type, branch,
              collected_amount, collection_date, collection_method, notes)
           VALUES ($1,$2,$3,'RENTAL',$4,$5,$6,$7,$8::numeric,$9::date,$10,$11)
           RETURNING id::text AS id`,
          tenantId, depositNo, agreement.agreementNo ?? agreement.id, customer?.fullName ?? 'Rental customer',
          vehicle?.licensePlate ?? '—', vehicle?.type ?? null, String(body.branch ?? 'Dubai'),
          collected, agreement.startDate.toISOString().slice(0, 10), String(body.collection_method ?? 'CARD'),
          `Recorded from rental agreement ${agreement.agreementNo ?? agreement.id} when its refund was requested`);
        depositId = created[0].id;
      }

      const amount = body.refund_amount != null && body.refund_amount !== '' ? Number(body.refund_amount) : null;
      const deposit = await startRefundRequest(tx, tenantId, depositId, {
        amount, method: body.refund_method as string | undefined, reference: body.refund_reference as string | undefined,
        date: body.refund_date as string | undefined, actor, payNow: !needsApproval,
      });
      // Paid at once moved the agreement to REFUNDED already (executeRefund).
      if (needsApproval) {
        await tx.rentalAgreement.updateMany({ where: { id: agreement.id, tenantId }, data: { depositStatus: 'REFUND_REQUESTED', updatedAt: new Date() } });
      }
      const updated = await tx.rentalAgreement.findFirst({ where: { id: agreement.id, tenantId } });
      return NextResponse.json({
        agreement: updated,
        deposit: { id: depositId, deposit_no: deposit.deposit_no, refund_status: deposit.refund_status, refund_requested_amount: Number(deposit.refund_requested_amount ?? 0) },
      });
    } catch (e) {
      if (e instanceof SecurityDepositError) return NextResponse.json({ error: e.message }, { status: 400 });
      console.error('POST /api/rental/agreements/[id]/refund-deposit error:', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: 'Failed to request the refund' }, { status: 500 });
    }
  });

  return needsApproval && depositId && response.ok
    ? withApprovalStart(response, { headers: req.headers, tenantId, referenceType: 'finance_deposit_refund', referenceId: depositId })
    : response;
}
