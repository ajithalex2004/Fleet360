package auth

// Session revocation for Go-backend tokens (Track C durable parity).
//
// Two durable PostgreSQL tables back revocation:
//  1. `public.revoked_session_tokens` (per-token / single-device logout):
//     queried immediately (uncached) by `sid:<jti>` and `tok:<sha256>` so a
//     single-device logout on Next.js immediately rejects the paired Go JWT
//     at t = 0 s without affecting other active devices of the same user.
//  2. `public.session_revocations` (bulk scope: user, tenant, user-in-tenant):
//     re-read at most once per RevocationRecheck (60 s), matching the Next.js
//     middleware.
//
// Fail-closed policy: in `GO_ENV=production`, Middleware() refuses requests
// with 401 if a revocation DB check errors. Outside production, DB errors are
// logged and allowed unless a cached revocation is already known.

import (
	"context"
	"database/sql"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
)

// RevocationRecheck is how stale a bulk scope revocation check may be.
const RevocationRecheck = 60 * time.Second

// RevocationStaleGrace is the maximum age of a cached negative scope entry.
const RevocationStaleGrace = 10 * time.Minute

// RevocationChecker reports whether a token of userID in tenantID issued at
// issuedAt has been revoked by a bulk scope revocation.
type RevocationChecker interface {
	RevokedSince(ctx context.Context, userID, tenantID string, issuedAt time.Time) (bool, error)
}

// TokenRevocationChecker extends RevocationChecker with immediate per-token
// revocation lookup (`revoked_session_tokens`) by shared `jti` (`sid:<uuid>`)
// and raw token SHA-256 fingerprint (`tok:<sha256>`).
type TokenRevocationChecker interface {
	RevocationChecker
	IsTokenRevoked(ctx context.Context, userID, tenantID, jti, tokenHash string, issuedAt time.Time) (bool, error)
}

var (
	revocationMu      sync.RWMutex
	revocationChecker RevocationChecker
)

// SetRevocationChecker installs the checker Middleware() consults; nil
// disables revocation checks (tests, tools).
func SetRevocationChecker(c RevocationChecker) {
	revocationMu.Lock()
	defer revocationMu.Unlock()
	revocationChecker = c
}

func currentRevocationChecker() RevocationChecker {
	revocationMu.RLock()
	defer revocationMu.RUnlock()
	return revocationChecker
}

// NotBeforeFunc returns the latest revocation moment for a user in a
// tenant (zero time when there is none).
type NotBeforeFunc func(ctx context.Context, userID, tenantID string) (time.Time, error)

// TokenRevokedFunc checks whether any of `tokenKeys` (`sid:<jti>`, `tok:<sha256>`)
// has an unexpired row in `public.revoked_session_tokens` for `tenantID`.
type TokenRevokedFunc func(ctx context.Context, tenantID string, tokenKeys []string) (bool, error)

// BuildTokenRevocationKeys builds the canonical PostgreSQL `token_key` lookup
// keys matching Next.js `buildRevocationTokenKeys()`.
func BuildTokenRevocationKeys(jti, tokenHash string) []string {
	keys := make([]string, 0, 2)
	if cleanJTI := strings.TrimSpace(jti); cleanJTI != "" {
		keys = append(keys, "sid:"+cleanJTI)
	}
	if cleanHash := strings.TrimSpace(tokenHash); cleanHash != "" {
		keys = append(keys, "tok:"+cleanHash)
	}
	return keys
}

type cachedNotBefore struct {
	notBefore time.Time
	fetchedAt time.Time
}

// CachingRevocationChecker caches NotBeforeFunc results for Recheck and runs
// immediate (uncached) per-token checks when TokenRevoked is configured.
type CachingRevocationChecker struct {
	NotBefore    NotBeforeFunc
	TokenRevoked TokenRevokedFunc
	Recheck      time.Duration
	StaleGrace   time.Duration
	Now          func() time.Time

	mu    sync.Mutex
	cache map[string]cachedNotBefore
}

const maxRevocationCacheEntries = 10000

func (c *CachingRevocationChecker) RevokedSince(ctx context.Context, userID, tenantID string, issuedAt time.Time) (bool, error) {
	now := time.Now
	if c.Now != nil {
		now = c.Now
	}
	recheck := c.Recheck
	if recheck <= 0 {
		recheck = RevocationRecheck
	}
	key := userID + "\x00" + tenantID
	t := now()

	c.mu.Lock()
	if c.cache == nil {
		c.cache = map[string]cachedNotBefore{}
	}
	hit, ok := c.cache[key]
	c.mu.Unlock()

	notBefore := hit.notBefore
	var err error
	if !ok || t.Sub(hit.fetchedAt) >= recheck {
		if c.NotBefore != nil {
			var fresh time.Time
			fresh, err = c.NotBefore(ctx, userID, tenantID)
			if err == nil {
				notBefore = fresh
				c.mu.Lock()
				if len(c.cache) >= maxRevocationCacheEntries {
					c.cache = map[string]cachedNotBefore{}
				}
				c.cache[key] = cachedNotBefore{notBefore: fresh, fetchedAt: t}
				c.mu.Unlock()
			}
		}
	}
	if notBefore.IsZero() {
		return false, err
	}
	// Track C tokens carry millisecond `iat_ms` (sub-second precision) so
	// same-second bulk revocations (`logout-all`, user deactivation) reject
	// pre-revocation tokens while allowing immediate post-revocation sign-in.
	// Legacy tokens without `iat_ms` only have whole-second `iat` precision.
	if issuedAt.Nanosecond() != 0 {
		return issuedAt.Before(notBefore), err
	}
	return issuedAt.Before(notBefore.Truncate(time.Second)), err
}

// IsTokenRevoked checks immediate single-device revocation (`revoked_session_tokens`)
// first, then bulk scope revocation (`session_revocations`).
func (c *CachingRevocationChecker) IsTokenRevoked(
	ctx context.Context,
	userID, tenantID, jti, tokenHash string,
	issuedAt time.Time,
) (bool, error) {
	if c.TokenRevoked != nil {
		keys := BuildTokenRevocationKeys(jti, tokenHash)
		if len(keys) > 0 {
			tokRevoked, tokErr := c.TokenRevoked(ctx, tenantID, keys)
			if tokErr != nil {
				return false, tokErr
			}
			if tokRevoked {
				return true, nil
			}
		}
	}
	if c.NotBefore == nil {
		return false, nil
	}
	return c.RevokedSince(ctx, userID, tenantID, issuedAt)
}

// NewDBRevocationChecker reads `revoked_session_tokens` (immediate per-token)
// and `session_revocations` (bulk scope) through db in the token's tenant RLS
// context (`app.tenant_id = tenantID`).
func NewDBRevocationChecker(db *gorm.DB) *CachingRevocationChecker {
	return &CachingRevocationChecker{
		Recheck:    RevocationRecheck,
		StaleGrace: RevocationStaleGrace,
		TokenRevoked: func(ctx context.Context, tenantID string, tokenKeys []string) (bool, error) {
			if len(tokenKeys) == 0 {
				return false, nil
			}
			var revoked bool
			err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
				if err := tx.Exec(`SELECT set_config('app.tenant_id', ?, true)`, tenantID).Error; err != nil {
					return err
				}
				return tx.Raw(`
					SELECT EXISTS (
						SELECT 1
						  FROM public.revoked_session_tokens
						 WHERE token_key IN ?
						   AND expires_at > now()
					)`, tokenKeys).Scan(&revoked).Error
			})
			if err != nil {
				return false, err
			}
			return revoked, nil
		},
		NotBefore: func(ctx context.Context, userID, tenantID string) (time.Time, error) {
			// max() is NULL when nothing was revoked, the usual case: scan into
			// sql.NullTime, as a *time.Time target cannot take a NULL here.
			var notBefore sql.NullTime
			err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
				if err := tx.Exec(`SELECT set_config('app.tenant_id', ?, true)`, tenantID).Error; err != nil {
					return err
				}
				return tx.Raw(`
					SELECT max(not_before) FROM session_revocations
					 WHERE (user_id = ? AND tenant_id IS NULL)
					    OR (user_id IS NULL AND tenant_id = ?)
					    OR (user_id = ? AND tenant_id = ?)`,
					userID, tenantID, userID, tenantID).Row().Scan(&notBefore)
			})
			if err != nil || !notBefore.Valid {
				return time.Time{}, err
			}
			return notBefore.Time, nil
		},
	}
}
