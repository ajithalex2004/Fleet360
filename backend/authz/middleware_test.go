package authz

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"fleet360-backend/auth"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type fakeRecorder struct{ actions []Action }

func (f *fakeRecorder) Record(_ context.Context, a Action) error {
	f.actions = append(f.actions, a)
	return nil
}

const tenant = "11111111-1111-4111-8111-111111111111"

// stepUp is the STEP_UP_MODE the test routers use (off unless a test sets it).
var stepUp = ModeOff

// claimFor builds a permission claim the way Next.js does, from the vectors.
func claimFor(t *testing.T, subjectID string) json.RawMessage {
	t.Helper()
	for _, s := range loadVectors(t).Subjects {
		if s.ID == subjectID {
			return s.Claim
		}
	}
	t.Fatalf("no subject %s", subjectID)
	return nil
}

// router mounts the Go routes the tests call behind a stub of auth.Middleware.
func router(claims *auth.Claims, mode Mode) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1", func(c *gin.Context) {
		if claims != nil {
			c.Set(auth.CtxClaims, claims)
		}
		c.Next()
	}, MiddlewareWith(Default(), func() Mode { return mode }, func() Mode { return stepUp }))
	ok := func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) }
	v1.GET("/fleet/vehicles", ok)
	v1.POST("/fleet/vehicles", ok)
	v1.POST("/logistics/shipments", ok)
	v1.POST("/logistics/rates/quote", ok)
	v1.PATCH("/admin/tenants/:tenantId", ok)
	v1.POST("/admin/tenants/:tenantId/invitations", func(c *gin.Context) { c.JSON(http.StatusCreated, gin.H{}) })
	v1.POST("/alerts/configs", ok)
	v1.POST("/admin/tenants/:tenantId/suspend", ok)
	return r
}

func call(r *gin.Engine, method, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader("{}"))
	req.Header.Set("User-Agent", "test-agent")
	r.ServeHTTP(w, req)
	return w
}

func staff(role, subjectID string, t *testing.T) *auth.Claims {
	c := &auth.Claims{TenantID: tenant, Role: role, Plan: "PRO", RegisteredClaims: jwt.RegisteredClaims{Subject: "user-1"}}
	if subjectID != "" {
		c.Perms = claimFor(t, subjectID)
	}
	return c
}

func TestEnforceAllowsAndDeniesByPermission(t *testing.T) {
	fleet := router(staff("FLEET_MANAGER", "fleet-manager", t), ModeEnforce)
	if w := call(fleet, "POST", "/api/v1/fleet/vehicles"); w.Code != 200 {
		t.Fatalf("fleet manager creating a vehicle: %d", w.Code)
	}
	w := call(fleet, "POST", "/api/v1/logistics/shipments")
	if w.Code != 403 || !strings.Contains(w.Body.String(), "missing-permission") {
		t.Fatalf("fleet manager creating a shipment: %d %s", w.Code, w.Body)
	}
	viewer := router(staff("VIEWER", "viewer", t), ModeEnforce)
	if w := call(viewer, "GET", "/api/v1/fleet/vehicles"); w.Code != 200 {
		t.Fatalf("viewer reading vehicles: %d", w.Code)
	}
	if w := call(viewer, "POST", "/api/v1/fleet/vehicles"); w.Code != 403 {
		t.Fatalf("viewer creating a vehicle: %d", w.Code)
	}
}

func TestEnforceDeniesTokensWithoutAClaimOrOutsideTheTenant(t *testing.T) {
	legacy := router(staff("FLEET_MANAGER", "", t), ModeEnforce)
	if w := call(legacy, "GET", "/api/v1/fleet/vehicles"); w.Code != 403 {
		t.Fatalf("token without a permission claim: %d", w.Code)
	}
	fleet := router(staff("FLEET_MANAGER", "fleet-manager", t), ModeEnforce)
	if w := call(fleet, "GET", "/api/v1/fleet/vehicles?tenantId=22222222-2222-4222-8222-222222222222"); w.Code != 403 {
		t.Fatalf("other tenant: %d", w.Code)
	}
	if w := call(router(nil, ModeEnforce), "GET", "/api/v1/fleet/vehicles"); w.Code != 401 {
		t.Fatalf("no claims: %d", w.Code)
	}
}

func TestShipperPortalTokenReachesOnlyTheRateQuote(t *testing.T) {
	shipper := router(staff("SHIPPER_PORTAL", "", t), ModeEnforce)
	if w := call(shipper, "POST", "/api/v1/logistics/rates/quote"); w.Code != 200 {
		t.Fatalf("rate quote: %d", w.Code)
	}
	if w := call(shipper, "POST", "/api/v1/logistics/shipments"); w.Code != 403 {
		t.Fatalf("shipment: %d", w.Code)
	}
}

func TestTenantAdminCannotRewriteItsOwnTenant(t *testing.T) {
	// Go used to let a tenant admin PATCH any column of its own tenant (plan,
	// modules); the admin route policy makes that platform-only, as in Next.js.
	admin := router(staff("TENANT_ADMIN", "tenant-admin", t), ModeEnforce)
	if w := call(admin, "PATCH", "/api/v1/admin/tenants/"+tenant); w.Code != 403 {
		t.Fatalf("tenant admin PATCH own tenant: %d", w.Code)
	}
	if w := call(admin, "POST", "/api/v1/admin/tenants/"+tenant+"/invitations"); w.Code != 201 {
		t.Fatalf("tenant admin invitation: %d", w.Code)
	}
}

func TestReportModeLetsThroughAndOffSkips(t *testing.T) {
	if w := call(router(staff("VIEWER", "viewer", t), ModeReport), "POST", "/api/v1/fleet/vehicles"); w.Code != 200 {
		t.Fatalf("report mode: %d", w.Code)
	}
	if w := call(router(staff("VIEWER", "viewer", t), ModeOff), "POST", "/api/v1/fleet/vehicles"); w.Code != 200 {
		t.Fatalf("off: %d", w.Code)
	}
}

func TestPrivilegedActionsAreRecorded(t *testing.T) {
	rec := &fakeRecorder{}
	SetRecorder(rec)
	defer SetRecorder(nil)

	admin := router(staff("TENANT_ADMIN", "tenant-admin", t), ModeEnforce)
	call(admin, "POST", "/api/v1/admin/tenants/"+tenant+"/invitations")                      // privileged, allowed
	call(admin, "PATCH", "/api/v1/admin/tenants/"+tenant)                                    // privileged, denied
	call(admin, "POST", "/api/v1/fleet/vehicles")                                            // not privileged
	call(router(staff("VIEWER", "viewer", t), ModeReport), "POST", "/api/v1/alerts/configs") // would deny

	if len(rec.actions) != 3 {
		t.Fatalf("recorded %d actions, want 3: %+v", len(rec.actions), rec.actions)
	}
	created := AuditRow(rec.actions[0])
	if created.Action != "CREATE" || created.EntityType != "AdminAction" || created.EntityID != tenant ||
		created.EntityName != "POST /api/v1/admin/tenants/:tenantId/invitations" || created.UserID != "user-1" ||
		created.UserRole != "TENANT_ADMIN" || created.TenantID != tenant || created.UserAgent != "test-agent" ||
		created.Details != "POST /api/v1/admin/tenants/"+tenant+"/invitations: ok 201 (go backend)" {
		t.Errorf("allowed action row: %+v", created)
	}
	denied := AuditRow(rec.actions[1])
	if denied.Action != "DENIED" || !strings.Contains(denied.Details, "refused 403; policy denied admin-level:platform") {
		t.Errorf("denied action row: %+v", denied)
	}
	report := AuditRow(rec.actions[2])
	if report.Action != "CREATE" || !strings.Contains(report.Details, "ok 200; policy would deny tenant-admin-only") {
		t.Errorf("report-mode row: %+v", report)
	}
}

func TestModeAndPath(t *testing.T) {
	for in, want := range map[string]Mode{"": ModeReport, "ENFORCE": ModeEnforce, " off ": ModeOff, "x": ModeReport} {
		if got := ModeFrom(in); got != want {
			t.Errorf("ModeFrom(%q) = %s", in, got)
		}
	}
	if PublicPath("/api/v1/fleet/vehicles") != "/api/fleet/vehicles" || PublicPath("/healthz") != "/healthz" {
		t.Error("PublicPath")
	}
}

func TestInvalidPrivilegedRequestsAreNotRecorded(t *testing.T) {
	rec := &fakeRecorder{}
	SetRecorder(rec)
	defer SetRecorder(nil)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	claims := staff("SUPER_ADMIN", "super-admin", t)
	v1 := r.Group("/api/v1", func(c *gin.Context) { c.Set(auth.CtxClaims, claims); c.Next() },
		MiddlewareWith(Default(), func() Mode { return ModeEnforce }, func() Mode { return ModeOff }))
	status := http.StatusBadRequest
	v1.POST("/admin/tenants", func(c *gin.Context) { c.JSON(status, gin.H{}) })
	for _, s := range []int{400, 404, 409} {
		status = s
		call(r, "POST", "/api/v1/admin/tenants")
	}
	if len(rec.actions) != 0 {
		t.Fatalf("invalid requests recorded: %+v", rec.actions)
	}
	status = http.StatusInternalServerError
	call(r, "POST", "/api/v1/admin/tenants")
	if len(rec.actions) != 1 || AuditRow(rec.actions[0]).Action != "FAILED" {
		t.Fatalf("server error not recorded as FAILED: %+v", rec.actions)
	}
}

func TestStepUpActionsAreRefusedInGo(t *testing.T) {
	rec := &fakeRecorder{}
	SetRecorder(rec)
	defer func() { SetRecorder(nil); stepUp = ModeOff }()

	stepUp = ModeEnforce
	admin := router(staff("TENANT_ADMIN", "tenant-admin", t), ModeEnforce)
	w := call(admin, "POST", "/api/v1/admin/tenants/"+tenant+"/invitations")
	if w.Code != 403 || !strings.Contains(w.Body.String(), "step_up_required") {
		t.Fatalf("invitation without step-up: %d %s", w.Code, w.Body)
	}
	if len(rec.actions) != 1 || AuditRow(rec.actions[0]).Action != "DENIED" || !strings.Contains(AuditRow(rec.actions[0]).Details, "step-up-required") {
		t.Fatalf("step-up refusal not recorded: %+v", rec.actions)
	}
	// Reads and actions outside the list are unaffected.
	if w := call(router(staff("FLEET_MANAGER", "fleet-manager", t), ModeEnforce), "POST", "/api/v1/fleet/vehicles"); w.Code != 200 {
		t.Fatalf("fleet write with step-up enforce: %d", w.Code)
	}
	stepUp = ModeReport
	if w := call(admin, "POST", "/api/v1/admin/tenants/"+tenant+"/invitations"); w.Code != 201 {
		t.Fatalf("report mode: %d", w.Code)
	}
	if StepUpModeFrom("") != ModeEnforce || StepUpModeFrom("report") != ModeReport || StepUpModeFrom("OFF") != ModeOff {
		t.Error("StepUpModeFrom")
	}
}

func TestAuthzOffStillRefusesStepUpActions(t *testing.T) {
	defer func() { stepUp = ModeOff }()
	stepUp = ModeEnforce
	if w := call(router(staff("SUPER_ADMIN", "super-admin", t), ModeOff), "POST", "/api/v1/admin/tenants/"+tenant+"/suspend"); w.Code != 403 {
		t.Fatalf("suspend with AUTHZ_MODE=off, STEP_UP_MODE=enforce: %d", w.Code)
	}
}
