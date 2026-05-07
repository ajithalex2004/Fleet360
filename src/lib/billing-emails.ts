/**
 * Billing-event emails — payment failed, trial ending soon, subscription
 * canceled. Sent fire-and-forget from the Stripe webhook handler.
 *
 * Recipient is resolved via getTenantBilling(tenantId).billingEmail (which
 * falls back to tenants.contact_email). No-ops cleanly when no email is
 * available or SendGrid isn't configured.
 */

import type Stripe from 'stripe';
import { sendEmail } from '@/lib/email';
import { getTenantBilling } from '@/lib/billing';
import { prisma } from '@/lib/prisma';

const APP = 'XL AI Smart Mobility';

function appUrl(path = ''): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return base.replace(/\/$/, '') + path;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

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

  const amount = (invoice.amount_due / 100).toFixed(2);
  const currency = invoice.currency.toUpperCase();
  const updateUrl = appUrl('/admin/subscription/upgrade');
  const hosted = invoice.hosted_invoice_url ?? null;

  await sendEmail({
    to: info.billingEmail,
    subject: `${APP} — Payment failed for ${info.tenantName}`,
    text: [
      `Hi,`,
      ``,
      `We weren't able to process your most recent ${APP} subscription payment` +
      ` (${amount} ${currency}) for ${info.tenantName}.`,
      ``,
      `Please update your payment method here:`,
      updateUrl,
      hosted ? `\nView the invoice: ${hosted}` : '',
      ``,
      `Stripe will retry the charge automatically over the next few days.` +
      ` Until it succeeds, your subscription remains active but at risk of cancellation.`,
      ``,
      `— ${APP}`,
    ].filter(Boolean).join('\n'),
    html:
      `<p>Hi,</p>` +
      `<p>We couldn't process your most recent ${escape(APP)} subscription payment ` +
      `(<strong>${escape(amount)} ${escape(currency)}</strong>) for <strong>${escape(info.tenantName)}</strong>.</p>` +
      `<p><a href="${updateUrl}" style="display:inline-block;padding:10px 18px;background:#dc2626;color:#fff;border-radius:8px;text-decoration:none">Update payment method</a></p>` +
      (hosted ? `<p style="color:#666;font-size:12px">Or view the invoice: <a href="${hosted}">${escape(hosted)}</a></p>` : '') +
      `<p style="color:#666;font-size:12px">Stripe will retry the charge automatically over the next few days. Until it succeeds, your subscription stays active but at risk of cancellation.</p>`,
  });
}

export async function emailTrialEnding(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const info = await tenantInfo(customerId);
  if (!info?.billingEmail) return;

  const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
  const upgradeUrl = appUrl('/admin/subscription/upgrade');

  await sendEmail({
    to: info.billingEmail,
    subject: `${APP} — Your trial for ${info.tenantName} ends soon`,
    text: [
      `Hi,`,
      ``,
      `Your ${APP} trial for ${info.tenantName} ends ${trialEnd ? `on ${trialEnd.toDateString()}` : 'soon'}.`,
      ``,
      `Pick a plan to keep your team running without interruption:`,
      upgradeUrl,
      ``,
      `If you do nothing, the trial will expire and your subscription will be canceled.`,
      ``,
      `— ${APP}`,
    ].join('\n'),
    html:
      `<p>Hi,</p>` +
      `<p>Your ${escape(APP)} trial for <strong>${escape(info.tenantName)}</strong> ends ` +
      `${trialEnd ? `on <strong>${escape(trialEnd.toDateString())}</strong>` : 'soon'}.</p>` +
      `<p><a href="${upgradeUrl}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none">Pick a plan</a></p>` +
      `<p style="color:#666;font-size:12px">If you do nothing, the trial will expire and your subscription will be canceled.</p>`,
  });
}

export async function emailSubscriptionCanceled(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const info = await tenantInfo(customerId);
  if (!info?.billingEmail) return;

  const upgradeUrl = appUrl('/admin/subscription/upgrade');

  await sendEmail({
    to: info.billingEmail,
    subject: `${APP} — Subscription canceled for ${info.tenantName}`,
    text: [
      `Hi,`,
      ``,
      `Your ${APP} subscription for ${info.tenantName} has been canceled.` +
      ` You've been moved to the read-only TRIAL plan.`,
      ``,
      `Want to come back? Reactivate any time:`,
      upgradeUrl,
      ``,
      `Your data stays put for 30 days while you decide.`,
      ``,
      `— ${APP}`,
    ].join('\n'),
    html:
      `<p>Hi,</p>` +
      `<p>Your ${escape(APP)} subscription for <strong>${escape(info.tenantName)}</strong> has been canceled.` +
      ` You've been moved to the read-only TRIAL plan.</p>` +
      `<p><a href="${upgradeUrl}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none">Reactivate</a></p>` +
      `<p style="color:#666;font-size:12px">Your data stays put for 30 days while you decide.</p>`,
  });
}
