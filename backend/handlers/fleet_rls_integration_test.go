package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Architecture audit A6: CreateVehicle wrote through the bare pool
// (database.DB), outside any transaction with app.tenant_id set, so under
// FORCE ROW LEVEL SECURITY and the restricted application role the insert
// was refused. The fleet group now runs under auth.TenantTx and the handlers
// use auth.TenantDB.
//
// Runs against a real PostgreSQL when FLEET_RLS_TEST_OWNER_URL (a role that
// may create tables) and FLEET_RLS_TEST_APP_URL (a non-owner, non-superuser
// role without BYPASSRLS, as the application connects) are set. It works in
// its own schema, fleet_rls_probe, which it drops and recreates.
const probeSchema = "fleet_rls_probe"

func fleetRLSDBs(t *testing.T) (owner, app *gorm.DB) {
	t.Helper()
	ownerURL, appURL := os.Getenv("FLEET_RLS_TEST_OWNER_URL"), os.Getenv("FLEET_RLS_TEST_APP_URL")
	if ownerURL == "" || appURL == "" {
		t.Skip("FLEET_RLS_TEST_OWNER_URL / FLEET_RLS_TEST_APP_URL not set")
	}
	withPath := func(u string) string {
		sep := "?"
		if strings.Contains(u, "?") {
			sep = "&"
		}
		return u + sep + "search_path=" + probeSchema
	}
	var err error
	if owner, err = gorm.Open(postgres.Open(withPath(ownerURL)), &gorm.Config{}); err != nil {
		t.Fatal(err)
	}
	appUser := strings.SplitN(strings.TrimPrefix(strings.TrimPrefix(appURL, "postgresql://"), "postgres://"), ":", 2)[0]
	for _, stmt := range []string{
		`DROP SCHEMA IF EXISTS ` + probeSchema + ` CASCADE`,
		`CREATE SCHEMA ` + probeSchema,
	} {
		if err := owner.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := owner.AutoMigrate(&models.Vehicle{}); err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE vehicles FORCE ROW LEVEL SECURITY`,
		`CREATE POLICY tenant_isolation ON vehicles
		   USING (tenant_id = current_setting('app.tenant_id', true))
		   WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`,
		`GRANT USAGE ON SCHEMA ` + probeSchema + ` TO ` + appUser,
		`GRANT SELECT, INSERT, UPDATE, DELETE ON vehicles TO ` + appUser,
	} {
		if err := owner.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { owner.Exec(`DROP SCHEMA IF EXISTS ` + probeSchema + ` CASCADE`) })
	if app, err = gorm.Open(postgres.Open(withPath(appURL)), &gorm.Config{}); err != nil {
		t.Fatal(err)
	}
	return owner, app
}

// fleetRouter mounts the fleet handlers as main.go does: TenantTx after the
// (here simulated) auth middleware that sets the caller's tenant.
func fleetRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery(), func(c *gin.Context) {
		if tid := c.GetHeader("X-Test-Tenant"); tid != "" {
			c.Set(auth.CtxTenantID, tid)
		}
		c.Next()
	})
	fleet := r.Group("/api/v1/fleet", auth.TenantTx())
	fleet.GET("/vehicles", GetVehicles)
	fleet.GET("/vehicles/:id", GetVehicle)
	fleet.POST("/vehicles", CreateVehicle)
	fleet.PATCH("/vehicles/:id", UpdateVehicle)
	return r
}

func call(r *gin.Engine, method, path, tenant, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-Tenant", tenant)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestFleetVehicles_RestrictedRoleUnderRLS(t *testing.T) {
	owner, app := fleetRLSDBs(t)
	prev := database.DB
	database.DB = app
	t.Cleanup(func() { database.DB = prev })

	// The defect: a write on the bare pool has no app.tenant_id and is refused.
	bare := app.Create(&models.Vehicle{TenantID: "tenant-a", LicensePlate: "BARE-1", VIN: "VIN-BARE-1"})
	if bare.Error == nil || !strings.Contains(bare.Error.Error(), "row-level security") {
		t.Fatalf("expected the bare-pool insert to be refused by RLS, got %v", bare.Error)
	}

	r := fleetRouter()

	w := call(r, http.MethodPost, "/api/v1/fleet/vehicles", "tenant-a", `{"make":"Toyota","model":"Coaster","licensePlate":"A-100","vin":"VIN-A-100","tenantId":"tenant-b"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("create as tenant-a: %d %s", w.Code, w.Body.String())
	}
	var created models.Vehicle
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil || created.ID == "" {
		t.Fatalf("created body: %v %s", err, w.Body.String())
	}

	// Committed, and owned by the token's tenant, not the body's.
	var stored struct{ TenantID string }
	owner.Raw(`SELECT tenant_id FROM vehicles WHERE id = ?`, created.ID).Scan(&stored)
	if stored.TenantID != "tenant-a" {
		t.Fatalf("stored tenant = %q, want tenant-a", stored.TenantID)
	}

	// The owner tenant reads it; another tenant does not.
	var list []models.Vehicle
	w = call(r, http.MethodGet, "/api/v1/fleet/vehicles", "tenant-a", "")
	_ = json.Unmarshal(w.Body.Bytes(), &list)
	if w.Code != http.StatusOK || len(list) != 1 {
		t.Fatalf("tenant-a list: %d %s", w.Code, w.Body.String())
	}
	w = call(r, http.MethodGet, "/api/v1/fleet/vehicles", "tenant-b", "")
	list = nil
	_ = json.Unmarshal(w.Body.Bytes(), &list)
	if w.Code != http.StatusOK || len(list) != 0 {
		t.Fatalf("tenant-b must not see tenant-a's vehicle: %d %s", w.Code, w.Body.String())
	}
	if w = call(r, http.MethodGet, "/api/v1/fleet/vehicles/"+created.ID, "tenant-b", ""); w.Code != http.StatusNotFound {
		t.Fatalf("tenant-b get by id: %d %s", w.Code, w.Body.String())
	}

	// Another tenant cannot update it; the owner can.
	if w = call(r, http.MethodPatch, "/api/v1/fleet/vehicles/"+created.ID, "tenant-b", `{"status":"Retired"}`); w.Code != http.StatusNotFound {
		t.Fatalf("tenant-b update: %d %s", w.Code, w.Body.String())
	}
	if w = call(r, http.MethodPatch, "/api/v1/fleet/vehicles/"+created.ID, "tenant-a", `{"status":"Maintenance"}`); w.Code != http.StatusOK {
		t.Fatalf("tenant-a update: %d %s", w.Code, w.Body.String())
	}

	// A refused create (duplicate plate) answers an error and commits nothing.
	if w = call(r, http.MethodPost, "/api/v1/fleet/vehicles", "tenant-a", `{"licensePlate":"A-100","vin":"VIN-OTHER"}`); w.Code != http.StatusConflict {
		t.Fatalf("duplicate plate: %d %s", w.Code, w.Body.String())
	}
	var n int64
	owner.Raw(`SELECT count(*) FROM vehicles`).Scan(&n)
	if n != 1 {
		t.Fatalf("vehicles after refused create = %d, want 1", n)
	}

	// No tenant in the request: refused before touching the database.
	if w = call(r, http.MethodPost, "/api/v1/fleet/vehicles", "", `{"licensePlate":"X"}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("no tenant: %d %s", w.Code, w.Body.String())
	}
}
