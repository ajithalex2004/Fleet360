// Package auth is the Fleet360 Go backend's JWT validation surface.
//
// Architecture: the Next.js application is the only issuer. It signs a JWT
// with HS256 against a secret shared via the JWT_SECRET env var. Browsers
// store the token in localStorage and attach it as `Authorization: Bearer
// <token>` on calls to the Go backend. The Go backend never issues tokens
// — it only validates them. (The `Issue` helper below exists for tests
// and for any future operator command that needs to mint a token; it
// must not be called from the request path.)
//
// Claims schema — kept deliberately small so token size stays compact and
// the shared contract between Next.js and Go is unambiguous:
//
//     sub        user id (UUID string)             — required
//     tenant_id  active tenant id (UUID string)    — required
//     role       role code (e.g. SUPER_ADMIN)      — required
//     iat        issued-at unix seconds            — required, set by issuer
//     exp        expiry unix seconds               — required, default 24h
//     iss        "fleet360-nextjs"                 — required, locks issuer
//
// Permissions are NOT carried in the token — they're cached on the Next.js
// side and can change mid-session. The role code is enough for Go-side
// coarse-grained authorisation (admin-only endpoints) without re-fetching
// permissions per request. Fine-grained gates remain in Next.js, where the
// permission set is the source of truth.
package auth

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// Issuer expected on every token. A token issued by anything else (a
// rotated old binary, a different service, an attacker) is rejected even
// if the signature validates — so a leaked secret outside this stack
// can't mint tokens this backend accepts.
const Issuer = "fleet360-nextjs"

// DefaultTTL is the default issuer TTL. Long enough that a tab stays
// usable across a working day, short enough that a leaked token expires
// without manual revocation.
const DefaultTTL = 24 * time.Hour

// Gin context keys. Handlers read tenant / user / role via TenantID,
// UserID, RoleCode — never c.Get with string literals.
const (
	CtxClaims    = "auth.claims"
	CtxUserID    = "auth.user_id"
	CtxTenantID  = "auth.tenant_id"
	CtxRoleCode  = "auth.role"
)

// Claims is the validated JWT payload. RegisteredClaims provides sub/iat/
// exp/iss with the right shapes; TenantID + Role are our additions.
type Claims struct {
	TenantID string `json:"tenant_id"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// Valid checks the application-level invariants on top of jwt.RegisteredClaims'
// signature + exp/iat checks. Returns errors that are safe to log but not
// safe to echo to the client — callers should log and respond 401 with a
// generic message.
func (c *Claims) Valid() error {
	if c.Subject == "" {
		return errors.New("auth: missing sub claim (user id)")
	}
	if c.TenantID == "" {
		return errors.New("auth: missing tenant_id claim")
	}
	if c.Issuer != Issuer {
		return fmt.Errorf("auth: unexpected issuer %q (want %q)", c.Issuer, Issuer)
	}
	return nil
}

// secret reads JWT_SECRET once per call rather than caching, so an
// operator can rotate the secret with a config-map reload (no binary
// restart) once we add a SIGHUP-driven reload path. Returns an error when
// the secret is missing rather than substituting a default — accidentally
// running with a hard-coded fallback secret is a worse failure mode than
// crashing on first request.
func secret() ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if raw == "" {
		return nil, errors.New("auth: JWT_SECRET env var is unset")
	}
	// Minimum length check — HS256 with a 4-character secret is just as
	// breakable as no auth at all. Real ops rotates 32+ random bytes;
	// we accept 16 as the floor.
	if len(raw) < 16 {
		return nil, errors.New("auth: JWT_SECRET must be at least 16 characters")
	}
	return []byte(raw), nil
}

// Issue mints a token. Used by tests and (optionally) by operator tools
// that need to call the backend without a browser session. Never called
// from request handlers — only the Next.js side issues tokens in normal
// operation.
func Issue(userID, tenantID, role string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	sec, err := secret()
	if err != nil {
		return "", err
	}
	now := time.Now()
	claims := &Claims{
		TenantID: tenantID,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString(sec)
}

// ParseAndValidate decodes and verifies a token string. Returns a populated
// *Claims on success, or an error suitable for logging (NOT for echoing to
// the client). Validates signature, exp, iat, iss, and the application-
// level Claims.Valid invariants in a single call.
func ParseAndValidate(tokenString string) (*Claims, error) {
	sec, err := secret()
	if err != nil {
		return nil, err
	}

	parsed, err := jwt.ParseWithClaims(tokenString, &Claims{},
		func(t *jwt.Token) (interface{}, error) {
			// Reject any signing method other than HS256 — defends
			// against the "alg=none" and "alg=RS256 with public key as
			// secret" classic JWT vulnerabilities.
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("auth: unexpected signing method %v", t.Header["alg"])
			}
			return sec, nil
		},
		jwt.WithIssuer(Issuer),
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
	)
	if err != nil {
		return nil, fmt.Errorf("auth: parse: %w", err)
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return nil, errors.New("auth: token claims malformed or invalid")
	}
	if err := claims.Valid(); err != nil {
		return nil, err
	}
	return claims, nil
}

// Middleware returns a Gin middleware that requires every request beneath
// it to carry a valid Bearer token. On success it stuffs the claims into
// the request context under CtxClaims and the three frequently-accessed
// scalars under CtxUserID / CtxTenantID / CtxRoleCode for cheap reads in
// handlers (no need to re-parse on every Where clause).
//
// On failure it responds 401 with a generic message — the actual reason
// goes to the structured log (where it's safe to be verbose).
func Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractBearer(c.GetHeader("Authorization"))
		if token == "" {
			c.AbortWithStatusJSON(401, gin.H{"error": "missing or malformed Authorization header"})
			return
		}
		claims, err := ParseAndValidate(token)
		if err != nil {
			// Log the actual reason for operators, but return only a
			// generic 401 to the caller. Don't help token-fuzzers.
			_ = c.Error(err)
			c.AbortWithStatusJSON(401, gin.H{"error": "invalid or expired token"})
			return
		}
		c.Set(CtxClaims, claims)
		c.Set(CtxUserID, claims.Subject)
		c.Set(CtxTenantID, claims.TenantID)
		c.Set(CtxRoleCode, claims.Role)
		c.Next()
	}
}

// extractBearer pulls the token out of an Authorization header. Returns
// empty string if the header doesn't have the Bearer scheme.
func extractBearer(authHeader string) string {
	authHeader = strings.TrimSpace(authHeader)
	if authHeader == "" {
		return ""
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(authHeader, prefix) {
		return ""
	}
	return strings.TrimSpace(authHeader[len(prefix):])
}

// TenantID returns the tenant id from the Gin context, or empty if the
// request didn't pass through Middleware (treat empty as "no tenant
// scope" — handlers MUST refuse to operate on data in that case rather
// than fall back to "all tenants").
func TenantID(c *gin.Context) string {
	v, ok := c.Get(CtxTenantID)
	if !ok {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// UserID returns the authenticated user id from the Gin context, or empty
// if the request didn't pass through Middleware.
func UserID(c *gin.Context) string {
	v, ok := c.Get(CtxUserID)
	if !ok {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// RoleCode returns the authenticated user's role code from the Gin context.
// Empty if unauthenticated.
func RoleCode(c *gin.Context) string {
	v, ok := c.Get(CtxRoleCode)
	if !ok {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
