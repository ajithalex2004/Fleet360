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
