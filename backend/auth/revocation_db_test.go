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
		`DROP TABLE IF EXISTS public.revoked_session_tokens`,
		`CREATE TABLE session_revocations (id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
		   user_id text, tenant_id text, not_before timestamptz NOT NULL, reason text NOT NULL,
		   revoked_by text, created_at timestamptz NOT NULL DEFAULT now())`,
		`ALTER TABLE session_revocations ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE session_revocations FORCE ROW LEVEL SECURITY`,
		`CREATE POLICY p ON session_revocations FOR ALL
		   USING (current_setting('app.tenant_id', true) = '*' OR tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true))
		   WITH CHECK (current_setting('app.tenant_id', true) = '*')`,
		`GRANT SELECT ON session_revocations TO ` + appUser,
		`CREATE TABLE public.revoked_session_tokens (
		   token_key text PRIMARY KEY,
		   user_id text NOT NULL,
		   tenant_id text NOT NULL,
		   expires_at timestamptz NOT NULL,
		   revoked_at timestamptz NOT NULL DEFAULT now(),
		   reason text NOT NULL DEFAULT 'logout'
		 )`,
		`ALTER TABLE public.revoked_session_tokens ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE public.revoked_session_tokens FORCE ROW LEVEL SECURITY`,
		`CREATE POLICY revoked_session_tokens_tenant_select ON public.revoked_session_tokens FOR SELECT
		   USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true))`,
		`CREATE POLICY revoked_session_tokens_tenant_insert ON public.revoked_session_tokens FOR INSERT
		   WITH CHECK (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true))`,
		`CREATE POLICY revoked_session_tokens_tenant_update ON public.revoked_session_tokens FOR UPDATE
		   USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true))
		   WITH CHECK (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true))`,
		`CREATE POLICY revoked_session_tokens_tenant_delete ON public.revoked_session_tokens FOR DELETE
		   USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true))`,
		`CREATE POLICY revoked_session_tokens_platform_insert_only ON public.revoked_session_tokens AS RESTRICTIVE FOR INSERT
		   WITH CHECK (current_setting('app.tenant_id', true) = '*')`,
		`CREATE POLICY revoked_session_tokens_platform_update_only ON public.revoked_session_tokens AS RESTRICTIVE FOR UPDATE
		   USING (current_setting('app.tenant_id', true) = '*')
		   WITH CHECK (current_setting('app.tenant_id', true) = '*')`,
		`CREATE POLICY revoked_session_tokens_platform_delete_only ON public.revoked_session_tokens AS RESTRICTIVE FOR DELETE
		   USING (current_setting('app.tenant_id', true) = '*')`,
		`GRANT SELECT, INSERT, UPDATE, DELETE ON public.revoked_session_tokens TO ` + appUser,
	} {
		if err := owner.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	app, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  appURL,
		PreferSimpleProtocol: true,
	}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	checker := NewDBRevocationChecker(app)
	notBefore := checker.NotBefore
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
	if err := owner.Exec(`INSERT INTO public.revoked_session_tokens (token_key, user_id, tenant_id, expires_at, reason)
	    VALUES
	      ('sid:active-a', 'u1', 'tA', now() + interval '1 hour', 'logout:xl-session'),
	      ('sid:expired-a', 'u1', 'tA', now() - interval '1 minute', 'logout:xl-session'),
	      ('sid:active-b', 'u2', 'tB', now() + interval '1 hour', 'logout:xl-session')`).Error; err != nil {
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

	t.Run("per-token revocation: active row rejected, expired ignored, cross-tenant isolated", func(t *testing.T) {
		revoked, err := checker.IsTokenRevoked(ctx, "u1", "tA", "active-a", "hash-a", cut.Add(time.Hour))
		if err != nil || !revoked {
			t.Fatalf("active token in tA: got %v, %v; want true, nil", revoked, err)
		}
		revoked, err = checker.IsTokenRevoked(ctx, "u1", "tA", "expired-a", "hash-exp", cut.Add(time.Hour))
		if err != nil || revoked {
			t.Fatalf("expired token in tA: got %v, %v; want false, nil", revoked, err)
		}
		// Tenant A MUST NOT see Tenant B's token revocation under FORCE RLS.
		revoked, err = checker.IsTokenRevoked(ctx, "u2", "tA", "active-b", "hash-b", cut.Add(time.Hour))
		if err != nil || revoked {
			t.Fatalf("tenant B token queried under tA: got %v, %v; want false, nil", revoked, err)
		}
		// Tenant-scoped app connection MUST NOT be able to INSERT/DELETE revoked_session_tokens (restrictive platform-only guard).
		err = app.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Exec(`SELECT set_config('app.tenant_id', 'tA', true)`).Error; err != nil {
				return err
			}
			return tx.Exec(`INSERT INTO public.revoked_session_tokens (token_key, user_id, tenant_id, expires_at) VALUES ('sid:forged', 'u1', 'tA', now() + interval '1 hour')`).Error
		})
		if err == nil {
			t.Fatalf("tenant-scoped INSERT into revoked_session_tokens must be rejected by restrictive RLS policy")
		}
	})
}
