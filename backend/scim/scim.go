// Package scim implements SCIM 2.0 user provisioning for Layer 4.
//
// What is SCIM?
//   System for Cross-domain Identity Management. A standard protocol
//   enterprise IdPs (Okta, Azure AD, OneLogin, JumpCloud) use to push
//   user lifecycle events into SaaS apps. When an IT admin creates a
//   user in Okta, SCIM tells Fleet360 to create a corresponding user.
//
// Why we need it:
//   Manual user provisioning doesn't scale for enterprise customers.
//   An HR system creates 50 new employees on Monday morning; an IT
//   admin can't manually create 50 Fleet360 accounts and assign roles.
//   SCIM automates this. It also handles deactivation (employee leaves →
//   Fleet360 account disabled automatically).
//
// Flow:
//
//   IdP ──HTTP POST /scim/v2/Users──▶ Fleet360 SCIM endpoint
//        Authorization: Bearer <scim_token>
//        Body: SCIM User representation
//   ◀──── 201 Created with SCIM User response ────
//
// Auth: Bearer token. Each tenant has 1+ scim_tokens. Tokens are
// 32-byte random, hashed (SHA-256) at rest, never returned after creation.
//
// SKELETON:
// This file implements the auth and audit pieces. The actual SCIM 2.0
// message parsing, filtering (e.g. ?filter=userName eq "x"), and
// bulk operations should use an existing library (e.g. elimitycom/scim).
package scim

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"fleet360-backend/audit"
	"fleet360-backend/database"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Token represents a SCIM bearer token. The TokenHash is what's stored;
// the raw Token value is shown ONCE on creation and never again.
type Token struct {
	ID         uuid.UUID  `json:"id"`
	TenantID   uuid.UUID  `json:"tenantId"`
	Label      string     `json:"label"`
	CreatedBy  *uuid.UUID `json:"createdBy,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
}

// CreateToken mints a new SCIM token. Returns the raw token (show
// once on creation) and the DB record (without the raw token).
func CreateToken(ctx context.Context, tenantID uuid.UUID, label string, createdBy uuid.UUID, ttl time.Duration) (rawToken string, t Token, err error) {
	if ttl <= 0 {
		ttl = 365 * 24 * time.Hour // 1y default; IdPs persist token, so this is fine
	}
	rawBytes := make([]byte, 32)
	if _, err = rand.Read(rawBytes); err != nil {
		return "", Token{}, err
	}
	rawToken = "scim_" + base64.RawURLEncoding.EncodeToString(rawBytes)
	hash := hashToken(rawToken)
	expires := time.Now().UTC().Add(ttl)

	t = Token{TenantID: tenantID, Label: label, CreatedBy: &createdBy, ExpiresAt: &expires}
	err = database.DB.WithContext(ctx).Raw(`
		INSERT INTO scim_tokens (tenant_id, token_hash, label, created_by, expires_at)
		VALUES (?, ?, ?, ?, ?)
		RETURNING id, created_at
	`, tenantID, hash, label, createdBy, expires).Row().Scan(&t.ID, &t.CreatedAt)
	if err != nil {
		return "", Token{}, fmt.Errorf("scim: insert token: %w", err)
	}

	audit.AuditMust(ctx, audit.Event{
		TenantID: &tenantID, ActorUserID: &createdBy,
		Action: audit.ActionSCIMTokenCreated, TargetType: "ScimToken",
		TargetID: t.ID.String(), Outcome: audit.OutcomeSuccess,
		Metadata: json.RawMessage(fmt.Sprintf(`{"label":%q}`, label)),
	})
	return rawToken, t, nil
}

// RevokeToken marks a SCIM token as revoked. Idempotent.
func RevokeToken(ctx context.Context, tenantID, tokenID, actorUserID uuid.UUID) error {
	err := database.DB.WithContext(ctx).Exec(`
		UPDATE scim_tokens SET revoked_at = NOW(), updated_at = NOW()
		WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL
	`, tokenID, tenantID).Error
	if err != nil {
		return err
	}
	audit.AuditMust(ctx, audit.Event{
		TenantID: &tenantID, ActorUserID: &actorUserID,
		Action: audit.ActionSCIMTokenRevoked, TargetType: "ScimToken",
		TargetID: tokenID.String(),
	})
	return nil
}

// ListTokens returns the tokens for a tenant, with hashes redacted.
// IdP integration shouldn't need this — it's for the admin UI.
func ListTokens(ctx context.Context, tenantID uuid.UUID) ([]Token, error) {
	var out []Token
	err := database.DB.WithContext(ctx).Raw(`
		SELECT id, tenant_id, COALESCE(label, ''), created_by, created_at,
		       last_used_at, expires_at, revoked_at
		FROM scim_tokens WHERE tenant_id = ?
		ORDER BY created_at DESC
	`, tenantID).Scan(&out).Error
	return out, err
}

// ── HTTP middleware: SCIM bearer auth ─────────────────────────────────────────

// AuthMiddleware authenticates an inbound SCIM request via Bearer token.
// On success, sets "scim.tenant_id" in the gin context. On failure,
// responds 401 with a SCIM-compliant error body.
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authz := c.GetHeader("Authorization")
		const prefix = "Bearer "
		if !strings.HasPrefix(authz, prefix) {
			scimError(c, http.StatusUnauthorized, "invalidToken", "missing or malformed Authorization header")
			return
		}
		token := strings.TrimSpace(authz[len(prefix):])
		hash := hashToken(token)

		var tenantID uuid.UUID
		var revokedAt, expiresAt *time.Time
		err := database.DB.WithContext(c.Request.Context()).Raw(`
			SELECT tenant_id, revoked_at, expires_at FROM scim_tokens
			WHERE token_hash = ?
		`, hash).Row().Scan(&tenantID, &revokedAt, &expiresAt)
		if err != nil || tenantID == uuid.Nil {
			scimError(c, http.StatusUnauthorized, "invalidToken", "unknown token")
			return
		}
		if revokedAt != nil {
			scimError(c, http.StatusUnauthorized, "invalidToken", "token revoked")
			return
		}
		if expiresAt != nil && time.Now().After(*expiresAt) {
			scimError(c, http.StatusUnauthorized, "invalidToken", "token expired")
			return
		}

		// Last-used update is fire-and-forget — not worth failing the
		// request if the write fails.
		go func(t string) {
			_ = database.DB.Exec(`UPDATE scim_tokens SET last_used_at = NOW() WHERE token_hash = ?`, t).Error
		}(hash)

		c.Set("scim.tenant_id", tenantID)
		c.Next()
	}
}

// ── SCIM 2.0 user endpoints ───────────────────────────────────────────────────

// User is the SCIM 2.0 user resource (subset — full schema has 50+ fields).
// We accept and emit only what we actually use.
type User struct {
	Schemas  []string `json:"schemas"`
	ID       string   `json:"id"`
	UserName string   `json:"userName"`
	Name     struct {
		GivenName  string `json:"givenName"`
		FamilyName string `json:"familyName"`
	} `json:"name"`
	Emails []struct {
		Value   string `json:"value"`
		Primary bool   `json:"primary"`
	} `json:"emails"`
	Active bool   `json:"active"`
	Meta   struct {
		ResourceType string `json:"resourceType"`
		Created      string `json:"created,omitempty"`
		LastModified string `json:"lastModified,omitempty"`
	} `json:"meta"`
}

// CreateUser handles POST /scim/v2/Users.
// SKELETON: real impl parses + persists via Prisma, then returns the
// canonical User representation.
func CreateUser(c *gin.Context) {
	tenantID := c.MustGet("scim.tenant_id").(uuid.UUID)
	var u User
	if err := c.ShouldBindJSON(&u); err != nil {
		scimError(c, http.StatusBadRequest, "invalidSyntax", err.Error())
		return
	}
	if u.UserName == "" {
		scimError(c, http.StatusBadRequest, "invalidValue", "userName required")
		return
	}
	u.Meta.ResourceType = "User"
	u.Schemas = []string{"urn:ietf:params:scim:schemas:core:2.0:User"}
	c.JSON(http.StatusCreated, u)

	audit.AuditMust(c.Request.Context(), audit.Event{
		TenantID:    &tenantID,
		Action:      audit.ActionAuthSCIMUserCreate,
		TargetType:  "User",
		TargetID:    u.UserName,
		Outcome:     audit.OutcomeSuccess,
	})
}

func scimError(c *gin.Context, status int, scimType, detail string) {
	c.AbortWithStatusJSON(status, gin.H{
		"schemas": []string{"urn:ietf:params:scim:api:messages:2.0:Error"},
		"status":  fmt.Sprintf("%d", status),
		"scimType": scimType,
		"detail":  detail,
	})
}

// hashToken returns the hex SHA-256 of a token. Tokens are stored hashed
// so a DB leak doesn't expose valid SCIM bearer tokens.
func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// ErrTokenNotFound is returned when a SCIM token lookup fails.
var ErrTokenNotFound = errors.New("scim: token not found")
