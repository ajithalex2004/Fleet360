package handlers

// Logistics dashboard stats (Phase L4d) — the Go-native PARITY rewrite of the
// Next.js GET /api/logistics/stats endpoint that powers the logistics home
// dashboard (src/app/logistics/page.tsx).
//
// WHY A REWRITE OF THE GO HANDLER ITSELF. The original Go GetLogisticsStats
// (Phase L0) returned a minimal {total,draft,active,delivered,cancelled}
// shipment-status summary — a DIFFERENT contract from the dashboard, which reads
// {totalVehicles, availableVehicles, inMaintenance, activeTrips, completedToday,
// pendingBookings, drivers, recentTrips[]}. Flipping /stats to Go therefore
// needed this rewrite first: the handler now returns the dashboard's contract.
//
// Same canonical rewrite as the analytics/sla/tracking ports: the legacy route
// scanned the legacy `bookings` table (service_type='LOGISTICS') UNSCOPED and
// from the wrong source — at runtime `bookings` lacks the columns those queries
// read, AND `drivers` has no `assignment_type` column, so the legacy KPIs
// already render zeros via .catch(zero). This computes from
// logistics_shipment_orders (+ the tenant's LOGISTICS vehicles and its drivers)
// behind auth.WithTenant. Status / column substitutions mirror the siblings:
//   - activeTrips:     bookings IN (CONFIRMED,ACTIVE) → LSO activeShipmentStatuses
//                      (DISPATCHED…ACTIVE), the in-transit set the "In transit" KPI means.
//   - completedToday:  bookings COMPLETED today → LSO completedShipmentStatuses
//                      with DATE(updated_at)=CURRENT_DATE (verbatim today-predicate).
//   - pendingBookings: status 'PENDING' verbatim (also the dominant live LSO status).
//   - drivers:         legacy `assignment_type='LOGISTICS'` (a NON-EXISTENT column,
//                      already → 0) → ALL of the tenant's drivers, matching what
//                      GetDrivers and the roster page return (the whole module is
//                      logistics; a tenant's drivers ARE its logistics drivers).
//   - recentTrips:     bookings → LSO, newest first, max 10. booking_ref→shipment_no,
//                      start_date→pickup_window_from, end_date→delivery_window_to,
//                      origin_location→origin_name, destination→destination_name,
//                      customer_name→cargo_owner_name.
//
// recentTrips KEEPS the legacy SNAKE_CASE JSON keys (booking_ref, origin_location,
// destination, customer_name, start_date, end_date, created_at) — the dashboard's
// LogisticsStats.recentTrips type reads exactly those keys (the legacy route
// spread raw SQL column aliases).
//
// Vehicle predicates are byte-identical to the legacy route + analytics
// (vehicle_usage='LOGISTICS', status AVAILABLE/MAINTENANCE) plus tenant scope.
// Unlike the legacy route, a hard DB error returns 500 rather than zero-masking;
// the dashboard only swaps in new data on res.ok, so a 500 leaves the last render.

import (
	"net/http"

	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// logisticsStatsRecentTrip is one row of the dashboard's recent-trips table.
// The json tags are SNAKE_CASE on purpose — the page reads these exact keys.
type logisticsStatsRecentTrip struct {
	ID             string  `json:"id"`
	BookingRef     string  `json:"booking_ref"`
	Status         string  `json:"status"`
	StartDate      *string `json:"start_date"`
	EndDate        *string `json:"end_date"`
	OriginLocation *string `json:"origin_location"`
	Destination    *string `json:"destination"`
	CustomerName   *string `json:"customer_name"`
	CreatedAt      *string `json:"created_at"`
}

// logisticsStatsResponse is the dashboard contract (camelCase KPI fields +
// the snake-cased recentTrips array).
type logisticsStatsResponse struct {
	TotalVehicles     int64                      `json:"totalVehicles"`
	AvailableVehicles int64                      `json:"availableVehicles"`
	InMaintenance     int64                      `json:"inMaintenance"`
	ActiveTrips       int64                      `json:"activeTrips"`
	CompletedToday    int64                      `json:"completedToday"`
	PendingBookings   int64                      `json:"pendingBookings"`
	Drivers           int64                      `json:"drivers"`
	RecentTrips       []logisticsStatsRecentTrip `json:"recentTrips"`
}

// GetLogisticsStats returns the tenant-scoped logistics dashboard KPIs plus the
// 10 most recent shipments, computed from logistics_shipment_orders and the
// tenant's LOGISTICS vehicles / drivers.
func GetLogisticsStats(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	fail := func(err error) { c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()}) }

	// Fresh query per call — chaining mutates the shared *gorm.DB. The embedded
	// Model injects deleted_at IS NULL; auth.WithTenant injects tenant_id = ?.
	shipments := func() *gorm.DB {
		return database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsShipmentOrder{})
	}
	vehicles := func() *gorm.DB {
		return database.DB.Scopes(auth.WithTenant(c)).Model(&models.Vehicle{}).
			Where("vehicle_usage = ?", "LOGISTICS")
	}

	resp := logisticsStatsResponse{RecentTrips: make([]logisticsStatsRecentTrip, 0, 10)}

	// ── Vehicles (this tenant's LOGISTICS fleet) ─────────────────────────────
	if err := vehicles().Count(&resp.TotalVehicles).Error; err != nil {
		fail(err)
		return
	}
	if err := vehicles().Where("status = ?", "AVAILABLE").Count(&resp.AvailableVehicles).Error; err != nil {
		fail(err)
		return
	}
	if err := vehicles().Where("status = ?", "MAINTENANCE").Count(&resp.InMaintenance).Error; err != nil {
		fail(err)
		return
	}

	// ── Shipments (active / completed-today / pending) ───────────────────────
	if err := shipments().Where("status IN ?", activeShipmentStatuses).Count(&resp.ActiveTrips).Error; err != nil {
		fail(err)
		return
	}
	if err := shipments().Where("status IN ?", completedShipmentStatuses).
		Where("DATE(updated_at) = CURRENT_DATE").Count(&resp.CompletedToday).Error; err != nil {
		fail(err)
		return
	}
	if err := shipments().Where("status = ?", "PENDING").Count(&resp.PendingBookings).Error; err != nil {
		fail(err)
		return
	}

	// ── Drivers (all of the tenant's drivers — see header note) ──────────────
	if err := database.DB.Scopes(auth.WithTenant(c)).Model(&models.Driver{}).
		Count(&resp.Drivers).Error; err != nil {
		fail(err)
		return
	}

	// ── Recent trips (newest first, max 10) ──────────────────────────────────
	var recent []models.LogisticsShipmentOrder
	if err := shipments().Order("created_at DESC").Limit(10).Find(&recent).Error; err != nil {
		fail(err)
		return
	}
	for i := range recent {
		s := &recent[i]
		created := slaISO(s.CreatedAt)
		resp.RecentTrips = append(resp.RecentTrips, logisticsStatsRecentTrip{
			ID:             s.ID,
			BookingRef:     s.ShipmentNo,
			Status:         s.Status,
			StartDate:      isoOrNil(s.PickupWindowFrom),
			EndDate:        isoOrNil(s.DeliveryWindowTo),
			OriginLocation: s.OriginName,
			Destination:    s.DestinationName,
			CustomerName:   s.CargoOwnerName,
			CreatedAt:      &created,
		})
	}

	c.JSON(http.StatusOK, resp)
}
