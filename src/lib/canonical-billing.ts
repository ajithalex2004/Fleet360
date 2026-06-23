import { prisma } from '@/lib/prisma';
import { ensureBillingColumns, type PlanCode } from '@/lib/billing';

export type BillingModel = 'PLAN' | 'MODULE_SUBSCRIPTION' | 'HYBRID';

export interface CanonicalBillingAccount {
  tenantId: string;
  tenantName: string;
  tenantCode: string | null;
  effectivePlan: PlanCode;
  billingModel: BillingModel;
  billingStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  billingEmail: string | null;
  currency: string;
  moduleMrr: number;
  moduleArr: number;
  activeModuleSubscriptions: number;
  moduleSubscriptions: Array<{
    id: string;
    moduleCode: string;
    planTier: string;
    billingCycle: string;
    status: string;
    basePrice: number;
    currency: string;
    nextBillingDate: string | null;
  }>;
  syncedAt: string;
}

let ensured = false;

export async function ensureCanonicalBillingTables() {
  if (ensured) return;
  await ensureBillingColumns();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant_billing_accounts (
      tenant_id                    TEXT PRIMARY KEY,
      billing_model                TEXT NOT NULL DEFAULT 'PLAN',
      effective_plan               TEXT NOT NULL DEFAULT 'TRIAL',
      billing_status               TEXT NOT NULL DEFAULT 'INACTIVE',
      currency                     TEXT NOT NULL DEFAULT 'AED',
      module_mrr                   NUMERIC(15,2) NOT NULL DEFAULT 0,
      module_arr                   NUMERIC(15,2) NOT NULL DEFAULT 0,
      active_module_subscriptions  INTEGER NOT NULL DEFAULT 0,
      source_json                  JSONB NOT NULL DEFAULT '{}',
      synced_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tenant_billing_accounts_model
    ON tenant_billing_accounts(billing_model, billing_status)
  `).catch(() => {});
  ensured = true;
}

async function ensureModuleSubscriptionTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant_module_subscriptions (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW(),
      tenant_id         TEXT NOT NULL,
      module_code       TEXT NOT NULL,
      plan_tier         TEXT DEFAULT 'STANDARD',
      billing_cycle     TEXT DEFAULT 'MONTHLY',
      base_price        NUMERIC(10,2) NOT NULL,
      currency          TEXT DEFAULT 'AED',
      max_vehicles      INTEGER DEFAULT 50,
      max_users         INTEGER DEFAULT 5,
      max_students      INTEGER DEFAULT 0,
      setup_fee         NUMERIC(10,2) DEFAULT 0,
      setup_fee_paid    BOOLEAN DEFAULT FALSE,
      status            TEXT DEFAULT 'ACTIVE',
      trial_end_date    DATE,
      start_date        DATE NOT NULL,
      next_billing_date DATE NOT NULL,
      last_billed_date  DATE,
      notes             TEXT,
      UNIQUE(tenant_id, module_code)
    )
  `).catch(() => {});
}

function asPlan(plan: unknown): PlanCode {
  const value = String(plan ?? 'TRIAL').toUpperCase();
  if (value === 'STANDARD' || value === 'PROFESSIONAL' || value === 'ENTERPRISE') return value;
  return 'TRIAL';
}

function dateText(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export async function syncCanonicalBillingAccount(tenantId: string): Promise<CanonicalBillingAccount | null> {
  await ensureCanonicalBillingTables();
  await ensureModuleSubscriptionTable();

  const tenants = await prisma.$queryRawUnsafe<Array<{
    id: string;
    name: string;
    code: string | null;
    plan: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    subscription_status: string | null;
    current_period_end: string | null;
    trial_ends_at: string | null;
    billing_email: string | null;
    contact_email: string | null;
  }>>(
    `SELECT id, name, code, plan, stripe_customer_id, stripe_subscription_id,
            subscription_status, current_period_end::text, trial_ends_at::text,
            billing_email, contact_email
       FROM tenants
      WHERE id = $1
      LIMIT 1`,
    tenantId,
  ).catch(() => []);
  const tenant = tenants[0];
  if (!tenant) return null;

  const subscriptions = await prisma.$queryRawUnsafe<Array<{
    id: string;
    module_code: string;
    plan_tier: string;
    billing_cycle: string;
    status: string;
    base_price: string | number;
    currency: string;
    next_billing_date: string | Date | null;
  }>>(
    `SELECT id::text, module_code, plan_tier, billing_cycle, status,
            base_price, currency, next_billing_date
       FROM tenant_module_subscriptions
      WHERE tenant_id = $1
      ORDER BY module_code`,
    tenantId,
  ).catch(() => []);

  const activeSubs = subscriptions.filter(s => s.status === 'ACTIVE' || s.status === 'TRIAL');
  const moduleMrr = activeSubs.reduce((sum, sub) => {
    const amount = Number(sub.base_price ?? 0);
    return sum + (sub.billing_cycle === 'ANNUAL' ? amount / 12 : amount);
  }, 0);
  const moduleArr = moduleMrr * 12;
  const hasStripe = !!tenant.stripe_subscription_id && !['canceled', 'unpaid', 'incomplete_expired'].includes(String(tenant.subscription_status ?? ''));
  const hasModules = activeSubs.length > 0;
  const billingModel: BillingModel = hasStripe && hasModules ? 'HYBRID' : hasModules ? 'MODULE_SUBSCRIPTION' : 'PLAN';
  const effectivePlan = asPlan(tenant.plan);
  const billingStatus = hasStripe
    ? String(tenant.subscription_status ?? 'active').toUpperCase()
    : hasModules
      ? 'ACTIVE'
      : effectivePlan === 'TRIAL'
        ? 'TRIAL'
        : 'ACTIVE';
  const currency = activeSubs[0]?.currency ?? 'AED';

  await prisma.$executeRawUnsafe(
    `INSERT INTO tenant_billing_accounts
       (tenant_id, billing_model, effective_plan, billing_status, currency,
        module_mrr, module_arr, active_module_subscriptions, source_json, synced_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW(),NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       billing_model = EXCLUDED.billing_model,
       effective_plan = EXCLUDED.effective_plan,
       billing_status = EXCLUDED.billing_status,
       currency = EXCLUDED.currency,
       module_mrr = EXCLUDED.module_mrr,
       module_arr = EXCLUDED.module_arr,
       active_module_subscriptions = EXCLUDED.active_module_subscriptions,
       source_json = EXCLUDED.source_json,
       synced_at = NOW(),
       updated_at = NOW()`,
    tenantId,
    billingModel,
    effectivePlan,
    billingStatus,
    currency,
    Math.round(moduleMrr * 100) / 100,
    Math.round(moduleArr * 100) / 100,
    activeSubs.length,
    JSON.stringify({
      tenantPlan: tenant.plan,
      stripeSubscriptionStatus: tenant.subscription_status,
      stripeSubscriptionId: tenant.stripe_subscription_id,
      activeModuleSubscriptionIds: activeSubs.map(s => s.id),
    }),
  );

  return {
    tenantId,
    tenantName: tenant.name,
    tenantCode: tenant.code,
    effectivePlan,
    billingModel,
    billingStatus,
    stripeCustomerId: tenant.stripe_customer_id,
    stripeSubscriptionId: tenant.stripe_subscription_id,
    subscriptionStatus: tenant.subscription_status,
    currentPeriodEnd: dateText(tenant.current_period_end),
    trialEndsAt: dateText(tenant.trial_ends_at),
    billingEmail: tenant.billing_email ?? tenant.contact_email,
    currency,
    moduleMrr: Math.round(moduleMrr * 100) / 100,
    moduleArr: Math.round(moduleArr * 100) / 100,
    activeModuleSubscriptions: activeSubs.length,
    moduleSubscriptions: subscriptions.map(s => ({
      id: s.id,
      moduleCode: s.module_code,
      planTier: s.plan_tier,
      billingCycle: s.billing_cycle,
      status: s.status,
      basePrice: Number(s.base_price ?? 0),
      currency: s.currency,
      nextBillingDate: dateText(s.next_billing_date),
    })),
    syncedAt: new Date().toISOString(),
  };
}

export async function getCanonicalBillingAccount(tenantId: string) {
  return syncCanonicalBillingAccount(tenantId);
}

export async function listCanonicalBillingAccounts(limit = 500) {
  await ensureCanonicalBillingTables();
  await ensureModuleSubscriptionTable();
  const tenants = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM tenants ORDER BY created_at DESC LIMIT $1`,
    limit,
  ).catch(() => []);
  const accounts = await Promise.all(tenants.map(t => syncCanonicalBillingAccount(t.id)));
  return accounts.filter((account): account is CanonicalBillingAccount => !!account);
}

