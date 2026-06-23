package handlers

// Logistics handlers — the Go-native replacement for the Next.js route
// handlers under src/app/api/logistics. Every function here follows the
// same contract as the fleet/maintenance handlers in handlers.go:
//
//   1. requireTenant(c) at the top — aborts 401 if the request didn't carry
//      a valid tenant context. Callers MUST `return` when it yields "".
//   2. Reads/updates/deletes go through database.DB.Scopes(auth.WithTenant(c))
//      so the WHERE tenant_id = ? clause is injected centrally and can't be
//      forgotten per-query (the failure mode that makes the current raw-SQL
//      handlers leak across tenants when one query omits the filter).
//   3. Creates stamp input.TenantID = tid from the validated token before
//      db.Create — never trusting a client-supplied tenantId.
//
// This file is Phase L0: the shipment-orders slice + a tenant-scoped stats
// summary. Carriers, bids, RFQs, trips, tracking, ePOD and finance land in
// later phases against the same skeleton.

import (
	"net/http"
	"strconv"
	"strings"

	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// defaultShipmentPageSize bounds an unfiltered list so a large tenant can't
// pull its entire shipment history in one unpaginated response. Callers
// override with ?limit= up to maxShipmentPageSize.
const (
	defaultShipmentPageSize = 50
	maxShipmentPageSize     = 200
)

// GetLogisticsShipments lists shipment orders for the authenticated tenant,
// newest first. Optional query params:
//
//	?status=DRAFT,DISPATCHED   comma-separated status allow-list
//	?mode=SPOT|CONTRACT|...    booking_mode filter
//	?limit=  ?offset=          pagination (limit capped at maxShipmentPageSize)
//
// Soft-deleted rows (deleted_at IS NOT NULL) are excluded automatically by
// GORM via the embedded Model.DeletedAt.
func GetLogisticsShipments(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}

	limit := defaultShipmentPageSize
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > maxShipmentPageSize {
		limit = maxShipmentPageSize
	}
	offset := 0
	if v := c.Query("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsShipmentOrder{})

	if s := strings.TrimSpace(c.Query("status")); s != "" {
		q = q.Where("status IN ?", splitCSV(s))
	}
	if m := strings.TrimSpace(c.Query("mode")); m != "" {
		q = q.Where("booking_mode = ?", strings.ToUpper(m))
	}

	// Total before pagination so the client can render "showing 50 of 1280".
	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var shipments []models.LogisticsShipmentOrder
	if err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&shipments).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":   shipments,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// GetLogisticsShipment returns a single shipment order by id, scoped to the
// authenticated tenant. A row that exists but belongs to another tenant is
// indistinguishable from a non-existent one here (both 404) — by design,
// so the endpoint can't be used to probe other tenants' id space.
func GetLogisticsShipment(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	id := c.Param("id")

	var shipment models.LogisticsShipmentOrder
	err := database.DB.Scopes(auth.WithTenant(c)).Where("id = ?", id).First(&shipment).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "shipment not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipment)
}

// CreateLogisticsShipment inserts a new shipment order. The tenant is taken
// from the validated token, never the body — a client cannot create a row
// in another tenant by sending a forged tenantId. shipment_no is generated
// in the model's BeforeCreate hook when omitted.
func CreateLogisticsShipment(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}

	var input models.LogisticsShipmentOrder
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Authoritative server-side fields — overwrite anything the client sent.
	input.ID = "" // force fresh UUID even if the body carried one
	input.TenantID = tid
	if uid := auth.UserID(c); uid != "" {
		input.CreatedBy = &uid
	}

	// Mirror the DB column defaults so the API contract is explicit rather
	// than relying on the caller having read the schema. GORM's default tags
	// would also apply these, but setting them here keeps the response body
	// consistent regardless of insert path.
	if input.Status == "" {
		input.Status = "DRAFT"
	}
	if input.BookingMode == "" {
		input.BookingMode = "SPOT"
	}
	if input.MarketplaceStatus == "" {
		input.MarketplaceStatus = "PRIVATE"
	}
	if input.Priority == "" {
		input.Priority = "NORMAL"
	}
	if input.Currency == "" {
		input.Currency = "AED"
	}

	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, input)
}

// LogisticsStats is the tenant-scoped dashboard summary. It replaces the
// Next.js /api/logistics/stats + /analytics count block, which queries the
// `bookings` table with `service_type = 'LOGISTICS'` and — critically — NO
// tenant_id filter, so every tenant currently sees platform-wide totals.
// Here the same counts run through auth.WithTenant against the real
// logistics_shipment_orders table, so each tenant sees only its own.
type LogisticsStats struct {
	Total     int64 `json:"total"`
	Draft     int64 `json:"draft"`
	Active    int64 `json:"active"`
	Delivered int64 `json:"delivered"`
	Cancelled int64 `json:"cancelled"`
}

// GetLogisticsStats returns the per-tenant shipment counters.
func GetLogisticsStats(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}

	base := func() *gorm.DB {
		return database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsShipmentOrder{})
	}

	var stats LogisticsStats
	count := func(dst *int64, statuses ...string) error {
		q := base()
		if len(statuses) > 0 {
			q = q.Where("status IN ?", statuses)
		}
		return q.Count(dst).Error
	}

	// Status buckets mirror the lifecycle the Next.js dashboard groups on.
	// Any error short-circuits to a 500 — a partial stats block is worse
	// than a clear failure for a numbers-driven dashboard.
	if err := count(&stats.Total); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := count(&stats.Draft, "DRAFT"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := count(&stats.Active, "DISPATCHED", "ENROUTE_PICKUP", "LOADED", "ENROUTE_DELIVERY", "ACTIVE"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := count(&stats.Delivered, "DELIVERED", "POD_SUBMITTED", "COMPLETED", "CLOSED"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := count(&stats.Cancelled, "CANCELLED"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, stats)
}

// splitCSV turns "DRAFT, DISPATCHED ,ACTIVE" into ["DRAFT","DISPATCHED",
// "ACTIVE"], trimming spaces and dropping empties. Used for the ?status=
// allow-list filter.
func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
