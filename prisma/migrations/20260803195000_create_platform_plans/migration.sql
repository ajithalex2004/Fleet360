-- =====================================================================
-- platform_plans — single source of truth for plan tiers
-- =====================================================================
--
-- Replaces the four hardcoded PLANS arrays scattered across
--   src/lib/plan-limits.ts
--   src/lib/billing.ts
--   src/app/onboarding/page.tsx
--   src/app/(app)/admin/subscription/upgrade/page.tsx
--   src/app/(app)/admin/tenants/page.tsx
--   src/app/(app)/admin/billing/page.tsx
--
-- Read path: src/lib/plans.ts → cached Map<code, PlanLimits>
-- Write path: /api/admin/platform/plans (SUPER_ADMIN only)
--
-- Platform-level table — NO tenant_id, NO RLS. Only SUPER_ADMIN should
-- be able to write. Reads happen inside any tenant context safely
-- because there's no policy to filter on.
--
-- Seed: the four plans that exist today, with their current limits and
-- the marketing copy currently shown on the onboarding page. After
-- deploy, the admin can edit/add/remove plans via /admin/platform-plans.
--
-- =====================================================================

CREATE TABLE platform_plans (
  code                    TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  price_label             TEXT NOT NULL,
  description             TEXT NOT NULL,
  highlight               BOOLEAN NOT NULL DEFAULT false,
  sort_order              INTEGER NOT NULL DEFAULT 0,

  -- Quotas. 999_999 is the convention for "effectively unlimited" at
  -- this stage of the product; ENTERPRISE uses it today. We don't use
  -- NULL to keep the column NOT NULL and the types simple.
  max_users               INTEGER NOT NULL CHECK (max_users > 0),
  max_vehicles            INTEGER NOT NULL CHECK (max_vehicles > 0),
  max_bookings_per_month  INTEGER NOT NULL CHECK (max_bookings_per_month > 0),

  -- Feature gates (the rest of the module list comes from the modules
  -- registry; this is just what's *locked* behind this tier)
  premium_modules         TEXT[] NOT NULL DEFAULT '{}',
  sso_enabled             BOOLEAN NOT NULL DEFAULT false,
  api_keys_enabled        BOOLEAN NOT NULL DEFAULT false,
  branding_enabled        BOOLEAN NOT NULL DEFAULT false,

  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The trigger that auto-bumps updated_at on row UPDATE.
CREATE OR REPLACE FUNCTION platform_plans_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER platform_plans_updated_at
  BEFORE UPDATE ON platform_plans
  FOR EACH ROW EXECUTE FUNCTION platform_plans_set_updated_at();

-- ── Seed: current four plans ────────────────────────────────────────────
-- Marketing copy matches what /onboarding/page.tsx renders today.
-- Quotas match src/lib/plan-limits.ts. ENTERPRISE uses 999_999 as the
-- "effectively unlimited" sentinel (replaces Number.POSITIVE_INFINITY).

INSERT INTO platform_plans
  (code, name, price_label, description, highlight, sort_order,
   max_users, max_vehicles, max_bookings_per_month,
   sso_enabled, api_keys_enabled, branding_enabled)
VALUES
  ('TRIAL',
   'Trial', 'Free',
   '60 req/min · 1 tenant',
   false, 0,
   5, 10, 200,
   false, false, false),

  ('STANDARD',
   'Standard', 'AED 299/mo',
   '200 req/min · Up to 5 branches',
   false, 1,
   25, 100, 5000,
   false, true, false),

  ('PROFESSIONAL',
   'Professional', 'AED 799/mo',
   '500 req/min · Unlimited branches',
   true, 2,
   200, 1000, 50000,
   true, true, true),

  ('ENTERPRISE',
   'Enterprise', 'AED 1,999/mo',
   '1000 req/min · SLA + support',
   false, 3,
   999999, 999999, 999999,
   true, true, true)
ON CONFLICT (code) DO NOTHING;
