package phasegate

// Migration runner — applies Phase 0 SQL files to the connected DB.
// This is an INTEGRATION TEST gated by DATABASE_URL — it actually
// modifies the database. Run with:
//
//   go test ./phasegate/ -run TestApplyPhase0Migrations -count=1 -v
//
// The migrations are idempotent (every statement uses IF NOT EXISTS or
// wraps a to_regclass check), so re-running is safe. The test passes
// once the migrations have been applied AND the smoke test still
// succeeds against the migrated schema.
//
// PRODUCTION POSTURE: do NOT run this from your CI pipeline. CI
// should run only the read-only smoke test (TestIntegration_*).
// This test is for the operator who is applying migrations to
// staging/prod for the first time, run manually with explicit intent.

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"fleet360-backend/database"

	"go.uber.org/zap"
	"gorm.io/gorm"
)

// TestApplyPhase0Migrations is a one-shot integration test that
// applies the Phase 0 migration stack and verifies the smoke test
// still passes afterwards. Run with explicit intent:
//
//   go test ./phasegate/ -run TestApplyPhase0Migrations -count=1 -v
//
// Migration order matters — later files reference objects created by
// earlier ones (CHECK constraints assume backfill completed; the
// dispatch migration references `tenant_branches` from the
// tenant_isolation migration).
func TestApplyPhase0Migrations(t *testing.T) {
	if os.Getenv("PHASE0_RUN_MIGRATIONS") != "1" {
		t.Skip("PHASE0_RUN_MIGRATIONS not set — this test mutates the database. " +
			"Set PHASE0_RUN_MIGRATIONS=1 to apply Phase 0 migrations. " +
			"Re-running is safe (every statement is idempotent).")
	}
	requireDB(t)
	resetGateForTest(t)

	// Migration files in dependency order. Paths are relative to the
	// backend module root (where `go test` is invoked from).
	files := []string{
		"../../prisma/migrations/tenant_isolation.sql",
		"../../prisma/migrations/20260625_dispatch_tenant_isolation.sql",
		"../../prisma/migrations/20260625_phase0_backfill_safety.sql",
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	for _, rel := range files {
		abs, _ := filepath.Abs(rel)
		bytes, err := os.ReadFile(rel)
		if err != nil {
			t.Fatalf("read %s (abs=%s): %v", rel, abs, err)
		}
		t.Logf("applying %s (%d bytes)", rel, len(bytes))
		if err := database.DB.WithContext(ctx).Exec(string(bytes)).Error; err != nil {
			t.Fatalf("apply %s: %v", rel, err)
		}
		t.Logf("  ok")
	}

	// Verify the smoke test still passes after the schema has changed.
	// If backfill silently broke isolation, this fails loud.
	if err := runSmokeTest(); err != nil {
		t.Fatalf("smoke test failed after migrations: %v", err)
	}

	// And clean up the smoke tenants so the next manual run starts fresh.
	t.Cleanup(cleanupSmokeTenants)
}

// _ silences unused-import warnings when only the applyPhase0Migrations
// path is taken.
var _ = gorm.ErrRecordNotFound
var _ = zap.NewNop
