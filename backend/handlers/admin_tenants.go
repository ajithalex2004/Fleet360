// admin_tenants.go — HTTP surface for the tenant admin API.
//
// Mounted at /api/v1/admin/tenants. All endpoints require:
//   - Valid JWT (handled by auth.Middleware)
//   - Caller's tenant_id == :tenantId OR caller role = SUPER_ADMIN
//   - audit event emitted for every state-changing call
package handlers

import (
	"net/http"

	"fleet360-backend/audit"
	"fleet360-backend/auth"
	"fleet360-backend/billing"
	"fleet360-backend/database"
	"fleet360-backend/featureflags"
	"fleet360-backend/tenants"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// adminResolver is the package-level feature-flag resolver used by
// admin handlers to invalidate cached flags after tenant lifecycle
// changes. Set via SetAdminResolver from main() during startup.
var adminResolver *featureflags.Resolver

// SetAdminResolver wires the feature-flag resolver into this package.
// Called once from main() during startup; admin handlers read it on
// every request.
func SetAdminResolver(r *featureflags.Resolver) {
	adminResolver = r
}

// createAdminHandler was used when admin handlers were methods on a
// struct receiver. Kept as a stub for callers that still reference it
// (none in current code, but the symbol may appear in older branches).
func createAdminHandler() *adminTenantHandlers { return nil }

// adminTenantHandlers is retained as a backward-compat alias for any
// external code that referenced the receiver type. All methods on it
// have been promoted to package-level functions below.
type adminTenantHandlers struct{}

// requireTenantAdmin ensures the caller is either the SUPER_ADMIN (across
// all tenants) or has the TENANT_ADMIN permission within the tenant
// they're targeting. Fails 403 otherwise.
func requireTenantAdmin(c *gin.Context, tenantID uuid.UUID) bool {
	role := auth.RoleCode(c)
	if role == "SUPER_ADMIN" {
		return true
	}
	callerTenant := auth.TenantID(c)
	if callerTenant != "" {
		tid, _ := uuid.Parse(callerTenant)
		if tid == tenantID && (role == "ADMIN" || role == "TENANT_ADMIN") {
			return true
		}
	}
	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "tenant admin role required"})
	return false
}

// CreateTenant handles POST /api/v1/admin/tenants — onboarding.
func CreateTenant(c *gin.Context) {
	if auth.RoleCode(c) != "SUPER_ADMIN" {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "super admin only"})
		return
	}
	var in tenants.CreateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	in.CreatedByUserID = uuid.MustParse(auth.UserID(c))

	id, err := tenants.Create(c.Request.Context(), in)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if adminResolver != nil { adminResolver.Invalidate(id) }
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

// GetTenant handles GET /api/v1/admin/tenants/:tenantId.
func GetTenant(c *gin.Context) {
	id, err := uuid.Parse(c.Param("tenantId"))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid tenant id"})
		return
	}
	if !requireTenantAdmin(c, id) {
		return
	}
	t, err := tenants.GetByID(c.Request.Context(), id, true)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "tenant not found"})
		return
	}
	c.JSON(http.StatusOK, t)
}

// UpdateTenant handles PATCH /api/v1/admin/tenants/:tenantId.
func UpdateTenant(c *gin.Context) {
	id, err := uuid.Parse(c.Param("tenantId"))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid tenant id"})
		return
	}
	if !requireTenantAdmin(c, id) {
		return
	}
	var fields map[string]any
	if err := c.ShouldBindJSON(&fields); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	actorID := uuid.MustParse(auth.UserID(c))
	if err := tenants.Update(c.Request.Context(), id, fields, actorID); err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if adminResolver != nil { adminResolver.Invalidate(id) }
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

// SuspendTenant handles POST /api/v1/admin/tenants/:tenantId/suspend.
func SuspendTenant(c *gin.Context) {
	id, err := uuid.Parse(c.Param("tenantId"))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid tenant id"})
		return
	}
	if !requireTenantAdmin(c, id) {
		return
	}
	actorID := uuid.MustParse(auth.UserID(c))
	var body struct {
		Reason string `json:"reason"`
	}
	c.ShouldBindJSON(&body)
	if err := tenants.Suspend(c.Request.Context(), id, actorID, body.Reason); err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if adminResolver != nil { adminResolver.Invalidate(id) }
	c.JSON(http.StatusOK, gin.H{"suspended": true})
}

// OffboardTenant handles POST /api/v1/admin/tenants/:tenantId/offboard.
func OffboardTenant(c *gin.Context) {
	id, err := uuid.Parse(c.Param("tenantId"))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid tenant id"})
		return
	}
	if auth.RoleCode(c) != "SUPER_ADMIN" {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "super admin only"})
		return
	}
	actorID := uuid.MustParse(auth.UserID(c))
	var body struct {
		Reason string `json:"reason"`
	}
	c.ShouldBindJSON(&body)
	offboardingID, err := tenants.RequestOffboarding(c.Request.Context(), tenants.OffboardingInput{
		TenantID:    id,
		RequestedBy: actorID,
		Reason:      body.Reason,
	})
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"offboardingId": offboardingID})
}

// ListAuditEvents handles GET /api/v1/admin/tenants/:tenantId/audit.
func ListAuditEvents(c *gin.Context) {
	id, err := uuid.Parse(c.Param("tenantId"))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid tenant id"})
		return
	}
	if !requireTenantAdmin(c, id) {
		return
	}
	events, err := audit.List(c.Request.Context(), audit.QueryFilter{
		TenantID: &id,
		Limit:    200,
	})
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"events": events})
}

// VerifyAuditChain handles POST /api/v1/admin/audit/verify.
// SUPER_ADMIN only. This is the "prove no tampering" endpoint.
func VerifyAuditChain(c *gin.Context) {
	if auth.RoleCode(c) != "SUPER_ADMIN" {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "super admin only"})
		return
	}
	broken, err := audit.VerifyChain(c.Request.Context())
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"brokenRows": broken, "ok": broken == 0})
}

// PlanInfo handles GET /api/v1/admin/tenants/:tenantId/plan.
func PlanInfo(c *gin.Context) {
	id, err := uuid.Parse(c.Param("tenantId"))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid tenant id"})
		return
	}
	if !requireTenantAdmin(c, id) {
		return
	}
	plan, err := billing.GetTenantPlan(c.Request.Context(), id)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, plan)
}

// ── Invitation endpoints ───────────────────────────────────────────────────────

// InviteUser handles POST /api/v1/admin/tenants/:tenantId/invitations.
func InviteUser(c *gin.Context) {
	id, err := uuid.Parse(c.Param("tenantId"))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid tenant id"})
		return
	}
	if !requireTenantAdmin(c, id) {
		return
	}
	var body struct {
		Email  string    `json:"email" binding:"required,email"`
		RoleID uuid.UUID `json:"roleId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	actorID := uuid.MustParse(auth.UserID(c))
	inv, err := tenants.CreateInvitation(c.Request.Context(), id, body.RoleID, body.Email, actorID, 0)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Return the token ONCE. Caller is responsible for emailing it.
	c.JSON(http.StatusCreated, gin.H{
		"id":        inv.ID,
		"email":     inv.Email,
		"token":     inv.Token,
		"expiresAt": inv.ExpiresAt,
	})
}

// ── helpers ───────────────────────────────────────────────────────────────────

var _ = database.DB
