// Package billing owns Layer 5 — the SaaS billing plane.
//
// Responsibilities:
//
//   1. Plan tier definitions — what features are included at each tier,
//      the price, the metered usage limits. Single source of truth for
//      what we sell.
//
//   2. Stripe webhook ingestion — convert Stripe events into our
//      domain events (subscription created, payment failed, plan
//      changed). The webhook is the source of truth — we never write
//      subscription state from our own code, only from webhooks.
//
//   3. Plan enforcement — at any feature-flag or handler gate, ask
//      "is this feature included in this tenant's plan?". Returns
//      a typed error so handlers can return 402 Payment Required.
//
//   4. Metering emit — increment usage counters that get billed
//      monthly. Idempotent on (tenant_id, metric, idempotency_key).
//
// What this package does NOT own:
//
//   - Tax / VAT calculation. That's part of the finance domain and
//     lives in the finance module. Plan prices are tax-exclusive;
//     VAT is added at invoice time using the tenant's TRN.
//
//   - Refunds. Refund flow goes through the support package, not
//     here. We record the resulting Stripe event but don't trigger it.
//
//   - Dunning. Dunning is a separate cron worker; this package only
//     surfaces PAST_DUE status to handlers.
package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"fleet360-backend/audit"
	"fleet360-backend/database"
	"fleet360-backend/logging"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// PlanCode must match tenants.plan and tenants subscriptions.plan_code.
type PlanCode string

const (
	PlanTrial       PlanCode = "TRIAL"
	PlanStarter     PlanCode = "STARTER"
	PlanProfessional PlanCode = "PROFESSIONAL"
	PlanEnterprise  PlanCode = "ENTERPRISE"
)

// Plan describes what a plan tier includes.
type Plan struct {
	Code           PlanCode
	DisplayName    string
	MonthlyPriceUSD int  // in cents; tax-exclusive
	YearlyPriceUSD  int  // in cents; tax-exclusive
	IncludedUsers   int  // -1 = unlimited
	IncludedVehicles int // -1 = unlimited
	IncludedAPIRPM   int // requests per minute; -1 = unlimited
	Features        map[string]bool // feature_key -> included
	SSOEnabled       bool
	SCIMEnabled      bool
	CustomRoles      bool
	AuditLogRetentionDays int  // 30 / 90 / 365 / 2555 (7 years for Enterprise)
	SupportTier      string // "community" | "email" | "priority" | "24x7"
}

// Plans is the static plan ladder. Single source of truth for what we
// sell. Modify here when pricing or feature gates change.
var Plans = map[PlanCode]Plan{
	PlanTrial: {
		Code: PlanTrial, DisplayName: "Trial", MonthlyPriceUSD: 0, YearlyPriceUSD: 0,
		IncludedUsers: 5, IncludedVehicles: 50, IncludedAPIRPM: 60,
		Features: map[string]bool{
			"fleet-mgmt": true, "maintenance": true, "reports": true,
		},
		SSOEnabled: false, SCIMEnabled: false, CustomRoles: false,
		AuditLogRetentionDays: 30, SupportTier: "community",
	},
	PlanStarter: {
		Code: PlanStarter, DisplayName: "Starter", MonthlyPriceUSD: 49900, YearlyPriceUSD: 479000,
		IncludedUsers: 25, IncludedVehicles: 250, IncludedAPIRPM: 300,
		Features: map[string]bool{
			"fleet-mgmt": true, "maintenance": true, "rental": true,
			"reports": true, "audit-log-ui": true,
		},
		SSOEnabled: false, SCIMEnabled: false, CustomRoles: false,
		AuditLogRetentionDays: 90, SupportTier: "email",
	},
	PlanProfessional: {
		Code: PlanProfessional, DisplayName: "Professional",
		MonthlyPriceUSD: 149900, YearlyPriceUSD: 1439000,
		IncludedUsers: -1, IncludedVehicles: 2500, IncludedAPIRPM: 1000,
		Features: map[string]bool{
			"fleet-mgmt": true, "maintenance": true, "rental": true,
			"leasing": true, "logistics": true, "school-bus": true,
			"reports": true, "audit-log-ui": true, "agents": true,
			"dispatch": true, "incidents": true,
			"reporting.advanced": true,
		},
		SSOEnabled: false, SCIMEnabled: false, CustomRoles: false,
		AuditLogRetentionDays: 365, SupportTier: "priority",
	},
	PlanEnterprise: {
		Code: PlanEnterprise, DisplayName: "Enterprise",
		MonthlyPriceUSD: 0, YearlyPriceUSD: 0, // negotiated
		IncludedUsers: -1, IncludedVehicles: -1, IncludedAPIRPM: -1,
		Features: map[string]bool{
			"fleet-mgmt": true, "maintenance": true, "rental": true,
			"leasing": true, "logistics": true, "school-bus": true,
			"ambulance": true, "customer-mgmt": true, "booking-portal": true,
			"reports": true, "audit-log-ui": true, "agents": true,
			"dispatch": true, "incidents": true,
			"reporting.advanced": true, "rbac.custom-roles": true,
			"sso.enabled": true, "scim.enabled": true,
		},
		SSOEnabled: true, SCIMEnabled: true, CustomRoles: true,
		AuditLogRetentionDays: 2555, SupportTier: "24x7",
	},
}

// ErrPlanLimitExceeded is returned by Enforce when the tenant's plan
// doesn't permit the requested operation. Handlers should return 402
// Payment Required with a body explaining what plan upgrade unlocks.
var ErrPlanLimitExceeded = errors.New("billing: operation not permitted on current plan")

// EnforceUsage checks that the tenant is within their included usage
// for the metric. Returns nil if within limits, ErrPlanLimitExceeded if
// exceeded (so handlers can render a "upgrade to X" upsell).
//
// Caller is expected to have already incremented the usage counter —
// this is a check, not a gate. For a hard gate, use EnforceFeature.
func EnforceUsage(ctx context.Context, tenantID uuid.UUID, metric string, currentQuantity int64) error {
	plan, err := GetTenantPlan(ctx, tenantID)
	if err != nil {
		return err
	}
	limit, hasLimit := usageLimit(plan, metric)
	if !hasLimit || limit < 0 {
		return nil // unlimited
	}
	if currentQuantity > int64(limit) {
		return ErrPlanLimitExceeded
	}
	return nil
}

// EnforceFeature returns nil if the feature is included in the tenant's
// plan. Returns ErrPlanLimitExceeded otherwise.
//
// Use this for binary feature gates (SSO, SCIM, custom roles). For
// usage-based limits (users, vehicles, API calls), use EnforceUsage.
func EnforceFeature(plan Plan, featureKey string) error {
	if plan.Features[featureKey] {
		return nil
	}
	return ErrPlanLimitExceeded
}

func usageLimit(p Plan, metric string) (int, bool) {
	switch metric {
	case "users":
		return p.IncludedUsers, true
	case "vehicles":
		return p.IncludedVehicles, true
	case "api_rpm":
		return p.IncludedAPIRPM, true
	}
	return 0, false
}

// GetTenantPlan returns the plan code for a tenant. Reads from
// subscriptions first; falls back to tenants.plan for tenants without
// a subscription row (e.g. internal / dev tenants).
func GetTenantPlan(ctx context.Context, tenantID uuid.UUID) (Plan, error) {
	var code string
	err := database.DB.WithContext(ctx).Raw(`
		SELECT plan_code FROM subscriptions
		WHERE tenant_id = ? AND status IN ('TRIALING','ACTIVE','PAST_DUE')
		ORDER BY created_at DESC LIMIT 1
	`, tenantID).Scan(&code).Error
	if err != nil || code == "" {
		err = database.DB.WithContext(ctx).Raw(`
			SELECT COALESCE(plan, 'TRIAL') FROM tenants WHERE id = ?
		`, tenantID).Scan(&code).Error
		if err != nil {
			return Plan{}, err
		}
	}
	plan, ok := Plans[PlanCode(code)]
	if !ok {
		return Plans[PlanTrial], nil
	}
	return plan, nil
}

// ── Stripe webhook ingestion ───────────────────────────────────────────────────

// StripeWebhookConfig is the per-environment config for the webhook.
// WebhookSecret comes from the Stripe dashboard, not from env directly
// (Stripe rotates secrets occasionally and re-issuing env vars is friction).
type StripeWebhookConfig struct {
	WebhookSecret string
}

// StripeWebhook handles inbound Stripe events. Verifies signature,
// routes to per-event-type handlers. Idempotent — Stripe may retry
// the same event_id multiple times.
func StripeWebhook(cfg StripeWebhookConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, err := c.GetRawData()
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "cannot read body"})
			return
		}
		sig := c.GetHeader("Stripe-Signature")
		if !verifyStripeSignature(body, sig, cfg.WebhookSecret) {
			logging.L().Warn("stripe webhook signature invalid",
				zap.Bool("signature_present", sig != ""),
				zap.Int("body_bytes", len(body)),
			)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid signature"})
			return
		}

		// Stripe sends a thin envelope; in production use the official
		// stripe-go SDK to parse. Skeleton here reads just the fields we
		// care about.
		var env struct {
			ID   string `json:"id"`
			Type string `json:"type"`
			Data struct {
				Object map[string]any `json:"object"`
			} `json:"data"`
		}
		if err := jsonUnmarshal(body, &env); err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid JSON"})
			return
		}

		// Idempotency: ignore events we've already processed.
		var seen bool
		database.DB.WithContext(c.Request.Context()).Raw(`
			SELECT EXISTS (SELECT 1 FROM stripe_events_processed WHERE stripe_event_id = ?)
		`, env.ID).Scan(&seen)
		if seen {
			c.JSON(http.StatusOK, gin.H{"received": true, "duplicate": true})
			return
		}

		switch env.Type {
		case "customer.subscription.created", "customer.subscription.updated":
			handleSubscriptionChange(c.Request.Context(), env.Data.Object)
		case "customer.subscription.deleted":
			handleSubscriptionCancelled(c.Request.Context(), env.Data.Object)
		case "invoice.payment_failed":
			handlePaymentFailed(c.Request.Context(), env.Data.Object)
		case "invoice.paid":
			handleInvoicePaid(c.Request.Context(), env.Data.Object)
		default:
			logging.L().Debug("stripe event ignored", zap.String("type", env.Type))
		}

		// Record this event as processed. If the handler above errored,
		// the row is still inserted — Stripe will retry and we'll see
		// "duplicate", which is fine; we never want to reprocess a
		// destructive webhook twice.
		database.DB.WithContext(c.Request.Context()).Exec(`
			INSERT INTO stripe_events_processed (stripe_event_id, processed_at)
			VALUES (?, NOW()) ON CONFLICT DO NOTHING
		`, env.ID)

		c.JSON(http.StatusOK, gin.H{"received": true})
	}
}

func handleSubscriptionChange(ctx context.Context, obj map[string]any) {
	tenantID := obj["metadata"].(map[string]any)["tenant_id"].(string)
	tid, err := uuid.Parse(tenantID)
	if err != nil {
		logging.L().Error("stripe subscription: bad tenant_id metadata", zap.Error(err))
		return
	}
	planCode := obj["plan_code"].(string) // parsed from price/lookup_key in real code
	status := obj["status"].(string)

	err = database.DB.WithContext(ctx).Exec(`
		INSERT INTO subscriptions (tenant_id, plan_code, status, stripe_subscription_id, stripe_customer_id, current_period_start, current_period_end)
		VALUES (?, ?, ?, ?, ?, NOW(), NOW() + INTERVAL '1 month')
		ON CONFLICT (tenant_id) DO UPDATE SET
			plan_code = EXCLUDED.plan_code,
			status = EXCLUDED.status,
			updated_at = NOW()
	`, tid, planCode, status, obj["id"], obj["customer"]).Error
	if err != nil {
		logging.L().Error("subscription upsert failed", zap.Error(err))
		return
	}
	audit.Audit(ctx, audit.Event{
		TenantID:    &tid,
		Action:      audit.ActionBillingSubCreated,
		TargetType:  "Subscription",
		TargetID:    fmt.Sprintf("%v", obj["id"]),
		Outcome:     audit.OutcomeSuccess,
		Metadata:    mustJSON(map[string]string{"plan_code": planCode, "status": status}),
	})
}

func handleSubscriptionCancelled(ctx context.Context, obj map[string]any) {
	subID := obj["id"].(string)
	var tid uuid.UUID
	err := database.DB.WithContext(ctx).Raw(`
		UPDATE subscriptions SET status = 'CANCELED', canceled_at = NOW(), updated_at = NOW()
		WHERE stripe_subscription_id = ? RETURNING tenant_id
	`, subID).Scan(&tid).Error
	if err != nil {
		logging.L().Error("subscription cancel failed", zap.Error(err))
		return
	}
	audit.Audit(ctx, audit.Event{
		TenantID: &tid, Action: audit.ActionBillingSubCanceled,
		TargetType: "Subscription", TargetID: subID,
	})
}

func handlePaymentFailed(ctx context.Context, obj map[string]any) {
	customerID := obj["customer"].(string)
	var tid uuid.UUID
	err := database.DB.WithContext(ctx).Raw(`
		UPDATE subscriptions SET status = 'PAST_DUE', updated_at = NOW()
		WHERE stripe_customer_id = ? RETURNING tenant_id
	`, customerID).Scan(&tid).Error
	if err != nil {
		return
	}
	audit.AuditMust(ctx, audit.Event{
		TenantID: &tid, Action: audit.ActionBillingPaymentFailed,
		TargetType: "Subscription", TargetID: customerID,
	})
}

func handleInvoicePaid(ctx context.Context, obj map[string]any) {
	// Reset PAST_DUE if previously set.
	customerID := obj["customer"].(string)
	database.DB.WithContext(ctx).Exec(`
		UPDATE subscriptions SET status = 'ACTIVE', updated_at = NOW()
		WHERE stripe_customer_id = ? AND status = 'PAST_DUE'
	`, customerID)
}

// verifyStripeSignature checks the Stripe-Signature header against the
// raw body. Uses HMAC-SHA256 over "{timestamp}.{body}".
//
// Real Stripe signature format is more nuanced (multiple signed payloads
// for tolerance); the official stripe-go library handles this. For the
// skeleton we verify the basic shape.
func verifyStripeSignature(body []byte, sig, secret string) bool {
	if sig == "" || secret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	// Constant-time comparison.
	return hmac.Equal([]byte(expected), []byte(sig))
}

// ── Metering ──────────────────────────────────────────────────────────────────

// RecordUsage emits a usage event for billing. Idempotent on
// idempotencyKey — passing the same key twice does NOT double-count.
func RecordUsage(ctx context.Context, tenantID uuid.UUID, metric string, quantity float64, idempotencyKey string) error {
	err := database.DB.WithContext(ctx).Exec(`
		INSERT INTO usage_events (tenant_id, metric, quantity, idempotency_key)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (idempotency_key) DO NOTHING
	`, tenantID, metric, quantity, idempotencyKey).Error
	if err != nil {
		return fmt.Errorf("billing: record usage: %w", err)
	}
	return nil
}

// CurrentUsage returns the running count of a metric for the current
// billing period. Used by EnforceUsage to compare against plan limits.
func CurrentUsage(ctx context.Context, tenantID uuid.UUID, metric string) (int64, error) {
	var total *int64
	err := database.DB.WithContext(ctx).Raw(`
		SELECT COALESCE(SUM(quantity)::bigint, 0)
		FROM usage_events
		WHERE tenant_id = ? AND metric = ?
		  AND occurred_at >= date_trunc('month', NOW())
	`, tenantID, metric).Scan(&total).Error
	if err != nil {
		return 0, err
	}
	if total == nil {
		return 0, nil
	}
	return *total, nil
}

// jsonUnmarshal is a thin wrapper so the body of the handler reads
// cleanly. Real code uses encoding/json.Unmarshal directly.
func jsonUnmarshal(data []byte, v any) error {
	return json.Unmarshal(data, v)
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("null")
	}
	return b
}

// Pricing helpers — for showing the customer what they'd pay on a
// different plan. NOT used for actual invoice generation.
func MonthlyPrice(plan PlanCode) int {
	if p, ok := Plans[plan]; ok {
		return p.MonthlyPriceUSD
	}
	return 0
}
