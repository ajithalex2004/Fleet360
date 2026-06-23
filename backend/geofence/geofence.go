// Package geofence is the Go port of src/lib/logistics/geofence.ts.
//
// It detects when a shipment enters/leaves a stop's zone or deviates from its
// route corridor, from successive GPS pings. Geofencing is about TRANSITIONS:
// EvaluateGeofences compares the previous ping's inside/outside state against
// the current one and emits an event only on a change, so a truck idling
// inside a delivery zone doesn't spam "arrived" on every tick.
//
// Pure package, no DB/network — the geometry edge cases (boundary jitter,
// missing prior point, empty corridor) are unit-testable without a database.
// The service/handler layer loads fence definitions + the prior point and
// persists the resulting events.
package geofence

import (
	"fmt"
	"math"

	"fleet360-backend/geo"
)

const earthRadiusM = 6_371_000.0

// ── Fence definitions ────────────────────────────────────────────────────────

// StopFenceKind mirrors the TS union 'PICKUP' | 'DELIVERY' | 'STOP'.
type StopFenceKind string

const (
	FencePickup   StopFenceKind = "PICKUP"
	FenceDelivery StopFenceKind = "DELIVERY"
	FenceStop     StopFenceKind = "STOP"
)

// CircleFence is a radius around a stop. Entering means "arrived", leaving
// means "departed".
type CircleFence struct {
	ID      string
	Kind    StopFenceKind
	Center  geo.LatLng
	RadiusM float64
	Label   *string
}

// CorridorFence is a buffer of half-width WidthM around the planned route
// polyline. Leaving it is a route deviation worth an alert.
type CorridorFence struct {
	Polyline []geo.LatLng
	WidthM   float64
}

// ── Events ───────────────────────────────────────────────────────────────────

// EventType is the kind of transition detected.
type EventType string

const (
	EventEnter     EventType = "ENTER"
	EventExit      EventType = "EXIT"
	EventDeviation EventType = "DEVIATION"
	EventReturn    EventType = "RETURN"
)

// Event is one geofence transition. FenceID/FenceKind/Label are set for
// circle events; OffCorridorM is set for corridor events; DistanceM is the
// distance to the circle centre for circle events.
type Event struct {
	Type         EventType     `json:"type"`
	FenceID      string        `json:"fenceId,omitempty"`
	FenceKind    StopFenceKind `json:"fenceKind,omitempty"`
	Label        *string       `json:"label,omitempty"`
	DistanceM    int           `json:"distanceM,omitempty"`
	OffCorridorM int           `json:"offCorridorM,omitempty"`
}

// ── Geometry ─────────────────────────────────────────────────────────────────

// PointInCircle reports whether the great-circle distance is within the radius.
func PointInCircle(point geo.LatLng, fence CircleFence) bool {
	return geo.HaversineKm(point, fence.Center)*1000 <= fence.RadiusM
}

// DistanceToCircleM is the distance (m) from a point to a circle's centre.
func DistanceToCircleM(point geo.LatLng, fence CircleFence) float64 {
	return geo.HaversineKm(point, fence.Center) * 1000
}

// toLocalXY projects a lat/lng to local east/north metres relative to a
// reference point (equirectangular). Sub-metre accurate over geofencing-scale
// distances — far simpler than a full geodesic cross-track computation.
func toLocalXY(p, ref geo.LatLng) (x, y float64) {
	rad := math.Pi / 180
	x = (p.Longitude - ref.Longitude) * rad * earthRadiusM * math.Cos(ref.Latitude*rad)
	y = (p.Latitude - ref.Latitude) * rad * earthRadiusM
	return x, y
}

// DistanceToSegmentM is the shortest distance (m) from a point to segment a→b.
func DistanceToSegmentM(point, a, b geo.LatLng) float64 {
	px, py := toLocalXY(point, a)
	vx, vy := toLocalXY(b, a)
	segLenSq := vx*vx + vy*vy
	if segLenSq == 0 {
		// a and b coincide — distance to the point a.
		return math.Hypot(px, py)
	}
	// Projection factor t of p onto the segment, clamped to [0,1].
	t := (px*vx + py*vy) / segLenSq
	t = math.Max(0, math.Min(1, t))
	projX, projY := vx*t, vy*t
	return math.Hypot(px-projX, py-projY)
}

// DistanceToPolylineM is the shortest distance (m) from a point to a polyline.
// Returns +Inf for an empty polyline (matching the TS Infinity).
func DistanceToPolylineM(point geo.LatLng, polyline []geo.LatLng) float64 {
	if len(polyline) == 0 {
		return math.Inf(1)
	}
	if len(polyline) == 1 {
		return geo.HaversineKm(point, polyline[0]) * 1000
	}
	min := math.Inf(1)
	for i := 1; i < len(polyline); i++ {
		if d := DistanceToSegmentM(point, polyline[i-1], polyline[i]); d < min {
			min = d
		}
	}
	return min
}

// WithinCorridor reports whether a point is within the corridor. An empty
// polyline means no corridor is defined → never "off".
func WithinCorridor(point geo.LatLng, corridor CorridorFence) bool {
	if len(corridor.Polyline) == 0 {
		return true
	}
	return DistanceToPolylineM(point, corridor.Polyline) <= corridor.WidthM
}

// ── Transition evaluation ────────────────────────────────────────────────────

// EvaluateInput is the prev→curr transition to evaluate. Prev is nil on the
// first ping.
type EvaluateInput struct {
	Curr     geo.LatLng
	Prev     *geo.LatLng
	Circles  []CircleFence
	Corridor *CorridorFence
}

// EvaluateGeofences emits the geofence events for the transition prev → curr.
//
// Circles: ENTER when curr is inside and prev was outside (or absent); EXIT
// when curr is outside and prev was inside.
// Corridor: DEVIATION when curr is outside and prev was inside (or absent — a
// first ping already off-route is worth flagging); RETURN when curr is back
// inside and prev was outside.
//
// No event when the inside/outside state is unchanged — what stops a parked
// truck re-alerting every tick.
func EvaluateGeofences(in EvaluateInput) []Event {
	events := make([]Event, 0)

	for _, fence := range in.Circles {
		currInside := PointInCircle(in.Curr, fence)
		prevInside := false
		if in.Prev != nil {
			prevInside = PointInCircle(*in.Prev, fence)
		}
		distanceM := int(math.Round(DistanceToCircleM(in.Curr, fence)))

		switch {
		case currInside && !prevInside:
			events = append(events, Event{Type: EventEnter, FenceID: fence.ID, FenceKind: fence.Kind, Label: fence.Label, DistanceM: distanceM})
		case !currInside && prevInside:
			events = append(events, Event{Type: EventExit, FenceID: fence.ID, FenceKind: fence.Kind, Label: fence.Label, DistanceM: distanceM})
		}
	}

	if in.Corridor != nil && len(in.Corridor.Polyline) >= 2 {
		currInside := WithinCorridor(in.Curr, *in.Corridor)
		prevInside := true // absent prev → treat as previously on-route
		if in.Prev != nil {
			prevInside = WithinCorridor(*in.Prev, *in.Corridor)
		}
		offCorridorM := int(math.Round(DistanceToPolylineM(in.Curr, in.Corridor.Polyline)))

		switch {
		case !currInside && prevInside:
			events = append(events, Event{Type: EventDeviation, OffCorridorM: offCorridorM})
		case currInside && !prevInside:
			events = append(events, Event{Type: EventReturn, OffCorridorM: offCorridorM})
		}
	}

	return events
}

// ── Mapping helpers for the service/handler layer ────────────────────────────

// EventTitle is a human-readable title for an alert raised from an event.
func EventTitle(e Event, shipmentNo string) string {
	switch e.Type {
	case EventEnter:
		switch e.FenceKind {
		case FencePickup:
			return fmt.Sprintf("%s arrived at pickup", shipmentNo)
		case FenceDelivery:
			return fmt.Sprintf("%s arrived at delivery", shipmentNo)
		default:
			return fmt.Sprintf("%s arrived at stop", shipmentNo)
		}
	case EventExit:
		switch e.FenceKind {
		case FencePickup:
			return fmt.Sprintf("%s departed pickup", shipmentNo)
		case FenceDelivery:
			return fmt.Sprintf("%s departed delivery", shipmentNo)
		default:
			return fmt.Sprintf("%s departed stop", shipmentNo)
		}
	case EventDeviation:
		return fmt.Sprintf("%s deviated from route (%dm off corridor)", shipmentNo, e.OffCorridorM)
	case EventReturn:
		return fmt.Sprintf("%s returned to route", shipmentNo)
	}
	return shipmentNo
}

// EventSeverity ranks an event. Deviations are the actionable ones.
func EventSeverity(e Event) string {
	if e.Type == EventDeviation {
		return "HIGH"
	}
	return "LOW"
}

// EventTypeCode is a stable exception_type code for de-dup / filtering.
func EventTypeCode(e Event) string {
	switch e.Type {
	case EventEnter:
		return "GEOFENCE_ARRIVED_" + string(e.FenceKind)
	case EventExit:
		return "GEOFENCE_DEPARTED_" + string(e.FenceKind)
	case EventDeviation:
		return "GEOFENCE_ROUTE_DEVIATION"
	case EventReturn:
		return "GEOFENCE_ROUTE_RETURN"
	}
	return "GEOFENCE_UNKNOWN"
}

// CircleToPolygon approximates a circular geofence as a closed ring of
// [lng, lat] points for drawing on a map, walking `segments` points around the
// centre at the given radius. Returns GeoJSON-order coordinates with the first
// point repeated at the end to close the ring. Mirrors circleToPolygon in the TS.
func CircleToPolygon(center geo.LatLng, radiusM float64, segments int) [][2]float64 {
	if segments <= 0 {
		segments = 64
	}
	rad := math.Pi / 180
	latRad := center.Latitude * rad
	ring := make([][2]float64, 0, segments+1)
	for i := 0; i <= segments; i++ {
		theta := (float64(i) / float64(segments)) * 2 * math.Pi
		northM := radiusM * math.Cos(theta)
		eastM := radiusM * math.Sin(theta)
		dLat := (northM / earthRadiusM) * (180 / math.Pi)
		dLng := (eastM / (earthRadiusM * math.Cos(latRad))) * (180 / math.Pi)
		ring = append(ring, [2]float64{center.Longitude + dLng, center.Latitude + dLat})
	}
	return ring
}
