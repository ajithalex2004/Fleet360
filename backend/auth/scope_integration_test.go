package auth

import (
	"context"
	"database/sql"
	"errors"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"fleet360-backend/database"
)

// TestIntegration_AsTenant_DeterministicPooledConnectionIsolation proves that
// executing AsTenant sequentially across different tenants on the EXACT SAME
// physical database connection never bleeds session or tenant context,
// verifying both commit and rollback cleanup paths.
//
// In transaction pooler architectures (e.g. PgBouncer / Neon transaction pooler):
// - Application-connection reuse: Go's *sql.DB pool reuses client connections to the pooler.
// - PostgreSQL backend-session reuse: The pooler assigns backend server processes per transaction.
// Because AsTenant executes set_config('app.tenant_id', ?, true) with is_local=true,
// PostgreSQL strictly limits the GUC to that transaction scope.
// When the transaction commits or rolls back, PostgreSQL unsets the GUC immediately,
// ensuring the connection (and any subsequent transaction on that connection) is clean.
func TestIntegration_AsTenant_DeterministicPooledConnectionIsolation(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL not set; skipping integration test")
	}

	if database.DB == nil {
		database.Connect()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	sqlDB, err := database.DB.DB()
	if err != nil {
		t.Fatalf("get underlying sql.DB: %v", err)
	}

	// 1. PIN A SINGLE PHYSICAL CONNECTION from the pool
	// This guarantees that every query below executes on the EXACT SAME connection.
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		t.Fatalf("pin single physical connection: %v", err)
	}
	defer conn.Close()

	// Wrap the pinned connection in a dedicated GORM instance
	pinnedGorm, err := gorm.Open(postgres.New(postgres.Config{
		Conn: conn,
	}), &gorm.Config{})
	if err != nil {
		t.Fatalf("open gorm on pinned connection: %v", err)
	}

	tenantA := "tenant-alpha-" + time.Now().Format("150405.000000")
	tenantB := "tenant-bravo-" + time.Now().Format("150405.000000")

	gin.SetMode(gin.TestMode)

	// Helper to check current_setting on the pinned connection directly
	readSetting := func() (string, error) {
		var val sql.NullString
		row := conn.QueryRowContext(ctx, `SELECT current_setting('app.tenant_id', true)`)
		if err := row.Scan(&val); err != nil {
			return "", err
		}
		if !val.Valid {
			return "", nil
		}
		return val.String, nil
	}

	// Baseline check: pinned connection must start with empty GUC
	initialSetting, err := readSetting()
	if err != nil {
		t.Fatalf("baseline readSetting: %v", err)
	}
	if initialSetting != "" {
		t.Fatalf("pinned connection baseline app.tenant_id must be empty, got %q", initialSetting)
	}

	// --------------------------------------------------------------------------
	// STEP 1: Tenant A executes and COMMITS
	// --------------------------------------------------------------------------
	cA, _ := gin.CreateTestContext(httptest.NewRecorder())
	cA.Set(CtxTenantID, tenantA)

	err = AsTenant(cA, pinnedGorm, func(tx *gorm.DB) error {
		var inTx string
		if err := tx.Raw(`SELECT current_setting('app.tenant_id', true)`).Scan(&inTx).Error; err != nil {
			return err
		}
		if inTx != tenantA {
			t.Errorf("inside Tenant A tx: want %q, got %q", tenantA, inTx)
		}
		return nil // commit
	})
	if err != nil {
		t.Fatalf("AsTenant Tenant A commit: %v", err)
	}

	// Post-commit assertion on the SAME connection outside transaction:
	// GUC must be cleared (fails closed).
	afterCommitSetting, err := readSetting()
	if err != nil {
		t.Fatalf("readSetting after Tenant A commit: %v", err)
	}
	if afterCommitSetting != "" {
		t.Errorf("leak after commit: app.tenant_id still set to %q on pinned connection", afterCommitSetting)
	}

	// --------------------------------------------------------------------------
	// STEP 2: Tenant B executes on the SAME connection and ROLLS BACK
	// --------------------------------------------------------------------------
	cB, _ := gin.CreateTestContext(httptest.NewRecorder())
	cB.Set(CtxTenantID, tenantB)

	forcedErr := errors.New("simulated error forcing rollback")
	err = AsTenant(cB, pinnedGorm, func(tx *gorm.DB) error {
		var inTx string
		if err := tx.Raw(`SELECT current_setting('app.tenant_id', true)`).Scan(&inTx).Error; err != nil {
			return err
		}
		if inTx != tenantB {
			t.Errorf("inside Tenant B tx: want %q, got %q", tenantB, inTx)
		}
		return forcedErr // trigger rollback
	})
	if !errors.Is(err, forcedErr) {
		t.Fatalf("AsTenant Tenant B should return forced error, got: %v", err)
	}

	// Post-rollback assertion on the SAME connection outside transaction:
	// GUC must be cleared after rollback as well.
	afterRollbackSetting, err := readSetting()
	if err != nil {
		t.Fatalf("readSetting after Tenant B rollback: %v", err)
	}
	if afterRollbackSetting != "" {
		t.Errorf("leak after rollback: app.tenant_id still set to %q on pinned connection", afterRollbackSetting)
	}

	// --------------------------------------------------------------------------
	// STEP 3: Tenant A executes again on the SAME connection
	// --------------------------------------------------------------------------
	err = AsTenant(cA, pinnedGorm, func(tx *gorm.DB) error {
		var inTx string
		if err := tx.Raw(`SELECT current_setting('app.tenant_id', true)`).Scan(&inTx).Error; err != nil {
			return err
		}
		if inTx != tenantA {
			t.Errorf("inside Tenant A recheck tx: want %q, got %q (possible bleed from Tenant B)", tenantA, inTx)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("AsTenant Tenant A second execution: %v", err)
	}

	afterSecondCommit, err := readSetting()
	if err != nil {
		t.Fatalf("readSetting after second commit: %v", err)
	}
	if afterSecondCommit != "" {
		t.Errorf("leak after second commit: app.tenant_id still set to %q on pinned connection", afterSecondCommit)
	}

	// --------------------------------------------------------------------------
	// STEP 4: Fail-closed on missing tenant context
	// --------------------------------------------------------------------------
	cEmpty, _ := gin.CreateTestContext(httptest.NewRecorder())
	err = AsTenant(cEmpty, pinnedGorm, func(tx *gorm.DB) error {
		t.Fatal("fn must not be executed when tenant context is empty")
		return nil
	})
	if !errors.Is(err, gorm.ErrInvalidData) {
		t.Errorf("expected ErrInvalidData on empty context, got: %v", err)
	}
}
