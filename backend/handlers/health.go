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
	"net/http"
	"os"

	"fleet360-backend/database"
	"fleet360-backend/phasegate"

	"github.com/gin-gonic/gin"
)

// Healthz returns 200 unconditionally as long as the HTTP server is
// running. NO external dependency checks — that's what /readyz is for.
func Healthz(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "alive"})
}

// Readyz returns 200 only when the binary is fully ready to serve
// tenant traffic. Returns 503 with diagnostic details otherwise.
//
// This is the endpoint Kubernetes-style orchestrators should hit for
// "ready to receive traffic" decisions.
func Readyz(c *gin.Context) {
	checks := gin.H{}
	overallOK := true

	// ── DB check ───────────────────────────────────────────────────────────
	dbOK, dbErr := pingDB(c)
	checks["database"] = gin.H{
		"reachable": dbOK,
		"error":     errStringOrEmpty(dbErr),
	}
	if !dbOK {
		overallOK = false
	}

	// ── Phase gate check ───────────────────────────────────────────────────
	gateStatus, lastCheck, lastErr := phasegate.Snapshot()
	gateOK := gateStatus == phasegate.StatusVerified || gateStatus == phasegate.StatusSkipped
	checks["phasegate"] = gin.H{
		"status":      gateStatus,
		"verified":    phasegate.IsVerified(),
		"lastCheckAt": lastCheck,
		"lastError":   lastErr,
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

	c.JSON(status, gin.H{
		"status":   overall,
		"checks":   checks,
		"uptime":   "", // could be filled in from a process-start timestamp
		"version":  "", // could be filled in from -ldflags '-X main.version=...'
	})
}

// DebugPhasegate returns the full phasegate state for operators.
// NOT intended for load-balanced traffic — register on a separate
// route group or restrict via IP allowlist in production.
func DebugPhasegate(c *gin.Context) {
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
	if err := sqlDB.PingContext(c.Request.Context()); err != nil {
		return false, err
	}
	return true, nil
}

func isSkipEnvActive() bool {
	// Read directly from os — same env var phasegate.IsVerified checks.
	return os.Getenv("PHASE0_SKIP_SMOKE") == "1"
}

func errStringOrEmpty(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
