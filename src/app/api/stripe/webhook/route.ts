/**
 * POST /api/stripe/webhook — receives Stripe webhook events.
 *
 * Verifies the signature against STRIPE_WEBHOOK_SECRET and forwards events
 * to syncSubscriptionToTenant. Idempotent: each event re-derives the plan
 * + status from the live subscription, so duplicates are safe.
 *
 * Public route (no xl-session) — middleware exempts it.
 */

import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, syncSubscriptionToTenant } from '@/lib/billing';
import {
  emailPaymentFailed, emailTrialEnding, emailSubscriptionCanceled,
} from '@/lib/billing-emails';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';
// Disable Next's body parsing — we need the raw body for signature verification.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ ok: false, error: 'Webhook signature missing' }, { status: 400 });
  }

  let event: Stripe.Event;
  let rawBody: string;
  try {
    rawBody = await req.text();
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    captureException(err, { context: 'stripe.webhook.verify' });
    return NextResponse.json({ ok: false, error: 'Signature verification failed' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscriptionToTenant(sub);
        void logAudit({
          entityType: 'Subscription', entityId: sub.id,
          action: 'UPDATE',
          details: `Stripe ${event.type} → status=${sub.status}`,
        });
        if (event.type === 'customer.subscription.deleted' || sub.status === 'canceled') {
          void emailSubscriptionCanceled(sub).catch(() => {});
        }
        break;
      }
      case 'customer.subscription.trial_will_end': {
        // Stripe fires this 3 days before trial_end.
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscriptionToTenant(sub);
        void logAudit({
          entityType: 'Subscription', entityId: sub.id,
          action: 'UPDATE',
          details: `Stripe trial_will_end → trial_end=${sub.trial_end}`,
        });
        void emailTrialEnding(sub).catch(() => {});
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        void logAudit({
          entityType: 'Invoice', entityId: invoice.id ?? 'unknown',
          action: 'UPDATE',
          details: `Invoice paid: ${invoice.amount_paid} ${invoice.currency} (customer ${typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id})`,
        });
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        void logAudit({
          entityType: 'Invoice', entityId: invoice.id ?? 'unknown',
          action: 'UPDATE',
          details: `Invoice payment failed: ${invoice.amount_due} ${invoice.currency}`,
        });
        void emailPaymentFailed(invoice).catch(() => {});
        break;
      }

      case 'checkout.session.completed': {
        // Subscription should be created in the same transaction; the
        // subsequent customer.subscription.created event is the source of
        // truth so we don't sync here.
        break;
      }

      default:
        // Unhandled event type — ack with 200 so Stripe doesn't retry.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    captureException(err, { context: 'stripe.webhook.handle', tags: { eventType: event.type } });
    // 500 makes Stripe retry — only return for transient/unknown errors.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
