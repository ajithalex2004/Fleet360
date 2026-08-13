package handlers

// Dispatch handlers — Phase 0 prep for the Tier 1 module.
//
// This file establishes the routing surface and CRUD skeleton for the
// bus/staff dispatch domain. It mirrors the logistics.go handler pattern:
//   1. requireTenant(c) at the top — aborts 401 if no tenant context.
//   2. Reads/updates/deletes go through database.DB.Scopes(auth.WithTenant(c))
//      so the WHERE tenant_id = ? clause is injected centrally and can't be
//      forgotten per-query.
//   3. Creates stamp input.TenantID = tid from the validated token before
//      db.Create — never trusting a client-supplied tenantId.
//
// What's wired:
//   - List/Create/Get/Update/Delete for trip_schedules (the central entity)
//   - List/Create/Get/Update for trip_incidents (incident reports)
//   - List/Create/Get/Update for ambulance_calls (emergency dispatch)
//   - List/Get for trip_logs (driver-reported — write path is from driver
//     app, separate endpoint family)
//   - List/Get for bus_routes (route definitions; writes go through a
//     separate RouteDesigner endpoint family in a follow-up PR)
//   - List/Get for trip_passengers (the roster; write path is bulk-add
//     from staff roster management)
//   - List/Get for boarding_events (high-volume writes; read is analytics)
//
// What's NOT wired (Phase 1+):
//   - Auto-dispatch logic (routeopt / etapredict / distmatrix integration)
//   - Trip creation wizard (multi-step with driver/vehicle assignment)
//   - Driver app endpoints (mobile app, separate auth context)
//   - Boarding device webhook ingestion (separate rate-limited surface)

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	defaultDispatchPageSize = 50
	maxDispatchPageSize     = 200
)

// ── TripSchedule handlers ─────────────────────────────────────────────────────

// ListTripSchedules — GET /api/v1/dispatch/trips
//
// Query params: ?status=, ?routeId=, ?vehicleId=, ?driverId=, ?dateFrom=,
// ?dateTo=, ?limit=, ?offset=
func ListTripSchedules(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := paginationFromQuery(c)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.TripSchedule{})

	if s := strings.TrimSpace(c.Query("status")); s != "" {
		q = q.Where("status IN ?", splitCSV(s))
	}
	if routeID := strings.TrimSpace(c.Query("routeId")); routeID != "" {
		q = q.Where("route_id = ?", routeID)
	}
	if vehicleID := strings.TrimSpace(c.Query("vehicleId")); vehicleID != "" {
		q = q.Where("vehicle_id = ?", vehicleID)
	}
	if driverID := strings.TrimSpace(c.Query("driverId")); driverID != "" {
		q = q.Where("driver_id = ?", driverID)
	}
	if dateFrom := strings.TrimSpace(c.Query("dateFrom")); dateFrom != "" {
		q = q.Where("departure_time >= ?", dateFrom)
	}
	if dateTo := strings.TrimSpace(c.Query("dateTo")); dateTo != "" {
		q = q.Where("departure_time <= ?", dateTo)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var trips []models.TripSchedule
	if err := q.Order("departure_time DESC").
		Limit(limit).Offset(offset).
		Find(&trips).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": trips, "total": total, "limit": limit, "offset": offset})
}

// CreateTripSchedule — POST /api/v1/dispatch/trips
func CreateTripSchedule(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var in models.TripSchedule
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	in.TenantID = tid
	in.ID = "" // let DB default / BeforeCreate hook mint the id
	if err := database.DB.Create(&in).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, in)
}

// GetTripSchedule — GET /api/v1/dispatch/trips/:id
func GetTripSchedule(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	var trip models.TripSchedule
	err := database.DB.Scopes(auth.WithTenant(c)).
		Preload("Passengers").
		Preload("TripLogs").
		Preload("Incidents").
		First(&trip, "id = ?", c.Param("id")).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "trip not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, trip)
}

// UpdateTripSchedule — PATCH /api/v1/dispatch/trips/:id
func UpdateTripSchedule(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var fields map[string]any
	if err := c.ShouldBindJSON(&fields); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Belt-and-braces: never let a caller overwrite tenant_id from the body.
	delete(fields, "tenantId")
	delete(fields, "tenant_id")
	delete(fields, "id")

	res := database.DB.Scopes(auth.WithTenant(c)).
		Model(&models.TripSchedule{}).
		Where("id = ?", c.Param("id")).
		Updates(fields)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": res.Error.Error()})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "trip not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

// DeleteTripSchedule — DELETE /api/v1/dispatch/trips/:id (soft delete)
func DeleteTripSchedule(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	res := database.DB.Scopes(auth.WithTenant(c)).
		Delete(&models.TripSchedule{}, "id = ?", c.Param("id"))
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": res.Error.Error()})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "trip not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// ── TripIncident handlers ─────────────────────────────────────────────────────

func ListTripIncidents(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := paginationFromQuery(c)
	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.TripIncident{})
	if s := strings.TrimSpace(c.Query("status")); s != "" {
		q = q.Where("status IN ?", splitCSV(s))
	}
	if sev := strings.TrimSpace(c.Query("severity")); sev != "" {
		q = q.Where("severity = ?", sev)
	}
	var total int64
	q.Count(&total)
	var incidents []models.TripIncident
	if err := q.Order("incident_date DESC").
		Limit(limit).Offset(offset).
		Find(&incidents).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": incidents, "total": total, "limit": limit, "offset": offset})
}

func CreateTripIncident(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var in models.TripIncident
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	in.TenantID = tid
	in.ID = ""
	if err := database.DB.Create(&in).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, in)
}

func GetTripIncident(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	var inc models.TripIncident
	err := database.DB.Scopes(auth.WithTenant(c)).
		First(&inc, "id = ?", c.Param("id")).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "incident not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, inc)
}

func UpdateTripIncident(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var fields map[string]any
	if err := c.ShouldBindJSON(&fields); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	delete(fields, "tenantId")
	delete(fields, "tenant_id")
	delete(fields, "id")

	res := database.DB.Scopes(auth.WithTenant(c)).
		Model(&models.TripIncident{}).
		Where("id = ?", c.Param("id")).
		Updates(fields)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": res.Error.Error()})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "incident not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

// ── AmbulanceCall handlers ─────────────────────────────────────────────────────

func ListAmbulanceCalls(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := paginationFromQuery(c)
	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.AmbulanceCall{})
	if s := strings.TrimSpace(c.Query("status")); s != "" {
		q = q.Where("status IN ?", splitCSV(s))
	}
	if sev := strings.TrimSpace(c.Query("severity")); sev != "" {
		q = q.Where("severity = ?", sev)
	}
	var total int64
	q.Count(&total)
	var calls []models.AmbulanceCall
	if err := q.Order("received_at DESC").
		Limit(limit).Offset(offset).
		Find(&calls).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": calls, "total": total, "limit": limit, "offset": offset})
}

func CreateAmbulanceCall(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var in models.AmbulanceCall
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	in.TenantID = tid
	in.ID = ""
	if err := database.DB.Create(&in).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, in)
}

func GetAmbulanceCall(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	var call models.AmbulanceCall
	err := database.DB.Scopes(auth.WithTenant(c)).
		First(&call, "id = ?", c.Param("id")).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "call not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, call)
}

func UpdateAmbulanceCall(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var fields map[string]any
	if err := c.ShouldBindJSON(&fields); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	delete(fields, "tenantId")
	delete(fields, "tenant_id")
	delete(fields, "id")

	res := database.DB.Scopes(auth.WithTenant(c)).
		Model(&models.AmbulanceCall{}).
		Where("id = ?", c.Param("id")).
		Updates(fields)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": res.Error.Error()})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "call not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

// ── BusRoute read endpoints ───────────────────────────────────────────────────

func ListBusRoutes(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := paginationFromQuery(c)
	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.BusRoute{})
	if active := strings.TrimSpace(c.Query("active")); active == "true" {
		q = q.Where("is_active = true")
	}
	var total int64
	q.Count(&total)
	var routes []models.BusRoute
	if err := q.Order("name ASC").
		Limit(limit).Offset(offset).
		Find(&routes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": routes, "total": total, "limit": limit, "offset": offset})
}

func GetBusRoute(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	var route models.BusRoute
	err := database.DB.Scopes(auth.WithTenant(c)).
		Preload("Stops").
		First(&route, "id = ?", c.Param("id")).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "route not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, route)
}

// ── Read-only endpoints (high-volume write sources, light read API) ───────────

func ListTripPassengers(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	tripID := c.Param("id")
	if tripID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trip id required"})
		return
	}
	var passengers []models.TripPassenger
	err := database.DB.Scopes(auth.WithTenant(c)).
		Where("trip_id = ?", tripID).
		Order("employee_name ASC").
		Find(&passengers).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": passengers})
}

func ListTripLogs(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	scheduleID := c.Param("id")
	if scheduleID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "schedule id required"})
		return
	}
	var logs []models.TripLog
	err := database.DB.Scopes(auth.WithTenant(c)).
		Where("schedule_id = ?", scheduleID).
		Order("actual_departure_time ASC NULLS LAST").
		Find(&logs).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

func ListBoardingEvents(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	scheduleID := c.Param("id")
	if scheduleID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "schedule id required"})
		return
	}
	limit, offset := paginationFromQuery(c)
	var events []models.BoardingEvent
	err := database.DB.Scopes(auth.WithTenant(c)).
		Where("schedule_id = ?", scheduleID).
		Order("performed_at DESC").
		Limit(limit).Offset(offset).
		Find(&events).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": events})
}

// ── helpers ───────────────────────────────────────────────────────────────────

// paginationFromQuery extracts ?limit and ?offset query params with sane
// bounds. Shared across list handlers in this package.
func paginationFromQuery(c *gin.Context) (int, int) {
	limit := defaultDispatchPageSize
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > maxDispatchPageSize {
		limit = maxDispatchPageSize
	}
	offset := 0
	if v := c.Query("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return limit, offset
}

// splitCSV lives in handlers/logistics.go (shared helper). Removed
// duplicate here to avoid redeclaration error.
