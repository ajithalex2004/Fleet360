package handlers

// Health-check endpoints — split between Kubernetes-style liveness
// (/healthz) and readiness (/readyz).
//
// /healthz (liveness)
//   Returns 200 if the process is up and serving HTTP. NEVER depends
//   on the database or phasegate — if /healthz goes red, the load
//   balancer pulls the pod from rotation entirely. We want this
//   cheap and reliable.
//
// /readyz (readiness)
//   Returns 200 only if the process is ready to take traffic. This
//   checks:
//     - DB reachable (ping)
//     - phasegate verified (cross-tenant isolation smoke test passed)
//     - Layer 2-5 routes ready (phasegate.IsVerified())
//   On Phase 0 outage, /readyz goes red but /healthz stays green —
//   the LB stops sending NEW traffic but doesn't kill the pod, so
//   operators can inspect /readyz and /debug endpoints for diagnostics.
//
// /debug/phasegate (operator-only, plain JSON)
//   Detailed gate state for on-call. NOT load-balanced — operators
//   curl this directly or use it as a Prometheus scrape target.

import (
	"context"
	"crypto/subtle"
	"net/http"
	"os"
	"time"

	"fleet360-backend/database"
	"fleet360-backend/logging"
	"fleet360-backend/phasegate"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// Healthz returns 200 unconditionally as long as the HTTP server is
// running. NO external dependency checks — that's what /readyz is for.
func Healthz(c *gin.Context) {
	version := os.Getenv("RAILWAY_GIT_COMMIT_SHA")
	if version == "" {
		version = os.Getenv("GIT_COMMIT_SHA")
	}
	c.JSON(http.StatusOK, gin.H{"status": "alive", "version": version})
}

// Readyz returns 200 only when the binary is fully ready to serve
// tenant traffic. Returns 503 with diagnostic details otherwise.
//
// This is the endpoint Kubernetes-style orchestrators should hit for
// "ready to receive traffic" decisions.
func Readyz(c *gin.Context) {
	log := logging.L()
	checks := gin.H{}
	overallOK := true

	// ── DB check ───────────────────────────────────────────────────────────
	dbOK, dbErr := pingDB(c)
	if dbErr != nil {
		// /readyz sits behind no auth (see backend/main.go) — log the real
		// error server-side only, never echo it back to the caller.
		log.Warn("readyz: database ping failed", zap.Error(dbErr))
	}
	checks["database"] = gin.H{
		"reachable": dbOK,
	}
	if !dbOK {
		overallOK = false
	}

	// ── Phase gate check ───────────────────────────────────────────────────
	gateStatus, lastCheck, lastErr := phasegate.Snapshot()
	gateOK := gateStatus == phasegate.StatusVerified || gateStatus == phasegate.StatusSkipped
	if lastErr != "" {
		log.Warn("readyz: phasegate not verified", zap.String("lastError", lastErr))
	}
	checks["phasegate"] = gin.H{
		"status":      gateStatus,
		"verified":    phasegate.IsVerified(),
		"lastCheckAt": lastCheck,
		"remediation": "see docs/PHASE_0_COMPLETION.md day 1-3 punch list",
	}
	if !gateOK {
		overallOK = false
	}

	status := http.StatusOK
	overall := "ready"
	if !overallOK {
		status = http.StatusServiceUnavailable
		overall = "not_ready"
	}

	version := os.Getenv("RAILWAY_GIT_COMMIT_SHA")
	if version == "" {
		version = os.Getenv("GIT_COMMIT_SHA")
	}

	c.JSON(status, gin.H{
		"status":   overall,
		"checks":   checks,
		"uptime":   "", // could be filled in from a process-start timestamp
		"version":  version,
	})
}

// DebugPhasegate returns the full phasegate state for operators.
// NOT intended for load-balanced traffic — register on a separate
// route group or restrict via IP allowlist in production.
//
// Optional access gate: set PHASEGATE_DEBUG_TOKEN and callers must send it
// back via the X-Debug-Token header. If the env var is unset (the default
// in every environment as of 2026-09-15) this endpoint stays open exactly
// as before — set PHASEGATE_DEBUG_TOKEN in Railway to actually lock it
// down. A mismatch returns 404, not 401/403, so an unauthenticated caller
// can't use the response to confirm the endpoint even exists.
func DebugPhasegate(c *gin.Context) {
	if token := os.Getenv("PHASEGATE_DEBUG_TOKEN"); token != "" {
		supplied := c.GetHeader("X-Debug-Token")
		if subtle.ConstantTimeCompare([]byte(supplied), []byte(token)) != 1 {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
	}
	status, lastCheck, lastErr := phasegate.Snapshot()
	c.JSON(http.StatusOK, gin.H{
		"status":                  status,
		"verified":                phasegate.IsVerified(),
		"lastCheckAt":             lastCheck,
		"lastError":               lastErr,
		"layer2to5RoutesReady":    phasegate.IsVerified(),
		"phaseGateSkipEnvActive":  isSkipEnvActive(),
	})
}

func pingDB(c *gin.Context) (bool, error) {
	sqlDB, err := database.DB.DB()
	if err != nil {
		return false, err
	}
	// Don't rely solely on the inbound request's context — it may carry no
	// deadline at all, which would let a stalled DB hang this handler (and,
	// in turn, /readyz) indefinitely.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func isSkipEnvActive() bool {
	// Read directly from os — same env var phasegate.IsVerified checks.
	return os.Getenv("PHASE0_SKIP_SMOKE") == "1"
}

