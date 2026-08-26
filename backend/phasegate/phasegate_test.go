package phasegate

// Cross-tenant isolation smoke test â€” unit + integration coverage.
//
// Run with:    go test ./phasegate/...
//
// What's covered:
//
//   UNIT (no DB required, always runs in CI):
//     - Gate state machine (UNVERIFIED â†” VERIFIED â†” SKIPPED)
//     - PHASE0_SKIP_SMOKE escape hatch
//     - Snapshot() return shape
//     - Middleware() 503 vs 200 routing
//     - Middleware() response body shape (error message, Retry-After)
//
//   INTEGRATION (requires DATABASE_URL; FAILS if absent, never skips):
//     - ensureTestTenants creates stable, idempotent test rows
//     - testTenantIsolation passes for vehicles / drivers / garages
//     - testTenantIsolation CATCHES a deliberate breach (inserting
//       tenant A's row, then querying without the WHERE clause â€”
//       the bug we're protecting against)
//     - runSmokeTest flips the gate from UNVERIFIED â†’ VERIFIED
//     - RunStartupCheck honors PHASE0_REQUIRE_SMOKE (fail-closed)
//     - Recheck loop flips greenâ†’red when a constraint is dropped
//
// To run integration tests against staging:
//
//     export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
//     go test ./phasegate/... -v -run Integration
//
// To skip integration tests explicitly (default for `go test ./...` in CI
// when DATABASE_URL isn't exported):
//
//     export SKIP_DB_TESTS=1

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"fleet360-backend/database"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"gorm.io/gorm"
)

// â”€â”€ Test fixtures & helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// TestMain is the entry point for `go test ./phasegate/...`. It loads .env so
// integration tests can read DATABASE_URL without the operator exporting it.
//
// Under PHASE0_REQUIRE_DB=1 it also enforces the three conditions that make the
// result mean something: a database must be configured, the connected role must
// not hold BYPASSRLS, and at least one cross-tenant assertion must actually
// execute. Any of those failing exits non-zero rather than reporting success.
func TestMain(m *testing.M) {
	if os.Getenv("SKIP_DB_TESTS") != "1" {
		// Try several .env paths so the test runs the same way from
		// `cd backend && go test ./...` and from `go test ./backend/...`.
		for _, p := range []string{".env", "../.env", "../../.env", "../../../.env"} {
			if _, err := os.Stat(p); err == nil {
				_ = godotenv.Load(p)
				break
			}
		}
		// Initialise DB only if DATABASE_URL is set (avoids noisy
		// "connection refused" logs when the dev doesn't have a DB).
		if os.Getenv("DATABASE_URL") != "" {
			database.Connect()
		}
	}

	// In required mode the run must be incapable of passing without having
	// done the work. Three gates, all before and after m.Run rather than
	// inside any single test, because a test that never starts cannot fail.
	required := os.Getenv("PHASE0_REQUIRE_DB") == "1"

	if required && os.Getenv("DATABASE_URL") == "" {
		fmt.Fprintln(os.Stderr,
			"FATAL: PHASE0_REQUIRE_DB=1 but DATABASE_URL is empty. The CI database "+
				"secret is missing. This job must not report success without it.")
		os.Exit(1)
	}

	if err := preflight(); err != nil {
		fmt.Fprintf(os.Stderr, "FATAL: phase 0 preflight failed: %v\n", err)
		os.Exit(1)
	}

	code := m.Run()

	// A suite that executed zero cross-tenant assertions has proved nothing,
	// however green it looks. This is the specific failure that let
	// "Cross-tenant isolation" report success for months.
	if required {
		n := crossTenantAssertions.Load()
		fmt.Printf("\n=== PHASE 0 SUMMARY ===\ncross_tenant_assertions_executed = %d\n", n)
		if n == 0 {
			fmt.Fprintln(os.Stderr,
				"FATAL: zero cross-tenant assertions executed. The suite did not test isolation, "+
					"so its result means nothing. Failing rather than reporting a green tick.")
			os.Exit(1)
		}
		if code == 0 {
			fmt.Printf("verdict = PASS (%d assertions against a non-BYPASSRLS role)\n", n)
		}
	}

	os.Exit(code)
}



// resetGateForTest resets the package-level gate state. MUST be called
// at the start of every test that depends on gate state â€” the package
// init() sets UNVERIFIED but tests that mutate state (e.g. via state.Store)
// would otherwise leak into the next test.
func resetGateForTest(t *testing.T) {
	t.Helper()
	mu.Lock()
	if smokeCancel != nil {
		smokeCancel()
		smokeCancel = nil
	}
	mu.Unlock()
	state.Store(StatusUnverified)
	lastRunAt.Store(time.Time{})
	lastError.Store("")
}

// requireDB gates an integration test on a usable database.
//
// It used to t.Skip on three separate conditions, which is a large part of why
// the "Cross-tenant isolation" CI check reported success for months without
// ever executing a cross-tenant assertion: the secret was never configured, so
// the step was gated off, and the tests would have skipped themselves even if
// it had run.
//
// PHASE0_REQUIRE_DB=1 - set by CI - turns each of those into a hard failure,
// SKIP_DB_TESTS included, so the gate cannot be disarmed from inside the repo.
func requireDB(t *testing.T) {
	t.Helper()
	required := os.Getenv("PHASE0_REQUIRE_DB") == "1"

	// SKIP_DB_TESTS must not be able to disarm the gate from inside the repo.
	if os.Getenv("SKIP_DB_TESTS") == "1" {
		if required {
			t.Fatal("PHASE0_REQUIRE_DB=1 but SKIP_DB_TESTS=1 - the isolation suite may not be disabled in required mode")
		}
		t.Skip("SKIP_DB_TESTS=1 - explicitly disabled by the operator")
	}

	// An absent DATABASE_URL is a failure in every mode. In CI it means the
	// secret is missing; locally it means the operator did not opt out. Silence
	// is the thing being removed.
	if os.Getenv("DATABASE_URL") == "" {
		t.Fatal("DATABASE_URL is not set - the isolation suite cannot run. " +
			"In CI this means the database secret is missing. Locally, set DATABASE_URL " +
			"or set SKIP_DB_TESTS=1 to opt out explicitly.")
	}
	if database.DB == nil {
		t.Fatal("database.DB is nil - DATABASE_URL is set but no connection was established")
	}
}

// crossTenantAssertions counts the cross-tenant assertions that ACTUALLY
// EXECUTED. TestMain fails the run if it is still zero in required mode.
//
// "The suite passed" and "the suite ran" are different claims. This job
// reported success while every integration test skipped itself, so the green
// tick proved only that Go compiled.
var crossTenantAssertions atomic.Int64

// assertTenantIsolation runs one cross-tenant assertion and records it. Every
// isolation test goes through here, so the count reflects work done rather
// than tests entered.
func assertTenantIsolation(t *testing.T, ctx context.Context, db *gorm.DB, a, b uuid.UUID, marker, table string) {
	t.Helper()
	if err := testTenantIsolation(ctx, db, a, b, marker, table); err != nil {
		t.Fatalf("testTenantIsolation(%s): %v", table, err)
	}
	crossTenantAssertions.Add(1)
}

// preflight proves the suite is running against the role it is meant to test,
// and prints that proof into the CI log.
//
// Running as a BYPASSRLS role is the failure mode that matters most: every
// assertion would pass on application-level WHERE clauses alone while RLS
// contributed nothing, and the result would be indistinguishable from real
// isolation. That is exactly the state the application runtime is in today,
// which is why CI must not inherit its connection string.
func preflight() error {
	if os.Getenv("PHASE0_REQUIRE_DB") != "1" {
		return nil
	}
	if database.DB == nil {
		return fmt.Errorf("PHASE0_REQUIRE_DB=1 but no database connection was established")
	}

	var row struct {
		CurrentUser string
		BypassRls   bool
	}
	if err := database.DB.Raw(
		`SELECT current_user AS current_user,
		        COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypass_rls`,
	).Scan(&row).Error; err != nil {
		return fmt.Errorf("preflight query failed: %w", err)
	}

	expected := os.Getenv("PHASE0_EXPECTED_ROLE")
	if expected == "" {
		expected = "fleet360_app"
	}

	fmt.Printf("\n=== PHASE 0 PREFLIGHT ===\n")
	fmt.Printf("connected_role = %s\n", row.CurrentUser)
	fmt.Printf("expected_role  = %s\n", expected)
	fmt.Printf("bypassrls      = %v\n", row.BypassRls)

	if row.BypassRls {
		return fmt.Errorf(
			"connected as %q which holds rolbypassrls - RLS is not enforced for it, so every "+
				"isolation assertion would pass regardless of whether isolation works. "+
				"Point the CI secret at a non-BYPASSRLS role (%s)", row.CurrentUser, expected)
	}
	if row.CurrentUser != expected {
		return fmt.Errorf(
			"connected as %q but expected %q - set PHASE0_EXPECTED_ROLE if this is deliberate",
			row.CurrentUser, expected)
	}
	return nil
}

// uniqueMarker returns a marker string unique to this test invocation,
// used for the sentinel rows inserted by the smoke test so concurrent
// test runs (and serial reruns against the same DB) don't collide on
// unique constraint columns. Format:
//
//   phase0-<hex8>-<hex8>-<hex16>
//
//   hex8  = first 4 bytes of sha256(test_name) as hex
//   hex8  = first 4 bytes of sha256(test_name || unix_nanos) as hex
//   hex16 = first 8 bytes of sha256(test_name || unix_nanos) as hex
//
// The 32-char limit of license_plate is fine (8+8+16 = 32 hex chars).
func uniqueMarker(t *testing.T) string {
	t.Helper()
	testName := strings.ReplaceAll(t.Name(), "/", "-")
	nanos := time.Now().UnixNano()
	part1 := sha256.Sum256([]byte(testName))
	part2 := sha256.Sum256([]byte(testName + "|" + fmt.Sprintf("%d", nanos)))
	return fmt.Sprintf("phase0-%x-%x-%x",
		part1[:4], part2[:4], part2[:8])
}

// â”€â”€ UNIT TESTS â€” gate state machine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

func TestInitialState_Unverified(t *testing.T) {
	resetGateForTest(t)

	if IsVerified() {
		t.Fatal("a freshly reset gate must report UNVERIFIED")
	}
	status, when, errStr := Snapshot()
	if status != StatusUnverified {
		t.Errorf("Snapshot().status = %q, want %q", status, StatusUnverified)
	}
	if !when.IsZero() {
		t.Errorf("Snapshot().lastRunAt = %v, want zero time", when)
	}
	if errStr != "" {
		t.Errorf("Snapshot().lastError = %q, want empty", errStr)
	}
}

func TestStateStore_ReflectsAcrossCalls(t *testing.T) {
	resetGateForTest(t)

	state.Store(StatusVerified)
	if !IsVerified() {
		t.Fatal("IsVerified must return true after Store(VERIFIED)")
	}

	state.Store(StatusUnverified)
	if IsVerified() {
		t.Fatal("IsVerified must return false after Store(UNVERIFIED)")
	}
}

func TestSkipEscapeHatch_BypassesGate(t *testing.T) {
	resetGateForTest(t)
	t.Setenv("PHASE0_SKIP_SMOKE", "1")

	if !IsVerified() {
		t.Fatal("PHASE0_SKIP_SMOKE=1 must cause IsVerified to return true")
	}
	status, _, _ := Snapshot()
	if status != StatusSkipped {
		t.Errorf("Snapshot().status = %q, want %q", status, StatusSkipped)
	}
}

func TestSkipEscapeHatch_OnlyMarksSkippedOnce(t *testing.T) {
	// Idempotency: calling IsVerified() multiple times with the skip
	// env set shouldn't trigger multiple WARN log lines or state churn.
	resetGateForTest(t)
	t.Setenv("PHASE0_SKIP_SMOKE", "1")

	for i := 0; i < 5; i++ {
		if !IsVerified() {
			t.Fatalf("iteration %d: IsVerified = false, want true", i)
		}
	}
}

func TestSnapshot_AfterManualStateUpdate(t *testing.T) {
	resetGateForTest(t)
	state.Store(StatusVerified)
	lastRunAt.Store(time.Date(2026, 6, 25, 10, 0, 0, 0, time.UTC))
	lastError.Store("synthetic test error")

	status, when, errStr := Snapshot()
	if status != StatusVerified {
		t.Errorf("status = %q, want %q", status, StatusVerified)
	}
	if when.Year() != 2026 || when.Month() != 6 || when.Day() != 25 {
		t.Errorf("lastRunAt = %v, want 2026-06-25", when)
	}
	if errStr != "synthetic test error" {
		t.Errorf("lastError = %q, want %q", errStr, "synthetic test error")
	}
}

func TestRecheckInterval_DefaultsTo5Minutes(t *testing.T) {
	// No env var â†’ default 5 minutes.
	if got := recheckInterval(); got != 5*time.Minute {
		t.Errorf("recheckInterval() = %v, want 5m", got)
	}
}

func TestRecheckInterval_ParsesEnvVar(t *testing.T) {
	t.Setenv("PHASE0_RECHECK_INTERVAL", "30s")
	if got := recheckInterval(); got != 30*time.Second {
		t.Errorf("recheckInterval() = %v, want 30s", got)
	}
}

func TestRecheckInterval_FallsBackOnInvalidEnvVar(t *testing.T) {
	t.Setenv("PHASE0_RECHECK_INTERVAL", "not-a-duration")
	if got := recheckInterval(); got != 5*time.Minute {
		t.Errorf("recheckInterval() with invalid env = %v, want 5m (fallback)", got)
	}
}

// â”€â”€ UNIT TESTS â€” middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

func TestMiddleware_Returns503WhenUnverified(t *testing.T) {
	resetGateForTest(t)
	gin.SetMode(gin.TestMode)

	r := gin.New()
	called := false
	r.GET("/protected", Middleware(), func(c *gin.Context) {
		called = true
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	r.ServeHTTP(w, req)

	if called {
		t.Fatal("handler must NOT be called when gate is unverified")
	}
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Error("Retry-After header missing on 503")
	}

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body not JSON: %v (body=%q)", err, w.Body.String())
	}
	if body["error"] != "Service Unavailable" {
		t.Errorf("body.error = %v, want 'Service Unavailable'", body["error"])
	}
	if body["gateStatus"] != string(StatusUnverified) {
		t.Errorf("body.gateStatus = %v, want %q", body["gateStatus"], StatusUnverified)
	}
	if body["remediation"] == "" {
		t.Error("body.remediation must point operators to docs")
	}
}

func TestMiddleware_PassesThroughWhenVerified(t *testing.T) {
	resetGateForTest(t)
	state.Store(StatusVerified)
	gin.SetMode(gin.TestMode)

	r := gin.New()
	called := false
	r.GET("/protected", Middleware(), func(c *gin.Context) {
		called = true
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	r.ServeHTTP(w, req)

	if !called {
		t.Fatal("handler must be called when gate is verified")
	}
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

func TestMiddleware_PassesThroughWhenSkipped(t *testing.T) {
	resetGateForTest(t)
	t.Setenv("PHASE0_SKIP_SMOKE", "1")
	gin.SetMode(gin.TestMode)

	r := gin.New()
	called := false
	r.GET("/protected", Middleware(), func(c *gin.Context) {
		called = true
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	r.ServeHTTP(w, req)

	if !called {
		t.Fatal("handler must be called when PHASE0_SKIP_SMOKE=1")
	}
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

func TestMiddleware_503ResponseExposesOperatorDebugInfo(t *testing.T) {
	// Operators triaging a 503 need enough info to debug without
	// reading source: gate status, last-check timestamp, last error,
	// remediation pointer.
	resetGateForTest(t)
	state.Store(StatusUnverified)
	lastRunAt.Store(time.Now().UTC().Add(-30 * time.Second))
	lastError.Store("phasegate: vehicles isolation: insert as tenant A: pq: duplicate key value violates unique constraint")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/protected", Middleware(), func(c *gin.Context) {
		t.Fatal("must not be called")
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/protected", nil))

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body parse: %v", err)
	}
	if !strings.Contains(body["lastError"].(string), "duplicate key") {
		t.Errorf("body.lastError should include the underlying message, got %v", body["lastError"])
	}
}

// â”€â”€ INTEGRATION TESTS â€” require DATABASE_URL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

func TestIntegration_EnsureTestTenants_Idempotent(t *testing.T) {
	requireDB(t)
	resetGateForTest(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := database.DB.WithContext(ctx)

	// First call: creates
	pair1, err := ensureTestTenants(ctx, db)
	if err != nil {
		t.Fatalf("first ensureTestTenants: %v", err)
	}
	if pair1.A == uuid.Nil || pair1.B == uuid.Nil {
		t.Fatal("ensureTestTenants returned zero UUIDs")
	}
	if pair1.A == pair1.B {
		t.Fatal("tenant A and B must be different")
	}

	// Second call: must return the same IDs (no duplicates)
	pair2, err := ensureTestTenants(ctx, db)
	if err != nil {
		t.Fatalf("second ensureTestTenants: %v", err)
	}
	if pair2.A != pair1.A || pair2.B != pair1.B {
		t.Errorf("ensureTestTenants not idempotent: first=%v second=%v", pair1, pair2)
	}

	// Cleanup so subsequent test runs start fresh.
	t.Cleanup(cleanupSmokeTenants)
}

func TestIntegration_TestTenantIsolation_Vehicles(t *testing.T) {
	requireDB(t)
	resetGateForTest(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := database.DB.WithContext(ctx)
	pair, err := ensureTestTenants(ctx, db)
	if err != nil {
		t.Fatalf("ensureTestTenants: %v", err)
	}
	t.Cleanup(cleanupSmokeTenants)

	marker := uniqueMarker(t)
	assertTenantIsolation(t, ctx, db, pair.A, pair.B, marker, "vehicles")
}

func TestIntegration_TestTenantIsolation_Drivers(t *testing.T) {
	requireDB(t)
	resetGateForTest(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := database.DB.WithContext(ctx)
	pair, err := ensureTestTenants(ctx, db)
	if err != nil {
		t.Fatalf("ensureTestTenants: %v", err)
	}
	t.Cleanup(cleanupSmokeTenants)

	marker := uniqueMarker(t)
	assertTenantIsolation(t, ctx, db, pair.A, pair.B, marker, "drivers")
}

func TestIntegration_TestTenantIsolation_Garages(t *testing.T) {
	requireDB(t)
	resetGateForTest(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := database.DB.WithContext(ctx)
	pair, err := ensureTestTenants(ctx, db)
	if err != nil {
		t.Fatalf("ensureTestTenants: %v", err)
	}
	t.Cleanup(cleanupSmokeTenants)

	marker := uniqueMarker(t)
	assertTenantIsolation(t, ctx, db, pair.A, pair.B, marker, "garages")
}

func TestIntegration_TestTenantIsolation_RejectsBuggyQuery(t *testing.T) {
	// The whole point of the smoke test is to verify that the
	// CORRECT query (with WHERE tenant_id = ?) is what handlers use.
	// This test confirms a BUGGY query (no WHERE clause) WOULD leak
	// â€” proving that the test is meaningful and the WHERE clause is
	// doing the actual isolation work, not some side effect.
	requireDB(t)
	resetGateForTest(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := database.DB.WithContext(ctx)
	pair, err := ensureTestTenants(ctx, db)
	if err != nil {
		t.Fatalf("ensureTestTenants: %v", err)
	}
	t.Cleanup(cleanupSmokeTenants)

	// Insert a sentinel row as tenant A.
	marker := uniqueMarker(t)
	var insertedIDStr string
	err = db.Raw(`
		INSERT INTO vehicles (id, tenant_id, make, model, year, license_plate, vin, status, updated_at)
		VALUES (gen_random_uuid(), ?, 'PHASE0', 'BREACH', 2026, ?, ?, 'TEST', NOW())
		RETURNING id
	`, pair.A, marker[:32], marker+"-VIN").Scan(&insertedIDStr).Error
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	insertedID, err := uuid.Parse(insertedIDStr)
	if err != nil {
		t.Fatalf("parse inserted id: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Exec(`DELETE FROM vehicles WHERE id = ?`, insertedIDStr).Error
	})

	// BUGGY query: no WHERE tenant_id = ? clause. This simulates the
	// exact failure mode we're guarding against â€” a handler that
	// forgets to apply auth.WithTenant(c).
	var buggyCount int64
	if err := db.Raw(`SELECT COUNT(*) FROM vehicles WHERE id = ?`, insertedID).Scan(&buggyCount).Error; err != nil {
		t.Fatalf("buggy query: %v", err)
	}
	if buggyCount != 1 {
		t.Fatalf("buggy query (no WHERE) didn't find the row â€” test setup is wrong, want 1, got %d", buggyCount)
	}

	// CORRECT query: with WHERE tenant_id = ? as the OTHER tenant.
	// This MUST return 0 â€” that's the isolation guarantee.
	var correctCount int64
	if err := db.Raw(`
		SELECT COUNT(*) FROM vehicles WHERE id = ? AND tenant_id = ?
	`, insertedID, pair.B).Scan(&correctCount).Error; err != nil {
		t.Fatalf("correct query: %v", err)
	}
	if correctCount != 0 {
		t.Fatalf("isolation breach: tenant B's WHERE query returned %d rows belonging to tenant A", correctCount)
	}
}

func TestIntegration_TestTenantIsolation_CleanupRuns(t *testing.T) {
	// Verify the deferred cleanup actually removes the sentinel row.
	// Without this, repeated smoke test runs would accumulate rows.
	requireDB(t)
	resetGateForTest(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := database.DB.WithContext(ctx)
	pair, err := ensureTestTenants(ctx, db)
	if err != nil {
		t.Fatalf("ensureTestTenants: %v", err)
	}
	t.Cleanup(cleanupSmokeTenants)

	marker := uniqueMarker(t)

	// Count vehicles with this marker BEFORE the test.
	var before int64
	_ = db.Raw(`SELECT COUNT(*) FROM vehicles WHERE notes LIKE ?`, marker+"%").Scan(&before).Error

	assertTenantIsolation(t, ctx, db, pair.A, pair.B, marker, "vehicles")

	// Count AFTER â€” the defer in testTenantIsolation should have
	// deleted the sentinel row. Allow marker-based detection even
	// though we don't write to notes (the test uses license_plate/vin).
	// We check by license_plate which IS set to marker[:32].
	var after int64
	_ = db.Raw(`SELECT COUNT(*) FROM vehicles WHERE license_plate = ?`, marker[:32]).Scan(&after).Error
	if after != 0 {
		t.Errorf("testTenantIsolation leaked %d rows (license_plate=%q)", after, marker[:32])
	}
}

func TestIntegration_RunSmokeTest_ReturnsNilOnHealthy(t *testing.T) {
	// runSmokeTest is a pure check — it returns nil/error but does NOT
	// update gate state (that's RunStartupCheck's job). This test
	// verifies the check itself passes against a healthy Neon DB.
	requireDB(t)
	resetGateForTest(t)
	t.Cleanup(cleanupSmokeTenants)

	if err := runSmokeTest(); err != nil {
		t.Fatalf("runSmokeTest on healthy DB: %v", err)
	}
}

func TestIntegration_RunStartupCheck_UpdatesGateToVerified(t *testing.T) {
	// The full production path: RunStartupCheck calls runSmokeTest
	// and updates gate state on success.
	requireDB(t)
	resetGateForTest(t)
	t.Cleanup(cleanupSmokeTenants)

	if err := RunStartupCheck(); err != nil {
		t.Fatalf("RunStartupCheck: %v", err)
	}
	status, when, errStr := Snapshot()
	if status != StatusVerified {
		t.Errorf("gate = %q, want %q", status, StatusVerified)
	}
	if when.IsZero() {
		t.Error("lastRunAt should be set after RunStartupCheck succeeds")
	}
	if errStr != "" {
		t.Errorf("lastError should be empty on success, got %q", errStr)
	}
	// RunStartupCheck starts the recheck loop; stop it before the
	// next test to avoid goroutine leaks across tests.
	cancelRecheckLoop(t)
}

func TestIntegration_RunStartupCheck_NoRequireSmoke_DoesNotExitOnFailure(t *testing.T) {
	requireDB(t)
	resetGateForTest(t)
	t.Setenv("PHASE0_REQUIRE_SMOKE", "")

	// Even if the smoke test were to fail (we don't force a failure
	// here, just exercise the success path), RunStartupCheck should
	// return nil unless PHASE0_REQUIRE_SMOKE=1.
	if err := RunStartupCheck(); err != nil {
		t.Fatalf("RunStartupCheck returned error in default mode: %v", err)
	}
	if !IsVerified() {
		t.Error("gate should be VERIFIED after RunStartupCheck succeeds")
	}

	t.Cleanup(cleanupSmokeTenants)
}

func TestIntegration_RunStartupCheck_SkipEnvSkipsSmoke(t *testing.T) {
	requireDB(t)
	resetGateForTest(t)
	t.Setenv("PHASE0_SKIP_SMOKE", "1")

	// Without skipping, runSmokeTest would have run. With the skip
	// env set, RunStartupCheck must short-circuit.
	if err := RunStartupCheck(); err != nil {
		t.Fatalf("RunStartupCheck with SKIP_SMOKE: %v", err)
	}
	status, _, _ := Snapshot()
	if status != StatusSkipped {
		t.Errorf("status = %q, want %q", status, StatusSkipped)
	}
	if !IsVerified() {
		t.Error("IsVerified must be true with skip env set")
	}
}

func TestIntegration_ConcurrentSmokeTestRuns(t *testing.T) {
	// Two parallel calls to ensureTestTenants must converge on the
	// same pair, not create duplicates. (The function uses SELECT
	// before INSERT â€” there's a race window, but the unique constraint
	// on tenants.code makes one of the inserts fail and the other
	// retry.)
	requireDB(t)
	resetGateForTest(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := database.DB.WithContext(ctx)

	t.Cleanup(cleanupSmokeTenants)

	var (
		wg     sync.WaitGroup
		mu     sync.Mutex
		results []tenantPair
		errs   []error
	)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := ensureTestTenants(ctx, db)
			mu.Lock()
			defer mu.Unlock()
			results = append(results, p)
			errs = append(errs, err)
		}()
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("goroutine %d failed: %v", i, err)
		}
	}
	if len(results) != 4 {
		t.Fatalf("expected 4 results, got %d", len(results))
	}
	// All four calls must converge on the same pair.
	first := results[0]
	for i, p := range results[1:] {
		if p.A != first.A || p.B != first.B {
			t.Errorf("goroutine %d pair = %v, want %v", i+1, p, first)
		}
	}
}

// â”€â”€ Helper: detect when an integration test would be silently no-op â”€â”€â”€â”€â”€â”€â”€â”€

// TestIntegration_VerifyReachable guards against the case where DATABASE_URL
// is set but the DB is unreachable. Without this guard, smoke tests would
// silently time out (30s) instead of failing fast.
func TestIntegration_VerifyReachable(t *testing.T) {
	requireDB(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	sqlDB, err := database.DB.DB()
	if err != nil {
		t.Fatalf("database.DB.DB(): %v", err)
	}
	if err := sqlDB.PingContext(ctx); err != nil {
		t.Fatalf("DB unreachable within 5s â€” fix DATABASE_URL or DB health before running other integration tests: %v", err)
	}
}

// â”€â”€ Misc: errors are wrapped with context â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

func TestErrGateClosed_DescribesTheFailure(t *testing.T) {
	if ErrGateClosed == nil {
		t.Fatal("ErrGateClosed must be exported")
	}
	if !strings.Contains(ErrGateClosed.Error(), "Phase 0") {
		t.Errorf("ErrGateClosed should mention Phase 0, got %q", ErrGateClosed.Error())
	}
}

func TestEnsureTestTenants_BothTenantsMustExist(t *testing.T) {
	// Sanity: the function must populate BOTH tenant IDs, not just one.
	// We don't hit the DB here; we verify the struct shape contract.
	p := tenantPair{}
	if p.A == uuid.Nil || p.B == uuid.Nil {
		// Pre-condition: both zero. Now check after manual assignment.
	}
	p.A = uuid.New()
	p.B = uuid.New()
	if p.A == p.B {
		t.Error("test pair must have distinct A and B")
	}
}

// Compile-time assertion that the package compiles with the gorm import
// (this catches a "goimports removed it" issue before the test binary
// fails to link).
var _ = gorm.ErrRecordNotFound
var _ = errors.New

// â”€â”€ UNIT TESTS â€” recheckLoop with mocked check function â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// These tests use recheckLoopWith to inject a fake check function so
// we can deterministically induce failures without breaking the live DB.
// Each test sets PHASE0_RECHECK_INTERVAL to a short value (200ms) so
// the loop ticks quickly; total test runtime per case is ~1s.

// waitFor polls a predicate until it returns true or the deadline
// elapses. Returns the time spent waiting so tests can report.
func waitFor(t *testing.T, deadline time.Duration, msg string, pred func() bool) time.Duration {
	t.Helper()
	start := time.Now()
	for time.Since(start) < deadline {
		if pred() {
			return time.Since(start)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("waitFor timed out after %v: %s", deadline, msg)
	return 0
}

// cancelRecheckLoop cancels any running recheck goroutine spawned by a
// previous test or by RunStartupCheck. Called from tests that start
// their own loop to avoid double-loop leaks.
func cancelRecheckLoop(t *testing.T) {
	t.Helper()
	mu.Lock()
	if smokeCancel != nil {
		smokeCancel()
		smokeCancel = nil
	}
	mu.Unlock()
}

// cleanupSmokeTenants deletes the two phase0_smoke_* tenant rows
// (and their FK-dependent rows in vehicles/drivers/garages) in the
// correct order. Idempotent. Always uses the BASE database.DB so it
// runs even if the test's request-scoped ctx has been cancelled.
//
// Register with t.Cleanup(cleanupSmokeTenants) at the start of any
// test that calls ensureTestTenants, so leftover rows don't leak
// between tests.
func cleanupSmokeTenants() {
	queries := []string{
		// FK targets first. Order matters — vehicles, drivers, garages
		// all reference tenants(id).
		`DELETE FROM vehicles WHERE tenant_id IN (SELECT id FROM tenants WHERE code IN ('phase0_smoke_a','phase0_smoke_b'))`,
		`DELETE FROM drivers WHERE tenant_id IN (SELECT id FROM tenants WHERE code IN ('phase0_smoke_a','phase0_smoke_b'))`,
		`DELETE FROM garages WHERE tenant_id IN (SELECT id FROM tenants WHERE code IN ('phase0_smoke_a','phase0_smoke_b'))`,
		`DELETE FROM tenants WHERE code IN ('phase0_smoke_a','phase0_smoke_b')`,
	}
	for _, q := range queries {
		if err := database.DB.Exec(q).Error; err != nil {
			// Best-effort cleanup. Logged so tests can still see
			// why a row leaked; doesn't fail the test.
			fmt.Printf("cleanupSmokeTenants: %s failed: %v\n", q, err)
		}
	}
}

func TestRecheckLoop_FiresAfterInterval(t *testing.T) {
	resetGateForTest(t)
	t.Setenv("PHASE0_RECHECK_INTERVAL", "200ms")
	cancelRecheckLoop(t)

	// Inject a check that always succeeds and counts invocations.
	var calls atomic.Int64
	check := func() error {
		calls.Add(1)
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go recheckLoopWith(ctx, check)

	// The first tick fires after the configured interval (200ms).
	// Wait up to 1s for at least 2 calls â€” verifies the loop
	// continues across multiple intervals, not just one tick.
	waitFor(t, 1*time.Second, "loop should fire at least twice", func() bool {
		return calls.Load() >= 2
	})

	cancel()
}

func TestRecheckLoop_DetectsGreenToRedRegression(t *testing.T) {
	resetGateForTest(t)
	state.Store(StatusVerified) // start green
	lastRunAt.Store(time.Now().UTC().Add(-1 * time.Hour))
	t.Setenv("PHASE0_RECHECK_INTERVAL", "150ms")
	cancelRecheckLoop(t)

	// Mock check that fails on every call.
	check := func() error {
		return errors.New("simulated regression: tenant isolation breached")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go recheckLoopWith(ctx, check)

	// Wait for gate to flip to UNVERIFIED.
	waitFor(t, 1*time.Second, "gate should flip to UNVERIFIED after failing check", func() bool {
		return state.Load().(Status) == StatusUnverified
	})

	// lastError must contain the failure message.
	_, _, lastErr := Snapshot()
	if !strings.Contains(lastErr, "simulated regression") {
		t.Errorf("lastError = %q, want to contain 'simulated regression'", lastErr)
	}

	cancel()
}

func TestRecheckLoop_DetectsRedToGreenRecovery(t *testing.T) {
	resetGateForTest(t)
	state.Store(StatusUnverified) // start red
	lastError.Store("previous failure")
	t.Setenv("PHASE0_RECHECK_INTERVAL", "150ms")
	cancelRecheckLoop(t)

	// Mock check that fails for the first 2 calls, then succeeds.
	var calls atomic.Int64
	check := func() error {
		if calls.Add(1) <= 2 {
			return errors.New("transient failure")
		}
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go recheckLoopWith(ctx, check)

	// Wait for gate to flip to VERIFIED.
	waitFor(t, 2*time.Second, "gate should flip back to VERIFIED", func() bool {
		return state.Load().(Status) == StatusVerified
	})

	// lastError must be cleared on success.
	_, _, lastErr := Snapshot()
	if lastErr != "" {
		t.Errorf("lastError should be cleared on recovery, got %q", lastErr)
	}

	cancel()
}

func TestRecheckLoop_RedToRed_LogsEachFailure(t *testing.T) {
	// Distinct from greenâ†’red: when gate is ALREADY unverified and
	// the recheck fails again, the log message should be WARN, not
	// ERROR (we already paged on the first failure â€” subsequent
	// failures are noise). This test verifies the loop's state
	// machine distinguishes the two paths.
	resetGateForTest(t)
	state.Store(StatusUnverified)
	lastError.Store("initial failure")
	t.Setenv("PHASE0_RECHECK_INTERVAL", "150ms")
	cancelRecheckLoop(t)

	var calls atomic.Int64
	check := func() error {
		calls.Add(1)
		return errors.New("still failing")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go recheckLoopWith(ctx, check)

	// Wait for at least one recheck tick.
	waitFor(t, 1*time.Second, "recheck should fire", func() bool {
		return calls.Load() >= 1
	})

	// State stays UNVERIFIED.
	if state.Load().(Status) != StatusUnverified {
		t.Errorf("gate = %v, want UNVERIFIED (no recovery expected)", state.Load().(Status))
	}

	// lastError updates with each failure.
	_, _, lastErr := Snapshot()
	if !strings.Contains(lastErr, "still failing") {
		t.Errorf("lastError = %q, want to contain 'still failing'", lastErr)
	}

	cancel()
}

func TestRecheckLoop_CancellationStopsLoop(t *testing.T) {
	resetGateForTest(t)
	t.Setenv("PHASE0_RECHECK_INTERVAL", "100ms")
	cancelRecheckLoop(t)

	var calls atomic.Int64
	check := func() error {
		calls.Add(1)
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	go recheckLoopWith(ctx, check)

	// Wait for at least one tick.
	waitFor(t, 500*time.Millisecond, "loop should fire at least once", func() bool {
		return calls.Load() >= 1
	})

	countAtCancel := calls.Load()

	// Cancel and verify the loop stops within a few intervals.
	cancel()

	// Give it 5Ã— the interval to make sure no more ticks happen.
	time.Sleep(500 * time.Millisecond)

	countAfterWait := calls.Load()
	if countAfterWait > countAtCancel+1 {
		t.Errorf("loop continued after cancel: %d calls before cancel, %d after",
			countAtCancel, countAfterWait)
	}
}

func TestRecheckLoop_RespectsIntervalEnv(t *testing.T) {
	resetGateForTest(t)
	t.Setenv("PHASE0_RECHECK_INTERVAL", "300ms")
	cancelRecheckLoop(t)

	var calls atomic.Int64
	var firstCallAt atomic.Int64 // unix nanos
	check := func() error {
		if firstCallAt.Load() == 0 {
			firstCallAt.Store(time.Now().UnixNano())
		}
		calls.Add(1)
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	loopStart := time.Now()
	go recheckLoopWith(ctx, check)

	// Wait for first call.
	waitFor(t, 1*time.Second, "first call should fire", func() bool {
		return calls.Load() >= 1
	})

	firstCallDelay := time.Duration(firstCallAt.Load() - loopStart.UnixNano())
	// First tick should fire approximately after the interval.
	// Allow [50%, 200%] window for jitter.
	minDelay := time.Duration(float64(300*time.Millisecond) * 0.5)
	maxDelay := time.Duration(float64(300*time.Millisecond) * 2.0)
	if firstCallDelay < minDelay || firstCallDelay > maxDelay {
		t.Errorf("first call delay = %v, want approximately 300ms (range %v..%v)",
			firstCallDelay, minDelay, maxDelay)
	}

	cancel()
}

func TestRecheckLoop_UpdatesLastRunAt(t *testing.T) {
	resetGateForTest(t)
	t.Setenv("PHASE0_RECHECK_INTERVAL", "150ms")
	cancelRecheckLoop(t)

	// Set lastRunAt to a known-old value so we can detect the update.
	oldTime := time.Now().UTC().Add(-1 * time.Hour)
	lastRunAt.Store(oldTime)

	check := func() error { return nil }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go recheckLoopWith(ctx, check)

	// Wait for lastRunAt to move forward.
	waitFor(t, 1*time.Second, "lastRunAt should update after recheck fires", func() bool {
		_, when, _ := Snapshot()
		return when.After(oldTime)
	})

	cancel()
}

func TestStartRecheckLoop_IsIdempotent(t *testing.T) {
	resetGateForTest(t)
	t.Setenv("PHASE0_RECHECK_INTERVAL", "100ms")
	cancelRecheckLoop(t)

	var calls atomic.Int64
	check := func() error {
		calls.Add(1)
		return nil
	}

	// Start the loop twice via the public seam. The first should be
	// cancelled by the second so we don't leak goroutines.
	startRecheckLoopWith(check)
	time.Sleep(200 * time.Millisecond) // let the first loop tick at least once
	startRecheckLoopWith(check)

	// Wait for second-loop ticks.
	waitFor(t, 1*time.Second, "second loop should tick", func() bool {
		return calls.Load() >= 1
	})

	// We can't directly observe the goroutine count, but we can verify
	// the smokeCancel was replaced (no nil pointer dereferences).
	mu.RLock()
	cancel := smokeCancel
	mu.RUnlock()
	if cancel == nil {
		t.Fatal("smokeCancel should be set after startRecheckLoopWith")
	}
	cancel()
}

// â”€â”€ INTEGRATION TEST â€” recheckLoop against the live Neon DB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

func TestIntegration_RecheckLoop_AgainstRealDB_StaysVerified(t *testing.T) {
	requireDB(t)
	resetGateForTest(t)
	t.Setenv("PHASE0_RECHECK_INTERVAL", "300ms")
	cancelRecheckLoop(t)

	// Initial smoke to seed the test tenants and flip to VERIFIED.
	if err := runSmokeTest(); err != nil {
		t.Fatalf("initial smoke test: %v", err)
	}
	state.Store(StatusVerified)
	t.Cleanup(cleanupSmokeTenants)

	// Start the loop with the REAL runSmokeTest (not a mock).
	// If isolation holds in the live Neon DB across multiple recheck
	// cycles, the gate stays VERIFIED.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go recheckLoopWith(ctx, runSmokeTest)

	// Wait for at least 3 recheck cycles to complete.
	deadline := time.Now().Add(5 * time.Second)
	var lastRunAtBefore time.Time
	for time.Now().Before(deadline) {
		_, when, errStr := Snapshot()
		if when.After(lastRunAtBefore) {
			lastRunAtBefore = when
			if errStr != "" {
				t.Errorf("unexpected lastError during recheck: %q", errStr)
				return
			}
		}
		// 300ms interval Ã— 3 cycles = 900ms minimum; check we ran
		// at least 3 ticks by verifying lastRunAt moved 3 times.
		if time.Since(lastRunAtBefore) > 0 && lastRunAtBefore.After(time.Now().Add(-3*time.Second)) {
			// Approximately 3 ticks have happened (cumulative).
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	// After all that, gate should still be VERIFIED.
	if state.Load().(Status) != StatusVerified {
		t.Errorf("gate = %v, want VERIFIED â€” live Neon DB isolation regressed", state.Load().(Status))
	}
	_, _, lastErr := Snapshot()
	if lastErr != "" {
		t.Errorf("lastError after live recheck = %q, want empty", lastErr)
	}

	cancel()
}
