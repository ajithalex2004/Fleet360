package handlers

// Logistics live tracking (Phase L4a) — the Go-native replacement for the
// Next.js GET /api/logistics/tracking endpoint that feeds the live map +
// sidebar on the tracking page (src/app/logistics/tracking/page.tsx). The page
// polls this every 15s and plots one marker per active trip.
//
// WHY THIS IS A REWRITE, NOT A LINE-FOR-LINE PORT. Like the analytics, SLA and
// driver-stats endpoints, the legacy route scans the legacy `bookings` table
// (service_type = 'LOGISTICS') with NO tenant filter — a cross-tenant leak — and
// digs origin/destination/driverName/vehiclePlate/shipmentType out of a `notes`
// JSON blob, while GPS comes from JSON stuffed into trip_status_history.note.
// That table is also the wrong source now (it lacks the logistics columns), so
// the legacy query already throws and falls through to `.catch(() => [])`. The
// canonical trip + GPS data lives in logistics_shipment_orders +
// logistics_tracking_events + logistics_pod_events, which this handler reads
// behind auth.WithTenant.
//
// GPS PRIORITY, preserving the legacy three-tier fallback exactly so the map's
// position.source switch (driver_update | epod | estimated) is unchanged:
//   1. driver_update — the latest logistics_tracking_events row for the shipment
//      that carries a real lat/lng (the canonical home of the GPS pings the
//      legacy route hunted for in trip_status_history.note JSON). DISTINCT ON
//      keeps only the most recent ping per shipment.
//   2. epod         — the shipment's proof-of-delivery capture GPS
//      (logistics_pod_events.gps, a JSONB {lat,lng}), the same ePOD GPS the
//      legacy route read from notes.pod.gps. Currently dormant (no pod rows carry
//      gps yet) but wired faithfully.
//   3. estimated    — the legacy Dubai-jitter fallback, byte-identical: a
//      deterministic offset seeded from the first two id characters so a trip
//      with no telemetry still gets a stable pin. This is the ONLY source the map
//      flags with an "estimated position" warning, so keeping the exact formula
//      matters.
// position is ALWAYS non-null (the page dereferences position.lat/lng/source
// without a guard) — every trip falls through to the estimated pin at worst.
//
// CANONICAL ENRICHMENT (strictly better than the legacy notes-blob reads):
//   - driverName resolves assigned_driver_id against the drivers table
//     ("first last", falling back to name) instead of a denormalised notes field.
//   - vehiclePlate resolves assigned_vehicle_id via COALESCE(plate_number,
//     license_plate) — the same COALESCE the legacy route used, now keyed off the
//     real FK rather than a notes field.
//   - origin/destination/requestorName/shipmentType come from the real
//     origin_name / destination_name / cargo_owner_name / shipment_type columns.
//   - startDate/endDate map to pickup_window_from / delivery_window_to, the same
//     substitution the analytics endpoint made for the legacy start_date/end_date.
//
// The active-status set is verbatim from the legacy route
// (DISPATCHED…DELIVERED). Unlike the legacy route, a hard DB error returns 500
// rather than masking to an empty array — these are tenant-scoped queries against
// columns that exist, so a failure is a real fault; the page only swaps in new
// data on res.ok, so a 500 leaves the last good render in place.

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/models"

	"github.com/gin-gonic/gin"
)

// trackingActiveStatuses is the in-transit set the legacy route scanned, verbatim.
var trackingActiveStatuses = []string{
	"DISPATCHED", "ENROUTE_PICKUP", "LOADED", "ENROUTE_DELIVERY", "ACTIVE", "DELIVERED",
}

// trackingPosition is the always-present GPS object the map consumes. source is
// one of driver_update | epod | estimated; only estimated triggers the page's
// "estimated position" warning.
type trackingPosition struct {
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
	Ts     string  `json:"ts"`
	Source string  `json:"source"`
}

// trackingTrip is one element of the array the tracking page renders. Every
// string field is nullable to match the page's TripPosition interface; position
// is the one non-null object.
type trackingTrip struct {
	ID            string           `json:"id"`
	BookingRef    string           `json:"bookingRef"`
	Status        string           `json:"status"`
	RequestorName *string          `json:"requestorName"`
	Origin        *string          `json:"origin"`
	Destination   *string          `json:"destination"`
	DriverName    *string          `json:"driverName"`
	VehiclePlate  *string          `json:"vehiclePlate"`
	ShipmentType  *string          `json:"shipmentType"`
	StartDate     *string          `json:"startDate"`
	EndDate       *string          `json:"endDate"`
	Position      trackingPosition `json:"position"`
}

// GetLogisticsTracking returns the tenant-scoped set of active logistics trips
// (max 50) with each trip's last-known position resolved through the
// driver_update → epod → estimated fallback chain.
func GetLogisticsTracking(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	fail := func(err error) { c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()}) }

	// ── 1. Active trips (legacy: bookings → logistics_shipment_orders) ───────
	var shipments []models.LogisticsShipmentOrder
	if err := database.DB.Scopes(auth.WithTenant(c)).
		Where("status IN ?", trackingActiveStatuses).
		Order("pickup_window_from DESC NULLS LAST").
		Order("created_at DESC").
		Limit(50).
		Find(&shipments).Error; err != nil {
		fail(err)
		return
	}
	if len(shipments) == 0 {
		c.JSON(http.StatusOK, []trackingTrip{})
		return
	}

	// Collect the ids the enrichment queries need.
	shipmentIDs := make([]string, 0, len(shipments))
	driverIDset := make(map[string]struct{})
	vehicleIDset := make(map[string]struct{})
	for i := range shipments {
		s := &shipments[i]
		shipmentIDs = append(shipmentIDs, s.ID)
		if s.AssignedDriverID != nil && *s.AssignedDriverID != "" {
			driverIDset[*s.AssignedDriverID] = struct{}{}
		}
		if s.AssignedVehicleID != nil && *s.AssignedVehicleID != "" {
			vehicleIDset[*s.AssignedVehicleID] = struct{}{}
		}
	}

	// ── 2. Latest GPS ping per shipment (source: driver_update) ──────────────
	// DISTINCT ON keeps the most recent ping. Raw bypasses GORM scopes, so the
	// tenant is bound explicitly.
	type gpsPing struct {
		ShipmentOrderID string    `gorm:"column:shipment_order_id"`
		Latitude        float64   `gorm:"column:latitude"`
		Longitude       float64   `gorm:"column:longitude"`
		OccurredAt      time.Time `gorm:"column:occurred_at"`
	}
	pingByShip := make(map[string]gpsPing)
	{
		var pings []gpsPing
		if err := database.DB.Raw(`
			SELECT DISTINCT ON (shipment_order_id)
			       shipment_order_id, latitude, longitude, occurred_at
			  FROM logistics_tracking_events
			 WHERE tenant_id = ?
			   AND shipment_order_id IN ?
			   AND latitude IS NOT NULL AND longitude IS NOT NULL
			 ORDER BY shipment_order_id, occurred_at DESC`,
			tid, shipmentIDs).Scan(&pings).Error; err != nil {
			fail(err)
			return
		}
		for _, p := range pings {
			pingByShip[p.ShipmentOrderID] = p
		}
	}

	// ── 3. ePOD capture GPS per shipment (source: epod) ──────────────────────
	// gps is JSONB {lat,lng[,accuracy]}; read it as text and parse. Falls back to
	// created_at for the timestamp when delivered_at is null.
	type epodPos struct {
		Lat float64
		Lng float64
		Ts  string
	}
	podByShip := make(map[string]epodPos)
	{
		type podRow struct {
			ShipmentOrderID string     `gorm:"column:shipment_order_id"`
			GPS             string     `gorm:"column:gps"`
			DeliveredAt     *time.Time `gorm:"column:delivered_at"`
			CreatedAt       time.Time  `gorm:"column:created_at"`
		}
		var pods []podRow
		if err := database.DB.Raw(`
			SELECT DISTINCT ON (shipment_order_id)
			       shipment_order_id, gps::text AS gps, delivered_at, created_at
			  FROM logistics_pod_events
			 WHERE tenant_id = ?
			   AND shipment_order_id IN ?
			   AND gps IS NOT NULL
			 ORDER BY shipment_order_id, created_at DESC`,
			tid, shipmentIDs).Scan(&pods).Error; err != nil {
			fail(err)
			return
		}
		for _, p := range pods {
			var g struct {
				Lat *float64 `json:"lat"`
				Lng *float64 `json:"lng"`
			}
			if err := json.Unmarshal([]byte(p.GPS), &g); err != nil || g.Lat == nil || g.Lng == nil {
				continue // malformed or missing coords → let it fall to estimated
			}
			ts := p.CreatedAt
			if p.DeliveredAt != nil {
				ts = *p.DeliveredAt
			}
			podByShip[p.ShipmentOrderID] = epodPos{Lat: *g.Lat, Lng: *g.Lng, Ts: slaISO(ts)}
		}
	}

	// ── 4. Driver display names (assigned_driver_id → "first last") ──────────
	nameByID := make(map[string]string)
	if len(driverIDset) > 0 {
		ids := keysOf(driverIDset)
		type drvRow struct {
			ID        string  `gorm:"column:id"`
			FirstName *string `gorm:"column:first_name"`
			LastName  *string `gorm:"column:last_name"`
			Name      *string `gorm:"column:name"`
		}
		var rows []drvRow
		if err := database.DB.Table("drivers").Scopes(auth.WithTenant(c)).
			Select("id, first_name, last_name, name").
			Where("id IN ?", ids).
			Where("deleted_at IS NULL").
			Scan(&rows).Error; err != nil {
			fail(err)
			return
		}
		for _, d := range rows {
			full := strings.TrimSpace(strOrEmpty(d.FirstName) + " " + strOrEmpty(d.LastName))
			if full == "" {
				full = strOrEmpty(d.Name)
			}
			if full != "" {
				nameByID[d.ID] = full
			}
		}
	}

	// ── 5. Vehicle plates (assigned_vehicle_id → COALESCE(plate_number,…)) ────
	plateByID := make(map[string]string)
	if len(vehicleIDset) > 0 {
		ids := keysOf(vehicleIDset)
		type vehRow struct {
			ID    string  `gorm:"column:id"`
			Plate *string `gorm:"column:plate"`
		}
		var rows []vehRow
		if err := database.DB.Table("vehicles").Scopes(auth.WithTenant(c)).
			Select("id, COALESCE(plate_number, license_plate) AS plate").
			Where("id IN ?", ids).
			Where("deleted_at IS NULL").
			Scan(&rows).Error; err != nil {
			fail(err)
			return
		}
		for _, v := range rows {
			if v.Plate != nil && *v.Plate != "" {
				plateByID[v.ID] = *v.Plate
			}
		}
	}

	// ── 6. Assemble the response array ───────────────────────────────────────
	out := make([]trackingTrip, 0, len(shipments))
	for i := range shipments {
		s := &shipments[i]

		// Resolve position through the three-tier fallback.
		var pos trackingPosition
		if ping, ok := pingByShip[s.ID]; ok {
			pos = trackingPosition{Lat: ping.Latitude, Lng: ping.Longitude, Ts: slaISO(ping.OccurredAt), Source: "driver_update"}
		} else if pe, ok := podByShip[s.ID]; ok {
			pos = trackingPosition{Lat: pe.Lat, Lng: pe.Lng, Ts: pe.Ts, Source: "epod"}
		} else {
			// Legacy Dubai-jitter fallback, byte-identical: seed from the first two
			// id characters (id is a 36-char UUID, so [0]/[1] always exist).
			seed := int(s.ID[0]) + int(s.ID[1])
			ts := ""
			if s.PickupWindowFrom != nil {
				ts = slaISO(*s.PickupWindowFrom)
			}
			pos = trackingPosition{
				Lat:    25.1972 + float64(seed%100)*0.002 - 0.1,
				Lng:    55.2797 + float64(seed%50)*0.003 - 0.075,
				Ts:     ts,
				Source: "estimated",
			}
		}

		var driverName *string
		if s.AssignedDriverID != nil {
			if n, ok := nameByID[*s.AssignedDriverID]; ok {
				driverName = &n
			}
		}
		var plate *string
		if s.AssignedVehicleID != nil {
			if p, ok := plateByID[*s.AssignedVehicleID]; ok {
				plate = &p
			}
		}

		out = append(out, trackingTrip{
			ID:            s.ID,
			BookingRef:    s.ShipmentNo,
			Status:        s.Status,
			RequestorName: s.CargoOwnerName,
			Origin:        s.OriginName,
			Destination:   s.DestinationName,
			DriverName:    driverName,
			VehiclePlate:  plate,
			ShipmentType:  s.ShipmentType,
			StartDate:     isoOrNil(s.PickupWindowFrom),
			EndDate:       isoOrNil(s.DeliveryWindowTo),
			Position:      pos,
		})
	}

	c.JSON(http.StatusOK, out)
}

// keysOf returns the keys of a set as a slice (order unspecified).
func keysOf(set map[string]struct{}) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	return out
}

// isoOrNil formats a nullable time as a legacy-style ISO instant, or nil.
func isoOrNil(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := slaISO(*t)
	return &s
}
