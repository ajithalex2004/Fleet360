package handlers

// scim_handlers.go — SCIM 2.0 user endpoints.
//
// These are intentionally thin: the auth middleware (scim.AuthMiddleware)
// has already validated the bearer token and set "scim.tenant_id" in
// the gin context. The handlers themselves do parse → persist → audit.
//
// SKELETON: real implementation should use elimitycom/scim for
// RFC 7644-compliant request/response shapes, plus filter parsing
// (?filter=userName eq "x").

import (
	"net/http"

	"fleet360-backend/audit"
	"fleet360-backend/scim"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func SCIMCreateUser(c *gin.Context) {
	tenantID := c.MustGet("scim.tenant_id").(uuid.UUID)
	var u scim.User
	if err := c.ShouldBindJSON(&u); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if u.UserName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "userName required"})
		return
	}
	// SKELETON: persist via Prisma. Return the canonical SCIM representation.
	u.Schemas = []string{"urn:ietf:params:scim:schemas:core:2.0:User"}
	c.JSON(http.StatusCreated, u)
	audit.AuditMust(c.Request.Context(), audit.Event{
		TenantID: &tenantID, Action: audit.ActionAuthSCIMUserCreate,
		TargetType: "User", TargetID: u.UserName, Outcome: audit.OutcomeSuccess,
	})
}

func SCIMListUsers(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"schemas":      []string{"urn:ietf:params:scim:api:messages:2.0:ListResponse"},
		"totalResults": 0,
		"Resources":    []any{},
	})
}

func SCIMGetUser(c *gin.Context) {
	c.JSON(http.StatusNotFound, gin.H{"error": "not implemented"})
}

func SCIMUpdateUser(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "PUT /Users not implemented; use PATCH"})
}

func SCIMPatchUser(c *gin.Context) {
	// SKELETON: parse PATCH (e.g. {"Operations":[{"op":"replace","path":"active","value":false}]})
	// and apply. The IdP sends PATCH on deactivation, so this endpoint is
	// the workhorse for the "user left the company" flow.
	c.JSON(http.StatusNotImplemented, gin.H{"error": "PATCH not implemented"})
}

func SCIMDeleteUser(c *gin.Context) {
	tenantID := c.MustGet("scim.tenant_id").(uuid.UUID)
	userID := c.Param("id")
	// SKELETON: mark user inactive (don't hard-delete — audit trail).
	audit.AuditMust(c.Request.Context(), audit.Event{
		TenantID: &tenantID, Action: audit.ActionAuthSCIMUserDisable,
		TargetType: "User", TargetID: userID, Outcome: audit.OutcomeSuccess,
	})
	c.Status(http.StatusNoContent)
}
