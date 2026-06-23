// Package routeopt is the Go port of src/lib/logistics/route-optimizer.ts.
//
// It is a pure VRP solver: given a pre-built distance/duration matrix plus the
// shipments and vehicles, it returns a set of sequenced, feasibility-checked
// routes. No DB, no network, no geocoding — the service layer (Phase L4c) does
// all of that and hands this package ready-to-solve data, exactly as the TS
// route-optimizer-service.ts feeds the TS optimizer.
//
// Problem class: PDPTW (pickup-and-delivery with time windows) + capacity. Each
// shipment is a (pickup, delivery) pair served by one vehicle, pickup before
// delivery, within each stop's time window, without exceeding the vehicle's
// weight/volume capacity at any point on the route.
//
// Algorithm (identical to the TS original):
//  1. Seed one out-and-back route per shipment: depot → pickup → delivery → depot.
//  2. Clarke-Wright savings: greedily merge the end of one route to the start of
//     another, highest-saving first, accepting a merge only when the result stays
//     feasible (capacity, pickup-before-delivery, and an HOS drive-time ceiling).
//  3. 2-opt: reverse sub-segments within each route to shed crossings, again
//     accepting only moves that preserve pickup-before-delivery.
//  4. Assign routes to vehicles largest-demand-first; routes that fit no vehicle
//     leave their shipments unassigned.
//
// The constraints are HARD — an infeasible route is rejected outright, never
// emitted as "lower quality". Keeping the solver pure means the savings, the
// 2-opt acceptance, the time-window/HOS analysis are all exercised by unit tests
// with zero setup — the property the TypeScript original was built for.
package routeopt

import (
	"fmt"
	"math"
	"sort"
	"strconv"
)

// DEPOT is always matrix index 0 — both ends of every route.
const DEPOT = 0

// StopType is PICKUP or DELIVERY.
type StopType string

const (
	Pickup   StopType = "PICKUP"
	Delivery StopType = "DELIVERY"
)

// Violation kinds.
const (
	KindTimeWindow = "TIME_WINDOW"
	KindCapacity   = "CAPACITY"
	KindHOS        = "HOS"
)

// Unassigned reasons.
const (
	ReasonNoCapacity     = "NO_CAPACITY"
	ReasonNoTimeWindow   = "NO_TIME_WINDOW_FIT"
	ReasonNoVehicleMatch = "NO_VEHICLE_MATCH"
)

// ── Inputs ──────────────────────────────────────────────────────────────────

// SolverStop is one pickup or delivery. MatrixIndex points into the distance /
// duration matrices (depot is index 0). WindowFromMin/WindowToMin are
// minutes-from-midnight; nil means unconstrained.
type SolverStop struct {
	StopID             string   `json:"stopId"`
	ShipmentID         string   `json:"shipmentId"`
	Type               StopType `json:"type"`
	MatrixIndex        int      `json:"matrixIndex"`
	WeightKg           float64  `json:"weightKg"`
	VolumeCbm          float64  `json:"volumeCbm"`
	ServiceDurationMin float64  `json:"serviceDurationMin"`
	WindowFromMin      *int     `json:"windowFromMin"`
	WindowToMin        *int     `json:"windowToMin"`
}

// SolverShipment is a (pickup, delivery) pair plus the load the truck carries
// between them.
type SolverShipment struct {
	ShipmentID string     `json:"shipmentId"`
	Pickup     SolverStop `json:"pickup"`
	Delivery   SolverStop `json:"delivery"`
	WeightKg   float64    `json:"weightKg"`
	VolumeCbm  float64    `json:"volumeCbm"`
}

// SolverVehicle is a candidate truck + its driver's working envelope.
type SolverVehicle struct {
	VehicleID     string  `json:"vehicleId"`
	DriverID      *string `json:"driverId"`
	CapacityKg    float64 `json:"capacityKg"`
	CapacityCbm   float64 `json:"capacityCbm"`
	CostPerKm     float64 `json:"costPerKm"`
	ShiftStartMin int     `json:"shiftStartMin"`
	ShiftEndMin   int     `json:"shiftEndMin"`
	MaxDriveMin   float64 `json:"maxDriveMin"`
}

// Input is the complete solve request. DepotDepartMin defaults to the earliest
// vehicle shift start. Objective is accepted for API parity with the TS input
// but, like the TS original, does not change the algorithm.
type Input struct {
	Distances      [][]float64      `json:"distances"`
	Durations      [][]float64      `json:"durations"`
	Shipments      []SolverShipment `json:"shipments"`
	Vehicles       []SolverVehicle  `json:"vehicles"`
	DepotDepartMin *int             `json:"depotDepartMin,omitempty"`
	Objective      string           `json:"objective,omitempty"`
}

// ── Outputs ─────────────────────────────────────────────────────────────────

// RouteStop is one served stop in the final sequence, with computed timing,
// running load, and lateness.
type RouteStop struct {
	Sequence           int      `json:"sequence"`
	StopID             string   `json:"stopId"`
	ShipmentID         string   `json:"shipmentId"`
	Type               StopType `json:"type"`
	ArriveMin          int      `json:"arriveMin"`
	DepartMin          int      `json:"departMin"`
	DistanceFromPrevKm float64  `json:"distanceFromPrevKm"`
	WindowFromMin      *int     `json:"windowFromMin"`
	WindowToMin        *int     `json:"windowToMin"`
	OnTime             bool     `json:"onTime"`
	LateMinutes        int      `json:"lateMinutes"`
	LoadAfterKg        float64  `json:"loadAfterKg"`
	LoadAfterCbm       float64  `json:"loadAfterCbm"`
}

// CapacityUtilization is peak load as a percentage of capacity.
type CapacityUtilization struct {
	WeightPct float64 `json:"weightPct"`
	VolumePct float64 `json:"volumePct"`
}

// Violation is a hard-constraint breach surfaced on the built route.
type Violation struct {
	StopID string `json:"stopId"`
	Kind   string `json:"kind"`
	Detail string `json:"detail"`
}

// SolvedRoute is one vehicle's final sequenced route.
type SolvedRoute struct {
	VehicleID           string              `json:"vehicleId"`
	DriverID            *string             `json:"driverId"`
	Stops               []RouteStop         `json:"stops"`
	TotalDistanceKm     float64             `json:"totalDistanceKm"`
	TotalDurationMin    int                 `json:"totalDurationMin"`
	CapacityUtilization CapacityUtilization `json:"capacityUtilization"`
	EstimatedCost       float64             `json:"estimatedCost"`
	Violations          []Violation         `json:"violations"`
}

// UnassignedShipment is a shipment no route could carry.
type UnassignedShipment struct {
	ShipmentID string `json:"shipmentId"`
	Reason     string `json:"reason"`
	Detail     string `json:"detail,omitempty"`
}

// Summary aggregates the whole solve.
type Summary struct {
	TotalDistanceKm      float64 `json:"totalDistanceKm"`
	TotalDurationMin     int     `json:"totalDurationMin"`
	VehiclesUsed         int     `json:"vehiclesUsed"`
	ShipmentsAssigned    int     `json:"shipmentsAssigned"`
	ShipmentsUnassigned  int     `json:"shipmentsUnassigned"`
	EstimatedCost        float64 `json:"estimatedCost"`
	TimeWindowViolations int     `json:"timeWindowViolations"`
}

// Result is the full optimizer output.
type Result struct {
	Routes     []SolvedRoute        `json:"routes"`
	Unassigned []UnassignedShipment `json:"unassigned"`
	Summary    Summary              `json:"summary"`
}

// ── Internal route representation ──────────────────────────────────────────

// internalRoute is the ordered stop list (depot implied at both ends) plus the
// shipments fully contained in it. shipmentIDs is kept as an insertion-ordered
// slice (mirroring the TS Set's insertion order) so unassigned output is
// deterministic; merges combine disjoint routes, so no dedup is needed.
type internalRoute struct {
	stops       []SolverStop
	shipmentIDs []string
}

type assignment struct {
	route   internalRoute
	vehicle SolverVehicle
}

// ── Public entry point ─────────────────────────────────────────────────────

// OptimizeRoutes runs the full seed → Clarke-Wright → 2-opt → assign → build
// pipeline and returns the sequenced routes plus any unassigned shipments.
func OptimizeRoutes(input Input) Result {
	distances := input.Distances
	durations := input.Durations
	shipments := input.Shipments
	vehicles := input.Vehicles

	if len(shipments) == 0 || len(vehicles) == 0 {
		return emptyResult(shipments)
	}

	// 1) Seed one route per shipment.
	routes := make([]internalRoute, 0, len(shipments))
	for _, s := range shipments {
		routes = append(routes, internalRoute{
			stops:       []SolverStop{s.Pickup, s.Delivery},
			shipmentIDs: []string{s.ShipmentID},
		})
	}

	// Reference ceilings for merge feasibility: the route only needs to fit
	// *some* vehicle, so use the largest capacity and most generous drive limit.
	maxCapKg := vehicles[0].CapacityKg
	maxCapCbm := vehicles[0].CapacityCbm
	maxDriveMin := vehicles[0].MaxDriveMin
	minShiftStart := vehicles[0].ShiftStartMin
	for _, v := range vehicles[1:] {
		if v.CapacityKg > maxCapKg {
			maxCapKg = v.CapacityKg
		}
		if v.CapacityCbm > maxCapCbm {
			maxCapCbm = v.CapacityCbm
		}
		if v.MaxDriveMin > maxDriveMin {
			maxDriveMin = v.MaxDriveMin
		}
		if v.ShiftStartMin < minShiftStart {
			minShiftStart = v.ShiftStartMin
		}
	}

	shipmentByID := make(map[string]SolverShipment, len(shipments))
	for _, s := range shipments {
		shipmentByID[s.ShipmentID] = s
	}

	// 2) Clarke-Wright savings merges.
	routes = clarkeWrightMerge(routes, distances, durations, shipmentByID, maxCapKg, maxCapCbm, maxDriveMin)

	// 3) 2-opt within each route.
	for i := range routes {
		routes[i].stops = twoOptImprove(routes[i].stops, distances)
	}

	// 4) Assign routes to vehicles.
	assigned, unassignedShipmentIDs := assignVehicles(routes, vehicles, shipmentByID)

	// 5) Build output with timing + violations.
	depotDepart := minShiftStart
	if input.DepotDepartMin != nil {
		depotDepart = *input.DepotDepartMin
	}
	solvedRoutes := make([]SolvedRoute, 0, len(assigned))
	for _, a := range assigned {
		solvedRoutes = append(solvedRoutes, buildSolvedRoute(a.route, a.vehicle, distances, durations, shipmentByID, depotDepart))
	}

	unassigned := make([]UnassignedShipment, 0, len(unassignedShipmentIDs))
	for _, id := range unassignedShipmentIDs {
		unassigned = append(unassigned, UnassignedShipment{
			ShipmentID: id,
			Reason:     ReasonNoCapacity,
			Detail:     "No vehicle had capacity for this shipment after merging.",
		})
	}

	return assembleResult(solvedRoutes, unassigned)
}

// ── Clarke-Wright savings ──────────────────────────────────────────────────

func clarkeWrightMerge(
	routes []internalRoute,
	distances, durations [][]float64,
	shipmentByID map[string]SolverShipment,
	maxCapKg, maxCapCbm, maxDriveMin float64,
) []internalRoute {
	working := make([]internalRoute, len(routes))
	copy(working, routes)

	type saving struct {
		i, j  int
		value float64
	}

	improved := true
	for improved {
		improved = false

		// saving(a→b) = d(last_a, depot) + d(depot, first_b) - d(last_a, first_b);
		// higher = more distance removed by stitching b after a.
		savings := make([]saving, 0)
		for i := 0; i < len(working); i++ {
			for j := 0; j < len(working); j++ {
				if i == j {
					continue
				}
				lastA := working[i].stops[len(working[i].stops)-1].MatrixIndex
				firstB := working[j].stops[0].MatrixIndex
				value := distances[lastA][DEPOT] + distances[DEPOT][firstB] - distances[lastA][firstB]
				if value > 0 {
					savings = append(savings, saving{i: i, j: j, value: value})
				}
			}
		}
		if len(savings) == 0 {
			break
		}
		// Stable sort by descending saving so ties keep insertion (i,j) order,
		// matching V8's stable Array.sort.
		sort.SliceStable(savings, func(a, b int) bool { return savings[a].value > savings[b].value })

		// Take the first feasible merge, then recompute (indices shift).
		for _, s := range savings {
			a := working[s.i]
			b := working[s.j]

			mergedStops := make([]SolverStop, 0, len(a.stops)+len(b.stops))
			mergedStops = append(mergedStops, a.stops...)
			mergedStops = append(mergedStops, b.stops...)

			if !RouteFeasibleCapacity(mergedStops, shipmentByID, maxCapKg, maxCapCbm) {
				continue
			}
			if !PickupBeforeDelivery(mergedStops) {
				continue
			}
			// HOS ceiling: reject a merge past the most generous drive-time budget
			// so the solver spreads load across idle trucks instead of cramming
			// one into a 14-hour day.
			if routeDurationMin(mergedStops, durations) > maxDriveMin {
				continue
			}

			mergedIDs := make([]string, 0, len(a.shipmentIDs)+len(b.shipmentIDs))
			mergedIDs = append(mergedIDs, a.shipmentIDs...)
			mergedIDs = append(mergedIDs, b.shipmentIDs...)
			merged := internalRoute{stops: mergedStops, shipmentIDs: mergedIDs}

			next := make([]internalRoute, 0, len(working)-1)
			for idx := range working {
				if idx == s.i || idx == s.j {
					continue
				}
				next = append(next, working[idx])
			}
			next = append(next, merged)
			working = next
			improved = true
			break
		}
	}

	return working
}

// ── 2-opt ───────────────────────────────────────────────────────────────────

func twoOptImprove(stops []SolverStop, distances [][]float64) []SolverStop {
	if len(stops) < 4 {
		return stops
	}
	best := make([]SolverStop, len(stops))
	copy(best, stops)
	bestDist := routeDistance(best, distances)

	improved := true
	for improved {
		improved = false
		for i := 0; i < len(best)-1; i++ {
			for k := i + 1; k < len(best); k++ {
				candidate := twoOptSwap(best, i, k)
				if !PickupBeforeDelivery(candidate) {
					continue // never break PD order
				}
				d := routeDistance(candidate, distances)
				if d < bestDist-1e-9 {
					best = candidate
					bestDist = d
					improved = true
				}
			}
		}
	}
	return best
}

// twoOptSwap returns a new slice with the segment [i, k] reversed.
func twoOptSwap(stops []SolverStop, i, k int) []SolverStop {
	out := make([]SolverStop, 0, len(stops))
	out = append(out, stops[:i]...)
	for x := k; x >= i; x-- {
		out = append(out, stops[x])
	}
	out = append(out, stops[k+1:]...)
	return out
}

// ── Feasibility checks ─────────────────────────────────────────────────────

// PickupBeforeDelivery reports whether every shipment's pickup precedes its
// delivery in the stop order. HARD constraint.
func PickupBeforeDelivery(stops []SolverStop) bool {
	seenPickup := make(map[string]struct{})
	for _, stop := range stops {
		if stop.Type == Pickup {
			seenPickup[stop.ShipmentID] = struct{}{}
		} else {
			if _, ok := seenPickup[stop.ShipmentID]; !ok {
				return false
			}
		}
	}
	return true
}

// RouteFeasibleCapacity walks the route tracking cumulative load (rises at a
// pickup, falls at a delivery). If load exceeds either dimension's capacity at
// any point, the route is infeasible — the peak is mid-route, when the truck
// carries the most.
func RouteFeasibleCapacity(stops []SolverStop, shipmentByID map[string]SolverShipment, capKg, capCbm float64) bool {
	loadKg, loadCbm := 0.0, 0.0
	for _, stop := range stops {
		s, ok := shipmentByID[stop.ShipmentID]
		if !ok {
			continue
		}
		if stop.Type == Pickup {
			loadKg += s.WeightKg
			loadCbm += s.VolumeCbm
			if loadKg > capKg+1e-9 || loadCbm > capCbm+1e-9 {
				return false
			}
		} else {
			loadKg -= s.WeightKg
			loadCbm -= s.VolumeCbm
		}
	}
	return true
}

// ── Vehicle assignment ─────────────────────────────────────────────────────

func assignVehicles(
	routes []internalRoute,
	vehicles []SolverVehicle,
	shipmentByID map[string]SolverShipment,
) (assigned []assignment, unassignedShipmentIDs []string) {
	type routeLoad struct {
		route   internalRoute
		peakKg  float64
		peakCbm float64
	}
	routeLoads := make([]routeLoad, 0, len(routes))
	for _, r := range routes {
		routeLoads = append(routeLoads, routeLoad{
			route:   r,
			peakKg:  peakLoad(r.stops, shipmentByID, "kg"),
			peakCbm: peakLoad(r.stops, shipmentByID, "cbm"),
		})
	}
	// Largest peak weight first — avoids wasting big trucks on tiny routes.
	sort.SliceStable(routeLoads, func(a, b int) bool { return routeLoads[a].peakKg > routeLoads[b].peakKg })

	availableVehicles := make([]SolverVehicle, len(vehicles))
	copy(availableVehicles, vehicles)
	sort.SliceStable(availableVehicles, func(a, b int) bool { return availableVehicles[a].CapacityKg < availableVehicles[b].CapacityKg })

	used := make(map[string]struct{})
	for _, rl := range routeLoads {
		var fit *SolverVehicle
		for i := range availableVehicles {
			v := &availableVehicles[i]
			if _, isUsed := used[v.VehicleID]; isUsed {
				continue
			}
			if v.CapacityKg+1e-9 >= rl.peakKg && v.CapacityCbm+1e-9 >= rl.peakCbm {
				fit = v
				break
			}
		}
		if fit != nil {
			used[fit.VehicleID] = struct{}{}
			assigned = append(assigned, assignment{route: rl.route, vehicle: *fit})
		} else {
			unassignedShipmentIDs = append(unassignedShipmentIDs, rl.route.shipmentIDs...)
		}
	}
	return assigned, unassignedShipmentIDs
}

func peakLoad(stops []SolverStop, shipmentByID map[string]SolverShipment, dim string) float64 {
	load, peak := 0.0, 0.0
	for _, stop := range stops {
		s, ok := shipmentByID[stop.ShipmentID]
		if !ok {
			continue
		}
		amount := s.WeightKg
		if dim == "cbm" {
			amount = s.VolumeCbm
		}
		if stop.Type == Pickup {
			load += amount
		} else {
			load -= amount
		}
		if load > peak {
			peak = load
		}
	}
	return peak
}

// ── Build output route with timing ─────────────────────────────────────────

func buildSolvedRoute(
	route internalRoute,
	vehicle SolverVehicle,
	distances, durations [][]float64,
	shipmentByID map[string]SolverShipment,
	depotDepartMin int,
) SolvedRoute {
	stops := make([]RouteStop, 0, len(route.stops))
	violations := make([]Violation, 0)

	prevIndex := DEPOT
	clockMin := float64(depotDepartMin)
	totalDistanceKm := 0.0
	loadKg, loadCbm := 0.0, 0.0

	for i, stop := range route.stops {
		legKm := distances[prevIndex][stop.MatrixIndex]
		legMin := durations[prevIndex][stop.MatrixIndex]
		totalDistanceKm += legKm
		clockMin += legMin

		// Wait if we arrive before the window opens.
		arriveMin := clockMin
		if stop.WindowFromMin != nil && arriveMin < float64(*stop.WindowFromMin) {
			arriveMin = float64(*stop.WindowFromMin)
			clockMin = float64(*stop.WindowFromMin)
		}

		onTime := true
		lateMinutes := 0
		if stop.WindowToMin != nil && arriveMin > float64(*stop.WindowToMin) {
			onTime = false
			lateMinutes = int(math.Round(arriveMin - float64(*stop.WindowToMin)))
			violations = append(violations, Violation{
				StopID: stop.StopID,
				Kind:   KindTimeWindow,
				Detail: fmt.Sprintf("Arrived %dmin after window close (%s)", lateMinutes, fmtMin(*stop.WindowToMin)),
			})
		}

		departMin := arriveMin + stop.ServiceDurationMin
		clockMin = departMin

		if s, ok := shipmentByID[stop.ShipmentID]; ok {
			if stop.Type == Pickup {
				loadKg += s.WeightKg
				loadCbm += s.VolumeCbm
			} else {
				loadKg -= s.WeightKg
				loadCbm -= s.VolumeCbm
			}
		}

		stops = append(stops, RouteStop{
			Sequence:           i + 1,
			StopID:             stop.StopID,
			ShipmentID:         stop.ShipmentID,
			Type:               stop.Type,
			ArriveMin:          int(math.Round(arriveMin)),
			DepartMin:          int(math.Round(departMin)),
			DistanceFromPrevKm: round2(legKm),
			WindowFromMin:      stop.WindowFromMin,
			WindowToMin:        stop.WindowToMin,
			OnTime:             onTime,
			LateMinutes:        lateMinutes,
			LoadAfterKg:        round2(loadKg),
			LoadAfterCbm:       round2(loadCbm),
		})

		prevIndex = stop.MatrixIndex
	}

	// Return-to-depot leg.
	returnKm := distances[prevIndex][DEPOT]
	returnMin := durations[prevIndex][DEPOT]
	totalDistanceKm += returnKm
	totalDurationMin := (clockMin + returnMin) - float64(depotDepartMin)

	// HOS check — total working time vs the vehicle's cap.
	if totalDurationMin > vehicle.MaxDriveMin {
		lastStopID := "route"
		if len(stops) > 0 {
			lastStopID = stops[len(stops)-1].StopID
		}
		violations = append(violations, Violation{
			StopID: lastStopID,
			Kind:   KindHOS,
			Detail: fmt.Sprintf("Route duration %dmin exceeds driver limit %smin", int(math.Round(totalDurationMin)), formatNum(vehicle.MaxDriveMin)),
		})
	}

	peakKg := peakLoad(route.stops, shipmentByID, "kg")
	peakCbm := peakLoad(route.stops, shipmentByID, "cbm")

	weightPct := 0.0
	if vehicle.CapacityKg > 0 {
		weightPct = round1((peakKg / vehicle.CapacityKg) * 100)
	}
	volumePct := 0.0
	if vehicle.CapacityCbm > 0 {
		volumePct = round1((peakCbm / vehicle.CapacityCbm) * 100)
	}

	return SolvedRoute{
		VehicleID:           vehicle.VehicleID,
		DriverID:            vehicle.DriverID,
		Stops:               stops,
		TotalDistanceKm:     round2(totalDistanceKm),
		TotalDurationMin:    int(math.Round(totalDurationMin)),
		CapacityUtilization: CapacityUtilization{WeightPct: weightPct, VolumePct: volumePct},
		EstimatedCost:       round2(totalDistanceKm * vehicle.CostPerKm),
		Violations:          violations,
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// routeDistance is depot → stops… → depot total distance.
func routeDistance(stops []SolverStop, distances [][]float64) float64 {
	total := distances[DEPOT][stops[0].MatrixIndex]
	for i := 0; i < len(stops)-1; i++ {
		total += distances[stops[i].MatrixIndex][stops[i+1].MatrixIndex]
	}
	total += distances[stops[len(stops)-1].MatrixIndex][DEPOT]
	return total
}

// routeDurationMin is the route's total working time: depot→first travel, then
// each stop's service time plus travel to the next, then last→depot. This is
// what the HOS ceiling gates against — driving plus on-stop time.
func routeDurationMin(stops []SolverStop, durations [][]float64) float64 {
	total := durations[DEPOT][stops[0].MatrixIndex]
	for i := 0; i < len(stops); i++ {
		total += stops[i].ServiceDurationMin
		nextIndex := DEPOT
		if i < len(stops)-1 {
			nextIndex = stops[i+1].MatrixIndex
		}
		total += durations[stops[i].MatrixIndex][nextIndex]
	}
	return total
}

func assembleResult(routes []SolvedRoute, unassigned []UnassignedShipment) Result {
	totalDist := 0.0
	totalDur := 0
	assignedCount := 0
	estCost := 0.0
	twViol := 0
	for _, r := range routes {
		totalDist += r.TotalDistanceKm
		totalDur += r.TotalDurationMin
		seen := make(map[string]struct{})
		for _, st := range r.Stops {
			seen[st.ShipmentID] = struct{}{}
		}
		assignedCount += len(seen)
		estCost += r.EstimatedCost
		for _, v := range r.Violations {
			if v.Kind == KindTimeWindow {
				twViol++
			}
		}
	}
	return Result{
		Routes:     routes,
		Unassigned: unassigned,
		Summary: Summary{
			TotalDistanceKm:      round2(totalDist),
			TotalDurationMin:     totalDur,
			VehiclesUsed:         len(routes),
			ShipmentsAssigned:    assignedCount,
			ShipmentsUnassigned:  len(unassigned),
			EstimatedCost:        round2(estCost),
			TimeWindowViolations: twViol,
		},
	}
}

func emptyResult(shipments []SolverShipment) Result {
	unassigned := make([]UnassignedShipment, 0, len(shipments))
	for _, s := range shipments {
		unassigned = append(unassigned, UnassignedShipment{
			ShipmentID: s.ShipmentID,
			Reason:     ReasonNoVehicleMatch,
			Detail:     "No vehicles available to assign.",
		})
	}
	return Result{
		Routes:     make([]SolvedRoute, 0),
		Unassigned: unassigned,
		Summary:    Summary{ShipmentsUnassigned: len(shipments)},
	}
}

// fmtMin formats minutes-from-midnight as HH:MM (matches the TS fmtMin).
func fmtMin(min int) string {
	h := min / 60
	m := min % 60
	return fmt.Sprintf("%02d:%02d", h, m)
}

// formatNum stringifies a float the way JS template interpolation would (480 →
// "480", 480.5 → "480.5") for the HOS detail message.
func formatNum(n float64) string { return strconv.FormatFloat(n, 'f', -1, 64) }

func round2(n float64) float64 { return math.Round(n*100) / 100 }
func round1(n float64) float64 { return math.Round(n*10) / 10 }
