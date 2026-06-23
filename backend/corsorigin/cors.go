// Package corsorigin builds and maintains the live CORS allow-list for the
// Fleet360 Go backend.
//
// Two sources combine into one in-memory set:
//
//   1. ALLOWED_ORIGINS env var — comma-separated, loaded once at startup.
//      This is the system-level baseline: dev origins (http://localhost:3000),
//      internal admin tools, anything that doesn't belong to a specific
//      tenant. Static across the binary's lifetime.
//
//   2. tenants.allowed_origins column — comma-separated, refreshed every
//      minute from a background goroutine. This is the tenant-driven set:
//      onboarding a new enterprise customer is a single SQL UPDATE that
//      propagates within the refresh interval, no recompile or restart
//      needed.
//
// The CORS middleware checks each preflight against this combined set via
// IsAllowed, which is a lock-free RWMutex read of an immutable map snapshot.
// Refresh writes a brand-new map and swaps it in under the write lock — so
// callers never see a partially-populated allow-list.
package corsorigin

import (
	"context"
	"os"
	"strings"
	"sync"
	"time"

	"fleet360-backend/logging"

	"go.uber.org/zap"
	"gorm.io/gorm"
)

// envVar is the env-var name read at startup for the baseline list. Kept as
// a package var (not a const) so tests can substitute it without touching
// the process environment.
var envVar = "ALLOWED_ORIGINS"

// Default refresh cadence. One minute is short enough that tenant onboarding
// feels responsive, long enough that the DB roundtrip is negligible.
const DefaultRefreshInterval = 60 * time.Second

type cache struct {
	mu      sync.RWMutex
	origins map[string]struct{}
}

var c = &cache{origins: map[string]struct{}{}}

// IsAllowed reports whether the given Origin header value is in the live
// allow-list. Hot-path: per-request CORS preflight calls this, so it must
// be cheap. RWMutex.RLock + map lookup is single-digit microseconds.
func IsAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	c.mu.RLock()
	_, ok := c.origins[origin]
	c.mu.RUnlock()
	return ok
}

// Snapshot returns the current allow-list as a sorted-arbitrary slice.
// Used for logging / debug endpoints only — IsAllowed is the hot path.
func Snapshot() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]string, 0, len(c.origins))
	for o := range c.origins {
		out = append(out, o)
	}
	return out
}

// LoadBaseline reads ALLOWED_ORIGINS once and seeds the cache. Idempotent.
// Returns the count of baseline origins loaded so the caller can log.
//
// Called from main() before the HTTP server starts accepting connections.
// If the env var is unset we log a warning rather than failing — the DB-
// derived origins may still produce a usable allow-list, and a deployment
// that legitimately has only tenant origins should still boot.
func LoadBaseline() int {
	raw := strings.TrimSpace(os.Getenv(envVar))
	if raw == "" {
		logging.L().Warn("CORS baseline env unset; tenant-derived origins only", zap.String("env_var", envVar))
		return 0
	}
	baseline := parseList(raw)
	c.mu.Lock()
	// Preserve any tenant-derived entries already present (RefreshFromDB
	// may have run first if the boot order changes).
	for o := range c.origins {
		baseline[o] = struct{}{}
	}
	c.origins = baseline
	count := len(baseline)
	c.mu.Unlock()
	logging.L().Info("CORS baseline loaded", zap.Int("origins", count), zap.String("env_var", envVar))
	return count
}

// RefreshFromDB queries the tenants table for allowed_origins and rebuilds
// the cache as (env baseline ∪ tenant-derived). One atomic swap at the
// end — callers never see a partial allow-list.
//
// Errors here are returned (not logged) so the caller can decide whether a
// startup failure is fatal (it isn't — we keep serving with the previous
// snapshot). The startup path logs and continues; the background refresher
// logs and tries again on the next tick.
func RefreshFromDB(db *gorm.DB) error {
	// Plain SQL — no GORM model needed for a one-column read. Filters
	// inactive tenants (is_active=false) so a deactivated customer's
	// origins stop working immediately, not after the next deploy.
	var rows []string
	if err := db.Raw(`SELECT allowed_origins
	                    FROM tenants
	                   WHERE COALESCE(is_active, TRUE) = TRUE
	                     AND allowed_origins IS NOT NULL
	                     AND allowed_origins <> ''`).Scan(&rows).Error; err != nil {
		return err
	}

	// Rebuild from scratch every time. Cost: O(tenants × origins-per-tenant)
	// — bounded by tenant count, runs once a minute. Correctness benefit:
	// removing a tenant's origin propagates without bespoke deletion logic.
	set := parseList(strings.TrimSpace(os.Getenv(envVar)))
	for _, raw := range rows {
		for o := range parseList(raw) {
			set[o] = struct{}{}
		}
	}

	c.mu.Lock()
	c.origins = set
	count := len(set)
	c.mu.Unlock()
	logging.L().Info("CORS refreshed from DB", zap.Int("origins_total", count), zap.Int("tenant_rows", len(rows)))
	return nil
}

// StartRefresher launches a goroutine that calls RefreshFromDB every
// `interval`. The returned cancel function stops the goroutine on the next
// tick (or immediately, if blocked on ctx). main.go calls cancel via
// graceful-shutdown when it lands; today it's a one-shot for the binary
// lifetime.
func StartRefresher(db *gorm.DB, interval time.Duration) context.CancelFunc {
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := RefreshFromDB(db); err != nil {
					logging.L().Warn("CORS refresh failed (keeping previous snapshot)", zap.Error(err))
				}
			}
		}
	}()
	return cancel
}

// parseList splits a comma-separated origin list into a set, trimming
// whitespace and dropping empty entries. Shared by both load paths so the
// parsing rules are identical regardless of source.
func parseList(raw string) map[string]struct{} {
	set := map[string]struct{}{}
	if raw == "" {
		return set
	}
	for _, o := range strings.Split(raw, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			set[o] = struct{}{}
		}
	}
	return set
}
