package authz

import (
	"context"
	"os"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Runs against a real database when AUTHZ_TEST_DATABASE_URL is set (the
// app role, RLS in force): the recorder's row lands in audit_logs in the
// actor's tenant.
func TestDBRecorderWritesAuditLogs(t *testing.T) {
	url := os.Getenv("AUTHZ_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("AUTHZ_TEST_DATABASE_URL not set")
	}
	db, err := gorm.Open(postgres.Open(url), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	a := Action{
		TenantID: tenant, UserID: "user-db-test", Role: "SUPER_ADMIN", Method: "POST",
		Path: "/api/v1/admin/tenants/" + tenant + "/suspend", Route: "/api/v1/admin/tenants/:tenantId/suspend",
		TargetID: tenant, Status: 403, Decision: Decision{Reason: "missing-permission"}, Mode: ModeEnforce,
	}
	if err := NewDBRecorder(db).Record(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	var row struct{ Action, EntityName, Details string }
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT set_config('app.tenant_id', ?, true)`, tenant).Error; err != nil {
			return err
		}
		return tx.Raw(`SELECT action, entity_name, details FROM audit_logs WHERE user_id = 'user-db-test' ORDER BY created_at DESC LIMIT 1`).Scan(&row).Error
	})
	if err != nil {
		t.Fatal(err)
	}
	if row.Action != "DENIED" || row.EntityName != "POST /api/v1/admin/tenants/:tenantId/suspend" {
		t.Fatalf("row: %+v", row)
	}
}
