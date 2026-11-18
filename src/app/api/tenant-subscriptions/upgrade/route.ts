import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { randomInt, randomUUID } from 'crypto';
import { withAuditedAction } from '@/lib/audited-action';
import { logAuditInTx } from '@/lib/audit';
import { revokeSessionsSafely } from '@/lib/auth/session-revocation';
import { getStripe, isStripeConfigured, PLAN_CODES, type PlanCode } from '@/lib/billing';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import {
  requireAuthorizedTenant,
  requireSuperAdminForTenant,
  stripTenantOwnershipFields,
} from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_CYCLES = ['MONTHLY', 'ANNUAL'] as const;
type BillingCycle = (typeof VALID_CYCLES)[number];

const MONTHLY_PLAN_PRICES_AED: Record<PlanCode, string> = {
  TRIAL: '0.00',
  STANDARD: '750.00',
  PROFESSIONAL: '1500.00',
  ENTERPRISE: '2500.00',
};

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  const role = String(authz.role ?? '').trim().toUpperCase();
  if (role !== 'SUPER_ADMIN' && role !== 'TENANT_ADMIN') {
    return NextResponse.json(
      { error: 'Only SUPER_ADMIN or TENANT_ADMIN may upgrade a tenant subscription' },
      { status: 403 },
    );
  }

  try {
    const rawBody = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    let targetTenantId = authz.tenantId;
    if (typeof rawBody.tenantId === 'string' && rawBody.tenantId.trim()) {
      const requestedTenantId = rawBody.tenantId.trim();
      const guard = requireSuperAdminForTenant(authz, requestedTenantId);
      if (!guard.ok) {
        return NextResponse.json({ error: guard.error }, { status: guard.status });
      }
      targetTenantId = requestedTenantId;
    }

    if (/[^a-zA-Z0-9_-]/.test(targetTenantId)) {
      return NextResponse.json({ error: 'Invalid tenantId format' }, { status: 400 });
    }

    const body = stripTenantOwnershipFields(rawBody);
    const targetPlan = String(body.targetPlan ?? body.plan ?? '').trim().toUpperCase();
    if (!PLAN_CODES.includes(targetPlan as PlanCode)) {
      return NextResponse.json(
        { error: `Invalid plan '${targetPlan || ''}'. Must be one of: ${PLAN_CODES.join(', ')}` },
        { status: 400 },
      );
    }
    const validPlan = targetPlan as PlanCode;

    const billingCycleRaw = String(body.billingCycle ?? body.cycle ?? 'MONTHLY').trim().toUpperCase();
    if (!VALID_CYCLES.includes(billingCycleRaw as BillingCycle)) {
      return NextResponse.json(
        { error: `Invalid billing cycle '${billingCycleRaw}'. Must be MONTHLY or ANNUAL` },
        { status: 400 },
      );
    }
    const billingCycle = billingCycleRaw as BillingCycle;

    const monthlyPrice = new Prisma.Decimal(MONTHLY_PLAN_PRICES_AED[validPlan]);
    const subtotal = monthlyPrice
      .times(billingCycle === 'ANNUAL' ? 12 : 1)
      .toDecimalPlaces(2);
    const vatRate = new Prisma.Decimal('5.00');
    const vatAmount = subtotal.times('0.05').toDecimalPlaces(2);
    const totalAmount = subtotal.plus(vatAmount).toDecimalPlaces(2);
    const expectedAmountFils = Math.round(Number(totalAmount.times(100).toFixed(0)));

    // Require verified payment for non-SUPER_ADMIN self-service upgrades (paid plans)
    let verifiedStripeCustomerId: string | undefined;
    let verifiedStripeSubscriptionId: string | undefined;
    let verifiedStripeInvoiceId: string | undefined;
    let redeemedStripeEventId: string | null = null;

    if (role !== 'SUPER_ADMIN') {
      const stripeSessionId = typeof body.stripeSessionId === 'string' ? body.stripeSessionId.trim() : '';
      const paymentIntentId = typeof body.paymentIntentId === 'string' ? body.paymentIntentId.trim() : '';
      if (!stripeSessionId && !paymentIntentId) {
        return NextResponse.json(
          { error: 'Payment confirmation or platform admin authorization required to upgrade plan' },
          { status: 402 },
        );
      }
      if (!isStripeConfigured()) {
        return NextResponse.json(
          { error: 'Stripe billing is not configured to verify payment' },
          { status: 402 },
        );
      }

      const stripe = getStripe();
      if (stripeSessionId) {
        const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
        if (session.payment_status !== 'paid') {
          return NextResponse.json({ error: 'Stripe checkout session is not paid' }, { status: 402 });
        }
        if (!session.metadata?.tenantId || session.metadata.tenantId !== targetTenantId) {
          return NextResponse.json({ error: 'Forbidden: Tenant mismatch' }, { status: 403 });
        }
        if (session.currency?.toLowerCase() !== 'aed') {
          return NextResponse.json({ error: 'Invalid payment currency; expected AED' }, { status: 400 });
        }
        const metaPlan = String(session.metadata?.targetPlan ?? session.metadata?.plan ?? '').trim().toUpperCase();
        if (!metaPlan || metaPlan !== validPlan) {
          return NextResponse.json({ error: 'Payment session plan mismatch' }, { status: 400 });
        }
        if (session.metadata?.billingCycle && String(session.metadata.billingCycle).trim().toUpperCase() !== billingCycle) {
          return NextResponse.json({ error: 'Payment session billing cycle mismatch' }, { status: 400 });
        }
        if (typeof session.amount_total !== 'number' || session.amount_total < expectedAmountFils) {
          return NextResponse.json({ error: 'Paid amount is less than required subscription total' }, { status: 402 });
        }
        redeemedStripeEventId = `sub_upgrade:session:${stripeSessionId}`;
        verifiedStripeCustomerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        verifiedStripeSubscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        verifiedStripeInvoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice?.id;
      } else {
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (intent.status !== 'succeeded') {
          return NextResponse.json({ error: 'Payment intent has not succeeded' }, { status: 402 });
        }
        if (!intent.metadata?.tenantId || intent.metadata.tenantId !== targetTenantId) {
          return NextResponse.json({ error: 'Forbidden: Tenant mismatch' }, { status: 403 });
        }
        if (intent.currency?.toLowerCase() !== 'aed') {
          return NextResponse.json({ error: 'Invalid payment currency; expected AED' }, { status: 400 });
        }
        const metaPlan = String(intent.metadata?.targetPlan ?? intent.metadata?.plan ?? '').trim().toUpperCase();
        if (!metaPlan || metaPlan !== validPlan) {
          return NextResponse.json({ error: 'Payment intent plan mismatch' }, { status: 400 });
        }
        if (intent.metadata?.billingCycle && String(intent.metadata.billingCycle).trim().toUpperCase() !== billingCycle) {
          return NextResponse.json({ error: 'Payment intent billing cycle mismatch' }, { status: 400 });
        }
        if (typeof intent.amount_received !== 'number' || intent.amount_received < expectedAmountFils) {
          return NextResponse.json({ error: 'Paid amount is less than required subscription total' }, { status: 402 });
        }
        redeemedStripeEventId = `sub_upgrade:intent:${paymentIntentId}`;
        verifiedStripeCustomerId = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
      }
    }

    const now = new Date();
    const issueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dueDate = new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(
      issueDate.getTime() + (billingCycle === 'ANNUAL' ? 365 : 30) * 24 * 60 * 60 * 1000,
    );
    const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const invoiceNumber = `SUB-${ym}-${randomInt(1000, 10000)}-${randomUUID().slice(0, 4).toUpperCase()}`;

    const result = await withTenantRls(prisma, targetTenantId, async (tx) => {
      if (redeemedStripeEventId) {
        const alreadyRedeemed = await tx.stripeEventProcessed.findUnique({
          where: { stripeEventId: redeemedStripeEventId },
        });
        if (alreadyRedeemed) {
          return { replay: true as const };
        }
        await tx.stripeEventProcessed.create({
          data: { stripeEventId: redeemedStripeEventId },
        });
      }

      const existingTenant = await tx.tenant.findUnique({
        where: { id: targetTenantId },
        select: { id: true, name: true, contactEmail: true, plan: true },
      });

      if (!existingTenant) {
        return { replay: false as const, notFound: true as const };
      }

      const invoice = await tx.platformSubscriptionInvoice.create({
        data: {
          tenantId: targetTenantId,
          invoiceNumber,
          clientName: existingTenant.name,
          clientEmail: existingTenant.contactEmail,
          moduleCode: 'CORE',
          planTier: validPlan,
          billingCycle,
          issueDate,
          dueDate,
          subtotal,
          vatRate,
          vatAmount,
          totalAmount,
          currency: 'AED',
          paymentStatus: 'PAID',
          paidAmount: totalAmount,
          notes: `Platform subscription upgrade from ${existingTenant.plan ?? 'STANDARD'} to ${validPlan} (${billingCycle})`,
        },
      });

      await tx.tenant.update({
        where: { id: targetTenantId },
        data: { plan: validPlan, updatedAt: now },
      });

      const subStatus = validPlan === 'TRIAL' ? 'TRIALING' : 'ACTIVE';
      await tx.subscription.upsert({
        where: { tenantId: targetTenantId },
        create: {
          tenantId: targetTenantId,
          planCode: validPlan,
          planInterval: billingCycle,
          status: subStatus,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          ...(verifiedStripeCustomerId ? { stripeCustomerId: verifiedStripeCustomerId } : {}),
          ...(verifiedStripeSubscriptionId ? { stripeSubscriptionId: verifiedStripeSubscriptionId } : {}),
          ...(verifiedStripeInvoiceId ? { stripeLatestInvoiceId: verifiedStripeInvoiceId } : {}),
        },
        update: {
          planCode: validPlan,
          planInterval: billingCycle,
          status: subStatus,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          ...(verifiedStripeCustomerId ? { stripeCustomerId: verifiedStripeCustomerId } : {}),
          ...(verifiedStripeSubscriptionId ? { stripeSubscriptionId: verifiedStripeSubscriptionId } : {}),
          ...(verifiedStripeInvoiceId ? { stripeLatestInvoiceId: verifiedStripeInvoiceId } : {}),
        },
      });

      await logAuditInTx({
        tenantId: targetTenantId,
        entityType: 'Subscription',
        entityId: targetTenantId,
        action: 'UPDATE',
        userId: authz.userId ?? undefined,
        userRole: authz.role ?? undefined,
        details: `Upgraded tenant ${targetTenantId} plan from ${existingTenant.plan ?? 'STANDARD'} to ${validPlan} (${billingCycle}), invoice ${invoice.invoiceNumber}`,
      }, tx);

      return {
        replay: false as const,
        notFound: false as const,
        previousPlan: existingTenant.plan,
        invoice,
      };
    });

    if (result.replay) {
      return NextResponse.json(
        { error: 'Payment session or intent has already been redeemed' },
        { status: 409 },
      );
    }

    if (result.notFound) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    if (result.previousPlan !== validPlan) {
      await revokeSessionsSafely({
        tenantId: targetTenantId,
        reason: 'tenant-plan-changed',
        revokedBy: authz.userId,
      });
    }

    return NextResponse.json({
      ok: true,
      plan: validPlan,
      billingCycle,
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoiceNumber,
      subtotal: Number(result.invoice.subtotal),
      vatAmount: Number(result.invoice.vatAmount),
      totalAmount: Number(result.invoice.totalAmount),
      message: 'Plan upgraded successfully; dedicated platform billing record created without polluting customer AR',
    }, { status: 200 });
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: 'Payment session or intent has already been redeemed' }, { status: 409 });
    }
    console.error('[tenant-subscriptions/upgrade]', e);
    return NextResponse.json({ error: 'Failed to upgrade plan' }, { status: 500 });
  }
}

export const POST = withAuditedAction(handlePOST);
