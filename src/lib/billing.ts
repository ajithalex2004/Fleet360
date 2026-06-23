/**
 * Billing helpers — Stripe customer/subscription sync, plan resolution,
 * lazy-added columns on the tenants table.
 *
 * Architecture:
 *  - Each tenant maps to one Stripe Customer.
 *  - Each tenant has at most one active Subscription. The plan code on
 *    the tenants table is the source of truth for plan-gating; the
 *    webhook keeps it in sync with Stripe.
 *  - Price IDs come from env (STRIPE_PRICE_STANDARD_USD etc) — created
 *    by scripts/stripe-bootstrap.ts.
 */

import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';

let _stripe: Stripe | null = null;

/** Lazily-initialised Stripe client. Throws if STRIPE_SECRET_KEY isn't set. */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  _stripe = new Stripe(key, { typescript: true });
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

// ── Plan codes ───────────────────────────────────────────────────────────────

export const PLAN_CODES = ['TRIAL', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE'] as const;
export type PlanCode = typeof PLAN_CODES[number];

/** Returns the env-configured Stripe price ID for a plan + currency. */
export function getPriceId(plan: PlanCode, currency: 'usd' | 'aed' = 'usd'): string | null {
  if (plan === 'TRIAL') return null;
  const key = `STRIPE_PRICE_${plan}_${currency.toUpperCase()}`;
  return process.env[key] ?? null;
}

/** Reverse lookup: given a Stripe price ID, what plan does it represent? */
export function priceIdToPlan(priceId: string): PlanCode | null {
  for (const plan of PLAN_CODES) {
    if (plan === 'TRIAL') continue;
    for (const currency of ['USD', 'AED']) {
      if (process.env[`STRIPE_PRICE_${plan}_${currency}`] === priceId) return plan;
    }
  }
  return null;
}

// ── Tenant billing columns (lazy ALTER) ─────────────────────────────────────

let _ensured = false;

export async function ensureBillingColumns(): Promise<void> {
  if (_ensured) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id      TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id  TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status     TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS current_period_end      TIMESTAMPTZ`);
  await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at           TIMESTAMPTZ`);
  await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_email           TEXT`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer ON tenants (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_tenants_stripe_sub      ON tenants (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL`);
  _ensured = true;
}

export interface TenantBilling {
  tenantId: string;
  tenantName: string;
  plan: PlanCode;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  billingEmail: string | null;
}

interface BillingRow {
  id: string; name: string; plan: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  billing_email: string | null;
  contact_email: string | null;
}

export async function getTenantBilling(tenantId: string): Promise<TenantBilling | null> {
  await ensureBillingColumns();
  const rows = await prisma.$queryRawUnsafe<BillingRow[]>(
    `SELECT id, name, plan, stripe_customer_id, stripe_subscription_id,
            subscription_status, current_period_end::text, trial_ends_at::text,
            billing_email, contact_email
     FROM tenants WHERE id = $1 LIMIT 1`,
    tenantId,
  ).catch(() => []);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    tenantId: r.id,
    tenantName: r.name,
    plan: (r.plan as PlanCode) ?? 'TRIAL',
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    subscriptionStatus: r.subscription_status,
    currentPeriodEnd: r.current_period_end,
    trialEndsAt: r.trial_ends_at,
    billingEmail: r.billing_email ?? r.contact_email,
  };
}

// ── Customer + subscription sync ────────────────────────────────────────────

/**
 * Get-or-create the Stripe Customer for a tenant. Idempotent: stores the
 * customer ID on the tenants row so subsequent calls hit Stripe only when
 * the row is missing the ID.
 */
export async function getOrCreateCustomer(tenantId: string): Promise<string> {
  const billing = await getTenantBilling(tenantId);
  if (!billing) throw new Error(`Tenant ${tenantId} not found`);
  if (billing.stripeCustomerId) return billing.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name:  billing.tenantName,
    email: billing.billingEmail ?? undefined,
    metadata: { tenant_id: tenantId },
  });

  await prisma.$executeRawUnsafe(
    `UPDATE tenants SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2`,
    customer.id, tenantId,
  );
  return customer.id;
}

/**
 * Apply a Stripe subscription to the tenant — derives plan from the
 * subscription's first item's price ID, persists status + period end.
 * Called from the webhook handler.
 */
export async function syncSubscriptionToTenant(sub: Stripe.Subscription): Promise<void> {
  const tenantId = (typeof sub.customer === 'string'
    ? await tenantIdForCustomer(sub.customer)
    : await tenantIdForCustomer(sub.customer.id));
  if (!tenantId) return;

  const item     = sub.items.data[0];
  const priceId  = typeof item?.price === 'string' ? item.price : item?.price?.id;
  const plan     = priceId ? (priceIdToPlan(priceId) ?? 'TRIAL') : 'TRIAL';
  const status   = sub.status; // active | trialing | past_due | canceled | unpaid | incomplete
  const periodEnd = (item?.current_period_end ?? null);
  const trialEnd  = sub.trial_end ?? null;

  // If subscription is canceled / unpaid, downgrade plan to TRIAL.
  const effectivePlan: PlanCode =
    status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired'
      ? 'TRIAL'
      : plan;

  await ensureBillingColumns();
  await prisma.$executeRawUnsafe(
    `UPDATE tenants
        SET plan                   = $1,
            stripe_subscription_id = $2,
            subscription_status    = $3,
            current_period_end     = to_timestamp($4),
            trial_ends_at          = CASE WHEN $5::bigint IS NULL THEN NULL ELSE to_timestamp($5) END,
            updated_at             = NOW()
      WHERE id = $6`,
    effectivePlan,
    sub.id,
    status,
    periodEnd,
    trialEnd,
    tenantId,
  );
  const { syncCanonicalBillingAccount } = await import('@/lib/canonical-billing');
  await syncCanonicalBillingAccount(tenantId).catch(() => null);
}

async function tenantIdForCustomer(customerId: string): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM tenants WHERE stripe_customer_id = $1 LIMIT 1`,
    customerId,
  ).catch(() => []);
  return rows[0]?.id ?? null;
}

// ── Trial bootstrap ─────────────────────────────────────────────────────────

/**
 * Start a 14-day trial for a freshly-provisioned tenant. Best-effort:
 *
 *  - If Stripe is configured, creates a Customer + a trialing Subscription
 *    on Standard plan. Webhook will sync plan/status as Stripe fires events.
 *  - If Stripe is NOT configured (dev env), just records trial_ends_at
 *    locally so the rest of the app can gate on it.
 *
 * Idempotent: a tenant that already has a stripe_customer_id is skipped.
 */
export async function startTrialForTenant(tenantId: string, currency: 'usd' | 'aed' = 'usd'): Promise<void> {
  await ensureBillingColumns();
  const billing = await getTenantBilling(tenantId);
  if (!billing) return;
  if (billing.stripeCustomerId || billing.subscriptionStatus === 'trialing') return;

  const trialEnd = new Date(Date.now() + 14 * 86_400_000);

  if (!isStripeConfigured()) {
    await prisma.$executeRawUnsafe(
      `UPDATE tenants SET trial_ends_at = $1, subscription_status = 'trialing', updated_at = NOW() WHERE id = $2`,
      trialEnd, tenantId,
    );
    return;
  }

  const priceId = getPriceId('STANDARD', currency);
  if (!priceId) {
    // Stripe configured but no price — just mark trial locally.
    await prisma.$executeRawUnsafe(
      `UPDATE tenants SET trial_ends_at = $1, subscription_status = 'trialing', updated_at = NOW() WHERE id = $2`,
      trialEnd, tenantId,
    );
    return;
  }

  try {
    const customerId = await getOrCreateCustomer(tenantId);
    const stripe = getStripe();
    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: 14,
      // Don't auto-charge if the trial expires without payment method —
      // we'll downgrade to TRIAL plan via webhook and let them upgrade.
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      payment_settings: { save_default_payment_method: 'on_subscription' },
      metadata: { tenant_id: tenantId, plan: 'STANDARD', source: 'auto-trial' },
    });
    // syncSubscriptionToTenant runs on the corresponding webhook, but also
    // sync now so the row reflects status before webhooks land.
    await syncSubscriptionToTenant(sub);
  } catch {
    // Best-effort — fall back to local trial flag so signup never blocks.
    await prisma.$executeRawUnsafe(
      `UPDATE tenants SET trial_ends_at = $1, subscription_status = 'trialing', updated_at = NOW() WHERE id = $2`,
      trialEnd, tenantId,
    );
  }
}
