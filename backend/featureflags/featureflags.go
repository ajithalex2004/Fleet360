// Package featureflags resolves per-tenant feature flags with caching.
//
// Fleet360 has three sources of feature truth, evaluated in order:
//
//   1. tenant_feature_overrides  (Layer 3 table) — explicit per-tenant
//      overrides with optional time windows. Use for:
//        - beta-rollout cohort gating ("enable dark-mode for 10% of tenants")
//        - time-bounded enable windows ("enable new pricing engine 2027-Q1")
//        - emergency kill-switches ("disable mapbox in case of outage")
//
//   2. tenant_modules  (already in Prisma) — the per-tenant module-level
//      enable/disable (e.g. 'rental' is enabled for this tenant). Set
//      during onboarding or via the admin console. Modules map 1:1 to
//      flags with the same key.
//
//   3. Default (always-off unless allowlisted) — if no row matches and
//      the feature is in the static allowlist with default=true, return
//      true. This is how we ship "enabled by default for new tenants"
//      features without an explicit DB row.
//
// Resolution is cached in-process with a 60s TTL to keep the request
// path off the database. The cache is invalidated on writes via the
// Invalidate function, called from tenant CRUD handlers.
//
// IMPORTANT: NEVER use this package for security decisions. Auth is
// in the auth package, RBAC is the Role/Permission tables. Feature
// flags are for product behaviour, not access control.
package featureflags

import (
	"context"
	"sync"
	"time"

	"fleet360-backend/database"
	"fleet360-backend/logging"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Feature key — kebab-case, closed vocabulary. Add new keys here.
type Feature string

const (
	// Module-level flags. Mirror the kebab-case keys in src/lib/modules.ts.
	FeatureFleetMgmt       Feature = "fleet-mgmt"
	FeatureMaintenance     Feature = "maintenance"
	FeatureRental          Feature = "rental"
	FeatureLeasing         Feature = "leasing"
	FeatureLogistics       Feature = "logistics"
	FeatureSchoolBus       Feature = "school-bus"
	FeatureAmbulance       Feature = "ambulance"
	FeatureCustomerMgmt    Feature = "customer-mgmt"
	FeatureBookingPortal   Feature = "booking-portal"
	FeatureSustainability  Feature = "sustainability"
	FeatureCompliance      Feature = "compliance"
	FeatureReports         Feature = "reports"
	FeatureAgents          Feature = "agents"
	FeatureDispatch        Feature = "dispatch"
	FeatureIncidents       Feature = "incidents"

	// Sub-feature flags (orthogonal to module enabled/disabled).
	FeatureSSOEnabled          Feature = "sso.enabled"
	FeatureSCIMEnabled         Feature = "scim.enabled"
	FeatureAuditLogUI          Feature = "audit-log-ui"
	FeatureAdvancedReporting   Feature = "reporting.advanced"
	FeatureCustomRolesEnabled  Feature = "rbac.custom-roles"
	FeatureDataResidencyEU     Feature = "data-residency.eu"
)

const cacheTTL = 60 * time.Second

// defaultEnabled — flags that are enabled for new tenants without an
// explicit row. Useful for shipping "on by default" features.
// Declared as a package var (not const) because Go does not allow
// map literals in const declarations.
var defaultEnabled = map[Feature]bool{
	FeatureFleetMgmt:   true,
	FeatureMaintenance: true,
	FeatureReports:     true,
	FeatureAuditLogUI:  true,
}

type cacheEntry struct {
	enabled   bool
	expiresAt time.Time
}

// Resolver is the singleton-style entry point. Construct once at startup,
// share across handlers.
type Resolver struct {
	mu    sync.RWMutex
	cache map[uuid.UUID]map[Feature]cacheEntry
}

func NewResolver() *Resolver {
	return &Resolver{cache: make(map[uuid.UUID]map[Feature]cacheEntry)}
}

// IsEnabled returns true iff the feature is enabled for the tenant.
//
// Resolution order:
//   1. tenant_feature_overrides (with time-window check)
//   2. tenant_modules (kebab-case key match)
//   3. Static default
func (r *Resolver) IsEnabled(ctx context.Context, tenantID uuid.UUID, f Feature) bool {
	if tenantID == uuid.Nil {
		return false
	}
	if v, ok := r.fromCache(tenantID, f); ok {
		return v
	}

	enabled := r.resolveFromDB(ctx, tenantID, f)
	r.toCache(tenantID, f, enabled)
	return enabled
}

// resolveFromDB implements the three-source lookup. Each source is a
// separate query — that's intentional. The cache absorbs the cost.
func (r *Resolver) resolveFromDB(ctx context.Context, tenantID uuid.UUID, f Feature) bool {
	// Source 1: explicit override.
	var override struct {
		IsEnabled    bool
		EnabledFrom  *time.Time
		EnabledUntil *time.Time
	}
	err := database.DB.WithContext(ctx).Raw(`
		SELECT is_enabled, enabled_from, enabled_until
		FROM tenant_feature_overrides
		WHERE tenant_id = ? AND feature_key = ?
	`, tenantID, string(f)).Scan(&override).Error
	if err == nil && (override.EnabledFrom == nil || time.Now().UTC().After(*override.EnabledFrom)) &&
		(override.EnabledUntil == nil || time.Now().UTC().Before(*override.EnabledUntil)) {
		return override.IsEnabled
	}

	// Source 2: tenant_modules (only meaningful for module-level flags).
	var isEnabled bool
	err = database.DB.WithContext(ctx).Raw(`
		SELECT COALESCE(is_enabled, false)
		FROM tenant_modules
		WHERE tenant_id = ? AND module = ?
	`, tenantID, string(f)).Scan(&isEnabled).Error
	if err == nil {
		return isEnabled
	}

	// Source 3: static default.
	return defaultEnabled[f]
}

// Invalidate drops the cache entries for a tenant. Call from tenant CRUD
// handlers when tenant_modules or tenant_feature_overrides change.
// Safe to call from any goroutine.
func (r *Resolver) Invalidate(tenantID uuid.UUID, features ...Feature) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(features) == 0 {
		delete(r.cache, tenantID)
		return
	}
	m, ok := r.cache[tenantID]
	if !ok {
		return
	}
	for _, f := range features {
		delete(m, f)
	}
	if len(m) == 0 {
		delete(r.cache, tenantID)
	}
}

// InvalidateAll clears the entire cache. Call from operator tooling or
// after a config-deploy that touched many tenants.
func (r *Resolver) InvalidateAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cache = make(map[uuid.UUID]map[Feature]cacheEntry)
}

func (r *Resolver) fromCache(tenantID uuid.UUID, f Feature) (bool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	m, ok := r.cache[tenantID]
	if !ok {
		return false, false
	}
	e, ok := m[f]
	if !ok {
		return false, false
	}
	if time.Now().After(e.expiresAt) {
		return false, false
	}
	return e.enabled, true
}

func (r *Resolver) toCache(tenantID uuid.UUID, f Feature, enabled bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, ok := r.cache[tenantID]
	if !ok {
		m = make(map[Feature]cacheEntry)
		r.cache[tenantID] = m
	}
	m[f] = cacheEntry{enabled: enabled, expiresAt: time.Now().Add(cacheTTL)}
}

// ── Middleware-style helper ────────────────────────────────────────────────────

// Guard returns true if the feature is enabled for the tenant in the
// request context. Convenience wrapper for handlers that want to short-
// circuit on disabled features without manually calling IsEnabled.
func (r *Resolver) Guard(ctx context.Context, tenantID uuid.UUID, f Feature) bool {
	enabled := r.IsEnabled(ctx, tenantID, f)
	if !enabled {
		logging.L().Debug("feature disabled",
			zap.String("feature", string(f)),
			zap.String("tenant_id", tenantID.String()),
		)
	}
	return enabled
}
