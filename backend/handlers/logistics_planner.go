package handlers

// Logistics route planner (Phase L4c) — the Go port of
// src/lib/logistics/route-optimizer-service.ts plus the seven Next.js planner
// route handlers (src/app/api/logistics/planner/**).
//
// The pure solver lives in package routeopt and the distance matrix in package
// distmatrix; this file is the service layer that the TS original calls
// "route-optimizer-service": it loads tenant-scoped vehicles / shipments /
// stops, geocodes any stop missing coordinates (logistics_geocoder.go), builds
// the solver input, persists the plan, and serves the commit / edit / discard /
// list lifecycle. Every query runs behind auth.WithTenant(c) — the whole point
// of moving this surface off the raw-SQL Next.js routes.
//
// Two deliberate hardenings over the TS original, both tenant-safety:
//   - The vehicles read is tenant-scoped here. The TS route loads vehicles by id
//     with NO tenant filter (`WHERE id = ANY($1) AND deleted_at IS NULL`); behind
//     auth.WithTenant a tenant can only ever pull its own trucks into a plan.
//   - tenant_id is always stamped from the token (requireTenant), never from the
//     request body, on both the plan and the assignments commit writes.
//
// Parity notes vs the TS service:
//   - Schema is NOT ensured here (the TS calls ensureRouteOptimizerSchema first).
//     Prisma/Next.js owns the schema; the tables already exist.
//   - getPlan / listPlans run .Unscoped() so soft-deleted (DISCARDED) plans are
//     still visible, matching the TS queries which omit `deleted_at IS NULL`.
//     commitPlan keeps the soft-delete filter, exactly like the TS commit query.
//   - The response `status` (COMPLETED / PARTIAL) is a solve-quality flag, NOT
//     the stored plan status — the row is always persisted DRAFT, as in the TS.

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/distmatrix"
	"fleet360-backend/geo"
	"fleet360-backend/models"
	"fleet360-backend/routeopt"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// maxSafeInteger mirrors JS Number.MAX_SAFE_INTEGER — the capacity-cbm fallback
// when a vehicle has no volume capacity configured (treated as effectively
// unbounded volume, exactly like the TS `num(payload_capacity_cbm, MAX)`).
const maxSafeInteger = 9007199254740991.0

// ── request / response shapes ────────────────────────────────────────────────

type optimizeRequest struct {
	VehicleIDs  []string       `json:"vehicleIds"`
	ShipmentIDs []string       `json:"shipmentIds"`
	Config      map[string]any `json:"config"`
}

// geocodeFailure is one stop that could not be resolved to coordinates. address
// is null when the stop carried no address text at all (matching the TS shape).
type geocodeFailure struct {
	StopID  string  `json:"stopId"`
	Address *string `json:"address"`
	Reason  string  `json:"reason"`
}

type optimizeResponse struct {
	PlanID          string           `json:"planId"`
	Status          string           `json:"status"`
	Result          routeopt.Result  `json:"result"`
	GeocodeFailures []geocodeFailure `json:"geocodeFailures"`
}

// planView is the {id, status, result} shape getPlan / revalidatePlan return,
// matching the TS getPlan return and the GET /plans/:id body.
type planView struct {
	ID     string          `json:"id"`
	Status string          `json:"status"`
	Result routeopt.Result `json:"result"`
}

// planListItem is one row of GET /plans. Keys are snake_case and the numeric
// columns are rendered as text (created_at::text, total_distance_km::text,
// estimated_cost::text) — byte-for-byte the contract the TS $queryRawUnsafe
// returned, which the plans UI consumes.
type planListItem struct {
	ID                string  `gorm:"column:id" json:"id"`
	Status            string  `gorm:"column:status" json:"status"`
	Algorithm         string  `gorm:"column:algorithm" json:"algorithm"`
	CreatedAt         string  `gorm:"column:created_at" json:"created_at"`
	CreatedBy         *string `gorm:"column:created_by" json:"created_by"`
	TotalDistanceKm   *string `gorm:"column:total_distance_km" json:"total_distance_km"`
	TotalDurationMin  *int    `gorm:"column:total_duration_min" json:"total_duration_min"`
	ShipmentsIn       *int    `gorm:"column:shipments_in" json:"shipments_in"`
	ShipmentsAssigned *int    `gorm:"column:shipments_assigned" json:"shipments_assigned"`
	VehiclesUsed      *int    `gorm:"column:vehicles_used" json:"vehicles_used"`
	EstimatedCost     *string `gorm:"column:estimated_cost" json:"estimated_cost"`
}

type plannerInputVehicle struct {
	ID         string   `json:"id"`
	Label      string   `json:"label"`
	CapacityKg *float64 `json:"capacityKg"`
}

type plannerInputShipment struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	WeightKg *float64 `json:"weightKg"`
}

type editRoute struct {
	VehicleID string   `json:"vehicleId"`
	StopOrder []string `json:"stopOrder"`
}

// ── DB scan rows ─────────────────────────────────────────────────────────────

type plannerVehicleRow struct {
	ID                 string   `gorm:"column:id"`
	LicensePlate       *string  `gorm:"column:license_plate"`
	PayloadCapacityKg  *float64 `gorm:"column:payload_capacity_kg"`
	PayloadCapacityCbm *float64 `gorm:"column:payload_capacity_cbm"`
	DepotLatitude      *float64 `gorm:"column:depot_latitude"`
	DepotLongitude     *float64 `gorm:"column:depot_longitude"`
	CostPerKm          *float64 `gorm:"column:cost_per_km"`
}

type plannerShipmentRow struct {
	ID             string   `gorm:"column:id"`
	TotalWeightKg  *float64 `gorm:"column:total_weight_kg"`
	TotalVolumeCbm *float64 `gorm:"column:total_volume_cbm"`
}

type plannerStopRow struct {
	ID                     string     `gorm:"column:id"`
	ShipmentOrderID        string     `gorm:"column:shipment_order_id"`
	SequenceNo             int        `gorm:"column:sequence_no"`
	StopType               string     `gorm:"column:stop_type"`
	Address                *string    `gorm:"column:address"`
	LocationName           *string    `gorm:"column:location_name"`
	Latitude               *float64   `gorm:"column:latitude"`
	Longitude              *float64   `gorm:"column:longitude"`
	PlannedArrivalAt       *time.Time `gorm:"column:planned_arrival_at"`
	PlannedDepartAt        *time.Time `gorm:"column:planned_depart_at"`
	ServiceDurationMinutes *int       `gorm:"column:service_duration_minutes"`
}

type loadedData struct {
	vehicles        []plannerVehicleRow
	shipments       []plannerShipmentRow
	stopsByShipment map[string][]plannerStopRow
	geocodeFailures []geocodeFailure
}

// ── HTTP handlers ────────────────────────────────────────────────────────────

// PostLogisticsPlannerOptimize is POST /api/v1/logistics/planner/optimize.
func PostLogisticsPlannerOptimize(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var req optimizeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}
	if len(req.VehicleIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "At least one vehicle is required"})
		return
	}
	if len(req.ShipmentIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "At least one shipment is required"})
		return
	}
	resp, err := runOptimization(c, tid, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// GetLogisticsPlannerInputs is GET /planner/inputs?type=vehicles|shipments —
// the pick-lists for the optimize form. Both branches swallow query errors to an
// empty list (the TS `.catch(() => [])`), so a transient DB blip yields an empty
// picker rather than a 500.
func GetLogisticsPlannerInputs(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	switch c.Query("type") {
	case "vehicles":
		type vrow struct {
			ID                string   `gorm:"column:id"`
			LicensePlate      *string  `gorm:"column:license_plate"`
			PayloadCapacityKg *float64 `gorm:"column:payload_capacity_kg"`
		}
		var rows []vrow
		database.DB.Scopes(auth.WithTenant(c)).Table("vehicles").
			Select("id, license_plate, payload_capacity_kg").
			Where("deleted_at IS NULL AND (vehicle_usage = 'LOGISTICS' OR vehicle_usage IS NULL) AND payload_capacity_kg IS NOT NULL AND depot_latitude IS NOT NULL").
			Order("license_plate NULLS LAST").
			Limit(200).Find(&rows)
		out := make([]plannerInputVehicle, 0, len(rows))
		for _, r := range rows {
			out = append(out, plannerInputVehicle{
				ID:         r.ID,
				Label:      labelOr(r.LicensePlate, r.ID),
				CapacityKg: r.PayloadCapacityKg,
			})
		}
		c.Header("Cache-Control", "private, max-age=15")
		c.JSON(http.StatusOK, gin.H{"vehicles": out})

	case "shipments":
		type srow struct {
			ID            string   `gorm:"column:id"`
			ShipmentNo    *string  `gorm:"column:shipment_no"`
			TotalWeightKg *float64 `gorm:"column:total_weight_kg"`
		}
		var rows []srow
		database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsShipmentOrder{}).
			Select("id, shipment_no, total_weight_kg").
			Where("status IN ?", []string{"PENDING", "CONFIRMED"}).
			Where("EXISTS (SELECT 1 FROM logistics_shipment_stops st WHERE st.shipment_order_id = logistics_shipment_orders.id AND st.stop_type = ?)", "PICKUP").
			Where("EXISTS (SELECT 1 FROM logistics_shipment_stops st WHERE st.shipment_order_id = logistics_shipment_orders.id AND st.stop_type = ?)", "DELIVERY").
			Order("created_at DESC").
			Limit(200).Find(&rows)
		out := make([]plannerInputShipment, 0, len(rows))
		for _, r := range rows {
			out = append(out, plannerInputShipment{
				ID:       r.ID,
				Label:    labelOr(r.ShipmentNo, r.ID),
				WeightKg: r.TotalWeightKg,
			})
		}
		c.Header("Cache-Control", "private, max-age=15")
		c.JSON(http.StatusOK, gin.H{"shipments": out})

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "type must be vehicles or shipments"})
	}
}

// GetLogisticsPlannerPlans is GET /planner/plans — the recent plans list.
func GetLogisticsPlannerPlans(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	status := c.Query("status")
	limit := clampInt(queryInt(c, "limit", 20), 1, 100)
	days := clampInt(queryInt(c, "period", 7), 1, 365)

	items, err := listPlans(c, status, limit, days)
	if err != nil {
		// The plans UI tolerates an empty list; mirror the TS catch → {plans:[]}.
		c.JSON(http.StatusOK, gin.H{"plans": []planListItem{}})
		return
	}
	c.Header("Cache-Control", "private, max-age=15")
	c.JSON(http.StatusOK, gin.H{"plans": items})
}

// GetLogisticsPlannerPlan is GET /planner/plans/:id.
func GetLogisticsPlannerPlan(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	view, err := getPlan(c, c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load plan"})
		return
	}
	if view == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return
	}
	c.Header("Cache-Control", "private, max-age=10")
	c.JSON(http.StatusOK, view)
}

// PostLogisticsPlannerCommit is POST /planner/plans/:id/commit.
func PostLogisticsPlannerCommit(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	res, err := commitPlan(c, tid, c.Param("id"))
	if err != nil {
		c.JSON(commitErrorStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "assignmentsCreated": res})
}

// PostLogisticsPlannerDiscard is POST /planner/plans/:id/discard.
func PostLogisticsPlannerDiscard(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	if err := discardPlan(c, c.Param("id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to discard plan"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// PostLogisticsPlannerEdit is POST /planner/plans/:id/edit — re-sequence /
// reassign / unassign a DRAFT plan's stops and re-flag violations.
func PostLogisticsPlannerEdit(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var body struct {
		Routes   *[]editRoute `json:"routes"`
		Unassign []string     `json:"unassign"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}
	if body.Routes == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "routes array is required"})
		return
	}
	view, err := revalidatePlan(c, c.Param("id"), *body.Routes, body.Unassign)
	if err != nil {
		c.JSON(editErrorStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, view)
}

// ── service: optimize ────────────────────────────────────────────────────────

func runOptimization(c *gin.Context, tid string, req optimizeRequest) (optimizeResponse, error) {
	data, err := loadAndGeocode(c, tid, req.VehicleIDs, req.ShipmentIDs)
	if err != nil {
		return optimizeResponse{}, err
	}
	input, preDropped, err := assemble(req.Config, data.vehicles, data.shipments, data.stopsByShipment)
	if err != nil {
		return optimizeResponse{}, err
	}

	result := routeopt.OptimizeRoutes(input)

	// Shipments missing a geocoded pickup or delivery never reached the solver;
	// fold them into unassigned with the same reason/detail as the TS service.
	for _, id := range preDropped {
		result.Unassigned = append(result.Unassigned, routeopt.UnassignedShipment{
			ShipmentID: id,
			Reason:     routeopt.ReasonNoVehicleMatch,
			Detail:     "Shipment is missing a geocoded pickup or delivery stop.",
		})
	}
	result.Summary.ShipmentsUnassigned = len(result.Unassigned)

	provider := "none"
	if len(input.Distances) > 0 {
		provider = "computed"
	}

	planID, err := persistPlan(c, tid, req, result, provider)
	if err != nil {
		return optimizeResponse{}, err
	}

	status := "COMPLETED"
	if len(result.Unassigned) > 0 {
		status = "PARTIAL"
	}

	failures := data.geocodeFailures
	if failures == nil {
		failures = []geocodeFailure{}
	}
	return optimizeResponse{
		PlanID:          planID,
		Status:          status,
		Result:          result,
		GeocodeFailures: failures,
	}, nil
}

// loadAndGeocode pulls the tenant-scoped vehicles, shipments and stops, then
// geocodes any stop missing lat/lng (writing the resolved coordinates back to
// the row, best-effort). It returns the stops grouped by shipment with any
// freshly-geocoded coordinates already applied.
func loadAndGeocode(c *gin.Context, tid string, vehicleIDs, shipmentIDs []string) (loadedData, error) {
	var vehicles []plannerVehicleRow
	if err := database.DB.Scopes(auth.WithTenant(c)).Table("vehicles").
		Select("id, license_plate, payload_capacity_kg, payload_capacity_cbm, depot_latitude, depot_longitude, cost_per_km").
		Where("id IN ? AND deleted_at IS NULL", vehicleIDs).
		Find(&vehicles).Error; err != nil {
		return loadedData{}, err
	}

	var shipments []plannerShipmentRow
	if err := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsShipmentOrder{}).
		Select("id, total_weight_kg, total_volume_cbm").
		Where("id IN ?", shipmentIDs).
		Find(&shipments).Error; err != nil {
		return loadedData{}, err
	}

	var stops []plannerStopRow
	if err := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsShipmentStop{}).
		Select("id, shipment_order_id, sequence_no, stop_type, address, location_name, latitude, longitude, planned_arrival_at, planned_depart_at, service_duration_minutes").
		Where("shipment_order_id IN ?", shipmentIDs).
		Order("shipment_order_id, sequence_no").
		Find(&stops).Error; err != nil {
		return loadedData{}, err
	}

	failures := make([]geocodeFailure, 0)
	for i := range stops {
		if stops[i].Latitude != nil && stops[i].Longitude != nil {
			continue
		}
		addr := firstNonEmpty(stops[i].Address, stops[i].LocationName)
		if addr == "" {
			failures = append(failures, geocodeFailure{StopID: stops[i].ID, Address: nil, Reason: "no address on stop"})
			continue
		}
		res, gerr := geocodeAddress(c, tid, addr)
		if gerr != nil {
			a := addr
			failures = append(failures, geocodeFailure{StopID: stops[i].ID, Address: &a, Reason: gerr.Error()})
			continue
		}
		lat, lng := res.latitude, res.longitude
		stops[i].Latitude = &lat
		stops[i].Longitude = &lng
		// Write the geocode back so the next plan skips the lookup. Best-effort —
		// a failure here doesn't fail the optimize (matching the TS non-fatal catch).
		database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsShipmentStop{}).
			Where("id = ?", stops[i].ID).
			Updates(map[string]any{
				"latitude":           lat,
				"longitude":          lng,
				"geocode_confidence": res.confidence,
				"geocoded_at":        gorm.Expr("NOW()"),
				"updated_at":         gorm.Expr("NOW()"),
			})
	}

	stopsByShipment := make(map[string][]plannerStopRow, len(shipments))
	for _, st := range stops {
		stopsByShipment[st.ShipmentOrderID] = append(stopsByShipment[st.ShipmentOrderID], st)
	}

	return loadedData{
		vehicles:        vehicles,
		shipments:       shipments,
		stopsByShipment: stopsByShipment,
		geocodeFailures: failures,
	}, nil
}

// assemble turns the loaded rows into a routeopt.Input: it picks the depot
// (config override or first vehicle with a depot), registers each shipment's
// pickup/delivery into the matrix point list, builds the distance matrix, and
// maps vehicles to solver vehicles. Shipments missing a geocoded pickup or
// delivery are returned in preDropped (the caller folds them into unassigned).
func assemble(
	config map[string]any,
	vehicles []plannerVehicleRow,
	shipments []plannerShipmentRow,
	stopsByShipment map[string][]plannerStopRow,
) (routeopt.Input, []string, error) {
	depot, err := pickDepot(vehicles, config)
	if err != nil {
		return routeopt.Input{}, nil, err
	}

	points := []geo.LatLng{depot} // index 0 = depot
	stopMatrixIndex := map[string]int{}
	preDropped := make([]string, 0)
	usable := make([]routeopt.SolverShipment, 0, len(shipments))

	registerIndex := func(st plannerStopRow) int {
		if idx, ok := stopMatrixIndex[st.ID]; ok {
			return idx
		}
		idx := len(points)
		points = append(points, geo.LatLng{Latitude: *st.Latitude, Longitude: *st.Longitude})
		stopMatrixIndex[st.ID] = idx
		return idx
	}

	for _, ship := range shipments {
		var pickup, delivery *plannerStopRow
		for i := range stopsByShipment[ship.ID] {
			st := stopsByShipment[ship.ID][i]
			if st.Latitude == nil || st.Longitude == nil {
				continue
			}
			switch strings.ToUpper(st.StopType) {
			case "PICKUP":
				if pickup == nil {
					s := st
					pickup = &s
				}
			case "DELIVERY":
				if delivery == nil {
					s := st
					delivery = &s
				}
			}
		}
		if pickup == nil || delivery == nil {
			preDropped = append(preDropped, ship.ID)
			continue
		}

		pickupIdx := registerIndex(*pickup)
		deliveryIdx := registerIndex(*delivery)

		weightKg := numPtr(ship.TotalWeightKg, 0)
		volumeCbm := numPtr(ship.TotalVolumeCbm, 0)

		usable = append(usable, routeopt.SolverShipment{
			ShipmentID: ship.ID,
			Pickup:     buildStop(*pickup, ship.ID, routeopt.Pickup, pickupIdx, weightKg, volumeCbm),
			Delivery:   buildStop(*delivery, ship.ID, routeopt.Delivery, deliveryIdx, weightKg, volumeCbm),
			WeightKg:   weightKg,
			VolumeCbm:  volumeCbm,
		})
	}

	matrix, err := distmatrix.Compute(points, distmatrix.Options{
		Provider:     cfgString(config, "distanceProvider"),
		DetourFactor: cfgFloat(config, "detourFactor", 0),
		MapboxToken:  os.Getenv("MAPBOX_TOKEN"),
	})
	if err != nil {
		return routeopt.Input{}, nil, err
	}

	solverVehicles := make([]routeopt.SolverVehicle, 0, len(vehicles))
	for _, v := range vehicles {
		solverVehicles = append(solverVehicles, routeopt.SolverVehicle{
			VehicleID:     v.ID,
			DriverID:      nil,
			CapacityKg:    numPtr(v.PayloadCapacityKg, 0),
			CapacityCbm:   numPtr(v.PayloadCapacityCbm, maxSafeInteger),
			CostPerKm:     numPtr(v.CostPerKm, 0),
			ShiftStartMin: 480,  // 08:00
			ShiftEndMin:   1080, // 18:00
			MaxDriveMin:   600,  // 10h
		})
	}

	return routeopt.Input{
		Distances: matrix.Distances,
		Durations: matrix.Durations,
		Shipments: usable,
		Vehicles:  solverVehicles,
		Objective: cfgString(config, "objective"),
	}, preDropped, nil
}

func pickDepot(vehicles []plannerVehicleRow, config map[string]any) (geo.LatLng, error) {
	lat := cfgFloatPtr(config, "depotLatitude")
	lng := cfgFloatPtr(config, "depotLongitude")
	if lat != nil && lng != nil {
		return geo.LatLng{Latitude: *lat, Longitude: *lng}, nil
	}
	for _, v := range vehicles {
		if v.DepotLatitude != nil && v.DepotLongitude != nil {
			return geo.LatLng{Latitude: *v.DepotLatitude, Longitude: *v.DepotLongitude}, nil
		}
	}
	return geo.LatLng{}, errors.New("No depot configured. Set depot_latitude/longitude on a vehicle or pass it in config.")
}

func buildStop(s plannerStopRow, shipmentID string, t routeopt.StopType, matrixIndex int, weightKg, volumeCbm float64) routeopt.SolverStop {
	svc := 15.0
	if s.ServiceDurationMinutes != nil {
		svc = float64(*s.ServiceDurationMinutes)
	}
	return routeopt.SolverStop{
		StopID:             s.ID,
		ShipmentID:         shipmentID,
		Type:               t,
		MatrixIndex:        matrixIndex,
		WeightKg:           weightKg,
		VolumeCbm:          volumeCbm,
		ServiceDurationMin: svc,
		WindowFromMin:      toMinutesFromMidnight(s.PlannedArrivalAt),
		WindowToMin:        toMinutesFromMidnight(s.PlannedDepartAt),
	}
}

func persistPlan(c *gin.Context, tid string, req optimizeRequest, result routeopt.Result, provider string) (string, error) {
	// config = { ...request.config, provider } — preserve any unknown keys the
	// caller passed, exactly like the TS JSON.stringify({ ...config, provider }).
	cfg := map[string]any{}
	for k, v := range req.Config {
		cfg[k] = v
	}
	cfg["provider"] = provider

	var createdBy *string
	if uid := auth.UserID(c); uid != "" {
		createdBy = &uid
	}

	shipmentsIn := len(req.ShipmentIDs)
	totalDist := result.Summary.TotalDistanceKm
	totalDur := result.Summary.TotalDurationMin
	assigned := result.Summary.ShipmentsAssigned
	vehiclesUsed := result.Summary.VehiclesUsed
	estCost := result.Summary.EstimatedCost

	plan := models.LogisticsRoutePlan{
		TenantID:          tid,
		CreatedBy:         createdBy,
		Status:            "DRAFT",
		Algorithm:         "savings",
		Config:            cfg,
		InputSnapshot:     map[string]any{"vehicleIds": req.VehicleIDs, "shipmentIds": req.ShipmentIDs},
		Result:            &result,
		TotalDistanceKm:   &totalDist,
		TotalDurationMin:  &totalDur,
		ShipmentsIn:       &shipmentsIn,
		ShipmentsAssigned: &assigned,
		VehiclesUsed:      &vehiclesUsed,
		EstimatedCost:     &estCost,
	}
	if err := database.DB.Create(&plan).Error; err != nil {
		return "", err
	}
	return plan.ID, nil
}

// ── service: commit / discard / get / list / edit ────────────────────────────

func commitPlan(c *gin.Context, tid, planID string) (int, error) {
	var plan models.LogisticsRoutePlan
	err := database.DB.Scopes(auth.WithTenant(c)).Where("id = ?", planID).First(&plan).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, errors.New("Plan not found")
	}
	if err != nil {
		return 0, err
	}
	switch plan.Status {
	case "COMMITTED":
		return 0, nil // idempotent
	case "DISCARDED":
		return 0, errors.New("Cannot commit a discarded plan")
	}

	created := 0
	if plan.Result != nil {
		for _, route := range plan.Result.Routes {
			vehicleID := route.VehicleID
			for i, shipmentID := range uniqueShipmentIDs(route.Stops) {
				seq := i + 1
				asg := models.LogisticsAssignment{
					TenantID:        tid,
					ShipmentOrderID: shipmentID,
					VehicleID:       &vehicleID,
					DriverID:        route.DriverID,
					AssignmentType:  "CARRIER",
					Status:          "ASSIGNED",
					RoutePlanID:     &planID,
					SequenceInRoute: &seq,
				}
				if err := database.DB.Create(&asg).Error; err != nil {
					return 0, err
				}
				// Best-effort: bump the shipment to ASSIGNED unless it's already
				// in a terminal state.
				database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsShipmentOrder{}).
					Where("id = ? AND status NOT IN ?", shipmentID, []string{"DELIVERED", "CANCELLED", "CLOSED"}).
					Updates(map[string]any{"status": "ASSIGNED", "updated_at": gorm.Expr("NOW()")})
				created++
			}
		}
	}

	if err := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsRoutePlan{}).
		Where("id = ?", planID).
		Updates(map[string]any{
			"status":       "COMMITTED",
			"committed_at": gorm.Expr("NOW()"),
			"updated_at":   gorm.Expr("NOW()"),
		}).Error; err != nil {
		return 0, err
	}
	return created, nil
}

func discardPlan(c *gin.Context, planID string) error {
	return database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsRoutePlan{}).
		Where("id = ? AND status = ?", planID, "DRAFT").
		Updates(map[string]any{
			"status":     "DISCARDED",
			"deleted_at": gorm.Expr("NOW()"),
			"updated_at": gorm.Expr("NOW()"),
		}).Error
}

// getPlan reads a plan as {id, status, result}. .Unscoped() so a soft-deleted
// (DISCARDED) plan is still returned, matching the TS getPlan query which has no
// deleted_at filter.
func getPlan(c *gin.Context, planID string) (*planView, error) {
	var plan models.LogisticsRoutePlan
	if err := database.DB.Unscoped().Scopes(auth.WithTenant(c)).
		Where("id = ?", planID).Limit(1).Find(&plan).Error; err != nil {
		return nil, err
	}
	if plan.ID == "" {
		return nil, nil
	}
	res := routeopt.Result{}
	if plan.Result != nil {
		res = *plan.Result
	}
	return &planView{ID: plan.ID, Status: plan.Status, Result: res}, nil
}

func listPlans(c *gin.Context, status string, limit, days int) ([]planListItem, error) {
	from := time.Now().Add(-time.Duration(days) * 24 * time.Hour)
	q := database.DB.Unscoped().Scopes(auth.WithTenant(c)).
		Model(&models.LogisticsRoutePlan{}).
		Select("id, status, algorithm, created_at::text AS created_at, created_by, total_distance_km::text AS total_distance_km, total_duration_min, shipments_in, shipments_assigned, vehicles_used, estimated_cost::text AS estimated_cost").
		Where("created_at >= ?", from)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	items := make([]planListItem, 0)
	err := q.Order("created_at DESC").Limit(limit).Find(&items).Error
	return items, err
}

func revalidatePlan(c *gin.Context, planID string, editedRoutes []editRoute, unassign []string) (*planView, error) {
	prev, err := getPlan(c, planID)
	if err != nil {
		return nil, err
	}
	if prev == nil {
		return nil, errors.New("Plan not found")
	}
	if prev.Status != "DRAFT" {
		return nil, errors.New("Only DRAFT plans can be edited")
	}
	prevResult := prev.Result

	stopByID := map[string]routeopt.RouteStop{}
	for _, r := range prevResult.Routes {
		for _, st := range r.Stops {
			stopByID[st.StopID] = st
		}
	}

	rebuiltRoutes := make([]routeopt.SolvedRoute, 0, len(editedRoutes))
	for _, er := range editedRoutes {
		ordered := make([]routeopt.RouteStop, 0, len(er.StopOrder))
		for _, id := range er.StopOrder {
			if st, ok := stopByID[id]; ok {
				ordered = append(ordered, st)
			}
		}
		for i := range ordered {
			ordered[i].Sequence = i + 1
		}

		violations := make([]routeopt.Violation, 0)
		seenPickup := map[string]struct{}{}
		for _, st := range ordered {
			if st.Type == routeopt.Pickup {
				seenPickup[st.ShipmentID] = struct{}{}
			} else if _, ok := seenPickup[st.ShipmentID]; !ok {
				violations = append(violations, routeopt.Violation{
					StopID: st.StopID,
					Kind:   routeopt.KindTimeWindow,
					Detail: fmt.Sprintf("Delivery for %s sequenced before its pickup", st.ShipmentID),
				})
			}
		}
		for _, st := range ordered {
			if !st.OnTime {
				violations = append(violations, routeopt.Violation{
					StopID: st.StopID,
					Kind:   routeopt.KindTimeWindow,
					Detail: fmt.Sprintf("%dmin late", st.LateMinutes),
				})
			}
		}

		var rebuilt routeopt.SolvedRoute
		if pr := findRouteByVehicle(prevResult.Routes, er.VehicleID); pr != nil {
			rebuilt = *pr // carry forward driverId, totals, capacity utilisation, cost
		}
		rebuilt.VehicleID = er.VehicleID
		rebuilt.Stops = ordered
		rebuilt.Violations = violations
		rebuiltRoutes = append(rebuiltRoutes, rebuilt)
	}

	assignedShipments := map[string]struct{}{}
	for _, r := range rebuiltRoutes {
		for _, st := range r.Stops {
			assignedShipments[st.ShipmentID] = struct{}{}
		}
	}

	unassigned := make([]routeopt.UnassignedShipment, 0)
	for _, u := range prevResult.Unassigned {
		if _, isAssigned := assignedShipments[u.ShipmentID]; !isAssigned {
			unassigned = append(unassigned, u)
		}
	}
	for _, id := range uniqueStrings(unassign) {
		unassigned = append(unassigned, routeopt.UnassignedShipment{
			ShipmentID: id,
			Reason:     routeopt.ReasonNoVehicleMatch,
			Detail:     "Manually unassigned by operator",
		})
	}

	twViol := 0
	for _, r := range rebuiltRoutes {
		for _, v := range r.Violations {
			if v.Kind == routeopt.KindTimeWindow {
				twViol++
			}
		}
	}

	summary := prevResult.Summary
	summary.VehiclesUsed = len(rebuiltRoutes)
	summary.ShipmentsAssigned = len(assignedShipments)
	summary.ShipmentsUnassigned = len(unassigned)
	summary.TimeWindowViolations = twViol

	newResult := routeopt.Result{
		Routes:     rebuiltRoutes,
		Unassigned: unassigned,
		Summary:    summary,
	}

	sa := summary.ShipmentsAssigned
	vu := summary.VehiclesUsed
	upd := models.LogisticsRoutePlan{Result: &newResult, ShipmentsAssigned: &sa, VehiclesUsed: &vu}
	upd.UpdatedAt = time.Now()
	if err := database.DB.Unscoped().Scopes(auth.WithTenant(c)).
		Model(&models.LogisticsRoutePlan{}).
		Where("id = ?", planID).
		Select("result", "shipments_assigned", "vehicles_used", "updated_at").
		Updates(&upd).Error; err != nil {
		return nil, err
	}
	return &planView{ID: planID, Status: "DRAFT", Result: newResult}, nil
}

// ── small helpers ────────────────────────────────────────────────────────────

// toMinutesFromMidnight returns the instant's UTC minutes-from-midnight, the Go
// equivalent of the TS `d.getUTCHours()*60 + d.getUTCMinutes()`. nil → nil.
func toMinutesFromMidnight(t *time.Time) *int {
	if t == nil {
		return nil
	}
	u := t.UTC()
	m := u.Hour()*60 + u.Minute()
	return &m
}

// numPtr is the TS `num(v, fallback)` = Number.isFinite(v) ? v : fallback over a
// nullable column: nil or non-finite → fallback.
func numPtr(v *float64, fallback float64) float64 {
	if v == nil || math.IsNaN(*v) || math.IsInf(*v, 0) {
		return fallback
	}
	return *v
}

func cfgString(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if s, ok := m[key].(string); ok {
		return s
	}
	return ""
}

func cfgFloatPtr(m map[string]any, key string) *float64 {
	if m == nil {
		return nil
	}
	switch n := m[key].(type) {
	case float64:
		return &n
	case int:
		f := float64(n)
		return &f
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(n), 64); err == nil {
			return &f
		}
	}
	return nil
}

func cfgFloat(m map[string]any, key string, fallback float64) float64 {
	if p := cfgFloatPtr(m, key); p != nil {
		return *p
	}
	return fallback
}

// firstNonEmpty returns the first non-empty pointed-to string (address, then
// location_name), matching the TS `address || location_name`.
func firstNonEmpty(ptrs ...*string) string {
	for _, p := range ptrs {
		if p != nil && strings.TrimSpace(*p) != "" {
			return *p
		}
	}
	return ""
}

// labelOr is the TS `primary || id.slice(0,8)` picker for list labels.
func labelOr(primary *string, id string) string {
	if primary != nil && *primary != "" {
		return *primary
	}
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

func uniqueStrings(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

func uniqueShipmentIDs(stops []routeopt.RouteStop) []string {
	seen := make(map[string]struct{}, len(stops))
	out := make([]string, 0, len(stops))
	for _, st := range stops {
		if _, ok := seen[st.ShipmentID]; ok {
			continue
		}
		seen[st.ShipmentID] = struct{}{}
		out = append(out, st.ShipmentID)
	}
	return out
}

func findRouteByVehicle(routes []routeopt.SolvedRoute, vehicleID string) *routeopt.SolvedRoute {
	for i := range routes {
		if routes[i].VehicleID == vehicleID {
			return &routes[i]
		}
	}
	return nil
}

func queryInt(c *gin.Context, key string, def int) int {
	if v := c.Query(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func commitErrorStatus(err error) int {
	m := strings.ToLower(err.Error())
	switch {
	case strings.Contains(m, "not found"):
		return http.StatusNotFound
	case strings.Contains(m, "discarded"):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

func editErrorStatus(err error) int {
	m := strings.ToLower(err.Error())
	switch {
	case strings.Contains(m, "not found"):
		return http.StatusNotFound
	case strings.Contains(m, "draft"):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}
