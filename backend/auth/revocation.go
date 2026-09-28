package auth

// Session revocation for Go-backend tokens.
//
// The Next.js side records "sessions issued before this moment are invalid"
// in session_revocations (src/lib/auth/session-revocation.ts) when a role or
// membership changes, a user or tenant is deactivated, a password is reset
// or a user signs out everywhere. Middleware() rejects a token whose iat is
// earlier than the latest applicable moment for its user, its tenant, or
// the user in that tenant.
//
// Each (user, tenant) pair is re-read at most once per RevocationRecheck, so
// a revocation reaches this backend within that interval (60 s), matching
// the Next.js middleware. A database error keeps the last known value (or
// none) and is logged by the caller: an outage must not sign everyone out.

import (
	"context"
	"database/sql"
	"sync"
	"time"

	"gorm.io/gorm"
)

// RevocationRecheck is how stale a revocation check may be.
const RevocationRecheck = 60 * time.Second

// RevocationChecker reports whether a token of userID in tenantID issued at
// issuedAt has been revoked since.
type RevocationChecker interface {
	RevokedSince(ctx context.Context, userID, tenantID string, issuedAt time.Time) (bool, error)
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

type cachedNotBefore struct {
	notBefore time.Time
	fetchedAt time.Time
}

// CachingRevocationChecker caches NotBeforeFunc results for Recheck.
type CachingRevocationChecker struct {
	NotBefore NotBeforeFunc
	Recheck   time.Duration
	Now       func() time.Time

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
	if notBefore.IsZero() {
		return false, err
	}
	// JWT iat has whole-second precision: compare at seconds, so a token
	// issued in the same second as the revocation (a sign-in right after
	// it) is not rejected.
	return issuedAt.Before(notBefore.Truncate(time.Second)), err
}

// NewDBRevocationChecker reads session_revocations through db, in the
// token's tenant context (the table's RLS policy shows that tenant's rows
// and user-wide rows).
func NewDBRevocationChecker(db *gorm.DB) *CachingRevocationChecker {
	return &CachingRevocationChecker{
		Recheck: RevocationRecheck,
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
