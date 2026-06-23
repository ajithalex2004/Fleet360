package routeopt

import (
	"testing"
)

// ── Pointer helpers (mirrors rateengine_test sp/fp/dp convention) ────────────

func ip(i int) *int       { return &i }
func sp(s string) *string { return &s }

// shipMap builds the shipmentByID lookup the internal helpers expect.
func shipMap(ships ...SolverShipment) map[string]SolverShipment {
	m := make(map[string]SolverShipment, len(ships))
	for _, s := range ships {
		m[s.ShipmentID] = s
	}
	return m
}

// stop is a terse SolverStop constructor for tests.
func stop(stopID, shipmentID string, typ StopType, idx int) SolverStop {
	return SolverStop{StopID: stopID, ShipmentID: shipmentID, Type: typ, MatrixIndex: idx}
}

// stopsOf projects a built route's stops back to the SolverStop fields
// PickupBeforeDelivery needs (type + shipment id), for asserting PD order on output.
func stopsOf(r SolvedRoute) []SolverStop {
	out := make([]SolverStop, 0, len(r.Stops))
	for _, s := range r.Stops {
		out = append(out, SolverStop{StopID: s.StopID, ShipmentID: s.ShipmentID, Type: s.Type})
	}
	return out
}

// ── PickupBeforeDelivery ─────────────────────────────────────────────────────

func TestPickupBeforeDelivery(t *testing.T) {
	cases := []struct {
		name  string
		stops []SolverStop
		want  bool
	}{
		{
			name:  "pickup then delivery is valid",
			stops: []SolverStop{stop("p1", "A", Pickup, 1), stop("d1", "A", Delivery, 2)},
			want:  true,
		},
		{
			name:  "delivery before pickup is invalid",
			stops: []SolverStop{stop("d1", "A", Delivery, 2), stop("p1", "A", Pickup, 1)},
			want:  false,
		},
		{
			name: "interleaved pairs both valid",
			stops: []SolverStop{
				stop("pA", "A", Pickup, 1), stop("pB", "B", Pickup, 3),
				stop("dA", "A", Delivery, 2), stop("dB", "B", Delivery, 4),
			},
			want: true,
		},
		{
			name: "one pair out of order is invalid",
			stops: []SolverStop{
				stop("pA", "A", Pickup, 1), stop("dB", "B", Delivery, 4),
				stop("dA", "A", Delivery, 2), stop("pB", "B", Pickup, 3),
			},
			want: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := PickupBeforeDelivery(tc.stops); got != tc.want {
				t.Fatalf("PickupBeforeDelivery = %v, want %v", got, tc.want)
			}
		})
	}
}

// ── RouteFeasibleCapacity ────────────────────────────────────────────────────

func TestRouteFeasibleCapacity(t *testing.T) {
	a := SolverShipment{ShipmentID: "A", WeightKg: 1000, VolumeCbm: 5}
	b := SolverShipment{ShipmentID: "B", WeightKg: 1500, VolumeCbm: 4}
	byID := shipMap(a, b)

	cases := []struct {
		name          string
		stops         []SolverStop
		capKg, capCbm float64
		want          bool
	}{
		{
			name:  "single shipment within capacity",
			stops: []SolverStop{stop("pA", "A", Pickup, 1), stop("dA", "A", Delivery, 2)},
			capKg: 2000, capCbm: 10, want: true,
		},
		{
			name:  "single shipment over weight",
			stops: []SolverStop{stop("pA", "A", Pickup, 1), stop("dA", "A", Delivery, 2)},
			capKg: 500, capCbm: 10, want: false,
		},
		{
			name:  "single shipment over volume",
			stops: []SolverStop{stop("pA", "A", Pickup, 1), stop("dA", "A", Delivery, 2)},
			capKg: 2000, capCbm: 3, want: false,
		},
		{
			name: "sequential pickups never stack (deliver before next pickup)",
			stops: []SolverStop{
				stop("pA", "A", Pickup, 1), stop("dA", "A", Delivery, 2),
				stop("pB", "B", Pickup, 3), stop("dB", "B", Delivery, 4),
			},
			capKg: 1500, capCbm: 5, want: true, // peak = max(1000,1500) = 1500
		},
		{
			name: "overlapping pickups stack and exceed",
			stops: []SolverStop{
				stop("pA", "A", Pickup, 1), stop("pB", "B", Pickup, 3),
				stop("dA", "A", Delivery, 2), stop("dB", "B", Delivery, 4),
			},
			capKg: 2000, capCbm: 10, want: false, // peak = 1000+1500 = 2500 > 2000
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := RouteFeasibleCapacity(tc.stops, byID, tc.capKg, tc.capCbm); got != tc.want {
				t.Fatalf("RouteFeasibleCapacity = %v, want %v", got, tc.want)
			}
		})
	}
}

// ── Empty inputs ─────────────────────────────────────────────────────────────

func TestOptimizeRoutes_NoVehicles(t *testing.T) {
	res := OptimizeRoutes(Input{
		Distances: [][]float64{{0}},
		Durations: [][]float64{{0}},
		Shipments: []SolverShipment{{ShipmentID: "A"}},
		Vehicles:  nil,
	})
	if len(res.Routes) != 0 {
		t.Fatalf("expected 0 routes, got %d", len(res.Routes))
	}
	if len(res.Unassigned) != 1 || res.Unassigned[0].Reason != ReasonNoVehicleMatch {
		t.Fatalf("expected 1 NO_VEHICLE_MATCH unassigned, got %+v", res.Unassigned)
	}
	if res.Summary.ShipmentsUnassigned != 1 {
		t.Fatalf("summary.ShipmentsUnassigned = %d, want 1", res.Summary.ShipmentsUnassigned)
	}
	// Slices must marshal as [] not null.
	if res.Routes == nil {
		t.Fatal("Routes slice must be non-nil")
	}
}

func TestOptimizeRoutes_NoShipments(t *testing.T) {
	res := OptimizeRoutes(Input{
		Vehicles: []SolverVehicle{{VehicleID: "V1", CapacityKg: 1000, CapacityCbm: 10}},
	})
	if len(res.Routes) != 0 || len(res.Unassigned) != 0 {
		t.Fatalf("expected empty result, got routes=%d unassigned=%d", len(res.Routes), len(res.Unassigned))
	}
}

// ── Single shipment, single vehicle: full numeric assertion ─────────────────

func TestOptimizeRoutes_SingleShipment(t *testing.T) {
	// Matrix: 0 depot, 1 pickup, 2 delivery. Symmetric.
	//   depot→pickup 10, pickup→delivery 5, delivery→depot 20  => 35 total.
	dist := [][]float64{
		{0, 10, 20},
		{10, 0, 5},
		{20, 5, 0},
	}
	dur := dist // 1 km == 1 min for clean timing

	res := OptimizeRoutes(Input{
		Distances: dist,
		Durations: dur,
		Shipments: []SolverShipment{{
			ShipmentID: "A",
			Pickup:     SolverStop{StopID: "pA", ShipmentID: "A", Type: Pickup, MatrixIndex: 1, WeightKg: 1000, VolumeCbm: 5},
			Delivery:   SolverStop{StopID: "dA", ShipmentID: "A", Type: Delivery, MatrixIndex: 2, WeightKg: 1000, VolumeCbm: 5},
			WeightKg:   1000,
			VolumeCbm:  5,
		}},
		Vehicles: []SolverVehicle{{
			VehicleID:     "V1",
			DriverID:      sp("D1"),
			CapacityKg:    2000,
			CapacityCbm:   10,
			CostPerKm:     2,
			ShiftStartMin: 480,
			ShiftEndMin:   1080,
			MaxDriveMin:   1000,
		}},
	})

	if len(res.Routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(res.Routes))
	}
	r := res.Routes[0]
	if r.VehicleID != "V1" || r.DriverID == nil || *r.DriverID != "D1" {
		t.Fatalf("vehicle/driver mismatch: %+v", r)
	}
	if len(r.Stops) != 2 {
		t.Fatalf("expected 2 stops, got %d", len(r.Stops))
	}
	if r.TotalDistanceKm != 35 {
		t.Errorf("TotalDistanceKm = %v, want 35", r.TotalDistanceKm)
	}
	if r.TotalDurationMin != 35 {
		t.Errorf("TotalDurationMin = %v, want 35", r.TotalDurationMin)
	}
	if r.EstimatedCost != 70 {
		t.Errorf("EstimatedCost = %v, want 70", r.EstimatedCost)
	}
	if r.CapacityUtilization.WeightPct != 50 || r.CapacityUtilization.VolumePct != 50 {
		t.Errorf("CapacityUtilization = %+v, want 50/50", r.CapacityUtilization)
	}
	// Timing: depart 480 → arrive pickup 490, arrive delivery 495.
	if r.Stops[0].ArriveMin != 490 || r.Stops[1].ArriveMin != 495 {
		t.Errorf("arrive mins = %d,%d want 490,495", r.Stops[0].ArriveMin, r.Stops[1].ArriveMin)
	}
	if r.Stops[0].LoadAfterKg != 1000 || r.Stops[1].LoadAfterKg != 0 {
		t.Errorf("load tracking = %v,%v want 1000,0", r.Stops[0].LoadAfterKg, r.Stops[1].LoadAfterKg)
	}
	if len(r.Violations) != 0 {
		t.Errorf("expected no violations, got %+v", r.Violations)
	}
	if res.Summary.VehiclesUsed != 1 || res.Summary.ShipmentsAssigned != 1 || res.Summary.ShipmentsUnassigned != 0 {
		t.Errorf("summary mismatch: %+v", res.Summary)
	}
}

// ── Clarke-Wright merge: two stitchable shipments share one vehicle ──────────

func TestOptimizeRoutes_MergesTwoShipments(t *testing.T) {
	// 0 depot, 1 Apick, 2 Adel, 3 Bpick, 4 Bdel.
	// Stitch A→B is the dominant saving (d[2][0]+d[0][3]-d[2][3] = 20+20-5 = 35).
	dist := [][]float64{
		{0, 10, 20, 20, 20},
		{10, 0, 5, 15, 25},
		{20, 5, 0, 5, 15},
		{20, 15, 5, 0, 5},
		{20, 25, 15, 5, 0},
	}
	dur := dist

	mk := func(id string, pIdx, dIdx int) SolverShipment {
		return SolverShipment{
			ShipmentID: id,
			Pickup:     SolverStop{StopID: "p" + id, ShipmentID: id, Type: Pickup, MatrixIndex: pIdx, WeightKg: 1000, VolumeCbm: 4},
			Delivery:   SolverStop{StopID: "d" + id, ShipmentID: id, Type: Delivery, MatrixIndex: dIdx, WeightKg: 1000, VolumeCbm: 4},
			WeightKg:   1000,
			VolumeCbm:  4,
		}
	}

	res := OptimizeRoutes(Input{
		Distances: dist,
		Durations: dur,
		Shipments: []SolverShipment{mk("A", 1, 2), mk("B", 3, 4)},
		Vehicles: []SolverVehicle{{
			VehicleID:     "V1",
			CapacityKg:    2000, // fits the peak of 1000 (deliveries precede next pickup)
			CapacityCbm:   10,
			CostPerKm:     2,
			ShiftStartMin: 480,
			ShiftEndMin:   1200,
			MaxDriveMin:   1000,
		}},
	})

	if len(res.Routes) != 1 {
		t.Fatalf("expected the two shipments merged into 1 route, got %d routes", len(res.Routes))
	}
	r := res.Routes[0]
	if len(r.Stops) != 4 {
		t.Fatalf("expected 4 stops, got %d", len(r.Stops))
	}
	if !PickupBeforeDelivery(stopsOf(r)) {
		t.Errorf("merged route violates pickup-before-delivery: %+v", r.Stops)
	}
	// Best sequence stays [Apick,Adel,Bpick,Bdel]: 10+5+5+5+20 = 45.
	if r.TotalDistanceKm != 45 {
		t.Errorf("TotalDistanceKm = %v, want 45", r.TotalDistanceKm)
	}
	if res.Summary.ShipmentsAssigned != 2 || res.Summary.ShipmentsUnassigned != 0 {
		t.Errorf("summary mismatch: %+v", res.Summary)
	}
}

// ── Capacity gate: oversized shipment cannot be assigned ────────────────────

func TestOptimizeRoutes_UnassignedNoCapacity(t *testing.T) {
	dist := [][]float64{
		{0, 10, 20},
		{10, 0, 5},
		{20, 5, 0},
	}
	res := OptimizeRoutes(Input{
		Distances: dist,
		Durations: dist,
		Shipments: []SolverShipment{{
			ShipmentID: "A",
			Pickup:     SolverStop{StopID: "pA", ShipmentID: "A", Type: Pickup, MatrixIndex: 1, WeightKg: 5000, VolumeCbm: 5},
			Delivery:   SolverStop{StopID: "dA", ShipmentID: "A", Type: Delivery, MatrixIndex: 2, WeightKg: 5000, VolumeCbm: 5},
			WeightKg:   5000,
			VolumeCbm:  5,
		}},
		Vehicles: []SolverVehicle{{
			VehicleID: "V1", CapacityKg: 2000, CapacityCbm: 10, CostPerKm: 1, MaxDriveMin: 1000,
		}},
	})

	if len(res.Routes) != 0 {
		t.Fatalf("expected 0 routes, got %d", len(res.Routes))
	}
	if len(res.Unassigned) != 1 || res.Unassigned[0].Reason != ReasonNoCapacity || res.Unassigned[0].ShipmentID != "A" {
		t.Fatalf("expected A unassigned NO_CAPACITY, got %+v", res.Unassigned)
	}
	if res.Summary.ShipmentsAssigned != 0 || res.Summary.ShipmentsUnassigned != 1 {
		t.Errorf("summary mismatch: %+v", res.Summary)
	}
}

// ── Time-window violation ────────────────────────────────────────────────────

func TestOptimizeRoutes_TimeWindowViolation(t *testing.T) {
	// depot→pickup 10, pickup→delivery 10 → delivery arrives at 480+20 = 500.
	dist := [][]float64{
		{0, 10, 20},
		{10, 0, 10},
		{20, 10, 0},
	}
	res := OptimizeRoutes(Input{
		Distances: dist,
		Durations: dist,
		Shipments: []SolverShipment{{
			ShipmentID: "A",
			Pickup:     SolverStop{StopID: "pA", ShipmentID: "A", Type: Pickup, MatrixIndex: 1, WeightKg: 100, VolumeCbm: 1},
			Delivery:   SolverStop{StopID: "dA", ShipmentID: "A", Type: Delivery, MatrixIndex: 2, WeightKg: 100, VolumeCbm: 1, WindowToMin: ip(490)},
			WeightKg:   100,
			VolumeCbm:  1,
		}},
		Vehicles: []SolverVehicle{{
			VehicleID: "V1", CapacityKg: 1000, CapacityCbm: 10, CostPerKm: 1, ShiftStartMin: 480, MaxDriveMin: 1000,
		}},
	})

	if len(res.Routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(res.Routes))
	}
	r := res.Routes[0]
	del := r.Stops[1]
	if del.OnTime {
		t.Errorf("delivery should be late (arrive 500 vs window close 490)")
	}
	if del.LateMinutes != 10 {
		t.Errorf("LateMinutes = %d, want 10", del.LateMinutes)
	}
	if res.Summary.TimeWindowViolations != 1 {
		t.Errorf("summary.TimeWindowViolations = %d, want 1", res.Summary.TimeWindowViolations)
	}
	found := false
	for _, v := range r.Violations {
		if v.Kind == KindTimeWindow {
			found = true
			want := "Arrived 10min after window close (08:10)"
			if v.Detail != want {
				t.Errorf("detail = %q, want %q", v.Detail, want)
			}
		}
	}
	if !found {
		t.Errorf("expected a TIME_WINDOW violation, got %+v", r.Violations)
	}
}

// ── Time-window wait: early arrival holds until the window opens ────────────

func TestOptimizeRoutes_WaitsForWindowOpen(t *testing.T) {
	dist := [][]float64{
		{0, 10, 20},
		{10, 0, 5},
		{20, 5, 0},
	}
	res := OptimizeRoutes(Input{
		Distances: dist,
		Durations: dist,
		Shipments: []SolverShipment{{
			ShipmentID: "A",
			// Arrive pickup at 490 but window opens at 600 → wait, arrive=600.
			Pickup:   SolverStop{StopID: "pA", ShipmentID: "A", Type: Pickup, MatrixIndex: 1, WeightKg: 100, VolumeCbm: 1, WindowFromMin: ip(600)},
			Delivery: SolverStop{StopID: "dA", ShipmentID: "A", Type: Delivery, MatrixIndex: 2, WeightKg: 100, VolumeCbm: 1},
			WeightKg: 100, VolumeCbm: 1,
		}},
		Vehicles: []SolverVehicle{{
			VehicleID: "V1", CapacityKg: 1000, CapacityCbm: 10, CostPerKm: 1, ShiftStartMin: 480, MaxDriveMin: 2000,
		}},
	})
	r := res.Routes[0]
	if r.Stops[0].ArriveMin != 600 {
		t.Errorf("pickup ArriveMin = %d, want 600 (waited for window)", r.Stops[0].ArriveMin)
	}
	if r.Stops[1].ArriveMin != 605 {
		t.Errorf("delivery ArriveMin = %d, want 605", r.Stops[1].ArriveMin)
	}
	if !r.Stops[0].OnTime {
		t.Errorf("waiting for the window open is on-time, not a violation")
	}
}

// ── HOS violation: route exceeds the driver's drive limit ───────────────────

func TestOptimizeRoutes_HOSViolation(t *testing.T) {
	dist := [][]float64{
		{0, 10, 20},
		{10, 0, 5},
		{20, 5, 0},
	}
	// Route duration is 35 min; maxDriveMin 30 → HOS breach.
	res := OptimizeRoutes(Input{
		Distances: dist,
		Durations: dist,
		Shipments: []SolverShipment{{
			ShipmentID: "A",
			Pickup:     SolverStop{StopID: "pA", ShipmentID: "A", Type: Pickup, MatrixIndex: 1, WeightKg: 100, VolumeCbm: 1},
			Delivery:   SolverStop{StopID: "dA", ShipmentID: "A", Type: Delivery, MatrixIndex: 2, WeightKg: 100, VolumeCbm: 1},
			WeightKg:   100, VolumeCbm: 1,
		}},
		Vehicles: []SolverVehicle{{
			VehicleID: "V1", CapacityKg: 1000, CapacityCbm: 10, CostPerKm: 1, ShiftStartMin: 480, MaxDriveMin: 30,
		}},
	})
	r := res.Routes[0]
	var hos *Violation
	for i := range r.Violations {
		if r.Violations[i].Kind == KindHOS {
			hos = &r.Violations[i]
		}
	}
	if hos == nil {
		t.Fatalf("expected an HOS violation, got %+v", r.Violations)
	}
	want := "Route duration 35min exceeds driver limit 30min"
	if hos.Detail != want {
		t.Errorf("detail = %q, want %q", hos.Detail, want)
	}
}

// ── Vehicle assignment: larger route claims the larger truck ────────────────

func TestOptimizeRoutes_AssignsLargestRouteToLargestVehicle(t *testing.T) {
	// Two independent (non-stitchable) shipments. Savings are negative so they
	// stay as two routes; A is heavier than B.
	dist := [][]float64{
		{0, 10, 10, 10, 10},
		{10, 0, 2, 99, 99},
		{10, 2, 0, 99, 99},
		{10, 99, 99, 0, 2},
		{10, 99, 99, 2, 0},
	}
	mk := func(id string, pIdx, dIdx int, w float64) SolverShipment {
		return SolverShipment{
			ShipmentID: id,
			Pickup:     SolverStop{StopID: "p" + id, ShipmentID: id, Type: Pickup, MatrixIndex: pIdx, WeightKg: w, VolumeCbm: 1},
			Delivery:   SolverStop{StopID: "d" + id, ShipmentID: id, Type: Delivery, MatrixIndex: dIdx, WeightKg: w, VolumeCbm: 1},
			WeightKg:   w, VolumeCbm: 1,
		}
	}
	res := OptimizeRoutes(Input{
		Distances: dist,
		Durations: dist,
		Shipments: []SolverShipment{mk("A", 1, 2, 1800), mk("B", 3, 4, 400)},
		Vehicles: []SolverVehicle{
			{VehicleID: "SMALL", CapacityKg: 500, CapacityCbm: 10, CostPerKm: 1, MaxDriveMin: 1000},
			{VehicleID: "BIG", CapacityKg: 2000, CapacityCbm: 10, CostPerKm: 1, MaxDriveMin: 1000},
		},
	})

	if len(res.Routes) != 2 {
		t.Fatalf("expected 2 routes, got %d", len(res.Routes))
	}
	byShip := map[string]string{} // shipmentID → vehicleID
	for _, r := range res.Routes {
		for _, s := range r.Stops {
			byShip[s.ShipmentID] = r.VehicleID
		}
	}
	if byShip["A"] != "BIG" {
		t.Errorf("heavy shipment A assigned to %q, want BIG", byShip["A"])
	}
	if byShip["B"] != "SMALL" {
		t.Errorf("light shipment B assigned to %q, want SMALL", byShip["B"])
	}
}

// ── 2-opt: an out-of-order seeded route gets uncrossed ──────────────────────

func TestTwoOptImprove_UncrossesRoute(t *testing.T) {
	// A symmetric matrix where visiting in index order crosses, and a reorder
	// that preserves pickup-before-delivery is shorter.
	// Stops sequence [p1,p2,d1,d2] with a geometry favouring [p1,d1,p2,d2].
	dist := [][]float64{
		{0, 1, 100, 2, 100},   // depot
		{1, 0, 100, 1, 100},   // p1 (idx1)
		{100, 100, 0, 100, 1}, // p2 (idx2)
		{2, 1, 100, 0, 100},   // d1 (idx3)
		{100, 100, 1, 100, 0}, // d2 (idx4)
	}
	stops := []SolverStop{
		stop("p1", "A", Pickup, 1),
		stop("p2", "B", Pickup, 2),
		stop("d1", "A", Delivery, 3),
		stop("d2", "B", Delivery, 4),
	}
	before := routeDistance(stops, dist)
	improved := twoOptImprove(stops, dist)
	after := routeDistance(improved, dist)

	if after > before {
		t.Errorf("2-opt made the route longer: before %v after %v", before, after)
	}
	if !PickupBeforeDelivery(improved) {
		t.Errorf("2-opt broke pickup-before-delivery: %+v", improved)
	}
}
