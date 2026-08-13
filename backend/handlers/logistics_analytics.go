package handlers

// Logistics analytics (Phase L4a) — the Go-native replacement for the Next.js
// GET /api/logistics/analytics KPI dashboard endpoint.
//
// WHY THIS IS A REWRITE, NOT A LINE-FOR-LINE PORT. The Next.js endpoint queries
// the legacy `bookings` table (`service_type = 'LOGISTICS'`) with NO tenant
// filter — a cross-tenant leak by construction. But that table is also the wrong
// source now: at runtime `bookings` has no `deleted_at` column and none of the
// logistics display columns the queries reference (origin_location, destination,
// customer_name, …), so every analytics query there throws and falls through to
// its `.catch(() => 0/[])` — the legacy dashboard already returns zeros. The real
// logistics data lives in `logistics_shipment_orders` (the table Phases L0–L3
// built the Go models around), which carries a proper tenant_id and real columns
// (shipment_type, origin_name, customer_rate_amount, delivery_window_to) where
// the legacy queries dug values out of a `notes` JSON blob.
//
// So this handler computes the SAME response contract the analytics page consumes
// (totalTrips, completedTrips, … dailyCompleted, statusDistribution, tripsByDow,
// shipmentTypes — see src/app/logistics/analytics/page.tsx), but against
// logistics_shipment_orders, behind auth.WithTenant. The single change in
// behaviour is the fix itself: each tenant now sees only its own shipments.
//
// Faithful-mapping notes (vs src/app/api/logistics/analytics/route.ts):
//   - Status buckets are verbatim from the route + domain.ts
//     (TERMINAL_SHIPMENT_STATUSES / IN_TRANSIT_SHIPMENT_STATUSES). pendingTrips
//     stays status = 'PENDING' exactly — and that is also where the live data
//     sits (the dominant LSO status), so the bucket is not just faithful but
//     populated.
//   - Three columns are substituted because `bookings` and
//     logistics_shipment_orders model the trip differently, but the intent is
//     identical: start_date → pickup_window_from (trip start, for day-of-week),
//     end_date → delivery_window_to (the on-time deadline), and the
//     notes::json->>'shipmentType' parse → the real shipment_type column.
//   - Vehicle predicates are byte-identical to the legacy route
//     (vehicle_usage = 'LOGISTICS', status = 'AVAILABLE' / 'MAINTENANCE'); only
//     tenant scoping is added. deleted_at IS NULL is injected automatically by
//     the embedded Model on both Vehicle and LogisticsShipmentOrder.
//
// Unlike the legacy route, a hard DB error returns 500 rather than masking to a
// zero-filled body: these are tenant-scoped queries against columns that exist,
// so a failure is a real fault worth surfacing. The analytics page only swaps in
// new data on res.ok, so a 500 simply leaves the last good render in place.

import (
	"math"
	"net/http"

	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Shipment-status buckets, verbatim from the Next.js analytics route and
// domain.ts. completedShipmentStatuses excludes CANCELLED (cancelled trips are
// counted separately); activeShipmentStatuses is the in-transit set.
var (
	completedShipmentStatuses = []string{"CLOSED", "COMPLETED", "DELIVERED", "POD_SUBMITTED"}
	activeShipmentStatuses    = []string{"DISPATCHED", "ENROUTE_PICKUP", "LOADED", "ENROUTE_DELIVERY", "ACTIVE"}
)

// dowLabels maps Postgres EXTRACT(DOW) (0=Sunday) to the short label the chart
// renders, mirroring the array in the analytics route.
var dowLabels = []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}

type analyticsDailyPoint struct {
	Day   string `json:"day"`
	Trips int64  `json:"trips"`
}

type analyticsStatusCount struct {
	Status string `json:"status"`
	Count  int64  `json:"count"`
}

type analyticsDowPoint struct {
	Dow   int    `json:"dow"`
	Label string `json:"label"`
	Trips int64  `json:"trips"`
}

type analyticsTypeCount struct {
	Type  string `json:"type"`
	Count int64  `json:"count"`
}

// logisticsAnalyticsResponse is the exact JSON contract the analytics page
// (src/app/logistics/analytics/page.tsx, interface Analytics) expects. Slice
// fields must serialise as [] (never null) — the page calls .map()/.length on
// them — so they are initialised to empty slices below.
type logisticsAnalyticsResponse struct {
	TotalTrips          int64                  `json:"totalTrips"`
	CompletedTrips      int64                  `json:"completedTrips"`
	CancelledTrips      int64                  `json:"cancelledTrips"`
	PendingTrips        int64                  `json:"pendingTrips"`
	ActiveTrips         int64                  `json:"activeTrips"`
	CompletionRate      int                    `json:"completionRate"`
	CancellationRate    int                    `json:"cancellationRate"`
	OnTimeRate          *int                   `json:"onTimeRate"`
	TotalVehicles       int64                  `json:"totalVehicles"`
	AvailableVehicles   int64                  `json:"availableVehicles"`
	MaintenanceVehicles int64                  `json:"maintenanceVehicles"`
	FleetUtilization    int                    `json:"fleetUtilization"`
	DailyCompleted      []analyticsDailyPoint  `json:"dailyCompleted"`
	StatusDistribution  []analyticsStatusCount `json:"statusDistribution"`
	TripsByDow          []analyticsDowPoint    `json:"tripsByDow"`
	ShipmentTypes       []analyticsTypeCount   `json:"shipmentTypes"`
}

// roundPct returns Math.round(num / den * 100) as an int, matching the JS
// rounding in the analytics route (half away from zero ≡ JS round for the
// non-negative ratios here). Returns 0 when den is 0.
func roundPct(num, den int64) int {
	if den <= 0 {
		return 0
	}
	return int(math.Round(float64(num) / float64(den) * 100))
}

// GetLogisticsAnalytics returns the tenant-scoped logistics KPI dashboard,
// computed from logistics_shipment_orders (+ the tenant's LOGISTICS vehicles).
func GetLogisticsAnalytics(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}

	// Every shipment query starts from this tenant-scoped, soft-delete-aware
	// base. auth.WithTenant injects WHERE tenant_id = ?; the embedded Model on
	// LogisticsShipmentOrder injects deleted_at IS NULL. Build a fresh query
	// each time (chaining mutates the shared *gorm.DB).
	shipments := func() *gorm.DB {
		return database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsShipmentOrder{})
	}
	vehicles := func() *gorm.DB {
		return database.DB.Scopes(auth.WithTenant(c)).Model(&models.Vehicle{}).
			Where("vehicle_usage = ?", "LOGISTICS")
	}

	fail := func(err error) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}

	// ── Core shipment counts ─────────────────────────────────────────────────
	var total, completed, cancelled, pending, active int64
	if err := shipments().Count(&total).Error; err != nil {
		fail(err)
		return
	}
	if err := shipments().Where("status IN ?", completedShipmentStatuses).Count(&completed).Error; err != nil {
		fail(err)
		return
	}
	if err := shipments().Where("status = ?", "CANCELLED").Count(&cancelled).Error; err != nil {
		fail(err)
		return
	}
	if err := shipments().Where("status = ?", "PENDING").Count(&pending).Error; err != nil {
		fail(err)
		return
	}
	if err := shipments().Where("status IN ?", activeShipmentStatuses).Count(&active).Error; err != nil {
		fail(err)
		return
	}

	// ── Vehicle stats (this tenant's LOGISTICS fleet) ────────────────────────
	var totalVeh, availVeh, maintVeh int64
	if err := vehicles().Count(&totalVeh).Error; err != nil {
		fail(err)
		return
	}
	if err := vehicles().Where("status = ?", "AVAILABLE").Count(&availVeh).Error; err != nil {
		fail(err)
		return
	}
	if err := vehicles().Where("status = ?", "MAINTENANCE").Count(&maintVeh).Error; err != nil {
		fail(err)
		return
	}

	// ── On-time rate: completed shipments delivered by their delivery window ──
	var onTimeCount, deadlineCount int64
	if err := shipments().Where("status IN ?", completedShipmentStatuses).
		Where("delivery_window_to IS NOT NULL").Count(&deadlineCount).Error; err != nil {
		fail(err)
		return
	}
	if err := shipments().Where("status IN ?", completedShipmentStatuses).
		Where("delivery_window_to IS NOT NULL").
		Where("updated_at <= delivery_window_to").Count(&onTimeCount).Error; err != nil {
		fail(err)
		return
	}

	resp := logisticsAnalyticsResponse{
		TotalTrips:          total,
		CompletedTrips:      completed,
		CancelledTrips:      cancelled,
		PendingTrips:        pending,
		ActiveTrips:         active,
		CompletionRate:      roundPct(completed, total),
		CancellationRate:    roundPct(cancelled, total),
		TotalVehicles:       totalVeh,
		AvailableVehicles:   availVeh,
		MaintenanceVehicles: maintVeh,
		FleetUtilization:    roundPct(totalVeh-availVeh, totalVeh),
		// Initialise to empty slices so the JSON body carries [] not null.
		DailyCompleted:     make([]analyticsDailyPoint, 0),
		StatusDistribution: make([]analyticsStatusCount, 0),
		TripsByDow:         make([]analyticsDowPoint, 0),
		ShipmentTypes:      make([]analyticsTypeCount, 0),
	}
	if deadlineCount > 0 {
		r := roundPct(onTimeCount, deadlineCount)
		resp.OnTimeRate = &r
	}

	// ── Completed trips per day (last 14 days) ───────────────────────────────
	// updated_at::date is the completion day; TO_CHAR yields a stable
	// 'YYYY-MM-DD' string the chart parses directly.
	if err := shipments().
		Select("TO_CHAR(updated_at::date, 'YYYY-MM-DD') AS day, COUNT(*) AS trips").
		Where("status IN ?", completedShipmentStatuses).
		Where("updated_at >= NOW() - INTERVAL '14 days'").
		Group("updated_at::date").
		Order("updated_at::date ASC").
		Scan(&resp.DailyCompleted).Error; err != nil {
		fail(err)
		return
	}

	// ── Status distribution ──────────────────────────────────────────────────
	if err := shipments().
		Select("status, COUNT(*) AS count").
		Group("status").
		Order("count DESC").
		Scan(&resp.StatusDistribution).Error; err != nil {
		fail(err)
		return
	}

	// ── Trips by day of week (by pickup window start) ────────────────────────
	var dowRows []struct {
		Dow   int   `gorm:"column:dow"`
		Trips int64 `gorm:"column:trips"`
	}
	if err := shipments().
		Select("EXTRACT(DOW FROM pickup_window_from)::int AS dow, COUNT(*) AS trips").
		Where("pickup_window_from IS NOT NULL").
		Group("EXTRACT(DOW FROM pickup_window_from)").
		Order("dow ASC").
		Scan(&dowRows).Error; err != nil {
		fail(err)
		return
	}
	for _, r := range dowRows {
		label := ""
		if r.Dow >= 0 && r.Dow < len(dowLabels) {
			label = dowLabels[r.Dow]
		}
		resp.TripsByDow = append(resp.TripsByDow, analyticsDowPoint{Dow: r.Dow, Label: label, Trips: r.Trips})
	}

	// ── Shipment type breakdown (real shipment_type column) ──────────────────
	if err := shipments().
		Select("COALESCE(shipment_type, 'UNSPECIFIED') AS type, COUNT(*) AS count").
		Group("COALESCE(shipment_type, 'UNSPECIFIED')").
		Order("count DESC").
		Limit(8).
		Scan(&resp.ShipmentTypes).Error; err != nil {
		fail(err)
		return
	}

	c.JSON(http.StatusOK, resp)
}
