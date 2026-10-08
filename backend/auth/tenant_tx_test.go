package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Runs against a real database when TENANT_TX_TEST_OWNER_URL (to create a
// FORCE RLS table) and TENANT_TX_TEST_APP_URL (a non-owner, non-superuser
// role, as the application connects) are set.
func tenantTxDBs(t *testing.T) (*gorm.DB, *gorm.DB) {
	t.Helper()
	ownerURL, appURL := os.Getenv("TENANT_TX_TEST_OWNER_URL"), os.Getenv("TENANT_TX_TEST_APP_URL")
	if ownerURL == "" || appURL == "" {
		t.Skip("TENANT_TX_TEST_OWNER_URL / TENANT_TX_TEST_APP_URL not set")
	}
	owner, err := gorm.Open(postgres.Open(ownerURL), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`DROP TABLE IF EXISTS tenant_tx_probe`,
		`CREATE TABLE tenant_tx_probe (id serial PRIMARY KEY, tenant_id text NOT NULL, note text UNIQUE)`,
		`ALTER TABLE tenant_tx_probe ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE tenant_tx_probe FORCE ROW LEVEL SECURITY`,
		`CREATE POLICY p ON tenant_tx_probe USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`,
		`INSERT INTO tenant_tx_probe (tenant_id, note) VALUES ('A', 'a-seed'), ('B', 'b-seed')`,
	} {
		if err := owner.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	appUser := strings.SplitN(strings.TrimPrefix(appURL, "postgresql://"), ":", 2)[0]
	owner.Exec(`GRANT SELECT, INSERT, UPDATE ON tenant_tx_probe TO ` + appUser)
	owner.Exec(`GRANT USAGE ON SEQUENCE tenant_tx_probe_id_seq TO ` + appUser)
	app, err := gorm.Open(postgres.Open(appURL), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	return owner, app
}

func tenantRouter(app *gorm.DB, tenant string, handler gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(func(c *gin.Context) {
		if tenant != "" {
			c.Set(CtxTenantID, tenant)
		}
		c.Next()
	}, tenantTxWith(func() *gorm.DB { return app }))
	r.POST("/x", handler)
	return r
}

func serve(r *gin.Engine) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("POST", "/x", nil))
	return w
}

func countNotes(owner *gorm.DB, note string) int64 {
	var n int64
	owner.Raw(`SELECT count(*) FROM tenant_tx_probe WHERE note = ?`, note).Scan(&n)
	return n
}

func TestTenantTx(t *testing.T) {
	owner, app := tenantTxDBs(t)

	t.Run("sees and writes only the caller's tenant, committed before the response", func(t *testing.T) {
		var seen []string
		w := serve(tenantRouter(app, "A", func(c *gin.Context) {
			TenantDB(c).Raw(`SELECT note FROM tenant_tx_probe ORDER BY note`).Scan(&seen)
			if err := TenantDB(c).Exec(`INSERT INTO tenant_tx_probe (tenant_id, note) VALUES ('A', 'a-1')`).Error; err != nil {
				c.JSON(500, gin.H{"error": err.Error()})
				return
			}
			c.JSON(201, gin.H{"ok": true})
		}))
		if w.Code != 201 || len(seen) != 1 || seen[0] != "a-seed" || countNotes(owner, "a-1") != 1 {
			t.Fatalf("status %d, seen %v, committed %d", w.Code, seen, countNotes(owner, "a-1"))
		}
	})

	t.Run("cannot write another tenant's row", func(t *testing.T) {
		w := serve(tenantRouter(app, "A", func(c *gin.Context) {
			if err := TenantDB(c).Exec(`INSERT INTO tenant_tx_probe (tenant_id, note) VALUES ('B', 'b-bad')`).Error; err != nil {
				c.JSON(403, gin.H{"error": "refused"})
				return
			}
			c.JSON(201, gin.H{})
		}))
		if w.Code != 403 || countNotes(owner, "b-bad") != 0 {
			t.Fatalf("status %d, inserted %d", w.Code, countNotes(owner, "b-bad"))
		}
	})

	t.Run("an error answer rolls back", func(t *testing.T) {
		serve(tenantRouter(app, "A", func(c *gin.Context) {
			TenantDB(c).Exec(`INSERT INTO tenant_tx_probe (tenant_id, note) VALUES ('A', 'a-4xx')`)
			c.JSON(422, gin.H{})
		}))
		if countNotes(owner, "a-4xx") != 0 {
			t.Fatal("4xx did not roll back")
		}
	})

	t.Run("a server error rolls back", func(t *testing.T) {
		serve(tenantRouter(app, "A", func(c *gin.Context) {
			TenantDB(c).Exec(`INSERT INTO tenant_tx_probe (tenant_id, note) VALUES ('A', 'a-rolled-back')`)
			c.JSON(500, gin.H{})
		}))
		if countNotes(owner, "a-rolled-back") != 0 {
			t.Fatal("5xx did not roll back")
		}
	})

	t.Run("a panic rolls back and the recovery 500 still reaches the client", func(t *testing.T) {
		w := serve(tenantRouter(app, "A", func(c *gin.Context) {
			TenantDB(c).Exec(`INSERT INTO tenant_tx_probe (tenant_id, note) VALUES ('A', 'a-panic')`)
			panic("boom")
		}))
		if w.Code != 500 || countNotes(owner, "a-panic") != 0 {
			t.Fatalf("status %d, inserted %d", w.Code, countNotes(owner, "a-panic"))
		}
	})

	t.Run("Try runs on the request transaction: no second connection", func(t *testing.T) {
		// One pool connection, held by the request transaction once it begins.
		// Try (a savepoint on that transaction) still works; AsTenant, which
		// opens its own transaction, would need a second connection and wait.
		sqlDB, err := app.DB()
		if err != nil {
			t.Fatal(err)
		}
		sqlDB.SetMaxOpenConns(1)
		defer sqlDB.SetMaxOpenConns(0)
		var seen []string
		var asTenantErr error
		w := serve(tenantRouter(app, "A", func(c *gin.Context) {
			if err := TenantDB(c).Exec(`INSERT INTO tenant_tx_probe (tenant_id, note) VALUES ('A', 'a-one-conn')`).Error; err != nil {
				c.JSON(500, gin.H{"error": err.Error()})
				return
			}
			if err := Try(c, func(tx *gorm.DB) error {
				return tx.Raw(`SELECT note FROM tenant_tx_probe ORDER BY note`).Scan(&seen).Error
			}); err != nil {
				c.JSON(500, gin.H{"error": err.Error()})
				return
			}
			// The old pattern: a second transaction on the pool cannot get a
			// connection while the request holds the only one.
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			asTenantErr = AsTenant(c, app.WithContext(ctx), func(tx *gorm.DB) error { return nil })
			c.JSON(201, gin.H{})
		}))
		if asTenantErr == nil {
			t.Fatal("AsTenant got a second connection; expected it to wait for the request's")
		}
		// The savepoint sees the request's own uncommitted insert, only tenant
		// A's rows, and the write is committed with the response.
		if w.Code != 201 || !contains(seen, "a-one-conn") || contains(seen, "b-seed") || countNotes(owner, "a-one-conn") != 1 {
			t.Fatalf("status %d, seen %v, committed %d", w.Code, seen, countNotes(owner, "a-one-conn"))
		}
	})

	t.Run("Try keeps the transaction usable after a failed statement", func(t *testing.T) {
		w := serve(tenantRouter(app, "A", func(c *gin.Context) {
			// Duplicate note: fails, rolled back to the savepoint.
			_ = Try(c, func(tx *gorm.DB) error {
				return tx.Exec(`INSERT INTO tenant_tx_probe (tenant_id, note) VALUES ('A', 'a-seed')`).Error
			})
			if err := TenantDB(c).Exec(`INSERT INTO tenant_tx_probe (tenant_id, note) VALUES ('A', 'a-after-try')`).Error; err != nil {
				c.JSON(500, gin.H{"error": err.Error()})
				return
			}
			c.JSON(200, gin.H{})
		}))
		if w.Code != 200 || countNotes(owner, "a-after-try") != 1 {
			t.Fatalf("status %d body %s, inserted %d", w.Code, w.Body, countNotes(owner, "a-after-try"))
		}
	})

	t.Run("a failed commit answers 500, not the handler's success", func(t *testing.T) {
		w := serve(tenantRouter(app, "A", func(c *gin.Context) {
			// An unguarded failing statement aborts the transaction; the commit then fails.
			TenantDB(c).Exec(`INSERT INTO tenant_tx_probe (tenant_id, note) VALUES ('A', 'a-seed')`)
			c.JSON(201, gin.H{"ok": true})
		}))
		if w.Code != http.StatusInternalServerError || strings.Contains(w.Body.String(), `"ok"`) {
			t.Fatalf("status %d body %s", w.Code, w.Body)
		}
	})

	t.Run("without a tenant, queries fail instead of running unscoped", func(t *testing.T) {
		var errSeen error
		serve(tenantRouter(app, "", func(c *gin.Context) {
			var n int64
			errSeen = TenantDB(c).Raw(`SELECT count(*) FROM tenant_tx_probe`).Scan(&n).Error
			c.JSON(200, gin.H{})
		}))
		if errSeen == nil {
			t.Fatal("query without a tenant ran")
		}
	})
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}
