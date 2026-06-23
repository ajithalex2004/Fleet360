package handlers

// Logistics driver performance (Phase L4a) — the Go-native replacement for the
// Next.js GET /api/logistics/driver-stats endpoint. It powers two screens:
//   - the drivers roster (src/app/logistics/drivers/page.tsx), which fetches the
//     list form (?days=90, no driverId) and joins the stat fields onto the
//     separate /api/drivers roster by driverId; and
//   - the single-driver scorecard
//     (src/app/logistics/drivers/[id]/performance/page.tsx), which fetches the
//     object form (?driverId=…) and is the SOLE source of that driver's identity
//     and 12-week activity chart.
//
// WHY THIS IS A REWRITE, NOT A LINE-FOR-LINE PORT. Like the analytics and SLA
// endpoints, the legacy route reads the legacy `bookings` table
// (service_type = 'LOGISTICS', driver id dug out of a `notes` JSON blob) with NO
// tenant filter, and it selects a `phone` column off `drivers` that does not
// exist in the live schema (the column is `contact_number`). Both the bookings
// scan and the drivers scan therefore throw at runtime and fall through to their
// `.catch(() => [])`, so the legacy scorecards already render empty. The
// canonical trip data lives in logistics_shipment_orders, and a driver is linked
// to a shipment in two places — the denormalised assigned_driver_id FK on the
// shipment, and the logistics_assignments dispatch record (driver_id). This
// handler recomputes the same response contract from those tables, behind
// auth.WithTenant.
//
// TRIP GRAIN: a driver's trips are the UNION of the shipments whose
// assigned_driver_id is that driver and the shipments reached through an
// assignment row with that driver_id, DEDUPED by shipment. Crediting both
// sources means a driver is counted whether the dispatch wrote the FK, the
// assignment record, or (the common case) both. All per-trip metrics are read
// from the shipment row itself, so the two link paths produce identical metrics.
//
// METRIC PARITY vs the legacy route, with the same canonical-rewrite changes the
// analytics endpoint made:
//   - completed / cancelled status buckets are verbatim
//     (completedShipmentStatuses = CLOSED/COMPLETED/DELIVERED/POD_SUBMITTED;
//     cancelled = CANCELLED).
//   - on-time is computed for real instead of the legacy stub (which returned
//     `true` for every completed trip → a meaningless 100%). A completed trip is
//     on time if it carries no delivery deadline or was last updated on/before
//     delivery_window_to — the same definition the analytics on-time rate uses,
//     with updated_at standing in for the (unmodelled) actual delivery time.
//   - average trip duration substitutes the shipment's planned window
//     (pickup_window_from → delivery_window_to) for the legacy booking
//     start_date → end_date, the same substitution analytics made; the
//     0 < h < 720 outlier filter is unchanged.
//   - the composite score is byte-identical:
//     completion*0.50 + onTime*0.30 + (100 − cancellation)*0.20, rounded. A
//     zero-trip driver still scores 20 (0 + 0 + 100*0.20), matching the legacy
//     arithmetic.
//   - lastTripDate is the most recent trip's created_at as an ISO instant, and
//     the single-driver weekly chart reproduces the legacy 12-week Sunday-start
//     buckets (its "onTime" series is the per-week completed count, as in the
//     legacy code).
//
// The `days` lookback window filters trips by created_at, exactly as the legacy
// route did (default 90); the 12-week chart still iterates a fixed 12 weeks, so a
// days < ~84 window leaves the earliest weeks empty — a pre-existing quirk kept
// for fidelity.
//
// Unlike the legacy route, a hard DB error returns 500 rather than masking to an
// empty body — these are tenant-scoped queries against columns that exist, so a
// failure is a real fault. The list form returns [] for a tenant with no drivers
// and the object form returns null for an unknown/foreign driver, matching the
// legacy contract the pages branch on.

import (
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/models"

	"github.com/gin-gonic/gin"
)

// driverIdentity is the slice of the drivers table the scorecard needs. phone is
// aliased from contact_number (the legacy `phone` column does not exist); the
// roster page reads identity from /api/drivers, so only the single-driver form
// actually surfaces these.
type driverIdentity struct {
	ID            string  `gorm:"column:id"`
	FirstName     *string `gorm:"column:first_name"`
	LastName      *string `gorm:"column:last_name"`
	Phone         *string `gorm:"column:phone"`
	LicenseNumber *string `gorm:"column:license_number"`
}

// driverTrip is one (driver, shipment) row from either link source. Metrics come
// from the shipment, so both sources scan into this same shape.
type driverTrip struct {
	DriverID   string     `gorm:"column:driver_id"`
	ShipmentID string     `gorm:"column:shipment_id"`
	Status     string     `gorm:"column:status"`
	CreatedAt  time.Time  `gorm:"column:created_at"`
	PickupFrom *time.Time `gorm:"column:pickup_from"`
	DeliveryTo *time.Time `gorm:"column:delivery_to"`
	UpdatedAt  time.Time  `gorm:"column:updated_at"`
}

// driverStat is the exact JSON object the scorecard/roster consume. firstName /
// lastName are plain strings (the page indexes firstName[0]); null names
// coalesce to "" so that access is safe. phone / licenseNumber / avgTripHours /
// lastTripDate are nullable.
type driverStat struct {
	DriverID         string   `json:"driverId"`
	FirstName        string   `json:"firstName"`
	LastName         string   `json:"lastName"`
	Phone            *string  `json:"phone"`
	LicenseNumber    *string  `json:"licenseNumber"`
	TotalTrips       int      `json:"totalTrips"`
	CompletedTrips   int      `json:"completedTrips"`
	CancelledTrips   int      `json:"cancelledTrips"`
	OnTimeTrips      int      `json:"onTimeTrips"`
	CompletionRate   int      `json:"completionRate"`
	OnTimeRate       int      `json:"onTimeRate"`
	CancellationRate int      `json:"cancellationRate"`
	AvgTripHours     *float64 `json:"avgTripHours"`
	LastTripDate     *string  `json:"lastTripDate"`
	Score            int      `json:"score"`
}

// weeklyEntry is one bar of the single-driver 12-week activity chart.
type weeklyEntry struct {
	Week   string `json:"week"`
	Trips  int    `json:"trips"`
	OnTime int    `json:"onTime"`
}

// driverStatWithWeekly is the single-driver object form: the stat fields inlined
// (embedded) plus the weekly series, mirroring the legacy `{...stats[0], weekly}`.
type driverStatWithWeekly struct {
	driverStat
	Weekly []weeklyEntry `json:"weekly"`
}

// isCompletedShipmentStatus reports whether a status counts as a completed trip,
// using the same set as the analytics endpoint and the legacy route.
func isCompletedShipmentStatus(s string) bool {
	switch s {
	case "CLOSED", "COMPLETED", "DELIVERED", "POD_SUBMITTED":
		return true
	}
	return false
}

// strOrEmpty dereferences a *string, treating nil as "".
func strOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// GetLogisticsDriverStats returns tenant-scoped logistics driver performance:
// the object form (with weekly chart) when ?driverId is given, else the roster
// list sorted by score descending.
func GetLogisticsDriverStats(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	now := time.Now()
	fail := func(err error) { c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()}) }

	driverID := c.Query("driverId")
	days, _ := strconv.Atoi(c.DefaultQuery("days", "90"))
	if days <= 0 {
		days = 90
	}
	since := now.Add(-time.Duration(days) * 24 * time.Hour)

	// ── 1. Resolve the target drivers (tenant-scoped, not soft-deleted) ──────
	var drivers []driverIdentity
	q := database.DB.Table("drivers").
		Scopes(auth.WithTenant(c)).
		Select("id, first_name, last_name, contact_number AS phone, license_number").
		Where("deleted_at IS NULL")
	if driverID != "" {
		q = q.Where("id = ?", driverID).Limit(1)
	} else {
		q = q.Order("first_name ASC").Limit(200)
	}
	if err := q.Scan(&drivers).Error; err != nil {
		fail(err)
		return
	}

	if len(drivers) == 0 {
		// Legacy contract: object form → null, list form → [].
		if driverID != "" {
			c.JSON(http.StatusOK, nil)
		} else {
			c.JSON(http.StatusOK, []driverStat{})
		}
		return
	}

	driverIDs := make([]string, 0, len(drivers))
	for _, d := range drivers {
		driverIDs = append(driverIDs, d.ID)
	}

	// ── 2. Gather trips from both link sources, deduped by shipment ──────────
	// Source A: shipments whose denormalised assigned_driver_id is the driver.
	var rowsA []driverTrip
	if err := database.DB.Model(&models.LogisticsShipmentOrder{}).
		Scopes(auth.WithTenant(c)).
		Select("assigned_driver_id AS driver_id, id AS shipment_id, status, created_at, pickup_window_from AS pickup_from, delivery_window_to AS delivery_to, updated_at").
		Where("assigned_driver_id IN ?", driverIDs).
		Where("created_at >= ?", since).
		Scan(&rowsA).Error; err != nil {
		fail(err)
		return
	}

	// Source B: shipments reached through an assignment row for the driver.
	// This join spans two tenant-scoped tables, so bind the tenant explicitly on
	// the driving table (a bare WithTenant scope would make tenant_id ambiguous)
	// and re-assert the shipment soft-delete predicate the join bypasses.
	var rowsB []driverTrip
	if err := database.DB.Table("logistics_assignments AS la").
		Select("la.driver_id AS driver_id, lso.id AS shipment_id, lso.status, lso.created_at, lso.pickup_window_from AS pickup_from, lso.delivery_window_to AS delivery_to, lso.updated_at").
		Joins("JOIN logistics_shipment_orders lso ON lso.id = la.shipment_order_id AND lso.deleted_at IS NULL").
		Where("la.tenant_id = ?", tid).
		Where("la.driver_id IN ?", driverIDs).
		Where("lso.created_at >= ?", since).
		Scan(&rowsB).Error; err != nil {
		fail(err)
		return
	}

	// driverID → shipmentID → trip. Overwriting on a duplicate (driver, shipment)
	// is a no-op since both sources read the same shipment row.
	byDriver := make(map[string]map[string]driverTrip, len(drivers))
	add := func(t driverTrip) {
		if t.DriverID == "" || t.ShipmentID == "" {
			return
		}
		m := byDriver[t.DriverID]
		if m == nil {
			m = make(map[string]driverTrip)
			byDriver[t.DriverID] = m
		}
		m[t.ShipmentID] = t
	}
	for _, t := range rowsA {
		add(t)
	}
	for _, t := range rowsB {
		add(t)
	}

	// ── 3. Per-driver stat computation ───────────────────────────────────────
	buildStat := func(d driverIdentity) driverStat {
		trips := byDriver[d.ID] // may be nil → zero-trip driver
		total := len(trips)
		var completed, cancelled, onTime int
		var durations []float64
		var lastTrip *time.Time
		for _, t := range trips {
			if t.Status == "CANCELLED" {
				cancelled++
			}
			if isCompletedShipmentStatus(t.Status) {
				completed++
				// On time: no deadline, or last update on/before the deadline.
				if t.DeliveryTo == nil || !t.UpdatedAt.After(*t.DeliveryTo) {
					onTime++
				}
				// Planned-window duration, outliers (> 30 days, ≤ 0) dropped.
				if t.PickupFrom != nil && t.DeliveryTo != nil {
					h := t.DeliveryTo.Sub(*t.PickupFrom).Hours()
					if h > 0 && h < 720 {
						durations = append(durations, h)
					}
				}
			}
			if lastTrip == nil || t.CreatedAt.After(*lastTrip) {
				ct := t.CreatedAt
				lastTrip = &ct
			}
		}

		completionRate := roundPct(int64(completed), int64(total))
		onTimeRate := roundPct(int64(onTime), int64(completed))
		cancellationRate := roundPct(int64(cancelled), int64(total))
		score := int(math.Round(
			float64(completionRate)*0.50 +
				float64(onTimeRate)*0.30 +
				float64(100-cancellationRate)*0.20,
		))

		var avg *float64
		if len(durations) > 0 {
			sum := 0.0
			for _, h := range durations {
				sum += h
			}
			v := math.Round(sum/float64(len(durations))*10) / 10
			avg = &v
		}
		var lastISO *string
		if lastTrip != nil {
			s := slaISO(*lastTrip)
			lastISO = &s
		}

		return driverStat{
			DriverID:         d.ID,
			FirstName:        strOrEmpty(d.FirstName),
			LastName:         strOrEmpty(d.LastName),
			Phone:            d.Phone,
			LicenseNumber:    d.LicenseNumber,
			TotalTrips:       total,
			CompletedTrips:   completed,
			CancelledTrips:   cancelled,
			OnTimeTrips:      onTime,
			CompletionRate:   completionRate,
			OnTimeRate:       onTimeRate,
			CancellationRate: cancellationRate,
			AvgTripHours:     avg,
			LastTripDate:     lastISO,
			Score:            score,
		}
	}

	// ── 4a. Single-driver object form (+ 12-week chart) ──────────────────────
	if driverID != "" {
		d := drivers[0]
		trips := byDriver[d.ID]
		weekly := make([]weeklyEntry, 0, 12)
		for w := 11; w >= 0; w-- {
			base := now.AddDate(0, 0, -7*w)
			y, m, dd := base.Date()
			midnight := time.Date(y, m, dd, 0, 0, 0, 0, now.Location())
			weekStart := midnight.AddDate(0, 0, -int(midnight.Weekday())) // back to Sunday
			weekEnd := weekStart.Add(7 * 24 * time.Hour)
			cnt, on := 0, 0
			for _, t := range trips {
				if !t.CreatedAt.Before(weekStart) && t.CreatedAt.Before(weekEnd) {
					cnt++
					if isCompletedShipmentStatus(t.Status) {
						on++
					}
				}
			}
			weekly = append(weekly, weeklyEntry{
				Week:   weekStart.Format("02 Jan"),
				Trips:  cnt,
				OnTime: on,
			})
		}
		c.JSON(http.StatusOK, driverStatWithWeekly{driverStat: buildStat(d), Weekly: weekly})
		return
	}

	// ── 4b. Roster list form, sorted by score descending ────────────────────
	out := make([]driverStat, 0, len(drivers))
	for _, d := range drivers {
		out = append(out, buildStat(d))
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	c.JSON(http.StatusOK, out)
}
