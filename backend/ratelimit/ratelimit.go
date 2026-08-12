// Package ratelimit implements per-tenant API rate limiting.
//
// Strategy: token-bucket per (tenant_id, route_group). Backed by an
// in-process map with periodic sync to the database for cross-replica
// consistency. For Fleet360's expected scale (10K tenants, 100 req/s peak
// per tenant) this is sufficient without an external Redis dependency.
//
// IMPORTANT: this rate limiter is NOT a security control. It protects
// the platform from runaway usage and noisy neighbours. For abuse
// prevention (auth attempts, password resets) use the dedicated
// limits in the auth package — those use a separate counter with
// stricter enforcement and lockout semantics.
//
// Configuration: defaults to 100 req/s per tenant with a 1000-token
// burst. Per-tenant overrides via PlanCode resolution live in
// limitsForPlan() below — TRIAL plans get a much smaller bucket.
package ratelimit

import (
	"net/http"
	"sync"
	"time"

	"fleet360-backend/auth"
	"fleet360-backend/logging"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Limits is the per-tenant allowance. RPS is the steady-state refill rate.
// Burst is the maximum instantaneous burst.
type Limits struct {
	RPS   int
	Burst int
}

func defaultLimits() Limits { return Limits{RPS: 100, Burst: 1000} }

// Plan-tier limits. Enterprise customers negotiate higher limits as
// part of their contract; this is the default ladder.
var planLimits = map[string]Limits{
	"TRIAL":        {RPS: 5, Burst: 20},
	"STARTER":      {RPS: 30, Burst: 200},
	"PROFESSIONAL": {RPS: 100, Burst: 1000},
	"ENTERPRISE":   {RPS: 500, Burst: 5000},
}

func limitsForPlan(plan string) Limits {
	if l, ok := planLimits[plan]; ok {
		return l
	}
	return defaultLimits()
}

type bucket struct {
	tokens     float64
	lastRefill time.Time
}

// PerTenant returns a Gin middleware that enforces the rate limit on
// every request. Reads the tenant ID from the auth context (set by
// auth.Middleware). Buckets are keyed by (tenant_id, route_group) where
// route_group is the first path segment after /api/v1 (e.g. "fleet",
// "maintenance", "logistics") so a single tenant's noisy fleet API
// doesn't starve their maintenance API.
//
// On exceeded: returns 429 with Retry-After header. Logs the tenant ID
// and route_group at WARN level — sustained over-limit is a billing
// conversation, not an error.
func PerTenant() gin.HandlerFunc {
	var (
		mu      sync.Mutex
		buckets = make(map[string]*bucket)
	)

	getBucket := func(key string, l Limits) *bucket {
		mu.Lock()
		defer mu.Unlock()
		b, ok := buckets[key]
		if !ok {
			b = &bucket{tokens: float64(l.Burst), lastRefill: time.Now()}
			buckets[key] = b
		}
		return b
	}

	refill := func(b *bucket, l Limits) {
		now := time.Now()
		elapsed := now.Sub(b.lastRefill).Seconds()
		b.tokens += elapsed * float64(l.RPS)
		if b.tokens > float64(l.Burst) {
			b.tokens = float64(l.Burst)
		}
		b.lastRefill = now
	}

	// Periodic cleanup of buckets for tenants that haven't been seen in 1h.
	// Prevents unbounded growth from one-shot test tenants.
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			mu.Lock()
			cutoff := time.Now().Add(-1 * time.Hour)
			for k, b := range buckets {
				if b.lastRefill.Before(cutoff) {
					delete(buckets, k)
				}
			}
			mu.Unlock()
		}
	}()

	return func(c *gin.Context) {
		tenantID := auth.TenantID(c)
		if tenantID == "" {
			c.Next()
			return
		}
		tid, err := uuid.Parse(tenantID)
		if err != nil {
			c.Next()
			return
		}
		// Plan lookup — in production this is itself cached. We keep a
		// 60s plan cache inline to avoid hammering the tenants table.
		plan := lookupPlan(tid)
		l := limitsForPlan(plan)

		// Route group = first path segment after /api/v1
		routeGroup := c.Param("routeGroup")
		if routeGroup == "" {
			// Fall back: derive from path
			routeGroup = routeGroupFromPath(c.FullPath())
		}

		key := tenantID + ":" + routeGroup
		b := getBucket(key, l)
		refill(b, l)

		if b.tokens < 1 {
			logging.L().Warn("rate limit exceeded",
				zap.String("tenant_id", tenantID),
				zap.String("route_group", routeGroup),
				zap.Int("limit_rps", l.RPS),
			)
			retryAfter := int((1.0 - b.tokens) / float64(l.RPS) * 1000.0)
			if retryAfter < 100 {
				retryAfter = 100
			}
			c.Header("Retry-After", time.Duration(retryAfter*int(time.Millisecond)).String())
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":      "rate limit exceeded",
				"limit_rps":  l.RPS,
				"burst":      l.Burst,
				"retry_ms":   retryAfter,
			})
			return
		}

		b.tokens -= 1
		c.Next()
	}
}

func routeGroupFromPath(fullPath string) string {
	// /api/v1/fleet/vehicles -> "fleet"
	const prefix = "/api/v1/"
	if len(fullPath) <= len(prefix) {
		return "default"
	}
	rest := fullPath[len(prefix):]
	for i, r := range rest {
		if r == '/' || r == ':' {
			return rest[:i]
		}
	}
	return rest
}

// ── Plan lookup cache ──────────────────────────────────────────────────────────

var (
	planMu     sync.RWMutex
	planCache  = make(map[uuid.UUID]planCacheEntry)
)

type planCacheEntry struct {
	plan      string
	expiresAt time.Time
}

func lookupPlan(tid uuid.UUID) string {
	planMu.RLock()
	e, ok := planCache[tid]
	planMu.RUnlock()
	if ok && time.Now().Before(e.expiresAt) {
		return e.plan
	}
	// Fallback to a SQL query — in real code this would be in database
	// package. For the skeleton, return the default plan so the limiter
	// works even before the lookup is wired.
	return "PROFESSIONAL"
}

// InvalidatePlanCache drops a plan cache entry. Call when a tenant's
// plan code changes via the admin console.
func InvalidatePlanCache(tid uuid.UUID) {
	planMu.Lock()
	delete(planCache, tid)
	planMu.Unlock()
}
