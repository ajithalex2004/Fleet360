package auth

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// WithTenant returns a GORM Scopes function that filters the query to rows
// belonging to the request's authenticated tenant. Use it on every read,
// update, and delete that touches a tenant-scoped table:
//
//     var vehicles []models.Vehicle
//     db.Scopes(auth.WithTenant(c)).Find(&vehicles)
//
//     db.Scopes(auth.WithTenant(c)).
//        Where("id = ?", id).
//        Updates(&input)
//
// For creates, callers MUST set `TenantID` on the model explicitly before
// calling db.Create — the scope only injects WHERE clauses, not INSERT
// values. The canonical pattern in handlers is:
//
//     input.TenantID = auth.TenantID(c)
//     if input.TenantID == "" {
//         c.AbortWithStatusJSON(401, gin.H{"error": "missing tenant context"})
//         return
//     }
//     db.Create(&input)
//
// Fail-closed behaviour: if the request has no authenticated tenant
// (auth.Middleware was bypassed or the context lacks the key), the scope
// returns a "1 = 0" no-rows-ever query rather than an unscoped query. This
// is the difference between "leaks no data when misconfigured" and "leaks
// everything when misconfigured" — choose the safe failure mode.
func WithTenant(c *gin.Context) func(*gorm.DB) *gorm.DB {
	return func(db *gorm.DB) *gorm.DB {
		tid := TenantID(c)
		if tid == "" {
			// Defensive: a missing tenant context means we shouldn't
			// return ANY rows. Returning everything would be a critical
			// data-leak bug; returning nothing is a recoverable error
			// (the caller gets an empty result, which is the same as
			// "this tenant has no records").
			return db.Where("1 = 0")
		}
		return db.Where("tenant_id = ?", tid)
	}
}

// AsTenant executes fn inside a transaction where PostgreSQL session setting
// `app.tenant_id` is set to the request's tenant via set_config(..., true).
// This guarantees full compatibility with PostgreSQL Row-Level Security (RLS)
// policies on tables that have RLS enabled (such as vehicles and drivers).
func AsTenant(c *gin.Context, db *gorm.DB, fn func(tx *gorm.DB) error) error {
	tid := TenantID(c)
	if tid == "" {
		return gorm.ErrInvalidData
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT set_config('app.tenant_id', ?, true)`, tid).Error; err != nil {
			return err
		}
		return fn(tx)
	})
}
