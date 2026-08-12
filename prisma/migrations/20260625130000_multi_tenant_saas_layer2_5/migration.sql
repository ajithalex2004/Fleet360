-- ============================================================
-- Multi-tenant SaaS Platform — Layer 2/3/4/5 schema additions
-- Fleet360 — 2026-06-25 (promoted to Prisma migration 2026-06-26)
--
-- Adds tables needed beyond Phase 0 (Layer 1):
--   Layer 2 — Tenant lifecycle
--     • tenant_invitations          signup / invite-user flow
--     • tenant_offboardings         cancellation / data-export trail
--   Layer 3 — Tenant-aware product
--     • tenant_feature_overrides    per-tenant feature-flag overrides
--                                     (TenantModule is the source of truth;
--                                      this table is for A/B-style rollouts
--                                      and time-bounded enable windows)
--   Layer 4 — Enterprise readiness
--     • audit_events                append-only actor/action/target trail
--     • sso_configs                 per-tenant SAML/OIDC IdP config
--     • scim_tokens                 per-tenant SCIM 2.0 bearer tokens
--     • ip_allowlists               per-tenant admin IP allowlists
--     • custom_role_permissions     per-tenant custom RBAC permissions
--   Layer 5 — SaaS operations
--     • subscriptions               tenant ↔ Stripe subscription
--     • usage_events                metering counter (api calls, gb, users)
--
-- Notes on the promotion from ops script to Prisma migration:
--   - Original ops script had `@@INDEX(...)` lines inside CREATE TABLE
--     statements; that is Prisma schema syntax, not SQL. Those are now
--     proper CREATE INDEX statements below.
--   - `tenant_id` columns are UUID here (matching the existing tenants.id
--     PK and the SaaS-side convention), but the dispatch-domain migration
--     20260625120000_add_tenant_id_to_dispatch_tables uses TEXT. The
--     schema.prisma declares them all as `String` (i.e. TEXT) for Prisma
--     portability; UUIDs are stored as text. The Go GORM models and the
--     Prisma client both treat them as opaque strings.
--   - All statements are idempotent (safe to run multiple times).
-- ============================================================


-- ── Layer 2: Tenant lifecycle ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_invitations (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email              TEXT NOT NULL,
    role_id            TEXT NOT NULL REFERENCES roles(id),
    token              TEXT NOT NULL UNIQUE,
    invited_by         TEXT REFERENCES "User"(id),
    expires_at         TIMESTAMPTZ NOT NULL,
    accepted_at        TIMESTAMPTZ,
    revoked_at         TIMESTAMPTZ,
    accepted_user_id   TEXT REFERENCES "User"(id),
    metadata           JSONB
);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant_id ON tenant_invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email     ON tenant_invitations(email);

CREATE TABLE IF NOT EXISTS tenant_offboardings (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW(),
    tenant_id            TEXT NOT NULL REFERENCES tenants(id),
    requested_by         TEXT REFERENCES "User"(id),
    reason               TEXT,
    status               TEXT NOT NULL DEFAULT 'PENDING',
    export_url           TEXT,
    export_expires_at    TIMESTAMPTZ,
    erasure_started_at   TIMESTAMPTZ,
    erasure_completed_at TIMESTAMPTZ,
    scheduled_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tenant_offboardings_tenant_id ON tenant_offboardings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_offboardings_status    ON tenant_offboardings(status);


-- ── Layer 3: Tenant-aware product ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_feature_overrides (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    feature_key   TEXT NOT NULL,
    is_enabled    BOOLEAN NOT NULL,
    enabled_from  TIMESTAMPTZ,
    enabled_until TIMESTAMPTZ,
    reason        TEXT,
    set_by        TEXT REFERENCES "User"(id),
    CONSTRAINT tenant_feature_overrides_tenant_key_unique UNIQUE (tenant_id, feature_key)
);
CREATE INDEX IF NOT EXISTS idx_tenant_feature_overrides_tenant_id ON tenant_feature_overrides(tenant_id);


-- ── Layer 4: Enterprise readiness ────────────────────────────────────────────

-- Append-only audit log. NO updates/deletes — every row is a fact.
-- Partition by month when row count crosses 100M (see LAYER_6_ROADMAP).
CREATE TABLE IF NOT EXISTS audit_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tenant_id        TEXT REFERENCES tenants(id),
    actor_user_id    TEXT REFERENCES "User"(id),
    actor_role       TEXT,
    actor_ip         INET,
    actor_user_agent TEXT,
    action           TEXT NOT NULL,
    target_type      TEXT,
    target_id        TEXT,
    outcome          TEXT NOT NULL,
    request_id       TEXT,
    metadata         JSONB,
    prev_hash        TEXT,
    row_hash         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_occurred ON audit_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor          ON audit_events(actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_action         ON audit_events(action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_target         ON audit_events(target_type, target_id);

-- Per-tenant SSO config. Only one active config per tenant per protocol.
CREATE TABLE IF NOT EXISTS sso_configs (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW(),
    tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    protocol                    TEXT NOT NULL,
    is_enabled                  BOOLEAN NOT NULL DEFAULT false,
    is_enforced                 BOOLEAN NOT NULL DEFAULT false,
    oidc_issuer                 TEXT,
    oidc_client_id              TEXT,
    oidc_client_secret_encrypted TEXT,
    oidc_scopes                 TEXT,
    saml_entity_id              TEXT,
    saml_sso_url                TEXT,
    saml_idp_metadata_xml       TEXT,
    saml_cert_encrypted         TEXT,
    default_role_id             TEXT REFERENCES roles(id),
    claim_mapping               JSONB,
    CONSTRAINT sso_configs_tenant_protocol_unique UNIQUE (tenant_id, protocol)
);

CREATE TABLE IF NOT EXISTS scim_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    label        TEXT,
    created_by   TEXT REFERENCES "User"(id),
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_scim_tokens_tenant_id ON scim_tokens(tenant_id);

CREATE TABLE IF NOT EXISTS ip_allowlists (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    cidr       TEXT NOT NULL,
    label      TEXT,
    is_active  BOOLEAN NOT NULL DEFAULT true,
    added_by   TEXT REFERENCES "User"(id)
);
CREATE INDEX IF NOT EXISTS idx_ip_allowlists_tenant_id ON ip_allowlists(tenant_id);

-- Custom role permissions — per-tenant role-permission grants beyond
-- the system roles (SUPER_ADMIN, ADMIN, MANAGER, DRIVER). System roles
-- live in the roles table with is_system=true; everything else is a
-- custom role.
CREATE TABLE IF NOT EXISTS custom_role_permissions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id        TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id  TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    CONSTRAINT custom_role_permissions_role_permission_unique UNIQUE (role_id, permission_id)
);


-- ── Layer 5: SaaS operations ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW(),
    tenant_id                   TEXT NOT NULL UNIQUE REFERENCES tenants(id),
    plan_code                   TEXT NOT NULL,
    plan_interval               TEXT NOT NULL DEFAULT 'MONTHLY',
    status                      TEXT NOT NULL DEFAULT 'ACTIVE',
    trial_ends_at               TIMESTAMPTZ,
    current_period_start        TIMESTAMPTZ,
    current_period_end          TIMESTAMPTZ,
    cancel_at_period_end        BOOLEAN NOT NULL DEFAULT false,
    canceled_at                 TIMESTAMPTZ,
    stripe_customer_id          TEXT UNIQUE,
    stripe_subscription_id      TEXT UNIQUE,
    stripe_price_id             TEXT,
    stripe_latest_invoice_id    TEXT,
    plan_snapshot               JSONB
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status             ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);

-- Metering events. Append-only. Aggregated into invoices by a
-- daily cron that sums per tenant_id per metric.
CREATE TABLE IF NOT EXISTS usage_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tenant_id        TEXT NOT NULL REFERENCES tenants(id),
    metric           TEXT NOT NULL,
    quantity         NUMERIC NOT NULL DEFAULT 1,
    user_id          TEXT REFERENCES "User"(id),
    metadata         JSONB,
    idempotency_key  TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_metric_occurred ON usage_events(tenant_id, metric, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_occurred              ON usage_events(occurred_at);


-- ── Helper: row-hash for audit_events ────────────────────────────────────────

-- pgcrypto provides digest(). Required for audit_event_hash below.
-- CREATE EXTENSION IF NOT EXISTS is a no-op when already installed.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION audit_event_hash(
    prev_hash TEXT,
    occurred_at TIMESTAMPTZ,
    tenant_id TEXT,
    actor_user_id TEXT,
    action TEXT,
    target_type TEXT,
    target_id TEXT,
    outcome TEXT,
    metadata JSONB
) RETURNS TEXT AS $$
    SELECT encode(
        digest(
            COALESCE(prev_hash, '') || '|' ||
            occurred_at::TEXT || '|' ||
            COALESCE(tenant_id::TEXT, '') || '|' ||
            COALESCE(actor_user_id::TEXT, '') || '|' ||
            action || '|' ||
            COALESCE(target_type, '') || '|' ||
            COALESCE(target_id, '') || '|' ||
            outcome || '|' ||
            COALESCE(metadata::TEXT, ''),
            'sha256'
        ),
        'hex'
    );
$$ LANGUAGE SQL IMMUTABLE;

-- Requires pgcrypto. If not enabled:
--   CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ── Helper: emit audit event (called from triggers OR application) ──────────

CREATE OR REPLACE FUNCTION emit_audit_event(
    p_tenant_id     TEXT,
    p_actor_user_id TEXT,
    p_actor_role    TEXT,
    p_actor_ip      INET,
    p_action        TEXT,
    p_target_type   TEXT,
    p_target_id     TEXT,
    p_outcome       TEXT,
    p_metadata      JSONB
) RETURNS UUID AS $$
DECLARE
    v_prev_hash TEXT;
    v_id        UUID;
    v_row_hash  TEXT;
BEGIN
    SELECT row_hash INTO v_prev_hash
    FROM audit_events
    WHERE tenant_id IS NOT DISTINCT FROM p_tenant_id
    ORDER BY occurred_at DESC
    LIMIT 1;

    v_id := gen_random_uuid();
    v_row_hash := audit_event_hash(
        v_prev_hash, NOW(), p_tenant_id, p_actor_user_id,
        p_action, p_target_type, p_target_id, p_outcome, p_metadata
    );

    INSERT INTO audit_events (
        id, occurred_at, tenant_id, actor_user_id, actor_role, actor_ip,
        action, target_type, target_id, outcome, metadata,
        prev_hash, row_hash
    ) VALUES (
        v_id, NOW(), p_tenant_id, p_actor_user_id, p_actor_role, p_actor_ip,
        p_action, p_target_type, p_target_id, p_outcome, p_metadata,
        v_prev_hash, v_row_hash
    );
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;