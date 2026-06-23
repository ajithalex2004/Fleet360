package geofence

import (
	"math"
	"testing"

	"fleet360-backend/geo"
)

// A delivery fence in Dubai with a 200m radius.
func deliveryFence() CircleFence {
	label := "Jebel Ali DC"
	return CircleFence{
		ID:      "stop-1",
		Kind:    FenceDelivery,
		Center:  geo.LatLng{Latitude: 25.0, Longitude: 55.0},
		RadiusM: 200,
		Label:   &label,
	}
}

func TestPointInCircle(t *testing.T) {
	f := deliveryFence()

	t.Run("centre is inside", func(t *testing.T) {
		if !PointInCircle(f.Center, f) {
			t.Fatal("centre should be inside the fence")
		}
	})

	t.Run("a few km away is outside", func(t *testing.T) {
		far := geo.LatLng{Latitude: 25.1, Longitude: 55.1}
		if PointInCircle(far, f) {
			t.Fatal("point ~14km away should be outside a 200m fence")
		}
	})
}

func TestDistanceToCircleM(t *testing.T) {
	f := deliveryFence()
	if d := DistanceToCircleM(f.Center, f); d != 0 {
		t.Fatalf("distance from centre should be 0, got %v", d)
	}
	// 1 degree of latitude is ~111km → ~111000m.
	north := geo.LatLng{Latitude: 26.0, Longitude: 55.0}
	d := DistanceToCircleM(north, f)
	if d < 110_000 || d > 112_000 {
		t.Fatalf("expected ~111000m, got %v", d)
	}
}

func TestDistanceToSegmentM(t *testing.T) {
	a := geo.LatLng{Latitude: 25.0, Longitude: 55.0}
	b := geo.LatLng{Latitude: 25.0, Longitude: 55.1} // due east of a

	t.Run("point on the segment is ~0", func(t *testing.T) {
		mid := geo.LatLng{Latitude: 25.0, Longitude: 55.05}
		if d := DistanceToSegmentM(mid, a, b); d > 1 {
			t.Fatalf("point on segment should be ~0m, got %v", d)
		}
	})

	t.Run("point past the end clamps to the endpoint", func(t *testing.T) {
		// Well east of b — nearest point is b itself.
		past := geo.LatLng{Latitude: 25.0, Longitude: 55.2}
		dSeg := DistanceToSegmentM(past, a, b)
		dToB := geo.HaversineKm(past, b) * 1000
		if math.Abs(dSeg-dToB) > 1 {
			t.Fatalf("past-end distance %v should equal distance to b %v", dSeg, dToB)
		}
	})

	t.Run("degenerate segment falls back to point distance", func(t *testing.T) {
		p := geo.LatLng{Latitude: 25.01, Longitude: 55.0}
		dSeg := DistanceToSegmentM(p, a, a)
		dToA := geo.HaversineKm(p, a) * 1000
		if math.Abs(dSeg-dToA) > 1 {
			t.Fatalf("degenerate segment distance %v should equal distance to a %v", dSeg, dToA)
		}
	})
}

func TestDistanceToPolylineM(t *testing.T) {
	t.Run("empty polyline is +Inf", func(t *testing.T) {
		if d := DistanceToPolylineM(geo.LatLng{}, nil); !math.IsInf(d, 1) {
			t.Fatalf("empty polyline should be +Inf, got %v", d)
		}
	})

	t.Run("single point is haversine distance", func(t *testing.T) {
		pt := geo.LatLng{Latitude: 25.0, Longitude: 55.0}
		line := []geo.LatLng{{Latitude: 25.01, Longitude: 55.0}}
		want := geo.HaversineKm(pt, line[0]) * 1000
		if d := DistanceToPolylineM(pt, line); math.Abs(d-want) > 1 {
			t.Fatalf("single-point polyline distance %v should equal %v", d, want)
		}
	})

	t.Run("takes the nearest segment", func(t *testing.T) {
		// An L-shaped path; the test point sits next to the first leg.
		line := []geo.LatLng{
			{Latitude: 25.0, Longitude: 55.0},
			{Latitude: 25.0, Longitude: 55.1},
			{Latitude: 25.1, Longitude: 55.1},
		}
		pt := geo.LatLng{Latitude: 25.001, Longitude: 55.05} // ~111m north of first leg
		d := DistanceToPolylineM(pt, line)
		if d < 80 || d > 140 {
			t.Fatalf("expected ~111m to nearest leg, got %v", d)
		}
	})
}

func TestWithinCorridor(t *testing.T) {
	line := []geo.LatLng{
		{Latitude: 25.0, Longitude: 55.0},
		{Latitude: 25.0, Longitude: 55.1},
	}

	t.Run("empty polyline is always within", func(t *testing.T) {
		if !WithinCorridor(geo.LatLng{Latitude: 1, Longitude: 1}, CorridorFence{WidthM: 100}) {
			t.Fatal("no corridor defined should mean never off-route")
		}
	})

	t.Run("on the line is within a wide corridor", func(t *testing.T) {
		c := CorridorFence{Polyline: line, WidthM: 500}
		if !WithinCorridor(geo.LatLng{Latitude: 25.0, Longitude: 55.05}, c) {
			t.Fatal("on-line point should be within corridor")
		}
	})

	t.Run("far perpendicular is outside a narrow corridor", func(t *testing.T) {
		c := CorridorFence{Polyline: line, WidthM: 100}
		// ~1.1km north of the line.
		if WithinCorridor(geo.LatLng{Latitude: 25.01, Longitude: 55.05}, c) {
			t.Fatal("1km-off point should be outside a 100m corridor")
		}
	})
}

func TestEvaluateGeofencesCircle(t *testing.T) {
	f := deliveryFence()
	inside := f.Center
	outside := geo.LatLng{Latitude: 25.1, Longitude: 55.1}

	t.Run("ENTER when prev absent and curr inside", func(t *testing.T) {
		ev := EvaluateGeofences(EvaluateInput{Curr: inside, Circles: []CircleFence{f}})
		if len(ev) != 1 || ev[0].Type != EventEnter {
			t.Fatalf("expected single ENTER, got %+v", ev)
		}
		if ev[0].FenceID != "stop-1" || ev[0].FenceKind != FenceDelivery {
			t.Fatalf("ENTER should carry fence identity, got %+v", ev[0])
		}
	})

	t.Run("ENTER when crossing in from outside", func(t *testing.T) {
		ev := EvaluateGeofences(EvaluateInput{Curr: inside, Prev: &outside, Circles: []CircleFence{f}})
		if len(ev) != 1 || ev[0].Type != EventEnter {
			t.Fatalf("expected ENTER, got %+v", ev)
		}
	})

	t.Run("EXIT when crossing out", func(t *testing.T) {
		ev := EvaluateGeofences(EvaluateInput{Curr: outside, Prev: &inside, Circles: []CircleFence{f}})
		if len(ev) != 1 || ev[0].Type != EventExit {
			t.Fatalf("expected EXIT, got %+v", ev)
		}
	})

	t.Run("no event when staying inside", func(t *testing.T) {
		ev := EvaluateGeofences(EvaluateInput{Curr: inside, Prev: &inside, Circles: []CircleFence{f}})
		if len(ev) != 0 {
			t.Fatalf("expected no event for unchanged state, got %+v", ev)
		}
	})

	t.Run("no event when staying outside", func(t *testing.T) {
		ev := EvaluateGeofences(EvaluateInput{Curr: outside, Prev: &outside, Circles: []CircleFence{f}})
		if len(ev) != 0 {
			t.Fatalf("expected no event, got %+v", ev)
		}
	})
}

func TestEvaluateGeofencesCorridor(t *testing.T) {
	line := []geo.LatLng{
		{Latitude: 25.0, Longitude: 55.0},
		{Latitude: 25.0, Longitude: 55.1},
	}
	corridor := &CorridorFence{Polyline: line, WidthM: 100}
	onRoute := geo.LatLng{Latitude: 25.0, Longitude: 55.05}
	offRoute := geo.LatLng{Latitude: 25.02, Longitude: 55.05} // ~2.2km north

	t.Run("DEVIATION when prev on-route and curr off", func(t *testing.T) {
		ev := EvaluateGeofences(EvaluateInput{Curr: offRoute, Prev: &onRoute, Corridor: corridor})
		if len(ev) != 1 || ev[0].Type != EventDeviation {
			t.Fatalf("expected DEVIATION, got %+v", ev)
		}
		if ev[0].OffCorridorM <= 0 {
			t.Fatalf("DEVIATION should report off-corridor distance, got %+v", ev[0])
		}
	})

	t.Run("DEVIATION on first ping already off-route", func(t *testing.T) {
		ev := EvaluateGeofences(EvaluateInput{Curr: offRoute, Corridor: corridor})
		if len(ev) != 1 || ev[0].Type != EventDeviation {
			t.Fatalf("expected DEVIATION for absent prev, got %+v", ev)
		}
	})

	t.Run("RETURN when coming back on-route", func(t *testing.T) {
		ev := EvaluateGeofences(EvaluateInput{Curr: onRoute, Prev: &offRoute, Corridor: corridor})
		if len(ev) != 1 || ev[0].Type != EventReturn {
			t.Fatalf("expected RETURN, got %+v", ev)
		}
	})

	t.Run("no event while on-route", func(t *testing.T) {
		ev := EvaluateGeofences(EvaluateInput{Curr: onRoute, Prev: &onRoute, Corridor: corridor})
		if len(ev) != 0 {
			t.Fatalf("expected no event, got %+v", ev)
		}
	})

	t.Run("single-point corridor is ignored", func(t *testing.T) {
		one := &CorridorFence{Polyline: line[:1], WidthM: 100}
		ev := EvaluateGeofences(EvaluateInput{Curr: offRoute, Prev: &onRoute, Corridor: one})
		if len(ev) != 0 {
			t.Fatalf("corridor with <2 points should produce no events, got %+v", ev)
		}
	})
}

func TestEventMappers(t *testing.T) {
	enter := Event{Type: EventEnter, FenceKind: FencePickup}
	if got := EventTitle(enter, "SHP-1"); got != "SHP-1 arrived at pickup" {
		t.Fatalf("unexpected ENTER title: %q", got)
	}
	if EventSeverity(enter) != "LOW" {
		t.Fatal("ENTER should be LOW severity")
	}
	if got := EventTypeCode(enter); got != "GEOFENCE_ARRIVED_PICKUP" {
		t.Fatalf("unexpected ENTER code: %q", got)
	}

	dev := Event{Type: EventDeviation, OffCorridorM: 250}
	if EventSeverity(dev) != "HIGH" {
		t.Fatal("DEVIATION should be HIGH severity")
	}
	if got := EventTypeCode(dev); got != "GEOFENCE_ROUTE_DEVIATION" {
		t.Fatalf("unexpected DEVIATION code: %q", got)
	}
}

func TestCircleToPolygon(t *testing.T) {
	center := geo.LatLng{Latitude: 25.0, Longitude: 55.0}
	ring := CircleToPolygon(center, 200, 16)

	if len(ring) != 17 {
		t.Fatalf("expected 16 segments + closing point = 17, got %d", len(ring))
	}
	// Closed ring: first and last point coincide.
	if ring[0] != ring[len(ring)-1] {
		t.Fatalf("ring should be closed, first %v last %v", ring[0], ring[len(ring)-1])
	}
	// Each vertex should be ~200m from the centre.
	for i, pt := range ring {
		v := geo.LatLng{Latitude: pt[1], Longitude: pt[0]} // [lng, lat] order
		d := geo.HaversineKm(center, v) * 1000
		if d < 195 || d > 205 {
			t.Fatalf("vertex %d is %vm from centre, expected ~200m", i, d)
		}
	}
}
