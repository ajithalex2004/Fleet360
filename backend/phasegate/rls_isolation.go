package phasegate

// Behavioural proof that POSTGRES ROW-LEVEL SECURITY isolates tenants.
//
// WHY THIS EXISTS SEPARATELY FROM testTenantIsolation
//
// testTenantIsolation asserts:
//
//	SELECT COUNT(*) FROM vehicles WHERE tenant_id = ? AND id = ?
//
// with tenant B's id. That returns 0 whether RLS is enabled, disabled, or
// absent — the WHERE clause does the excluding, not the policy. Its own comment
// claims "this assertion confirms the DB schema enforces it", which is not what
// the code does. It is a useful test of application scoping and is kept as
// exactly that; it is not evidence about RLS.
//
// The assertions here deliberately carry NO tenant predicate. They set
// app.tenant_id and then query by primary key alone, so the only thing that can
// exclude the row is the policy. If RLS is not enforced, these fail. That is
// the point: a test that passes with the feature turned off measures nothing.
//
// THE SIX VECTORS
//
//	1 self access         tenant A reads its own row               -> 1 row
//	2 cross-tenant read   tenant B reads A's row by id             -> 0 rows
//	3 cross-tenant update tenant B updates A's row by id           -> 0 affected
//	4 cross-tenant delete tenant B deletes A's row by id           -> 0 affected
//	5 cross-tenant insert tenant B writes a row tagged tenant A    -> rejected
//	                                                                 by WITH CHECK
//	6 no tenant context   app.tenant_id unset, read by id          -> 0 rows
//
// 3 and 4 matter because Postgres reports them as "0 rows affected" rather than
// an error. Application code that does not check the affected count will report
// success having changed nothing — a failure mode the switch to an enforcing
// role introduces, and one no SELECT-only test would reveal.
//
// 5 is the WITH CHECK vector. USING protects rows that already exist; only
// WITH CHECK constrains rows being written. A policy with a correct USING and
// an unconstrained WITH CHECK lets any tenant plant rows in another's account,
// and every read-side test still passes.
//
// 6 proves the boundary fails closed. Note the precise expectation: the
// connection stays open and healthy, and the result set is empty. An unset GUC
// is not an error condition in Postgres.
//
// EACH VECTOR RUNS IN ITS OWN TRANSACTION because set_config(..., true) is
// transaction-local — the same reason withTenantRls opens one per request. This
// mirrors production rather than approximating it.

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ErrRlsNotEnforceable is returned when the connected role holds BYPASSRLS or
// is a superuser. The RLS vectors cannot produce a meaningful result for such a
// role: every one of them would report a breach, but the cause would be the
// connection, not the policies.
//
// Distinguishing "cannot test" from "isolation is broken" is the whole reason
// this is a named error. Reporting the former as the latter would be its own
// kind of false signal.
var ErrRlsNotEnforceable = errors.New("connected role bypasses RLS: these assertions cannot measure isolation")

// RlsIsolationReport is what a run produced, so callers can log the evidence
// rather than just a pass/fail.
type RlsIsolationReport struct {
	Table      string
	Role       string
	Vectors    []string // human-readable, in execution order
	Assertions int      // how many actually executed
}

// asTenant runs fn inside one transaction with app.tenant_id set to tenant.
// Passing an empty string leaves the GUC unset, which is what vector 6 needs.
func asTenant(ctx context.Context, db *gorm.DB, tenant string, fn func(tx *gorm.DB) error) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if tenant != "" {
			if err := tx.Exec(`SELECT set_config('app.tenant_id', ?, true)`, tenant).Error; err != nil {
				return fmt.Errorf("set_config: %w", err)
			}
			// Confirm it took. A pooler that failed to pin the transaction, or
			// Prisma Accelerate, would silently drop this and every assertion
			// below would then be measuring the wrong thing.
			var got string
			if err := tx.Raw(`SELECT current_setting('app.tenant_id', true)`).Scan(&got).Error; err != nil {
				return fmt.Errorf("read back app.tenant_id: %w", err)
			}
			if got != tenant {
				return fmt.Errorf("app.tenant_id read back as %q, expected %q — the connection is not holding transaction-local settings", got, tenant)
			}
		}
		return fn(tx)
	})
}

// rlsEnforceable reports whether the current role is one for which RLS applies.
func rlsEnforceable(ctx context.Context, db *gorm.DB) (role string, enforceable bool, err error) {
	var row struct {
		CurrentUser string
		BypassRls   bool
		SuperUser   bool
	}
	e := db.WithContext(ctx).Raw(`
		SELECT current_user AS current_user,
		       COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypass_rls,
		       COALESCE((SELECT rolsuper     FROM pg_roles WHERE rolname = current_user), false) AS super_user
	`).Scan(&row).Error
	if e != nil {
		return "", false, e
	}
	return row.CurrentUser, !row.BypassRls && !row.SuperUser, nil
}

// insertFixtureSQL returns an INSERT that tags the row with the given tenant.
// Column sets match testTenantIsolation so both suites exercise the same shape.
func insertFixtureSQL(table string) (string, error) {
	switch table {
	case "vehicles":
		return `INSERT INTO vehicles (id, tenant_id, make, model, year, license_plate, vin, status, updated_at)
		        VALUES (gen_random_uuid(), ?, 'PHASE0', 'RLS', 2026, ?, ?, 'TEST', NOW())
		        RETURNING id`, nil
	case "drivers":
		return `INSERT INTO drivers (id, tenant_id, name, license_number, updated_at)
		        VALUES (gen_random_uuid(), ?, 'Phase0 RLS', ?, NOW())
		        RETURNING id`, nil
	case "garages":
		return `INSERT INTO garages (id, tenant_id, name, location, updated_at)
		        VALUES (gen_random_uuid(), ?, ?, 'Phase0 RLS Location', NOW())
		        RETURNING id`, nil
	default:
		return "", fmt.Errorf("unsupported table %q", table)
	}
}

func fixtureArgs(table string, tenant uuid.UUID, marker string) []any {
	switch table {
	case "vehicles":
		return []any{tenant, marker[:32], marker + "-VIN"}
	case "drivers":
		return []any{tenant, marker}
	case "garages":
		return []any{tenant, marker + "-Garage"}
	}
	return nil
}

// testRlsIsolation runs all six vectors against one table.
//
// Returns ErrRlsNotEnforceable if the role cannot enforce RLS, so a caller can
// report "not verified" instead of a spurious breach.
func testRlsIsolation(
	ctx context.Context,
	db *gorm.DB,
	tenantA, tenantB uuid.UUID,
	marker, table string,
) (*RlsIsolationReport, error) {
	role, ok, err := rlsEnforceable(ctx, db)
	if err != nil {
		return nil, fmt.Errorf("determining role capability: %w", err)
	}
	if !ok {
		return nil, fmt.Errorf("%w (role %q)", ErrRlsNotEnforceable, role)
	}

	insertSQL, err := insertFixtureSQL(table)
	if err != nil {
		return nil, err
	}
	rep := &RlsIsolationReport{Table: table, Role: role}
	a, b := tenantA.String(), tenantB.String()

	// ── Setup: tenant A writes its own row. This is itself vector 1's
	//    precondition and proves WITH CHECK ACCEPTS a correctly-tagged row —
	//    a policy that rejected everything would also pass vectors 2-6.
	var insertedID string
	if err := asTenant(ctx, db, a, func(tx *gorm.DB) error {
		return tx.Raw(insertSQL, fixtureArgs(table, tenantA, marker)...).Scan(&insertedID).Error
	}); err != nil {
		return nil, fmt.Errorf("vector 0 (tenant A inserts its own row): %w", err)
	}
	rep.Vectors = append(rep.Vectors, "0 own-tenant insert accepted by WITH CHECK")
	rep.Assertions++

	// Cleanup runs with the wildcard so it works whatever the vectors did.
	defer func() {
		_ = asTenant(ctx, db, "*", func(tx *gorm.DB) error {
			return tx.Exec(`DELETE FROM `+table+` WHERE id = ?`, insertedID).Error
		})
	}()

	// ── Vector 1: tenant A sees its own row. NO tenant predicate — the policy
	//    is what admits it.
	if err := asTenant(ctx, db, a, func(tx *gorm.DB) error {
		var n int64
		if err := tx.Raw(`SELECT COUNT(*) FROM `+table+` WHERE id = ?`, insertedID).Scan(&n).Error; err != nil {
			return err
		}
		if n != 1 {
			return fmt.Errorf("expected 1 row, got %d — the policy is denying the owning tenant", n)
		}
		return nil
	}); err != nil {
		return nil, fmt.Errorf("vector 1 (self access): %w", err)
	}
	rep.Vectors = append(rep.Vectors, "1 self access -> 1 row")
	rep.Assertions++

	// ── Vector 2: tenant B must not see it. Again NO tenant predicate: if this
	//    returns 1, RLS is not isolating, and no WHERE clause is hiding it.
	if err := asTenant(ctx, db, b, func(tx *gorm.DB) error {
		var n int64
		if err := tx.Raw(`SELECT COUNT(*) FROM `+table+` WHERE id = ?`, insertedID).Scan(&n).Error; err != nil {
			return err
		}
		if n != 0 {
			return fmt.Errorf("BREACH: tenant B sees %d row(s) of tenant A in %s by id alone", n, table)
		}
		return nil
	}); err != nil {
		return nil, fmt.Errorf("vector 2 (cross-tenant read): %w", err)
	}
	rep.Vectors = append(rep.Vectors, "2 cross-tenant read -> 0 rows")
	rep.Assertions++

	// ── Vector 3: cross-tenant UPDATE. Postgres reports 0 rows affected rather
	//    than raising, which is why this needs its own assertion.
	if err := asTenant(ctx, db, b, func(tx *gorm.DB) error {
		res := tx.Exec(`UPDATE `+table+` SET updated_at = NOW() WHERE id = ?`, insertedID)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 0 {
			return fmt.Errorf("BREACH: tenant B updated %d row(s) of tenant A in %s", res.RowsAffected, table)
		}
		return nil
	}); err != nil {
		return nil, fmt.Errorf("vector 3 (cross-tenant update): %w", err)
	}
	rep.Vectors = append(rep.Vectors, "3 cross-tenant update -> 0 affected")
	rep.Assertions++

	// ── Vector 4: cross-tenant DELETE, same silent-success shape.
	if err := asTenant(ctx, db, b, func(tx *gorm.DB) error {
		res := tx.Exec(`DELETE FROM `+table+` WHERE id = ?`, insertedID)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 0 {
			return fmt.Errorf("BREACH: tenant B deleted %d row(s) of tenant A in %s", res.RowsAffected, table)
		}
		return nil
	}); err != nil {
		return nil, fmt.Errorf("vector 4 (cross-tenant delete): %w", err)
	}
	rep.Vectors = append(rep.Vectors, "4 cross-tenant delete -> 0 affected")
	rep.Assertions++

	// ── Vector 5: WITH CHECK. Tenant B tries to plant a row tagged tenant A.
	//    Must be REJECTED, not merely invisible — an accepted row would let one
	//    tenant write into another's account while every read test still passes.
	//
	//    The transaction is expected to fail; asTenant returns that error, and
	//    the absence of an error is the failure here.
	// Must differ from the fixture marker WITHIN THE FIRST 32 CHARACTERS.
	// vehicles.license_plate is marker[:32] and is unique, so appending a
	// suffix would collide: the insert would be rejected by the unique
	// constraint (23505) rather than by the policy, and vector 5 would report
	// "rejected, but not by RLS" — failing for the wrong reason while looking
	// like a real finding.
	planted := "z" + marker[1:]
	err = asTenant(ctx, db, b, func(tx *gorm.DB) error {
		var id string
		return tx.Raw(insertSQL, fixtureArgs(table, tenantA, planted)...).Scan(&id).Error
	})
	if err == nil {
		// Remove the row that should never have existed. Targeted by the
		// planted marker — never by tenant_id, which would delete everything
		// the tenant owns.
		_ = deleteFixtureByMarker(ctx, db, table, planted)
		return nil, fmt.Errorf(
			"vector 5 (cross-tenant insert): BREACH: tenant B inserted a row tagged tenant A into %s — WITH CHECK is not constraining writes", table)
	}
	if !isPolicyViolation(err) {
		return nil, fmt.Errorf("vector 5 (cross-tenant insert): rejected, but not by a row-level security policy: %w", err)
	}
	rep.Vectors = append(rep.Vectors, "5 cross-tenant insert -> rejected by WITH CHECK")
	rep.Assertions++

	// ── Vector 6: no tenant context at all. Must fail closed — 0 rows, and the
	//    connection stays usable. An unset GUC is not an error in Postgres.
	if err := asTenant(ctx, db, "", func(tx *gorm.DB) error {
		var n int64
		if err := tx.Raw(`SELECT COUNT(*) FROM `+table+` WHERE id = ?`, insertedID).Scan(&n).Error; err != nil {
			return err
		}
		if n != 0 {
			return fmt.Errorf("BREACH: %d row(s) visible with no app.tenant_id set — the boundary does not fail closed", n)
		}
		return nil
	}); err != nil {
		return nil, fmt.Errorf("vector 6 (missing tenant context): %w", err)
	}
	rep.Vectors = append(rep.Vectors, "6 no tenant context -> 0 rows, fails closed")
	rep.Assertions++

	return rep, nil
}

// deleteFixtureByMarker removes a fixture row by the unique column the marker
// was written into, under the platform wildcard so it works regardless of which
// tenant the row ended up tagged with.
//
// Deliberately never deletes by tenant_id: a cleanup that removes everything a
// tenant owns is a worse outcome than the leak it is tidying up after.
func deleteFixtureByMarker(ctx context.Context, db *gorm.DB, table, marker string) error {
	var sql string
	var arg any
	switch table {
	case "vehicles":
		sql, arg = `DELETE FROM vehicles WHERE license_plate = ?`, marker[:min(32, len(marker))]
	case "drivers":
		sql, arg = `DELETE FROM drivers WHERE license_number = ?`, marker
	case "garages":
		sql, arg = `DELETE FROM garages WHERE name = ?`, marker+"-Garage"
	default:
		return fmt.Errorf("unsupported table %q", table)
	}
	return asTenant(ctx, db, "*", func(tx *gorm.DB) error {
		return tx.Exec(sql, arg).Error
	})
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// isPolicyViolation reports whether an error is Postgres rejecting a write for
// violating a row-level security policy (SQLSTATE 42501).
//
// Matched on the SQLSTATE and the policy wording rather than on the message
// alone, so an unrelated permission error is not mistaken for proof that the
// policy worked. Vector 5 must fail for the RIGHT reason.
func isPolicyViolation(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "42501") ||
		(strings.Contains(s, "row-level security") && strings.Contains(s, "violat")) ||
		strings.Contains(s, "new row violates row-level security policy")
}
