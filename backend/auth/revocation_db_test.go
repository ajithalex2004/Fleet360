package auth

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Runs NewDBRevocationChecker against a real database when
// TENANT_TX_TEST_OWNER_URL (creates the table) and TENANT_TX_TEST_APP_URL
// (the runtime role, subject to row level security) are set.
func TestDBRevocationChecker(t *testing.T) {
	ownerURL, appURL := os.Getenv("TENANT_TX_TEST_OWNER_URL"), os.Getenv("TENANT_TX_TEST_APP_URL")
	if ownerURL == "" || appURL == "" {
		t.Skip("TENANT_TX_TEST_OWNER_URL / TENANT_TX_TEST_APP_URL not set")
	}
	owner, err := gorm.Open(postgres.Open(ownerURL), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	appUser := strings.SplitN(strings.TrimPrefix(appURL, "postgresql://"), ":", 2)[0]
	for _, stmt := range []string{
		`DROP TABLE IF EXISTS session_revocations`,
		`CREATE TABLE session_revocations (id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
		   user_id text, tenant_id text, not_before timestamptz NOT NULL, reason text NOT NULL,
		   revoked_by text, created_at timestamptz NOT NULL DEFAULT now())`,
		`ALTER TABLE session_revocations ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE session_revocations FORCE ROW LEVEL SECURITY`,
		`CREATE POLICY p ON session_revocations FOR ALL
		   USING (current_setting('app.tenant_id', true) = '*' OR tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true))
		   WITH CHECK (current_setting('app.tenant_id', true) = '*')`,
		`GRANT SELECT ON session_revocations TO ` + appUser,
	} {
		if err := owner.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	app, err := gorm.Open(postgres.Open(appURL), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	notBefore := NewDBRevocationChecker(app).NotBefore
	ctx := context.Background()

	t.Run("nothing revoked: zero time, no error", func(t *testing.T) {
		got, err := notBefore(ctx, "u1", "tA")
		if err != nil || !got.IsZero() {
			t.Fatalf("got %v, %v", got, err)
		}
	})

	cut := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	if err := owner.Exec(`SET app.tenant_id = '*'`).Error; err != nil {
		t.Fatal(err)
	}
	if err := owner.Exec(`INSERT INTO session_revocations (user_id, tenant_id, not_before, reason)
	    VALUES ('u1', 'tA', ?, 'role changed'), ('u2', 'tB', ?, 'other tenant')`, cut, cut.Add(time.Hour)).Error; err != nil {
		t.Fatal(err)
	}

	t.Run("revoked in the tenant: the revocation time", func(t *testing.T) {
		got, err := notBefore(ctx, "u1", "tA")
		if err != nil || !got.Equal(cut) {
			t.Fatalf("got %v, %v", got, err)
		}
	})

	t.Run("another tenant's revocation is not visible", func(t *testing.T) {
		got, err := notBefore(ctx, "u2", "tA")
		if err != nil || !got.IsZero() {
			t.Fatalf("got %v, %v", got, err)
		}
	})
}
