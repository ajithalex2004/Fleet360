/**
 * POST /api/admin/billing/portal
 *
 * Creates a Stripe Customer Portal session — a hosted page where the
 * tenant admin can update payment method, view invoices, change plan,
 * or cancel. Returns the URL the client should redirect to.
 *
 * Auth: TENANT_ADMIN or SUPER_ADMIN.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStripe, getTenantBilling, isStripeConfigured } from '@/lib/billing';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ ok: false, error: 'Stripe is not configured.' }, { status: 503 });
  }

  const tenantId = req.headers.get('x-tenant-id');
  const role     = req.headers.get('x-user-role') ?? '';
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  if (role !== 'TENANT_ADMIN' && role !== 'SUPER_ADMIN') {
    return NextResponse.json({ ok: false, error: 'Only tenant admins can manage billing.' }, { status: 403 });
  }

  const billing = await getTenantBilling(tenantId);
  if (!billing?.stripeCustomerId) {
    return NextResponse.json({
      ok: false,
      error: 'No Stripe customer yet. Start an upgrade first.',
    }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
    const session = await stripe.billingPortal.sessions.create({
      customer:   billing.stripeCustomerId,
      return_url: `${baseUrl}/admin/subscription`,
    });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (err) {
    captureException(err, { context: 'billing.portal', tags: { tenantId } });
    return NextResponse.json({ ok: false, error: 'Failed to open customer portal.' }, { status: 500 });
  }
}
