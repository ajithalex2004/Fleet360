/**
 * POST /api/admin/billing/checkout
 *
 * Body: { plan: 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE', currency?: 'usd' | 'aed' }
 *
 * Creates a Stripe Checkout Session for the requested plan and returns
 * the hosted URL. Stripe Tax is enabled so UAE VAT (5%) is handled
 * automatically. Stripe creates the Subscription on success; the
 * subsequent webhook syncs the plan to the tenant.
 *
 * Authorization: TENANT_ADMIN of this tenant or SUPER_ADMIN.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStripe, getOrCreateCustomer, getPriceId, isStripeConfigured } from '@/lib/billing';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ ok: false, error: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' }, { status: 503 });
  }

  const tenantId = req.headers.get('x-tenant-id');
  const userId   = req.headers.get('x-user-id');
  const role     = req.headers.get('x-user-role') ?? '';
  if (!tenantId || !userId) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  if (role !== 'TENANT_ADMIN' && role !== 'SUPER_ADMIN') {
    return NextResponse.json({ ok: false, error: 'Only tenant admins can manage billing.' }, { status: 403 });
  }

  let body: { plan?: string; currency?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const plan     = String(body.plan ?? '').toUpperCase();
  const currency = (String(body.currency ?? 'usd').toLowerCase() === 'aed' ? 'aed' : 'usd') as 'usd' | 'aed';
  if (plan !== 'STANDARD' && plan !== 'PROFESSIONAL' && plan !== 'ENTERPRISE') {
    return NextResponse.json({ ok: false, error: 'Invalid plan.' }, { status: 400 });
  }

  const priceId = getPriceId(plan as 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE', currency);
  if (!priceId) {
    return NextResponse.json({
      ok: false,
      error: `No Stripe price configured for ${plan}/${currency.toUpperCase()}. Run scripts/stripe-bootstrap.ts and set the STRIPE_PRICE_${plan}_${currency.toUpperCase()} env var.`,
    }, { status: 503 });
  }

  try {
    const customerId = await getOrCreateCustomer(tenantId);
    const stripe = getStripe();

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/admin/subscription?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/admin/subscription/upgrade?canceled=1`,
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      customer_update: { name: 'auto', address: 'auto' },
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { tenant_id: tenantId, plan },
      },
      metadata: { tenant_id: tenantId, plan, requested_by: userId },
    });

    void logAudit({
      tenantId,
      userId, userRole: role,
      entityType: 'Subscription',
      action: 'CREATE',
      details: `Checkout session created for ${plan}/${currency.toUpperCase()} → ${session.id}`,
    });

    return NextResponse.json({ ok: true, url: session.url, sessionId: session.id });
  } catch (err) {
    captureException(err, { context: 'billing.checkout', tags: { tenantId } });
    return NextResponse.json({ ok: false, error: 'Failed to create checkout session.' }, { status: 500 });
  }
}
