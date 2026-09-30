/**
 * Billing-event emails — payment failed, trial ending soon, subscription
 * canceled. Sent fire-and-forget from the Stripe webhook handler.
 *
 * Recipient is resolved via getTenantBilling(tenantId).billingEmail (which
 * falls back to tenants.contact_email). No-ops cleanly when no email is
 * available or no email transport is configured.
 *
 * Wording: the platform-only email templates (Admin > Email templates >
 * Platform billing, editable by platform administrators only), in the
 * tenant's language, carrying the platform's name.
 */

import type Stripe from 'stripe';
import { appUrl, sendTemplatedEmail } from '@/lib/email-templates';
import { getTenantBilling } from '@/lib/billing';
import { prisma } from '@/lib/prisma';

async function tenantInfo(stripeCustomerId: string | null): Promise<{
  tenantId: string; tenantName: string; billingEmail: string | null;
} | null> {
  if (!stripeCustomerId) return null;
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM tenants WHERE stripe_customer_id = $1 LIMIT 1`,
    stripeCustomerId,
  ).catch(() => []);
  if (rows.length === 0) return null;
  const billing = await getTenantBilling(rows[0].id);
  if (!billing) return null;
  return {
    tenantId: billing.tenantId,
    tenantName: billing.tenantName,
    billingEmail: billing.billingEmail,
  };
}

// ── Senders ─────────────────────────────────────────────────────────────────

export async function emailPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
  const info = await tenantInfo(customerId);
  if (!info?.billingEmail) return;

  const updateUrl = appUrl('/admin/subscription/upgrade');
  await sendTemplatedEmail({
    tenantId: info.tenantId, key: 'platform.billing_payment_failed', to: info.billingEmail,
    values: {
      tenantName: info.tenantName,
      amount: `${(invoice.amount_due / 100).toFixed(2)} ${invoice.currency.toUpperCase()}`,
      updateUrl,
      invoiceUrl: invoice.hosted_invoice_url ?? appUrl('/admin/billing'),
    },
  });
}

export async function emailTrialEnding(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const info = await tenantInfo(customerId);
  if (!info?.billingEmail) return;

  const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
  await sendTemplatedEmail({
    tenantId: info.tenantId, key: 'platform.billing_trial_ending', to: info.billingEmail,
    values: (locale) => ({
      tenantName: info.tenantName,
      trialEndDate: trialEnd
        ? trialEnd.toLocaleDateString(locale === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : (locale === 'ar' ? 'قريباً' : 'soon'),
      upgradeUrl: appUrl('/admin/subscription/upgrade'),
    }),
  });
}

export async function emailSubscriptionCanceled(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const info = await tenantInfo(customerId);
  if (!info?.billingEmail) return;

  await sendTemplatedEmail({
    tenantId: info.tenantId, key: 'platform.billing_subscription_canceled', to: info.billingEmail,
    values: { tenantName: info.tenantName, reactivateUrl: appUrl('/admin/subscription/upgrade') },
  });
}
