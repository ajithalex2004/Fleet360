package phasegate

// Tests for the six RLS vectors.
//
// These are the assertions that actually measure row-level security, as opposed
// to TestIntegration_TestTenantIsolation_* which measures application WHERE
// clauses. Both are worth having; only these say anything about the policies.
//
// They will FAIL under a role holding BYPASSRLS — deliberately. Rather than
// reporting that as a breach, testRlsIsolation returns ErrRlsNotEnforceable and
// the tests below surface it as an explicit "cannot verify", because
// "isolation is broken" and "this connection cannot measure isolation" are
// different statements and conflating them is how a suite ends up lying.
//
// In CI they cannot be skipped: TestMain's preflight already rejects a
// BYPASSRLS role before any test runs, so ErrRlsNotEnforceable is unreachable
// there and PHASE0_REQUIRE_DB=1 turns it into a hard failure if it somehow is.

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"fleet360-backend/database"
)

func runRlsVectors(t *testing.T, table string) {
	t.Helper()
	requireDB(t)
	resetGateForTest(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := database.DB.WithContext(ctx)

	pair, err := ensureTestTenants(ctx, db)
	if err != nil {
		t.Fatalf("ensureTestTenants: %v", err)
	}
	t.Cleanup(cleanupSmokeTenants)

	marker := uniqueMarker(t)
	rep, err := testRlsIsolation(ctx, db, pair.A, pair.B, marker, table)

	if errors.Is(err, ErrRlsNotEnforceable) {
		if os.Getenv("PHASE0_REQUIRE_DB") == "1" {
			t.Fatalf("RLS is not enforceable for this connection, and required mode forbids skipping: %v", err)
		}
		t.Skipf("cannot verify RLS on this connection: %v", err)
	}
	if err != nil {
		t.Fatalf("RLS isolation failed on %s: %v", table, err)
	}

	// Every vector counts toward the run-level assertion floor, so a suite that
	// silently stops executing them fails rather than reporting green.
	crossTenantAssertions.Add(int64(rep.Assertions))

	t.Logf("RLS verified on %s as role %q (%d assertions)", rep.Table, rep.Role, rep.Assertions)
	for _, v := range rep.Vectors {
		t.Logf("    %s", v)
	}
}

func TestIntegration_RlsIsolation_Vehicles(t *testing.T) { runRlsVectors(t, "vehicles") }
func TestIntegration_RlsIsolation_Drivers(t *testing.T)  { runRlsVectors(t, "drivers") }
func TestIntegration_RlsIsolation_Garages(t *testing.T)  { runRlsVectors(t, "garages") }

// TestIntegration_RlsIsolation_RoleIsEnforcing states the precondition on its
// own, so a run makes it explicit which role produced the evidence rather than
// leaving it implicit in the other tests' setup.
func TestIntegration_RlsIsolation_RoleIsEnforcing(t *testing.T) {
	requireDB(t)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	role, enforceable, err := rlsEnforceable(ctx, database.DB)
	if err != nil {
		t.Fatalf("querying role capability: %v", err)
	}
	t.Logf("connected_role = %s   rls_enforceable = %v", role, enforceable)

	if !enforceable {
		if os.Getenv("PHASE0_REQUIRE_DB") == "1" {
			t.Fatalf("role %q bypasses RLS — the isolation evidence from this run would be meaningless", role)
		}
		t.Skipf("role %q bypasses RLS; run against fleet360_app to verify", role)
	}
}

// ── Unit test, no database required ─────────────────────────────────────────

// TestIsPolicyViolation pins vector 5's accept/reject boundary.
//
// Vector 5 passes only when the INSERT is rejected BY A POLICY. If any error
// counted, an unrelated failure — a missing column, a dead connection — would
// read as proof that WITH CHECK works, which is the exact false-assurance shape
// this whole suite exists to remove.
func TestIsPolicyViolation(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil is not a violation", nil, false},
		{"sqlstate 42501", errors.New(`ERROR: permission denied (SQLSTATE 42501)`), true},
		{"pg wording", errors.New(`ERROR: new row violates row-level security policy for table "vehicles"`), true},
		{"generic violation wording", errors.New(`row-level security policy violated`), true},
		{"missing column is NOT a policy violation", errors.New(`ERROR: column "nope" does not exist (SQLSTATE 42703)`), false},
		{"connection failure is NOT a policy violation", errors.New(`dial tcp: connection refused`), false},
		{"not-null violation is NOT a policy violation", errors.New(`ERROR: null value in column "tenant_id" (SQLSTATE 23502)`), false},
		{"unique violation is NOT a policy violation", errors.New(`ERROR: duplicate key value (SQLSTATE 23505)`), false},
	}
	for _, c := range cases {
		if got := isPolicyViolation(c.err); got != c.want {
			t.Errorf("%s: isPolicyViolation(%v) = %v, want %v", c.name, c.err, got, c.want)
		}
	}
}
